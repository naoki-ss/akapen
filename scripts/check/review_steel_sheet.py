"""鉄骨施工図の1ページを、構造図と照らして Claude API で判定し、時間と費用を測る。

  python review_steel_sheet.py --sheet <施工図PDF> --page 2 --design <構造図PDF> --design-pages 14,18,28 --dry-run
  python review_steel_sheet.py --sheet <施工図PDF> --page 2 --design <構造図PDF> --design-pages 14,18,28

人の朱書きとの比較に使うので、答えが漏れないように次を守る。
- 朱書きのある図面は渡さない。送るページに赤があれば、API を呼ばずに止める
- 送ったファイルの SHA-256 と画像を残し、あとから確かめられるようにする
- プロンプトに物件固有のことを書かない

実図面を送るので、結果は ~/sekozu-data/check-runs/ にだけ保存する。
"""
import argparse
import base64
import hashlib
import json
import os
import sys
import time
from datetime import datetime
from pathlib import Path

import anthropic
import pymupdf

from ai_review import MODEL, call_claude, load_env
from common import RUNS, write_json
from repeat_runs import PRICE_INPUT, PRICE_OUTPUT

# API の画像の上限（長辺 2576px、3.75MP）に収める。文字が小さいので全体図と分割図を送る
MAX_PIXELS = 3_700_000
MAX_EDGE = 2576
TILE_COLUMNS, TILE_ROWS = 3, 2
TILE_OVERLAP = 0.06

SYSTEM = """あなたは建設会社の施工図チェック担当です。鉄骨製作会社から提出された鉄骨施工図を、設計図（構造図）と照らし合わせ、製作に入る前に確認すべき点を挙げます。

入力:
- 施工図の1ページの画像。1枚目が全体、残りは同じページの分割図です（文字を読むために使います）
- 設計図のPDF（必要なページのみ）

確認すること:
- 通り芯、スパン、柱面や部材の位置の寸法
- 部材の符号、断面、材質、配置（図面内の部材リストと図面、施工図と設計図）
- 梁天端などのレベル
- 同じ図面の中での整合
- 製作前に確認しておくべき点

判断の基準:
- 実際に読めた値だけを根拠にします。読み取れない箇所は推測せず unreadable に書きます。
- 施工図は設計図より詳しく、製作上の調整が入るのが普通です。それだけでは指摘しません。
- どちらが正しいかを決めつけず、値を並べて確認を求めます。
- 現場名、会社名、人名は書きません。

書き方:
- 「〜と〜が食い違っています」「〜の可能性があります。ご確認ください」と書きます。
- 位置は通り芯で書き、region に全体図に対する 0〜1 の範囲 [x0, y0, x1, y1] を入れます。"""

SCHEMA = {
    "type": "object",
    "additionalProperties": False,
    "required": ["sheet_title", "findings", "unreadable"],
    "properties": {
        "sheet_title": {"type": "string"},
        "findings": {
            "type": "array",
            "items": {
                "type": "object",
                "additionalProperties": False,
                "required": ["category", "title", "content", "severity", "grids", "marks",
                             "sheet_value", "design_value", "region"],
                "properties": {
                    "category": {"type": "string", "enum": ["寸法", "符号", "断面", "レベル", "配置", "図面内の整合", "製作前の確認", "その他"]},
                    "title": {"type": "string"},
                    "content": {"type": "string"},
                    "severity": {"type": "string", "enum": ["高", "中", "低"]},
                    "grids": {"type": "array", "items": {"type": "string"}},
                    "marks": {"type": "array", "items": {"type": "string"}},
                    "sheet_value": {"type": "string"},
                    "design_value": {"type": "string"},
                    "region": {"type": "array", "items": {"type": "number"}},
                },
            },
        },
        "unreadable": {"type": "array", "items": {"type": "string"}},
    },
}


def red_pixels(page):
    """朱書きの有無を見る。低い解像度で十分に分かる"""
    samples = page.get_pixmap(dpi=40, colorspace=pymupdf.csRGB).samples
    return sum(
        1 for i in range(0, len(samples), 3)
        if samples[i] > samples[i + 1] + 60 and samples[i] > samples[i + 2] + 60
    )


def sha256(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def render(page, clip=None):
    """上限に収まる最大の解像度で PNG にする"""
    rect = clip or page.rect
    scale = min(MAX_EDGE / max(rect.width, rect.height), (MAX_PIXELS / (rect.width * rect.height)) ** 0.5)
    return page.get_pixmap(matrix=pymupdf.Matrix(scale, scale), clip=rect, alpha=False).tobytes("png")


def sheet_images(page):
    """[(名前, PNG, 説明)] 全体図と、重なりのある分割図"""
    images = [("whole", render(page), "全体図")]
    width, height = page.rect.width, page.rect.height
    for row in range(TILE_ROWS):
        for column in range(TILE_COLUMNS):
            rect = pymupdf.Rect(
                max(0, (column / TILE_COLUMNS - TILE_OVERLAP) * width),
                max(0, (row / TILE_ROWS - TILE_OVERLAP) * height),
                min(1, ((column + 1) / TILE_COLUMNS + TILE_OVERLAP)) * width,
                min(1, ((row + 1) / TILE_ROWS + TILE_OVERLAP)) * height,
            )
            place = (f"全体図の x {rect.x0 / width:.2f}〜{rect.x1 / width:.2f}、"
                     f"y {rect.y0 / height:.2f}〜{rect.y1 / height:.2f} の分割図")
            images.append((f"tile-{row}-{column}", render(page, rect), place))
    return images


def build_content(images, design_pdf):
    content = []
    for _name, png, description in images:
        content.append({"type": "text", "text": f"施工図：{description}"})
        content.append({
            "type": "image",
            "source": {"type": "base64", "media_type": "image/png", "data": base64.standard_b64encode(png).decode()},
        })
    content.append({"type": "text", "text": "次のPDFは設計図（構造図）です。"})
    content.append({
        "type": "document",
        "source": {"type": "base64", "media_type": "application/pdf", "data": base64.standard_b64encode(design_pdf).decode()},
    })
    content.append({"type": "text", "text": "この施工図のページを設計図と照らし合わせ、確認すべき点を挙げてください。"})
    return content


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--sheet", type=Path, required=True)
    parser.add_argument("--page", type=int, required=True)
    parser.add_argument("--design", type=Path, required=True)
    parser.add_argument("--design-pages", required=True, help="カンマ区切りのページ番号")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    started = time.perf_counter()
    sheet = pymupdf.open(args.sheet)
    design = pymupdf.open(args.design)
    design_pages = [int(p) for p in args.design_pages.split(",")]

    # 朱書きが混ざっていれば、API を呼ぶ前に止める
    red = {f"施工図 p{args.page}": red_pixels(sheet[args.page - 1])}
    red.update({f"設計図 p{p}": red_pixels(design[p - 1]) for p in design_pages})
    marked = {name: count for name, count in red.items() if count}
    if marked:
        sys.exit(f"赤い部分があるページは送りません: {marked}")

    subset = pymupdf.open()
    for page_no in design_pages:
        subset.insert_pdf(design, from_page=page_no - 1, to_page=page_no - 1)
    design_pdf = subset.tobytes()
    images = sheet_images(sheet[args.page - 1])
    content = build_content(images, design_pdf)
    prepared = time.perf_counter()

    stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    raw_dir = RUNS / f"steel-{stamp}"
    manifest = {
        "model": MODEL,
        "sheet": {"file": args.sheet.name, "sha256": sha256(args.sheet), "page": args.page},
        "design": {"file": args.design.name, "sha256": sha256(args.design), "pages": design_pages},
        "images": [{"name": name, "bytes": len(png), "description": text} for name, png, text in images],
        "design_pdf_bytes": len(design_pdf),
        "red_pixels": red,
        "system": SYSTEM,
    }
    size = sum(len(png) for _, png, _ in images) + len(design_pdf)
    print(f"画像 {len(images)} 枚、送信量 {size / 1e6:.1f}MB、赤 {sum(red.values())} ピクセル")
    if args.dry_run:
        return

    load_env()
    if not os.environ.get("ANTHROPIC_API_KEY"):
        sys.exit(".env.local に ANTHROPIC_API_KEY がありません")

    write_json(raw_dir / "manifest.json", manifest)
    for name, png, _ in images:
        (raw_dir / f"{name}.png").write_bytes(png)

    client = anthropic.Anthropic()
    before_call = time.perf_counter()
    reply = call_claude(client, SYSTEM, content, SCHEMA, raw_dir, "review")
    finished = time.perf_counter()

    message = json.loads((raw_dir / "review.json").read_text())
    usage = message["usage"]
    cost = (usage["input_tokens"] * PRICE_INPUT + usage["output_tokens"] * PRICE_OUTPUT) / 1_000_000
    metrics = {
        "model": message["model"],
        "stop_reason": message["stop_reason"],
        "input_tokens": usage["input_tokens"],
        "output_tokens": usage["output_tokens"],
        "cost_usd": round(cost, 3),
        "prepare_seconds": round(prepared - started, 1),
        "api_seconds": round(finished - before_call, 1),
        "total_seconds": round(finished - started, 1),
    }
    write_json(raw_dir / "metrics.json", metrics)
    write_json(raw_dir / "result.json", reply)
    print(json.dumps(metrics, ensure_ascii=False))
    print(f"指摘 {len(reply['findings'])} 件、読めなかった箇所 {len(reply['unreadable'])} 件。結果: {raw_dir}")


if __name__ == "__main__":
    main()
