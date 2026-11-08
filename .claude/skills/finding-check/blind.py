"""施工図の判定結果を、どの条件で判定したかを伏せた形にして、採点係（finding-reviewer）に渡すファイルを作る。

  python3 .claude/skills/finding-check/blind.py <置き場所> <結果1> [<結果2> ...]

  <結果> は次のどれか
    - 判定のフォルダ（~/sekozu-data/uploads/<ID>）か、その中の result.json
    - 固定の結果 demo-data/sample-b/check-result.json
  人の朱書きがあるのは 2SL・3SL・RSL の梁伏図だけ。それ以外のページは採点しない。

置き場所に次を作る。
  blind/<A,B,...>-<sheet>.json  採点係に渡す。指摘の文面と枠だけ。判定の方法・費用・時間・元の番号は入れない。順番も混ぜる
  blind/human-<sheet>.json      人の朱書き（validation/sample-b/human-compare.json から、前回の採点の結果を除いたもの）
  key.json                      伏せた名前と元の結果の対応。採点が終わるまで採点係に見せない（tally.py が使う）
"""
import json
import random
import string
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]
HUMAN = REPO / "validation" / "sample-b" / "human-compare.json"
SHEETS = {"s02": "2SL 梁伏図", "s03": "3SL 梁伏図", "s06": "RSL 梁伏図"}


def load(source):
    path = Path(source).expanduser()
    if path.is_dir():
        path = path / "result.json"
    return path, json.loads(path.read_text())


def pages_of(result):
    """sheet（s02 など）→ そのページの指摘。判定のフォルダはページの題名で、固定の結果は sheet で探す"""
    found = {}
    titles = {page.get("number"): page.get("title") for page in result.get("pages", []) if isinstance(page, dict)}
    for finding in result["findings"]:
        drawing = finding.get("drawing") or {}
        sheet = drawing.get("sheet")
        if sheet not in SHEETS:
            title = titles.get(drawing.get("page")) or (next(iter(titles.values())) if len(titles) == 1 else None)
            sheet = next((key for key, name in SHEETS.items() if name == title), None)
        if sheet:
            found.setdefault(sheet, []).append(finding)
    return found


def main():
    if len(sys.argv) < 3:
        sys.exit(__doc__)
    out = Path(sys.argv[1])
    (out / "blind").mkdir(parents=True, exist_ok=True)
    rng = random.SystemRandom()
    human = json.loads(HUMAN.read_text())["items"]
    labels = list(string.ascii_uppercase)
    rng.shuffle(labels)
    key = {}
    for label, source in zip(labels, sys.argv[2:]):
        path, result = load(source)
        for sheet, findings in pages_of(result).items():
            rng.shuffle(findings)
            items = []
            for index, finding in enumerate(findings, 1):
                blind_id = f"{label}{index}"
                regions = finding.get("regions") or [((finding.get("drawing") or {}).get("bbox"))]
                items.append({"id": blind_id, "title": finding.get("title", ""), "content": finding.get("content", ""),
                              "regions": [r for r in regions if r]})
                key[f"{label}-{sheet}/{blind_id}"] = {"source": str(path), "number": finding.get("number"), "id": finding.get("id")}
            (out / "blind" / f"{label}-{sheet}.json").write_text(json.dumps(
                {"sheet": sheet, "drawing": SHEETS[sheet], "findings": items}, ensure_ascii=False, indent=1))
            key[f"{label}-{sheet}"] = {"source": str(path), "count": len(items)}
    for sheet in SHEETS:
        rows = [{"id": item["id"], "note": item["note"], "bbox": item["bbox"]} for item in human if item["sheet"] == sheet]
        (out / "blind" / f"human-{sheet}.json").write_text(json.dumps({"sheet": sheet, "drawing": SHEETS[sheet], "human": rows},
                                                                       ensure_ascii=False, indent=1))
    (out / "key.json").write_text(json.dumps(key, ensure_ascii=False, indent=1))
    made = sorted(p.name for p in (out / "blind").glob("*.json"))
    print(f"採点係に渡すファイル（{out / 'blind'}）：{', '.join(made)}")
    print(f"対応表（採点係に見せない）：{out / 'key.json'}")


main()
