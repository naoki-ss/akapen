"""新しい方法で作った物件Bの3Dを、公開するデモのデータに差し替える。物件Bだけを扱う。

今の3Dの複数区間の梁（Y1/X3-X5）は、新しい3Dでは1区間ごと（Y1/X3-X4、Y1/X4-X5）に分かれている。
指摘と施工図の索引が同じ部材を指し続けるように、参照も1区間ごとに展開する。何度実行しても同じ結果になる。
"""
import json
import re

from common import PRIVATE, REPO, write_json

SOURCE = PRIVATE / "projects" / "sample-b-new" / "model.json"
OUT = REPO / "demo-data" / "sample-b"
NAME = "後藤組本社屋（事務所・S造）"
BEAM = re.compile(r"^beam\|([^|]+)\|([XY]\d+)/([XY]\d+)-([XY]\d+)$")


def expand(key, model):
    """部材のキーを、新しい3Dにあるキーのリストにする"""
    match = BEAM.match(key)
    if not match:
        return [key]
    floor, along, start, end = match.groups()
    names = list(model["grid_x"] if start[0] == "X" else model["grid_y"])
    a, b = sorted((names.index(start), names.index(end)))
    return [f"beam|{floor}|{along}/{names[i]}-{names[i + 1]}" for i in range(a, b)]


def main():
    model = json.loads(SOURCE.read_text())
    model["name"] = NAME
    # 外観と建設地は architecture_read.py が足す。作り直しても消さない
    current = json.loads((OUT / "model.json").read_text())
    for key in ("architecture", "site"):
        if key in current:
            model[key] = current[key]
    keys = {f"{m['type']}|{m['floor']}|{m['grid']}" for m in model["members"]}

    result_path, sheets_path = OUT / "check-result.json", OUT / "sheets.json"
    result = json.loads(result_path.read_text())
    for finding in result["findings"]:
        refs = [new for key in finding["model_refs"] for new in expand(key, model)]
        finding["model_refs"] = list(dict.fromkeys(refs))
    sheets = json.loads(sheets_path.read_text())
    expanded = {}
    for key, refs in sheets["member_sheets"].items():
        for new in expand(key, model):
            expanded.setdefault(new, []).extend(ref for ref in refs if ref not in expanded.get(new, []))
    sheets["member_sheets"] = expanded

    lost = {ref for finding in result["findings"] for ref in finding["model_refs"]} - keys
    lost |= set(expanded) - keys
    if lost:
        raise SystemExit(f"新しい3Dにない部材を指しています: {sorted(lost)[:10]}")
    write_json(OUT / "model.json", model)
    write_json(result_path, result)
    write_json(sheets_path, sheets)
    print(f"部材 {len(model['members'])}。施工図の索引がない部材 {len(keys - set(expanded))}")


if __name__ == "__main__":
    main()
