"""
Monta as duas listas da TV da Vovo, testando cada URL de verdade.

  src/data/canais_abertos.json  -> botao "TV Aberta" (Globo, Record, SBT...)
  src/data/cine_zap.json        -> botao "Cine Zap" (filmes, series, desenhos)

De onde vem:
  - as listas atuais dos dois apps antigos (nada que ja funcionava se perde)
  - iptv-org (API + playlists BR), Free-TV BR e a lista do PC
  - Pluto TV Brasil direto da API oficial (vira Cine Zap)

O teste nao confia em "respondeu 200": segue master -> variante -> pedaco e so
aprova quando chega byte de video na mao. As fontes boas ficam em ordem de
velocidade, e e nessa ordem que o player tenta.

Cada canal tambem ganha a chave `epg` (programacao ao vivo):
  "epgpw:<id>"  -> epg.pw, para os canais abertos
  "pluto:<id>"  -> guia do Pluto, para o Cine Zap

Uso:
    python tools/montar_listas.py              # cache de listas de ate 6h
    python tools/montar_listas.py --recarregar
"""

from __future__ import annotations

import argparse
import gzip
import json
import re
import sys
import threading
import time
import unicodedata
import uuid
from collections import Counter, defaultdict
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from urllib.parse import urljoin, urlsplit

import requests

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

RAIZ = Path(__file__).resolve().parent.parent
PROJETO = RAIZ.parent
SAIDA_ABERTOS = RAIZ / "src" / "data" / "canais_abertos.json"
SAIDA_CINE = RAIZ / "src" / "data" / "cine_zap.json"
RELATORIO = RAIZ / "tools" / "relatorio_teste.json"
CACHE = Path.home() / ".cache" / "tv-da-vovo"
CACHE.mkdir(parents=True, exist_ok=True)

VALIDADE_CACHE_S = 6 * 60 * 60
UA = "Mozilla/5.0 (Linux; Android 12; TV) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36"

LISTAS_ANTIGAS = [
    PROJETO / "vovo-tv-app" / "src" / "data" / "default_channels.json",
    PROJETO / "cine-zap-app" / "src" / "data" / "default_channels.json",
]
LISTAS_PC = [PROJETO / "painel-pc" / "lists" / "canais.m3u"]

M3US = {
    "iptvorg_br": "https://raw.githubusercontent.com/iptv-org/iptv/master/streams/br.m3u",
    "iptvorg_br_samsung": "https://raw.githubusercontent.com/iptv-org/iptv/master/streams/br_samsung.m3u",
    "freetv_br": "https://raw.githubusercontent.com/Free-TV/IPTV/master/playlists/playlist_brazil.m3u8",
}
# Canais gratuitos com anuncio das proprias fabricantes de TV (FAST). Sao
# servicos legais; a lista e mantida pelo apsattv.com.
FAST = {
    "lg_br": "https://www.apsattv.com/brlg.m3u",
    "tcl_br": "https://www.apsattv.com/tclbr.m3u",
}
# nome de FAST que e jornal ou TV aberta: vai para a TV Aberta, nao para o Cine
FAST_ABERTOS = re.compile(
    r"\b(jornal|news|noticias|notícias|cnn|bloomberg|jovem pan|band|sbt|record|metropoles|"
    r"veja|euronews|times brasil|aparecida|rede vida|canal rural|terraviva|uol|money|financas|finanças)\b",
    re.I,
)

API_IPTVORG = {
    "streams": "https://iptv-org.github.io/api/streams.json",
    "channels": "https://iptv-org.github.io/api/channels.json",
    "logos": "https://iptv-org.github.io/api/logos.json",
}
EPG_BR = "https://epg.pw/xmltv/epg_BR.xml.gz"
BOOT_PLUTO = (
    "https://boot.pluto.tv/v4/start?appName=web&appVersion=8.0.0&deviceVersion=151.0.0"
    "&deviceModel=web&deviceMake=chrome&deviceType=web&clientModelNumber=1.0.0"
    "&serverSideAds=false&clientID="
)
# Rota oficial do Pluto: pede o passe de sessao anonimo (vale 1 dia). A lista
# grava a marca e o app troca pelo passe do momento (src/utils/programacao.ts).
MARCA_JWT = "__PLUTO_JWT__"
PLUTO_OFICIAL = [
    "https://ipv4.pluto.tv/api/tn/video/playout/v2/stitch/hls/channel/{id}/master.m3u8?includeExtendedEvents=true&jwt=" + MARCA_JWT,
    "https://pluto.tv/api/tn/video/playout/v2/stitch/hls/channel/{id}/master.m3u8?includeExtendedEvents=true&jwt=" + MARCA_JWT,
]
# o que o Pluto serve quando recusa: video de verdade, mas so um aviso na tela
MARCAS_DE_BLOQUEIO = ("takedownslate", "ptv_takedownslates", "/slates/")

# As grandes aparecem com nomes diferentes em cada lista ("TV Globo Sao Paulo",
# "Globo São Paulo", "Rede Globo"...). Aqui viram UM canal so, com todas as
# fontes juntas, e com o nome curto que a vovo reconhece.
APELIDOS: dict[str, tuple[str, str]] = {
    # chave normalizada -> (id canonico, nome na tela)
    "globo sao paulo": ("Globo", "Globo"),
    "tv globo sao paulo": ("Globo", "Globo"),
    "tvglobosaopaulo": ("Globo", "Globo"),
    "rede globo": ("Globo", "Globo"),
    "redeglobo": ("Globo", "Globo"),
    "globo": ("Globo", "Globo"),
    "tv globo": ("Globo", "Globo"),
    "record": ("Record", "Record"),
    "record sao paulo": ("Record", "Record"),
    "record tv sp": ("Record", "Record"),
    "record tv sao paulo": ("Record", "Record"),
    "recordtvsaopaulo": ("Record", "Record"),
    "record tv": ("Record", "Record"),
    "sbt": ("SBT", "SBT"),
    "sbt sao paulo": ("SBT", "SBT"),
    "sbt nacional": ("SBT", "SBT"),
    "sbtnacional": ("SBT", "SBT"),
    "band": ("Band", "Band"),
    "band sao paulo": ("Band", "Band"),
    "redetv sao paulo": ("RedeTV", "RedeTV!"),
    "redetv": ("RedeTV", "RedeTV!"),
    "rede tv": ("RedeTV", "RedeTV!"),
    "tv cultura": ("TVCultura", "TV Cultura"),
    "tv gazeta": ("TVGazeta", "TV Gazeta"),
    "gazeta": ("TVGazeta", "TV Gazeta"),
    "tv brasil": ("TVBrasil", "TV Brasil"),
}

# Programacao: ids do epg.pw conferidos a mao para as que a vovo mais ve.
EPG_FIXO = {
    "Globo": "523353",
    "Record": "523282",
    "SBT": "523298",
    "Band": "523315",
    "TVGazeta": "523302",
    "TVCultura": "523305",
    "TVBrasil": "523339",
    "RedeTV": "523301",
    "RedeVida.br": "523337",
    "TVAparecida.br": "523345",
    "Futura.br": "523343",
    "CanalBrasil.br": "523319",
    "TVSenado.br": "523335",
    "JovemPanNews.br": "417187",
    "CNNBrasil.br": "570785",
}

# Servidores de provedor regional que carregam varios canais publicos com o
# mesmo padrao de caminho. Achados sondando os hosts que ja estavam nas listas;
# entram como fontes extras e passam pelo mesmo teste de todo mundo.
HOSTS_REGIONAIS = ["http://168.197.104.22", "http://45.162.64.114", "http://45.177.114.115", "http://170.83.16.50"]
EXTRAS_REGIONAIS = {
    "TVBrasil": ("TV Brasil", ["TV_BRASIL"]),
    "TVGazeta": ("TV Gazeta", ["TV_GAZETA", "GAZETA"]),
    "RedeVida.br": ("Rede Vida", ["REDE_VIDA"]),
    "CancaoNova.br": ("Canção Nova", ["CANCAO_NOVA"]),
    "TVAparecida.br": ("TV Aparecida", ["TV_APARECIDA"]),
    "CNNBrasil.br": ("CNN Brasil", ["CNN_BRASIL"]),
    "RecordNews.br": ("Record News", ["RECORD_NEWS"]),
}

CATEGORIA_PT = {
    "movies": "Filmes", "series": "Séries", "animation": "Desenhos", "kids": "Infantil",
    "news": "Notícias", "sports": "Esportes", "music": "Música", "documentary": "Documentários",
    "entertainment": "Variedades", "general": "Abertos", "comedy": "Comédia", "culture": "Cultura",
    "education": "Educação", "lifestyle": "Variedades", "religious": "Religioso",
    "family": "Família", "classic": "Retrô", "cooking": "Culinária", "travel": "Viagem",
    "outdoor": "Natureza", "science": "Curiosidades",
}
GRUPOS_CANONICOS = {
    "filmes": "Filmes", "series": "Séries", "animacao": "Desenhos", "desenhos": "Desenhos",
    "anime": "Desenhos", "infantil": "Infantil", "noticias": "Notícias", "esportes": "Esportes",
    "musica": "Música", "documentarios": "Documentários", "variedades": "Variedades",
    "abertos": "Abertos", "abertos sp": "Abertos", "comedia": "Comédia", "cultura": "Cultura",
    "educacao": "Educação", "religioso": "Religioso", "familia": "Família", "retro": "Retrô",
    "culinaria": "Culinária", "novelas": "Novelas", "reality": "Reality",
    "investigacao": "Investigação", "radios": "Rádios", "brazil": "Abertos",
    "publicos sp": "Educação", "estilo de vida": "Variedades",
}
# o que for destes grupos e "canal fechado" e vai para o Cine Zap
GRUPOS_CINE = {
    "Filmes", "Séries", "Desenhos", "Infantil", "Comédia", "Documentários", "Família",
    "Retrô", "Novelas", "Reality", "Investigação", "Culinária", "Viagem", "Natureza",
    "Curiosidades",
}
GRUPOS_BANIDOS = {"Compras", "Institucional", "XXX", "Adulto", "Rádios"}

# servidor de IPTV derruba quem abre conexao demais ao mesmo tempo, e ai o
# teste mentiria "morto"
CONEXOES_POR_SERVIDOR = 3

SESSAO = requests.Session()
SESSAO.headers.update({"User-Agent": UA, "Accept": "*/*"})
_travas: dict[str, threading.Semaphore] = defaultdict(lambda: threading.Semaphore(CONEXOES_POR_SERVIDOR))
_travas_lock = threading.Lock()


def log(msg: str) -> None:
    print(msg, flush=True)


def baixar(nome: str, url: str, recarregar: bool, binario: bool = False):
    destino = CACHE / nome
    if not recarregar and destino.exists() and time.time() - destino.stat().st_mtime < VALIDADE_CACHE_S:
        return destino.read_bytes() if binario else destino.read_text(encoding="utf-8", errors="replace")
    r = requests.get(url, timeout=120, headers={"User-Agent": UA})
    r.raise_for_status()
    destino.write_bytes(r.content)
    return r.content if binario else r.content.decode("utf-8", errors="replace")


def sem_acento(txt: str) -> str:
    txt = unicodedata.normalize("NFKD", txt or "")
    return "".join(c for c in txt if not unicodedata.combining(c))


def normalizar(nome: str) -> str:
    txt = sem_acento(nome).lower()
    txt = re.sub(r"\[[^\]]*\]|\([^)]*\)", " ", txt)
    txt = re.sub(r"\b(hd|fhd|sd|uhd|4k|h265|h264|full ?hd|alternativo|backup|br|brasil|\d{3,4}p)\b", " ", txt)
    txt = re.sub(r"[^a-z0-9]+", " ", txt)
    return re.sub(r"\s+", " ", txt).strip()


def nome_exato(nome: str) -> str:
    """Chave para juntar canais de listas diferentes pelo NOME. Mais rigida que
    normalizar(): nao tira "brasil", senao "TV Brasil" virava "tv" e se juntava
    com qualquer outro canal chamado so "TV"."""
    txt = sem_acento(nome).lower()
    txt = re.sub(r"\[[^\]]*\]|\([^)]*\)", " ", txt)
    txt = re.sub(r"\b(hd|fhd|sd|uhd|4k|h265|h264|full ?hd|\d{3,4}p)\b", " ", txt)
    txt = re.sub(r"[^a-z0-9]+", " ", txt).strip()
    return txt if len(txt) >= 4 else ""


def limpar_titulo(nome: str) -> str:
    txt = re.sub(r"\[[^\]]*\]|\(\d{3,4}p\)", "", nome or "")
    return re.sub(r"\s+", " ", txt).strip()


def canonizar_grupo(nome: str) -> str:
    chave = sem_acento((nome or "").strip()).lower()
    return GRUPOS_CANONICOS.get(chave, (nome or "").strip() or "Variedades")


def chave_do_canal(nome: str, tvg_id: str = "") -> tuple[str, str | None]:
    """(chave de juncao, nome curto se for uma das grandes)."""
    base = (tvg_id or "").split("@")[0]
    for candidato in (normalizar(nome), base.lower().replace(".br", "")):
        if candidato in APELIDOS:
            cid, nome_curto = APELIDOS[candidato]
            return cid, nome_curto
    if base:
        return base, None
    return normalizar(nome), None


def ler_m3u(texto: str) -> list[dict]:
    itens: list[dict] = []
    atual: dict | None = None
    for linha in texto.splitlines():
        linha = linha.strip()
        if linha.startswith("#EXTINF"):
            nome = linha.split(",", 1)[1].strip() if "," in linha else ""
            def attr(a: str) -> str:
                m = re.search(a + r'="([^"]*)"', linha)
                return m.group(1) if m else ""
            atual = {"name": nome, "logo": attr("tvg-logo"), "group": attr("group-title"), "tvg_id": attr("tvg-id")}
        elif linha.startswith("#EXTVLCOPT") or linha.startswith("#KODIPROP"):
            if atual is not None:
                atual["exige_header"] = True
        elif linha and not linha.startswith("#") and atual is not None:
            atual["url"] = linha
            itens.append(atual)
            atual = None
    return itens


# --------------------------------------------------------------------------
# Coleta
# --------------------------------------------------------------------------


def item(cid: str, nome: str, logo: str, grupo: str, origem: str, urls: list[str], epg: str = "") -> dict:
    return {"id": cid, "name": nome, "logo": logo, "group": grupo, "origem": origem, "urls": urls, "epg": epg}


def coletar_antigas() -> list[dict]:
    saida = []
    for arq in LISTAS_ANTIGAS:
        if not arq.exists():
            continue
        for c in json.loads(arq.read_text(encoding="utf-8")):
            urls = c.get("sources") or [c["url"]]
            if c.get("origem") == "pluto":
                continue  # o Pluto vem inteiro da API, mais novo
            cid, curto = chave_do_canal(c["name"], c.get("id", ""))
            saida.append(item(cid, curto or c["name"], c.get("logo", ""), c.get("group", ""), "abertos", urls))
    return saida


def coletar_m3us(recarregar: bool) -> list[dict]:
    textos = []
    for nome, url in M3US.items():
        try:
            textos.append((nome, baixar("list_" + nome + ".m3u", url, recarregar)))
        except Exception as erro:
            log("  aviso: " + nome + " falhou (" + str(erro) + ")")
    for arq in LISTAS_PC:
        if arq.exists():
            textos.append((arq.stem, arq.read_text(encoding="utf-8", errors="replace")))
    saida = []
    for nome, texto in textos:
        aceitos = 0
        for it in ler_m3u(texto):
            if it.get("exige_header") or not it.get("url"):
                continue
            if "[geo-blocked]" in it["name"].lower() and "playplus" not in it["url"]:
                pass  # geo-bloqueado fora do Brasil; aqui estamos no Brasil, entao testa
            cid, curto = chave_do_canal(it["name"], it.get("tvg_id", ""))
            grupo = it.get("group", "")
            if nome == "iptvorg_br_samsung":
                grupo = grupo or "Filmes"
            saida.append(item(cid, curto or limpar_titulo(it["name"]), it.get("logo", ""), grupo, "abertos", [it["url"]]))
            aceitos += 1
        log("  " + nome + ": " + str(aceitos) + " entradas")
    return saida


def coletar_fast(recarregar: bool) -> list[dict]:
    saida = []
    for nome, url in FAST.items():
        try:
            texto = baixar("fast_" + nome + ".m3u", url, recarregar)
        except Exception as erro:
            log("  aviso: " + nome + " falhou (" + str(erro) + ")")
            continue
        aceitos = 0
        for it in ler_m3u(texto):
            if it.get("exige_header") or not it.get("url") or "h265" in it["name"].lower():
                continue
            # "126 Veja+" / "1005 MasterChef Brasil (BR)" -> "Veja+" / "MasterChef Brasil"
            nome_canal = re.sub(r"^\d+\s+", "", it["name"])
            nome_canal = re.sub(r"\s*\(BR\)\s*$", "", nome_canal).strip()
            # macros de anuncio ([DEVICE_ID], [IP]...) que o app de fabrica preencheria
            url_canal = re.sub(r"\[[A-Z_]+\]", "", it["url"])
            pluto = re.search(r"jmp2\.uk/plu-([0-9a-f]{24})", url_canal)
            if pluto:
                cid = "PlutoTV" + pluto.group(1) + ".br"  # ja vem inteiro da API do Pluto
            else:
                cid, curto = chave_do_canal(nome_canal)
                nome_canal = curto or nome_canal
            aberto = bool(FAST_ABERTOS.search(nome_canal))
            saida.append(item(cid, nome_canal, it.get("logo", ""), "Notícias" if aberto else "",
                              "abertos" if aberto else "fast", [url_canal]))
            aceitos += 1
        log("  " + nome + ": " + str(aceitos) + " entradas")
    return saida


def coletar_iptvorg(recarregar: bool) -> list[dict]:
    """Da a API: logo, categoria e mais URLs de cada canal brasileiro."""
    streams = json.loads(baixar("iptvorg_streams.json", API_IPTVORG["streams"], recarregar))
    canais = {c["id"]: c for c in json.loads(baixar("iptvorg_channels.json", API_IPTVORG["channels"], recarregar))}
    logos: dict[str, str] = {}
    for lg in json.loads(baixar("iptvorg_logos.json", API_IPTVORG["logos"], recarregar)):
        logos.setdefault(lg.get("channel"), lg.get("url") or "")
    saida = []
    for s in streams:
        canal = canais.get(s.get("channel") or "")
        if not canal or canal.get("country") != "BR" or canal.get("is_nsfw") or canal.get("closed"):
            continue
        if s.get("user_agent") or s.get("referrer"):
            continue
        cats = [CATEGORIA_PT.get(c, "") for c in canal.get("categories", [])]
        cid, curto = chave_do_canal(canal["name"], canal["id"])
        saida.append(item(cid, curto or limpar_titulo(canal["name"]), logos.get(canal["id"], ""),
                          next((c for c in cats if c), "Variedades"), "abertos", [s["url"]]))
    return saida


def coletar_pluto(recarregar: bool) -> list[dict]:
    boot = json.loads(baixar("pluto_boot.json", BOOT_PLUTO + str(uuid.uuid4()), recarregar))
    token = boot["sessionToken"]
    log("  Pluto: regiao " + str(boot.get("session", {}).get("activeRegion")))
    cab = {"Authorization": "Bearer " + token, "User-Agent": UA}
    guia = requests.get("https://service-channels.clusters.pluto.tv/v2/guide/channels?offset=0&limit=1000",
                        headers=cab, timeout=60).json()["data"]
    cats = requests.get("https://service-channels.clusters.pluto.tv/v2/guide/categories",
                        headers=cab, timeout=60).json()["data"]
    grupo_por_id: dict[str, str] = {}
    for cat in cats:
        for cid in cat.get("channelIDs", []):
            grupo_por_id.setdefault(cid, limpar_titulo(cat.get("name") or ""))
    saida = []
    for canal in guia:
        cid = canal["id"]
        logo = next((i["url"] for t in ("colorLogoPNG", "solidLogoPNG")
                     for i in canal.get("images", []) if i.get("type") == t), "")
        saida.append(item("PlutoTV" + cid + ".br", limpar_titulo(canal["name"]), logo,
                          grupo_por_id.get(cid, "Variedades"), "pluto",
                          ["https://jmp2.uk/plu-" + cid + ".m3u8"] + [u.format(id=cid) for u in PLUTO_OFICIAL],
                          "pluto:" + cid))
    return saida


def variantes(url: str) -> list[str]:
    """A mesma fonte no outro esquema: muito servidor daqui responde nos dois e
    as vezes so um esta de pe. O teste decide qual fica."""
    if "pluto" in url or MARCA_JWT in url or "jmp2.uk" in url:
        return [url]
    if url.startswith("https://"):
        return [url, "http://" + url[8:]]
    if url.startswith("http://"):
        return [url, "https://" + url[7:]]
    return [url]


def juntar(*blocos: list[dict]) -> list[dict]:
    canais: dict[str, dict] = {}
    por_nome: dict[str, str] = {}
    for bloco in blocos:
        for it in bloco:
            if not it["id"]:
                continue
            todas = [v for u in it["urls"] for v in variantes(u)]
            chave_nome = nome_exato(it["name"])
            alvo = canais.get(it["id"]) or (canais.get(por_nome.get(chave_nome, "")) if chave_nome else None)
            if alvo is None:
                canais[it["id"]] = dict(it, urls=list(dict.fromkeys(todas)))
                if chave_nome:
                    por_nome.setdefault(chave_nome, it["id"])
                continue
            it = dict(it, urls=todas)
            for u in it["urls"]:
                if u not in alvo["urls"]:
                    alvo["urls"].append(u)
            if not alvo.get("logo") and it.get("logo"):
                alvo["logo"] = it["logo"]
            if alvo.get("group") in ("", "Variedades") and it.get("group"):
                alvo["group"] = it["group"]
    return list(canais.values())


# --------------------------------------------------------------------------
# Programacao (epg.pw)
# --------------------------------------------------------------------------


def mapear_epg(canais: list[dict], recarregar: bool) -> int:
    try:
        bruto = baixar("epg_BR.xml.gz", EPG_BR, recarregar, binario=True)
        texto = gzip.decompress(bruto).decode("utf-8", errors="replace")
    except Exception as erro:
        log("  aviso: epg.pw fora (" + str(erro) + ")")
        return 0
    por_nome: dict[str, str] = {}
    for eid, nome in re.findall(r'<channel id="([^"]+)">\s*<display-name[^>]*>([^<]+)', texto):
        nome = re.sub(r"^.*?/[A-Z]{2}\s+", "", nome)  # "São Paulo/SP Record News" -> "Record News"
        if nome_exato(nome):
            por_nome.setdefault(nome_exato(nome), eid)
    achados = 0
    for c in canais:
        if c["origem"] == "pluto":
            continue
        eid = EPG_FIXO.get(c["id"]) or EPG_FIXO.get(c["id"].removesuffix(".br")) or por_nome.get(nome_exato(c["name"]))
        if eid:
            c["epg"] = "epgpw:" + eid
            achados += 1
    return achados


# --------------------------------------------------------------------------
# Teste real: ate chegar byte de video
# --------------------------------------------------------------------------


def trava(url: str) -> threading.Semaphore:
    host = urlsplit(url).netloc
    with _travas_lock:
        return _travas[host]


def pegar(url: str, limite: int) -> tuple[int, bytes, str]:
    with trava(url):
        r = SESSAO.get(url, timeout=(5, 8), stream=True, allow_redirects=True)
        corpo = b""
        try:
            for pedaco in r.iter_content(16384):
                corpo += pedaco
                if len(corpo) >= limite:
                    break
        finally:
            r.close()
        return r.status_code, corpo, r.url


def eh_midia(corpo: bytes) -> bool:
    """MPEG-TS (sync 0x47 a cada 188 bytes), fMP4 ou audio com ID3."""
    if len(corpo) > 376 and corpo[0] == 0x47 and corpo[188] == 0x47:
        return True
    cabeca = corpo[:64]
    return any(m in cabeca for m in (b"ftyp", b"styp", b"moof", b"sidx")) or cabeca[:3] == b"ID3"


# canal pago nao ganha fonte extra por sondagem: so os abertos e publicos
PAGOS = re.compile(r"sportv|band ?sports|globo ?news|viva|premiere|telecine|hbo|espn|combate|megapix|warner|tnt|discovery", re.I)
CAMINHO_REGIONAL = re.compile(r"^http://(\d+\.\d+\.\d+\.\d+(?::\d+)?)/([A-Za-z0-9_\-]+)/index\.m3u8$")


def irmaos_regionais(canais: list[dict]) -> int:
    """Quem tem http://IP/CANAL/index.m3u8 ganha o mesmo caminho nos outros
    servidores regionais que ja usam esse padrao."""
    exemplo: dict[str, str] = {}
    for c in canais:
        for u in c["urls"]:
            m = CAMINHO_REGIONAL.match(u)
            if m and m.group(1) not in exemplo:
                exemplo[m.group(1)] = u
    # so sonda servidor que esta de pe: servidor morto so ia gerar centenas de
    # links mortos para o teste esperar um por um
    with ThreadPoolExecutor(max_workers=16) as pool:
        vivos = [h for h, (_, ms, _m) in zip(exemplo, pool.map(testar, exemplo.values())) if ms is not None]
    log("  servidores regionais de pe: " + str(len(vivos)) + " de " + str(len(exemplo)))
    hosts = sorted(vivos)
    novos = 0
    for c in canais:
        if c["origem"] != "abertos" or PAGOS.search(c["name"]):
            continue
        caminhos = {m.group(2) for u in c["urls"] if (m := CAMINHO_REGIONAL.match(u))}
        for cam in caminhos:
            for h in hosts:
                u = "http://" + h + "/" + cam + "/index.m3u8"
                if u not in c["urls"]:
                    c["urls"].append(u)
                    novos += 1
    return novos


def coletar_regionais() -> list[dict]:
    return [
        item(cid, nome, "", "Abertos", "abertos", [h + "/" + cam + "/index.m3u8" for h in HOSTS_REGIONAIS for cam in caminhos])
        for cid, (nome, caminhos) in EXTRAS_REGIONAIS.items()
    ]


_passe = ""
_passe_lock = threading.Lock()


def passe_pluto() -> str:
    """Passe anonimo do Pluto, so para testar as fontes da rota oficial."""
    global _passe
    with _passe_lock:
        if not _passe:
            _passe = requests.get(BOOT_PLUTO + str(uuid.uuid4()), timeout=60).json()["sessionToken"]
    return _passe


def testar(url: str) -> tuple[str, float | None, str]:
    """(url, ms ate o primeiro video, motivo). ms None = nao toca."""
    inicio = time.time()
    primeiro = url.replace(MARCA_JWT, passe_pluto()) if MARCA_JWT in url else url
    atual = primeiro
    criptografado = False
    try:
        for _ in range(4):
            codigo, corpo, base = pegar(atual, 65536)
            if codigo != 200:
                return url, None, "http " + str(codigo)
            texto = corpo.decode("utf-8", errors="ignore")
            if "#EXTM3U" in texto[:2000] and not any(
                ln.strip() and not ln.startswith("#") for ln in texto.splitlines()
            ):
                # servidor que monta a playlist na hora (Pluto) as vezes manda a
                # primeira vazia: espera um pouco e pede de novo uma vez
                time.sleep(1.5)
                codigo, corpo, base = pegar(atual, 65536)
                texto = corpo.decode("utf-8", errors="ignore")
            criptografado = criptografado or "METHOD=AES-128" in texto
            if "#EXTM3U" not in texto[:2000]:
                if atual == primeiro:
                    # TS cru, pagina do YouTube etc: o player da TV nao abre
                    return url, None, "nao e HLS"
                # pedaco criptografado (AES-128, o Pluto usa): os bytes nao tem
                # cara de video, entao basta chegar um pedaco de tamanho real
                if eh_midia(corpo) or (criptografado and len(corpo) > 4096):
                    return url, (time.time() - inicio) * 1000, "ok"
                return url, None, "pedaco nao e video"
            if any(m in texto for m in MARCAS_DE_BLOQUEIO):
                return url, None, "cartao de bloqueio"
            linhas = [ln.strip() for ln in texto.splitlines() if ln.strip() and not ln.startswith("#")]
            if not linhas:
                return url, None, "playlist vazia"
            # master: vai para a primeira variante; midia: pega o ultimo pedaco (o mais ao vivo)
            atual = urljoin(base, linhas[0] if "#EXT-X-STREAM-INF" in texto else linhas[-1])
        return url, None, "saltos demais"
    except Exception as erro:
        return url, None, type(erro).__name__


def validar(canais: list[dict], trabalhadores: int) -> dict[str, tuple[float | None, str]]:
    todas = sorted({u for c in canais for u in c["urls"]})
    log("testando " + str(len(todas)) + " URLs uma por uma (" + str(trabalhadores) + " em paralelo)...")
    resultado: dict[str, tuple[float | None, str]] = {}
    with ThreadPoolExecutor(max_workers=trabalhadores) as pool:
        for i, (url, ms, motivo) in enumerate(pool.map(testar, todas), 1):
            resultado[url] = (ms, motivo)
            if i % 200 == 0:
                vivas = sum(1 for v in resultado.values() if v[0] is not None)
                log("  " + str(i) + "/" + str(len(todas)) + " testadas, " + str(vivas) + " tocando")
    vivas = sum(1 for v in resultado.values() if v[0] is not None)
    log("  " + str(len(todas)) + "/" + str(len(todas)) + " testadas, " + str(vivas) + " tocando")
    return resultado


# --------------------------------------------------------------------------


def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument("--recarregar", action="store_true")
    p.add_argument("--trabalhadores", type=int, default=40)
    p.add_argument("--max-fontes", type=int, default=8)
    args = p.parse_args()

    log("coletando listas antigas dos dois apps...")
    antigas = coletar_antigas()
    log("  " + str(len(antigas)) + " canais")
    log("coletando playlists publicas e do PC...")
    m3us = coletar_m3us(args.recarregar)
    log("coletando iptv-org (API)...")
    iptvorg = coletar_iptvorg(args.recarregar)
    log("  " + str(len(iptvorg)) + " fontes")
    log("coletando Pluto TV Brasil...")
    pluto = coletar_pluto(args.recarregar)
    log("  " + str(len(pluto)) + " canais")

    log("coletando canais gratuitos das fabricantes (LG, TCL)...")
    fast = coletar_fast(args.recarregar)

    canais = juntar(antigas, m3us, iptvorg, coletar_regionais(), pluto, fast)
    log("sondagem nos servidores regionais: +" + str(irmaos_regionais(canais)) + " fontes candidatas")
    for c in canais:
        c["group"] = canonizar_grupo(c.get("group", ""))
    canais = [c for c in canais if c["group"] not in GRUPOS_BANIDOS]
    log("total: " + str(len(canais)) + " canais, " + str(sum(len(c["urls"]) for c in canais)) + " fontes")

    resultado = validar(canais, args.trabalhadores)
    log("programacao: " + str(mapear_epg(canais, args.recarregar)) + " canais abertos com guia")

    abertos, cine, relatorio = [], [], []
    for c in canais:
        boas = sorted((u for u in c["urls"] if resultado[u][0] is not None), key=lambda u: resultado[u][0])
        relatorio.append({
            "canal": c["name"], "id": c["id"],
            "fontes": [{"url": u, "ms": resultado[u][0], "motivo": resultado[u][1]} for u in c["urls"]],
        })
        if not boas:
            continue
        saida = {
            "id": c["id"], "name": c["name"], "url": boas[0], "sources": boas[: args.max_fontes],
            "logo": c.get("logo", ""), "group": c["group"], "country": "br",
            "origem": c["origem"],
        }
        if c.get("epg"):
            saida["epg"] = c["epg"]
        vai_pro_cine = c["origem"] in ("pluto", "fast") or c["group"] in GRUPOS_CINE
        (cine if vai_pro_cine else abertos).append(saida)

    for lista, arq in ((abertos, SAIDA_ABERTOS), (cine, SAIDA_CINE)):
        lista.sort(key=lambda c: (c["group"], sem_acento(c["name"]).lower()))
        arq.write_text(json.dumps(lista, ensure_ascii=False, indent=2), encoding="utf-8")
        log("")
        log("gravado " + str(arq.name) + ": " + str(len(lista)) + " canais no ar, "
            + str(sum(len(c["sources"]) for c in lista)) + " fontes, "
            + str(sum(1 for c in lista if c.get("epg"))) + " com programacao")
        for grupo, n in Counter(c["group"] for c in lista).most_common():
            log("  " + str(n).rjust(4) + "  " + grupo)
    RELATORIO.write_text(json.dumps(relatorio, ensure_ascii=False, indent=1), encoding="utf-8")

    log("")
    log("as grandes:")
    todos = {c["id"]: c for c in abertos}
    for cid in ("Globo", "Record", "SBT", "Band", "RedeTV", "TVCultura", "TVGazeta", "TVBrasil"):
        c = todos.get(cid) or todos.get(cid + ".br")
        log("  " + cid.ljust(10) + (" FORA DO AR" if not c else " " + str(len(c["sources"])) + " fontes, epg=" + c.get("epg", "-")))
    return 0


if __name__ == "__main__":
    sys.exit(main())
