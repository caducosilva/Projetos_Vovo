"""
Contraprova: pega uma amostra de canais, resolve o manifesto ate a variante e
baixa um pedaco de video de verdade. Responder 200 nao prova nada; o que prova
e chegar byte de midia na mao.

Uso:
    python tools/provar_canais.py            # 25 canais sorteados
    python tools/provar_canais.py 60         # 60 canais
"""

from __future__ import annotations

import json
import random
import sys
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from urllib.parse import urljoin

import requests

# console do Windows e cp1252: sem isto um nome de canal com simbolo
# derruba o script no meio do relatorio
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

MARCA_JWT = "__PLUTO_JWT__"
BOOT_PLUTO = (
    "https://boot.pluto.tv/v4/start?appName=web&appVersion=8.0.0&deviceVersion=151.0.0"
    "&deviceModel=web&deviceMake=chrome&deviceType=web&clientModelNumber=1.0.0"
    "&serverSideAds=false&clientID="
)
# o que o Pluto serve quando recusa: video de verdade, mas so um aviso na tela
MARCAS_DE_BLOQUEIO = ("takedownslate", "ptv_takedownslates", "/slates/")

RAIZ = Path(__file__).resolve().parent.parent
LISTA = RAIZ / "src" / "data" / "default_channels.json"
UA = "Mozilla/5.0 (Linux; Android 12; TV) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36"

SESSAO = requests.Session()
SESSAO.headers.update({"User-Agent": UA, "Accept": "*/*", "Referer": "https://pluto.tv/"})

_passe = ""


def passe_pluto() -> str:
    global _passe
    if not _passe:
        import uuid

        r = SESSAO.get(BOOT_PLUTO + str(uuid.uuid4()), timeout=60)
        r.raise_for_status()
        _passe = r.json()["sessionToken"]
    return _passe


def pegar(url: str, limite: int = 65536) -> tuple[int, bytes, str]:
    r = SESSAO.get(url, timeout=(6, 12), stream=True, allow_redirects=True)
    corpo = b""
    for pedaco in r.iter_content(8192):
        corpo += pedaco
        if len(corpo) >= limite:
            break
    tipo = (r.headers.get("Content-Type") or "").lower()
    codigo = r.status_code
    url_final = r.url
    r.close()
    return codigo, corpo, url_final if isinstance(url_final, str) else url, tipo  # type: ignore[return-value]


def tocar(url: str, saltos: int = 3) -> tuple[bool, str]:
    """Segue master -> variante -> segmento. True so se vier midia de verdade."""
    atual = url.replace(MARCA_JWT, passe_pluto()) if MARCA_JWT in url else url
    for _ in range(saltos):
        try:
            codigo, corpo, url_final, tipo = pegar(atual)  # type: ignore[misc]
        except Exception as erro:
            return False, type(erro).__name__
        if codigo != 200:
            return False, "http " + str(codigo)
        texto = corpo.decode("utf-8", errors="ignore")
        if any(m in texto for m in MARCAS_DE_BLOQUEIO):
            return False, "cartao de bloqueio do provedor"
        if "#EXTM3U" not in texto:
            # nao e playlist: entao ja e midia
            if corpo[:1] == b"\x47" or len(corpo) > 10000:
                return True, "midia " + str(len(corpo)) + " bytes"
            return False, "resposta curta e sem playlist"
        linhas = [ln.strip() for ln in texto.splitlines() if ln.strip() and not ln.startswith("#")]
        if not linhas:
            return False, "playlist vazia"
        atual = urljoin(url_final, linhas[0])
    return False, "playlist aninhada demais"


def main() -> int:
    quantos = int(sys.argv[1]) if len(sys.argv) > 1 else 25
    canais = json.loads(LISTA.read_text(encoding="utf-8"))
    amostra = random.Random(7).sample(canais, min(quantos, len(canais)))

    def testar(canal: dict) -> tuple[dict, bool, str]:
        for fonte in canal["sources"]:
            ok, motivo = tocar(fonte)
            if ok:
                return canal, True, motivo
        return canal, False, "todas as fontes falharam"

    # Poucas conexoes de proposito: o Pluto corta pedido demais vindo do mesmo
    # IP ao mesmo tempo, e a prova acusava canal bom como quebrado.
    bons = 0
    with ThreadPoolExecutor(max_workers=4) as pool:
        for canal, ok, motivo in pool.map(testar, amostra):
            marca = "OK  " if ok else "FALHA"
            print(marca, canal["name"][:38].ljust(38), "|", str(len(canal["sources"])), "fontes |", motivo)
            bons += 1 if ok else 0

    print("")
    print(str(bons) + "/" + str(len(amostra)) + " canais tocaram video de verdade")
    return 0 if bons >= len(amostra) * 0.8 else 1


if __name__ == "__main__":
    sys.exit(main())
