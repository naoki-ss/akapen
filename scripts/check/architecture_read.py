"""本社屋の意匠図から、外周の壁、開口、屋根、部屋名を読み、建物データに足す。

  python architecture_read.py read     読む（読み終えたページは使い回す。費用はここだけ）
  python architecture_read.py build    読んだ結果から 3D の材料を作り、公開するモデルに足す（AIなし）

位置は通り芯からの距離で読ませ、プログラムで mm にする。部屋名と面積はPDFの文字と突き合わせ、
合わないものや読めないものは「要確認」にして止めない。AIに形を描かせない。
"""
import json
import re
import sys
from concurrent.futures import ThreadPoolExecutor

import anthropic
import pymupdf

from ai_review import call_claude, load_env
from building_data import grid_positions
from building_pages import display_words
from check_upload import EXPERIMENTS, message_cost
from common import PRIVATE, REPO, write_json
from review_steel_sheet import render
from steel_experiment import image_block, record_cost, tiles

PDF = PRIVATE / "honsha" / "ishou_0730.pdf"
FOLDER = PRIVATE / "projects" / "sample-b-new"
RAW = FOLDER / "architecture"
PUBLIC_MODEL = REPO / "demo-data" / "sample-b" / "model.json"
PLANS = {12: "1F", 13: "2F", 14: "3F", 15: "PH"}
ELEVATIONS = [16, 17, 18]
MATERIAL_RAW = FOLDER / "materials"
FINISH_PAGE = 11
SIDES = ["north", "south", "east", "west"]

COMMON = """あなたは建物の意匠図を読む担当です。図面の1ページの画像（1枚目が全体、残りは文字を読むための拡大）を渡します。

守ること:
- 図面に書かれている値だけを書きます。読めない値を推測で埋めません。null にして unreadable に理由を書きます。
- 通りの名前は図面の表記のまま（X1、Y3 など）で書きます。図面の家具や人の名前、事務所名は書きません。"""

PLAN_SYSTEM = COMMON + """

このページは平面図です。
- north_deg：方位記号の N が図面の上から時計回りに何度か。おおよそでかまいません。読めなければ null
- outline：建物の外壁の外周の角を、順に。各点は最も近い通りと、そこからの距離（mm。X は右が正、Y は上が正）で書きます。外部階段、庇、キャノピーは含めません
- rooms：部屋。name は図面の表記のまま、area_m2 は書かれた面積（なければ null）、x_from、x_to、y_from、y_to はその部屋を囲む通り
- openings：外壁の開口。side は図面の上を north とした面（north、south、east、west）。from_grid、from_offset_mm、to_grid、to_offset_mm は開口の両端（side が north、south のときは X の通り、east、west のときは Y の通り）。kind は 窓、カーテンウォール、扉、シャッター のいずれか"""

ELEVATION_SYSTEM = COMMON + """

このページは立面図です。1ページに複数の立面があれば views に分けます。
- side：どの面の立面か（north、south、east、west）
- levels：高さの記入。name は図面の表記のまま（2FL、RSL、PH笠木など）、elevation_mm は設計GLからの高さ
- parapet_top_mm：一番高くない主屋根のパラペット（笠木）の高さ。ph_top_mm：塔屋の笠木の高さ
- bands：階ごとの窓の帯。floor（1F、2F、3F、PH）、sill_mm（その階の床から窓の下端まで）、head_mm（その階の床から窓の上端まで）。読み取れない階は書きません"""

NUMBER = {"type": ["number", "null"]}
TEXT = {"type": "string"}


def strict(properties):
    return {"type": "object", "additionalProperties": False, "required": list(properties), "properties": properties}


def array(item):
    return {"type": "array", "items": item}


PLAN_SCHEMA = strict({
    "north_deg": NUMBER,
    "outline": array(strict({"x_grid": TEXT, "x_offset_mm": {"type": "number"}, "y_grid": TEXT, "y_offset_mm": {"type": "number"}})),
    "rooms": array(strict({"name": TEXT, "area_m2": NUMBER, "x_from": TEXT, "x_to": TEXT, "y_from": TEXT, "y_to": TEXT})),
    "openings": array(strict({"side": {"type": "string", "enum": SIDES}, "from_grid": TEXT, "from_offset_mm": {"type": "number"},
                              "to_grid": TEXT, "to_offset_mm": {"type": "number"},
                              "kind": {"type": "string", "enum": ["窓", "カーテンウォール", "扉", "シャッター"]}})),
    "unreadable": array(TEXT),
})
ELEVATION_SCHEMA = strict({
    "views": array(strict({
        "side": {"type": "string", "enum": SIDES},
        "levels": array(strict({"name": TEXT, "elevation_mm": {"type": "number"}})),
        "parapet_top_mm": NUMBER,
        "ph_top_mm": NUMBER,
        "bands": array(strict({"floor": TEXT, "sill_mm": {"type": "number"}, "head_mm": {"type": "number"}})),
    })),
    "unreadable": array(TEXT),
})


def read_page(client, doc, number, system, schema):
    result = RAW / f"p{number}-result.json"
    if result.exists():
        return 0.0
    page = doc[number - 1]
    content = [{"type": "text", "text": "図面：全体図"}, image_block(render(page))]
    for png, place in tiles(page, 3, 2):
        content += [{"type": "text", "text": f"図面：{place} の分割図"}, image_block(png)]
    content.append({"type": "text", "text": "このページを読み取ってください。"})
    reply = call_claude(client, system, content, schema, RAW, f"p{number}")
    write_json(result, reply)
    return message_cost(RAW / f"p{number}.json")[2]


def read_all():
    load_env()
    RAW.mkdir(parents=True, exist_ok=True)
    client = anthropic.Anthropic()
    doc = pymupdf.open(PDF)
    jobs = [(n, PLAN_SYSTEM, PLAN_SCHEMA) for n in PLANS] + [(n, ELEVATION_SYSTEM, ELEVATION_SCHEMA) for n in ELEVATIONS]
    with ThreadPoolExecutor(3) as pool:
        costs = list(pool.map(lambda job: read_page(client, doc, *job), jobs))
    total = round(sum(costs), 3)
    if total:
        record_cost(EXPERIMENTS / "ledger.json", "architecture-honsha", total)
    print(f"費用 {total} ドル")


def fit(a, b):
    """2点から一次式（図面の位置 → mm）を作る"""
    scale = (b[1] - a[1]) / (b[0] - a[0])
    return lambda value: a[1] + (value - a[0]) * scale


def plan_mapper(words, model):
    """図面の文字の位置を建物の mm に写す関数。通りの記号の位置から作る。作れなければ None"""
    positions = grid_positions(words)
    xs = [(positions[g], model["grid_x"][g]) for g in model["grid_x"] if g in positions]
    ys = [(positions[g], model["grid_y"][g]) for g in model["grid_y"] if g in positions]
    if len(xs) < 2 or len(ys) < 2:
        return None
    to_x = fit(min(xs), max(xs))
    to_y = fit(min(ys), max(ys))
    return lambda px, py: (round(to_x(px)), round(to_y(py)))


# 仕上げの文から素材の種類を決める。上から順に見る。色と質感は lib/materials.ts の対応表で決まる
MATERIAL_RULES = [
    (r"カーテンウォール|サッシ", "aluminum_curtain_wall"),
    (r"グレーチング", "steel_grating"),
    (r"パンチング|溶融亜鉛メッキ鋼板|ルーバー", "metal_louver"),
    (r"折版|ガルバリウム", "metal_roof"),
    (r"笠木", "aluminum_cap"),
    (r"アルミパネル|アルミ", "aluminum_panel"),
    # タイル貼の下地にセメント板が書かれることがあるので、タイルを先に見る
    (r"吹付|吹き付け", "spray_tile"),
    (r"タイル", "tile"),
    (r"押出|セメント板", "extruded_cement"),
    (r"ALC|アスロック", "alc"),
    (r"コンクリート", "concrete"),
    (r"防水|ルーフィング", "roof_membrane"),
]
STANDARD_WALL = "standard_wall"
STANDARD_GLASS = "aluminum_curtain_wall"
STANDARD_ROOF = "roof_membrane"
# 平面図に描かれた庇は、その階の床の高さにある。高さの書かれた図がないときの決まり
PROJECTION_THICKNESS = {"庇": 150, "キャノピー": 450, "手すり": 1100}


def material_of(text):
    for pattern, key in MATERIAL_RULES:
        if re.search(pattern, text):
            return key
    return None


def build_materials(model, floors_out, doc, checks):
    """読んだ外装の仕上げを、建物の座標の素材の範囲にする。読めなかったところは標準の素材にして記録する"""
    grid_x, grid_y = model["grid_x"], model["grid_y"]
    grids = {**grid_x, **grid_y}

    def standard(message):
        checks.append({"kind": "素材", "result": "要確認", "message": f"{message}：標準の素材を使用"})

    if not MATERIAL_RAW.exists():
        standard("素材を読んでいません")
        return {"wall_zones": [], "glass": {}, "roofs": {}, "cap": None, "projections": []}
    plans = {12: "1F", 13: "2F", 14: "3F", 15: "PH"}
    finishes, zones, glass, base = {}, [], {}, None
    for number in ELEVATIONS:
        reply = json.loads((MATERIAL_RAW / f"p{number}-result.json").read_text())
        finishes.update({row["code"]: row["text"] for row in reply["finishes"]})
    # 高さの記入は設計GLから。建物の高さの基準（1FL）との差を引く
    first_floor = 150
    for number in ELEVATIONS:
        reply = json.loads((MATERIAL_RAW / f"p{number}-result.json").read_text())
        for view in reply["views"]:
            if view["glass_finish_code"] in finishes:
                glass[view["side"]] = material_of(finishes[view["glass_finish_code"]]) or STANDARD_GLASS
            for zone in view["zones"]:
                text = finishes.get(zone["finish_code"])
                a, b = grids.get(zone["from_grid"]), grids.get(zone["to_grid"])
                if text is None or a is None or b is None:
                    standard(f"{view['side']} の {zone['finish_code']} の範囲を読めませんでした")
                    continue
                bottom = -10**6 if zone["bottom_mm"] is None else zone["bottom_mm"] - first_floor
                top = 10**6 if zone["top_mm"] is None else zone["top_mm"] - first_floor
                # 基礎の立上りのような低い帯は、壁の材料にしない
                if top - bottom < 500:
                    continue
                key = material_of(text)
                if key is None:
                    standard(f"「{text[:20]}」の素材の種類が分かりません")
                    key = STANDARD_WALL
                zones.append({"side": view["side"], "from": min(a, b), "to": max(a, b), "z0": bottom, "z1": top, "material": key})

    def zone_for(side, along, z):
        hits = [zone for zone in zones if zone["side"] == side and zone["from"] <= along <= zone["to"] and zone["z0"] <= z <= zone["z1"]]
        return min(hits, key=lambda zone: (zone["to"] - zone["from"]) * (zone["z1"] - zone["z0"]), default=None)

    # 壁のうち、どの範囲にも当たらないところを記録する（描くときは標準の素材になる）
    uncovered = set()
    for floor in floors_out:
        points = floor["outline"]
        for index, (p, q) in enumerate(zip(points, points[1:] + points[:1])):
            along_x = p[1] == q[1]
            if not along_x and p[0] != q[0]:
                continue
            xs = [pt[0] for pt in points]
            ys = [pt[1] for pt in points]
            fixed = p[1] if along_x else p[0]
            side = ("south" if fixed <= (min(ys) + max(ys)) / 2 else "north") if along_x else ("west" if fixed <= (min(xs) + max(xs)) / 2 else "east")
            a, b = sorted((p[0], q[0]) if along_x else (p[1], q[1]))
            for along in range(int(a) + 500, int(b), 1000):
                opened = any(o["side"] == side and o["from"] <= along <= o["to"] for o in floor["openings"])
                if not opened and not zone_for(side, along, (floor["z0"] + floor["z1"]) / 2):
                    uncovered.add((floor["floor"], side))
    for floor, side in sorted(uncovered):
        standard(f"{floor} の {side} 面の壁の一部は仕上げを読めませんでした")

    # 屋根：読めた仕上げの文から。主屋根は仕上表の文字（AIなし）から探す
    table = doc[FINISH_PAGE - 1].get_text() + doc[FINISH_PAGE - 2].get_text()
    general = re.search(r"屋根（一般）[：:]\s*([^\n]+)", table)
    ph = next((text for text in finishes.values() if text.startswith("PH階屋根")), None)
    roofs = {"main": material_of(general.group(1)) if general else None, "PH": material_of(ph) if ph else None}
    for name, label in (("main", "主屋根"), ("PH", "塔屋の屋根")):
        if roofs[name] is None:
            standard(f"{label}の仕上げを読めませんでした")
            roofs[name] = STANDARD_ROOF
    cap_text = next((text for text in finishes.values() if text.startswith("笠木")), None)
    if cap_text is None:
        standard("笠木の仕上げを読めませんでした")
    entrance = next((text for text in finishes.values() if "エントランス" in text), None)

    projections, railing = [], False
    for number, floor in plans.items():
        reply = json.loads((MATERIAL_RAW / f"p{number}-result.json").read_text())
        here = next((f for f in floors_out if f["floor"] == floor and f["rooms"]), None) or next((f for f in floors_out if f["floor"] == floor), None)
        if here is None:
            continue
        for row in reply["projections"]:
            a, b = grids.get(row["from_grid"]), grids.get(row["to_grid"])
            if a is None or b is None:
                standard(f"{floor} の {row['text']} の位置を読めませんでした")
                continue
            if row["kind"] == "手すり":
                railing = True
            a, b = sorted((a + row["from_offset_mm"], b + row["to_offset_mm"]))
            depth = row["depth_mm"]
            if depth is None:
                depth = 1000
                checks.append({"kind": "素材", "result": "要確認", "message": f"{floor} の {row['text']} の出が読めないので、仮に 1,000 にしました"})
            # 名前で素材が分からないときは、凡例の中でその名前を含む仕上げを使う
            named = next((text for text in finishes.values() if row["text"] in text), None)
            key = material_of(row["text"]) or (material_of(named) if named else None) or (material_of(entrance) if entrance and row["kind"] == "キャノピー" else None)
            if key is None:
                standard(f"{floor} の {row['text']} の素材を読めませんでした")
                key = "aluminum_panel"
            projections.append({"floor": floor, "kind": row["kind"], "side": row["side"], "from": a, "to": b, "depth": depth,
                                "z": here["z0"], "thickness": PROJECTION_THICKNESS[row["kind"]], "material": key})
    if not railing:
        checks.append({"kind": "素材", "result": "要確認", "message": "屋上や庇の手すりは図面から読めなかったので、描いていません"})
    return {"wall_zones": zones, "glass": glass, "roofs": roofs, "cap": material_of(cap_text) if cap_text else "aluminum_cap",
            "projections": projections}


def build():
    model = json.loads(PUBLIC_MODEL.read_text())
    grid_x, grid_y, levels = model["grid_x"], model["grid_y"], model["levels"]
    doc = pymupdf.open(PDF)
    checks = []

    def need(kind, message):
        checks.append({"kind": kind, "result": "要確認", "message": message})

    def on_grid(name, offset):
        if name in grid_x:
            return grid_x[name] + offset
        if name in grid_y:
            return grid_y[name] + offset
        return None

    # 立面：パラペットの高さと、面ごと階ごとの窓の高さ
    bands, level_rows, parapet, ph_top = {}, {}, [], []
    for number in ELEVATIONS:
        path = RAW / f"p{number}-result.json"
        if not path.exists():
            need("立面", f"p.{number} を読んでいません")
            continue
        reply = json.loads(path.read_text())
        for text in reply["unreadable"]:
            need("立面", f"p.{number} {text}")
        for view in reply["views"]:
            for band in view["bands"]:
                bands[(view["side"], band["floor"])] = (band["sill_mm"], band["head_mm"])
            for row in view["levels"]:
                level_rows.setdefault(row["name"], row["elevation_mm"])
            if view["parapet_top_mm"] is not None:
                parapet.append(view["parapet_top_mm"])
            if view["ph_top_mm"] is not None:
                ph_top.append(view["ph_top_mm"])
    # 高さの差だけを使う。読めなければ主屋根の階の高さで止める
    roof_row = next((level_rows[k] for k in level_rows if re.fullmatch(r"R\s*S\.?\s*L.*", k)), None)
    if parapet and roof_row is not None:
        parapet_rise = max(parapet) - roof_row
    else:
        parapet_rise = 0
        need("立面", "パラペットの高さを読めませんでした。屋根の高さで止めています")
    roof_z = levels["RF"]
    ph_z = levels.get("PHRF")
    ph_rows = [level_rows[k] for k in level_rows if re.fullmatch(r"PH\s*S\.?\s*L.*水上.*", k)]
    ph_rise = max(ph_top) - ph_rows[0] if ph_top and ph_rows else 0
    guessed_openings = {}
    floors_out, north = [], []
    for number, floor in PLANS.items():
        path = RAW / f"p{number}-result.json"
        if not path.exists():
            need("平面", f"{floor} の平面図を読んでいません")
            continue
        reply = json.loads(path.read_text())
        for text in reply["unreadable"]:
            need("平面", f"{floor} {text}")
        if reply["north_deg"] is not None:
            north.append(reply["north_deg"])
        page = doc[number - 1]
        words = display_words(page)
        page_text = re.sub(r"\s+", "", page.get_text())
        to_mm = plan_mapper(words, model)

        if floor == "PH":
            # AIは屋上全体を外周として読んだ。立面（p.16）と平面（p.15）で塔屋は X1〜X3 / Y3〜Y4
            reply["outline"] = [{"x_grid": x, "x_offset_mm": 0, "y_grid": y, "y_offset_mm": 0}
                                for x, y in [("X1", "Y3"), ("X3", "Y3"), ("X3", "Y4"), ("X1", "Y4")]]
            need("平面", "塔屋の外周は、AIの読みではなく図面を見て通り芯で補正しました（X1〜X3 / Y3〜Y4）")
            reply["rooms"] = [r for r in reply["rooms"] if r["name"] != "屋上"]
        outline = []
        for point in reply["outline"]:
            x, y = on_grid(point["x_grid"], point["x_offset_mm"]), on_grid(point["y_grid"], point["y_offset_mm"])
            if x is None or y is None:
                need("平面", f"{floor} の外周に分からない通りがあります（{point['x_grid']}、{point['y_grid']}）")
                continue
            outline.append([x, y])
        if len(outline) < 3:
            need("平面", f"{floor} の外周を読めませんでした")
            continue
        if floor == "PH":
            z0 = roof_z
            z1 = (ph_z if ph_z is not None else roof_z + 3000) + ph_rise
        else:
            names = list(levels)
            z0 = levels[floor]
            upper = levels[names[names.index(floor) + 1]]
            z1 = upper + parapet_rise if names[names.index(floor) + 1] == "RF" else upper

        xs = [p[0] for p in outline]
        ys = [p[1] for p in outline]
        openings = []
        for row in reply["openings"]:
            a, b = on_grid(row["from_grid"], row["from_offset_mm"]), on_grid(row["to_grid"], row["to_offset_mm"])
            if a is None or b is None or a == b:
                need("開口", f"{floor} {row['side']} の開口の位置を読めませんでした")
                continue
            band = bands.get((row["side"], floor))
            if band is None:
                # 立面に窓の高さの記入がない。幅の広い開口はファサードの大開口として階の高さに合わせる
                wide = abs(b - a) >= 3000 or row["kind"] == "カーテンウォール"
                story = z1 - z0
                band = (150, story - 600) if wide else (900, 2700)
                guessed_openings[floor] = guessed_openings.get(floor, 0) + 1
            sill, head = (0, band[1]) if row["kind"] in ("扉", "シャッター") else band
            fixed = {"north": max(ys), "south": min(ys), "east": max(xs), "west": min(xs)}[row["side"]]
            along_x = row["side"] in ("north", "south")
            openings.append({
                "side": row["side"], "kind": row["kind"], "fixed": fixed, "from": min(a, b), "to": max(a, b),
                "along": "x" if along_x else "y", "z0": z0 + sill, "z1": min(z0 + head, z1),
            })

        rooms = []
        seen = set()
        for room in reply["rooms"]:
            if room["name"] in seen:
                continue
            seen.add(room["name"])
            name = re.sub(r"\s+", "", room["name"])
            word = next((w for w in words if re.sub(r"\s+", "", w[4]) == name), None)
            status = "一致"
            if word and to_mm:
                x, y = to_mm((word[0] + word[2]) / 2, (word[1] + word[3]) / 2)
            else:
                cx = [on_grid(room["x_from"], 0), on_grid(room["x_to"], 0)]
                cy = [on_grid(room["y_from"], 0), on_grid(room["y_to"], 0)]
                if None in cx or None in cy:
                    need("部屋", f"{floor} {room['name']} の位置を読めませんでした")
                    continue
                x, y = sum(cx) / 2, sum(cy) / 2
                status = "要確認"
                need("部屋", f"{floor} {room['name']} は図面の文字と一致しないので、通りの中央に置いています")
            area = room["area_m2"]
            if area is not None and f"{area:.2f}" not in page_text:
                status = "要確認"
                need("部屋", f"{floor} {room['name']} の面積 {area} は図面の文字で確かめられませんでした")
            rooms.append({"name": room["name"], "area_m2": area, "x": x, "y": y, "status": status})
        floors_out.append({"floor": floor, "z0": z0, "z1": z1, "outline": outline, "openings": openings, "rooms": rooms})

    for floor, count in guessed_openings.items():
        need("開口", f"{floor} の開口 {count} か所は、立面に高さの記入がないので仮の高さです")
    # 外部階段は外周から除いて読ませたが、立面では外観の一部（X1〜X2 / Y3〜Y4、塔屋まで）
    stair = [[grid_x["X1"], grid_y["Y3"]], [grid_x["X2"], grid_y["Y3"]], [grid_x["X2"], grid_y["Y4"]], [grid_x["X1"], grid_y["Y4"]]]
    for item in list(floors_out):
        if item["floor"] != "PH":
            floors_out.append({"floor": item["floor"], "z0": item["z0"], "z1": min(item["z1"], roof_z), "outline": stair, "openings": [], "rooms": []})
    need("平面", "外部階段の囲いは立面を見て足しました（X1〜X2 / Y3〜Y4）")
    main = [f for f in floors_out if f["floor"] != "PH" and f["outline"] != stair]
    roofs = []
    if main:
        roofs.append({"floor": main[-1]["floor"], "z": main[-1]["z1"] - parapet_rise, "outline": main[-1]["outline"]})
    for item in floors_out:
        if item["floor"] == "PH":
            roofs.append({"floor": "PH", "z": item["z1"] - ph_rise, "outline": item["outline"]})
    architecture = {"floors": floors_out, "roofs": roofs, "checks": checks,
                    "source": "意匠図を読んで組み立てた外観（初期検討用）"}
    architecture["materials"] = build_materials(model, floors_out, doc, checks)
    model["architecture"] = architecture
    # 建物の向き：図面の上が真北から時計回りに何度か（方位記号の読みから）。建設地は県の代表点
    drawn = sorted(north)[len(north) // 2] if north else 0
    model["site"] = {"lat": 38.24, "lon": 140.36, "north_deg": round((360 - drawn) % 360)}
    write_json(PUBLIC_MODEL, model)
    write_json(FOLDER / "architecture.json", architecture)
    rooms = sum(len(f["rooms"]) for f in floors_out)
    openings = sum(len(f["openings"]) for f in floors_out)
    print(f"階 {len(floors_out)}、部屋 {rooms}、開口 {openings}、要確認 {len(checks)}、方位 {north}")
    for check in checks:
        print(" ", check["kind"], check["message"])


if __name__ == "__main__":
    {"read": read_all, "build": build}[sys.argv[1]]()
