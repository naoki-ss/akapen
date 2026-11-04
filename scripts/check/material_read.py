"""意匠図の平面図と立面図から、外装の素材と庇を読む。AIの費用はここだけ（読み終えたページは使い回す）。

  python material_read.py <物件の設定名>    例：honsha

素材の種類はAIに決めさせず、図面の仕上げの文字からプログラムで決める（build_materials が使う）。
色と質感は lib/materials.ts の対応表で決まる。物件ごとに色を決めない。
"""
import re
import sys
from concurrent.futures import ThreadPoolExecutor

import anthropic
import pymupdf

from ai_review import call_claude, load_env
from check_upload import EXPERIMENTS, message_cost
from common import PRIVATE, write_json
from review_steel_sheet import render
from steel_experiment import image_block, record_cost, tiles

SIDES = ["north", "south", "east", "west"]
NUMBER = {"type": ["number", "null"]}
TEXT = {"type": "string"}

COMMON = """あなたは建物の意匠図を読む担当です。図面の1ページの画像（1枚目が全体、残りは文字を読むための拡大）を渡します。

守ること:
- 図面に書かれていることだけを書きます。読めないものは書かず、unreadable に理由を書きます。
- 通りの名前は図面の表記のまま（X1、Y3 など）で書きます。事務所名や人の名前は書きません。"""

ELEVATION_SYSTEM = COMMON + """

このページは立面図です。外装の素材を読みます。
- finishes：外装仕上の凡例。code は図面の記号（A、B…）、text は仕上げの文のまま
- views：1ページに複数の立面があれば分けます。side は north、south、east、west
  - zones：外壁の面のうち、どの範囲がどの仕上げか。finish_code、from_grid と to_grid（範囲の両端の通り。その立面に見える通り）、bottom_mm と top_mm（設計GLからの高さ。図面全体の高さなら null）。ガラス面は書きません
  - glass_finish_code：ガラス面やサッシの仕上げの記号（なければ null）"""

PLAN_SYSTEM = COMMON + """

このページは平面図です。建物の外に出ているものを読みます。
- projections：庇、キャノピー、手すりなど、外壁から外に出ているもの。kind は 庇、キャノピー、手すり のいずれか。text は図面の名前のまま（グレーチング庇 など）。side は図面の上を north とした面。from_grid と to_grid は範囲の両端の通り。from_offset_mm と to_offset_mm はその通りからの距離（X は右が正、Y は上が正。なければ 0）。depth_mm は外壁からの出（書かれていなければ null）
外部階段、室外機、植栽は書きません。"""


def strict(properties):
    return {"type": "object", "additionalProperties": False, "required": list(properties), "properties": properties}


def array(item):
    return {"type": "array", "items": item}


SIDE = {"type": "string", "enum": SIDES}
ELEVATION_SCHEMA = strict({
    "finishes": array(strict({"code": TEXT, "text": TEXT})),
    "views": array(strict({
        "side": SIDE,
        "zones": array(strict({"finish_code": TEXT, "from_grid": TEXT, "to_grid": TEXT, "bottom_mm": NUMBER, "top_mm": NUMBER})),
        "glass_finish_code": {"type": ["string", "null"]},
    })),
    "unreadable": array(TEXT),
})
PLAN_SCHEMA = strict({
    "projections": array(strict({
        "kind": {"type": "string", "enum": ["庇", "キャノピー", "手すり"]}, "text": TEXT, "side": SIDE,
        "from_grid": TEXT, "from_offset_mm": {"type": "number"}, "to_grid": TEXT, "to_offset_mm": {"type": "number"}, "depth_mm": NUMBER,
    })),
    "unreadable": array(TEXT),
})

# 物件ごとの意匠図の場所とページ。ページの選び方だけが物件ごとに違う
SOURCES = {
    "honsha": {
        "pdf": PRIVATE / "honsha" / "ishou_0730.pdf",
        "raw": PRIVATE / "projects" / "sample-b-new" / "materials",
        "plans": {12: "1F", 13: "2F", 14: "3F", 15: "PH"},
        "elevations": [16, 17, 18],
    },
}


def read_page(client, doc, raw_dir, number, system, schema):
    result = raw_dir / f"p{number}-result.json"
    if result.exists():
        return 0.0
    page = doc[number - 1]
    content = [{"type": "text", "text": "図面：全体図"}, image_block(render(page))]
    for png, place in tiles(page, 3, 2):
        content += [{"type": "text", "text": f"図面：{place} の分割図"}, image_block(png)]
    content.append({"type": "text", "text": "このページを読み取ってください。"})
    reply = call_claude(client, system, content, schema, raw_dir, f"p{number}")
    write_json(result, reply)
    return message_cost(raw_dir / f"p{number}.json")[2]


def main():
    source = SOURCES[sys.argv[1]]
    load_env()
    raw_dir = source["raw"]
    raw_dir.mkdir(parents=True, exist_ok=True)
    client = anthropic.Anthropic()
    doc = pymupdf.open(source["pdf"])
    jobs = [(n, PLAN_SYSTEM, PLAN_SCHEMA) for n in source["plans"]] + [(n, ELEVATION_SYSTEM, ELEVATION_SCHEMA) for n in source["elevations"]]
    with ThreadPoolExecutor(3) as pool:
        costs = list(pool.map(lambda job: read_page(client, doc, raw_dir, *job), jobs))
    total = round(sum(costs), 3)
    if total:
        record_cost(EXPERIMENTS / "ledger.json", f"materials-{sys.argv[1]}", total)
    print(f"費用 {total} ドル")


if __name__ == "__main__":
    main()
