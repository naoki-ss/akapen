"""読み取った結果を突き合わせて「建物データ」を作り、検算し、3Dを組み立てる。AIは呼ばない。

文字とAIが一致すれば「一致」、違えば文字の値を使って「不一致」。文字で確かめられなければ「AIのみ」。
3Dは建物データからプログラムで組み立てる。材料が足りなければ model は None（3Dなし）。
"""
import re
from collections import Counter, defaultdict

from building_pages import display_words

NUMBER = re.compile(r"^\d{1,3}(,\d{3})+$|^\d{3,6}$")
MARK_NEAR_COLUMN = 32
MARK_NEAR_BEAM = 28
SCALE_TOLERANCE = 0.03
MID_TOLERANCE = 0.2
# 梁の符号のすぐ近くにある (FL-230) のような記入を、その梁の高さの文字として読む
LEVEL_NOTE = re.compile(r"^\(?[A-Z0-9]*[FS]L([+-]\d+)\)?$")
LEVEL_NEAR_X, LEVEL_NEAR_Y = 12, 14
MARK = re.compile(r"^[A-Z]{1,3}\d+[A-Z]?(\(.*\))?$")


def base_mark(mark):
    """G5(B24) のような併記は、断面を引くときは G5 として扱う"""
    return re.sub(r"\(.*\)$", "", mark)


def number_of(text):
    return int(text.replace(",", "")) if NUMBER.match(text) else None


def grid_positions(words):
    """{'X1': 見た目の位置}。同じ記号が複数あるときは中央の値"""
    found = defaultdict(list)
    for x0, y0, x1, y1, text in words:
        if re.fullmatch(r"X\d{1,2}", text):
            found[text].append((x0 + x1) / 2)
        elif re.fullmatch(r"Y\d{1,2}", text):
            found[text].append((y0 + y1) / 2)
    return {name: sorted(values)[len(values) // 2] for name, values in found.items()}


def text_spans(words, axis, names, positions):
    """{(通り, 通り): mm}。隣り合う通りの真ん中あたりにある数字のうち、図面の縮尺に合うものを寸法とする"""
    pairs = [(a, b) for a, b in zip(names, names[1:]) if a in positions and b in positions]
    candidates = {}
    for a, b in pairs:
        low, high = sorted((positions[a], positions[b]))
        width = high - low
        for x0, y0, x1, y1, text in words:
            value = number_of(text)
            center = (x0 + x1) / 2 if axis == "x" else (y0 + y1) / 2
            if value and width > 0 and abs(center - (low + high) / 2) < width * MID_TOLERANCE:
                candidates.setdefault((a, b), []).append((value, value / width))
    scales = Counter(round(scale, 0) for values in candidates.values() for _, scale in values)
    if not scales:
        return {}
    scale = scales.most_common(1)[0][0]
    spans = {}
    for pair, values in candidates.items():
        fits = [value for value, ratio in values if abs(ratio - scale) / scale <= SCALE_TOLERANCE]
        if fits:
            spans[pair] = Counter(fits).most_common(1)[0][0]
    return spans


# 寸法線が通り芯と柱芯で分かれているとみなす、全体寸法との差の上限（mm）
SPLIT_DIMENSION_MAX = 1000


def adjacent_pairs(names, start, end):
    if start not in names or end not in names:
        return []
    a, b = sorted((names.index(start), names.index(end)))
    return [(names[i], names[i + 1]) for i in range(a, b)]


def natural(name):
    match = re.search(r"\d+", name)
    return (name[0], int(match.group()) if match else 0)


def plan_views(read, page):
    """1ページの中の図ごとに {source, page, reply, words} にする。reply は1つの図。図の範囲の文字だけを持つ"""
    words = display_words(page)
    reply = read["reply"]
    # 形式を広げる前の読み取りは、1ページに1つの図
    plans = reply["plans"] if "plans" in reply else [{**reply, "floors": [reply["floor"]], "region": None}]
    views = []
    for plan in plans:
        inside = words
        region = plan.get("region")
        if region and len(region) == 4:
            x0, y0, x1, y1 = region[0] * page.rect.width, region[1] * page.rect.height, region[2] * page.rect.width, region[3] * page.rect.height
            inside = [w for w in words if x0 <= (w[0] + w[2]) / 2 <= x1 and y0 <= (w[1] + w[3]) / 2 <= y1]
        views.append({"source": read["source"], "page": read["page"], "reply": plan, "words": inside})
    return views


def build(reads, doc_of):
    """reads は [{source, page, kind, title, reply}]。doc_of(source) は pymupdf の文書。建物データを返す"""
    plans = [view for r in reads if r["kind"] == "伏図" for view in plan_views(r, doc_of(r["source"])[r["page"] - 1])]
    frames = [r for r in reads if r["kind"] == "軸組図"]
    lists = [r for r in reads if r["kind"] == "リスト"]
    checks = []

    def check(kind, message, refs=(), result="要確認"):
        checks.append({"kind": kind, "result": result, "message": message, "refs": list(refs)})

    words_of = {}
    for read in frames:
        words_of[(read["source"], read["page"])] = display_words(doc_of(read["source"])[read["page"] - 1])

    # 通り芯：いちばん多く出てきた並びを使う
    names = {}
    for axis, key in (("x", "grids_x"), ("y", "grids_y")):
        counts = Counter(tuple(r["reply"][key]) for r in plans if r["reply"][key])
        # 一部の階にしかない通りも落とさないよう、いちばん長い並びを使う。同じ長さなら多く出てきた並び
        names[axis] = list(max(counts, key=lambda row: (len(row), counts[row]))) if counts else []
        if not names[axis]:
            check("通り芯", f"{axis} 方向の通りを読めませんでした")
        elif len(counts) > 1:
            check("通り芯", f"{axis} 方向の通りの並びがページで違います：{[list(k) for k in counts]}", result="参考")

    # 寸法：AIの値と文字の値をページごとに集める
    span_rows = []
    for axis in ("x", "y"):
        ai_values, text_values = defaultdict(list), defaultdict(list)
        for read in plans:
            refs = {"source": read["source"], "page": read["page"]}
            for span in read["reply"]["spans"]:
                pairs = adjacent_pairs(names[axis], span["from"], span["to"])
                if span["axis"] == axis and len(pairs) == 1:
                    ai_values[pairs[0]].append((span["mm"], refs))
            page_words = read["words"]
            positions = grid_positions(page_words)
            for pair, value in text_spans(page_words, axis, names[axis], positions).items():
                text_values[pair].append((value, refs))
        verified = verified_spans(plans, axis, names[axis])
        for pair in zip(names[axis], names[axis][1:]):
            ai = Counter(value for value, _ in ai_values[pair]).most_common(1)
            text = Counter(value for value, _ in text_values[pair]).most_common(1)
            ai_value, text_value = ai[0][0] if ai else None, text[0][0] if text else None
            if ai_value is not None and text_value is not None:
                status = "一致" if ai_value == text_value else "不一致"
            else:
                status = "文字のみ" if text_value is not None else "AIのみ" if ai_value is not None else "読めず"
            value = verified.get(pair, text_value if text_value is not None else ai_value)
            if pair in verified:
                status = "全体の寸法と一致"
            if status in ("不一致", "読めず"):
                check("通り芯の寸法", f"{pair[0]}〜{pair[1]}：文字 {text_value}、AI {ai_value}", [pair[0], pair[1]])
            # 多数決で隠れないように、ページで読みが違うときも出す
            for name, values in (("AIの読み", ai_values[pair]), ("図面の文字", text_values[pair])):
                by_value = defaultdict(set)
                for seen_value, refs in values:
                    by_value[seen_value].add(refs["page"])
                if len(by_value) > 1:
                    detail = "、".join(f"{seen}（p.{'、'.join(str(n) for n in sorted(pages))}）" for seen, pages in sorted(by_value.items()))
                    check("通り芯の寸法", f"{pair[0]}〜{pair[1]}：{name}がページで違います。{detail}", [pair[0], pair[1]])
            span_rows.append({"axis": axis, "from": pair[0], "to": pair[1], "mm": value, "text": text_value, "ai": ai_value, "status": status})

    positions_mm = {}
    for axis in ("x", "y"):
        position, known = 0, True
        for index, name in enumerate(names[axis]):
            if known:
                positions_mm[name] = position
            if index < len(names[axis]) - 1:
                span = next(s for s in span_rows if s["axis"] == axis and s["from"] == name)
                if span["mm"] is None:
                    known = False
                else:
                    position += span["mm"]

    # 検算：全体の寸法と、途中の複数区間の寸法
    overall_rows = []
    seen = set()
    for read in plans:
        for overall in read["reply"]["overall"] + [s for s in read["reply"]["spans"] if len(adjacent_pairs(names[s["axis"]], s["from"], s["to"])) > 1]:
            key = (overall["axis"], overall["from"], overall["to"], overall["mm"])
            if key in seen:
                continue
            seen.add(key)
            overall_rows.append({"axis": overall["axis"], "from": overall["from"], "to": overall["to"], "mm": overall["mm"]})
            if overall["from"] in positions_mm and overall["to"] in positions_mm:
                total = abs(positions_mm[overall["to"]] - positions_mm[overall["from"]])
                if total != overall["mm"]:
                    check("寸法の合計", f"{overall['from']}〜{overall['to']}：区間の合計 {total}、全体の寸法 {overall['mm']}（p.{read['page']}）",
                          [overall["from"], overall["to"]])

    # 階：軸組図の階高の多数決
    stories = defaultdict(Counter)
    order = []
    overall_heights = []
    for read in frames:
        for frame in read["reply"]["frames"]:
            names_here = [level["name"] for level in frame["levels"]]
            if len(names_here) > len(order):
                order = names_here
            for level in frame["levels"]:
                if level["story_mm"] is not None:
                    stories[level["name"]][level["story_mm"]] += 1
            if frame["overall_height"]:
                overall_heights.append({**frame["overall_height"], "line": frame["line"], "page": read["page"]})
    frame_numbers = {number_of(w[4]) for words in words_of.values() for w in words}
    level_rows, elevation, levels_mm = [], 0, {}
    for name in [n for n in order if n != "基礎"]:
        levels_mm[name] = elevation
        count = stories.get(name)
        story = count.most_common(1)[0][0] if count else None
        status = "一致" if story in frame_numbers else "AIのみ"
        if count and len(count) > 1:
            check("階高", f"{name} の階高が通りで違います：" + "、".join(f"{value}（{times} 図）" for value, times in count.most_common()))
        level_rows.append({"name": name, "story_mm": story, "elevation_mm": elevation, "status": status if story is not None else "最上階"})
        if story is None and name != order[-1]:
            check("階高", f"{name} の階高を読めませんでした")
            break
        elevation += story or 0

    # 全体の高さ：同じ基準から測った値だけを比べる。基準が階にないもの（GL など）は参考に留める
    for height in {(h["mm"], h["from"], h["to"]) for h in overall_heights}:
        mm, start, end = height
        start_level = next((n for n in levels_mm if n in start or start.startswith(n.replace("F", "FL"))), None)
        end_level = next((n for n in levels_mm if n in end or end.startswith(n.replace("F", "FL"))), None)
        if start_level and end_level:
            total = levels_mm[end_level] - levels_mm[start_level]
            if total != mm:
                check("階高の合計", f"{start}〜{end}：階高の合計 {total}、全体の寸法 {mm}")
        elif levels_mm:
            check("階高の合計", f"全体の高さ {mm} は {start} からの値で、階の基準と違うので比べていません", result="参考")

    # 断面
    section_rows = []
    for read in lists:
        for section in read["reply"]["sections"]:
            section_rows.append({**section, "source": read["source"], "page": read["page"]})
    known_marks = {base_mark(section["mark"]) for section in section_rows}

    # 柱：軸組図から。両方向の図で符号が違えば要確認
    column_votes = defaultdict(list)
    for read in frames:
        for frame in read["reply"]["frames"]:
            for column in frame["columns"]:
                pair = sorted((frame["line"], column["at"]), key=natural)
                if len(pair) == 2 and pair[0][0] == "X" and pair[1][0] == "Y":
                    column_votes[(column["floor"], pair[0], pair[1])].append((column["mark"], read["page"]))
    column_rows = []
    for (floor, x, y), votes in sorted(column_votes.items()):
        counts = Counter(mark for mark, _ in votes)
        mark = counts.most_common(1)[0][0]
        if len(counts) > 1:
            check("柱の符号", f"{floor} {x}-{y}：図によって符号が違います（{dict(counts)}）", [x, y])
        column_rows.append({"mark": mark, "floor": floor, "x": x, "y": y, "status": "一致" if len(votes) > 1 and len(counts) == 1 else "1つの図のみ"})

    # 柱：軸組図の柱の符号が、伏図の文字にもあるか。伏図は上下の階の柱を書くことがあるので、その階と1つ上の階の図を見る
    floor_order = [row["name"] for row in level_rows]
    for row in column_rows:
        index = floor_order.index(row["floor"]) if row["floor"] in floor_order else -1
        nearby = floor_order[index:index + 2] if index >= 0 else []
        views = [view for view in plans if set(view["reply"]["floors"]) & set(nearby)]
        if views and not any(column_mark_near(view["words"], row) for view in views):
            row["status"] = "軸組図のみ"
            check("柱", f"{row['floor']} {row['x']}-{row['y']} の {row['mark']}：軸組図にありますが、伏図にこの符号の文字がありません", [row["x"], row["y"]])

    # 梁：伏図を元にし、軸組図と比べる。文字の場所でも確かめる
    beam_rows = {}
    for read in plans:
        page_words = read["words"]
        positions = grid_positions(page_words)
        for floor in read["reply"]["floors"]:
            for beam in read["reply"]["beams"]:
                axis_names = names["x"] if beam["from"][0] == "X" else names["y"]
                pairs = adjacent_pairs(axis_names, beam["from"], beam["to"])
                for a, b in pairs or [(beam["from"], beam["to"])]:
                    offset = beam["offset_mm"]
                    offset_end = beam["offset_end_mm"]
                    if len(pairs) > 1 and offset is not None and offset_end is not None and offset != offset_end:
                        start = positions_mm.get(beam["from"]), positions_mm.get(beam["to"])
                        pos_a, pos_b = positions_mm.get(a), positions_mm.get(b)
                        if None not in (*start, pos_a, pos_b) and start[0] != start[1]:
                            rate = (offset_end - offset) / (start[1] - start[0])
                            offset, offset_end = offset + rate * (pos_a - start[0]), offset + rate * (pos_b - start[0])
                    near = mark_near(page_words, positions, beam["mark"], beam["along"], a, b)
                    written = level_note(page_words, near) if near else None
                    if written is not None and written != offset:
                        check("梁の高さ", f"{floor} {beam['along']} {a}〜{b} {beam['mark']}：図面の文字は {written}、AIの読みは {offset}。文字を使います", [beam["along"]], result="参考")
                        offset, offset_end = written, written
                    beam_rows[(floor, beam["along"], a, b)] = {"mark": beam["mark"], "floor": floor, "along": beam["along"], "from": a, "to": b,
                                                               "offset_mm": offset, "offset_end_mm": offset_end, "status": "一致" if near else "AIのみ",
                                                               "source": read["source"], "page": read["page"]}
    frame_beams = {}
    for read in frames:
        for frame in read["reply"]["frames"]:
            for beam in frame["beams"]:
                axis_names = names["x"] if beam["from"][:1] == "X" else names["y"]
                for a, b in adjacent_pairs(axis_names, beam["from"], beam["to"]) or [(beam["from"], beam["to"])]:
                    frame_beams[(beam["floor"], frame["line"], a, b)] = (beam["mark"], read["page"])
    for key, (mark, page) in frame_beams.items():
        row = beam_rows.get(key)
        if row is None:
            check("梁", f"{key[0]} {key[1]} {key[2]}〜{key[3]}：軸組図（p.{page}）に {mark} があり、伏図にありません", [key[1]], result="参考")
            beam_rows[key] = {"mark": mark, "floor": key[0], "along": key[1], "from": key[2], "to": key[3], "offset_mm": None, "offset_end_mm": None,
                              "status": "軸組図のみ", "source": None, "page": page}
        elif base_mark(row["mark"]) != base_mark(mark):
            check("梁の符号", f"{key[0]} {key[1]} {key[2]}〜{key[3]}：伏図は {row['mark']}、軸組図（p.{page}）は {mark}", [key[1]])
    beams = sorted(beam_rows.values(), key=lambda b: (b["floor"], natural(b["along"]), natural(b["from"])))

    # 基礎梁の天端と勾配：軸組図の多数決。勾配は通りの位置から梁の両端の高さを計算する
    tops = Counter(frame["foundation_top_mm"] for read in frames for frame in read["reply"]["frames"] if frame.get("foundation_top_mm") is not None)
    foundation_top = tops.most_common(1)[0][0] if tops else None
    if len(tops) > 1:
        check("基礎梁の天端", f"図によって値が違います：{dict(tops)}")
    slopes = apply_slopes(frames, beams, positions_mm, check)
    if foundation_top is None and any(row["floor"] == "基礎" for row in beams):
        check("基礎梁の天端", "図面から読めなかったので、基礎梁は 1FL の高さに仮に置いています")

    # 検算：符号がリストにあるか、通り芯の上にあるか
    for mark in sorted({base_mark(row["mark"]) for row in column_rows + beams} - known_marks):
        check("符号", f"{mark} が部材のリストにありません", [mark], result="参考" if not section_rows else "要確認")
    for row in beams:
        if row["from"] not in positions_mm or row["to"] not in positions_mm or row["along"] not in positions_mm:
            check("梁の位置", f"{row['floor']} {row['mark']}：{row['along']} {row['from']}〜{row['to']} は通り芯の外（片持ちなど）なので、3Dに入れていません", [row["along"]], result="参考")

    return {
        "schema_version": 1,
        "pages": [],
        "grids": {"x": names["x"], "y": names["y"], "spans": span_rows, "overall": overall_rows},
        "levels": level_rows,
        "sections": section_rows,
        "columns": column_rows,
        "beams": beams,
        "foundation_top_mm": foundation_top,
        "slopes": slopes,
        "architecture": None,
        "checks": checks,
        "model_status": None,
    }


def column_mark_near(words, row):
    positions = grid_positions(words)
    if row["x"] not in positions or row["y"] not in positions:
        return False
    return any(w[4] == row["mark"] and abs((w[0] + w[2]) / 2 - positions[row["x"]]) <= MARK_NEAR_COLUMN
               and abs((w[1] + w[3]) / 2 - positions[row["y"]]) <= MARK_NEAR_COLUMN for w in words)


def verified_spans(plans, axis, names):
    """全体の寸法で確かめられる区間の値。1区間だけの全体寸法はそのまま使い、複数区間は足し算が合うものを使う。
    足りない分が少しだけなら、寸法線が通り芯と柱芯で分かれている（両端の 200 など）とみなして両端の区間に足す"""
    verified = {}
    rows = [(overall, {(s["from"], s["to"]): s["mm"] for s in read["reply"]["spans"] if s["axis"] == axis})
            for read in plans for overall in read["reply"]["overall"] if overall["axis"] == axis]
    for overall, _ in rows:
        pairs = adjacent_pairs(names, overall["from"], overall["to"])
        if len(pairs) == 1:
            verified.setdefault(pairs[0], overall["mm"])
    for overall, spans in sorted(rows, key=lambda row: -len(adjacent_pairs(names, row[0]["from"], row[0]["to"]))):
        pairs = adjacent_pairs(names, overall["from"], overall["to"])
        if len(pairs) < 2:
            continue
        # どの図の区間の読みかで合うものを探す
        all_spans = [spans] + [other for _, other in rows]
        values = []
        for pair in pairs:
            found = verified.get(pair)
            for table in all_spans:
                if found is None:
                    found = table.get(pair, table.get(pair[::-1]))
            values.append(found)
        if None in values:
            continue
        gap = overall["mm"] - sum(values)
        if gap == 0:
            verified.update({pair: value for pair, value in zip(pairs, values) if pair not in verified})
        elif 0 < gap <= SPLIT_DIMENSION_MAX and pairs[0] not in verified and pairs[-1] not in verified:
            values[0] += gap / 2
            values[-1] += gap / 2
            verified.update({pair: value for pair, value in zip(pairs, values) if pair not in verified})
    return verified


def whole_roof(floor):
    return floor.startswith(("R", "PH"))


def apply_slopes(frames, beams, positions_mm, check):
    """勾配を階ごとに決め、梁の両端の高さの差に足す。図で値が違うときは要確認にして、多い方を使う"""
    votes = defaultdict(Counter)
    lines = defaultdict(set)
    for read in frames:
        for frame in read["reply"]["frames"]:
            for slope in frame.get("slopes", []):
                if slope["high"] in positions_mm and slope["low"] in positions_mm:
                    drop = slope["drop_mm"]
                    distance = abs(positions_mm[slope["low"]] - positions_mm[slope["high"]])
                    ratio = re.fullmatch(r"(\d+(?:\.\d+)?)/(\d+)", slope["ratio"].strip())
                    if drop is None and ratio:
                        drop = round(distance * float(ratio.group(1)) / float(ratio.group(2)))
                    if drop is not None:
                        votes[slope["floor"]][(slope["high"], slope["low"], drop)] += 1
                        # 勾配があるのはこの図の通りだけ。同じ階でも水平な部分がある
                        if frame["line"][0] != slope["high"][0]:
                            lines[slope["floor"]].add(frame["line"])
    rows = []
    for floor, count in votes.items():
        (high, low, drop), _ = count.most_common(1)[0]
        if len(count) > 1:
            check("勾配", f"{floor}：図によって値が違います（{[list(k) for k in count]}）")
        # R階の屋根は全体に掛かる。途中の階の勾配（平屋の部分の屋根など）は、図に書かれた通りだけ
        rows.append({"floor": floor, "high": high, "low": low, "drop_mm": drop, "lines": [] if whole_roof(floor) else sorted(lines[floor])})
        start, end = positions_mm[high], positions_mm[low]
        axis = high[0]

        def fall(name):
            return drop * (positions_mm[name] - start) / (end - start)

        for beam in beams:
            if beam["floor"] != floor or beam["from"] not in positions_mm or beam["to"] not in positions_mm or beam["along"] not in positions_mm:
                continue
            first, second = (beam["from"], beam["to"]) if beam["from"][0] == axis else (beam["along"], beam["along"])
            # 勾配のない通りの梁は水平のまま。直交する梁は、どちらかの端が勾配のある通りなら勾配に乗る
            crossing = (beam["along"],) if beam["from"][0] == axis else (beam["from"], beam["to"])
            if not whole_roof(floor) and lines[floor] and not set(crossing) & lines[floor]:
                continue
            base = beam["offset_mm"] or 0
            beam["offset_mm"] = round(base - fall(first))
            beam["offset_end_mm"] = round(base - fall(second))
    return rows


def level_note(words, mark_word):
    """符号の文字のすぐ近くの高さの記入（mm）。なければ None。記入がいちばん近い符号（小梁など）のものだけを、その符号の高さとする"""
    marks = [w for w in words if MARK.match(w[4])]
    for x0, y0, _, _, text in words:
        match = LEVEL_NOTE.match(text)
        if match and abs(x0 - mark_word[0]) <= LEVEL_NEAR_X and abs(y0 - mark_word[1]) <= LEVEL_NEAR_Y:
            nearest = min(marks, key=lambda w: (w[0] - x0) ** 2 + (w[1] - y0) ** 2)
            if nearest[:4] == mark_word[:4]:
                return int(match.group(1))
    return None


def mark_near(words, positions, mark, along, start, end):
    """通り芯の上のその区間にある、符号の文字。なければ None"""
    if along not in positions or start not in positions or end not in positions:
        return None
    low, high = sorted((positions[start], positions[end]))
    for word in words:
        x0, y0, x1, y1, text = word
        if text != mark:
            continue
        cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
        run, across = (cx, cy) if along[0] == "Y" else (cy, cx)
        if low - MARK_NEAR_BEAM <= run <= high + MARK_NEAR_BEAM and abs(across - positions[along]) <= MARK_NEAR_BEAM:
            return word
    return None


def slope_fall(slopes, floor, x, y, coordinates):
    for slope in slopes:
        if slope["floor"] == floor:
            at = x if slope["high"][0] == "X" else y
            other = y if at == x else x
            if slope.get("lines") and other not in slope["lines"]:
                return 0
            start, end = coordinates[slope["high"]], coordinates[slope["low"]]
            return slope["drop_mm"] * (coordinates[at] - start) / (end - start)
    return 0


def section_for(sections, mark, floor):
    rows = [s for s in sections if s["mark"] == base_mark(mark) and (not s["floors"] or floor in s["floors"])]
    if not rows:
        return None
    # 端部と中央部で違うときは、端部を形として使う
    return next((s for s in rows if "端" in s["position"]), rows[0])


def typical_sections(sections):
    """断面を読めなかった部材の形。読めた断面の中央の値を使う（鉄骨とRCで大きさが違うので、決まった値にしない）"""
    def middle(key, kind):
        values = sorted(s[key] for s in sections if s[key] and s["mark"].startswith(kind))
        return values[len(values) // 2] if values else None
    return {"column": middle("width_mm", "C") or 300, "beam_width": middle("width_mm", "G") or 200, "beam_depth": middle("depth_mm", "G") or 400}


def fill_floating_columns(members, beams, floors, levels, grid_x, grid_y, foundation, checks):
    """上の階の柱の下に柱がなく、それを受ける梁もなければ、読み落としとみなして下の階の柱を足す"""
    columns = {(row["floor"], row["grid"]) for row in members if row["type"] == "column"}

    def carried(floor, x, y):
        # 梁の途中に載っていれば、梁で受けている（梁の端は受けにならない）
        for beam in beams:
            if beam["floor"] != floor:
                continue
            if beam["along"] == x and beam["from"][0] == "Y":
                low, high = sorted((grid_y.get(beam["from"], 0), grid_y.get(beam["to"], 0)))
                if low < grid_y[y] < high:
                    return True
            if beam["along"] == y and beam["from"][0] == "X":
                low, high = sorted((grid_x.get(beam["from"], 0), grid_x.get(beam["to"], 0)))
                if low < grid_x[x] < high:
                    return True
        return False

    for index in range(len(floors) - 1, 0, -1):
        floor, below = floors[index], floors[index - 1]
        for row in [m for m in members if m["type"] == "column" and m["floor"] == floor]:
            x, y = row["grid"].split("-")
            if (below, row["grid"]) in columns or carried(floor, x, y):
                continue
            members.append({**row, "floor": below, "mark": row["mark"], "z0": levels[below] + (foundation if index == 1 else 0), "z1": row["z0"]})
            columns.add((below, row["grid"]))
            checks.append({"kind": "柱", "result": "要確認", "message": f"{below} {row['grid']}：上の階に柱があり、受ける梁がないので柱を足しました", "refs": [x, y]})


def to_model(data, name):
    """建物データから3Dのモデル（lib/model.ts の BuildingModel）を組み立てる。組み立てられなければ None"""
    grid_x, grid_y = {}, {}
    for axis, target in (("x", grid_x), ("y", grid_y)):
        position = 0
        names = data["grids"][axis]
        if not names:
            return None
        target[names[0]] = 0
        for span in [s for s in data["grids"]["spans"] if s["axis"] == axis]:
            if span["mm"] is None:
                return None
            position += span["mm"]
            target[span["to"]] = position
    levels = {row["name"]: row["elevation_mm"] for row in data["levels"]}
    if not levels or not data["columns"]:
        return None
    floors = [row["name"] for row in data["levels"]]
    default_section = typical_sections(data["sections"])
    foundation = data.get("foundation_top_mm") or 0
    members = []
    for row in data["columns"]:
        if row["floor"] not in levels or row["x"] not in grid_x or row["y"] not in grid_y:
            continue
        # 軸組図の読みだけで、伏図に符号がない柱は描かない（確認の一覧には残る）
        if row["status"] == "軸組図のみ":
            continue
        index = floors.index(row["floor"])
        if index + 1 >= len(floors):
            continue
        section = section_for(data["sections"], row["mark"], row["floor"])
        # いちばん下の柱は基礎梁の天端から立てる
        bottom = levels[row["floor"]] + (foundation if index == 0 else 0)
        # 勾配のある階の下の柱は、その場所の高さまで立てる
        top = levels[floors[index + 1]] - slope_fall(data.get("slopes", []), floors[index + 1], row["x"], row["y"], {**grid_x, **grid_y})
        members.append({"type": "column", "mark": row["mark"], "grid": f"{row['x']}-{row['y']}", "floor": row["floor"],
                        "x": grid_x[row["x"]], "y": grid_y[row["y"]], "z0": bottom, "z1": round(top),
                        "width": (section or {}).get("width_mm") or default_section["column"], **({"section": section["text"]} if section else {})})
    fill_floating_columns(members, data["beams"], floors, levels, grid_x, grid_y, foundation, data["checks"])
    for row in data["beams"]:
        base = foundation if row["floor"] == "基礎" else levels.get(row["floor"])
        coordinates = {**grid_x, **grid_y}
        if base is None or not all(row[key] in coordinates for key in ("along", "from", "to")):
            continue
        along_y = row["along"] in grid_y
        x0, x1 = (coordinates[row["from"]], coordinates[row["to"]]) if along_y else (coordinates[row["along"]], coordinates[row["along"]])
        y0, y1 = (coordinates[row["along"]], coordinates[row["along"]]) if along_y else (coordinates[row["from"]], coordinates[row["to"]])
        section = section_for(data["sections"], row["mark"], row["floor"])
        start = row["offset_mm"] or 0
        end = row["offset_end_mm"] if row["offset_end_mm"] is not None else start
        members.append({"type": "beam", "mark": row["mark"], "grid": f"{row['along']}/{row['from']}-{row['to']}", "floor": row["floor"],
                        "x0": x0, "y0": y0, "x1": x1, "y1": y1, "z": base + start, "z1": base + end,
                        "width": (section or {}).get("width_mm") or default_section["beam_width"], "depth": (section or {}).get("depth_mm") or default_section["beam_depth"],
                        **({"section": section["text"]} if section else {})})
    if not members:
        return None
    return {"name": name, "source": "設計図書から建物データを作って組み立てた3D（AIの読みと図面の文字を突き合わせ）", "grid_x": grid_x, "grid_y": grid_y,
            "levels": levels, "floors": (["基礎"] if any(row["floor"] == "基礎" for row in data["beams"]) else []) + floors, "members": members}
