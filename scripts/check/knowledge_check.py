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

from pathlib import Path

ISSUE, OK, NOT_HERE = "指摘あり", "問題なし", "このページでは確認できない"
UNANSWERED = "未回答"
ON_SITE = "図面では判定できない（現地確認）"
DESIGN_SCOPE = "設計図書との照合（赤）の範囲"
# 複数ページのときは、この順に強い結果を項目の結果にする
RESULT_ORDER = [ISSUE, OK, NOT_HERE, UNANSWERED]

SYSTEM = """あなたは建設会社の施工図チェック担当です。鉄骨製作会社から提出された鉄骨施工図の1ページを、社内のチェックリストの項目ごとに確認します。

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
- needs_confirmation は、図面だけでは言い切れず、人の確認が必要なときに true にします。"""


def load_checklist(project):
    """項目のリスト。登録がないかファイルがなければ None（ナレッジの確認をせず、そのことを一覧に書く）"""
    path = project.get("checklist")
    if not path or not Path(path).exists():
        return None
    return json.loads(Path(path).read_text())["items"]


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
                    "required": ["checklist_id", "title", "content", "severity", "grids", "marks", "regions", "comment", "needs_confirmation"],
                    "properties": {
                        "checklist_id": {"type": "string", "enum": ids},
                        "title": {"type": "string"},
                        "content": {"type": "string"},
                        "severity": {"type": "string", "enum": ["高", "中", "低"]},
                        "grids": {"type": "array", "items": {"type": "string"}},
                        "marks": {"type": "array", "items": {"type": "string"}},
                        "regions": {"type": "array", "items": {"type": "array", "items": {"type": "number"}}},
                        "comment": {"type": "string"},
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
