"""意匠図から外観（外壁、窓、屋根、パラペット、部屋名）を読み、建物データに足す。どの建物でも同じ処理で動く。

  python exterior_read.py read  --pdf 意匠図.pdf --folder 置き場所                  ページの種類を判定して読む（費用はここだけ）
  python exterior_read.py build --pdf 意匠図.pdf --folder 置き場所 --model 骨組み.json --out 結果.json

位置は通り芯からの距離で読ませ、プログラムで mm にする。AIに形を描かせない。素材の種類は仕上げの文字から
プログラムで決め、色と質感は lib/materials.ts の対応表で決まる。読めないものは「要確認」にして止めない。
"""
import argparse
import json
import re
import sys
import unicodedata
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import anthropic
import pymupdf

from building_pages import display_words
from claude_api import METER, call_claude, load_env
from common import write_json
from review_steel_sheet import render
from steel_experiment import ROOT as EXPERIMENTS, image_block, record_cost, tiles

SIDES = ["north", "south", "east", "west"]
NUMBER = {"type": ["number", "null"]}
TEXT = {"type": "string"}
PARALLEL = 3
KINDS = ["平面図", "立面図", "断面図", "仕上表", "建具表", "その他"]
TALL = 10**6


def strict(properties):
    return {"type": "object", "additionalProperties": False, "required": list(properties), "properties": properties}


def array(item):
    return {"type": "array", "items": item}


COMMON = """あなたは建物の意匠図を読む担当です。図面の1ページの画像（1枚目が全体、残りは文字を読むための拡大）を渡します。

守ること:
- 図面に書かれていることだけを書きます。読めない値を推測で埋めません。読めないものは unreadable に理由を書きます。
- 通りの名前は図面の表記のまま（X1、Y3 など）で書きます。事務所名や人の名前は書きません。"""

CLASSIFY_SYSTEM = """建物の意匠図の1ページの種類を答えます。
- kind：平面図、立面図、断面図（矩計図を含む）、仕上表（外部の仕上げの表があるページ）、建具表、その他（配置図、案内図、展開図、天井伏図、屋根伏図など）
- floor：平面図のときの階。1F、2F、3F、PH（塔屋）のように書きます。1ページに複数の階があれば floors に全部書きます。平面図でなければ空のリスト"""
CLASSIFY_SCHEMA = strict({"kind": {"type": "string", "enum": KINDS}, "floors": array(TEXT)})

POINT = strict({"x_grid": TEXT, "x_offset_mm": {"type": "number"}, "y_grid": TEXT, "y_offset_mm": {"type": "number"}})

PLAN_SYSTEM = COMMON + """

このページは平面図です。階ごとに plans に分けます。図面の上を north、右を east、下を south、左を west とします。
- floor：階（1F、2F、PH など）
- north_deg：方位記号の N が図面の上から時計回りに何度か。おおよそでかまいません。読めなければ null
- outline：その階の室内がある部分の、外壁の外周の角を順に。各点は最も近い通りと、そこからの距離（mm。X は右が正、Y は上が正）で書きます。下の階の屋根、屋上、バルコニー、庇、キャノピーは含めません。塔屋の階は塔屋の部分だけです
- enclosures：外周とは別に壁で囲まれた部分（外部階段の囲いなど）。name と points（outline と同じ形）。なければ空
- rooms：部屋。name は図面の表記のまま、area_m2 は書かれた面積（なければ null）、x_from、x_to、y_from、y_to はその部屋を囲む通り
- openings：外壁の開口。side は外壁の面。from_grid、from_offset_mm、to_grid、to_offset_mm は開口の両端（side が north、south のときは X の通り、east、west のときは Y の通り）。kind は 窓、カーテンウォール、扉、シャッター のいずれか。code は建具の記号（AW-1 など。なければ空）
- projections：庇、キャノピー、手すりなど外壁から外に出ているもの。kind は 庇、キャノピー、手すり のいずれか。text は図面の名前のまま。side、from_grid、to_grid、from_offset_mm、to_offset_mm（なければ 0）、depth_mm（外壁からの出。なければ null）
外部階段の段、室外機、植栽、家具は書きません。"""

PLAN_SCHEMA = strict({"plans": array(strict({
    "floor": TEXT,
    "north_deg": NUMBER,
    "outline": array(POINT),
    "enclosures": array(strict({"name": TEXT, "points": array(POINT)})),
    "rooms": array(strict({"name": TEXT, "area_m2": NUMBER, "x_from": TEXT, "x_to": TEXT, "y_from": TEXT, "y_to": TEXT})),
    "openings": array(strict({"side": {"type": "string", "enum": SIDES}, "from_grid": TEXT, "from_offset_mm": {"type": "number"},
                              "to_grid": TEXT, "to_offset_mm": {"type": "number"},
                              "kind": {"type": "string", "enum": ["窓", "カーテンウォール", "扉", "シャッター"]}, "code": TEXT})),
    "projections": array(strict({"kind": {"type": "string", "enum": ["庇", "キャノピー", "手すり"]}, "text": TEXT,
                                 "side": {"type": "string", "enum": SIDES}, "from_grid": TEXT, "to_grid": TEXT,
                                 "from_offset_mm": {"type": "number"}, "to_offset_mm": {"type": "number"}, "depth_mm": NUMBER})),
})), "unreadable": array(TEXT)})

ELEVATION_SYSTEM = COMMON + """

このページは立面図です。1ページに複数の立面があれば views に分けます。
- finishes：外装の仕上げの凡例や記入。code は記号（なければ通し番号）、text は仕上げの文のまま
- side：図面の名前に書かれた面（north、south、east、west）。読めなければ 不明
- levels：高さの記入。name は図面の表記のまま（設計GL、1FL、2FL、RFL、水上、水下、笠木など）、elevation_mm は設計GLからの高さ
- parapet_top_mm：主屋根のパラペット（笠木）の上端の高さ。ph_top_mm：塔屋の笠木の高さ（どちらも設計GLから。なければ null）
- bands：階ごとの窓の高さ。floor、sill_mm（その階の床から窓の下端）、head_mm（その階の床から窓の上端）。寸法の記入がなければ、図の縮尺から読み取り estimated を true にします
- windows：その立面に見える窓、ガラス面、扉、シャッターの全部。floor、kind（窓、カーテンウォール、扉、シャッター）、from_grid、from_offset_mm、to_grid、to_offset_mm（両端の最も近い通りとそこからの距離。図の右へ向かう向きでなく、通りの番号が増える向きを正とします）、sill_mm と head_mm（その階の床から下端と上端）。寸法の記入がなければ図の縮尺から読みます
- zones：外壁の面のうち、どの範囲がどの仕上げか。finish_code、from_grid、to_grid（その立面に見える通り）、bottom_mm、top_mm（設計GLから。図面全体の高さなら null）。ガラス面は書きません
- glass_finish_code：ガラス面やサッシの仕上げの記号（なければ空）"""

ELEVATION_SCHEMA = strict({
    "finishes": array(strict({"code": TEXT, "text": TEXT})),
    "views": array(strict({
        "side": {"type": "string", "enum": [*SIDES, "不明"]},
        "levels": array(strict({"name": TEXT, "elevation_mm": {"type": "number"}})),
        "parapet_top_mm": NUMBER,
        "ph_top_mm": NUMBER,
        "bands": array(strict({"floor": TEXT, "sill_mm": {"type": "number"}, "head_mm": {"type": "number"}, "estimated": {"type": "boolean"}})),
        "windows": array(strict({"floor": TEXT, "kind": {"type": "string", "enum": ["窓", "カーテンウォール", "扉", "シャッター"]},
                                 "from_grid": TEXT, "from_offset_mm": {"type": "number"}, "to_grid": TEXT, "to_offset_mm": {"type": "number"},
                                 "sill_mm": {"type": "number"}, "head_mm": {"type": "number"}})),
        "zones": array(strict({"finish_code": TEXT, "from_grid": TEXT, "to_grid": TEXT, "bottom_mm": NUMBER, "top_mm": NUMBER})),
        "glass_finish_code": TEXT,
    })),
    "unreadable": array(TEXT),
})

SECTION_SYSTEM = COMMON + """

このページは断面図です。
- levels：高さの記入。name は図面の表記のまま、elevation_mm は設計GLからの高さ
- parapet_top_mm：パラペット（笠木）の上端の高さ（設計GLから。なければ null）
- roof_level_mm：屋根の高さ（勾配があれば水上。設計GLから。なければ null）
- finishes：図に書かれた外壁と屋根の仕上げ。part は 外壁 か 屋根、text は仕上げの文のまま"""

SECTION_SCHEMA = strict({
    "levels": array(strict({"name": TEXT, "elevation_mm": {"type": "number"}})),
    "parapet_top_mm": NUMBER,
    "roof_level_mm": NUMBER,
    "finishes": array(strict({"part": {"type": "string", "enum": ["外壁", "屋根"]}, "text": TEXT})),
    "unreadable": array(TEXT),
})

FINISH_SYSTEM = COMMON + """

このページの外部の仕上げを読みます。内部の仕上げは書きません。
- items：part は 外壁、屋根、塔屋の屋根、笠木、サッシ、庇、その他 のいずれか。text は仕上げの文のまま"""

FINISH_SCHEMA = strict({
    "items": array(strict({"part": {"type": "string", "enum": ["外壁", "屋根", "塔屋の屋根", "笠木", "サッシ", "庇", "その他"]}, "text": TEXT})),
    "unreadable": array(TEXT),
})

DOOR_SYSTEM = COMMON + """

このページは建具表です。外部に面する建具だけを items に書きます。
- code：記号。kind：窓、カーテンウォール、扉、シャッター のいずれか。width_mm、height_mm：幅と高さ。sill_mm：床から建具の下端まで（書かれていなければ null）。material：材質の文のまま"""

DOOR_SCHEMA = strict({
    "items": array(strict({"code": TEXT, "kind": {"type": "string", "enum": ["窓", "カーテンウォール", "扉", "シャッター"]},
                           "width_mm": NUMBER, "height_mm": NUMBER, "sill_mm": NUMBER, "material": TEXT})),
    "unreadable": array(TEXT),
})

READERS = {"平面図": (PLAN_SYSTEM, PLAN_SCHEMA), "立面図": (ELEVATION_SYSTEM, ELEVATION_SCHEMA), "断面図": (SECTION_SYSTEM, SECTION_SCHEMA),
           "仕上表": (FINISH_SYSTEM, FINISH_SCHEMA), "建具表": (DOOR_SYSTEM, DOOR_SCHEMA)}


# ページの種類を図面の文字から決める。図面枠の図名の近くの語を見る
TITLE_KINDS = [("平面図", r"\d階平面図|塔屋階?平面図|PH階?平面図|[RＲ]階?平面図"), ("立面図", r"立面図"), ("断面図", r"矩計図|断面図"),
               ("仕上表", r"外部仕上|仕上表"), ("建具表", r"建具表")]
# 種類ごとの読むページ数の上限。多いページの図面でも費用が膨らまないように
MAX_PAGES = {"断面図": 3, "建具表": 2, "仕上表": 2}
USD_PER_PAGE = 0.3
USD_PER_KIND = 0.03


def kind_from_text(page):
    """(種類, 階)。図面枠（下の帯）の文字だけを見る。分からなければ None"""
    words = page.get_text("words")
    height = page.rect.height
    width = page.rect.width
    # 図面枠はページの下か右にある。回転しているページは見た目の向きで考えない
    frame = "".join(w[4] for w in words if w[1] > height * 0.85 or w[0] > width * 0.85)
    plain = re.sub(r"\s", "", unicodedata.normalize("NFKC", frame))
    for kind, pattern in TITLE_KINDS:
        if re.search(pattern, plain):
            floors = re.findall(r"(\d+)階", plain) if kind == "平面図" else []
            return kind, [f"{number}F" for number in floors]
    return None


def read_all(pdf, folder, max_usd=3.0):
    """読む。費用（ドル）を返す"""
    load_env()
    spent_before = METER.total()
    client = anthropic.Anthropic()
    raw = folder / "raw"
    raw.mkdir(parents=True, exist_ok=True)
    (folder / "reads").mkdir(parents=True, exist_ok=True)
    doc = pymupdf.open(pdf)

    def classify(number):
        path = folder / "reads" / f"p{number}-kind.json"
        if path.exists():
            return number, json.loads(path.read_text())
        known = kind_from_text(doc[number - 1])
        if known:
            reply = {"kind": known[0], "floors": known[1]}
            write_json(path, reply)
            return number, reply
        if METER.total() - spent_before + USD_PER_KIND > max_usd:
            return number, {"kind": "その他", "floors": []}
        reply = call_claude(client, CLASSIFY_SYSTEM, [image_block(render(doc[number - 1])), {"type": "text", "text": "このページの種類を答えてください。"}],
                            CLASSIFY_SCHEMA, raw, f"p{number}-kind", effort="low")
        write_json(path, reply)
        return number, reply

    def read(row):
        number, kind = row
        path = folder / "reads" / f"p{number}.json"
        if path.exists():
            return
        system, schema = READERS[kind]
        page = doc[number - 1]
        content = [{"type": "text", "text": "図面：全体図"}, image_block(render(page))]
        for png, place in tiles(page, 3, 2):
            content += [{"type": "text", "text": f"図面：{place} の分割図"}, image_block(png)]
        content.append({"type": "text", "text": "このページを読み取ってください。"})
        write_json(path, {"page": number, "kind": kind, "reply": call_claude(client, system, content, schema, raw, f"p{number}", effort="medium")})

    with ThreadPoolExecutor(PARALLEL) as pool:
        kinds = list(pool.map(classify, range(1, doc.page_count + 1)))
    for number, reply in kinds:
        print(number, reply["kind"], reply["floors"])
    targets, counted, planned = [], {}, set()
    for number, reply in kinds:
        kind = reply["kind"]
        # 平面図は階ごとに最初のページだけ読む（あとのページは部分詳細のことが多い）
        if kind == "平面図":
            if reply["floors"] and set(reply["floors"]) <= planned:
                continue
            planned |= set(reply["floors"])
        counted[kind] = counted.get(kind, 0) + 1
        if kind in READERS and counted[kind] <= MAX_PAGES.get(kind, 99):
            targets.append((number, kind))
    pending = [row for row in targets if not (folder / "reads" / f"p{row[0]}.json").exists()]
    # 上限に収まるところまで読む。読めなかったページは build で「読んでいません」にはならず、読めた分で組み立てる
    room = max(0, int((max_usd - (METER.total() - spent_before)) / USD_PER_PAGE))
    if len(pending) > room:
        print(f"費用の上限 {max_usd} ドルに収まるよう、{len(pending)} ページのうち {room} ページだけ読みます")
        pending = pending[:room]
    with ThreadPoolExecutor(PARALLEL) as pool:
        list(pool.map(read, pending))
    classify_finishes(client, folder)
    spent = METER.total() - spent_before
    record_cost(EXPERIMENTS / "ledger.json", f"exterior-{folder.name}", round(spent, 3))
    print(f"費用 {spent:.3f} ドル")
    return spent


FINISH_TYPE_SYSTEM = """建物の外装の仕上げの文を読み、それぞれの種類を選びます。製品名や型番からも判断します。下地や断熱材は見ず、一番外側の仕上げで決めます。
- metal_siding：金属サイディング、角波、スパンドレル、ガルバリウム鋼板の壁
- siding：窯業系サイディング
- alc：ALCパネル
- extruded_cement：押出成形セメント板
- concrete：コンクリート打放し
- spray_tile：吹付タイル、吹付塗装
- tile：タイル
- mortar：モルタル
- painted_wall：塗装の壁
- aluminum_panel：アルミパネル
- aluminum_curtain_wall：サッシ、カーテンウォール
- aluminum_cap：笠木
- metal_louver：ルーバー、パンチングメタル
- steel_grating：グレーチング
- metal_roof：折板、金属屋根
- roof_membrane：防水の屋根
- none：外装の仕上げではない、分からない"""
FINISH_TYPES = ["metal_siding", "siding", "alc", "extruded_cement", "concrete", "spray_tile", "tile", "mortar", "painted_wall", "aluminum_panel",
                "aluminum_curtain_wall", "aluminum_cap", "metal_louver", "steel_grating", "metal_roof", "roof_membrane", "none"]


def finish_texts(folder):
    """読み取りに出てきた仕上げの文の全部"""
    texts = set()
    for path in (folder / "reads").glob("p*.json"):
        reply = json.loads(path.read_text()).get("reply", {})
        texts |= {item["text"] for item in reply.get("items", []) if "part" in item}
        texts |= {item["text"] for item in reply.get("finishes", [])}
    return sorted(texts)


def classify_finishes(client, folder):
    """仕上げの文を種類に分ける。文字だけなので費用はわずか。結果は finish-types.json"""
    path = folder / "finish-types.json"
    known = json.loads(path.read_text()) if path.exists() else {}
    pending = [text for text in finish_texts(folder) if text not in known]
    if not pending:
        return
    schema = strict({"items": array(strict({"index": {"type": "integer"}, "type": {"type": "string", "enum": FINISH_TYPES}}))})
    lines = "\n".join(f"{index}: {text}" for index, text in enumerate(pending))
    reply = call_claude(client, FINISH_TYPE_SYSTEM, [{"type": "text", "text": lines}], schema, folder / "raw", "finish-types", effort="low")
    known.update({pending[row["index"]]: row["type"] for row in reply["items"] if 0 <= row["index"] < len(pending)})
    write_json(path, known)


# 仕上げの文から素材の種類を決める。上から順に見る。色と質感は lib/materials.ts の対応表で決まる
MATERIAL_RULES = [
    (r"カーテンウォール|サッシ", "aluminum_curtain_wall"),
    (r"グレーチング", "steel_grating"),
    (r"パンチング|ルーバー", "metal_louver"),
    (r"折版|折板|立平|瓦棒", "metal_roof"),
    (r"笠木", "aluminum_cap"),
    (r"アルミパネル|アルミ", "aluminum_panel"),
    (r"角波|スパンドレル|金属サイディング|ガルバリウム|ガルバ|溶融亜鉛メッキ鋼板|鋼板", "metal_siding"),
    (r"窯業|サイディング", "siding"),
    # タイル貼の下地にセメント板が書かれることがあるので、タイルを先に見る
    (r"吹付|吹き付け", "spray_tile"),
    (r"タイル", "tile"),
    (r"押出|セメント板", "extruded_cement"),
    (r"ALC|アスロック", "alc"),
    (r"モルタル|刷毛引", "mortar"),
    (r"コンクリート|打放", "concrete"),
    (r"防水|ルーフィング", "roof_membrane"),
    (r"塗装|塗り", "painted_wall"),
]
STANDARD_WALL = "standard_wall"
STANDARD_GLASS = "aluminum_curtain_wall"
STANDARD_ROOF = "roof_membrane"
PROJECTION_THICKNESS = {"庇": 150, "キャノピー": 450, "手すり": 1100}
# 仮の窓の高さ（床から）。幅の広い開口はファサードの大開口として階の高さに合わせる
WIDE_OPENING = 3000
USUAL_WINDOW = (900, 2700)
BEARING = {"north": 0, "east": 90, "south": 180, "west": 270}
PLAN_SIDE = {0: "north", 90: "east", 180: "south", 270: "west"}


FINISH_TYPE_OF = {}


def material_of(text):
    """AIの分類があればそれを使う。なければ文字の決まりで決める"""
    kind = FINISH_TYPE_OF.get(text)
    if kind:
        return None if kind == "none" else kind
    for pattern, key in MATERIAL_RULES:
        if re.search(pattern, unicodedata.normalize("NFKC", text)):
            return key
    return None


def door_key(code):
    """建具の記号のゆれをそろえる（AW-4、4AW、AW4 を同じにする）"""
    plain = unicodedata.normalize("NFKC", code).upper()
    letters = "".join(re.findall(r"[A-Z]+", plain))
    numbers = "".join(re.findall(r"\d+", plain))
    return letters + numbers


def projection_height(row, floor, is_ground):
    """庇の高さ。平面図に高さの記入がないので決める。1階の庇は開口の上、上の階の庇はその階の床の高さ"""
    if not is_ground:
        return floor["z0"]
    heads = [o["z1"] for o in floor["openings"] if o["side"] == row["side"]]
    return max(heads) if heads else floor["z0"] + 2700


def floor_name(text):
    """図面の階の呼び名を、建物データの階の名前にする"""
    plain = unicodedata.normalize("NFKC", text).replace(" ", "").upper()
    if plain.startswith(("PH", "塔屋")):
        return "PH"
    match = re.match(r"(\d+)", plain)
    return f"{match.group(1)}F" if match else None


def build(pdf, folder, model_path, out):
    model = json.loads(Path(model_path).read_text())
    model.pop("architecture", None)
    grid_x, grid_y, levels = model["grid_x"], model["grid_y"], model["levels"]
    grids = {**grid_x, **grid_y}
    names = list(levels)
    doc = pymupdf.open(pdf)
    checks = []
    types_path = folder / "finish-types.json"
    if types_path.exists():
        FINISH_TYPE_OF.update(json.loads(types_path.read_text()))
    reads = [json.loads(path.read_text()) for path in sorted((folder / "reads").glob("p*.json")) if not path.name.endswith("-kind.json")]
    of_kind = lambda kind: [row for row in reads if row["kind"] == kind]

    def need(kind, message):
        checks.append({"kind": kind, "result": "要確認", "message": message})

    def on_grid(name, offset):
        return grids[name] + offset if name in grids else None

    def to_point(point):
        x, y = on_grid(point["x_grid"], point["x_offset_mm"]), on_grid(point["y_grid"], point["y_offset_mm"])
        return [x, y] if x is not None and y is not None else None

    for row in reads:
        for text in row["reply"].get("unreadable", []):
            need(row["kind"], f"p.{row['page']} {text}")

    # 高さ：立面と断面の記入は設計GLから。建物データの高さは 1FL から測る
    rows, parapets, ph_tops, bands, zones_raw, finishes, glass_code = {}, [], [], {}, [], {}, {}
    elevation_windows = {}
    plans = [(row["page"], plan) for row in of_kind("平面図") for plan in row["reply"]["plans"]]
    bearings = [plan["north_deg"] for _, plan in plans if plan["north_deg"] is not None]
    north = sorted(bearings)[len(bearings) // 2] if bearings else 0

    def plan_side(real):
        """立面の名前の方位を、平面図の上下左右にする。方位記号が斜めでも、いちばん近い面にする"""
        return PLAN_SIDE[round((BEARING[real] + north) / 90) * 90 % 360]

    for row in of_kind("立面図"):
        finishes.update({item["code"]: item["text"] for item in row["reply"]["finishes"]})
        for view in row["reply"]["views"]:
            side = plan_side(view["side"]) if view["side"] in SIDES else None
            for item in view["levels"]:
                rows.setdefault(re.sub(r"\s", "", item["name"]), item["elevation_mm"])
            if view["parapet_top_mm"] is not None:
                parapets.append(view["parapet_top_mm"])
            if view["ph_top_mm"] is not None:
                ph_tops.append(view["ph_top_mm"])
            if side is None:
                continue
            for band in view["bands"]:
                bands[(side, floor_name(band["floor"]))] = band
            zones_raw += [{**zone, "side": side} for zone in view["zones"]]
            for window in view.get("windows", []):
                elevation_windows.setdefault((side, floor_name(window["floor"])), []).append(window)
            if view["glass_finish_code"]:
                glass_code[side] = view["glass_finish_code"]
    roof_levels = []
    section_finishes = []
    for row in of_kind("断面図"):
        reply = row["reply"]
        for item in reply["levels"]:
            rows.setdefault(re.sub(r"\s", "", item["name"]), item["elevation_mm"])
        if reply["parapet_top_mm"] is not None:
            parapets.append(reply["parapet_top_mm"])
        if reply["roof_level_mm"] is not None:
            roof_levels.append(reply["roof_level_mm"])
        section_finishes += reply["finishes"]

    first_floor = next((value for name, value in rows.items() if re.fullmatch(r"(1F|1FL|1階床)", unicodedata.normalize("NFKC", name))), 0)
    top_name = next((name for name in names if name.startswith("R")), names[-1])
    # 主屋根の高さ：建物データの屋根の階。パラペットは屋根からの立上りだけを使う（基準の違いを持ち込まない）
    roof_gl = max(roof_levels) if roof_levels else levels[top_name] + first_floor
    parapet_rise = max(0, min(max(parapets) - roof_gl, 2000)) if parapets else 0
    if not parapets:
        need("立面", "パラペットの高さを読めませんでした。屋根の高さで止めています")
    ph_rise = 0

    # 階ごとの外周
    outlines = {}
    for page, plan in plans:
        name = floor_name(plan["floor"])
        if name is None or (name not in levels and name != "PH"):
            need("平面", f"p.{page} の階「{plan['floor']}」は骨組みの階と合いません")
            continue
        points = [point for point in map(to_point, plan["outline"]) if point]
        if len(points) < 3 and name == "PH" and plan["enclosures"]:
            # 塔屋に部屋がないときは、囲いの全体を外周とみなす
            corners = [point for enclosure in plan["enclosures"] for point in map(to_point, enclosure["points"]) if point]
            if corners:
                xs, ys = [c[0] for c in corners], [c[1] for c in corners]
                points = [[min(xs), min(ys)], [max(xs), min(ys)], [max(xs), max(ys)], [min(xs), max(ys)]]
                need("平面", "塔屋は室内の表記がないので、囲いの全体を外周にしました")
        if len(points) < 3:
            if name != "PH":
                need("平面", f"{name} の外周を読めませんでした")
            continue
        outlines.setdefault(name, (page, plan, points))

    def covers(upper, lower):
        ux, uy = [p[0] for p in upper], [p[1] for p in upper]
        lx, ly = [p[0] for p in lower], [p[1] for p in lower]
        return min(ux) <= min(lx) and max(ux) >= max(lx) and min(uy) <= min(ly) and max(uy) >= max(ly)

    floors_out, roofs = [], []
    guessed = {}
    door_table = {door_key(item["code"]): item for row in of_kind("建具表") for item in row["reply"]["items"]}
    for name in [n for n in names if n in outlines] + (["PH"] if "PH" in outlines else []):
        page, plan, outline = outlines[name]
        words = display_words(doc[page - 1])
        page_text = re.sub(r"\s+", "", doc[page - 1].get_text())
        if name == "PH":
            base = levels.get("RF", levels[top_name])
            top = levels.get("PHRF", base + 3000) + ph_rise
            roof_z = top
            exposed = True
        else:
            base = levels[name]
            above = names[names.index(name) + 1] if names.index(name) + 1 < len(names) else None
            roof_z = levels[above] if above else base + 3000
            upper = outlines.get(above)
            exposed = not (upper and covers(upper[2], outline))
            top = roof_z + (parapet_rise if exposed else 0)
        if exposed:
            roofs.append({"floor": name, "z": roof_z, "outline": outline})
        xs = [p[0] for p in outline]
        ys = [p[1] for p in outline]
        openings = []
        for row in plan["openings"]:
            a, b = on_grid(row["from_grid"], row["from_offset_mm"]), on_grid(row["to_grid"], row["to_offset_mm"])
            if a is None or b is None or a == b:
                need("開口", f"{name} {row['side']} の開口の位置を読めませんでした")
                continue
            story = top - base
            door = door_table.get(door_key(row["code"]))
            band = bands.get((row["side"], name))
            if door and door["height_mm"]:
                sill = door["sill_mm"] if door["sill_mm"] is not None else (0 if door["kind"] in ("扉", "シャッター") else 900)
                head = sill + door["height_mm"]
            elif band:
                sill, head = band["sill_mm"], band["head_mm"]
                if band["estimated"]:
                    guessed[name] = guessed.get(name, 0) + 1
            else:
                wide = abs(b - a) >= WIDE_OPENING or row["kind"] == "カーテンウォール"
                sill, head = (150, story - 600) if wide else USUAL_WINDOW
                guessed[name] = guessed.get(name, 0) + 1
            if row["kind"] in ("扉", "シャッター") and not door:
                sill = 0
            fixed = {"north": max(ys), "south": min(ys), "east": max(xs), "west": min(xs)}[row["side"]]
            openings.append({"side": row["side"], "kind": row["kind"], "fixed": fixed, "from": min(a, b), "to": max(a, b),
                             "along": "x" if row["side"] in ("north", "south") else "y", "z0": base + sill, "z1": min(base + head, top)})
        # 窓は立面の読みを優先する。平面図の窓より高さまで確かで、読み落としも少ない
        for side in SIDES:
            windows = elevation_windows.get((side, name))
            if not windows:
                continue
            fixed = {"north": max(ys), "south": min(ys), "east": max(xs), "west": min(xs)}[side]
            located = [(window, on_grid(window["from_grid"], window["from_offset_mm"]), on_grid(window["to_grid"], window["to_offset_mm"])) for window in windows]
            located = [row for row in located if row[1] is not None and row[2] is not None and row[1] != row[2]]
            # 立面に通りの記号がない図面では位置が分からないので、平面図の窓の位置を使う
            if not located:
                continue
            openings = [o for o in openings if o["side"] != side]
            for window, a, b in located:
                openings.append({"side": side, "kind": window["kind"], "fixed": fixed, "from": min(a, b), "to": max(a, b),
                                 "along": "x" if side in ("north", "south") else "y", "z0": base + window["sill_mm"], "z1": min(base + window["head_mm"], top)})
        rooms, seen = [], set()
        for room in plan["rooms"]:
            if room["name"] in seen:
                continue
            seen.add(room["name"])
            cx = [on_grid(room["x_from"], 0), on_grid(room["x_to"], 0)]
            cy = [on_grid(room["y_from"], 0), on_grid(room["y_to"], 0)]
            if None in cx or None in cy:
                need("部屋", f"{name} {room['name']} の位置を読めませんでした")
                continue
            area = room["area_m2"]
            confirmed = re.sub(r"\s+", "", room["name"]) in page_text and (area is None or f"{area:.2f}" in page_text)
            rooms.append({"name": room["name"], "area_m2": area, "x": sum(cx) / 2, "y": sum(cy) / 2, "status": "一致" if confirmed else "要確認"})
        floors_out.append({"floor": name, "z0": base, "z1": top, "outline": outline, "openings": openings, "rooms": rooms})
        for enclosure in plan["enclosures"] if name != "PH" else []:
            points = [point for point in map(to_point, enclosure["points"]) if point]
            if len(points) >= 3:
                floors_out.append({"floor": name, "z0": base, "z1": min(top, roof_z), "outline": points, "openings": [], "rooms": []})
    for name, count in guessed.items():
        need("開口", f"{name} の開口 {count} か所は、高さの記入がないので図からの読みや仮の値です")
    if not floors_out:
        need("平面", "外周を読めた階がないので、外観を作れませんでした")

    # 素材
    table = [item for row in of_kind("仕上表") for item in row["reply"]["items"]] + section_finishes
    legend_wall = next((material_of(text) for text in finishes.values() if "外壁" in text and material_of(text)), None)

    def table_material(part):
        for item in table:
            if item["part"] == part:
                key = material_of(item["text"])
                # 下地の防水の文は、外壁の見た目にしない
                if key and not (part == "外壁" and key == STANDARD_ROOF):
                    return key
        return None

    wall_material = legend_wall or table_material("外壁")
    zones = []
    for zone in zones_raw:
        text = finishes.get(zone["finish_code"])
        a, b = grids.get(zone["from_grid"]), grids.get(zone["to_grid"])
        if text is None or a is None or b is None or a == b:
            continue
        bottom = -TALL if zone["bottom_mm"] is None else zone["bottom_mm"] - first_floor
        top = TALL if zone["top_mm"] is None else zone["top_mm"] - first_floor
        if top - bottom < 500:
            continue
        key = material_of(text)
        if key:
            zones.append({"side": zone["side"], "from": min(a, b), "to": max(a, b), "z0": bottom, "z1": top, "material": key})
    # 範囲を読めなかった面は、仕上表の外壁の素材で全体を覆う
    span = (min(grids.values()) - TALL, max(grids.values()) + TALL)
    fallback = wall_material or next((material_of(text) for text in finishes.values() if material_of(text)), None)
    if fallback:
        zones += [{"side": side, "from": span[0], "to": span[1], "z0": -TALL, "z1": TALL, "material": fallback} for side in SIDES]
    else:
        need("素材", "外壁の仕上げを読めませんでした：標準の素材を使用")
    sash = next((material_of(text) for code, text in finishes.items() if code in glass_code.values()), None) or table_material("サッシ")
    materials = {
        "wall_zones": zones,
        "glass": {side: sash or STANDARD_GLASS for side in SIDES},
        "roofs": {"main": table_material("屋根") or STANDARD_ROOF, "PH": table_material("塔屋の屋根") or table_material("屋根") or STANDARD_ROOF},
        "cap": table_material("笠木") or "aluminum_cap",
        "projections": [],
    }
    for name, (_, plan, _) in outlines.items():
        here = next((f for f in floors_out if f["floor"] == name), None)
        if here is None:
            continue
        for row in plan["projections"]:
            a, b = on_grid(row["from_grid"], row["from_offset_mm"]), on_grid(row["to_grid"], row["to_offset_mm"])
            if a is None or b is None:
                need("素材", f"{name} の {row['text']} の位置を読めませんでした")
                continue
            depth = row["depth_mm"]
            if depth is None:
                depth = 1000
                need("素材", f"{name} の {row['text']} の出が読めないので、仮に 1,000 にしました")
            materials["projections"].append({"floor": name, "kind": row["kind"], "side": row["side"], "from": min(a, b), "to": max(a, b), "depth": depth,
                                             "z": projection_height(row, here, name == next(iter(levels))), "thickness": PROJECTION_THICKNESS[row["kind"]],
                                             "material": material_of(row["text"]) or table_material("庇") or "aluminum_panel"})
    model["architecture"] = {"floors": floors_out, "roofs": roofs, "checks": checks, "materials": materials,
                             "source": "意匠図を読んで組み立てた外観（初期検討用）"}
    if bearings and not model.get("site"):
        model.setdefault("north_deg", round((360 - north) % 360))
    write_json(Path(out), model)
    print(f"階 {len(floors_out)}、屋根 {len(roofs)}、部屋 {sum(len(f['rooms']) for f in floors_out)}、開口 {sum(len(f['openings']) for f in floors_out)}、"
          f"素材の範囲 {len(zones)}、外壁 {wall_material}、1FL は設計GL+{first_floor}、立上り {parapet_rise}、方位 {north}、要確認 {len(checks)}")
    for check in checks:
        print(" ", check["kind"], check["message"][:90])


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("command", choices=["read", "build"])
    parser.add_argument("--pdf", required=True)
    parser.add_argument("--folder", required=True)
    parser.add_argument("--model")
    parser.add_argument("--out")
    parser.add_argument("--max-usd", type=float, default=3.0)
    args = parser.parse_args()
    folder = Path(args.folder)
    if args.command == "read":
        read_all(args.pdf, folder, args.max_usd)
    else:
        if not args.model or not args.out:
            sys.exit("--model と --out を指定してください")
        build(args.pdf, folder, args.model, args.out)


if __name__ == "__main__":
    main()
