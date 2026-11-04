"""打合せの議事録と施工図の照合。朱書きは赤。

議事録は番号付きの項目（表の行の先頭、または太字の番号）で書く。AIは項目ごとに、この施工図に関係するかと、
反映されているかを返す。指摘の根拠は、AIの文章ではなく議事録の該当の行をそのまま添える。
"""
import re
from pathlib import Path

NOT_REFLECTED, REFLECTED = "反映されていない", "反映されている"
CANNOT_READ, UNRELATED = "この施工図では確認できない", "この施工図に関係しない"
UNANSWERED = "未回答"
RESULT_ORDER = [NOT_REFLECTED, REFLECTED, CANNOT_READ, UNRELATED, UNANSWERED]

TABLE_ROW = re.compile(r"^\|\s*(\d+-\d+)\s*\|(.*)\|\s*$")
BOLD_ITEM = re.compile(r"^-\s*\*\*(\d+-\d+)\*\*\s*(.*)$")

SYSTEM = """あなたは建設会社の施工図チェック担当です。施工図の1ページと、打合せの議事録を照らし合わせ、議事録で決まったことが施工図に反映されているかを確認します。

入力:
- 施工図の1ページの画像。1枚目が全体、残りは同じページの分割図です（文字を読むために使います）
- 議事録の全文。工事全体の打合せなので、施工図と関係のない議題も入っています

確認のしかた:
- 議事録の番号付きの項目ごとに、item_results に結果を1つ書きます。
  - この施工図に関係しない：工程、搬入、安全、別の工事の調整など、このページの図面の内容と関係がない
  - この施工図では確認できない：このページの内容に関係するが、図面からは読み取れない
  - 反映されている：決まった内容のとおりに描かれている
  - 反映されていない：決まった内容と図面の内容が食い違っている
- 反映されていない項目を findings に書き、minutes_ids に項目の番号を入れます。場所が近く、直す内容がひと続きの項目は、1件にまとめて番号を全部入れてかまいません。

判断の基準:
- 議事録に書かれていることだけを扱います。設計図との照合は別の担当が行います。
- 実際に読めた値だけを根拠にします。読み取れない箇所は推測せず unreadable に書きます。
- 議事録の場所の書き方と図面の場所を、通り芯で対応させてから比べます。場所が対応しない値を比べません。
- 保留の項目は、保留と分かるように描かれているかだけを見ます。値が違うという指摘はしません。
- どちらが正しいかを決めつけず、読めた値と決まった値を並べて確認を求めます。
- 現場名、会社名、人名は書きません。

書き方:
- 「〜と〜が食い違っています」「〜の可能性があります。ご確認ください」と書きます。
- sheet_value に図面で読めた値を、decided_value に議事録で決まった値を書きます。
- 位置は通り芯で書きます。regions に、指摘の場所ごとの全体図に対する 0〜1 の範囲 [x0, y0, x1, y1] を入れます。複数の場所を指すときは、場所ごとに分けて全部入れます。
- title は何が食い違っているかが分かる短い文にします。25文字以内で、議事録の番号は書きません。
- comment は図面に書き込む短いコメントです。30文字以内で、何を確認するのかが分かるように書きます。
- reason は、なぜ問題かを1文（40字程度）で書きます。前置きや読めた値の説明ではなく、何が問題なのかを書きます。
- needs_confirmation は、図面だけでは言い切れず、人の確認が必要なときに true にします。"""


def strip_notice(text):
    """先頭の引用（デモ用である旨の但し書き）は、人に向けた注記なのでAIに渡さない"""
    lines = text.splitlines()
    while lines and (lines[0].startswith(">") or not lines[0].strip()):
        lines.pop(0)
    return "\n".join(lines)


def parse_items(text):
    """{番号: 項目の行}。番号のない議事録は空を返す"""
    items = {}
    for raw in text.splitlines():
        line = raw.strip()
        row = TABLE_ROW.match(line)
        if row:
            cells = [cell.strip() for cell in row.group(2).split("|")]
            items[row.group(1)] = "／".join(cells)
            continue
        bullet = BOLD_ITEM.match(line)
        if bullet:
            items[bullet.group(1)] = bullet.group(2).strip()
    return items


def load_minutes(project):
    """[{name, text, items}]。登録がないかファイルがなければ空（議事録の照合をせず、そのことを一覧に書く）"""
    documents = []
    for path in project.get("minutes", []):
        path = Path(path)
        if not path.exists():
            continue
        text = strip_notice(path.read_text())
        items = parse_items(text)
        if items:
            documents.append({"name": path.stem, "text": text, "items": items})
    return documents


def all_items(documents):
    """{番号: (議事録の名前, 項目の行)}。複数の議事録があるときは、番号の前に議事録の名前を付ける"""
    merged = {}
    for document in documents:
        for number, line in document["items"].items():
            key = number if len(documents) == 1 else f"{document['name']}:{number}"
            merged[key] = (document["name"], line)
    return merged


def prompt_text(documents):
    blocks = [f"議事録（{document['name']}）:\n{document['text']}" for document in documents]
    return "この施工図のページを、次の議事録と照らし合わせてください。\n\n" + "\n\n".join(blocks)


def build_schema(ids):
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
                        "result": {"type": "string", "enum": [NOT_REFLECTED, REFLECTED, CANNOT_READ, UNRELATED]},
                        "reason": {"type": "string"},
                    },
                },
            },
            "findings": {
                "type": "array",
                "items": {
                    "type": "object",
                    "additionalProperties": False,
                    "required": ["minutes_ids", "title", "content", "severity", "grids", "marks", "sheet_value",
                                 "decided_value", "regions", "comment", "reason", "needs_confirmation"],
                    "properties": {
                        "minutes_ids": {"type": "array", "items": {"type": "string", "enum": ids}},
                        "title": {"type": "string"},
                        "content": {"type": "string"},
                        "severity": {"type": "string", "enum": ["高", "中", "低"]},
                        "grids": {"type": "array", "items": {"type": "string"}},
                        "marks": {"type": "array", "items": {"type": "string"}},
                        "sheet_value": {"type": "string"},
                        "decided_value": {"type": "string"},
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


def to_findings(reply, items, page_number, floor_level):
    """(朱書きの指摘, 番号のない指摘で捨てた数)。根拠は議事録の行から取る。関係しない項目の指摘も消さずに印を付ける"""
    results = {entry["id"]: entry["result"] for entry in reply["item_results"]}
    findings, dropped = [], 0
    for found in reply["findings"]:
        ids = [number for number in found["minutes_ids"] if number in items]
        if not ids:
            dropped += 1
            continue
        evidence = [{"drawing": f"議事録 {items[number][0]}", "page": number, "where": items[number][1]} for number in ids]
        findings.append({
            **found,
            "source_type": "minutes",
            "page": page_number,
            "floor_level": floor_level,
            "category": "議事録",
            # 題名は短く保つ。議事録の番号は根拠（evidence）に残し、詳細に出す
            "comment": f"議事録{ids[0]}{'他' if len(ids) > 1 else ''} {found['comment'] or found['title']}",
            "evidence": evidence,
            "minutes_ids": ids,
            "marked_unrelated": [number for number in ids if results.get(number) == UNRELATED],
        })
    return findings, dropped


def page_results(reply, items, findings):
    """このページでの項目ごとの結果。指摘があれば必ず「反映されていない」、回答がなければ未回答にする"""
    answered = {entry["id"]: entry for entry in reply["item_results"]}
    with_finding = {number for found in findings for number in found["minutes_ids"]}
    results = {}
    for number in items:
        entry = answered.get(number)
        if number in with_finding:
            results[number] = {"result": NOT_REFLECTED, "reason": entry["reason"] if entry else ""}
        elif entry is None:
            results[number] = {"result": UNANSWERED, "reason": ""}
        elif entry["result"] == NOT_REFLECTED:
            results[number] = {"result": UNANSWERED, "reason": f"指摘の内容が返らなかった：{entry['reason']}"}
        else:
            results[number] = {"result": entry["result"], "reason": entry["reason"]}
    return results


def summary_rows(items, pages):
    """全項目の結果。pages は [(ページ番号, page_results の結果)]"""
    rows = []
    for number, (_, line) in items.items():
        row = {"id": number, "item": "", "content": line, "result": UNANSWERED, "pages": [], "reason": ""}
        for result in RESULT_ORDER:
            hits = [(page, found[number]) for page, found in pages if number in found and found[number]["result"] == result]
            if hits:
                row["result"] = result
                row["pages"] = [page for page, _ in hits]
                row["reason"] = hits[0][1]["reason"]
                break
        rows.append(row)
    return rows
