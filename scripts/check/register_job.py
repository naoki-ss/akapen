"""画面から物件を登録する処理。結果はリポジトリの外（~/sekozu-data/projects/<記号>/）に置く。

  python register_job.py prepare <フォルダ>   ページの種類を文字で判定する（AIなし）。標準出力に判定と見込みを出す
  python register_job.py run <フォルダ>       必要なページを読み、検算し、3Dを作り、物件を登録する

フォルダの meta.json に name、structure（S造 または RC造）、masks、inputs（design、revised、minutes、architectural）を置く。
進み具合は status.json。stop.flag が置かれたら止める（読み終えたページは次に使い回す）。
3Dが作れなくても、設計図書が読めれば「3Dなし」で登録を終え、施工図チェックは使える。
"""
import exterior_read
import argparse
import fcntl
import hashlib
import json
import os
import re
import sys
import time
import traceback
from pathlib import Path

import anthropic
import pymupdf

import building_pages
import minutes_check
from claude_api import call_claude, load_env
from check_upload import message_cost
from common import PRIVATE, write_json
from register_project import Register

PROJECTS = PRIVATE / "projects.json"
ROOT = PRIVATE / "projects"
# 実績からの見込み
USD_PER_PAGE = {"伏図": 0.21, "軸組図": 0.22, "リスト": 0.29}
USD_UNKNOWN_PAGE = 0.021
SECONDS_PER_PAGE = 13
COMMON_FALLBACK_PAGES = 10
PRESET_SECONDS_PER_PAGE = 0.5

MINUTES_SYSTEM = """打合せの議事録の文章を、番号付きの項目に分けます。
- 議事録に書かれている決定事項、変更、宿題を、1項目1行で items に書きます。言い換えず、元の文章のとおりに書きます。
- 議題の番号があれば id は「議題の番号-連番」（例：2-1）、なければ「1-1」から順に付けます。"""

MINUTES_SCHEMA = {
    "type": "object",
    "additionalProperties": False,
    "required": ["items"],
    "properties": {"items": {"type": "array", "items": {
        "type": "object", "additionalProperties": False, "required": ["id", "text"],
        "properties": {"id": {"type": "string"}, "text": {"type": "string"}}}}},
}


class Status:
    def __init__(self, folder):
        self.path = folder / "status.json"
        self.started = time.time()
        self.values = {"pid": os.getpid()}

    def update(self, **values):
        self.values.update(values, seconds=round(time.time() - self.started, 1))
        temp = self.path.with_suffix(".tmp")
        temp.write_text(json.dumps(self.values, ensure_ascii=False))
        temp.replace(self.path)


# 外観の読み取りの費用の上限（ドル）
EXTERIOR_MAX_USD = 2.0


def register_for(folder):
    meta = json.loads((folder / "meta.json").read_text())
    args = argparse.Namespace(slug=folder.name, name=meta["name"], design=meta["inputs"]["design"], revised=meta["inputs"].get("revised"))
    return Register(args), meta


def estimate(reg, pages):
    targets = [entry for entry in pages if entry["read"]]
    new = [entry for entry in targets if not reg.cached(entry)]
    unknown = [entry for entry in pages if not entry["title"]]
    usd = sum(USD_PER_PAGE[entry["kind"]] for entry in new) + len(unknown) * USD_UNKNOWN_PAGE
    return {"read": len(targets), "new": len(new), "reused": len(targets) - len(new), "unknown": len(unknown),
            "usd": round(usd, 1), "seconds": (len(new) + len(unknown)) * SECONDS_PER_PAGE}


def prepare(folder):
    reg, _ = register_for(folder)
    reg.stage_a_quiet()
    pages = reg.load_pages()
    print(json.dumps({"pages": [{key: entry[key] for key in ("source", "page", "kind", "title", "read", "replaced_by")} for entry in pages],
                      "estimate": estimate(reg, pages)}, ensure_ascii=False))


def minutes_files(folder, meta, status):
    """議事録を番号付きの形にする。(ファイルのリスト, 費用)。番号があればそのまま、なければAIで項目に分ける"""
    out_dir = folder / "minutes"
    out_dir.mkdir(exist_ok=True)
    paths, usd = [], 0.0
    for index, source in enumerate(meta["inputs"].get("minutes", [])):
        source = Path(source)
        text = "".join(page.get_text() for page in pymupdf.open(source)) if source.suffix.lower() == ".pdf" else source.read_text()
        out = out_dir / f"{source.stem}.md"
        if minutes_check.parse_items(text):
            out.write_text(text)
        elif text.strip():
            status.update(stage="議事録", message="議事録を項目に分けています")
            load_env()
            raw_dir = folder / "raw" / f"minutes-{index}"
            raw_dir.mkdir(parents=True, exist_ok=True)
            reply = call_claude(anthropic.Anthropic(), MINUTES_SYSTEM, [{"type": "text", "text": text}], MINUTES_SCHEMA, raw_dir, "minutes")
            usd += message_cost(raw_dir / "minutes.json")[2]
            out.write_text("\n".join(f"| {item['id']} | {item['text']} |" for item in reply["items"]) + "\n")
        else:
            continue
        paths.append(str(out))
    return paths, usd


LEVEL_NAMES = {"RF": ["RSL", "RFL", "RF"], "PHRF": ["PHSL", "PHRSL", "PHRFL", "PHRF"]}


def level_keys(floor):
    if floor in LEVEL_NAMES:
        return LEVEL_NAMES[floor]
    match = re.fullmatch(r"(\d+)F", floor)
    return [f"{match.group(1)}SL", f"{match.group(1)}FL", floor] if match else [floor]


def steel_checklist():
    """社内のチェックリストはリポジトリに入れないので、場所は登録済みの鉄骨の物件の設定から借りる"""
    projects = json.loads(PROJECTS.read_text())
    return next((entry["checklist"] for entry in projects.values() if entry.get("kind") == "steel" and entry.get("checklist")), None)


def project_entry(folder, meta, reg, pages, model, minutes):
    """施工図チェックが使う物件の登録。設計図書のどのページを基準にするかを、ページの判定から決める"""
    by_key = {(entry["source"], entry["page"]): entry for entry in pages}
    plan_by_level, floor_by_level = {}, {}
    for path in sorted((folder / "reads").glob("*.json")) if (folder / "reads").exists() else []:
        read = json.loads(path.read_text())
        if read["kind"] != "伏図":
            continue
        reply = read["reply"]
        floors = [floor for plan in reply["plans"] for floor in plan["floors"]] if "plans" in reply else [reply["floor"]]
        original = next((e for e in pages if e["replaced_by"] == {"source": read["source"], "page": read["page"]}), None)
        design_page = read["page"] if read["source"] == "D1" else (original or {}).get("page")
        revised_page = read["page"] if read["source"] == "D2" else None
        for floor in floors:
            for key in level_keys(floor):
                plan_by_level[key] = {"design": design_page, "revised": revised_page}
                floor_by_level[key] = floor
    common = [e["page"] for e in pages if e["source"] == "D1" and e["kind"] in ("軸組図", "リスト") and (e["read"] or e["replaced_by"])]
    design = meta["inputs"]["design"]
    if not common:
        # ページの種類が分からない図面でも照合できるように、先頭のページを基準にする
        common = list(range(1, min(pymupdf.open(design).page_count, COMMON_FALLBACK_PAGES) + 1))
    entry = {
        "registered": True,
        "name": meta["name"],
        "structure": meta["structure"],
        "use": meta.get("use"),
        "site": meta.get("site"),
        "north_deg": meta.get("north_deg", 0),
        "kind": "steel" if meta["structure"] == "S造" else "foundation",
        "design": design,
        "revised": meta["inputs"].get("revised"),
        "common_pages": common,
        "plan_by_level": plan_by_level,
        "floor_by_level": floor_by_level,
    }
    if meta.get("masks"):
        entry["masks"] = meta["masks"]
    if minutes:
        entry["minutes"] = minutes
    checklist = steel_checklist() if meta["structure"] == "S造" else None
    if checklist:
        entry["checklist"] = checklist
    if model:
        entry["model"] = str(folder / "model.json")
    return entry


def save_project(slug, entry):
    with open(PROJECTS, "r+") as file:
        fcntl.flock(file, fcntl.LOCK_EX)
        projects = json.load(file)
        projects[slug] = entry
        file.seek(0)
        json.dump(projects, file, ensure_ascii=False, indent=2)
        file.truncate()


def file_digest(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def demo_preset(meta):
    """デモ用の切り替え。SEKOZU_DEMO_PRESET に物件を指定し、入れた構造図がその物件のものと同じなら、その物件名を返す"""
    slug = os.environ.get("SEKOZU_DEMO_PRESET")
    project = json.loads(PROJECTS.read_text()).get(slug) if slug else None
    if not project or file_digest(meta["inputs"]["design"]) != file_digest(project["design"]):
        return None
    return slug


def run(folder):
    status = Status(folder)
    stop = lambda: (folder / "stop.flag").exists()
    try:
        reg, meta = register_for(folder)
        pages = reg.load_pages()
        status.update(state="running", stage="読み取り", message="準備中です", pages_total=sum(e["read"] for e in pages), pages_done=0, usd=0)
        usd = 0.0
        if any(not e["title"] for e in pages):
            status.update(message="題名が読めないページの種類を判定しています")
            usd += reg.stage_b_quiet()
            pages = reg.load_pages()
        targets = [e for e in pages if e["read"]]
        status.update(pages_total=len(targets), usd=round(usd, 3))
        done = [0]

        def on_page(entry, total):
            done[0] += 1
            # デモ用：読み取り済みでも進み具合が見えるようにする
            if demo_preset(meta):
                time.sleep(PRESET_SECONDS_PER_PAGE)
            status.update(pages_done=done[0], usd=round(usd + total, 3), message=f"{done[0]} / {len(targets)} ページ読みました")

        read_usd, failed, stopped = reg.read_many(targets, on_page, stop)
        usd += read_usd
        if stopped:
            status.update(state="stopped", stage="止めました", message=f"止めました（{done[0]} / {len(targets)} ページ）。読み終えたページは次に使い回します", usd=round(usd, 3))
            os._exit(0)
        status.update(stage="検算", message="検算して、3Dを組み立てています", usd=round(usd, 3))
        model = None
        data = {"checks": [], "columns": [], "beams": [], "grids": {"x": [], "y": []}, "levels": [], "model_status": "3Dなし"}
        try:
            data, model = reg.stage_e()
        except Exception:
            (folder / "error-building.txt").write_text(traceback.format_exc())
            data["checks"].append({"kind": "3D", "result": "要確認", "message": "図面から建物データを作れなかったので、3Dなしで登録しました", "refs": []})
            write_json(folder / "building.json", data)
        for entry in failed:
            data["checks"].append({"kind": "読み取り", "result": "要確認", "message": f"{entry['title']}（p.{entry['page']}）を読み取れませんでした", "refs": []})
        write_json(folder / "building.json", data)
        # 意匠図があれば外観を足す。失敗しても骨組みの3Dで登録を終える
        architectural = meta["inputs"].get("architectural")
        if architectural and model:
            status.update(stage="外観", message="意匠図から外観を読んでいます")
            try:
                usd += exterior_read.read_all(architectural, folder / "exterior", EXTERIOR_MAX_USD)
                exterior_read.build(architectural, folder / "exterior", folder / "model.json", folder / "model.json")
                model = json.loads((folder / "model.json").read_text())
            except (Exception, SystemExit):
                (folder / "error-exterior.txt").write_text(traceback.format_exc())
                data["checks"].append({"kind": "外観", "result": "要確認", "message": "意匠図から外観を作れなかったので、骨組みで表示します", "refs": []})
        minutes, minutes_usd = minutes_files(folder, meta, status)
        usd += minutes_usd
        reg.spend("minutes", minutes_usd) if minutes_usd else None
        preset = demo_preset(meta)
        if preset:
            # デモ用：事前に作った現場（外観つき）を完成の状態として見せる。新しい現場は増やさない
            status.update(state="done", stage="完了", message="登録しました", usd=round(usd, 3), model_status="作成済み" if model else "3Dなし", preset_slug=preset)
            os._exit(0)
        save_project(folder.name, project_entry(folder, meta, reg, pages, model, minutes))
        status.update(state="done", stage="完了", message="登録しました", usd=round(usd, 3), model_status="作成済み" if model else "3Dなし")
    except (Exception, SystemExit):
        (folder / "error.txt").write_text(traceback.format_exc())
        status.update(state="error", stage="エラー", message="登録中にエラーが発生しました")
        os._exit(1)
    os._exit(0)


def main():
    command, folder = sys.argv[1], Path(sys.argv[2]).resolve()
    if ROOT.resolve() not in folder.parents:
        sys.exit("projects の外のフォルダは扱いません")
    {"prepare": prepare, "run": run}[command](folder)


if __name__ == "__main__":
    main()
