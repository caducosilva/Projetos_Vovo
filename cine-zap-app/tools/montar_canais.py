"""
Monta a lista de canais do Cine Zap com varias fontes por canal.

O app troca de fonte sozinho quando a que esta tocando falha, entao aqui o
objetivo e simples: juntar o maximo de URLs do MESMO canal, testar todas de
verdade e gravar so as que responderam, da mais rapida para a mais lenta.

Uso:
    python tools/montar_canais.py            # usa cache de ate 6h
    python tools/montar_canais.py --recarregar
"""

from __future__ import annotations

import argparse
import json
import re
import sys
import time
import unicodedata
from collections import Counter
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from urllib.parse import urljoin

import requests

# console do Windows e cp1252: sem isto um nome de canal com simbolo
# derruba o script no meio do relatorio
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

RAIZ = Path(__file__).resolve().parent.parent
SAIDA = RAIZ / "src" / "data" / "default_channels.json"
CACHE = Path.home() / ".cache" / "cine-zap"
CACHE.mkdir(parents=True, exist_ok=True)

VALIDADE_CACHE_S = 6 * 60 * 60
UA = "Mozilla/5.0 (Linux; Android 12; TV) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36"

# Rota atual do Pluto. A antiga (/v1/stitch/embed/...) foi desligada e hoje
# responde 200 servindo um cartao de "nao disponivel neste aparelho" no lugar do
# canal, o que engana qualquer teste que so olhe o codigo HTTP.
#
# A rota nova quer um passe de sessao anonimo, que vale um dia. Como ele vence,
# a lista guarda a marca e quem troca pelo passe do momento e src/utils/pluto.ts.
MARCA_JWT = "__PLUTO_JWT__"
PLUTO_CAMINHO = "/api/tn/video/playout/v2/stitch/hls/channel/{id}/master.m3u8?includeExtendedEvents=true&jwt="

PLUTO_HOSTS = [
    "https://ipv4.pluto.tv",
    "https://pluto.tv",
    "https://www.pluto.tv",
]

BOOT_PLUTO = (
    "https://boot.pluto.tv/v4/start?appName=web&appVersion=8.0.0&deviceVersion=151.0.0"
    "&deviceModel=web&deviceMake=chrome&deviceType=web&clientModelNumber=1.0.0"
    "&serverSideAds=false&clientID="
)

# Segmento que o Pluto serve quando recusa o pedido: e video de verdade, com
# bytes e tudo, mas o que aparece na tela e um aviso.
MARCAS_DE_BLOQUEIO = ("takedownslate", "ptv_takedownslates", "/slates/")

# Listas publicas extras. Cada uma so acrescenta fontes a canais que ja existem
# ou canais novos em portugues.
M3US = {
    "iptvorg_br": "https://raw.githubusercontent.com/iptv-org/iptv/master/streams/br.m3u",
    "iptvorg_pt": "https://raw.githubusercontent.com/iptv-org/iptv/master/streams/pt.m3u",
    "iptvorg_br_samsung": "https://raw.githubusercontent.com/iptv-org/iptv/master/streams/br_samsung.m3u",
    "iptvorg_pt_samsung": "https://raw.githubusercontent.com/iptv-org/iptv/master/streams/pt_samsung.m3u",
    "freetv": "https://raw.githubusercontent.com/Free-TV/IPTV/master/playlist.m3u8",
    "freetv_br": "https://raw.githubusercontent.com/Free-TV/IPTV/master/playlists/playlist_brazil.m3u8",
    "freetv_pt": "https://raw.githubusercontent.com/Free-TV/IPTV/master/playlists/playlist_portugal.m3u8",
    "m3upt": "https://raw.githubusercontent.com/LITUATUI/M3UPT/main/M3U/M3UPT.m3u",
}

# Listas cheias de webcam, radio e episodio avulso: nao criam canal novo, so
# emprestam URL para canal que ja existe na grade.
SO_REFORCO = {"m3upt"}

API_IPTVORG = {
    "streams": "https://iptv-org.github.io/api/streams.json",
    "channels": "https://iptv-org.github.io/api/channels.json",
    "logos": "https://iptv-org.github.io/api/logos.json",
    "feeds": "https://iptv-org.github.io/api/feeds.json",
}

CATEGORIA_PT = {
    "movies": "Filmes",
    "series": "Séries",
    "animation": "Animação",
    "kids": "Infantil",
    "news": "Notícias",
    "sports": "Esportes",
    "music": "Música",
    "documentary": "Documentários",
    "entertainment": "Variedades",
    "general": "Abertos",
    "comedy": "Comédia",
    "culture": "Cultura",
    "education": "Educação",
    "lifestyle": "Estilo de Vida",
    "science": "Curiosidades",
    "travel": "Viagem",
    "outdoor": "Natureza",
    "family": "Família",
    "classic": "Retrô",
    "religious": "Religioso",
    "shop": "Compras",
    "legislative": "Institucional",
    "business": "Negócios",
    "weather": "Tempo",
    "auto": "Automóvel",
    "cooking": "Culinária",
}

# Escrita oficial de cada grupo, procurada pelo nome sem acento e em minusculas.
GRUPOS_CANONICOS = {
    "filmes": "Filmes",
    "series": "Séries",
    "animacao": "Animação",
    "anime": "Anime",
    "infantil": "Infantil",
    "noticias": "Notícias",
    "esportes": "Esportes",
    "musica": "Música",
    "documentarios": "Documentários",
    "variedades": "Variedades",
    "abertos": "Abertos",
    "comedia": "Comédia",
    "cultura": "Cultura",
    "educacao": "Educação",
    "estilo de vida": "Estilo de Vida",
    "curiosidades": "Curiosidades",
    "viagem": "Viagem",
    "natureza": "Natureza",
    "familia": "Família",
    "retro": "Retrô",
    "religioso": "Religioso",
    "negocios": "Negócios",
    "tempo": "Tempo",
    "automovel": "Automóvel",
    "culinaria": "Culinária",
    "novelas": "Novelas",
    "reality": "Reality",
    "investigacao": "Investigação",
    "misterios e sobrenatural": "Mistérios e Sobrenatural",
    "jornada nas estrelas": "Jornada nas Estrelas",
    "south park": "South Park",
    "nickelodeon": "Nickelodeon",
    "mtv": "MTV",
    "tv brasileira": "Abertos",
    "tv": "Variedades",
    "portugal": "Portugal",
    "radios": "Rádios",
}

# Onde se fala portugues: canal daqui entra pelo pais, sem precisar olhar idioma.
PAISES_LUSOFONOS = {"BR", "PT", "AO", "MZ", "CV", "GW", "ST", "TL"}

# Grupos que nao entram na TV da vovo.
GRUPOS_BANIDOS = {"Compras", "Institucional", "XXX", "Adulto"}


def canonizar_grupo(nome: str) -> str:
    """Um nome so por grupo. Sem isto a grade mostra 'Series' e 'Séries'
    separados, cada um com metade dos canais."""
    chave = unicodedata.normalize("NFKD", (nome or "").strip().lower())
    chave = "".join(c for c in chave if not unicodedata.combining(c))
    return GRUPOS_CANONICOS.get(chave, (nome or "").strip() or "Variedades")


def log(msg: str) -> None:
    print(msg, flush=True)


def baixar(nome: str, url: str, recarregar: bool) -> str:
    destino = CACHE / nome
    if not recarregar and destino.exists():
        if time.time() - destino.stat().st_mtime < VALIDADE_CACHE_S:
            return destino.read_text(encoding="utf-8", errors="replace")
    r = requests.get(url, timeout=120, headers={"User-Agent": UA})
    r.raise_for_status()
    # r.text erra o charset em lista sem header; estas fontes sao todas utf-8
    texto = r.content.decode("utf-8", errors="replace")
    destino.write_text(texto, encoding="utf-8")
    return texto


def normalizar(nome: str) -> str:
    """Chave de agrupamento: 'Record News HD' e 'record  news' viram a mesma coisa."""
    txt = unicodedata.normalize("NFKD", nome or "")
    txt = "".join(c for c in txt if not unicodedata.combining(c)).lower()
    txt = re.sub(r"\[[^\]]*\]|\([^)]*\)", " ", txt)
    txt = re.sub(
        r"\b(hd|fhd|sd|uhd|4k|h265|h264|full ?hd|alternativo|backup|br|brasil|pt|portugal)\b",
        " ",
        txt,
    )
    txt = re.sub(r"[^a-z0-9]+", " ", txt)
    return re.sub(r"\s+", " ", txt).strip()


def limpar_titulo(nome: str) -> str:
    txt = re.sub(r"\[[^\]]*\]", "", nome or "").strip()
    return re.sub(r"\s+", " ", txt)


# --------------------------------------------------------------------------
# Coleta
# --------------------------------------------------------------------------


def ler_m3u(texto: str) -> list[dict]:
    """Devolve [{name, logo, group, url}] de uma playlist M3U."""
    itens: list[dict] = []
    atual: dict | None = None
    for linha in texto.splitlines():
        linha = linha.strip()
        if linha.startswith("#EXTINF"):
            nome = linha.split(",", 1)[1].strip() if "," in linha else ""
            logo = re.search(r'tvg-logo="([^"]*)"', linha)
            grupo = re.search(r'group-title="([^"]*)"', linha)
            atual = {
                "name": nome,
                "logo": logo.group(1) if logo else "",
                "group": grupo.group(1) if grupo else "",
            }
        elif linha.startswith("#EXTVLCOPT") or linha.startswith("#KODIPROP"):
            # stream que precisa de user-agent/referer proprio nao toca no WebView
            if atual is not None:
                atual["exige_header"] = True
        elif linha and not linha.startswith("#"):
            if atual is not None:
                atual["url"] = linha
                itens.append(atual)
                atual = None
    return itens


def coletar_pluto(recarregar: bool) -> list[dict]:
    """Canais do Pluto TV Brasil direto da API oficial, sem passar por encurtador."""
    boot = json.loads(
        baixar(
            "pluto_boot.json",
            "https://boot.pluto.tv/v4/start?appName=web&appVersion=8.0.0"
            "&deviceVersion=120.0.0&deviceModel=web&deviceMake=chrome&deviceType=web"
            "&clientID=00000000-0000-0000-0000-000000000000&clientModelNumber=1.0.0"
            "&serverSideAds=false",
            recarregar,
        )
    )
    token = boot["sessionToken"]
    regiao = boot.get("session", {}).get("activeRegion")
    log("  Pluto: regiao ativa = " + str(regiao))

    def api(nome: str, url: str) -> dict:
        destino = CACHE / nome
        if not recarregar and destino.exists():
            if time.time() - destino.stat().st_mtime < VALIDADE_CACHE_S:
                return json.loads(destino.read_text(encoding="utf-8"))
        r = requests.get(
            url, timeout=120, headers={"Authorization": "Bearer " + token, "User-Agent": UA}
        )
        r.raise_for_status()
        texto = r.content.decode("utf-8", errors="replace")
        destino.write_text(texto, encoding="utf-8")
        return json.loads(texto)

    guia = api(
        "pluto_guide.json",
        "https://service-channels.clusters.pluto.tv/v2/guide/channels?offset=0&limit=1000&sort=number:asc",
    )["data"]
    cats = api(
        "pluto_cats.json", "https://service-channels.clusters.pluto.tv/v2/guide/categories"
    )["data"]

    grupo_por_id: dict[str, str] = {}
    for cat in cats:
        nome = limpar_titulo(cat.get("name") or "")
        for cid in cat.get("channelIDs", []):
            grupo_por_id.setdefault(cid, nome)

    saida = []
    for canal in guia:
        cid = canal["id"]
        logo = ""
        for tipo in ("colorLogoPNG", "solidLogoPNG", "logo"):
            achou = next(
                (i["url"] for i in canal.get("images", []) if i.get("type") == tipo), None
            )
            if achou:
                logo = achou
                break
        urls = [host + PLUTO_CAMINHO.format(id=cid) + MARCA_JWT for host in PLUTO_HOSTS]
        saida.append(
            {
                "id": "PlutoTV" + cid + ".br",
                "name": limpar_titulo(canal["name"]),
                "logo": logo,
                "group": grupo_por_id.get(cid, "Variedades"),
                "origem": "pluto",
                "urls": urls,
            }
        )
    return saida


def coletar_iptvorg(recarregar: bool) -> list[dict]:
    """Canais em portugues com TODAS as URLs que o iptv-org conhece de cada um."""
    streams = json.loads(baixar("iptvorg_streams.json", API_IPTVORG["streams"], recarregar))
    canais = json.loads(baixar("iptvorg_channels.json", API_IPTVORG["channels"], recarregar))
    logos = json.loads(baixar("iptvorg_logos.json", API_IPTVORG["logos"], recarregar))
    feeds = json.loads(baixar("iptvorg_feeds.json", API_IPTVORG["feeds"], recarregar))

    # Muito canal falado em portugues esta catalogado com pais US ou UK (AMC,
    # AXN, Bob Esponja...). Mas o mesmo canal costuma ter um sinal por idioma, e
    # o que interessa e o SINAL em portugues: sem isso entrava o Angel TV em
    # ingles e o Disney Latin America em espanhol. Por isso a chave e
    # (canal, sinal), nao so o canal.
    sinais_em_portugues = {
        (f["channel"], f.get("id")) for f in feeds if "por" in (f.get("languages") or [])
    }

    por_id = {c["id"]: c for c in canais}
    logo_por_id: dict[str, str] = {}
    for lg in logos:
        cid = lg.get("channel")
        if cid and cid not in logo_por_id:
            logo_por_id[cid] = lg.get("url") or ""

    agrupado: dict[str, dict] = {}
    for s in streams:
        cid = s.get("channel")
        if not cid:
            continue
        canal = por_id.get(cid)
        if not canal:
            continue
        if canal.get("country") not in PAISES_LUSOFONOS:
            if (cid, s.get("feed")) not in sinais_em_portugues:
                continue
        if canal.get("is_nsfw") or canal.get("closed"):
            continue
        # stream que so toca com user-agent/referer proprio nao funciona no WebView
        if s.get("user_agent") or s.get("referrer"):
            continue
        cats = [CATEGORIA_PT.get(c, "") for c in canal.get("categories", [])]
        grupo = next((c for c in cats if c), "Variedades")
        item = agrupado.setdefault(
            cid,
            {
                "id": cid,
                "name": limpar_titulo(canal["name"]),
                "logo": logo_por_id.get(cid, ""),
                "group": grupo,
                "origem": "abertos",
                "urls": [],
            },
        )
        item["urls"].append(s["url"])
    return list(agrupado.values())


def coletar_listas(recarregar: bool) -> list[dict]:
    """Playlists publicas: entram como fontes extras dos canais em portugues."""
    saida: list[dict] = []
    for nome, url in M3US.items():
        try:
            texto = baixar("list_" + nome + ".m3u", url, recarregar)
        except Exception as erro:  # lista fora do ar nao pode derrubar o resto
            log("  aviso: " + nome + " falhou (" + str(erro) + ")")
            continue
        itens = ler_m3u(texto)
        aceitos = 0
        for it in itens:
            if it.get("exige_header") or not it.get("url"):
                continue
            grupo = it.get("group", "")
            if nome == "freetv" and not re.search(r"brazil|brasil|portugal", grupo, re.I):
                continue
            saida.append(
                {
                    "id": nome + ":" + normalizar(it["name"]),
                    "name": limpar_titulo(it["name"]),
                    "logo": it.get("logo", ""),
                    "group": grupo or "Variedades",
                    "origem": "abertos",
                    "urls": [it["url"]],
                    "so_reforco": nome in SO_REFORCO,
                }
            )
            aceitos += 1
        log("  " + nome + ": " + str(aceitos) + " entradas")
    return saida


# --------------------------------------------------------------------------
# Juncao
# --------------------------------------------------------------------------


def variantes(url: str) -> list[str]:
    """A mesma fonte servida no outro esquema. Muito servidor de IPTV daqui
    responde em http e https, e as vezes so um dos dois esta de pe."""
    saida = [url]
    if url.startswith("https://"):
        saida.append("http://" + url[len("https://") :])
    elif url.startswith("http://"):
        saida.append("https://" + url[len("http://") :])
    return saida


def juntar(*blocos: list[dict]) -> list[dict]:
    canais: dict[str, dict] = {}
    for bloco in blocos:
        for item in bloco:
            chave = normalizar(item["name"])
            if not chave:
                continue
            todas = [v for u in item["urls"] for v in variantes(u)]
            alvo = canais.get(chave)
            if alvo is None:
                if item.get("so_reforco"):
                    continue
                canais[chave] = dict(item, urls=list(dict.fromkeys(todas)))
                continue
            for u in todas:
                if u not in alvo["urls"]:
                    alvo["urls"].append(u)
            if not alvo.get("logo") and item.get("logo"):
                alvo["logo"] = item["logo"]
            if alvo.get("group") in ("", "Variedades") and item.get("group"):
                alvo["group"] = item["group"]
    return list(canais.values())


# --------------------------------------------------------------------------
# Teste real de cada URL
# --------------------------------------------------------------------------

SESSAO = requests.Session()
SESSAO.headers.update({"User-Agent": UA, "Accept": "*/*", "Referer": "https://pluto.tv/"})

_passe_pluto = ""


def passe_pluto() -> str:
    """Passe anonimo de sessao, so para conseguir testar as fontes do Pluto."""
    global _passe_pluto
    if not _passe_pluto:
        import uuid

        r = SESSAO.get(BOOT_PLUTO + str(uuid.uuid4()), timeout=60)
        r.raise_for_status()
        _passe_pluto = r.json()["sessionToken"]
    return _passe_pluto


def para_testar(url: str) -> str:
    return url.replace(MARCA_JWT, passe_pluto()) if MARCA_JWT in url else url


def sem_bloqueio(playlist: str, base: str) -> bool:
    """Abre a primeira variante e confere que nao e o cartao de bloqueio."""
    if any(m in playlist for m in MARCAS_DE_BLOQUEIO):
        return False
    if "#EXT-X-STREAM-INF" not in playlist:
        return True  # ja e a lista de pedacos, e ela nao tem marca de bloqueio
    linhas = [ln.strip() for ln in playlist.splitlines() if ln.strip() and not ln.startswith("#")]
    if not linhas:
        return False
    try:
        v = SESSAO.get(urljoin(base, linhas[0]), timeout=(6, 10))
    except Exception:
        return False
    if v.status_code != 200:
        return False
    return not any(m in v.text for m in MARCAS_DE_BLOQUEIO)


def testar(url: str) -> tuple[str, float | None]:
    """Devolve (url, latencia) se o manifesto respondeu de verdade, senao (url, None)."""
    inicio = time.time()
    alvo = para_testar(url)
    try:
        r = SESSAO.get(alvo, timeout=(6, 10), stream=True, allow_redirects=True)
        if r.status_code != 200:
            r.close()
            return url, None
        corpo = next(r.iter_content(8192), b"") or b""
        tipo = (r.headers.get("Content-Type") or "").lower()
        url_final = r.url
        r.close()
    except Exception:
        return url, None
    latencia = (time.time() - inicio) * 1000
    texto = corpo.decode("utf-8", errors="ignore")
    if "#EXTM3U" in texto:
        # manifesto sem variante e sem segmento nao toca
        if not ("#EXT-X-STREAM-INF" in texto or "#EXTINF" in texto):
            return url, None
        if not sem_bloqueio(texto, url_final):
            return url, None
        return url, latencia
    if corpo[:1] == b"\x47" or "mpegurl" in tipo or "video/" in tipo:
        return url, latencia
    return url, None


def validar(canais: list[dict], trabalhadores: int) -> dict[str, float]:
    todas = sorted({u for c in canais for u in c["urls"]})
    log("testando " + str(len(todas)) + " URLs com " + str(trabalhadores) + " conexoes...")
    vivas: dict[str, float] = {}
    feitos = 0
    with ThreadPoolExecutor(max_workers=trabalhadores) as pool:
        for url, latencia in pool.map(testar, todas):
            feitos += 1
            if latencia is not None:
                vivas[url] = latencia
            if feitos % 250 == 0:
                log("  " + str(feitos) + "/" + str(len(todas)) + " testadas, " + str(len(vivas)) + " vivas")
    log("  " + str(feitos) + "/" + str(len(todas)) + " testadas, " + str(len(vivas)) + " vivas")
    return vivas


# --------------------------------------------------------------------------


def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument("--recarregar", action="store_true", help="ignora o cache das listas")
    p.add_argument("--trabalhadores", type=int, default=48)
    p.add_argument("--max-fontes", type=int, default=12)
    p.add_argument("--sem-teste", action="store_true", help="grava sem testar (nao recomendado)")
    args = p.parse_args()

    log("coletando Pluto TV Brasil...")
    pluto = coletar_pluto(args.recarregar)
    log("  " + str(len(pluto)) + " canais")

    log("coletando iptv-org (BR + PT)...")
    iptvorg = coletar_iptvorg(args.recarregar)
    log("  " + str(len(iptvorg)) + " canais, " + str(sum(len(c["urls"]) for c in iptvorg)) + " fontes")

    log("coletando listas publicas...")
    listas = coletar_listas(args.recarregar)

    canais = juntar(pluto, iptvorg, listas)
    for c in canais:
        c["group"] = canonizar_grupo(c.get("group", ""))
    canais = [c for c in canais if c["group"] not in GRUPOS_BANIDOS]
    log("total juntado: " + str(len(canais)) + " canais, " + str(sum(len(c["urls"]) for c in canais)) + " fontes")

    if args.sem_teste:
        vivas = {u: 0.0 for c in canais for u in c["urls"]}
    else:
        vivas = validar(canais, args.trabalhadores)

    saida = []
    for c in canais:
        boas = sorted((u for u in c["urls"] if u in vivas), key=lambda u: vivas[u])
        boas = boas[: args.max_fontes]
        if not boas:
            continue
        saida.append(
            {
                "id": c["id"],
                "name": c["name"],
                "url": boas[0],
                "sources": boas,
                "logo": c.get("logo", ""),
                "group": c.get("group") or "Variedades",
                "country": "br",
                "origem": c.get("origem", "abertos"),
            }
        )

    saida.sort(key=lambda c: (c["group"], c["name"].lower()))
    SAIDA.write_text(json.dumps(saida, ensure_ascii=False, indent=2), encoding="utf-8")

    total_fontes = sum(len(c["sources"]) for c in saida)
    media = total_fontes / max(len(saida), 1)
    log("")
    log("gravado " + str(SAIDA))
    log("  " + str(len(saida)) + " canais no ar, " + str(total_fontes) + " fontes (" + format(media, ".1f") + " por canal)")
    for grupo, n in Counter(c["group"] for c in saida).most_common():
        log("  " + str(n).rjust(4) + "  " + grupo)
    return 0


if __name__ == "__main__":
    sys.exit(main())
