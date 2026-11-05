"""外した指摘を除いて朱書きPDFを作り直し、そのパスを出す。AIは呼ばない。

  python export_marked.py <ジョブのフォルダ> [--public]

decisions.json がない、または外した指摘がないときは、できているPDFのパスをそのまま出す。
markup.json（人が書き足した朱書きと、AI の指摘の文面の直し）があるときは、画面と同じ result.json から作り直す。
"""
import json
import sys
import tempfile
from pathlib import Path

from check_upload import load_project, narrow_findings
from markup_pdf import make_marked_pdf, mask_pdf, valid_regions
from rebuild_job import page_findings

import knowledge_check
import minutes_check


def main():
    folder = Path(sys.argv[1]).resolve()
    public = "--public" in sys.argv
    decisions = folder / "decisions.json"
    excluded = set(json.loads(decisions.read_text())["excluded"]) if decisions.exists() else set()
    built = folder / "masked" / "marked.pdf" if public else folder / "marked.pdf"
    markup_file = folder / "markup.json"
    markup = json.loads(markup_file.read_text()) if markup_file.exists() else {}
    if markup.get("items") or markup.get("edits"):
        print(export_with_markup(folder, public, excluded, markup))
        return
    if not excluded:
        print(built)
        return

    slug = json.loads((folder / "job.json").read_text())["project"]
    project = load_project(slug)
    checklist = knowledge_check.load_library()
    minutes = minutes_check.numbering_minutes(folder, project, slug)
    before = json.loads((folder / "result.json").read_text())
    findings = []
    numbers = []
    for page in before["pages"]:
        number = page["number"]
        raw_dir = folder / "raw" / f"p{number}"
        classified = json.loads((raw_dir / "classified.json").read_text())
        found, _ = page_findings(raw_dir, project, classified, number, checklist, minutes)
        findings += found
        numbers.append(number)
    # 番号とまとめ方は画面と同じにする（finish_job と同じ順番）
    for number, item in enumerate(findings, 1):
        item["number"] = number
    pages = [{"number": number, "classified": json.loads((folder / "raw" / f"p{number}" / "classified.json").read_text())} for number in numbers]
    findings = narrow_findings(None, folder, findings, pages, checklist, project.get("kind"))["findings"]
    kept = [item for item in findings if item["number"] not in excluded]

    tables = []
    if before.get("minutes"):
        tables.append(("議事録の確認結果", before["minutes"]))
    if before.get("checklist"):
        tables.append(("チェックリストの確認結果", before["checklist"]))
    marks = {"title": "施工図の朱書き", "notes": before.get("notes", []), "tables": tables, "pages": numbers}

    out = folder / "export" / ("masked" if public else "internal")
    out.mkdir(parents=True, exist_ok=True)
    if public:
        with tempfile.TemporaryDirectory() as temp:
            masked_input = Path(temp) / "input.pdf"
            mask_pdf(folder / "input.pdf", masked_input, project["masks"], numbers)
            make_marked_pdf(masked_input, kept, out / "marked.pdf", **marks)
    else:
        make_marked_pdf(folder / "input.pdf", kept, out / "marked.pdf", **marks)
    print(out / "marked.pdf")


def manual_items(markup):
    """書き足した朱書きを、朱書きPDFの指摘の形にする"""
    items = []
    for mark in markup.get("items", []):
        x0, y0, x1, y1 = mark["box"]
        title, comment = mark.get("title", ""), mark.get("comment", "")
        items.append({
            "number": mark["number"],
            "page": mark["page"],
            "source_type": f"manual_{mark['color']}",
            "shape": mark["shape"],
            "box": mark["box"],
            "regions": [[min(x0, x1), min(y0, y1), max(x0, x1), max(y0, y1)]],
            "title": title or comment[:20],
            "comment": f"{title}：{comment}" if title and comment else (title or comment),
            "content": comment,
            "needs_confirmation": False,
            "evidence": [],
        })
    return items


def export_with_markup(folder, public, excluded, markup):
    """画面に出している結果（result.json）に、外した指摘・直した文面・書き足した朱書きを当てて作る"""
    slug = json.loads((folder / "job.json").read_text())["project"]
    result = json.loads((folder / "result.json").read_text())
    edits = markup.get("edits", {})
    findings = []
    for item in result["findings"]:
        if item["number"] in excluded:
            continue
        item = {**item, "page": item["drawing"]["page"],
                "regions": valid_regions(item.get("regions") or [item["drawing"]["bbox"]])}
        edit = edits.get(str(item["number"]))
        if edit:
            item["title"] = edit.get("title") or item["title"]
            item["comment"] = edit.get("comment") or item["title"]
        findings.append(item)
    numbers = [page["number"] for page in result["pages"]]
    findings += [item for item in manual_items(markup) if item["page"] in numbers]
    findings.sort(key=lambda item: item["number"])

    tables = []
    if result.get("minutes"):
        tables.append(("議事録の確認結果", result["minutes"]))
    if result.get("checklist"):
        tables.append(("チェックリストの確認結果", result["checklist"]))
    marks = {"title": "施工図の朱書き", "notes": result.get("notes", []), "tables": tables, "pages": numbers}
    out = folder / "export" / ("masked" if public else "internal")
    out.mkdir(parents=True, exist_ok=True)
    if public:
        project = load_project(slug)
        with tempfile.TemporaryDirectory() as temp:
            masked_input = Path(temp) / "input.pdf"
            mask_pdf(folder / "input.pdf", masked_input, project["masks"], numbers)
            make_marked_pdf(masked_input, findings, out / "marked.pdf", **marks)
    else:
        make_marked_pdf(folder / "input.pdf", findings, out / "marked.pdf", **marks)
    return out / "marked.pdf"


if __name__ == "__main__":
    main()
