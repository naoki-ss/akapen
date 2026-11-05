"""④で施工図の隣に並べる根拠の資料を作る。

  python design_basis.py estimate   図面枠を探すページ数と費用の見込み（AIを呼ばない）
  python design_basis.py jobs       デモの判定結果（物件B）に根拠を足す。判定はやり直さない
  python design_basis.py fixed      固定の結果に根拠を足す（demo-data に書き出す。目で確認してから記録する）

設計図の位置は、AIが返した位置（design_locations）があればそれを使う。なければ指摘の文面にある
符号や数値を設計図のPDFの文字から探す。見つからなければページ全体を出す。
図面枠（設計事務所名、担当者名など）はページごとにAIで見つけて塗りつぶす。結果はページごとに保存し、同じページでは呼ばない。
"""
import hashlib
import json
import re
import sys
import unicodedata
from pathlib import Path

import pymupdf

from common import PRIVATE, REPO, write_json
from claude_api import PRICE_INPUT, PRICE_OUTPUT

CACHE = PRIVATE / "title-blocks"
PROJECTS = PRIVATE / "projects.json"
# 1つの指摘に並べる資料の数
MAX_REFS = 2
# 切り抜きの最小の大きさ（ページに対する割合）と、まわりの余白
MIN_CROP = (0.30, 0.32)
PAD = 0.03
# 符号の組を探す範囲（ページに対する割合）
WINDOW = (0.16, 0.12)
# 1語だけで位置を決めてよいのは、ページの中に少ししかない語
RARE = 6
CROP_DPI = 170
PAGE_DPI = 110
DETECT_LONG_EDGE = 1568
# 見つけた枠の外側に足す余白（読み違いの分）
MASK_MARGIN = 0.008
MASK_COLOR = (210, 210, 210)
DETECT_USD_PER_PAGE = 0.03
# 図面枠を探した費用の合計
SPENT = [0.0]
RENDERED = {}

DETECT_SYSTEM = """図面の画像から、公開してはいけない名前や印が入る欄の位置を探します。

探すもの:
- 図面枠の表題欄の全体（事務所名、会社名、設計者名、担当者名、確認者名、建築士の登録番号、住所、電話番号、工事名、図面名、図面番号、日付などが入る欄）
- 表題欄の外にある会社のロゴ、社印、確認印、出図印、担当者のサインや名前、改訂履歴の欄の名前
- 図面の本文の中にある工事名称、建築場所、工事場所、所在地、住所、地番、会社名、人名（特記仕様書の一般事項など）

欄が分かれているときは、欄ごとに分けて全部挙げます。表題欄の形や位置は図面によって違います（右下、右端の縦長、下端の横長など）。図面の本体（通り芯、部材、寸法、部材リスト、特記）は含めません。
位置はページ全体に対する 0〜1 の [x0, y0, x1, y1] で書きます。少し大きめに囲みます。読み取った名前そのものは書きません。"""

DETECT_SCHEMA = {
    "type": "object",
    "additionalProperties": False,
    "required": ["regions"],
    "properties": {
        "regions": {
            "type": "array",
            "items": {
                "type": "object",
                "additionalProperties": False,
                "required": ["kind", "box"],
                "properties": {"kind": {"type": "string"}, "box": {"type": "array", "items": {"type": "number"}}},
            },
        },
    },
}


def normalize(text):
    return unicodedata.normalize("NFKC", text).upper().replace("×", "X").replace(",", "").replace(" ", "")


TOKEN = re.compile(r"[A-Z]{1,5}-?\d+(?:[-X@.][0-9A-Z.]+)*|[A-Z]+-[A-Z0-9X@.\-]+|T=\d+(?:\.\d+)?|\d{3,}(?:\.\d+)?")


def tokens_of(*texts):
    """文面から、図面の文字と突き合わせる符号や数値を取り出す。通り芯はどのページにもあるので使わない"""
    found = []
    for text in texts:
        for token in TOKEN.findall(normalize(text or "")):
            if not re.fullmatch(r"[XY]\d+|\d{2}-\d{2}|P\d{2}", token) and token not in found:
                found.append(token)
    return found


def page_numbers(text, numbers_by_drawing):
    """「p11（35-28）」「35-20（PDF p9）」「p20・p21」「05-15」「29」から、PDFのページ番号を読む"""
    plain = normalize(text).replace("P", "p")
    pdf_page = re.search(r"PDFp(\d+)", plain)
    if pdf_page:
        return [int(pdf_page.group(1))]
    pages = [int(n) for n in re.findall(r"(?<![A-Za-z0-9])p(\d+)", plain)]
    if pages:
        return pages
    drawings = re.findall(r"\d{2}-\d{2}", plain)
    if drawings:
        return [numbers_by_drawing[d] for d in drawings if d in numbers_by_drawing]
    return [int(plain)] if plain.isdigit() else []


def doc_key(text):
    if "差替" in text:
        return "revised"
    if "構造図" in text:
        return "design"
    return None


DOC_NAMES = {"design": "構造図", "revised": "差替図面"}


def drawing_numbers(document):
    """{図面番号: ページ番号}。表題欄の右下に、図面番号が2桁の数字2つに分かれて書かれている図面で読む"""
    numbers = {}
    for index in range(len(document)):
        hits = sorted((box[0], word) for box, word in display_words(document[index])
                      if box[0] > 0.85 and box[1] > 0.88 and re.fullmatch(r"\d{2}", word))
        if len(hits) >= 2:
            numbers.setdefault(f"{hits[0][1]}-{hits[1][1]}", index + 1)
    return numbers


def learn_numbers(findings, documents):
    """図面番号とページ番号の対応を、指摘の文面（「p11（35-28）」など）から覚える。表題欄の文字がPDFにない図面もあるため"""
    for finding in findings:
        rows = [f"{s['doc']} {s['page']}" for s in finding.get("sources") or []]
        basis = re.search(r"（根拠：(.*?)）\s*$", finding["content"])
        rows += re.split(r"、(?![^（]*）)", basis.group(1)) if basis else []
        for row in rows:
            key = doc_key(row)
            if key not in documents:
                continue
            plain = normalize(row)
            before = re.search(r"P(\d+)(?:・P\d+)?[（(](\d{2}-\d{2})", plain)
            after = re.search(r"(\d{2}-\d{2}).*?P(\d+)", plain)
            if before:
                documents[key]["numbers"].setdefault(before.group(2), int(before.group(1)))
            elif after:
                documents[key]["numbers"].setdefault(after.group(1), int(after.group(2)))


def refs_of(finding, documents):
    """[(文書の種類, ページ番号, 説明)]。施工図自身やチェックリストは除く"""
    rows = [(f"{s['doc']} {s['page']}", s["where"]) for s in finding.get("sources") or []]
    if not rows:
        basis = re.search(r"（根拠：(.*?)）\s*$", finding["content"])
        rows = [(part, "") for part in re.split(r"、(?![^（]*）)", basis.group(1))] if basis else []
    refs = []
    for label, where in rows:
        key = doc_key(label)
        if not key or key not in documents:
            continue
        for number in page_numbers_of(label, documents[key]):
            if 1 <= number <= len(documents[key]["pdf"]) and not any(r[:2] == (key, number) for r in refs):
                refs.append((key, number, where))
    return refs


def page_numbers_of(label, entry):
    # ページの指定がなければ、最後の語を見る（「構造図 29」など）
    if re.search(r"[pP]\d|\d{2}-\d{2}", label):
        return page_numbers(label, entry["numbers"])
    return page_numbers(label.split()[-1], entry["numbers"])


def display_words(page):
    """[(ページに対する 0〜1 の枠, 語)]。ページが回転していても、画面に見える向きの座標にする"""
    width, height = page.rect.width, page.rect.height
    rows = []
    for x0, y0, x1, y1, word, *_ in page.get_text("words"):
        rect = pymupdf.Rect(x0, y0, x1, y1) * page.rotation_matrix
        rect.normalize()
        rows.append(((rect.x0 / width, rect.y0 / height, rect.x1 / width, rect.y1 / height), word))
    return rows


def locate(page, tokens, masks):
    """符号の組が一番まとまっている場所。(枠, 見つけた語) を返す。見つからなければ (None, [])"""
    hits = {}
    for box, word in display_words(page):
        plain = normalize(word)
        if any(inside(box, mask) for mask in masks):
            continue
        for token in tokens:
            if token in plain:
                hits.setdefault(token, []).append(box)
    if not hits:
        return None, []
    best = None
    for token, boxes in hits.items():
        for center in boxes:
            near = {}
            for other, others in hits.items():
                close = [b for b in others if abs(b[0] - center[0]) < WINDOW[0] and abs(b[1] - center[1]) < WINDOW[1]]
                if close:
                    near[other] = min(close, key=lambda b: abs(b[0] - center[0]) + abs(b[1] - center[1]))
            score = sum(1 / len(hits[name]) ** 0.5 for name in near)
            if not best or score > best[0]:
                best = (score, near)
    near = best[1]
    if len(near) < 2 and len(hits[next(iter(near))]) > RARE:
        return None, []
    boxes = list(near.values())
    return [min(b[0] for b in boxes), min(b[1] for b in boxes), max(b[2] for b in boxes), max(b[3] for b in boxes)], list(near)


def inside(box, mask):
    return box[0] >= mask[0] and box[1] >= mask[1] and box[2] <= mask[2] and box[3] <= mask[3]


def crop_around(box):
    """枠のまわりの切り抜き（ページに対する 0〜1）"""
    rect = []
    for axis, least in enumerate(MIN_CROP):
        low, high = box[axis], box[axis + 2]
        size = max(least, high - low + 2 * PAD)
        start = max(0.0, min(1.0 - size, (low + high - size) / 2))
        rect.append((start, min(1.0, start + size)))
    return [rect[0][0], rect[1][0], rect[0][1], rect[1][1]]


def file_hash(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()[:16]


def forbidden_boxes(page):
    """公開してはいけない語がPDFの文字にあれば、AIが見落としても塗る"""
    config = PRIVATE / "dummy_map.json"
    if not config.exists():
        return []
    names = json.loads(config.read_text())["forbidden_words"]
    return [[box[0] - 0.004, box[1] - 0.004, box[2] + 0.004, box[3] + 0.004]
            for box, word in display_words(page) if any(name in word for name in names)]


# この見出しの行の右側には場所が書かれる。AIが見落としても必ず塗る
PLACE_LABEL = re.compile(r"建築場所|工事場所|建設場所|建設地|所在地|住所|地名地番|敷地の地名")
PLACE_WIDTH = 0.28
# 電話番号は、どの様式でも必ず塗る
PHONE = re.compile(r"(TEL|FAX|ＴＥＬ|ＦＡＸ)|\d{2,4}[-(（]\d{2,4}[-)）]\d{4}")


def place_rows(page):
    rows = []
    for box, word in display_words(page):
        if PLACE_LABEL.search(word.replace(" ", "")):
            rows.append([box[0] - 0.004, box[1] - 0.006, min(1, box[2] + PLACE_WIDTH), box[3] + 0.006])
        elif PHONE.search(word):
            rows.append([box[0] - 0.004, box[1] - 0.004, box[2] + 0.004, box[3] + 0.004])
    return rows


def title_blocks(client, path, number, page):
    """図面枠などの塗りつぶす範囲。AIで見つけられないときは None（公開用には出さない）"""
    cache = CACHE / file_hash(path) / f"p{number}.json"
    if cache.exists():
        regions = json.loads(cache.read_text())["regions"]
    elif client is None:
        return None
    else:
        from claude_api import call_claude
        from steel_experiment import image_block

        zoom = DETECT_LONG_EDGE / max(page.rect.width, page.rect.height)
        png = page.get_pixmap(matrix=pymupdf.Matrix(zoom, zoom)).tobytes("png")
        content = [image_block(png), {"type": "text", "text": "このページの、公開してはいけない名前や印の入る欄を挙げてください。"}]
        try:
            reply = call_claude(client, DETECT_SYSTEM, content, DETECT_SCHEMA, cache.parent, f"p{number}-raw", effort="low")
        except Exception as error:
            print(f"図面枠を見つけられませんでした（p{number}）: {error}")
            return None
        regions = reply["regions"]
        write_json(cache, {"regions": regions})
        usage = json.loads((cache.parent / f"p{number}-raw.json").read_text())["usage"]
        SPENT[0] += (usage["input_tokens"] * PRICE_INPUT + usage["output_tokens"] * PRICE_OUTPUT) / 1_000_000
    boxes = []
    for region in regions:
        box = region["box"]
        # ページの外を指す読み違いは使わない
        if len(box) == 4 and box[0] < box[2] and box[1] < box[3] and box[0] < 1 and box[1] < 1:
            boxes.append([max(0, box[0] - MASK_MARGIN), max(0, box[1] - MASK_MARGIN),
                          min(1, box[2] + MASK_MARGIN), min(1, box[3] + MASK_MARGIN)])
    return boxes + forbidden_boxes(page) + place_rows(page)


def render_crop(path, number, crop, dpi, masks, out):
    """切り抜きの画像を書き出す。ページ全体を画像にしてから塗るので、画面に見える向きのまま塗れて、元に戻せない"""
    # 同じページを何度も描かない
    cache_key = (str(path), number, dpi, bool(masks))
    pixmap = RENDERED.get(cache_key)
    if pixmap is None:
        page = pymupdf.open(path)[number - 1]
        pixmap = page.get_pixmap(dpi=dpi, colorspace=pymupdf.csRGB, alpha=False)
        for mask in masks:
            pixmap.set_rect(pymupdf.IRect(int(mask[0] * pixmap.width), int(mask[1] * pixmap.height),
                                          int(mask[2] * pixmap.width) + 1, int(mask[3] * pixmap.height) + 1), MASK_COLOR)
        RENDERED[cache_key] = pixmap
    area = pymupdf.IRect(int(crop[0] * pixmap.width), int(crop[1] * pixmap.height),
                         int(crop[2] * pixmap.width), int(crop[3] * pixmap.height))
    cut = pymupdf.Pixmap(pymupdf.csRGB, area)
    cut.copy(pixmap, area)
    out.parent.mkdir(parents=True, exist_ok=True)
    cut.save(out)
    return cut.width, cut.height


def open_documents(project):
    documents = {}
    for key in ("design", "revised"):
        if project.get(key):
            pdf = pymupdf.open(project[key])
            documents[key] = {"path": project[key], "pdf": pdf, "numbers": drawing_numbers(pdf)}
    return documents


def design_refs(finding, documents, client, folder, public_only=False):
    """指摘の根拠の設計図を切り抜いて、[{doc, page, where, image, width, height, box, located, masked}] を返す"""
    # 題名や根拠の説明にある符号を先に探す。本文の符号は、それで見つからないときだけ使う
    main_tokens = tokens_of(*[s.get("where") for s in finding.get("sources") or []], finding.get("design_value"),
                            " ".join(finding.get("members", {}).get("marks") or []), finding.get("title"))
    all_tokens = tokens_of(finding.get("content"))
    candidates = []
    locations = finding.get("design_locations") or []
    for location in locations:
        key = doc_key(location["doc"])
        if key in documents and 1 <= location["page"] <= len(documents[key]["pdf"]):
            candidates.append((key, location["page"], "", location["box"], "ai"))
    for key, number, where in refs_of(finding, documents):
        if not any(c[:2] == (key, number) for c in candidates):
            candidates.append((key, number, where, None, None))
    scored = []
    for key, number, where, box, located in candidates:
        entry = documents[key]
        page = entry["pdf"][number - 1]
        masks = title_blocks(client, entry["path"], number, page)
        # 題名や根拠の符号が文字で見つかれば、そちらを使う（AIが返す位置より確かなので）
        found, _ = locate(page, main_tokens, masks or [])
        if found:
            box, located = found, "text"
        elif not box:
            box, _ = locate(page, all_tokens, masks or [])
            located = "text" if box else "page"
        scored.append((key, number, where, box, located, masks))
    # 位置の分かる資料を先に出す
    scored.sort(key=lambda row: row[4] == "page")
    refs = []
    for index, (key, number, where, box, located, masks) in enumerate(scored[:MAX_REFS], 1):
        entry = documents[key]
        crop = crop_around(box) if box else [0, 0, 1, 1]
        dpi = CROP_DPI if box else PAGE_DPI
        name = f"design/{finding['id']}-{index}.png"
        width, height = 0, 0
        if masks is not None:
            target = folder / name if public_only else folder / "masked" / name
            width, height = render_crop(entry["path"], number, crop, dpi, masks, target)
        if not public_only:
            width, height = render_crop(entry["path"], number, crop, dpi, [], folder / name)
        refs.append({
            "doc": DOC_NAMES[key],
            "page": number,
            "where": where,
            "image": name,
            "width": width,
            "height": height,
            "box": relative_box(box, crop) if box else None,
            "located": located,
            "masked": masks is not None,
        })
    return refs, len(scored)


def relative_box(box, crop):
    w, h = crop[2] - crop[0], crop[3] - crop[1]
    return [round((box[0] - crop[0]) / w, 4), round((box[1] - crop[1]) / h, 4),
            round((box[2] - crop[0]) / w, 4), round((box[3] - crop[1]) / h, 4)]


def minutes_context(finding, minutes):
    """議事録の該当の行を、見出しと前後の行と一緒に返す"""
    refs = finding.get("minutes_refs") or []
    blocks = []
    for ref in refs:
        ref_id = ref["id"].split(":")[-1]
        for document in minutes:
            # 議事録が複数あるときは、番号の前に議事録の名前が付いている
            if ":" in ref["id"] and ref["id"].rsplit(":", 1)[0] != document["name"]:
                continue
            rows = readable_lines(document["text"])
            hit = next((i for i, row in enumerate(rows) if row["id"] == ref_id), None)
            if hit is None:
                continue
            heading = next((rows[i]["text"] for i in range(hit, -1, -1) if rows[i]["heading"]), "")
            around = [row for row in rows[max(0, hit - 2):hit + 3] if not row["heading"]]
            for block in blocks:
                if block["heading"] == heading and block["doc"] == document["name"]:
                    known = {row["id"] for row in block["lines"]}
                    block["lines"] += [{"id": r["id"], "text": r["text"], "hit": False} for r in around if r["id"] not in known]
                    for row in block["lines"]:
                        row["hit"] = row["hit"] or row["id"] == ref_id
                    break
            else:
                blocks.append({"doc": document["name"], "heading": heading,
                               "lines": [{"id": r["id"], "text": r["text"], "hit": r["id"] == ref_id} for r in around]})
    for block in blocks:
        block["lines"].sort(key=lambda row: [int(n) for n in re.findall(r"\d+", row["id"])])
    return blocks


def readable_lines(text):
    """議事録を、番号の付いた行と見出しの並びにする。表の見出しの行と区切りは除く"""
    rows = []
    columns = []
    for raw in text.splitlines():
        line = raw.strip()
        cells = [cell.strip() for cell in line.strip("|").split("|")]
        # 表の見出しの行。値だけでは何の数字か分からないので、列の名前を添える
        if line.startswith("|") and cells[0] == "番号":
            columns = cells[1:]
        heading = re.match(r"#+\s*(.+)", line)
        table = re.match(r"\|\s*\**(\d+(?:-\d+)+)\**\s*\|(.*)\|$", line)
        bullet = re.match(r"-\s*\*\*([\w-]+)\*\*\s*(.+)", line)
        if heading:
            rows.append({"id": "", "text": heading.group(1), "heading": True})
        elif table:
            rows.append({"id": table.group(1), "text": "／".join(f"{name}：{cell}" if name else cell for name, cell in zip(columns + [""] * 9, cells[1:])), "heading": False})
        elif bullet:
            rows.append({"id": bullet.group(1), "text": bullet.group(2), "heading": False})
    return rows


def checklist_card(finding, library):
    """青の指摘のチェック項目。社内ノウハウなので、結果と同じくリポジトリの外にだけ置く"""
    wanted = finding.get("checklist_id")
    for name, items in library.items():
        for item in items:
            if item["id"] == wanted:
                return {"checklist": name, "section": item["section"], "item": item["item"],
                        "lines": [line for line in item["content"].split("／") if line], "note": item["note"], "id": wanted,
                        "source": item.get("source")}
    return None


def attach(findings, project, folder, client, minutes, library, public_only=False, numbers_from=()):
    """指摘に根拠の資料を足す。何かが作れなくても判定の結果は返す（その指摘は文面だけで見せる）"""
    use_images = project.get("design_images", True)
    documents = open_documents(project) if use_images else {}
    learn_numbers([*numbers_from, *findings], documents)
    for finding in findings:
        kind = finding.get("source_type") or "design"
        if kind == "design" and documents:
            refs, total = design_refs(finding, documents, client, folder, public_only)
            finding["design_refs"] = refs
            finding["design_refs_more"] = max(0, total - len(refs))
        elif kind == "minutes":
            finding["minutes_context"] = minutes_context(finding, minutes)
        elif kind == "knowledge":
            finding["checklist_card"] = checklist_card(finding, library)
    return findings


def demo_jobs():
    """物件Bの判定結果のフォルダ"""
    for path in sorted((PRIVATE / "uploads").glob("*/result.json")):
        job = json.loads((path.parent / "job.json").read_text())
        if (job.get("project") or job.get("slug")) == "sample-b":
            yield path.parent


def pages_needed(findings_lists, documents):
    pages = set()
    for findings in findings_lists:
        for finding in findings:
            if (finding.get("source_type") or "design") == "design":
                for key, number, _ in refs_of(finding, documents):
                    pages.add((key, number))
    return pages


def main():
    from claude_api import load_env

    command = sys.argv[1]
    projects = json.loads(PROJECTS.read_text())
    project = projects["sample-b"]
    documents = open_documents(project)
    fixed_path = REPO / "demo-data" / "sample-b" / "check-result.json"
    fixed = json.loads(fixed_path.read_text())
    jobs = list(demo_jobs())
    results = {folder: json.loads((folder / "result.json").read_text()) for folder in jobs}
    everything = [item for findings in [fixed["findings"], *[r["findings"] for r in results.values()]] for item in findings]
    learn_numbers(everything, documents)
    pages = pages_needed([everything], documents)
    cached = [p for p in pages if (CACHE / file_hash(documents[p[0]]["path"]) / f"p{p[1]}.json").exists()]
    print(f"図面枠を探すページ {len(pages)}（保存済み {len(cached)}）。見込み 約 {(len(pages) - len(cached)) * DETECT_USD_PER_PAGE:.2f} ドル")
    if command == "estimate":
        return
    import anthropic

    load_env()
    client = anthropic.Anthropic()
    if command == "detect":
        for key, number in sorted(pages):
            entry = documents[key]
            title_blocks(client, entry["path"], number, entry["pdf"][number - 1])
    elif command == "fixed":
        attach(fixed["findings"], project, fixed_path.parent, client, [], {}, public_only=True, numbers_from=everything)
        write_json(fixed_path, fixed)
    elif command == "jobs":
        import knowledge_check
        import minutes_check

        library = knowledge_check.load_library()
        minutes = minutes_check.load_minutes(project, "sample-b")
        for folder, result in results.items():
            attach(result["findings"], project, folder, client, minutes, library, numbers_from=everything)
            write_json(folder / "result.json", result)
            print(folder.name[:8], "完了")
    if SPENT[0]:
        from steel_experiment import ROOT, record_cost

        record_cost(ROOT / "ledger.json", f"title-blocks-{command}", round(SPENT[0], 3))
    print(f"図面枠の費用 {SPENT[0]:.3f} ドル")


if __name__ == "__main__":
    main()
