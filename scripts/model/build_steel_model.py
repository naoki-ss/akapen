"""S造の構造図PDFから、柱と大梁の3Dモデルを作る。

  python build_steel_model.py --pdf <構造図PDF> --out demo-data/sample-b/model.json

柱と大梁は軸組図の符号の位置から、断面は部材リスト・基礎梁リストから読む。
寸法はすべてPDFから読み、このファイルには書かない。
物件Bは社内で公開の確認が取れたので、実寸法のまま demo-data/sample-b/ に置く（CLAUDE.md 参照）。

小梁、片持ち梁、基礎、杭、柱の通り芯からの片寄りはまだ入れていない。
"""
import argparse
import json
import re
import subprocess
import sys
import unicodedata
from collections import Counter
from html import unescape
from pathlib import Path

FRAME_PAGES = range(18, 26)
PLAN_PAGES = {"2F": 14, "3F": 15, "RF": 16, "PHRF": 17}
BEAM_LIST_PAGE = 27
MEMBER_LIST_PAGE = 28

FLOORS = ["基礎", "1F", "2F", "3F", "RF", "PHRF"]
# 軸組図の高さ方向の並び（下から）。柱は下の階の名前で持つ
LEVELS = ["1F", "2F", "3F", "RF", "PHRF"]
# 梁の符号とスパン中央のずれの許容（図面上のpt）
MID_SPAN_TOLERANCE = 15
# 大梁の符号と個別レベルの記入が同じ部材を指すとみなす距離（図面上のpt）
LEVEL_NOTE_DISTANCE = 20


def page_words(pdf, page):
    """回転ページでも表示どおりの座標で返す（pymupdf の words は回転前の座標になる）"""
    xml = subprocess.run(
        ["pdftotext", "-bbox", "-f", str(page), "-l", str(page), str(pdf), "-"],
        capture_output=True, text=True, check=True,
    ).stdout
    pattern = r'<word xMin="([\d.]+)" yMin="([\d.]+)" xMax="[\d.]+" yMax="[\d.]+">(.*?)</word>'
    return [
        {"x": float(x), "y": float(y), "text": unicodedata.normalize("NFKC", unescape(text))}
        for x, y, text in re.findall(pattern, xml)
    ]


def to_mm(text):
    return int(text.replace(",", ""))


def read_columns_and_girders(pdf):
    """鉄骨部材リストから {符号: 断面} を読む"""
    rows = {}
    for word in page_words(pdf, MEMBER_LIST_PAGE):
        if word["x"] < 560:  # 右側はピン接合リスト
            rows.setdefault(round(word["y"] / 5), []).append(word)
    sections = {}
    for row in rows.values():
        row.sort(key=lambda w: w["x"])
        mark = row[0]["text"]
        if not re.fullmatch(r"[CG]\d", mark):
            continue
        text = "".join(w["text"] for w in row[1:]).replace("－", "-").replace(" ", "")
        found = re.match(r"([H□])-(\d+)×(\d+)((?:×[\d.]+)*)", text)
        if not found:
            sys.exit(f"部材リストの {mark} の断面を読めません: {text}")
        shape, depth, width, rest = found.groups()
        sections[mark] = {
            "section": f"{shape}-{depth}×{width}{rest}",
            "depth": int(depth),
            "width": int(width),
        }
    return sections


def read_foundation_beams(pdf):
    """基礎梁リストから {符号: 断面} を読む。表の列は x 座標で対応づける"""
    words = page_words(pdf, BEAM_LIST_PAGE)
    marks = [w for w in words if re.fullmatch(r"FG\d", w["text"])]
    sizes = [w for w in words if re.fullmatch(r"\d+×", w["text"]) and marks[0]["y"] < w["y"] < 400]
    sections = {}
    for mark in marks:
        size = min(sizes, key=lambda s: abs(s["x"] - mark["x"]))
        same_row = [w for w in words if abs(w["y"] - size["y"]) < 3 and w["x"] > size["x"]]
        depth = min(same_row, key=lambda w: w["x"])
        width = int(size["text"].rstrip("×"))
        sections[mark["text"]] = {
            "section": f"{width}×{to_mm(depth['text'])}",
            "depth": to_mm(depth["text"]),
            "width": width,
        }
    return sections


def read_heights(pdf):
    """軸組図の寸法を読む。階の高さ、梁天端の下がり、屋根の勾配の差、図面上の縮尺"""
    words = page_words(pdf, FRAME_PAGES[0])
    y_of = {w["text"]: w["y"] for w in words if re.fullmatch(r"[123]FL", w["text"])}
    # 階の寸法は、下の方にある最初の4桁の寸法の列に縦に並ぶ
    story_x = next(w["x"] for w in words if re.fullmatch(r"\d,\d{3}", w["text"]) and w["y"] > 400 and w["x"] < 300)
    stories = sorted(
        (w for w in words if abs(w["x"] - story_x) < 2 and re.fullmatch(r"\d,\d{3}", w["text"]) and w["y"] < 440),
        key=lambda w: -w["y"],
    )
    story_heights = [to_mm(w["text"]) for w in stories]
    if len(story_heights) != len(LEVELS) - 1:
        sys.exit(f"階の寸法の数が合いません: {story_heights}")

    floor_z = {"1F": 0}
    for lower, upper, height in zip(LEVELS, LEVELS[1:], story_heights):
        floor_z[upper] = floor_z[lower] + height

    points_per_mm = (y_of["1FL"] - y_of["2FL"]) / story_heights[0]
    line_y = {"1F": y_of["1FL"]}
    for name in LEVELS[1:]:
        line_y[name] = y_of["1FL"] - floor_z[name] * points_per_mm

    # 階の寸法の右の列に、梁天端の下がりと屋根の勾配の差が並ぶ
    offsets = sorted(
        (w for w in words if story_x < w["x"] < story_x + 30 and re.fullmatch(r"\d{2,3}", w["text"]) and w["y"] < 440),
        key=lambda w: w["y"],
    )
    near = lambda name: next(to_mm(w["text"]) for w in offsets if abs(w["y"] - line_y[name]) < 15)
    below_foundation = [w for w in words if w["text"] == "150" and abs(w["x"] - story_x) < 2]
    if len(below_foundation) != 2:
        sys.exit("1FL から基礎梁天端までの寸法を読めません")

    # 梁天端の既定の下がりは伏図の注記から読む。軸組図の寸法は個別レベルの参照線なので使わない
    def noted_drop(floor, prefix):
        note = "".join(w["text"] for w in page_words(pdf, PLAN_PAGES[floor]))
        found = re.search(rf"{prefix}-(\d+)", note)
        if not found:
            sys.exit(f"{floor} の梁天端の注記を読めません")
        return int(found.group(1))

    return {
        "floor_z": floor_z,
        "line_y": line_y,
        "beam_drop": {"2F": noted_drop("2F", "2FL"), "3F": noted_drop("3F", "3FL"), "RF": noted_drop("RF", "RFL"), "PHRF": 0},
        "roof_fall": near("RF"),
        "foundation_top": -sum(to_mm(w["text"]) for w in below_foundation),
    }


def read_penthouse_fall(pdf):
    """PHR階の屋根の、水上と水下の差を読む"""
    words = page_words(pdf, 20)
    story_x = next(w["x"] for w in words if re.fullmatch(r"\d,\d{3}", w["text"]) and w["y"] > 400 and w["x"] < 300)
    for w in words:
        if story_x < w["x"] < story_x + 30 and w["y"] < 170 and re.fullmatch(r"\d{2,3}", w["text"]):
            return to_mm(w["text"])
    sys.exit("PHR階の屋根の勾配を読めません")


def read_grid_spans(pdf):
    """平面の寸法を読む。X は 2階伏図の下の寸法、Y は左の寸法"""
    words = page_words(pdf, PLAN_PAGES["2F"])
    labels = [w for w in words if re.fullmatch(r"[XY]\d", w["text"])]
    x_labels = sorted((w for w in labels if w["text"][0] == "X"), key=lambda w: w["x"])
    y_labels = sorted((w for w in labels if w["text"][0] == "Y"), key=lambda w: -w["y"])
    dims = [w for w in words if re.fullmatch(r"\d,\d{3}", w["text"])]

    # 通り間の中央付近に寸法がある。図面上の距離からも実寸を求め、書いてある数字で確かめる
    y_span = y_labels[0]["y"] - y_labels[-1]["y"]
    x_span = x_labels[-1]["x"] - x_labels[1]["x"]
    y_total = sum(
        to_mm(w["text"]) for w in dims
        if y_labels[-1]["y"] < w["y"] < y_labels[0]["y"] and abs(w["x"] - (y_labels[0]["x"] + 50)) < 30
    )
    if not y_total:
        sys.exit("Y方向の寸法を読めません")
    per_mm = y_span / y_total

    grid_x = {x_labels[0]["text"]: 0}
    origin = x_labels[0]["x"]
    for label in x_labels[1:]:
        # 図面の寸法は mm 単位で 50 刻み。座標の読みの誤差を丸める
        grid_x[label["text"]] = round((label["x"] - origin) / per_mm / 50) * 50
    grid_y = {label["text"]: round((y_labels[0]["y"] - label["y"]) / per_mm / 50) * 50 for label in y_labels}

    # 書いてある全長と合うかを確かめる（x_span は X2〜最後の通り）
    total_x = round(x_span / per_mm / 50) * 50
    if not any(to_mm(w["text"]) == total_x for w in words if re.fullmatch(r"\d\d,\d{3}", w["text"])):
        sys.exit(f"X方向の全長が図面の寸法と合いません: {total_x}")
    return grid_x, grid_y


def read_frames(pdf):
    """軸組図1枚ごとの (通り, 直交する通りの座標, 符号の語) の一覧"""
    frames = []
    for page in FRAME_PAGES:
        words = page_words(pdf, page)
        labels = sorted((w for w in words if re.fullmatch(r"[XY]\d", w["text"]) and 600 < w["y"] < 640),
                        key=lambda w: w["x"])
        titles = sorted((w for w in words if re.fullmatch(r"[XY]\d", w["text"]) and w["y"] >= 640),
                        key=lambda w: w["x"])
        # 同じ通り名がもう一度出たところから右が2つ目の軸組
        split = next((b["x"] - 5 for a, b in zip(labels, labels[1:]) if b["text"] <= a["text"]), None)
        ranges = [(0, split), (split, 10000)] if split else [(0, 10000)]
        if len(titles) != len(ranges):
            sys.exit(f"p{page}: 軸組図の題名の数が合いません（題名 {len(titles)}、軸組 {len(ranges)}）")
        for title, (x0, x1) in zip(titles, ranges):
            frames.append({
                "page": page,
                "line": title["text"],
                "labels": [w for w in labels if x0 <= w["x"] < x1],
                "marks": [w for w in words if x0 <= w["x"] < x1 and w["y"] < 600],
            })
    return frames


def nearest(words, x):
    return min(words, key=lambda w: abs(w["x"] - x))["text"]


def story_of(y, line_y):
    """柱の符号の高さから、どの階の柱かを返す"""
    for lower, upper in zip(LEVELS, LEVELS[1:]):
        if line_y[upper] < y < line_y[lower]:
            return lower
    return None


def level_of(y, line_y):
    """梁の符号の高さから、どの床の梁かを返す。基礎梁は 1FL より下"""
    if y > line_y["1F"] + 5:
        return "基礎"
    candidates = {name: abs(line_y[name] - y) for name in LEVELS[1:]}
    name = min(candidates, key=candidates.get)
    return name if candidates[name] < 15 else None


def collect_columns(frames, line_y):
    """{(階, X通り, Y通り): 符号}。X通りとY通りの軸組図で食い違えば止める"""
    seen = {}
    for frame in frames:
        for word in frame["marks"]:
            if not re.fullmatch(r"C[1-3]", word["text"]):
                continue
            story = story_of(word["y"], line_y)
            if not story:
                continue
            other = nearest(frame["labels"], word["x"])
            x, y = (frame["line"], other) if frame["line"][0] == "X" else (other, frame["line"])
            seen.setdefault((story, x, y), {})[frame["line"][0]] = word["text"]

    columns, problems = {}, []
    for key, marks in sorted(seen.items()):
        if len(marks) != 2 or marks["X"] != marks["Y"]:
            problems.append(f"{key}: {marks}")
        columns[key] = next(iter(marks.values()))
    if problems:
        sys.exit("X通りとY通りの軸組図で柱が合いません:\n  " + "\n  ".join(problems))
    return columns


def has_column(columns, level, frame_line, other):
    """その床で、通りの交点に柱がつながっているか"""
    x, y = (frame_line, other) if frame_line[0] == "X" else (other, frame_line)
    if level == "基礎":
        stories = [LEVELS[0]]
    else:
        index = LEVELS.index(level)
        stories = [LEVELS[index - 1], *LEVELS[index:index + 1]]
    return any((story, x, y) in columns for story in stories)


def find_span(word, others, labels, columns, level, frame_line):
    """符号はスパンの中央に書かれるので、中央が最も近い通りの組を選ぶ。
    途中に柱や別の符号がある組は、1本の梁ではないので選ばない。"""
    best = None
    for i, start in enumerate(labels):
        for end in labels[i + 1:]:
            if any(start["x"] < o["x"] < end["x"] for o in others):
                continue
            inner = [w for w in labels if start["x"] < w["x"] < end["x"]]
            if any(has_column(columns, level, frame_line, w["text"]) for w in inner):
                continue
            error = abs((start["x"] + end["x"]) / 2 - word["x"])
            if best is None or error < best[0]:
                best = (error, start["text"], end["text"])
    if best is None or best[0] > MID_SPAN_TOLERANCE:
        sys.exit(f"{frame_line} 通りの {level} の {word['text']}（x={word['x']:.0f}）のスパンを決められません")
    return best[1], best[2]


def collect_girders(frames, columns, line_y):
    """{(床, 通り, 始点の通り, 終点の通り): 符号}"""
    girders = {}
    for frame in frames:
        by_level = {}
        for word in frame["marks"]:
            if re.fullmatch(r"(G[1-5]|FG\d)", word["text"]):
                level = level_of(word["y"], line_y)
                if level:
                    by_level.setdefault(level, []).append(word)
        for level, words in by_level.items():
            for word in words:
                others = [o for o in words if o is not word]
                start, end = find_span(word, others, frame["labels"], columns, level, frame["line"])
                girders[(level, frame["line"], start, end)] = word["text"]
    return girders


def read_plan_drops(pdf, girders, grid_x, grid_y):
    """伏図で符号のすぐ横に (FL-数値) がある大梁の下がりを {キー: 下がり} で返す。
    記入のない大梁は、注記の既定値（read_heights の beam_drop）になる"""
    drops = {}
    for floor, page in PLAN_PAGES.items():
        words = page_words(pdf, page)
        labels = [w for w in words if re.fullmatch(r"\(?FL-\d+\)?", w["text"])]
        marks = [w for w in words if re.match(r"G[1-5](?!\d)", w["text"])]
        if not labels or not marks:
            continue
        x_labels = {w["text"]: w["x"] for w in words if re.fullmatch(r"X\d", w["text"])}
        y_labels = {w["text"]: w["y"] for w in words if re.fullmatch(r"Y\d", w["text"])}
        names = sorted(x_labels)
        # 図面上の位置と実寸の対応を、両端の通りから求める
        per_mm = (x_labels[names[-1]] - x_labels[names[0]]) / (grid_x[names[-1]] - grid_x[names[0]])
        origin_x = x_labels[names[0]]
        origin_y = y_labels["Y1"]

        def middle(key):
            _level, line, start, end = key
            if line[0] == "X":
                return origin_x + grid_x[line] * per_mm, origin_y - (grid_y[start] + grid_y[end]) / 2 * per_mm
            return origin_x + (grid_x[start] + grid_x[end]) / 2 * per_mm, origin_y - grid_y[line] * per_mm

        floor_girders = [key for key in girders if key[0] == floor]
        for mark in marks:
            nearest_label = min(labels, key=lambda w: (w["x"] - mark["x"]) ** 2 + (w["y"] - mark["y"]) ** 2)
            if ((nearest_label["x"] - mark["x"]) ** 2 + (nearest_label["y"] - mark["y"]) ** 2) ** 0.5 > LEVEL_NOTE_DISTANCE:
                continue
            key = min(floor_girders, key=lambda k: (middle(k)[0] - mark["x"]) ** 2 + (middle(k)[1] - mark["y"]) ** 2)
            drops[key] = int(re.search(r"\d+", nearest_label["text"]).group())
    return drops


def count_plan_marks(pdf):
    """伏図の大梁の符号の数。軸組図からの読み取りの確かめに使う"""
    counts = {}
    for floor, page in PLAN_PAGES.items():
        counts[floor] = Counter(
            found.group(1)
            for w in page_words(pdf, page)
            if (found := re.match(r"(G[1-5])(?![\d])", w["text"]))
        )
    return counts


def build(pdf):
    heights = read_heights(pdf)
    penthouse_fall = read_penthouse_fall(pdf)
    grid_x, grid_y = read_grid_spans(pdf)
    sections = {**read_columns_and_girders(pdf), **read_foundation_beams(pdf)}
    frames = read_frames(pdf)
    columns = collect_columns(frames, heights["line_y"])
    girders = collect_girders(frames, columns, heights["line_y"])
    drops = read_plan_drops(pdf, girders, grid_x, grid_y)

    # 屋根の勾配。R階は Y の小さい方、PHR階は X の小さい方が水上
    y_values, x_values = list(grid_y.values()), grid_x
    roof_slope = heights["roof_fall"] / (max(y_values) - min(y_values))
    penthouse_columns = [x for (story, x, _y) in columns if story == "RF"]
    penthouse_far = max(grid_x[x] for x in penthouse_columns)
    penthouse_slope = penthouse_fall / (penthouse_far - min(x_values.values()))

    def floor_level(name, x, y):
        z = heights["floor_z"][name]
        if name == "RF":
            return z - roof_slope * y
        if name == "PHRF":
            return z - penthouse_slope * x
        return z

    def beam_top(key, x, y):
        level = key[0]
        if level == "基礎":
            return heights["foundation_top"]
        return round(floor_level(level, x, y) - drops.get(key, heights["beam_drop"][level]))

    members = []
    for (story, x_name, y_name), mark in columns.items():
        x, y = grid_x[x_name], grid_y[y_name]
        upper = LEVELS[LEVELS.index(story) + 1]
        section = sections[mark]
        members.append({
            "type": "column", "mark": mark, "grid": f"{x_name}-{y_name}", "floor": story,
            "x": x, "y": y,
            "z0": heights["foundation_top"] if story == "1F" else round(floor_level(story, x, y)),
            "z1": round(floor_level(upper, x, y)),
            "width": section["width"], "section": section["section"],
        })
    for (level, line, start, end), mark in girders.items():
        if line[0] == "X":
            x0, x1, y0, y1 = grid_x[line], grid_x[line], grid_y[start], grid_y[end]
        else:
            x0, x1, y0, y1 = grid_x[start], grid_x[end], grid_y[line], grid_y[line]
        section = sections[mark]
        members.append({
            "type": "beam", "mark": mark, "grid": f"{line}/{start}-{end}", "floor": level,
            "x0": x0, "y0": y0, "x1": x1, "y1": y1,
            "z": beam_top((level, line, start, end), x0, y0), "z1": beam_top((level, line, start, end), x1, y1),
            "width": section["width"], "depth": section["depth"], "section": section["section"],
        })

    model = {
        "name": "後藤組本社屋（事務所・S造）",
        "source": "構造図の軸組図・鉄骨部材リスト・基礎梁リストから自動抽出（柱と大梁のみ）",
        "grid_x": grid_x,
        "grid_y": grid_y,
        "levels": heights["floor_z"],
        "floors": FLOORS,
        "members": members,
    }
    return model, columns, girders


def report(model, columns, girders, pdf):
    print("通り芯", model["grid_x"], model["grid_y"])
    print("階", model["levels"])
    for story in LEVELS[:-1]:
        print(f"柱 {story}:", dict(sorted(Counter(m for (s, _x, _y), m in columns.items() if s == story).items())))
    plan = count_plan_marks(pdf)
    for level in ["基礎", *PLAN_PAGES]:
        built = Counter(mark for (lv, *_rest), mark in girders.items() if lv == level)
        print(f"大梁 {level}: {dict(sorted(built.items()))}", f"伏図の符号 {dict(sorted(plan[level].items()))}" if level in plan else "")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--pdf", type=Path, required=True)
    parser.add_argument("--out", type=Path, required=True)
    args = parser.parse_args()
    model, columns, girders = build(args.pdf)
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(model, ensure_ascii=False) + "\n")
    report(model, columns, girders, args.pdf)
    print(f"部材 {len(model['members'])} 個 → {args.out}")


if __name__ == "__main__":
    main()
