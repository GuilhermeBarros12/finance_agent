"""Reduz o tamanho dos PNG das capturas da T21f sem mudar o tamanho da imagem.

As telas têm poucas cores (tinta, papel, selos). A imagem é reduzida a uma paleta
adaptativa e regravada com compressão máxima. Uso:

    python scripts/e2e/otimizar_capturas.py docs/capturas/t21f-*.png

Requer Pillow (não é dependência do projeto; é uma ferramenta de uso eventual).
"""

from __future__ import annotations

import sys
from pathlib import Path

from PIL import Image

CORES = 96


def otimizar(caminho: Path) -> tuple[int, int]:
    antes = caminho.stat().st_size
    with Image.open(caminho) as imagem:
        reduzida = imagem.convert("RGB").quantize(
            colors=CORES, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.NONE
        )
        reduzida.save(caminho, format="PNG", optimize=True)
    return antes, caminho.stat().st_size


def main(argumentos: list[str]) -> int:
    if not argumentos:
        print(__doc__)
        return 2
    total_antes = total_depois = 0
    for texto in argumentos:
        antes, depois = otimizar(Path(texto))
        total_antes += antes
        total_depois += depois
        print(f"{texto}: {antes} -> {depois} bytes")
    print(f"total: {total_antes} -> {total_depois} bytes")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
