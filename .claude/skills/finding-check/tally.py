"""採点係（finding-reviewer）の採点を、伏せた名前から元の結果に戻して数える。

  python3 .claude/skills/finding-check/tally.py <置き場所>

置き場所の key.json（blind.py が作る）と、採点係が書いた scores/<A>-<sheet>.json を読む。
採点のファイルの形：
  {"human": [{"id": "H10", "verdict": "一致" | "近い" | "なし", "findings": ["A3"], "reason": "..."}],
   "findings": [{"id": "A3", "verdict": "人と一致" | "人にない", "reason": "..."}]}

「図面から判断できる人の指摘」は、human-compare.json の summary が「打合せや製作上の判断」で始まらないもの。
"""
import collections
import json
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]
HUMAN = {item["id"]: item for item in json.loads((REPO / "validation/sample-b/human-compare.json").read_text())["items"]}


def judgeable(human_id):
    return not HUMAN[human_id]["summary"].startswith("打合せや製作上の判断")


def main():
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    folder = Path(sys.argv[1])
    key = json.loads((folder / "key.json").read_text())
    totals = collections.defaultdict(collections.Counter)
    for score_path in sorted((folder / "scores").glob("*.json")):
        name = score_path.stem
        if name not in key:
            sys.exit(f"{score_path.name} に対応する結果が key.json にありません")
        source = key[name]["source"]
        score = json.loads(score_path.read_text())
        print(f"\n■ {name}（{source}）指摘 {key[name]['count']} 件")
        for row in score["human"]:
            back = [str(key.get(f"{name}/{f}", {}).get("number") or key.get(f"{name}/{f}", {}).get("id") or f) for f in row.get("findings", [])]
            mark = "図面から判断できる" if judgeable(row["id"]) else "打合せ等"
            print(f"  {row['id']}（{mark}）：{row['verdict']}　指摘 {', '.join(back) or '-'}　{row.get('reason', '')}")
            totals[source][f"人 {row['verdict']}"] += 1
            if judgeable(row["id"]):
                totals[source]["図面から判断できる人の指摘"] += 1
                totals[source]["そのうち一致"] += row["verdict"] == "一致"
        for row in score.get("findings", []):
            totals[source][f"AI {row['verdict']}"] += 1
    print("\n■ 合計（結果ごと）")
    for source, counter in totals.items():
        print(f"  {source}")
        for label in ("人 一致", "人 近い", "人 なし", "図面から判断できる人の指摘", "そのうち一致", "AI 人と一致", "AI 人にない"):
            print(f"    {label}：{counter[label]}")


main()
