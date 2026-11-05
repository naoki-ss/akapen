"""図面台帳。設計図書をページごとに図番・図名で一覧にし、新しい版を元のページに束ねる。

  python drawing_ledger.py propose <物件> <取り込みID>     図番・図名を読み、束ねる先の案を返す（AIを呼ばない）
  python drawing_ledger.py read-titles <物件> <取り込みID>  文字で読めないページの図名をAIで読む
  python drawing_ledger.py commit <物件> <取り込みID>      標準入力の内容で台帳に入れる
  python drawing_ledger.py baseline <物件> <版,版>         今の設定の設計図書が台帳のどの版かを記録する
  python drawing_ledger.py export <物件> -                 公開してよい物件の台帳を demo-data に書き出す
  python drawing_ledger.py page-hashes <判定のフォルダ> -   施工図のページの描画のハッシュ（版の見分けに使う）

束ねる先は図名を優先する。同じ図番でも中身が違うことがあるので、図番だけでは束ねない。合わないページは入れるときに選ばせる。
台帳と入れたPDFはリポジトリの外（~/sekozu-data/ledger/）に置く。
"""
import hashlib
import json
import re
import shutil
import sys
import unicodedata
from datetime import datetime
from pathlib import Path

import pymupdf

from building_pages import display_words, title_of
from common import PRIVATE, REPO, write_json
from claude_api import PRICE_INPUT, PRICE_OUTPUT

ROOT = PRIVATE / "ledger"
PROJECTS = PRIVATE / "projects.json"
# 全ページの版とみなす、既にあるページ数に対する割合
FULL_SET_RATIO = 0.8
PAGE_LONG_EDGE = 1568
AI_USD_PER_PAGE = 0.03
USD_PER_MODEL_PAGE = 0.22

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
    # 3Dの材料になるページの読み直しの費用（読んだページは使い回すので、多くてもこの額）
    model_pages = sum(1 for row in rows if re.search(r"伏図|軸組|リスト", row["title"] or ""))
    return {"pages": rows, "unread": unread, "ai_usd": round(unread * AI_USD_PER_PAGE, 2), "model_usd": round(model_pages * USD_PER_MODEL_PAGE, 1),
            "sheets": [{"id": s["id"], "title": s["title"], "versions": len(s["versions"])} for s in ledger["sheets"]]}


MARK = re.compile(r"^[A-Z]{1,4}\d{1,3}[A-Z]?$")
GRID = re.compile(r"^[XY]\d+$")
# 比べるのに足りる文字数。文字のないページは比べない
MIN_WORDS = 50
ROW_TOLERANCE = 0.004
CELL_GAP = 0.02


def plain(word):
    return unicodedata.normalize("NFKC", word).replace(" ", "").upper()


def table_rows(page, words):
    """{符号: 行の文字}。部材リストのように、行の先頭に符号がある表を読む"""
    width, height = page.rect.width, page.rect.height
    limit = height * 0.86
    rows = {}
    for word in words:
        if word[1] < limit:
            rows.setdefault(round(word[1] / height / ROW_TOLERANCE), []).append(word)
    found = {}
    for row in rows.values():
        row.sort(key=lambda w: w[0])
        cells, current, last = [], [], None
        for word in row:
            if last is not None and (word[0] - last) / width > CELL_GAP:
                cells.append(current)
                current = []
            current.append(word[4])
            last = word[2]
        cells.append(current)
        texts = [plain("".join(cell)) for cell in cells]
        keys = [index for index, text in enumerate(texts) if MARK.match(text) and not GRID.match(text)]
        for position, index in enumerate(keys):
            end = keys[position + 1] if position + 1 < len(keys) else len(texts)
            found.setdefault(texts[index], " ".join(" ".join(cell) for cell in cells[index + 1:end]))
    return found


def mark_counts(words):
    counts = {}
    for word in words:
        text = plain(word[4])
        if MARK.match(text) and not GRID.match(text):
            counts[text] = counts.get(text, 0) + 1
    return counts


# 材料の記号など、部材の符号ではないもの
NOT_MEMBER = re.compile(r"^(SN|SNR|SS|SSC|SM|BCR|BCP|STK|STKR|SD|SDP|SUS|EZ|QL|UA|K|F|D)\d")
# 仕様書や標準図は、符号の増減を見ても部材の変化ではない
NOT_MEMBER_PAGE = re.compile(r"仕様|標準")


def compare_pages(before, after, title=""):
    """2つの版のページの文字を比べる。リストは行の違い、図は符号の数の違いを返す。読み取りではないので、位置までは分からない"""
    if NOT_MEMBER_PAGE.search(title):
        return None
    words_a, words_b = display_words(before), display_words(after)
    if len(words_a) < MIN_WORDS or len(words_b) < MIN_WORDS:
        return None
    if "リスト" in title:
        rows_a, rows_b = table_rows(before, words_a), table_rows(after, words_b)
        changed = [{"mark": mark, "before": rows_a[mark], "after": rows_b[mark]}
                   for mark in sorted(set(rows_a) & set(rows_b))
                   if not NOT_MEMBER.match(mark) and rows_a[mark] and rows_b[mark]
                   and rows_a[mark].replace(" ", "") != rows_b[mark].replace(" ", "")]
        added = [{"mark": mark, "before": "", "after": rows_b[mark]} for mark in sorted(set(rows_b) - set(rows_a)) if not NOT_MEMBER.match(mark)]
        removed = [{"mark": mark, "before": rows_a[mark], "after": ""} for mark in sorted(set(rows_a) - set(rows_b)) if not NOT_MEMBER.match(mark)]
        return {"rows": changed + added + removed, "marks": []}
    counts_a, counts_b = mark_counts(words_a), mark_counts(words_b)
    marks = [{"mark": mark, "before": counts_a.get(mark, 0), "after": counts_b.get(mark, 0)}
             for mark in sorted(set(counts_a) | set(counts_b))
             if counts_a.get(mark, 0) != counts_b.get(mark, 0) and not NOT_MEMBER.match(mark)]
    return {"rows": [], "marks": marks}


def add_changes(slug, ledger):
    """版ごとに、1つ前の版からの変化を入れる"""
    documents = {}

    def open_set(set_id):
        return documents.setdefault(set_id, pymupdf.open(ROOT / slug / "sets" / f"{set_id}.pdf"))

    for sheet in ledger["sheets"]:
        for older, newer in zip(sheet["versions"], sheet["versions"][1:]):
            newer["changes"] = compare_pages(open_set(older["set"])[older["page"] - 1], open_set(newer["set"])[newer["page"] - 1], newer["title"] or sheet["title"])


def latest_config(slug, ledger, project):
    """台帳の最新の版から、照合に使う設計図書の設定を作る。全ページの版を構造図に、そのあとの部分的な版を差替図面にする"""
    sets = ledger["sets"]
    full_index = max((i for i, item in enumerate(sets) if item["full"]), default=None)
    if full_index is None:
        return None
    base = sets[full_index]["id"]
    partial = [item["id"] for item in sets[full_index + 1:]]
    folder = ROOT / slug / "sets"
    # 部分的な版が1つならそのまま使う。2つ以上なら、ページごとに最新の版を1つのPDFにまとめる
    revised_pages, order = {}, []
    for sheet in ledger["sheets"]:
        latest = sheet["versions"][-1]
        if latest["set"] in partial:
            order.append((partial.index(latest["set"]), latest["page"], sheet["id"], latest["set"]))
    order.sort()
    if len(partial) == 1:
        revised = str(folder / f"{partial[0]}.pdf")
        revised_pages = {item[2]: item[1] for item in order}
    elif partial:
        revised = folder / f"merged-{'-'.join(partial)}.pdf"
        merged = pymupdf.open()
        for index, (_, page, sheet_id, set_id) in enumerate(order, 1):
            merged.insert_pdf(pymupdf.open(folder / f"{set_id}.pdf"), from_page=page - 1, to_page=page - 1)
            revised_pages[sheet_id] = index
        merged.save(revised)
        revised = str(revised)
    else:
        revised = None
    page_in = lambda sheet, set_id: next((v["page"] for v in sheet["versions"] if v["set"] == set_id), None)
    # 今の設定のページを、台帳のページに直す。今の構造図がどの版かは baseline で分かる
    old_base = next(item["id"] for item in sets if item["id"] in ledger["baseline"] and item["full"])
    sheet_at = {page_in(sheet, old_base): sheet for sheet in ledger["sheets"] if page_in(sheet, old_base)}
    new_page = lambda page: page_in(sheet_at[page], base) if page in sheet_at else None
    plans = {}
    for level, plan in project.get("plan_by_level", {}).items():
        sheet = sheet_at.get(plan.get("design"))
        plans[level] = {"design": new_page(plan.get("design")), "revised": revised_pages.get(sheet["id"]) if sheet else None}
    config = {"design": str(folder / f"{base}.pdf"), "revised": revised,
              "common_pages": [p for p in map(new_page, project.get("common_pages", [])) if p], "plan_by_level": plans}
    if project.get("default_plan"):
        config["default_plan"] = {"design": new_page(project["default_plan"].get("design"))}
    return config


def checked_sheets(ledger, project):
    """照合で使うページのID。この中のページが新しくなると、再チェックが必要になる"""
    old_base = next((item["id"] for item in ledger["sets"] if item["id"] in ledger.get("baseline", []) and item["full"]), None)
    if not old_base:
        return []
    pages = set(project.get("common_pages", []))
    pages |= {plan.get("design") for plan in project.get("plan_by_level", {}).values()}
    pages.add((project.get("default_plan") or {}).get("design"))
    return [sheet["id"] for sheet in ledger["sheets"] if any(v["set"] == old_base and v["page"] in pages for v in sheet["versions"])]


def set_baseline(slug, ids):
    """今の設定の設計図書が台帳のどの版かを記録する。これより前の判定は、この版で照合したものとして扱う"""
    ledger = load_ledger(slug)
    ledger["baseline"] = ids
    project = json.loads(PROJECTS.read_text())[slug]
    ledger["checked"] = checked_sheets(ledger, project)
    add_changes(slug, ledger)
    write_json(ledger_path(slug), ledger)
    print(json.dumps({"checked": len(ledger["checked"])}))


def repoint_project(slug, ledger):
    """新しい版を入れたら、これからの判定はその版で照合する"""
    if not ledger.get("baseline"):
        return
    projects = json.loads(PROJECTS.read_text())
    config = latest_config(slug, ledger, projects[slug])
    if config:
        projects[slug].update(config)
        write_json(PROJECTS, projects)
    # 設定のページ番号が新しくなったので、基準の版も今の版にそろえる
    full = [item["id"] for item in ledger["sets"] if item["full"]][-1]
    later = [item["id"] for item in ledger["sets"] if ledger["sets"].index(item) > [s["id"] for s in ledger["sets"]].index(full)]
    ledger["config_sets"] = [full, *later]


def page_hashes(folder):
    """判定した施工図のページの描画のハッシュ。同じ図面を別の切り出し方で入れても同じ値になるので、版の見分けに使う"""
    path = folder / "page_hashes.json"
    if path.exists():
        return json.loads(path.read_text())
    document = pymupdf.open(folder / "input.pdf")
    hashes = {str(page.number + 1): hashlib.sha256(page.get_pixmap(dpi=72, alpha=False).samples).hexdigest() for page in document}
    write_json(path, hashes)
    return hashes


def export_public(slug):
    """公開してよい物件の台帳を demo-data に書き出す。公開用の表示で一覧を見られるようにする"""
    ledger = load_ledger(slug)
    write_json(REPO / "demo-data" / slug / "ledger.json", ledger)


def current_sets(slug):
    """今の判定で照合に使う版"""
    ledger = load_ledger(slug)
    return ledger.get("config_sets") or ledger.get("baseline") or []


def read_titles(slug, incoming):
    """文字で読めないページの図名をAIで読む"""
    import anthropic

    from claude_api import call_claude, load_env
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
    add_changes(slug, ledger)
    repoint_project(slug, ledger)
    write_json(ledger_path(slug), ledger)
    print(json.dumps({"set": set_id, "sheets": len(ledger["sheets"])}))


def main():
    command, slug, incoming = sys.argv[1:4]
    if command == "page-hashes":
        print(json.dumps(page_hashes(Path(slug))))
    elif command == "baseline":
        set_baseline(slug, incoming.split(","))
    elif command == "export":
        export_public(slug)
    elif command == "propose":
        print(json.dumps(propose(slug, incoming), ensure_ascii=False))
    elif command == "read-titles":
        read_titles(slug, incoming)
    elif command == "commit":
        commit(slug, incoming, json.loads(sys.stdin.read()))


if __name__ == "__main__":
    main()
