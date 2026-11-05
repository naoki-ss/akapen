"""赤を「矛盾」だけにする。指摘の文面だけで分類する（図面は読み直さない）。抜くのは、どの設計図書・議事録にも根拠がない表記不足だけ。

  python red_filter.py estimate    分類する指摘の数と費用の見込み
  python red_filter.py run         本社屋の判定結果と固定の結果を分類する（結果は保存し、同じ文面では呼ばない）

矛盾（食い違い・未反映）は赤のまま。議事録が根拠の指摘は必ず残す。表記不足だけのものは赤から抜き、ナレッジの項目に当てはまれば青にする。当てはまらなければ出さない。
"""
import copy
import hashlib
import json
import sys

from claude_api import PRICE_INPUT, PRICE_OUTPUT, call_claude, load_env
from common import PRIVATE, REPO, write_json

CACHE = PRIVATE / "red-filter" / "classified.json"
BATCH = 15
USD_PER_ITEM = 0.003

SYSTEM = """あなたは施工図チェックの結果を整理する担当です。設計図書との照合の指摘を、文面だけから次の3つに分類します。図面は見ません。

- 食い違い：値・寸法・材質・部材符号・位置が、設計図書（差替図面を含む）と食い違っている
- 未反映：設計図書にある部材・変更・記入が、施工図に反映されていない。「記入なし」「表示なし」「図示されていない」という言い方でも、設計図書のどこかに根拠が示されていれば未反映です（例：差替で追加された梁がない、設計図書に指定された記号の記入がない）
- 表記不足：施工図の書き方が足りないだけで、どの設計図書にも根拠が示されていない

判断のしかた:
- 指摘の文面に、設計図書の具体的なページ・図面・内容が根拠として示されていれば、表記不足にしません。
- 迷うときは赤に残します（食い違いか未反映）。抜きすぎないようにします。

basis に判断の根拠を書きます。食い違いと未反映は、文面に示された設計図書の場所と内容を30字程度で書きます。表記不足は「根拠の記載なし」のように、なぜ根拠がないと判断したかを書きます。
表記不足のときは、候補のチェック項目のうち、指摘の内容に当てはまるものがあれば knowledge_id にIDを書きます。はっきり当てはまるものだけです。なければ空にします。"""


def schema(ids):
    return {
        "type": "object",
        "additionalProperties": False,
        "required": ["items"],
        "properties": {"items": {"type": "array", "items": {
            "type": "object",
            "additionalProperties": False,
            "required": ["key", "kind", "knowledge_id", "basis"],
            "properties": {"key": {"type": "string", "enum": ids}, "kind": {"type": "string", "enum": ["食い違い", "未反映", "表記不足"]},
                           "knowledge_id": {"type": "string"}, "basis": {"type": "string"}},
        }}},
    }


def key_of(item, target_ids=()):
    text = f"{item['title']}\n{item['content']}\n{','.join(sorted(target_ids))}"
    return hashlib.sha256(text.encode()).hexdigest()[:16]


def load_cache():
    return json.loads(CACHE.read_text()) if CACHE.exists() else {}


def classify(client, rows):
    """rows は [(キー, 指摘, 候補の項目)]。結果は保存する。(結果, 費用)"""
    import tempfile
    from pathlib import Path

    cache = load_cache()
    # 議事録が根拠の指摘は、議事録で決まったことの未反映なので必ず赤に残す（AIに聞かない）
    for key, item, _ in rows:
        if item["source_type"] == "minutes" and key not in cache:
            refs = "、".join(str(e.get("page")) for e in item.get("evidence") or [])
            cache[key] = {"kind": "未反映", "reason": f"議事録 {refs} で決まっている", "knowledge_id": ""}
    pending = {key: (item, targets) for key, item, targets in rows if key not in cache}
    usd = 0.0
    keys = list(pending)
    raw = Path(tempfile.mkdtemp())
    for start in range(0, len(keys), BATCH) if client else []:
        part = keys[start:start + BATCH]
        candidates = {t["id"]: t for key in part for t in pending[key][1]}
        lines = ["候補のチェック項目:"] + [f"- {t['id']}：{t['item']}（{t['content']}）" for t in candidates.values()] + ["", "指摘:"]
        for key in part:
            item = pending[key][0]
            lines.append(f"[{key}] 根拠の種類：{'議事録' if item['source_type'] == 'minutes' else '設計図書'}\n題名：{item['title']}\n本文：{item['content']}\n"
                         f"施工図：{item.get('sheet_value') or ''}\n相手：{item.get('design_value') or item.get('decided_value') or ''}\n")
        name = f"batch{start}"
        reply = call_claude(client, SYSTEM, [{"type": "text", "text": "\n".join(lines)}], schema(part), raw, name, effort="low")
        usage = json.loads((raw / f"{name}.json").read_text())["usage"]
        usd += (usage["input_tokens"] * PRICE_INPUT + usage["output_tokens"] * PRICE_OUTPUT) / 1_000_000
        for entry in reply["items"]:
            allowed = {t["id"] for t in pending[entry["key"]][1]}
            cache[entry["key"]] = {"kind": entry["kind"], "reason": entry["basis"],
                                   "knowledge_id": entry["knowledge_id"] if entry["knowledge_id"] in allowed else ""}
        write_json(CACHE, cache)
    return cache, usd


def to_blue(item, target):
    """表記不足の指摘を、当てはまるチェック項目の青にする"""
    from knowledge_check import basis_text

    found = copy.deepcopy(item)
    identifier = target["id"]
    found.update({
        "source_type": "knowledge",
        "category": target["section"],
        "title": f"[{identifier}] {item['title']}",
        "comment": f"{identifier} {item.get('comment') or item['title']}",
        "checklist": {"id": identifier, "basis": basis_text(target)},
        "evidence": [{"drawing": "チェックリスト", "page": identifier, "where": basis_text(target)}],
        "converted_from_red": True,
    })
    return found


def apply(client, findings, targets_of_page):
    """(残す指摘, 抜いた指摘, 青にした数, 費用)。分類できなかった指摘は赤のまま残す"""
    rows = []
    for item in findings:
        if item["source_type"] != "knowledge":
            targets = targets_of_page(item["page"])
            rows.append((key_of(item, [t["id"] for t in targets]), item, targets))
    cache, usd = classify(client, rows)
    by_number = {id(item): (key, targets) for key, item, targets in rows}
    kept, removed, moved = [], [], 0
    for item in findings:
        known = by_number.get(id(item))
        result = cache.get(known[0]) if known else None
        if not result or result["kind"] != "表記不足":
            if result:
                item["red_kind"], item["red_basis"] = result["kind"], result["reason"]
            kept.append(item)
            continue
        target = next((t for t in known[1] if t["id"] == result["knowledge_id"]), None)
        if target:
            kept.append(to_blue(item, target))
            moved += 1
        else:
            removed.append({"page": item["page"], "source_type": item["source_type"], "title": item["title"],
                            "content": item["content"], "reason": result["reason"]})
    return kept, removed, moved, usd


def demo_folders():
    for path in sorted((PRIVATE / "uploads").glob("*/result.json")):
        if json.loads((path.parent / "job.json").read_text()).get("project") == "sample-b":
            yield path.parent


def fixed_path():
    return REPO / "demo-data" / "sample-b" / "check-result.json"


def fixed_rows():
    """固定の結果。公開するのでナレッジの項目は渡さない（青にせず、抜くだけ）"""
    return [(key_of({"title": f["title"], "content": f["content"]}), {**f, "source_type": f.get("source_type") or "design", "page": f["drawing"]["page"]}, [])
            for f in json.loads(fixed_path().read_text())["findings"]]


def job_rows():
    """判定結果の赤。分類の鍵は判定の元の文面で作るので、作り直しても同じ結果を使える"""
    import knowledge_check
    from check_upload import load_project
    from rebuild_job import page_findings

    library = knowledge_check.load_library()
    rows = []
    for folder in demo_folders():
        meta = json.loads((folder / "job.json").read_text())
        project = load_project(meta["project"])
        for number in meta.get("pages") or [1]:
            raw_dir = folder / "raw" / f"p{number}"
            classified_path = raw_dir / "classified.json"
            if not classified_path.exists():
                continue
            classified = json.loads(classified_path.read_text())
            found, _ = page_findings(raw_dir, project, classified, number, library, [])
            targets = targets_for(library, classified.get("title"), project.get("kind"))
            for item in found:
                rows.append((key_of(item, [t["id"] for t in targets]), item, targets))
            minutes_reply = raw_dir / "minutes-result.json"
            if minutes_reply.exists():
                import minutes_check

                docs = minutes_check.load_minutes(project, meta["project"])
                part, _ = minutes_check.to_findings(json.loads(minutes_reply.read_text()), minutes_check.all_items(docs), number, None)
                for item in part:
                    rows.append((key_of(item, [t["id"] for t in targets]), item, targets))
    return [row for row in rows if row[1]["source_type"] != "knowledge"]


def targets_for(library, title, kind):
    import knowledge_check

    items = knowledge_check.checklist_for(library, title, kind)[1]
    return knowledge_check.targets_of(items) if items else []


def apply_fixed():
    """固定の結果から抜く。公開するので、青にはせず抜くだけ。消した指摘の画像も消す"""
    import os

    path = fixed_path()
    data = json.loads(path.read_text())
    cache = load_cache()
    kept, removed = [], []
    for finding in data["findings"]:
        result = cache.get(key_of({"title": finding["title"], "content": finding["content"]}))
        if result and result["kind"] == "表記不足":
            removed.append({"id": finding["id"], "title": finding["title"], "reason": result["reason"]})
            for image in [e["image"] for e in finding["evidence"]] + [r["image"] for r in finding.get("design_refs", [])]:
                target = path.parent / image
                if os.path.exists(target):
                    os.remove(target)
        else:
            kept.append({**finding, "red_basis": result["reason"] if result else ""})
    data["findings"] = kept
    write_json(path, data)
    write_json(PRIVATE / "red-filter" / "fixed-removed.json", removed)
    review = REPO / "demo-data" / "image-review.json"
    reviewed = json.loads(review.read_text())
    review.write_text(json.dumps({k: v for k, v in reviewed.items() if (REPO / k).exists()}, indent=1))
    print(f"固定の結果 {len(kept)} 件を残し、{len(removed)} 件を抜きました")


def main():
    command = sys.argv[1]
    rows = job_rows() + fixed_rows()
    cache = load_cache()
    unique = {key: (item, targets) for key, item, targets in rows if key not in cache}
    print(f"分類する指摘 {len(unique)} 種類（全 {len(rows)} 件）。見込み 約 {len(unique) * USD_PER_ITEM:.2f} ドル")
    if command == "run":
        import anthropic

        from steel_experiment import ROOT, record_cost

        load_env()
        _, usd = classify(anthropic.Anthropic(), rows)
        record_cost(ROOT / "ledger.json", "red-filter", round(usd, 3))
        print(f"費用 {usd:.3f} ドル")
        import collections

        cache = load_cache()
        print(collections.Counter(cache[key]["kind"] for key, _, _ in rows if key in cache))
        apply_fixed()


if __name__ == "__main__":
    main()
