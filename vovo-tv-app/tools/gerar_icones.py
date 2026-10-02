#!/usr/bin/env python3
"""Gera o icone e o banner de TV dos apps, sem depender de editor de imagem.

Android TV mostra o app na fileira inicial usando o `android:banner`, que e
deitado (320x180). Antes o manifesto apontava o banner para o icone quadrado,
entao a Philips esticava um quadrado no lugar do retangulo e o app aparecia
borrado no meio dos outros.

Uso:
    python tools/gerar_icones.py                 # Vovo TV (tema amarelo)
    python tools/gerar_icones.py --tema cine     # Cine Zap (tema roxo)
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

RAIZ = Path(__file__).resolve().parent.parent

# Densidades do Android: pasta -> lado do icone quadrado
DENSIDADES = {
    "mipmap-mdpi": 48,
    "mipmap-hdpi": 72,
    "mipmap-xhdpi": 96,
    "mipmap-xxhdpi": 144,
    "mipmap-xxxhdpi": 192,
}

TEMAS = {
    "vovo": {
        "titulo": "Vovó TV",
        "fundo": (8, 11, 17),
        "fundo2": (23, 32, 48),
        "destaque": (251, 191, 36),  # sol-400
        "texto": (247, 250, 252),
    },
    "cine": {
        "titulo": "Cine Zap",
        "fundo": (12, 8, 20),
        "fundo2": (46, 20, 66),
        "destaque": (167, 139, 250),  # roxo claro
        "texto": (247, 250, 252),
    },
}


def fonte(tamanho: int) -> ImageFont.FreeTypeFont:
    for caminho in (
        "C:/Windows/Fonts/segoeuib.ttf",
        "C:/Windows/Fonts/arialbd.ttf",
        "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
    ):
        if Path(caminho).exists():
            return ImageFont.truetype(caminho, tamanho)
    return ImageFont.load_default()


def fundo_degrade(largura: int, altura: int, tema: dict) -> Image.Image:
    img = Image.new("RGB", (largura, altura), tema["fundo"])
    d = ImageDraw.Draw(img)
    a, b = tema["fundo"], tema["fundo2"]
    for y in range(altura):
        t = y / max(1, altura - 1)
        d.line(
            [(0, y), (largura, y)],
            fill=tuple(int(a[i] + (b[i] - a[i]) * t) for i in range(3)),
        )
    return img


def desenhar_tv(d: ImageDraw.ImageDraw, caixa: tuple[int, int, int, int], tema: dict) -> None:
    """Uma TV bem simples: corpo, tela e pezinhos. Legivel em 48px."""
    x0, y0, x1, y1 = caixa
    largura = x1 - x0
    altura = y1 - y0
    traco = max(2, int(largura * 0.08))
    raio = int(largura * 0.14)

    # antena
    meio = (x0 + x1) // 2
    d.line([(meio - largura * 0.18, y0 - altura * 0.22), (meio, y0)],
           fill=tema["destaque"], width=traco)
    d.line([(meio + largura * 0.18, y0 - altura * 0.22), (meio, y0)],
           fill=tema["destaque"], width=traco)

    d.rounded_rectangle([x0, y0, x1, y1], radius=raio, outline=tema["destaque"], width=traco)
    dentro = traco + max(2, int(largura * 0.06))
    d.rounded_rectangle(
        [x0 + dentro, y0 + dentro, x1 - dentro, y1 - dentro],
        radius=max(2, raio // 2),
        fill=tema["destaque"],
    )
    # pezinhos
    d.line([(x0 + largura * 0.22, y1 + altura * 0.12), (x0 + largura * 0.34, y1)],
           fill=tema["destaque"], width=traco)
    d.line([(x1 - largura * 0.22, y1 + altura * 0.12), (x1 - largura * 0.34, y1)],
           fill=tema["destaque"], width=traco)


def gerar_icone(lado: int, tema: dict) -> Image.Image:
    img = fundo_degrade(lado, lado, tema).convert("RGBA")
    d = ImageDraw.Draw(img)
    margem = lado * 0.2
    desenhar_tv(d, (int(margem), int(margem * 1.15), int(lado - margem), int(lado - margem * 1.25)), tema)
    return img


def gerar_banner(tema: dict) -> Image.Image:
    largura, altura = 320, 180
    img = fundo_degrade(largura, altura, tema).convert("RGBA")
    d = ImageDraw.Draw(img)
    desenhar_tv(d, (26, 58, 106, 128), tema)
    f = fonte(38)
    d.text((126, 68), tema["titulo"], font=f, fill=tema["texto"])
    return img


def main() -> int:
    parser = argparse.ArgumentParser(description="Gera icone e banner do app")
    parser.add_argument("--tema", choices=sorted(TEMAS), default="vovo")
    parser.add_argument("--raiz", type=Path, default=RAIZ, help="pasta do projeto Capacitor")
    args = parser.parse_args()

    tema = TEMAS[args.tema]
    res = args.raiz / "android" / "app" / "src" / "main" / "res"
    if not res.is_dir():
        print(f"ERRO: nao achei {res}", file=sys.stderr)
        return 1

    for pasta, lado in DENSIDADES.items():
        destino = res / pasta
        destino.mkdir(parents=True, exist_ok=True)
        icone = gerar_icone(lado, tema)
        icone.save(destino / "ic_launcher.png")
        icone.save(destino / "ic_launcher_round.png")
        icone.save(destino / "ic_launcher_foreground.png")
        print(f"OK: {pasta}/ic_launcher.png ({lado}x{lado})")

    banner_dir = res / "drawable-xhdpi"
    banner_dir.mkdir(parents=True, exist_ok=True)
    gerar_banner(tema).save(banner_dir / "banner.png")
    print("OK: drawable-xhdpi/banner.png (320x180)")

    # o adaptativo v26 usaria o XML antigo e ignoraria o PNG novo
    for xml in ("mipmap-anydpi-v26/ic_launcher.xml", "mipmap-anydpi-v26/ic_launcher_round.xml"):
        alvo = res / xml
        if alvo.exists():
            alvo.unlink()
            print(f"OK: removido {xml} (usava o desenho antigo)")

    print(f"OK: icones do tema {args.tema} gerados em {res}")
    return 0


if __name__ == "__main__":
    codigo = main()
    print(f"RETCODE: {codigo}")
    sys.exit(codigo)
