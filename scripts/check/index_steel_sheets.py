"""鉄骨施工図の各ページに何が描かれているかを Claude API で読み、部材から施工図を引くための索引を作る。

  python index_steel_sheets.py            # 全ページ
  python index_steel_sheets.py --pages 2,6

文字データのない図面なので、画像から読む。公開画像で隠す名前の候補も同時に探す（最後は目で確認する）。
生の結果は ~/sekozu-data/experiments/sheet-index/ に保存し、費用は ledger.json に記録する。
"""
import argparse
import json
import os
import sys
from concurrent.futures import ThreadPoolExecutor

import anthropic
import pymupdf

from ai_review import MODEL, call_claude, load_env
from common import write_json
from repeat_runs import PRICE_INPUT, PRICE_OUTPUT
from review_steel_sheet import red_pixels, render
from steel_experiment import ROOT, image_block, record_cost, tiles

OUT = ROOT / "sheet-index"
WORKERS = 4

SYSTEM = """あなたは鉄骨施工図の読み取り担当です。施工図の1ページの画像から、次を読み取って返します。

- title: 図面枠の図面名称
- kind: 図面の種類
- frames: ページの中の図ごとに、図の名前、通り（軸組図なら X1 や Y2。伏図なら空）、レベル（伏図なら 2SL など。軸組図なら空）、図に書かれた部材符号、ページ全体に対する 0〜1 の範囲 [x0, y0, x1, y1]
- marks: ページ全体の部材符号（柱 C、大梁 G、小梁 B、片持梁 CG、間柱 P など。部材リストの符号も含む）
- sensitive: 図面枠や注記にある会社名、人名、住所、電話番号、印の、文字とページ全体に対する範囲

判断の基準:
- 読めたものだけを書きます。読めない符号は推測しません。
- 部材の符号以外（継手記号、ボルト記号など）は marks に入れません。"""

SCHEMA = {
    "type": "object",
    "additionalProperties": False,
    "required": ["title", "kind", "frames", "marks", "sensitive"],
    "properties": {
        "title": {"type": "string"},
        "kind": {"type": "string", "enum": ["アンカープラン", "伏図", "軸組図", "継手基準図", "階段", "手摺", "受け材", "その他"]},
        "frames": {
            "type": "array",
            "items": {
                "type": "object",
                "additionalProperties": False,
                "required": ["name", "grid_line", "level", "marks", "region"],
                "properties": {
                    "name": {"type": "string"},
                    "grid_line": {"type": "string"},
                    "level": {"type": "string"},
                    "marks": {"type": "array", "items": {"type": "string"}},
                    "region": {"type": "array", "items": {"type": "number"}},
                },
            },
        },
        "marks": {"type": "array", "items": {"type": "string"}},
        "sensitive": {
            "type": "array",
            "items": {
                "type": "object",
                "additionalProperties": False,
                "required": ["text", "kind", "region"],
                "properties": {
                    "text": {"type": "string"},
                    "kind": {"type": "string", "enum": ["会社名", "人名", "住所", "電話番号", "印", "その他"]},
                    "region": {"type": "array", "items": {"type": "number"}},
                },
            },
        },
    },
}


def index_page(client, sheet_path, page_no):
    page = pymupdf.open(sheet_path)[page_no - 1]
    if red_pixels(page):
        sys.exit(f"p{page_no} に赤い部分があります")
    content = [{"type": "text", "text": "施工図：全体図"}, image_block(render(page))]
    for png, place in tiles(page, 3, 2):
        content += [{"type": "text", "text": f"施工図：{place} の分割図"}, image_block(png)]
    content.append({"type": "text", "text": "このページを読み取ってください。"})

    raw_dir = OUT / f"p{page_no}"
    reply = call_claude(client, SYSTEM, content, SCHEMA, raw_dir, "index")
    usage = json.loads((raw_dir / "index.json").read_text())["usage"]
    usd = round((usage["input_tokens"] * PRICE_INPUT + usage["output_tokens"] * PRICE_OUTPUT) / 1_000_000, 3)
    record_cost(ROOT / "ledger.json", f"index-p{page_no}", usd)
    write_json(raw_dir / "result.json", reply)
    return page_no, usd, reply["title"]


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--pages", help="カンマ区切り。省略すると全ページ")
    args = parser.parse_args()
    config = json.loads((ROOT / "config.json").read_text())
    total = len(pymupdf.open(config["sheet"]))
    pages = [int(p) for p in args.pages.split(",")] if args.pages else range(1, total + 1)

    load_env()
    if not os.environ.get("ANTHROPIC_API_KEY"):
        sys.exit(".env.local に ANTHROPIC_API_KEY がありません")
    client = anthropic.Anthropic()
    print(f"モデル {MODEL}、{len(pages)} ページ")
    with ThreadPoolExecutor(WORKERS) as pool:
        results = list(pool.map(lambda p: index_page(client, config["sheet"], p), pages))
    for page_no, usd, title in results:
        print(f"p{page_no} {usd:.3f} ドル {title}")
    print(f"合計 {sum(r[1] for r in results):.2f} ドル")


if __name__ == "__main__":
    main()
