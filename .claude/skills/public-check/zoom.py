"""画像の一部を切り抜いて拡大し、~/sekozu-data/tmp/public-check/ に保存する（塗り漏れを目で確かめるため）。

  .venv/bin/python .claude/skills/public-check/zoom.py <画像> <左> <上> <右> <下> [倍率]

座標は元の画像のピクセル。倍率の既定は3。保存した場所を表示する。切り抜きはリポジトリの外にだけ置く。
"""
import sys
from pathlib import Path

import pymupdf

if len(sys.argv) < 6:
    sys.exit(__doc__)
source = Path(sys.argv[1])
left, top, right, bottom = map(float, sys.argv[2:6])
scale = float(sys.argv[6]) if len(sys.argv) > 6 else 3.0
out_dir = Path.home() / "sekozu-data" / "tmp" / "public-check"
out_dir.mkdir(parents=True, exist_ok=True)
image = pymupdf.open(source)
page = image[0]
# 画像を1ページの文書として開くと、ページの大きさは画像のピクセルと同じ比率になる
pixmap = pymupdf.Pixmap(source)
ratio = page.rect.width / pixmap.width
clip = pymupdf.Rect(left * ratio, top * ratio, right * ratio, bottom * ratio)
zoom = scale / ratio
out = out_dir / f"{source.stem}-{int(left)}-{int(top)}-{int(right)}-{int(bottom)}.png"
page.get_pixmap(matrix=pymupdf.Matrix(zoom, zoom), clip=clip).save(out)
print(out)
