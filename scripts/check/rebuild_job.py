"""チェック済みのジョブの朱書きと画像を、AIの応答を使い回して作り直す。AIは呼ばない（費用が掛からない）。

  python rebuild_job.py <ジョブのフォルダ>

朱書きの描き方や題名、塗りつぶしを変えたあとに、前の結果へ反映するときに使う。
時間と費用は元の結果の値を残す。
"""
import json
import sys
from pathlib import Path

import knowledge_check
import minutes_check
from check_upload import Job, UPLOADS, design_findings, finish_job, load_project, plan_for
from common import write_json
from markup_pdf import valid_regions


def page_findings(raw_dir, project, classified, number, checklist, minutes):
    level = plan_for(project, classified)[1]
    found = []
    if (raw_dir / "review-result.json").exists():
        found += design_findings(json.loads((raw_dir / "review-result.json").read_text()), number, level)
    if (raw_dir / "minutes-result.json").exists():
        reply = json.loads((raw_dir / "minutes-result.json").read_text())
        found += minutes_check.to_findings(reply, minutes_check.all_items(minutes), number, level)[0]
    if (raw_dir / "knowledge-result.json").exists():
        reply = json.loads((raw_dir / "knowledge-result.json").read_text())
        found += knowledge_check.to_findings(reply, knowledge_check.targets_of(checklist), number, level)[0]
    for item in found:
        item["regions"] = valid_regions(item.get("regions"))
    return found


def main():
    folder = Path(sys.argv[1]).resolve()
    if UPLOADS.resolve() not in folder.parents:
        sys.exit("uploads の外のフォルダは扱いません")
    before = json.loads((folder / "result.json").read_text())
    slug = json.loads((folder / "job.json").read_text())["project"]
    project = load_project(slug)
    checklist = knowledge_check.load_checklist(project)
    minutes = minutes_check.load_minutes(project)
    pages = []
    for page in before["pages"]:
        raw_dir = folder / "raw" / f"p{page['number']}"
        classified = json.loads((raw_dir / "classified.json").read_text())
        pages.append({**page, "classified": classified,
                      "findings": page_findings(raw_dir, project, classified, page["number"], checklist, minutes)})
    # 元の結果で行っていない照合は、作り直しでも行っていないものとして扱う
    checks = {name for page in pages for name in page["checks"]}
    use_knowledge = "knowledge" in checks
    minutes = minutes if "minutes" in checks else ()
    job = Job(folder)
    finish_job(job, folder, slug, pages, checklist, use_knowledge, None, folder / "input.pdf", len(pages), minutes, project.get("masks"))
    after = json.loads((folder / "result.json").read_text())
    write_json(folder / "result.json", {**after, "usd": before["usd"], "seconds": before["seconds"]})
    job.update(usd=before["usd"])
    print(f"{len(after['findings'])} 件を作り直しました（前は {len(before['findings'])} 件）")


if __name__ == "__main__":
    main()
