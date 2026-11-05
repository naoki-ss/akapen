"""チェック済みのジョブの朱書きと画像を、AIの応答を使い回して作り直す。AIは呼ばない（費用が掛からない）。

  python rebuild_job.py <ジョブのフォルダ>

朱書きの描き方や題名、塗りつぶしを変えたあとに、前の結果へ反映するときに使う。時間と費用は元の値を残す。
結果を書く前に処理が止まったジョブ（result.json がない）は、全部の照合の応答がそろったページだけで結果を作る。
"""
import json
import sys
from pathlib import Path

import pymupdf

import knowledge_check
import minutes_check
from check_upload import Job, UPLOADS, checkers_for, design_findings, finish_job, load_project, plan_for, raw_cost
from common import write_json
from markup_pdf import valid_regions
from review_steel_sheet import red_pixels


def read_reply(raw_dir, name):
    path = raw_dir / f"{name}-result.json"
    return json.loads(path.read_text()) if path.exists() else None


def page_findings(raw_dir, project, classified, number, library, minutes):
    """(指摘, 照合ごとの記録)"""
    name = knowledge_check.used_name(raw_dir, library, classified.get("title"), project.get("kind"))
    checklist = library.get(name) if name else None
    level = plan_for(project, classified)[1]
    found, checks = [], {}
    reply = read_reply(raw_dir, "review")
    if reply:
        found += design_findings(reply, number, level)
        checks["design"] = {"unreadable": reply.get("unreadable", [])}
    reply = read_reply(raw_dir, "minutes")
    if reply and minutes:
        items = minutes_check.all_items(minutes)
        part, dropped = minutes_check.to_findings(reply, items, number, level)
        found += part
        checks["minutes"] = {"unreadable": reply.get("unreadable", []), "dropped": dropped,
                             "item_results": minutes_check.page_results(reply, items, part)}
    reply = read_reply(raw_dir, "knowledge")
    if reply and checklist:
        targets = knowledge_check.targets_of(checklist)
        part, dropped = knowledge_check.to_findings(reply, targets, number, level)
        found += part
        checks["knowledge"] = {"unreadable": reply.get("unreadable", []), "dropped": dropped,
                               "item_results": knowledge_check.page_results(reply, targets, part)}
    for item in found:
        item["regions"] = valid_regions(item.get("regions"))
    return found, checks


def rebuild_saved(folder, slug, project, checklist, minutes):
    before = json.loads((folder / "result.json").read_text())
    pages = []
    for page in before["pages"]:
        raw_dir = folder / "raw" / f"p{page['number']}"
        classified = json.loads((raw_dir / "classified.json").read_text())
        found, _ = page_findings(raw_dir, project, classified, page["number"], checklist, minutes)
        pages.append({**page, "classified": classified, "findings": found, "raw_dir": raw_dir})
    # 元の結果で行っていない照合は、作り直しでも行っていないものとして扱う
    checks = {name for page in pages for name in page["checks"]}
    job = Job(folder)
    finish_job(job, folder, slug, pages, checklist, "knowledge" in checks, None, folder / "input.pdf",
               minutes if "minutes" in checks else (), project.get("masks"), before.get("stopped_pages", []))
    after = json.loads((folder / "result.json").read_text())
    write_json(folder / "result.json", {**after, "usd": before["usd"], "seconds": before["seconds"]})
    job.update(usd=before["usd"])
    print(f"{len(after['findings'])} 件を作り直しました（前は {len(before['findings'])} 件）")


def recover_stopped(folder, slug, project, checklist, minutes, meta):
    seconds = json.loads((folder / "status.json").read_text()).get("seconds", 0)
    doc = pymupdf.open(folder / "input.pdf")
    numbers = meta.get("pages") or list(range(1, doc.page_count + 1))
    pages, stopped, stopped_usd = [], [], 0.0
    for number in numbers:
        raw_dir = folder / "raw" / f"p{number}"
        classified_path = raw_dir / "classified.json"
        checks = {}
        if classified_path.exists():
            classified = json.loads(classified_path.read_text())
            found, checks = page_findings(raw_dir, project, classified, number, checklist, minutes)
        title = json.loads(classified_path.read_text()).get("title") if classified_path.exists() else None
        name = knowledge_check.used_name(raw_dir, checklist, title, project.get("kind"))
        needed = set(checkers_for(project, checklist.get(name) if name else None, minutes))
        if needed <= set(checks):
            pages.append({"number": number, "ok": True, "failed_checks": [], "findings": found, "classified": classified, "raw_dir": raw_dir,
                          "usd": raw_cost(raw_dir), "seconds": 0, "checks": checks, "red_pixels": red_pixels(doc[number - 1]), "error": None})
        else:
            stopped.append(number)
            stopped_usd += raw_cost(raw_dir) if raw_dir.exists() else 0.0
    job = Job(folder)
    finish_job(job, folder, slug, pages, checklist, bool(checklist), None, folder / "input.pdf", minutes,
               project.get("masks"), stopped, stopped_usd)
    after = json.loads((folder / "result.json").read_text())
    write_json(folder / "result.json", {**after, "seconds": seconds})
    print(f"{len(pages)} ページ、{len(after['findings'])} 件の結果を作りました。費用 {after['usd']} ドル")


def main():
    folder = Path(sys.argv[1]).resolve()
    if UPLOADS.resolve() not in folder.parents:
        sys.exit("uploads の外のフォルダは扱いません")
    meta = json.loads((folder / "job.json").read_text())
    slug = meta["project"]
    project = load_project(slug)
    checklist = knowledge_check.load_library()
    minutes = minutes_check.load_minutes(project, slug)
    if (folder / "result.json").exists():
        rebuild_saved(folder, slug, project, checklist, minutes)
    else:
        recover_stopped(folder, slug, project, checklist, minutes, meta)


if __name__ == "__main__":
    main()
