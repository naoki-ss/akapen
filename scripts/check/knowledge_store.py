"""ナレッジの一覧と追加・修正・削除。画面（lib/knowledge.ts）から呼ぶ。ナレッジは環境で共通で、物件に紐づけない。

  python knowledge_store.py list
  python knowledge_store.py add <元のファイル名>       標準入力の項目のリストを登録する
  python knowledge_store.py edit <項目のID>            標準入力の内容で直す
  python knowledge_store.py delete <項目のID>
"""
import json
import sys
import uuid
from datetime import datetime

from common import write_json
from knowledge_check import ADDED, ALL_DRAWINGS, BUNDLE, KNOWLEDGE, added_entries, item_type, load_library, load_overrides


def content_of(checks, criteria):
    return "／".join([*checks, *[f"基準：{text}" for text in criteria]])


def to_entry(raw, identifier, source_file, added_at):
    """画面の項目を、チェックリストと同じ形にする"""
    checks, criteria = raw["checks"], raw["criteria"]
    return {
        "id": identifier,
        "section": raw.get("section", ""),
        "item": raw["item"],
        "content": content_of(checks, criteria),
        "note": raw.get("note", ""),
        "type": item_type([*checks, *criteria]),
        "drawing_checkable": bool(raw.get("drawing_checkable", True)),
        "drawing_types": raw["drawing_types"],
        "source": {"file": source_file, "page": raw.get("source_page", "")},
        "added_at": added_at,
    }


def split_content(content):
    parts = [part for part in content.split("／") if part]
    return [part for part in parts if not part.startswith("基準：")], [part[3:] for part in parts if part.startswith("基準：")]


def list_items():
    """全部の項目。同じ項目が複数の図面の種類に入っているときは1行にまとめる"""
    added = {entry["id"]: entry for entry in added_entries()}
    rows = {}
    date = datetime.fromtimestamp(BUNDLE.stat().st_mtime).date().isoformat() if BUNDLE.exists() else ""
    for name, items in load_library().items():
        for item in items:
            row = rows.get(item["id"])
            if row:
                if name not in row["drawing_types"] and name != ALL_DRAWINGS and item["id"] not in added:
                    row["drawing_types"].append(name)
                continue
            entry = added.get(item["id"])
            checks, criteria = split_content(item["content"])
            rows[item["id"]] = {
                "id": item["id"],
                "section": item["section"],
                "item": item["item"],
                "checks": checks,
                "criteria": criteria,
                "note": item.get("note") or "",
                "drawing_checkable": item["drawing_checkable"],
                "drawing_types": item.get("drawing_types") or (entry["drawing_types"] if entry else [name]),
                "source": (entry or item).get("source") or {"file": "kintoneのチェックリスト", "page": ""},
                "added_at": entry["added_at"] if entry else date,
            }
    return list(rows.values())


def add_items(source_file, raws):
    stamp = uuid.uuid4().hex[:8]
    now = datetime.now().astimezone().date().isoformat()
    entries = [to_entry(raw, f"K{stamp}-{index}", source_file, now) for index, raw in enumerate(raws, 1)]
    write_json(ADDED / f"{stamp}.json", {"items": entries})
    print(json.dumps({"items": len(entries)}))


def save_overrides(overrides):
    write_json(KNOWLEDGE / "overrides.json", overrides)


def edit_item(identifier, raw):
    # 追加した項目はファイルを直す（対象の図面の種類も変えられる）。取り込み済みの項目は差分を残す
    for source in ADDED.glob("*.json") if ADDED.exists() else []:
        data = json.loads(source.read_text())
        for index, entry in enumerate(data["items"]):
            if entry["id"] == identifier:
                updated = to_entry(raw, identifier, entry["source"]["file"], entry["added_at"])
                updated["source"]["page"] = raw.get("source_page", entry["source"]["page"])
                data["items"][index] = updated
                write_json(source, data)
                return
    overrides = load_overrides()
    overrides["edited"][identifier] = {"section": raw.get("section", ""), "item": raw["item"], "content": content_of(raw["checks"], raw["criteria"]),
                                       "note": raw.get("note", ""), "drawing_checkable": bool(raw.get("drawing_checkable", True))}
    save_overrides(overrides)


def delete_item(identifier):
    for source in ADDED.glob("*.json") if ADDED.exists() else []:
        data = json.loads(source.read_text())
        kept = [entry for entry in data["items"] if entry["id"] != identifier]
        if len(kept) != len(data["items"]):
            if kept:
                write_json(source, {"items": kept})
            else:
                source.unlink()
            return
    overrides = load_overrides()
    overrides["deleted"] = sorted({*overrides["deleted"], identifier})
    save_overrides(overrides)


def main():
    command = sys.argv[1]
    if command == "list":
        print(json.dumps(list_items(), ensure_ascii=False))
    elif command == "add":
        add_items(sys.argv[2], json.loads(sys.stdin.read()))
    elif command == "edit":
        edit_item(sys.argv[2], json.loads(sys.stdin.read()))
    elif command == "delete":
        delete_item(sys.argv[2])


if __name__ == "__main__":
    main()
