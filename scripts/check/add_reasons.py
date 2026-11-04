"""判定をやり直さずに、既存の指摘の文面から「理由の一文」を作って結果に足す。

  python add_reasons.py estimate <ジョブのフォルダ>...   費用の見込みを出す（AIの生成はしない）
  python add_reasons.py run <ジョブのフォルダ>...        作って reasons.json と result.json に足す
  python add_reasons.py fixed-estimate                  固定の結果（demo-data）の費用の見込みを出す
  python add_reasons.py fixed                           固定の結果に足す。理由がないものだけ作るので、publish で書き出し直したあとにもう一度実行する

文面にない内容を足さないように、AIには指摘の文面だけを渡す。数値が文面にない理由は捨てて、前のまま（本文の最初の文）にする。
"""
import json
import re
import sys
from pathlib import Path

import anthropic

from ai_review import MODEL, call_claude, load_env
from check_upload import EXPERIMENTS, PRICE_INPUT, PRICE_OUTPUT, message_cost
from common import PRIVATE, REPO, write_json
from steel_experiment import record_cost

BATCH = 40
FIXED = [REPO / "demo-data" / slug / "check-result.json" for slug in ("sample-x", "sample-b")]
MAX_CHARS = 70
# 低い思考量での1件あたりの出力の見込み（理由と番号、構造の分）
OUTPUT_TOKENS_PER_FINDING = 90

SYSTEM = """施工図の指摘の文面から、「なぜ問題か」を1文にまとめます。

守ること:
- 渡した文面に書かれている内容だけを使います。文面にない事実、数値、原因、基準、対処を足しません。
- 指摘の中身を変えません。「可能性」と書かれていれば言い切らず、「可能性」のまま書きます。
- 前置きや読めた値の列挙ではなく、何が問題なのかを書きます。
- 40字程度の1文にします。文末は「〜です」「〜があります」など、ですます調にします。
- 依頼の文（ご確認ください）は書きません。"""

SCHEMA = {
    "type": "object",
    "additionalProperties": False,
    "required": ["reasons"],
    "properties": {
        "reasons": {
            "type": "array",
            "items": {
                "type": "object",
                "additionalProperties": False,
                "required": ["id", "reason"],
                "properties": {"id": {"type": "string"}, "reason": {"type": "string"}},
            },
        }
    },
}


def body_of(finding):
    return re.sub(r"（根拠：.*$", "", finding["content"], flags=re.S).strip()


def prompt_of(findings):
    rows = [{"id": f["id"], "題名": f["title"], "文面": body_of(f)} for f in findings]
    return "次の指摘それぞれについて、id ごとに理由の一文を返してください。\n" + json.dumps(rows, ensure_ascii=False, indent=1)


def batches(findings):
    return [findings[i:i + BATCH] for i in range(0, len(findings), BATCH)]


def problem_of(reason, finding):
    """使えない理由なら、その説明を返す"""
    source = finding["title"] + finding["content"]
    if not reason or len(reason) > MAX_CHARS:
        return f"長さ {len(reason or '')} 字"
    numbers = re.findall(r"\d[\d,.]*", reason)
    missing = [n for n in numbers if n.replace(",", "") not in source.replace(",", "")]
    return f"文面にない数値 {missing}" if missing else None


def estimate(client, groups):
    tokens = findings = calls = 0
    for group in groups:
        for part in batches(group):
            counted = client.messages.count_tokens(model=MODEL, system=SYSTEM, messages=[{"role": "user", "content": prompt_of(part)}])
            tokens += counted.input_tokens
            findings += len(part)
            calls += 1
    output = findings * OUTPUT_TOKENS_PER_FINDING
    usd = (tokens * PRICE_INPUT + output * PRICE_OUTPUT) / 1_000_000
    print(f"{findings} 件、{calls} 回。入力 {tokens} トークン、出力の見込み {output} トークン（思考の分を除く）、約 {usd:.2f} ドル")
    print(f"思考の分で出力が3倍になっても約 {(tokens * PRICE_INPUT + 3 * output * PRICE_OUTPUT) / 1_000_000:.2f} ドル")


def fixed(client):
    """固定の結果は公開するデータなので、結果のファイルに直接足す。生の応答はリポジトリの外に置く"""
    total = 0.0
    for path in FIXED:
        result = json.loads(path.read_text())
        raw_dir = PRIVATE / "experiments" / "fixed-reasons" / path.parent.name
        raw_dir.mkdir(parents=True, exist_ok=True)
        rejected = []
        for index, part in enumerate(batches([f for f in result["findings"] if not f.get("reason")])):
            reply = call_claude(client, SYSTEM, [{"type": "text", "text": prompt_of(part)}], SCHEMA, raw_dir, f"batch{index}", effort="low")
            total += message_cost(raw_dir / f"batch{index}.json")[2]
            by_id = {entry["id"]: entry["reason"].strip() for entry in reply["reasons"]}
            for finding in part:
                reason = by_id.get(finding["id"])
                problem = problem_of(reason, finding)
                if problem:
                    rejected.append((finding["id"], problem))
                else:
                    finding["reason"] = reason
        write_json(path, result)
        print(f"{path.parent.name}: {sum(bool(f.get('reason')) for f in result['findings'])} / {len(result['findings'])} 件。捨てた理由 {rejected}")
    record_cost(EXPERIMENTS / "ledger.json", "add-reasons-fixed", round(total, 3))
    print(f"費用 {total:.3f} ドル")


def main():
    command, folders = sys.argv[1], [Path(p).resolve() for p in sys.argv[2:]]
    load_env()
    client = anthropic.Anthropic()
    if command == "fixed-estimate":
        estimate(client, [json.loads(path.read_text())["findings"] for path in FIXED])
        return
    if command == "fixed":
        fixed(client)
        return
    jobs = [(folder, json.loads((folder / "result.json").read_text())) for folder in folders]
    if command == "estimate":
        estimate(client, [result["findings"] for _, result in jobs])
        return
    total = 0.0
    for folder, result in jobs:
        raw_dir = folder / "raw" / "reasons"
        raw_dir.mkdir(parents=True, exist_ok=True)
        path = folder / "reasons.json"
        reasons = json.loads(path.read_text()) if path.exists() else {}
        rejected = []
        for index, part in enumerate(batches(result["findings"])):
            todo = [f for f in part if f["id"] not in reasons]
            if not todo:
                continue
            reply = call_claude(client, SYSTEM, [{"type": "text", "text": prompt_of(todo)}], SCHEMA, raw_dir, f"batch{index}", effort="low")
            total += message_cost(raw_dir / f"batch{index}.json")[2]
            by_id = {entry["id"]: entry["reason"].strip() for entry in reply["reasons"]}
            for finding in todo:
                reason = by_id.get(finding["id"])
                problem = problem_of(reason, finding)
                if problem:
                    rejected.append((finding["id"], problem))
                else:
                    reasons[finding["id"]] = reason
        write_json(path, reasons)
        for finding in result["findings"]:
            if finding["id"] in reasons:
                finding["reason"] = reasons[finding["id"]]
        write_json(folder / "result.json", result)
        print(f"{folder.name[:8]}: {len(reasons)} / {len(result['findings'])} 件。捨てた理由 {rejected}")
    record_cost(EXPERIMENTS / "ledger.json", "add-reasons", round(total, 3))
    print(f"費用 {total:.3f} ドル")


if __name__ == "__main__":
    main()
