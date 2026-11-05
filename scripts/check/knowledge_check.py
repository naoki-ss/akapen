"""社内のチェックリスト（ナレッジ）にもとづく確認。朱書きは青。

チェックリストは社内ノウハウなので、リポジトリに入れない。~/sekozu-data/projects.json の checklist に登録した場所から実行時に読む。
項目の扱いはチェックリストの type と drawing_checkable で決める。
  design                   赤の照合（設計図書との照合）と重なるので、AIに渡さない
  knowledge, both          AIに渡して確認する。both は設計図との照合を除いた観点だけを見る
  drawing_checkable=false  AIに渡さず、一覧に「図面では判定できない（現地確認）」と出す

根拠の項目の内容は、AIの文章ではなくチェックリストの本文をそのまま添える。
"""
import copy
import json
import re

from pathlib import Path

ISSUE, OK, NOT_HERE = "指摘あり", "問題なし", "このページでは確認できない"
UNANSWERED = "未回答"
ON_SITE = "図面では判定できない（現地確認）"
DESIGN_SCOPE = "設計図書との照合（赤）の範囲"
# 複数ページのときは、この順に強い結果を項目の結果にする
RESULT_ORDER = [ISSUE, OK, NOT_HERE, UNANSWERED]

SYSTEM = """あなたは建設会社の施工図チェック担当です。提出された施工図の1ページを、社内のチェックリストの項目ごとに確認します。

入力:
- 施工図の1ページの画像。1枚目が全体、残りは同じページの分割図です（文字を読むために使います）
- チェックリストの項目

確認のしかた:
- 項目ごとに item_results に結果を1つ書きます。
  - 指摘あり：その項目の対象がこのページに描かれていて、項目を満たしていない可能性がある
  - 問題なし：その項目の対象がこのページに描かれていて、項目を満たしていると読める
  - このページでは確認できない：対象が描かれていない、図面の種類が違う、図面だけでは分からない
- 指摘ありの項目は、findings に項目ごとに書き、checklist_id に項目のIDを入れます。

判断の基準:
- チェックリストの項目にあることだけを指摘します。項目にない気づきは書きません。
- 設計図との照合は別の担当が行います。設計図との食い違いはここでは扱いません。
- 実際に読めた値と形だけを根拠にします。読み取れない箇所は推測せず unreadable に書きます。
- 別の図面に描かれるはずのものが、このページにないだけでは指摘しません。「このページでは確認できない」にします。
- 項目に書かれていない基準の値を、自分で決めません。
- どちらが正しいかを決めつけず、読めた内容を示して確認を求めます。
- 現場名、会社名、人名は書きません。

書き方:
- 「〜の可能性があります。ご確認ください」と書きます。
- 位置は通り芯で書きます。regions に、指摘の場所ごとの全体図に対する 0〜1 の範囲 [x0, y0, x1, y1] を入れます。複数の場所を指すときは、場所ごとに分けて全部入れます。
- comment は図面に書き込む短いコメントです。30文字以内で、何を確認するのかが分かるように書きます。
- reason は、なぜ問題かを1文（40字程度）で書きます。前置きや読めた値の説明ではなく、何が問題なのかを書きます。
- needs_confirmation は、図面だけでは言い切れず、人の確認が必要なときに true にします。"""


KNOWLEDGE = Path.home() / "sekozu-data" / "knowledge"
BUNDLE = KNOWLEDGE / "sekozu-checklist-knowledge.json"
# 画面から追加したナレッジ。項目ごとに対象の図面の種類を持つ
ADDED = KNOWLEDGE / "added"
STEEL = "鉄骨図"
# 対象の図面の種類を問わない項目
ALL_DRAWINGS = "すべての図面"
# 施工図の題名からチェックリストを選ぶ語。細かい種類を先に見る。画面の選択肢と同じファイルを使う
DRAWING_KINDS = json.loads((Path(__file__).parent / "drawing_kinds.json").read_text())
KINDS = [(kind["name"], kind["words"]) for kind in DRAWING_KINDS["kinds"]]
# 鉄骨の物件の、梁伏図や軸組図など
STEEL_WORDS = ["梁伏", "軸組", "鉄骨", "継手", "ブレース", "部材リスト", "仕口", "階段"]


def item_type(checks):
    """確認の文がすべて設計図との照合なら、赤の担当なのでAIに渡さない。一部なら設計図を除いた観点を見る"""
    design = [text for text in checks if "設計図" in text]
    if checks and len(design) == len(checks):
        return "design"
    return "both" if design else "knowledge"


def normalize_app(name, items):
    """まとめたファイルの項目を、判定で使う形にする。図面だけで判定できるかの印はないので、AIの回答に任せる"""
    done = []
    for entry in items:
        checks, criteria = entry.get("checks", []), entry.get("criteria", [])
        lines = list(checks) + [f"基準：{text}" for text in criteria]
        done.append({
            "id": f"{name}-{entry['no']}",
            "section": entry.get("section") or "",
            "item": entry.get("item") or "",
            "content": "／".join(lines),
            "note": entry.get("itemNote") or entry.get("sectionNote") or "",
            "type": item_type(list(checks) + list(criteria)),
            "drawing_checkable": True,
        })
    return done


def short_name(name):
    """アプリ名から「チェックリスト」と工法などの補足を除く。KINDS の名前と同じになる"""
    name = re.sub(r"\s*チェックリスト\s*$", "", name).strip()
    return re.sub(r"（.*$", "", name)


def load_library():
    """{チェックリストの名前: 項目のリスト}。社内ノウハウなのでリポジトリの外から読む。ないものは入らない"""
    library = {}
    if BUNDLE.exists():
        for app in json.loads(BUNDLE.read_text()):
            name = short_name(app["name"])
            library[name] = normalize_app(name, app["items"])
    # 1つだけのファイルは鉄骨図。項目の種類を手で付けてあり、これまでの結果と同じIDなので、まとめたファイルより優先する
    for source in sorted(KNOWLEDGE.glob("*.json")) if KNOWLEDGE.exists() else []:
        single = json.loads(source.read_text())
        if source != BUNDLE and isinstance(single, dict) and single.get("items"):
            library[STEEL] = single["items"]
    added = added_items()
    general = added.pop(ALL_DRAWINGS, [])
    for name, items in added.items():
        library.setdefault(name, []).extend(items)
    # すべての図面が対象の項目は、どの種類のチェックリストでも使う
    for items in library.values():
        items.extend(general)
    if general:
        library[ALL_DRAWINGS] = list(general)
    return apply_overrides(library)


def load_overrides():
    path = KNOWLEDGE / "overrides.json"
    return json.loads(path.read_text()) if path.exists() else {"deleted": [], "edited": {}}


def apply_overrides(library):
    """ナレッジ画面で直した内容と消した項目を反映する"""
    overrides = load_overrides()
    deleted = set(overrides["deleted"])
    done = {}
    for name, items in library.items():
        kept = [{**item, **overrides["edited"].get(item["id"], {})} for item in items if item["id"] not in deleted]
        if kept:
            done[name] = kept
    return done


def added_entries():
    """画面から追加した項目の一覧"""
    entries = []
    for source in sorted(ADDED.glob("*.json")) if ADDED.exists() else []:
        entries += json.loads(source.read_text())["items"]
    return entries


def added_items():
    """{図面の種類: 項目}。画面から追加したナレッジを、対象の図面の種類ごとに判定で使う形にする"""
    kinds = {}
    for entry in added_entries():
        row = {key: entry[key] for key in ("id", "section", "item", "content", "note", "type", "drawing_checkable", "source")}
        for kind in entry["drawing_types"]:
            kinds.setdefault(kind, []).append(row)
    return kinds


def choose_name(title, kind=None):
    """施工図の題名からチェックリストの名前を選ぶ。合うものがなければ None"""
    text = title or ""
    for name, words in KINDS:
        if any(word in text for word in words):
            return name
    if kind == "steel" and any(word in text for word in STEEL_WORDS):
        return STEEL
    # 画面から追加した、決まった種類にない図面の種類は、題名にその語があれば使う
    added = added_items()
    for name in added:
        if name != ALL_DRAWINGS and name in text:
            return name
    return ALL_DRAWINGS if ALL_DRAWINGS in added else None


def checklist_for(library, title, kind=None):
    """(名前, 項目)。その種類のチェックリストがなければ (名前, None)"""
    name = choose_name(title, kind)
    items = list(library.get(name) or []) if name else []
    # 画面から追加した、決まった種類にない図面の種類は、題名にその語があれば合わせて使う
    known = {item["id"] for item in items}
    for extra in added_items():
        if extra != name and extra != ALL_DRAWINGS and extra in (title or ""):
            items += [item for item in library.get(extra, []) if item["id"] not in known]
            known = {item["id"] for item in items}
    return name or (title if items else None), items or None


def used_name(raw_dir, library, title, kind=None):
    """そのページの判定で使ったチェックリストの名前。自動で選ぶ前の結果は、すべて鉄骨図"""
    path = Path(raw_dir) / "knowledge-checklist.json"
    if path.exists():
        return json.loads(path.read_text())["name"]
    if (Path(raw_dir) / "knowledge-result.json").exists():
        return STEEL
    return choose_name(title, kind)


def targets_of(items):
    """AIに確認させる項目"""
    return [item for item in items if item["type"] in ("knowledge", "both") and item["drawing_checkable"]]


def item_text(item):
    text = f"{item['id']}（{item['section']}）{item['item']}：{item['content']}"
    if item["note"]:
        text += f"（補足：{item['note']}）"
    if item["type"] == "both":
        text += "（設計図との照合を除いた観点で確認）"
    return text


def prompt_text(targets):
    lines = "\n".join(f"- {item_text(item)}" for item in targets)
    return f"この施工図のページを、次のチェックリストの項目ごとに確認してください。\n\nチェックリストの項目:\n{lines}"


def build_schema(targets):
    ids = [item["id"] for item in targets]
    return {
        "type": "object",
        "additionalProperties": False,
        "required": ["item_results", "findings", "unreadable"],
        "properties": {
            "item_results": {
                "type": "array",
                "items": {
                    "type": "object",
                    "additionalProperties": False,
                    "required": ["id", "result", "reason"],
                    "properties": {
                        "id": {"type": "string", "enum": ids},
                        "result": {"type": "string", "enum": [ISSUE, OK, NOT_HERE]},
                        "reason": {"type": "string"},
                    },
                },
            },
            "findings": {
                "type": "array",
                "items": {
                    "type": "object",
                    "additionalProperties": False,
                    "required": ["checklist_id", "title", "content", "severity", "grids", "marks", "regions", "comment", "reason", "needs_confirmation"],
                    "properties": {
                        "checklist_id": {"type": "string", "enum": ids},
                        "title": {"type": "string"},
                        "content": {"type": "string"},
                        "severity": {"type": "string", "enum": ["高", "中", "低"]},
                        "grids": {"type": "array", "items": {"type": "string"}},
                        "marks": {"type": "array", "items": {"type": "string"}},
                        "regions": {"type": "array", "items": {"type": "array", "items": {"type": "number"}}},
                        "comment": {"type": "string"},
                        "reason": {"type": "string"},
                        "needs_confirmation": {"type": "boolean"},
                    },
                },
            },
            "unreadable": {"type": "array", "items": {"type": "string"}},
        },
    }


def basis_text(item):
    """根拠。チェックリストの本文をそのまま使う"""
    text = f"{item['item']}：{item['content']}"
    return f"{text}（補足：{item['note']}）" if item["note"] else text


def to_findings(reply, targets, page_number, floor_level):
    """(朱書きの指摘, 対象外のIDで捨てた数)。項目のIDと本文はチェックリストから取る"""
    by_id = {item["id"]: item for item in targets}
    findings, dropped = [], 0
    for found in reply["findings"]:
        item = by_id.get(found["checklist_id"])
        if item is None:
            dropped += 1
            continue
        checklist_id = item["id"]
        findings.append({
            **copy.deepcopy(found),
            "source_type": "knowledge",
            "page": page_number,
            "floor_level": floor_level,
            "category": item["section"],
            "title": f"[{checklist_id}] {found['title']}",
            "comment": f"{checklist_id} {found['comment'] or found['title']}",
            "checklist": {"id": checklist_id, "basis": basis_text(item)},
            "evidence": [{"drawing": "チェックリスト", "page": checklist_id, "where": basis_text(item)}],
        })
    return findings, dropped


def page_results(reply, targets, findings):
    """このページでの項目ごとの結果。指摘があれば必ず指摘あり、回答がなければ未回答にする"""
    answered = {entry["id"]: entry for entry in reply["item_results"]}
    with_finding = {found["checklist"]["id"] for found in findings}
    results = {}
    for item in targets:
        entry = answered.get(item["id"])
        if item["id"] in with_finding:
            results[item["id"]] = {"result": ISSUE, "reason": entry["reason"] if entry else ""}
        elif entry is None:
            results[item["id"]] = {"result": UNANSWERED, "reason": ""}
        elif entry["result"] == ISSUE:
            # 枠も内容もない「指摘あり」は朱書きにできないので、そのまま未回答として見せる
            results[item["id"]] = {"result": UNANSWERED, "reason": f"指摘の内容が返らなかった：{entry['reason']}"}
        else:
            results[item["id"]] = {"result": entry["result"], "reason": entry["reason"]}
    return results


def summary_for(library, pages, kind=None):
    """判定したページで使ったチェックリストごとの結果をつなげる。ひとつも使っていなければ None"""
    done = {}
    for page in pages:
        if "knowledge" not in page.get("checks", {}):
            continue
        title = (page.get("classified") or {}).get("title")
        raw_dir = page.get("raw_dir")
        name = used_name(raw_dir, library, title, kind) if raw_dir else choose_name(title, kind)
        done.setdefault(name, []).append((page["number"], page["checks"]["knowledge"]["item_results"]))
    rows = []
    for name, results in done.items():
        for row in summary_rows(library.get(name, []), results):
            rows.append({**row, "checklist": name})
    return rows or None


def summary_rows(items, pages):
    """チェックリストの全項目の結果。pages は [(ページ番号, page_results の結果)]。判定に失敗したページは渡さない"""
    rows = []
    for item in items:
        row = {"id": item["id"], "item": item["item"], "content": item["content"], "type": item["type"], "pages": [], "reason": ""}
        if not item["drawing_checkable"]:
            row["result"] = ON_SITE
        elif item["type"] == "design":
            row["result"] = DESIGN_SCOPE
        else:
            row["result"] = UNANSWERED
            for result in RESULT_ORDER:
                hits = [(number, found[item["id"]]) for number, found in pages if item["id"] in found and found[item["id"]]["result"] == result]
                if hits:
                    row["result"] = result
                    row["pages"] = [number for number, _ in hits]
                    row["reason"] = hits[0][1]["reason"]
                    break
        rows.append(row)
    return rows
