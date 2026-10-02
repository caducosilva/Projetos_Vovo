#!/usr/bin/env python3
"""Deixa o app da vovo com EXATAMENTE os canais do painel do PC, na mesma ordem.

Diferenca para o importar_canais_pc.py, que so acrescentava canais novos: aqui
a lista e refeita do zero, igual a do PC. O painel do PC passou a mostrar um
canal por nome, com as varias URLs daquele canal guardadas como fontes de
reserva; quando uma para, o app cai sozinho para a proxima. Este script gera a
lista nesse mesmo formato:

    { "name": "Globo Sao Paulo", "url": <melhor fonte>, "sources": [...todas] }

Ordem gravada (o app respeita a ordem do arquivo):
    1. canais abertos, de A a Z
    2. canais do Pluto TV, de A a Z

Tres cuidados que nao sao obvios:

1. O agrupamento e por nome normalizado, ignorando marcador de qualidade
   (HD, FHD, 4K, H265, ALT2). "GLOBO SP FHD" e "Globo SP" sao o mesmo canal;
   "Globo SP" e "Globo RJ" nao sao.
2. O WebView do Android nao toca MPEG-TS puro nem stream UDP, mesmo o servidor
   respondendo 200. Essas fontes sao descartadas aqui, senao virariam canal
   preto na mao da vovo.
3. Cada fonte e testada de verdade antes de entrar; o teste sonda o servidor
   antes de gastar timeout canal por canal (reaproveitado do importador).

Uso:
    python tools/sincronizar_com_pc.py
    python tools/sincronizar_com_pc.py --fonte D:/IPTV --sem-teste

Codigos de saida: 0 = gravou, 2 = nada para gravar, 1 = erro.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
import traceback
from collections import defaultdict
from pathlib import Path
from urllib.parse import urlsplit

sys.path.insert(0, str(Path(__file__).resolve().parent))

from importar_canais_pc import (  # noqa: E402
    FONTE_PADRAO,
    SAIDA_PADRAO,
    atributo,
    categoria_de,
    preparar_url,
    sem_acento,
    testar_lote,
)

# Marcadores de qualidade/variacao: dizem COMO a fonte e, nao QUAL canal e.
TOKENS_QUALIDADE = {
    "hd", "sd", "hq", "fhd", "uhd", "qhd", "fullhd", "full",
    "2k", "4k", "8k", "h264", "h265", "x264", "x265", "hevc", "avc",
    "alternativo", "backup", "bkp", "mirror",
}
PADRAO_QUALIDADE = re.compile(
    r"^(?:alt|opc|opcao|op|fonte|link|srv|serv|servidor|server)\d*$"
    r"|^\d+fps$"
    r"|^(?:360|480|720|1080|2160)[pi]?$"
)


def eh_token_qualidade(token: str) -> bool:
    return token in TOKENS_QUALIDADE or bool(PADRAO_QUALIDADE.match(token))


def tokens(nome: str) -> list[str]:
    return [t for t in re.split(r"[^a-z0-9]+", sem_acento(nome)) if t]


def chave_do_canal(nome: str) -> str:
    """Nome sem acento, sem pontuacao e sem marcador de qualidade."""
    brutos = tokens(nome)
    uteis = [t for t in brutos if not eh_token_qualidade(t)]
    return " ".join(uteis or brutos)


def nome_de_exibicao(nome: str) -> str:
    """O nome original, so sem os marcadores de qualidade."""
    partes = []
    for parte in (nome or "").split():
        norm = tokens(parte)
        if not norm:  # simbolo solto, tipo o HD sobrescrito
            continue
        if all(eh_token_qualidade(t) for t in norm):
            continue
        partes.append(parte)
    return " ".join(partes).strip(" -|,") or (nome or "").strip()


def tocavel_no_webview(url: str) -> bool:
    """MPEG-TS puro e UDP nao abrem no WebView; nem adianta guardar de reserva."""
    caminho = urlsplit(url).path.lower()
    if "/udp/" in caminho or "/rtp/" in caminho:
        return False
    return not caminho.endswith((".ts", ".mpd"))


class Fonte:
    __slots__ = ("nome", "url", "logo", "grupo", "tvg", "lista")

    def __init__(self, nome: str, url: str, logo: str, grupo: str, tvg: str, lista: str) -> None:
        self.nome = nome
        self.url = url
        self.logo = logo
        self.grupo = grupo
        self.tvg = tvg
        self.lista = lista


def ler_playlist(arquivo: Path) -> list[Fonte]:
    fontes: list[Fonte] = []
    info = ""
    for linha in arquivo.read_text(encoding="utf-8", errors="replace").splitlines():
        limpa = linha.strip()
        if limpa.startswith("#EXTINF"):
            info = limpa
        elif limpa and not limpa.startswith("#") and info:
            nome = info.split(",", 1)[-1].strip() or atributo(info, "tvg-name")
            fontes.append(
                Fonte(
                    nome=nome,
                    url=preparar_url(limpa),
                    logo=atributo(info, "tvg-logo"),
                    grupo=atributo(info, "group-title"),
                    tvg=atributo(info, "tvg-id"),
                    lista=arquivo.stem,
                )
            )
            info = ""
    return fontes


def ler_pasta(pasta: Path) -> list[Fonte]:
    # camera*.m3u fica de fora: as cameras entram sozinhas pelo utils/cameras.ts
    arquivos = [
        p
        for p in sorted(pasta.glob("*.m3u")) + sorted(pasta.glob("*.m3u8"))
        if not p.stem.lower().startswith("camera")
    ]
    if not arquivos:
        raise FileNotFoundError(f"nenhuma lista .m3u/.m3u8 em {pasta}")
    todas: list[Fonte] = []
    for arquivo in arquivos:
        lidas = ler_playlist(arquivo)
        print(f"INFO: {arquivo.name}: {len(lidas)} linhas")
        todas.extend(lidas)
    return todas


def main() -> int:
    parser = argparse.ArgumentParser(description="Espelha no app da vovo a lista do painel do PC")
    parser.add_argument("--fonte", type=Path, default=FONTE_PADRAO, help="pasta com as listas M3U")
    parser.add_argument("--saida", type=Path, default=SAIDA_PADRAO, help="JSON de canais do app")
    parser.add_argument("--sem-teste", action="store_true", help="grava sem testar o sinal")
    parser.add_argument(
        "--somente",
        choices=("tudo", "abertos", "pluto"),
        default="tudo",
        help="abertos = so emissora aberta (app da vovo); pluto = so 24h (app de filmes)",
    )
    parser.add_argument("--trabalhadores", type=int, default=24, help="testes em paralelo")
    args = parser.parse_args()

    fontes = ler_pasta(args.fonte)

    vistas: set[str] = set()
    aproveitadas: list[Fonte] = []
    descartadas_formato = 0
    for f in fontes:
        if f.url in vistas:
            continue
        vistas.add(f.url)
        if not tocavel_no_webview(f.url):
            descartadas_formato += 1
            continue
        aproveitadas.append(f)
    print(
        f"INFO: {len(fontes)} linhas, {len(aproveitadas)} fontes unicas "
        f"({descartadas_formato} descartadas por formato que o WebView nao toca)"
    )

    if args.sem_teste:
        vivas = aproveitadas
    else:
        print(f"INFO: testando o sinal de {len(aproveitadas)} fontes...", flush=True)
        veredito = testar_lote([f.url for f in aproveitadas], args.trabalhadores)
        vivas = [f for f in aproveitadas if veredito[f.url][0]]
        print(f"INFO: {len(vivas)} fontes responderam, {len(aproveitadas) - len(vivas)} fora")

    grupos: dict[str, list[Fonte]] = defaultdict(list)
    ordem: list[str] = []
    for f in vivas:
        chave = chave_do_canal(f.nome)
        if chave not in grupos:
            ordem.append(chave)
        grupos[chave].append(f)

    abertos: list[dict] = []
    pluto: list[dict] = []
    for chave in ordem:
        membros = grupos[chave]
        melhor = membros[0]
        so_pluto = all("pluto" in m.lista.lower() for m in membros)
        canal = {
            "id": melhor.tvg or re.sub(r"[^a-z0-9]+", "-", sem_acento(melhor.nome)).strip("-"),
            "name": nome_de_exibicao(melhor.nome),
            "url": melhor.url,
            "sources": [m.url for m in membros],
            "logo": next((m.logo for m in membros if m.logo), ""),
            "group": categoria_de(melhor.grupo, melhor.nome),
            "country": "br",
            "origem": "pluto" if so_pluto else "abertos",
        }
        (pluto if so_pluto else abertos).append(canal)

    chave_alfabetica = lambda c: sem_acento(c["name"])  # noqa: E731
    abertos.sort(key=chave_alfabetica)
    pluto.sort(key=chave_alfabetica)
    if args.somente == "abertos":
        saida = abertos
    elif args.somente == "pluto":
        saida = pluto
    else:
        saida = abertos + pluto

    if not saida:
        print("NO_DATA: nenhum canal sobrou para gravar")
        return 2

    args.saida.write_text(
        json.dumps(saida, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )

    com_reserva = sum(1 for c in saida if len(c["sources"]) > 1)
    total_fontes = sum(len(c["sources"]) for c in saida)
    print(
        f"OK: abertos={len(abertos)} pluto={len(pluto)} "
        f"gravados={len(saida)} (filtro: {args.somente})"
    )
    print(f"OK: {total_fontes} fontes no total, {com_reserva} canais com fonte de reserva")
    print(f"OK: gravado em {args.saida}")
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
