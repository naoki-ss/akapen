"""外した指摘を除いて朱書きPDFを作り直し、そのパスを出す。AIは呼ばない。

  python export_marked.py <ジョブのフォルダ> [--public]

decisions.json がない、または外した指摘がないときは、できているPDFのパスをそのまま出す。
"""
import json
import sys
import tempfile
from pathlib import Path

from check_upload import load_project, merge_same
from markup_pdf import make_marked_pdf, mask_pdf
from rebuild_job import page_findings

import knowledge_check
import minutes_check


def main():
    folder = Path(sys.argv[1]).resolve()
    public = "--public" in sys.argv
    decisions = folder / "decisions.json"
    excluded = set(json.loads(decisions.read_text())["excluded"]) if decisions.exists() else set()
    built = folder / "masked" / "marked.pdf" if public else folder / "marked.pdf"
    if not excluded:
        print(built)
        return

    slug = json.loads((folder / "job.json").read_text())["project"]
    project = load_project(slug)
    checklist = knowledge_check.load_checklist(project)
    minutes = minutes_check.load_minutes(project)
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
    merge_same(None, findings, folder / "raw")
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


if __name__ == "__main__":
    main()
