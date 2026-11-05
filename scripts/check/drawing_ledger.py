"""図面台帳。設計図書をページごとに図番・図名で一覧にし、新しい版を元のページに束ねる。

  python drawing_ledger.py propose <物件> <取り込みID>     図番・図名を読み、束ねる先の案を返す（AIを呼ばない）
  python drawing_ledger.py read-titles <物件> <取り込みID>  文字で読めないページの図名をAIで読む
  python drawing_ledger.py commit <物件> <取り込みID>      標準入力の内容で台帳に入れる

束ねる先は図名を優先する。同じ図番でも中身が違うことがあるので、図番だけでは束ねない。合わないページは入れるときに選ばせる。
台帳と入れたPDFはリポジトリの外（~/sekozu-data/ledger/）に置く。
"""
import json
import re
import shutil
import sys
import unicodedata
from datetime import datetime

import pymupdf

from building_pages import display_words, title_of
from common import PRIVATE, write_json
from repeat_runs import PRICE_INPUT, PRICE_OUTPUT

ROOT = PRIVATE / "ledger"
# 全ページの版とみなす、既にあるページ数に対する割合
FULL_SET_RATIO = 0.8
PAGE_LONG_EDGE = 1568
AI_USD_PER_PAGE = 0.03

TITLE_SYSTEM = """図面の1ページを見て、表題欄にある図面名と図面番号を答えます。読めなければ空にします。会社名や人名は書きません。"""
TITLE_SCHEMA = {
    "type": "object",
    "additionalProperties": False,
    "required": ["title", "number"],
    "properties": {"title": {"type": "string"}, "number": {"type": "string"}},
}


def ledger_path(slug):
    return ROOT / slug / "ledger.json"


def load_ledger(slug):
    path = ledger_path(slug)
    return json.loads(path.read_text()) if path.exists() else {"sets": [], "sheets": []}


def title_key(title):
    """図名を比べる形。縮尺と記号の違いは同じとみなす"""
    text = unicodedata.normalize("NFKC", title or "")
    text = re.sub(r"\d+/\d+", "", text)
    return re.sub(r"[\s\-‐－ー・･_]", "", text)


def drawing_number(page, words):
    """表題欄の右下にある図番。2桁の数字2つに分かれて書かれているものを読む"""
    width, height = page.rect.width, page.rect.height
    hits = sorted((w[0], w[4]) for w in words if w[0] / width > 0.85 and w[1] / height > 0.88 and re.fullmatch(r"\d{2}", w[4]))
    return f"{hits[0][1]}-{hits[1][1]}" if len(hits) >= 2 else ""


def clean_title(title):
    return re.sub(r"^\s*[-－]+|[-－]+\s*$|\s*1/\d+\s*", "", unicodedata.normalize("NFKC", title or "")).strip()


def read_pages(folder, incoming):
    """[{page, title, number, how}]。AIで読んだ図名があれば使う"""
    titles_path = folder / "incoming" / f"{incoming}.titles.json"
    ai_titles = json.loads(titles_path.read_text()) if titles_path.exists() else {}
    rows = []
    for page in pymupdf.open(folder / "incoming" / f"{incoming}.pdf"):
        words = display_words(page)
        title, number, how = clean_title(title_of(page, words)), drawing_number(page, words), "文字"
        known = ai_titles.get(str(page.number + 1))
        if not title and known:
            title, number, how = known["title"], known["number"] or number, "AI"
        rows.append({"page": page.number + 1, "title": title, "number": number, "how": how if title else "読めない"})
    return rows


def propose(slug, incoming):
    """ページごとの束ねる先の案。sheet は既にあるページのID、new は新しいページ、None は選んでもらう"""
    folder = ROOT / slug
    ledger = load_ledger(slug)
    by_title = {}
    for sheet in ledger["sheets"]:
        by_title.setdefault(title_key(sheet["title"]), []).append(sheet)
    numbers = {version["number"][-2:]: sheet for sheet in ledger["sheets"] for version in sheet["versions"] if version["number"]}
    rows = read_pages(folder, incoming)
    used = set()
    for row in rows:
        row["sheet"], row["note"] = None, ""
        matches = [s for s in by_title.get(title_key(row["title"]), []) if s["id"] not in used] if row["title"] else []
        same_number = numbers.get(row["number"][-2:]) if row["number"] else None
        if matches:
            row["sheet"] = matches[0]["id"]
            used.add(row["sheet"])
            row["note"] = "図名が一致"
        elif not ledger["sheets"]:
            row["sheet"] = "new"
        elif row["title"]:
            # 図名が合わないページは決めつけない。同じ図番のページがあれば、それも候補として示す
            row["candidate"] = same_number["id"] if same_number else None
            row["note"] = f"同じ図番のページの図名は「{same_number['title']}」です" if same_number else "同じ図名のページがありません"
        else:
            row["candidate"] = same_number["id"] if same_number else None
            row["note"] = "図名を読めませんでした"
    unread = sum(1 for row in rows if not row["title"])
    return {"pages": rows, "unread": unread, "ai_usd": round(unread * AI_USD_PER_PAGE, 2),
            "sheets": [{"id": s["id"], "title": s["title"], "versions": len(s["versions"])} for s in ledger["sheets"]]}


def read_titles(slug, incoming):
    """文字で読めないページの図名をAIで読む"""
    import anthropic

    from ai_review import call_claude, load_env
    from steel_experiment import ROOT as EXPERIMENTS, image_block, record_cost

    load_env()
    client = anthropic.Anthropic()
    folder = ROOT / slug
    raw = folder / "incoming" / f"{incoming}-raw"
    document = pymupdf.open(folder / "incoming" / f"{incoming}.pdf")
    path = folder / "incoming" / f"{incoming}.titles.json"
    titles = json.loads(path.read_text()) if path.exists() else {}
    usd = 0.0
    for row in read_pages(folder, incoming):
        if row["title"]:
            continue
        page = document[row["page"] - 1]
        zoom = PAGE_LONG_EDGE / max(page.rect.width, page.rect.height)
        png = page.get_pixmap(matrix=pymupdf.Matrix(zoom, zoom)).tobytes("png")
        name = f"p{row['page']}"
        reply = call_claude(client, TITLE_SYSTEM, [image_block(png), {"type": "text", "text": "図面名と図面番号を答えてください。"}],
                            TITLE_SCHEMA, raw, name, effort="low")
        titles[str(row["page"])] = {"title": clean_title(reply["title"]), "number": reply["number"]}
        usage = json.loads((raw / f"{name}.json").read_text())["usage"]
        usd += (usage["input_tokens"] * PRICE_INPUT + usage["output_tokens"] * PRICE_OUTPUT) / 1_000_000
    write_json(path, titles)
    record_cost(EXPERIMENTS / "ledger.json", f"ledger-titles-{incoming[:8]}", round(usd, 3))
    print(json.dumps({"usd": round(usd, 3)}))


def commit(slug, incoming, payload):
    """取り込みを台帳に入れる。assign は [{page, sheet（ID または new）, title}]"""
    folder = ROOT / slug
    ledger = load_ledger(slug)
    source = folder / "incoming" / f"{incoming}.pdf"
    rows = {row["page"]: row for row in read_pages(folder, incoming)}
    assign = payload["assign"]
    missing = [a["page"] for a in assign if not a.get("sheet") or (a["sheet"] == "new" and not (a.get("title") or "").strip())]
    if missing or {a["page"] for a in assign} != set(rows):
        sys.exit("束ねる先が決まっていないページがあります")
    set_id = f"s{len(ledger['sets']) + 1}"
    full = len(rows) >= FULL_SET_RATIO * max(1, len(ledger["sheets"]))
    (folder / "sets").mkdir(exist_ok=True)
    shutil.copyfile(source, folder / "sets" / f"{set_id}.pdf")
    ledger["sets"].append({"id": set_id, "label": payload["label"], "date": payload.get("date") or "", "pages": len(rows),
                           "full": full, "added_at": datetime.now().astimezone().isoformat(timespec="seconds")})
    sheets = {sheet["id"]: sheet for sheet in ledger["sheets"]}
    for item in sorted(assign, key=lambda a: a["page"]):
        row = rows[item["page"]]
        if item["sheet"] == "new":
            sheet = {"id": f"d{len(ledger['sheets']) + 1}", "title": item["title"].strip(), "versions": []}
            ledger["sheets"].append(sheet)
            sheets[sheet["id"]] = sheet
        elif item["sheet"] in sheets:
            sheet = sheets[item["sheet"]]
        else:
            sys.exit("束ねる先のページが台帳にありません")
        # 一覧には最新の版の図名を出す
        new_title = (item.get("title") or row["title"] or "").strip()
        if new_title:
            sheet["title"] = new_title
        sheet["versions"].append({"set": set_id, "page": item["page"], "number": row["number"], "title": item.get("title") or row["title"],
                                  "version": len(sheet["versions"]) + 1})
    write_json(ledger_path(slug), ledger)
    print(json.dumps({"set": set_id, "sheets": len(ledger["sheets"])}))


def main():
    command, slug, incoming = sys.argv[1:4]
    if command == "propose":
        print(json.dumps(propose(slug, incoming), ensure_ascii=False))
    elif command == "read-titles":
        read_titles(slug, incoming)
    elif command == "commit":
        commit(slug, incoming, json.loads(sys.stdin.read()))


if __name__ == "__main__":
    main()
