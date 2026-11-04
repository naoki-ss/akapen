"""入れたPDFのページの小さな画像を作る。判定するページを選ぶ画面で使う。AIは呼ばない。

  python prepare_job.py <ジョブのフォルダ>

結果は thumbs/p<番号>.png。標準出力に {"pages": [{"number", "width", "height"}]} を出す。
画面は社外に見せることがあるので、物件に masks があれば塗りつぶす。登録がない物件は、字が読めない粗さにする。
"""
import json
import sys
from pathlib import Path

import pymupdf

from check_upload import MAX_PAGES, UPLOADS, load_project
from markup_pdf import MASK_COLOR

THUMB_WIDTH = 320
COARSE_WIDTH = 140


def main():
    folder = Path(sys.argv[1]).resolve()
    if UPLOADS.resolve() not in folder.parents:
        sys.exit("uploads の外のフォルダは扱いません")
    meta = json.loads((folder / "job.json").read_text())
    masks = load_project(meta["project"]).get("masks")
    doc = pymupdf.open(folder / "input.pdf")
    if doc.needs_pass:
        sys.exit("パスワード付きのPDFは扱えません")
    if not 1 <= doc.page_count <= MAX_PAGES:
        sys.exit(f"ページ数は {MAX_PAGES} ページまでです（{doc.page_count} ページ）")
    out = folder / "thumbs"
    out.mkdir(exist_ok=True)
    pages = []
    for page in doc:
        zoom = (THUMB_WIDTH if masks else COARSE_WIDTH) / page.rect.width
        pix = page.get_pixmap(matrix=pymupdf.Matrix(zoom, zoom), alpha=False)
        for box in masks or []:
            pix.set_rect(pymupdf.IRect(int(box[0] * pix.width), int(box[1] * pix.height),
                                       int(box[2] * pix.width) + 1, int(box[3] * pix.height) + 1), MASK_COLOR)
        pix.save(out / f"p{page.number + 1}.png")
        pages.append({"number": page.number + 1, "width": pix.width, "height": pix.height})
    print(json.dumps({"pages": pages}))


if __name__ == "__main__":
    main()
