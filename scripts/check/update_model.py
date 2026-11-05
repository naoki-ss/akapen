"""設計図書の新しい版から、建物データと3Dを作り直す。読み取り済みのページは読み直さないので、変わったページの分だけ費用が掛かる。

  python update_model.py <物件>

結果は ~/sekozu-data/ledger/<物件>/model.json。進み具合は model-status.json、止めるときは model-stop.flag。
外観（意匠図から読んだ外壁や素材）は設計図書の構造図からは読まないので、今のものを引き継ぐ。
"""
import argparse
import json
import os
import sys
import time
import traceback

from common import PRIVATE, REPO, write_json
from drawing_ledger import ROOT
from register_project import Register

PROJECTS = PRIVATE / "projects.json"


def member_key(member):
    return f"{member['type']}|{member['floor']}|{member.get('grid', '')}"


def changes_of(before, after):
    old = {member_key(m): m.get("mark") for m in before.get("members", [])}
    new = {member_key(m): m.get("mark") for m in after.get("members", [])}
    return {
        "added": sorted(f"{key}（{new[key]}）" for key in set(new) - set(old)),
        "removed": sorted(f"{key}（{old[key]}）" for key in set(old) - set(new)),
        "changed": sorted(f"{key}（{old[key]}→{new[key]}）" for key in set(old) & set(new) if old[key] != new[key]),
    }


def current_model(slug):
    for path in (ROOT / slug / "model.json", REPO / "demo-data" / slug / "model.json", PRIVATE / "projects" / slug / "model.json"):
        if path.exists():
            return json.loads(path.read_text())
    return {"name": slug, "members": []}


def main():
    slug = sys.argv[1]
    folder = ROOT / slug
    status_path = folder / "model-status.json"
    started = time.time()

    def update(**values):
        write_json(status_path, {"pid": os.getpid(), "seconds": round(time.time() - started), **values})

    stop = lambda: (folder / "model-stop.flag").exists()
    (folder / "model-stop.flag").unlink(missing_ok=True)
    try:
        project = json.loads(PROJECTS.read_text())[slug]
        before = current_model(slug)
        update(state="running", message="図面の種類を確かめています", done=0, total=0)
        reg = Register(argparse.Namespace(slug=f"../ledger/{slug}/build", name=before["name"], design=project["design"], revised=project.get("revised")))
        reg.stage_a_quiet()
        targets = [entry for entry in reg.load_pages() if entry["read"]]
        new = sum(not reg.cached(entry) for entry in targets)
        done = [0]

        def on_page(entry, total):
            done[0] += 1
            update(state="running", message=f"{done[0]} / {len(targets)} ページ（新しく読むのは {new} ページ）", done=done[0], total=len(targets))

        update(state="running", message=f"読むページ {len(targets)}（新しく読むのは {new} ページ）", done=0, total=len(targets))
        usd, failed, stopped = reg.read_many(targets, on_page, stop)
        if stopped:
            update(state="stopped", message="止めました。読み終えたページは次に使い回します")
            os._exit(0)
        update(state="running", message="検算して、3Dを組み立てています", done=len(targets), total=len(targets))
        _, model = reg.stage_e()
        for key in ("architecture", "site", "structure", "name"):
            if before.get(key) is not None:
                model[key] = before[key]
        write_json(folder / "model.json", model)
        write_json(folder / "model-changes.json", changes_of(before, model))
        update(state="done", message="建物データと3Dを更新しました", failed=[entry["title"] for entry in failed], usd=round(usd, 3))
    except (Exception, SystemExit):
        (folder / "model-error.txt").write_text(traceback.format_exc())
        update(state="error", message="建物データを更新できませんでした。今の3Dはそのままです")
        os._exit(1)
    os._exit(0)


if __name__ == "__main__":
    main()
