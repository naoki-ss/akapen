"""座標つきの文字を突き合わせる照合（API を使わない部分）。

実図面の値をそのまま扱うので、結果は ~/sekozu-data/check-runs/ にだけ保存する。
"""
import json
import re
from collections import Counter

from common import (
    CIRCLED,
    PILE_GRID,
    RUNS,
    evidence,
    open_page,
    page_words,
    to_number,
    union,
    write_json,
)

# 杭一覧表は画像なので、読み取り結果を受け取る。ai_review.py の read_table が更新する
TABLE_PATH = RUNS / "kui_table_260817.json"


def read_new_plan():
    """施工順変更版の平面から、杭ごとの番号・符号・径・杭頭・打設順を取る"""
    words = page_words(open_page("kui_new", 1))
    specs = [w for w in words if re.fullmatch(r"\d+Φ/GL-\d+", w["text"])]
    piles = {}
    for w in words:
        m = re.fullmatch(r"(.)No\.(\d+)/(P\d)", w["text"])
        if not m:
            continue
        no = int(m[2])
        spec = min(
            specs,
            key=lambda s: abs(s["rect"][0] - w["rect"][0]) + abs(s["rect"][1] - w["rect"][1]),
        )
        dia, gl = re.fullmatch(r"(\d+)Φ/GL-(\d+)", spec["text"]).groups()
        piles[no] = {
            "no": no,
            "order": CIRCLED[m[1]],
            "mark": m[3],
            "dia": int(dia),
            "gl": int(gl),
            "grid": PILE_GRID[no],
            "label_rect": w["rect"],
            "spec_rect": spec["rect"],
        }
    return piles


def read_structural_plan():
    """構造図 p8 左の杭伏図から、通り芯ごとの杭符号を取る"""
    page = open_page("kozo", 8)
    words = page_words(page)
    half = page.rect.width / 2
    words = [w for w in words if w["rect"][0] < half]
    gx, gy = {}, {}
    for w in words:
        if re.fullmatch(r"X[1-4]", w["text"]):
            gx[w["text"]] = (w["rect"][0] + w["rect"][2]) / 2
        if re.fullmatch(r"Y[1-5]", w["text"]):
            gy[w["text"]] = (w["rect"][1] + w["rect"][3]) / 2
    marks = {}
    for w in words:
        if not re.fullmatch(r"P[1-8]", w["text"]):
            continue
        x, y = w["rect"][0], w["rect"][1]
        xk = max((k for k in gx if gx[k] <= x), key=lambda k: gx[k])
        yk = min((k for k in gy if gy[k] <= y), key=lambda k: y - gy[k])
        marks[f"{xk}-{yk}"] = {"mark": w["text"], "rect": w["rect"]}
    return marks


def read_pile_list():
    """構造図 p17 の杭リストから、符号ごとの本数と杭頭径を取る"""
    words = page_words(open_page("kozo", 17))
    # 表は P1〜P4 と P5〜P8 の2段。各段で符号の次に4列そろう径の行が杭頭径
    spec = {}
    # 符号は「P」と数字に分かれて入っているので、「P」の並びで列を決める
    p_words = [w for w in words if w["text"] == "P"]
    top_y = min(w["rect"][1] for w in p_words)
    bottom_y = max(w["rect"][1] for w in p_words)
    for block, block_y in ((range(1, 5), top_y), (range(5, 9), bottom_y)):
        heads = sorted(
            (w for w in p_words if abs(w["rect"][1] - block_y) < 3),
            key=lambda w: w["rect"][0],
        )
        top = heads[0]["rect"][3]
        diameters = [
            w for w in words
            if re.fullmatch(r"1,[0-9]{3}", w["text"]) and w["rect"][1] > top
        ]
        row_y = min(w["rect"][1] for w in diameters)
        cells = sorted(
            (w for w in diameters if abs(w["rect"][1] - row_y) < 3),
            key=lambda w: w["rect"][0],
        )
        if len(cells) < 4:
            raise SystemExit(f"杭リストの読み取りに失敗しました: {block}")
        for no, head in zip(block, heads):
            cell = min(cells, key=lambda w: abs(w["rect"][0] - head["rect"][0]))
            spec[f"P{no}"] = {"dia": to_number(cell["text"]), "rect": cell["rect"]}
    return spec


def check_piles(piles, structural, pile_list):
    findings = []
    for pile in piles.values():
        ref = structural.get(pile["grid"])
        if ref is None or ref["mark"] != pile["mark"]:
            findings.append({
                "category": "杭仕様",
                "severity": "高",
                "title": f"{pile['grid']} の杭符号が構造図と食い違っています",
                "content": f"No.{pile['no']} は施工図で {pile['mark']}、構造図で {ref and ref['mark']} です。",
                "members": {"grids": [pile["grid"]], "marks": [pile["mark"]], "floor": "基礎"},
                "model_refs": [f"pile|基礎|{pile['grid']}"],
                "evidence": [
                    evidence("kui_new", 1, pile["label_rect"], f"No.{pile['no']} の注記", pile["mark"]),
                ],
            })
        listed = pile_list[pile["mark"]]
        if listed["dia"] != pile["dia"]:
            ev = [
                evidence("kui_new", 1, union([pile["label_rect"], pile["spec_rect"]]),
                         f"No.{pile['no']}（{pile['grid']}）の注記", f"{pile['dia']}Φ"),
                evidence("kozo", 17, listed["rect"], f"杭リスト {pile['mark']} の杭径", f"{listed['dia']:,}φ"),
            ]
            if ref:
                ev.append(evidence("kozo", 8, ref["rect"], f"杭伏図 {pile['grid']} の符号", ref["mark"]))
            findings.append({
                "category": "杭仕様",
                "severity": "高",
                "title": f"{pile['grid']} の杭径が構造図と食い違っています",
                "content": (
                    f"No.{pile['no']}（{pile['mark']}）の杭径は、施工図で {pile['dia']:,}φ、"
                    f"構造図の杭リストで {listed['dia']:,}φ です。"
                ),
                "members": {"grids": [pile["grid"]], "marks": [pile["mark"]], "floor": "基礎"},
                "model_refs": [f"pile|基礎|{pile['grid']}"],
                "evidence": ev,
            })
    counts = Counter(p["mark"] for p in piles.values())
    if sum(counts.values()) != 18:
        raise SystemExit(f"杭の本数が想定と違います: {counts}")
    return findings


def check_order(piles):
    """変更前の一覧表と変更版の平面を比べる。変更そのものは指摘にせず changes に分ける"""
    if not TABLE_PATH.exists():
        return [], []
    table = json.loads(TABLE_PATH.read_text())
    old_orders = {int(k): v for k, v in table["orders"].items()}
    changes = []
    for no, pile in sorted(piles.items()):
        if old_orders[no] != pile["order"]:
            changes.append({
                "no": no,
                "grid": pile["grid"],
                "mark": pile["mark"],
                "before": old_orders[no],
                "after": pile["order"],
            })
    if not changes:
        return [], []
    page = open_page("kui_new", 1)
    # 図面の右上に追記された変更後の順番
    width, height = page.rect.width, page.rect.height
    side = [
        w for w in page_words(page)
        if w["rect"][0] > width * 0.8 and w["rect"][1] < height * 0.4
    ]
    side_rect = union(w["rect"] for w in side)
    finding = {
        "category": "施工順",
        "severity": "中",
        "title": "打設順の変更が杭一覧表に反映されていません",
        "content": (
            f"施工順変更版の平面図は {len(changes)} 本の打設順が変わっていますが、"
            "再発行されたのは平面図だけで、杭一覧表の打設順は変更前のままです。"
            "現場で一覧表を見ると、変更前の順番で施工するおそれがあります。"
        ),
        "members": {"grids": [c["grid"] for c in changes], "marks": [], "floor": "基礎"},
        "model_refs": [f"pile|基礎|{c['grid']}" for c in changes],
        "evidence": [
            evidence("kui_new", 1, side_rect, "変更後の打設順の追記", "⑫〜⑲ の新しい順番"),
            evidence("kui_old", 2, (726, 420, 1160, 770), "杭一覧表の打設順の列", "変更前の順番のまま"),
        ],
    }
    return [finding], changes


def check_beam_marks():
    """断面図にある小梁の符号が、伏せ図と構造図の1階伏図にあるかを見る"""
    pattern = re.compile(r"B\d+[A-Z]*")
    danmen = page_words(open_page("kiso_danmen", 1))
    fuse = page_words(open_page("kiso_fuse", 1))
    kozo_page = open_page("kozo", 9)
    kozo = [w for w in page_words(kozo_page) if w["rect"][0] < kozo_page.rect.width / 2]
    marks = lambda ws: {w["text"] for w in ws if pattern.fullmatch(w["text"])}
    findings = []
    for mark in sorted(marks(danmen) - marks(fuse) - marks(kozo)):
        word = next(w for w in danmen if w["text"] == mark)
        # 同じ小梁の系列で、伏せ図と構造図の両方にある符号を候補として示す
        base = re.sub(r"[A-Z]+$", "", mark)
        similar = sorted(
            m for m in marks(fuse) & marks(kozo) if m != mark and m.startswith(base)
        )
        found = next((m for m in similar if m.endswith("A")), similar[0] if similar else None)
        ev = [evidence("kiso_danmen", 1, word["rect"], "D-D 断面の小梁", mark)]
        if found:
            pump = next(w for w in fuse if w["text"] == "FB257")
            near = min(
                (w for w in fuse if w["text"] == found),
                key=lambda w: abs(w["rect"][0] - pump["rect"][0]) + abs(w["rect"][1] - pump["rect"][1]),
            )
            ev.append(evidence("kiso_fuse", 1, near["rect"], "X3〜X4、Y4〜Y5 間の小梁", found))
            ref = min(
                (w for w in kozo if w["text"] == found),
                key=lambda w: w["rect"][1],
            )
            ev.append(evidence("kozo", 9, ref["rect"], "1階伏図の小梁", found))
        findings.append({
            "category": "符号",
            "severity": "中",
            "title": f"断面図の小梁符号 {mark} が伏せ図と食い違っています",
            "content": (
                f"基礎断面図 D-D の小梁は {mark} ですが、基礎伏せ図と構造図の1階伏図に {mark} はなく、"
                f"同じ位置の小梁は {found} です。"
            ),
            "members": {"grids": ["X3-X4/Y4-Y5"], "marks": [mark, found], "floor": "基礎"},
            "model_refs": ["beam|基礎|X3-X4/Y4-Y5"],
            "evidence": ev,
        })
    return findings


def main():
    piles = read_new_plan()
    structural = read_structural_plan()
    pile_list = read_pile_list()
    findings = check_piles(piles, structural, pile_list)
    order_findings, changes = check_order(piles)
    findings += order_findings + check_beam_marks()
    for i, finding in enumerate(findings, 1):
        finding["id"] = f"PG-{i:02d}"
        finding["source"] = "program"
    result = {"findings": findings, "changes": changes, "pile_count": len(piles)}
    write_json(RUNS / "program.json", result)
    print(f"杭 {len(piles)} 本、構造図 {len(structural)} 本、指摘 {len(findings)} 件、変更 {len(changes)} 本")
    for finding in findings:
        print(" ", finding["id"], finding["category"], finding["title"])


if __name__ == "__main__":
    main()
