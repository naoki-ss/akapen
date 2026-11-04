"""新しい方法で作った3Dと今の3Dを比べる。比べ方は読み取りの結果を見る前に決めた（issue #4）。

  python compare_models.py <今の model.json> <新しい model.json>

  通り芯  名前と位置（mm）が完全に同じ。目標 100%
  階      階の名前と高さ（mm）が同じ。目標 100%
  柱      階、通りの交点、符号が同じ。目標 95% 以上
  梁      階、通り、区間、符号が同じ。目標 90% 以上

一致率は「今の3Dの項目のうち、新しい3Dにも同じものがある割合」。今の3Dは正解ではないので、
どちらかにしかないものは全部書き出し、図面を見て分類する。
梁は通り芯の1区間ごとに分けて比べる（1本の記入が複数区間にまたがっていても同じ扱いにする）。
"""
import json
import sys
from pathlib import Path

TARGETS = {"通り芯": 1.0, "階": 1.0, "柱": 0.95, "梁": 0.90}


def beam_segments(member, order):
    """(階, 通り, 区間の始点, 区間の終点, 符号) を1区間ごとに返す。通り芯の上にない梁は区間に分けない"""
    along, span = member["grid"].split("/", 1)
    start, end = span.split("-", 1)
    names = order.get(start[0], [])
    if start not in names or end not in names:
        return [(member["floor"], along, start, end, member["mark"])]
    a, b = sorted((names.index(start), names.index(end)))
    return [(member["floor"], along, names[i], names[i + 1], member["mark"]) for i in range(a, b)]


def items(model):
    order = {"X": list(model["grid_x"]), "Y": list(model["grid_y"])}
    grids = {("X", name, value) for name, value in model["grid_x"].items()} | {("Y", name, value) for name, value in model["grid_y"].items()}
    levels = set(model["levels"].items())
    columns = {(m["floor"], m["grid"], m["mark"]) for m in model["members"] if m["type"] == "column"}
    beams = set()
    for member in model["members"]:
        if member["type"] == "beam":
            beams.update(beam_segments(member, order))
    return {"通り芯": grids, "階": levels, "柱": columns, "梁": beams}


def compare(current, new):
    """{項目: {一致率, 目標, 合格, 今, 新, 一致, 今だけ, 新だけ}}"""
    a, b = items(current), items(new)
    report = {}
    for name in TARGETS:
        same = a[name] & b[name]
        rate = len(same) / len(a[name]) if a[name] else 0.0
        report[name] = {"一致率": round(rate, 4), "目標": TARGETS[name], "合格": rate >= TARGETS[name], "今": len(a[name]), "新": len(b[name]),
                        "一致": len(same), "今だけ": sorted(a[name] - b[name], key=str), "新だけ": sorted(b[name] - a[name], key=str)}
    return report


def main():
    current = json.loads(Path(sys.argv[1]).read_text())
    new = json.loads(Path(sys.argv[2]).read_text())
    report = compare(current, new)
    for name, row in report.items():
        print(f"{name}: {row['一致']}/{row['今']} = {row['一致率']:.1%}（目標 {row['目標']:.0%}、{'合格' if row['合格'] else '未達'}）。新の件数 {row['新']}")
    print(json.dumps(report, ensure_ascii=False, indent=1, default=list))


if __name__ == "__main__":
    main()
