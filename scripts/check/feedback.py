"""朱書きから消した指摘と理由（環境共通）を、次のチェックに活かす。

消した指摘は ~/sekozu-data/feedback/removed.json にある（画面が書く）。
「対応済み」は図面を直したという意味で、指摘が不要だったのではないので使わない。
"""
import hashlib
import json

from claude_api import PRICE_INPUT, PRICE_OUTPUT, call_claude
from common import PRIVATE, write_json

FILE = PRIVATE / "feedback" / "removed.json"
CACHE = PRIVATE / "feedback" / "matched.json"
NOT_USED = {"対応済み"}
MAX_IN_PROMPT = 40

SYSTEM = """あなたは施工図チェックの結果を整理する担当です。今回の指摘が、過去に人が「不要」と判断した指摘と同じ種類かどうかを、文面だけから判定します。

同じ種類：同じ観点で、同じ理由で不要になると考えられるもの。部材や場所が違っても、指摘の性質が同じなら同じ種類です。
違う種類：同じ部材でも、確認している中身が違うもの。値の具体的な食い違いを示す指摘は、過去の指摘が同じ部材の同じ値についてのものでなければ違う種類です。迷うときは違う種類とします。"""


def items():
    if not FILE.exists():
        return []
    return [row for row in json.loads(FILE.read_text()) if row.get("reason") not in NOT_USED]


def line(row, index):
    reason = row.get("reason") or "理由なし"
    note = f"（{row['note']}）" if row.get("note") else ""
    return f"F{index}：{row['title']}　判断：{reason}{note}"


def prompt_note():
    """判定のプロンプトに足す文。消した指摘がなければ空で、プロンプトは変わらない"""
    rows = items()[-MAX_IN_PROMPT:]
    if not rows:
        return ""
    lines = "\n".join(f"- {line(row, index)}" for index, row in enumerate(rows, 1))
    return f"\n\n過去に不要とされた指摘:\n次の指摘は、人が確認して不要と判断しました。同じ種類の指摘は出さないでください。\n{lines}"


def key_of(item, rows):
    text = f"{item['title']}\n{item['content']}\n{json.dumps([row['title'] for row in rows], ensure_ascii=False)}"
    return hashlib.sha256(text.encode()).hexdigest()[:16]


def schema(keys):
    return {"type": "object", "additionalProperties": False, "required": ["matches"],
            "properties": {"matches": {"type": "array", "items": {
                "type": "object", "additionalProperties": False, "required": ["key", "same_kind", "feedback"],
                "properties": {"key": {"type": "string", "enum": keys}, "same_kind": {"type": "boolean"}, "feedback": {"type": "string"}},
            }}}}


def apply(client, findings, raw_dir):
    """(残す指摘, 抑えた指摘, 費用)。AIを呼べないときは保存済みの判定だけを使う"""
    rows = items()[-MAX_IN_PROMPT:]
    if not rows or not findings:
        return findings, [], 0.0
    cache = json.loads(CACHE.read_text()) if CACHE.exists() else {}
    keyed = [(key_of(item, rows), item) for item in findings]
    pending = {key: item for key, item in keyed if key not in cache}
    usd = 0.0
    if pending and client:
        text = ["過去に不要とされた指摘:", *[line(row, index) for index, row in enumerate(rows, 1)], "", "今回の指摘:"]
        text += [f"[{key}] {item['title']}：{item['content']}" for key, item in pending.items()]
        reply = call_claude(client, SYSTEM, [{"type": "text", "text": "\n".join(text)}], schema(list(pending)), raw_dir, "feedback", effort="low")
        usage = json.loads((raw_dir / "feedback.json").read_text())["usage"]
        usd = (usage["input_tokens"] * PRICE_INPUT + usage["output_tokens"] * PRICE_OUTPUT) / 1_000_000
        for entry in reply["matches"]:
            cache[entry["key"]] = {"same_kind": entry["same_kind"], "feedback": entry["feedback"]}
        write_json(CACHE, cache)
    kept, suppressed = [], []
    for key, item in keyed:
        if cache.get(key, {}).get("same_kind"):
            suppressed.append({"page": item["page"], "source_type": item["source_type"], "title": item["title"],
                               "content": item["content"], "reason": f"過去の判断（{cache[key]['feedback']}）"})
        else:
            kept.append(item)
    return kept, suppressed, usd
