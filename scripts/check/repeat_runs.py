"""同じ条件で ai_review.py を繰り返し、検出のばらつきを測る。

  python repeat_runs.py --runs 3 --budget 3
  python repeat_runs.py --publish-stats     # 画面に出す回数の集計だけを demo-data に書く

画面の指摘（check-result.json）は変えない。詳しい集計は ~/sekozu-data/check-runs/ に置く。
"""
import argparse
import json
import subprocess
import sys
from datetime import datetime
from pathlib import Path

from common import DEMO, RUNS, write_json
from evaluate import evaluate

# 定価（ドル / 100万トークン）。claude-opus-5-5
PRICE_INPUT = 4
PRICE_OUTPUT = 20

# ai_review.py が上書きする結果。画面の元になった回の値に戻す
KEEP = [RUNS / "latest.json", RUNS / "program.json", RUNS / "kui_table_260817.json"]


def run_cost(raw_dir):
    """(ドル, 使われたモデルの一覧, 入力, 出力)"""
    cost, models, total_in, total_out = 0.0, set(), 0, 0
    for path in [*raw_dir.glob("read_table*.json"), raw_dir / "review.json"]:
        message = json.loads(path.read_text())
        usage = message["usage"]
        total_in += usage["input_tokens"]
        total_out += usage["output_tokens"]
        models.add(message["model"])
    cost = (total_in * PRICE_INPUT + total_out * PRICE_OUTPUT) / 1_000_000
    return cost, sorted(models), total_in, total_out


def one_run(key):
    before = set(RUNS.glob("ai-*"))
    subprocess.run([sys.executable, "-W", "ignore", "ai_review.py"], check=True, cwd=Path(__file__).parent)
    raw_dir = (set(RUNS.glob("ai-*")) - before).pop()
    result = json.loads((raw_dir / "merged.json").read_text())
    report = evaluate(result, key)
    cost, models, total_in, total_out = run_cost(raw_dir)
    return {
        "raw_dir": raw_dir.name,
        "models": models,
        "input_tokens": total_in,
        "output_tokens": total_out,
        "cost_usd": round(cost, 3),
        "detected": [d["id"] for d in report["detected"]],
        "missed": [m["id"] for m in report["missed"]],
        "false_positives": report["false_positives"],
        "traps_passed": all(t["passed"] for t in report["traps"]),
        "acceptable": report["acceptable"],
        "wording_problems": report["wording_problems"],
        "rejected_candidates": result["rejected_candidates"],
        "dropped": len(result["dropped_without_evidence"]),
        "findings": [
            {k: f.get(k) for k in ("id", "category", "severity", "title", "source")}
            for f in result["findings"]
        ],
    }


def publish_stats(key):
    """画面に出している回と直近の繰り返しを合わせ、項目ごとの検出回数だけを書き出す"""
    shown = evaluate(json.loads((RUNS / "latest.json").read_text()), key)
    repeat = json.loads(max(RUNS.glob("repeat-*.json")).read_text())["runs"]
    detected_sets = [[d["id"] for d in shown["detected"]], *[r["detected"] for r in repeat]]
    required = [e["id"] for e in key["entries"] if e["kind"] in ("real", "planted")]
    write_json(DEMO / "run-stats.json", {
        "runs": len(detected_sets),
        "detected": {i: sum(i in ids for ids in detected_sets) for i in required},
        "false_positives": len(shown["false_positives"]) + sum(len(r["false_positives"]) for r in repeat),
        "traps_passed": all(t["passed"] for t in shown["traps"]) and all(r["traps_passed"] for r in repeat),
    })


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--publish-stats", action="store_true")
    parser.add_argument("--runs", type=int, default=3)
    parser.add_argument("--budget", type=float, default=3.0, help="定価換算の上限（ドル）")
    args = parser.parse_args()

    key = json.loads((DEMO / "answer-key.json").read_text())
    if args.publish_stats:
        publish_stats(key)
        return
    saved = {path: path.read_bytes() for path in KEEP}
    runs, spent = [], 0.0
    report_path = RUNS / f"repeat-{datetime.now().strftime('%Y%m%d-%H%M%S')}.json"
    try:
        for i in range(args.runs):
            # 前回と同じだけかかると見て、上限を超えそうなら止める
            if runs and spent + runs[-1]["cost_usd"] > args.budget:
                print(f"予算の上限に近いので {i} 回で止めます（{spent:.2f} ドル）")
                break
            run = one_run(key)
            runs.append(run)
            spent += run["cost_usd"]
            write_json(report_path, {"runs": runs, "spent_usd": round(spent, 3)})
            print(f"[{i + 1}] 検出 {run['detected']} 未検出 {run['missed']} "
                  f"誤検知 {len(run['false_positives'])} ひっかけ {'通過' if run['traps_passed'] else '不合格'} "
                  f"{run['cost_usd']} ドル", flush=True)
    finally:
        for path, data in saved.items():
            path.write_bytes(data)
    print(f"合計 {spent:.2f} ドル（定価換算）。集計: {report_path}")


if __name__ == "__main__":
    main()
