"""図面の1ページをAIに読ませて、決めた形式で返してもらう。

AIには画像だけを渡す。PDFから取り出した文字を見せると、文字とAIの読みが一致しても別々に確かめたことにならない。
"""
from pathlib import Path

SYSTEM_COMMON = """あなたは建物の構造図を読む担当です。図面の1ページの画像（1枚目が全体、残りは文字を読むための分割図）から、決めた形式で情報を取り出します。

守ること:
- 図面に書かれている値だけを書きます。読めない値や書かれていない値を、推測や計算で埋めません。読めないものは unreadable に書きます。
- 朱書き（赤字）の訂正や削除があるときは、訂正後の内容を読みます。
- 通りの名前は図面の表記のまま（X1、Y3 など）で書きます。
- 階の名前は 基礎、1F、2F、3F、…、RF、PHRF（塔屋の屋根）に揃えます。「2階伏図」の梁は 2F、「R階伏図」の梁は RF です。"""

PLAN_SYSTEM = SYSTEM_COMMON + """

このページは伏図です。1ページに複数の図があるときは、plans に図ごとに書きます。次を読みます。
- floors：その図が当てはまる階を全部（「3~5階伏図」なら 3F、4F、5F）。奇数階と偶数階で図が分かれていれば、それぞれ別の図として書きます
- region：その図の範囲（ページ全体に対する 0〜1 の [x0, y0, x1, y1]）。寸法と通りの記号が入るように囲みます
- grids_x（左から順）、grids_y（下から順）：通りの名前
- spans：隣り合う通りの間の寸法（mm）。axis は x か y
- overall：全体の寸法（mm）。どの通りからどの通りまでか
- beams：通り芯の上にある大梁（G、FG、CG などの符号）。小梁（B で始まる符号）やデッキは書きません
  - 1本ずつ、along（載っている通り）、from、to（両端の通り）を書きます。同じ符号が複数の区間に続くときは、まとめても区間ごとでも構いません
  - offset_mm、offset_end_mm：その階の基準（FL または SL）からの梁天端の差（mm）。from 側と to 側の値です。図の注記の既定値（例：特記なき梁天端は FL-130）も適用した値を書きます。読めないときは null"""

FRAME_SYSTEM = SYSTEM_COMMON + """

このページは軸組図です。1ページに複数の通りの図があります。frames に通りごとに書きます。
- line：その図の通りの名前
- levels：下から順の階。name と story_mm（その階から1つ上の階までの高さ mm。一番上は null）
- columns：柱。mark（符号）、at（交差する通りの名前）、floor（その柱が立つ階。1階から2階までの柱は 1F）
- beams：大梁。mark、floor（その梁が載る階）、from、to。小梁は書きません
- overall_height：全体の高さの寸法があれば、mm と from（どこから。GL、1FL など図の表記）、to
- foundation_top_mm：基礎梁の天端が 1FL からどれだけ違うか（mm。下なら負の値）。1つの寸法がなく、基礎梁天端〜GL と GL〜1FL のように分かれて書かれているときは足した値を書きます。読めないときは null
- slopes：屋根などで梁に勾配があるとき、階ごとに書きます。floor、high（水上の通り）、low（水下の通り）、drop_mm（水上と水下の高さの差。書かれていなければ null）、ratio（勾配の表記のまま。例：2/100。なければ空）。この図の範囲で分かるものだけで構いません"""

LIST_SYSTEM = SYSTEM_COMMON + """

このページは部材のリストです。柱と大梁と基礎梁の断面を sections に書きます。小梁、スラブ、壁、継手は書きません。
- mark：符号
- floors：その行が当てはまる階（書かれていれば）。全階なら空のリスト
- position：端部、中央部などの区別（なければ空）
- text：断面の表記のまま（例：H-400×200×8×13、400×800）
- depth_mm、width_mm：せいと幅（mm）。表記から直接読めるときだけ。読めないときは null"""


def nullable_number():
    return {"type": ["number", "null"]}


def strict(properties):
    return {"type": "object", "additionalProperties": False, "required": list(properties), "properties": properties}


TEXT = {"type": "string"}
TEXTS = {"type": "array", "items": TEXT}
NUMBER = {"type": "number"}

SPAN = strict({"axis": {"type": "string", "enum": ["x", "y"]}, "from": TEXT, "to": TEXT, "mm": NUMBER})

PLAN_SCHEMA = strict({
    "plans": {"type": "array", "items": strict({
        "floors": TEXTS,
        "region": {"type": "array", "items": NUMBER},
        "grids_x": TEXTS,
        "grids_y": TEXTS,
        "spans": {"type": "array", "items": SPAN},
        "overall": {"type": "array", "items": SPAN},
        "beams": {"type": "array", "items": strict({
            "mark": TEXT, "along": TEXT, "from": TEXT, "to": TEXT, "offset_mm": nullable_number(), "offset_end_mm": nullable_number()})},
    })},
    "unreadable": TEXTS,
})

FRAME_SCHEMA = strict({
    "frames": {"type": "array", "items": strict({
        "line": TEXT,
        "levels": {"type": "array", "items": strict({"name": TEXT, "story_mm": nullable_number()})},
        "columns": {"type": "array", "items": strict({"mark": TEXT, "at": TEXT, "floor": TEXT})},
        "beams": {"type": "array", "items": strict({"mark": TEXT, "floor": TEXT, "from": TEXT, "to": TEXT})},
        "overall_height": {"anyOf": [{"type": "null"}, strict({"mm": NUMBER, "from": TEXT, "to": TEXT})]},
        "foundation_top_mm": nullable_number(),
        "slopes": {"type": "array", "items": strict({"floor": TEXT, "high": TEXT, "low": TEXT, "drop_mm": nullable_number(), "ratio": TEXT})},
    })},
    "unreadable": TEXTS,
})

LIST_SCHEMA = strict({
    "sections": {"type": "array", "items": strict({
        "mark": TEXT, "floors": TEXTS, "position": TEXT, "text": TEXT, "depth_mm": nullable_number(), "width_mm": nullable_number()})},
    "unreadable": TEXTS,
})

READERS = {
    "伏図": (PLAN_SYSTEM, PLAN_SCHEMA, (3, 2)),
    "軸組図": (FRAME_SYSTEM, FRAME_SCHEMA, (3, 2)),
    "リスト": (LIST_SYSTEM, LIST_SCHEMA, (4, 3)),
}


def build_content(page, kind, image_block, render, tiles):
    columns, rows = READERS[kind][2]
    content = [{"type": "text", "text": "図面：全体図"}, image_block(render(page))]
    for png, place in tiles(page, columns, rows):
        content += [{"type": "text", "text": f"図面：{place} の分割図"}, image_block(png)]
    content.append({"type": "text", "text": "このページを読み取ってください。"})
    return content
