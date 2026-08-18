#!/usr/bin/env python3
"""Traz para o app da vovo os canais das listas M3U que rodam no PC.

O painel do PC (iptv-org-test) le uma pasta de listas .m3u/.m3u8 e por isso
sempre teve mais canais que o celular, que carrega um JSON fixo. Este script
faz a ponte: le a mesma pasta, arruma o que o WebView do Android nao aguenta e
grava src/data/default_channels.json.

Tres coisas que ele resolve e que nao sao obvias:

1. Servidor Xtream entrega MPEG-TS puro (`.../12345.ts` ou sem extensao). O
   hls.js e a tag <video> do Android nao abrem isso; o mesmo canal em `.m3u8`
   abre. Entao toda URL nesse formato vira `.m3u8` antes de entrar na lista.
2. Os group-title das listas pagas vem como "♦️Canais | 24H Seriados". O app
   escolhe a categoria lendo texto em portugues, entao o rotulo e normalizado
   para "Series", "Filmes", "Abertos" e afins.
3. Canal morto so atrapalha a vovo. Cada URL nova e testada de verdade antes
   de entrar, com limite de conexoes por servidor (provedor Xtream corta quem
   abre demais ao mesmo tempo e isso viraria "morto" mentiroso).

Canal que ja estava no app nunca e removido: favorito e guardado pela URL.

Uso:
    python tools/importar_canais_pc.py
    python tools/importar_canais_pc.py --fonte D:/IPTV --sem-teste

Codigos de saida: 0 = gravou, 2 = nada novo para gravar, 1 = erro.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
import threading
import traceback
import unicodedata
import urllib.error
import urllib.request
from collections import Counter, defaultdict
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from urllib.parse import urlsplit

_SCRIPT = Path(__file__).resolve()
RAIZ = _SCRIPT.parent.parent

FONTE_PADRAO = Path.home() / "Desktop" / "iptv-org-test" / "lists"
SAIDA_PADRAO = RAIZ / "src" / "data" / "default_channels.json"

UA = "VLC/3.0.20 LibVLC/3.0.20"
TIMEOUT = 8.0
CONEXOES_POR_SERVIDOR = 4
AMOSTRA_POR_SERVIDOR = 6

# Pedaco do group-title -> rotulo que o app entende. A ordem importa: o
# primeiro que casar vence, entao termo especifico vem antes do generico.
CATEGORIAS: list[tuple[str, str]] = [
    ("radio", "Radios"),
    ("noticia", "Noticias"),
    ("news", "Noticias"),
    ("jornal", "Noticias"),
    ("infanti", "Infantil"),
    ("kids", "Infantil"),
    ("anime", "Infantil"),
    ("desenho", "Infantil"),
    ("cartoon", "Infantil"),
    ("tokusatsu", "Infantil"),
    ("seriado", "Series"),
    ("serie", "Series"),
    ("novela", "Series"),
    ("filme", "Filmes"),
    ("movie", "Filmes"),
    ("cine", "Filmes"),
    ("telecine", "Filmes"),
    ("hbo", "Filmes"),
    ("disney", "Filmes"),
    ("paramount", "Filmes"),
    ("prime video", "Filmes"),
    ("netflix", "Filmes"),
    ("action", "Filmes"),
    ("comedy", "Filmes"),
    ("drama", "Filmes"),
    ("classic", "Filmes"),
    ("esporte", "Esportes"),
    ("sport", "Esportes"),
    ("futebol", "Esportes"),
    ("premiere", "Esportes"),
    ("espn", "Esportes"),
    ("nba", "Esportes"),
    ("ufc", "Esportes"),
    ("combate", "Esportes"),
    ("campeonato", "Esportes"),
    ("religi", "Religioso"),
    ("gospel", "Religioso"),
    ("document", "Documentarios"),
    ("discovery", "Documentarios"),
    ("history", "Documentarios"),
    ("educa", "Educacao"),
    ("cultura", "Cultura"),
    ("musica", "Musica"),
    ("music", "Musica"),
    ("aberto", "Abertos"),
    ("globo", "Abertos"),
    ("record", "Abertos"),
    ("sbt", "Abertos"),
    ("band", "Abertos"),
    ("regional", "Abertos"),
    ("capitais", "Abertos"),
    ("variedade", "Variedades"),
    ("entretenimento", "Variedades"),
    ("4k", "Variedades"),
]


class Canal:
    """Uma linha de playlist ja no formato que o app espera."""

    __slots__ = ("id", "nome", "logo", "grupo", "url")

    def __init__(self, id: str, nome: str, logo: str, grupo: str, url: str) -> None:
        self.id = id
        self.nome = nome
        self.logo = logo
        self.grupo = grupo
        self.url = url

    def como_json(self) -> dict[str, str]:
        return {
            "id": self.id,
            "name": self.nome,
            "url": self.url,
            "logo": self.logo,
            "group": self.grupo,
            "country": "br",
        }


# ----------------------------------------------------------------- leitura


def sem_acento(texto: str) -> str:
    normal = unicodedata.normalize("NFKD", texto or "")
    return "".join(c for c in normal if not unicodedata.combining(c)).lower()


def atributo(linha: str, nome: str) -> str:
    achado = re.search(rf'{nome}="([^"]*)"', linha)
    return achado.group(1).strip() if achado else ""


def categoria_de(grupo: str, nome: str) -> str:
    """Rotulo em portugues, deduzido do group-title e, em ultimo caso, do nome."""
    alvo = sem_acento(f"{grupo} {nome}")
    for termo, rotulo in CATEGORIAS:
        if termo in alvo:
            return rotulo
    return "Variedades"


def preparar_url(url: str) -> str:
    """Xtream em MPEG-TS -> a mesma coisa em HLS, que e o que o app consegue abrir.

    O formato e sempre `http://servidor/usuario/senha/ID[.ts|.m3u8]`. Sem
    extensao o servidor devolve TS, que o WebView ignora em silencio: video
    preto, nenhum erro. Trocar para `.m3u8` e o que faz esses canais tocarem.
    """
    partes = urlsplit(url)
    caminho = partes.path
    trechos = [t for t in caminho.split("/") if t]
    if len(trechos) != 3:
        return url

    ultimo = trechos[-1]
    if ultimo.endswith(".m3u8"):
        return url
    if ultimo.endswith(".ts"):
        ultimo = ultimo[: -len(".ts")]
    elif "." in ultimo:
        return url  # extensao estranha: nao e Xtream, deixa como veio

    if not ultimo.isdigit():
        return url
    novo = f"/{trechos[0]}/{trechos[1]}/{ultimo}.m3u8"
    return partes._replace(path=novo).geturl()


def ler_playlist(arquivo: Path) -> list[Canal]:
    canais: list[Canal] = []
    info = ""
    texto = arquivo.read_text(encoding="utf-8", errors="replace")
    for linha in texto.splitlines():
        limpa = linha.strip()
        if limpa.startswith("#EXTINF"):
            info = limpa
        elif limpa and not limpa.startswith("#") and info:
            nome = info.split(",", 1)[-1].strip() or atributo(info, "tvg-name")
            tvg = atributo(info, "tvg-id")
            canais.append(
                Canal(
                    id=tvg or re.sub(r"[^a-z0-9]+", "-", sem_acento(nome)).strip("-"),
                    nome=nome,
                    logo=atributo(info, "tvg-logo"),
                    grupo=categoria_de(atributo(info, "group-title"), nome),
                    url=preparar_url(limpa),
                )
            )
            info = ""
    return canais


def ler_pasta(pasta: Path) -> list[Canal]:
    # As cameras de casa entram sozinhas pelo servidor (utils/cameras.ts). Se a
    # lista do PC tambem entrasse aqui, a vovo veria a mesma camera duas vezes,
    # uma delas com o IP velho gravado.
    arquivos = [
        p
        for p in sorted(pasta.glob("*.m3u")) + sorted(pasta.glob("*.m3u8"))
        if not p.stem.lower().startswith("camera")
    ]
    if not arquivos:
        raise FileNotFoundError(f"nenhuma lista .m3u/.m3u8 em {pasta}")
    todos: list[Canal] = []
    for arquivo in arquivos:
        lidos = ler_playlist(arquivo)
        print(f"INFO: {arquivo.name}: {len(lidos)} canais")
        todos.extend(lidos)
    return todos


# ------------------------------------------------------------------ teste


class LimitePorServidor:
    """Segura quantas conexoes simultaneas cada servidor recebe.

    Provedor Xtream derruba quem abre dezenas de conexoes de uma vez, e o teste
    marcaria como morto um canal que na verdade funciona.
    """

    def __init__(self, limite: int) -> None:
        self._limite = limite
        self._trava = threading.Lock()
        self._por_host: dict[str, threading.Semaphore] = {}

    def para(self, url: str) -> threading.Semaphore:
        host = urlsplit(url).netloc
        with self._trava:
            if host not in self._por_host:
                self._por_host[host] = threading.Semaphore(self._limite)
            return self._por_host[host]


def testar_url(url: str, limites: LimitePorServidor) -> tuple[bool, str]:
    """(vivo, motivo). Vivo tambem quando o erro nao prova que o canal morreu."""
    with limites.para(url):
        pedido = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "*/*"})
        try:
            with urllib.request.urlopen(pedido, timeout=TIMEOUT) as resposta:
                if resposta.status >= 400:
                    return False, f"http {resposta.status}"
                # read1 devolve o primeiro pedaco que chegar. Com read() comum o
                # teste ficava preso: canal ao vivo entrega o video devagar, e
                # cada byte novo reiniciava o timeout, entao a leitura de 2 KB
                # nunca terminava e a fila inteira parava naquela URL.
                corpo = resposta.read1(2048)
                if not corpo:
                    return False, "resposta vazia"
                return True, "ok"
        except urllib.error.HTTPError as erro:
            return False, f"http {erro.code}"
        except urllib.error.URLError as erro:
            motivo = str(getattr(erro, "reason", erro))
            if "getaddrinfo" in motivo or "Name or service" in motivo:
                return False, "servidor nao existe mais"
            if "refused" in motivo.lower():
                return False, "conexao recusada"
            return True, f"sem resposta ({motivo[:40]})"
        except (TimeoutError, OSError) as erro:
            return True, f"sem resposta ({type(erro).__name__})"


def _rodar(urls: list[str], limites: LimitePorServidor, trabalhadores: int,
           rotulo: str) -> dict[str, tuple[bool, str]]:
    resultado: dict[str, tuple[bool, str]] = {}
    total = len(urls)

    def tarefa(url: str) -> tuple[str, tuple[bool, str]]:
        return url, testar_url(url, limites)

    # as_completed em vez de map: o map entrega em ordem, entao uma unica URL
    # lenta na frente segura o resultado de todas as outras.
    with ThreadPoolExecutor(max_workers=trabalhadores) as pool:
        pendentes = [pool.submit(tarefa, url) for url in urls]
        for concluida in as_completed(pendentes):
            url, veredito = concluida.result()
            resultado[url] = veredito
            feitos = len(resultado)
            if feitos % 100 == 0 or feitos == total:
                vivos = sum(1 for v, _ in resultado.values() if v)
                print(f"INFO: {rotulo} {feitos}/{total} (vivos {vivos})", flush=True)
    return resultado


def testar_lote(urls: list[str], trabalhadores: int) -> dict[str, tuple[bool, str]]:
    """Sonda servidor por servidor antes de testar canal por canal.

    Metade das listas do PC aponta para provedor que saiu do ar, e cada URL
    dele custa o timeout inteiro: sao horas de espera para um veredito que a
    primeira meia duzia de tentativas ja tinha dado. Entao primeiro se pergunta
    "esse servidor ainda existe?"; so quem responde tem os canais testados um a
    um. Servidor mudo derruba tudo que e dele.
    """
    limites = LimitePorServidor(CONEXOES_POR_SERVIDOR)

    por_host: defaultdict[str, list[str]] = defaultdict(list)
    for url in urls:
        por_host[urlsplit(url).netloc].append(url)

    amostra = [u for lista in por_host.values() for u in lista[:AMOSTRA_POR_SERVIDOR]]
    print(f"INFO: sondando {len(por_host)} servidores ({len(amostra)} testes)...", flush=True)
    resultado = _rodar(amostra, limites, trabalhadores, "sondagem")

    vivos_por_host = {
        host: any(resultado[u][0] for u in lista[:AMOSTRA_POR_SERVIDOR])
        for host, lista in por_host.items()
    }
    mudos = [h for h, vivo in vivos_por_host.items() if not vivo]
    for host in mudos:
        quantos = len(por_host[host])
        print(f"INFO: {host} nao respondeu nenhuma vez, {quantos} canais fora")
        for url in por_host[host]:
            resultado[url] = (False, f"servidor {host} fora do ar")

    restantes = [
        u
        for host, lista in por_host.items()
        if vivos_por_host[host]
        for u in lista
        if u not in resultado
    ]
    if restantes:
        resultado.update(_rodar(restantes, limites, trabalhadores, "testados"))
    return resultado


# ------------------------------------------------------------------ saida


def carregar_atuais(caminho: Path) -> list[dict]:
    if not caminho.exists():
        return []
    return json.loads(caminho.read_text(encoding="utf-8"))


def main() -> int:
    parser = argparse.ArgumentParser(description="Importa as listas do PC para o app da vovo")
    parser.add_argument("--fonte", type=Path, default=FONTE_PADRAO, help="pasta com as listas M3U")
    parser.add_argument("--saida", type=Path, default=SAIDA_PADRAO, help="JSON de canais do app")
    parser.add_argument("--sem-teste", action="store_true", help="nao testa o sinal dos canais novos")
    parser.add_argument("--trabalhadores", type=int, default=24, help="testes em paralelo")
    args = parser.parse_args()

    atuais = carregar_atuais(args.saida)
    urls_atuais = {c["url"] for c in atuais}
    print(f"INFO: app hoje tem {len(atuais)} canais")

    lidos = ler_pasta(args.fonte)
    novos: dict[str, Canal] = {}
    for canal in lidos:
        if canal.url in urls_atuais or canal.url in novos:
            continue
        novos[canal.url] = canal
    print(f"INFO: {len(lidos)} linhas lidas, {len(novos)} canais novos (sem repetir URL)")

    if not novos:
        print("NO_DATA: nada novo para importar")
        return 2

    descartados: Counter[str] = Counter()
    if args.sem_teste:
        aprovados = list(novos.values())
    else:
        print(f"INFO: testando o sinal de {len(novos)} canais novos...")
        veredito = testar_lote(list(novos), args.trabalhadores)
        aprovados = []
        for url, canal in novos.items():
            vivo, motivo = veredito[url]
            if vivo:
                aprovados.append(canal)
            else:
                descartados[motivo] += 1
        for motivo, quantos in descartados.most_common():
            print(f"INFO: descartados {quantos} por {motivo}")

    if not aprovados:
        print("NO_DATA: nenhum canal novo respondeu")
        return 2

    saida = atuais + [c.como_json() for c in aprovados]
    args.saida.write_text(
        json.dumps(saida, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )

    por_grupo: defaultdict[str, int] = defaultdict(int)
    for canal in aprovados:
        por_grupo[canal.grupo] += 1
    print("OK: novos por categoria: " + ", ".join(
        f"{g}={n}" for g, n in sorted(por_grupo.items(), key=lambda x: -x[1])
    ))
    print(f"OK: {args.saida.name} agora tem {len(saida)} canais (+{len(aprovados)})")
    return 0


if __name__ == "__main__":
    try:
        codigo = main()
    except (OSError, ValueError, json.JSONDecodeError) as erro:
        print(f"ERRO: {erro}", file=sys.stderr)
        traceback.print_exc()
        codigo = 1
    print(f"RETCODE: {codigo}")
    sys.exit(codigo)
