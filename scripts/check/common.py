"""施工図チェックの共通処理。

実図面と生の結果は ~/sekozu-data/ に置き、リポジトリには入れない（CLAUDE.md 参照）。
"""
import json
import re
from pathlib import Path

import pymupdf

PRIVATE = Path.home() / "sekozu-data"
RUNS = PRIVATE / "check-runs"
REPO = Path(__file__).resolve().parents[2]
DEMO = REPO / "demo-data" / "sample-x"
# 検証用のデータ（人の朱書き、正解、採点）。画面では使わない
VALIDATION = REPO / "validation"

# 照合に使う図面。名前は画面に出してよい呼び名だけにする
DOCS = {
    "kozo": {"name": "構造図", "path": PRIVATE / "kozo.pdf"},
    "kui_old": {
        "name": "杭伏せ図（施工順変更前）",
        "path": PRIVATE / "shikouzu/kui_fuse_260817.pdf",
    },
    "kui_new": {
        "name": "杭伏せ図（施工順変更版）",
        # 確認用の矛盾を1か所仕込んだ版。make_planted.py が作る
        "path": PRIVATE / "shikouzu/planted/kui_fuse_junhenko_planted.pdf",
    },
    "kiso_fuse": {"name": "基礎伏せ図", "path": PRIVATE / "shikouzu/kiso_fuse_261008.pdf"},
    "kiso_danmen": {"name": "基礎断面図", "path": PRIVATE / "shikouzu/kiso_danmen_261015.pdf"},
}

# 杭番号と通り芯の対応（杭伏せ図の番号は Y1 → Y5、X1 → X4 の順）
PILE_GRID = {
    1: "X1-Y1", 2: "X2-Y1", 3: "X3-Y1", 4: "X4-Y1",
    5: "X1-Y2", 6: "X2-Y2", 7: "X3-Y2", 8: "X4-Y2",
    9: "X1-Y3", 10: "X2-Y3", 11: "X3-Y3", 12: "X4-Y3",
    13: "X1-Y4", 14: "X2-Y4", 15: "X3-Y4", 16: "X4-Y4",
    17: "X3-Y5", 18: "X4-Y5",
}

CIRCLED = {chr(0x2460 + i): i + 1 for i in range(20)}


def open_page(doc: str, page: int):
    """page は 1 始まり"""
    return pymupdf.open(DOCS[doc]["path"])[page - 1]


def page_words(page, clip=None) -> list[dict]:
    words = []
    for x0, y0, x1, y1, text, *_ in page.get_text("words", clip=clip):
        words.append({"text": text, "rect": (x0, y0, x1, y1)})
    return words


def norm_bbox(page, rect) -> list[float]:
    """ページに対する 0〜1 の枠。回転ページも表示座標で扱う"""
    w, h = page.rect.width, page.rect.height
    return [
        round(rect[0] / w, 4),
        round(rect[1] / h, 4),
        round(rect[2] / w, 4),
        round(rect[3] / h, 4),
    ]


def union(rects):
    rects = list(rects)
    return (
        min(r[0] for r in rects),
        min(r[1] for r in rects),
        max(r[2] for r in rects),
        max(r[3] for r in rects),
    )


def evidence(doc: str, page_no: int, rect, where: str, text: str) -> dict:
    page = open_page(doc, page_no)
    return {
        "doc": doc,
        "doc_name": DOCS[doc]["name"],
        "page": page_no,
        "where": where,
        "text": text,
        "bbox": norm_bbox(page, rect),
    }


def to_number(text: str) -> int:
    return int(re.sub(r"\D", "", text))


def write_json(path: Path, data) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n")
