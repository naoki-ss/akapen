"""アップロードされた施工図PDFを判定し、朱書きPDFを作る。

  python check_upload.py <ジョブのフォルダ>

ジョブのフォルダは ~/sekozu-data/uploads/<id>/（リポジトリの外）。input.pdf と job.json を置いて起動する。
進み具合は status.json に書く（画面はこれを読む）。結果は result.json、marked.pdf、pages/、findings/。
判定するページは job.json の pages（1始まり。ページ番号は元のPDFのまま）。
stop.flag が置かれると、終わったページの結果だけで朱書きを作り、走っている呼び出しを打ち切って終わる。
物件に masks（名前の入る欄）が登録してあれば、masked/ に塗りつぶした同じ組（marked.pdf、pages/、findings/）も作る。

物件ごとの設計図書は ~/sekozu-data/projects.json に登録する（図面の場所を含むのでコミットしない）。

照合を足すときは checkers_for に足す。今は設計図書との照合（赤）、議事録との照合（赤）、ナレッジの確認（青）がある。
1つの照合は (page_context) -> (指摘のリスト, 費用, 記録) を返す。指摘の source_type で色と種類が決まる。
"""
import copy
import json
import multiprocessing
import os
import re
import sys
import threading
import time
import traceback
from concurrent.futures import FIRST_COMPLETED, ProcessPoolExecutor, ThreadPoolExecutor, wait
from datetime import datetime
from pathlib import Path

import anthropic
import pymupdf

from claude_api import call_claude, load_env
from common import PRIVATE, REPO, write_json
from index_steel_sheets import SCHEMA as INDEX_SCHEMA, SYSTEM as INDEX_SYSTEM
import design_basis
import design_split
import feedback
import drawing_ledger
import knowledge_check
import merge_findings
import red_filter
import minutes_check
from markup_pdf import SOURCE_TYPES, layer_overlay, make_marked_pdf, mask_pdf, set_visible_layers, to_rect, valid_regions
from claude_api import METER, usage_usd
from review_steel_sheet import SYSTEM as STEEL_SYSTEM, red_pixels, render
from steel_experiment import REVISED_NOTE, ROOT as EXPERIMENTS, build_inputs, image_block, record_cost, schema_for, tiles

PROJECTS = PRIVATE / "projects.json"
UPLOADS = PRIVATE / "uploads"
WORKERS = 3
MESSAGE_FILES = {"design": "review", "minutes": "minutes", "knowledge": "knowledge"}
CHECK_LABELS = {"design": "設計図書との照合（赤）", "minutes": "議事録との照合（赤）", "knowledge": "ナレッジの確認（青）"}
MAX_PAGES = 40
PAGE_DPI = 130
CROP_DPI = 150
CROP_MARGIN = 45

# 条件Dの入力と手順はそのままで、朱書きPDFのために出力の形だけ足す
OUTPUT_NOTE = """

出力について:
- regions に、指摘の場所ごとの範囲を入れてください。指摘が複数の場所を指すときは、場所ごとに範囲を分けて全部入れます。
- comment は図面に書き込む短いコメントです。30文字以内で、何を確認するのかが分かるように書きます。
- reason は、なぜ問題かを1文（40字程度）で書きます。前置きや読めた値の説明ではなく、何が問題なのかを書きます。
- needs_confirmation は、図面だけでは食い違いと言い切れず、人の確認が必要なときに true にします。
- design_locations に、根拠になる設計図の場所を書きます。doc は構造図か差替図面、page は元のPDFのページ番号（添付のPDFの何枚目かではなく、案内に書いたページ番号）、box はそのページ全体に対する 0〜1 の範囲 [x0, y0, x1, y1] です。"""

# 鉄骨以外の施工図では、製作会社向けの言い方だけを変える
FOUNDATION_WORDS = [
    ("鉄骨製作会社から提出された鉄骨施工図", "協力会社から提出された基礎・杭の施工図"),
    ("製作に入る前に", "施工の前に"),
    ("製作上の調整", "施工上の調整"),
    ("製作前の確認", "施工前の確認"),
    ("製作前に", "施工前に"),
]


class Job:
    """進み具合の記録。ページを並行して判定するので鍵を掛ける"""

    def __init__(self, folder):
        self.folder = Path(folder)
        self.lock = threading.Lock()
        self.started = time.time()
        # 止めている間は、打ち切るページの進み具合で画面の表示や費用の記録を変えない
        self.stopping = False
        self.max_usd = None
        self.status = {"state": "running", "stage": "準備中", "message": "準備中です", "pid": os.getpid(),
                       "pages_total": 0, "pages_done": 0, "active_pages": [], "usd": 0.0, "seconds": 0,
                       "started_at": datetime.now().isoformat(timespec="seconds")}
        self.write()

    def write(self):
        self.status["seconds"] = round(time.time() - self.started, 1)
        # 費用は応答の途中の呼び出しも入れた正しい数字を見せる（作り直しでは呼ばないので元の値を残す）
        if METER.total():
            self.status["usd"] = round(METER.total(), 3)
        # 画面が書きかけを読まないように、書き終えてから置き換える
        temp = self.folder / "status.json.tmp"
        temp.write_text(json.dumps(self.status, ensure_ascii=False))
        temp.replace(self.folder / "status.json")

    def update(self, **values):
        with self.lock:
            self.status.update(values)
            self.write()

    def page_started(self, number):
        with self.lock:
            if self.stopping:
                return
            self.status["active_pages"] = sorted({*self.status["active_pages"], number})
            self._page_message()
            self.write()

    def page_finished(self, number):
        with self.lock:
            if self.stopping:
                return
            self.status["active_pages"] = [p for p in self.status["active_pages"] if p != number]
            self.status["pages_done"] += 1
            self._page_message()
            self.write()

    def page_detail(self, number, **values):
        """ページごとの進み具合。画面のチェック中の表示に使う"""
        with self.lock:
            detail = self.status.setdefault("pages_detail", {}).setdefault(str(number), {"state": "waiting", "focus": []})
            detail.update(values)
            self.write()

    def focus_done(self, number, key):
        with self.lock:
            self.status["pages_detail"][str(number)]["focus"].append(key)
            self.write()

    def _page_message(self):
        pages = "、".join(str(p) for p in self.status["active_pages"])
        total = self.status["pages_total"]
        self.status["stage"] = "確認中"
        self.status["message"] = (f"{pages} ページ目を確認中（全 {total} ページ、{self.status['pages_done']} ページ完了）"
                                  if pages else f"{self.status['pages_done']} / {total} ページ完了")


def message_cost(path):
    usage = json.loads(Path(path).read_text())["usage"]
    return usage["input_tokens"], usage["output_tokens"], usage_usd(usage)


def raw_cost(raw_dir):
    """このページで応答が返った呼び出しの費用の合計（生の応答はどれも usage を持つ）"""
    total = 0.0
    for path in Path(raw_dir).glob("*.json"):
        usage = json.loads(path.read_text()).get("usage") if path.stat().st_size else None
        if usage:
            total += usage_usd(usage)
    return total


def load_project(slug):
    projects = json.loads(PROJECTS.read_text())
    if slug not in projects:
        raise ValueError("設計図書が登録されていない物件です")
    return projects[slug]


def output_schema():
    schema = copy.deepcopy(schema_for("D"))
    # 観点ごとの判定では、部材の一覧は書かせない（出力が短くなる）
    schema["required"].remove("inventory")
    del schema["properties"]["inventory"]
    finding = schema["properties"]["findings"]["items"]
    finding["required"].remove("region")
    del finding["properties"]["region"]
    finding["required"] += ["regions", "comment", "reason", "needs_confirmation"]
    finding["properties"]["regions"] = {"type": "array", "items": {"type": "array", "items": {"type": "number"}}}
    finding["properties"]["comment"] = {"type": "string"}
    finding["properties"]["reason"] = {"type": "string"}
    finding["properties"]["needs_confirmation"] = {"type": "boolean"}
    finding["required"].append("design_locations")
    finding["properties"]["design_locations"] = {
        "type": "array",
        "items": {
            "type": "object",
            "additionalProperties": False,
            "required": ["doc", "page", "box"],
            "properties": {"doc": {"type": "string", "enum": ["構造図", "差替図面"]}, "page": {"type": "integer"},
                           "box": {"type": "array", "items": {"type": "number"}}},
        },
    }
    return schema


def system_prompt(project):
    system = STEEL_SYSTEM.replace("region に全体図に対する 0〜1 の範囲 [x0, y0, x1, y1] を入れます",
                                  "regions に全体図に対する 0〜1 の範囲 [x0, y0, x1, y1] を入れます")
    if project.get("kind") == "foundation":
        for steel, other in FOUNDATION_WORDS:
            system = system.replace(steel, other)
    return system + (REVISED_NOTE if project.get("revised") else "") + feedback.prompt_note()


def classify_page(client, page, raw_dir):
    """図面の種類と階を読む。照合に使う設計図のページを決めるのに使う"""
    content = [{"type": "text", "text": "施工図：全体図"}, image_block(render(page))]
    for png, place in tiles(page, 3, 2):
        content += [{"type": "text", "text": f"施工図：{place} の分割図"}, image_block(png)]
    content.append({"type": "text", "text": "このページを読み取ってください。"})
    reply = call_claude(client, INDEX_SYSTEM, content, INDEX_SCHEMA, raw_dir, "classify", effort="low")
    return reply, message_cost(raw_dir / "classify.json")[2]


def plan_for(project, classified):
    """伏図なら同じ階の伏図のページを返す。それ以外は共通のページだけで照合する"""
    if classified["kind"] == "伏図":
        for frame in classified["frames"]:
            plan = project.get("plan_by_level", {}).get(frame["level"])
            if plan:
                return plan, frame["level"]
    return project.get("default_plan") or {}, None


def run_design_check(context):
    """設計図書との照合。確認の観点ごとに並行で判定し、文面で整理する（1枚1分前後）"""
    project, classified = context["project"], context["classified"]
    plan, level = plan_for(project, classified)
    system = system_prompt(project)
    schema = output_schema()
    raw_dir = context["raw_dir"]
    client = context["client"]
    page = pymupdf.open(context["input"])[context["number"] - 1]
    found, unreadable, usd, seconds = design_split.run_focus(client, system, project, plan, page, OUTPUT_NOTE, schema, raw_dir, on_focus=context["on_focus"])
    targets = knowledge_check.targets_of(context["checklist"]) if context.get("checklist") else []
    kept, dropped, verdicts, consolidate_usd = design_split.consolidate(client, found, targets, raw_dir)
    reply = {"findings": kept, "unreadable": unreadable, "dropped_items": dropped}
    write_json(raw_dir / "review-result.json", reply)
    usd += consolidate_usd
    findings = design_findings(reply, context["number"], level)
    red_filter.remember(findings, verdicts, [t["id"] for t in targets])
    return findings, usd, {"unreadable": unreadable, "dropped_items": dropped, "seconds_design": seconds}


def design_findings(reply, number, level):
    return [{**item, "source_type": "design", "page": number, "regions": valid_regions(item.get("regions")), "floor_level": level}
            for item in reply["findings"]]


def run_knowledge_check(context):
    """チェックリストにもとづく確認。設計図は渡さない（設計図との照合は赤の担当）"""
    project, classified, number = context["project"], context["classified"], context["number"]
    targets = knowledge_check.targets_of(context["checklist"])
    page = pymupdf.open(context["input"])[number - 1]
    content = [{"type": "text", "text": "施工図：全体図"}, image_block(render(page))]
    for png, place in tiles(page, 4, 3):
        content += [{"type": "text", "text": f"施工図：{place} の分割図"}, image_block(png)]
    content.append({"type": "text", "text": knowledge_check.prompt_text(targets)})
    raw_dir = context["raw_dir"]
    write_json(raw_dir / "knowledge-prompt.json", {"system": knowledge_check.SYSTEM,
                                                   "text_blocks": [b["text"] for b in content if b["type"] == "text"]})
    schema = knowledge_check.build_schema(targets)
    reply = call_claude(context["client"], knowledge_check.SYSTEM + feedback.prompt_note(), content, schema, raw_dir, "knowledge")
    write_json(raw_dir / "knowledge-result.json", reply)
    tokens = message_cost(raw_dir / "knowledge.json")
    level = plan_for(project, classified)[1]
    found, dropped = knowledge_check.to_findings(reply, targets, number, level)
    for item in found:
        item["regions"] = valid_regions(item.get("regions"))
    results = knowledge_check.page_results(reply, targets, found)
    return found, tokens[2], {"unreadable": reply.get("unreadable", []), "input_tokens": tokens[0], "output_tokens": tokens[1],
                              "item_results": results, "dropped": dropped}


def run_minutes_check(context):
    """議事録との照合。設計図は渡さない（設計図との照合は別の担当）"""
    project, classified, number = context["project"], context["classified"], context["number"]
    documents = context["minutes"]
    items = minutes_check.all_items(documents)
    page = pymupdf.open(context["input"])[number - 1]
    content = [{"type": "text", "text": "施工図：全体図"}, image_block(render(page))]
    for png, place in tiles(page, 4, 3):
        content += [{"type": "text", "text": f"施工図：{place} の分割図"}, image_block(png)]
    content.append({"type": "text", "text": minutes_check.prompt_text(documents)})
    raw_dir = context["raw_dir"]
    write_json(raw_dir / "minutes-prompt.json", {"system": minutes_check.SYSTEM,
                                                 "text_blocks": [b["text"] for b in content if b["type"] == "text"]})
    schema = minutes_check.build_schema(list(items))
    reply = call_claude(context["client"], minutes_check.SYSTEM + feedback.prompt_note(), content, schema, raw_dir, "minutes")
    write_json(raw_dir / "minutes-result.json", reply)
    tokens = message_cost(raw_dir / "minutes.json")
    level = plan_for(project, classified)[1]
    found, dropped = minutes_check.to_findings(reply, items, number, level)
    for item in found:
        item["regions"] = valid_regions(item.get("regions"))
    results = minutes_check.page_results(reply, items, found)
    return found, tokens[2], {"unreadable": reply.get("unreadable", []), "input_tokens": tokens[0], "output_tokens": tokens[1],
                              "item_results": results, "dropped": dropped}


# 照合の一覧（design と minutes は赤、knowledge は青で描かれる）
def checkers_for(project, checklist, minutes=()):
    checkers = {"design": run_design_check}
    if minutes:
        checkers["minutes"] = run_minutes_check
    if checklist:
        checkers["knowledge"] = run_knowledge_check
    return checkers


def timed(checker, context):
    started = time.time()
    found, usd, record = checker(context)
    return found, usd, {**record, "usd": round(usd, 3), "seconds": round(time.time() - started, 1)}


def stopped_cost(raw_dir, name):
    """応答が返ったあとに止まった回の費用（読み取りの分は成功した時点で足してある）"""
    path = raw_dir / f"{MESSAGE_FILES[name]}.json"
    return message_cost(path)[2] if path.exists() else 0.0


def input_counts(checklist, minutes):
    """照合に使う資料の数。{議事録の項目, ナレッジの項目}"""
    return {"minutes": sum(len(document["items"]) for document in minutes),
            "knowledge": sum(len(items) for items in checklist.values())}


INPUT_NAMES = {"minutes": "議事録", "knowledge": "ナレッジ"}


def preflight(meta, checklist, minutes):
    """AIを呼ぶ前に、照合に使う資料が入っているかを確かめる。入っていなければ費用を掛けずに止める。
    allow_missing は、ないと承知で始めるもの。expect_minutes は、議事録に入っているはずの語"""
    allowed = meta.get("allow_missing") or []
    missing = [INPUT_NAMES[name] for name, count in input_counts(checklist, minutes).items() if not count and name not in allowed]
    if missing:
        raise ValueError(f"{'と'.join(missing)}が入っていないので、チェックを始めませんでした。費用は掛かっていません")
    text = "\n".join(document["text"] for document in minutes)
    absent = [word for word in meta.get("expect_minutes") or [] if word not in text]
    if absent:
        raise ValueError(f"議事録に入っているはずの「{'、'.join(absent)}」がないので、チェックを始めませんでした。費用は掛かっていません")


def stop_requested(folder):
    return (folder / "stop.flag").exists()


def check_page(job, client, project, library, minutes, input_path, number, job_id):
    """1ページの結果。始める前に止める指示が来ていたら None"""
    if stop_requested(job.folder):
        return None
    job.page_started(number)
    job.page_detail(number, state="running")
    raw_dir = job.folder / "raw" / f"p{number}"
    raw_dir.mkdir(parents=True, exist_ok=True)
    page = pymupdf.open(input_path)[number - 1]
    usd = 0.0
    checks = {}
    started = time.time()
    try:
        classified, cost = classify_page(client, page, raw_dir)
        usd += cost
        write_json(raw_dir / "classified.json", classified)
        job.page_detail(number, title=classified.get("title"))
        # 施工図の種類からチェックリストを選ぶ。合うものがなければ青の照合はしない
        name, checklist = knowledge_check.checklist_for(library, classified.get("title"), project.get("kind"))
        if checklist:
            write_json(raw_dir / "knowledge-checklist.json", {"name": name})
        context = {"client": client, "project": project, "classified": classified, "input": str(input_path),
                   "number": number, "raw_dir": raw_dir, "checklist": checklist, "minutes": minutes,
                   "on_focus": lambda key: job.focus_done(number, key)}
        # 議事録に、この階に関係する項目がなければ照合しない
        page_level = plan_for(project, classified)[1]
        page_floor = project.get("floor_by_level", {}).get(page_level)
        page_minutes = minutes if minutes_check.relevant(minutes, page_floor) else ()
        context["minutes"] = minutes
        checkers = checkers_for(project, checklist, page_minutes)
        findings, failed = [], []
        # 照合どうしは待ち合わせない
        with ThreadPoolExecutor(len(checkers)) as pool:
            running = {name: pool.submit(timed, checker, context) for name, checker in checkers.items()}
        for name, future in running.items():
            try:
                found, cost, checks[name] = future.result()
                usd += cost
                findings += found
            except (Exception, SystemExit):
                # 片方の失敗でもう片方の結果を捨てない。一覧に「判定できなかった」と書く
                (raw_dir / f"error-{name}.txt").write_text(traceback.format_exc())
                failed.append(name)
                usd += stopped_cost(raw_dir, name)
        blue = sum(item["source_type"] == "knowledge" for item in findings)
        job.page_detail(number, state="done", red=len(findings) - blue, blue=blue)
        return {"number": number, "ok": len(failed) < len(checkers), "failed_checks": failed, "findings": findings,
                "classified": classified, "raw_dir": raw_dir, "usd": usd, "seconds": round(time.time() - started, 1), "red_pixels": red_pixels(page),
                "checks": checks, "error": "一部の照合に失敗" if failed else None}
    except (Exception, SystemExit) as error:  # 1ページの失敗で全体を止めない。一覧に「判定できなかった」と書く
        (raw_dir / "error.txt").write_text(traceback.format_exc())
        return {"number": number, "ok": False, "failed_checks": [], "findings": [], "error": type(error).__name__, "usd": usd,
                "seconds": round(time.time() - started, 1)}
    finally:
        # 止めたあとに終わったページは、打ち切ったページとしてまとめて記録する
        if not job.stopping:
            record_cost(EXPERIMENTS / "ledger.json", f"upload-{job_id[:8]}-p{number}", round(usd, 3))
        job.page_finished(number)


def run_pages(job, numbers, work):
    """ページを並行して判定する。(終わったページの結果, 終わらなかったページ番号)。止める指示が来たら待たずに返す"""
    pool = ThreadPoolExecutor(WORKERS)
    futures = {number: pool.submit(work, number) for number in numbers}
    pending = set(futures.values())
    while pending and not stop_requested(job.folder):
        _, pending = wait(pending, timeout=1, return_when=FIRST_COMPLETED)
        job.update()
        # 費用の上限は、応答の途中の呼び出しも入れた数字で見る
        if job.max_usd and METER.total() >= job.max_usd:
            (job.folder / "stop.flag").write_text(f"費用が上限 {job.max_usd} ドルに達しました")
    pool.shutdown(wait=not pending, cancel_futures=bool(pending))
    # 止める指示のあとは、結果に入れるページをここで決める。job.stopping より先に数えると、記録の漏れが出る
    with job.lock:
        job.stopping = bool(pending)
    results = {number: future.result() for number, future in futures.items() if future.done() and not future.cancelled()}
    finished = [result for result in results.values() if result is not None]
    done = {result["number"] for result in finished}
    return finished, [number for number in numbers if number not in done]


def member_refs(item, classified, slug):
    """3Dで強調する部材。階は図面の種類から、部材は符号と通りから決める"""
    project = load_project(slug)
    # 画面から登録した物件の3Dはリポジトリの外にある
    model_path = Path(project["model"]) if project.get("model") else REPO / "demo-data" / slug / "model.json"
    if not model_path.exists():
        return [], None
    model = json.loads(model_path.read_text())
    floor = project.get("floor_by_level", {}).get(item.get("floor_level")) or project.get("default_floor")
    # 軸組図の指摘は、図の通りを手がかりにする
    tokens = set(re.findall(r"[XY]\d", " ".join(item["grids"])))
    refs = []
    for member in model["members"]:
        if floor and member["floor"] != floor:
            continue
        grids = set(re.findall(r"[XY]\d", member["grid"]))
        same_mark = member["mark"] in item["marks"]
        exact_grid = member["grid"] in item["grids"]
        if exact_grid or (same_mark and (not tokens or tokens & grids)):
            refs.append(f"{member['type']}|{member['floor']}|{member['grid']}")
    return refs, floor


def render_outputs(folder, marked_path, findings, numbers):
    """画面に出すページの画像と、指摘ごとの切り抜きを、朱書きを重ねたPDFから作る"""
    doc = pymupdf.open(marked_path)
    sheets = []
    (folder / "pages").mkdir(exist_ok=True)
    (folder / "findings").mkdir(exist_ok=True)
    zoom = PAGE_DPI / 72
    matrix = pymupdf.Matrix(zoom, zoom)
    # 朱書きPDFには判定したページだけが入っている。ファイル名と画面の番号は元のPDFのページ番号
    at = {number: index for index, number in enumerate(numbers)}
    for number in numbers:
        set_visible_layers(doc, SOURCE_TYPES)
        pix = doc[at[number]].get_pixmap(matrix=matrix, alpha=False)
        pix.save(folder / f"pages/p{number}.png")
        # 画面で種類ごとに表示を切り替えるので、朱書きのない図面と、種類ごとの透明な画像も作る
        set_visible_layers(doc, [])
        base = doc[at[number]].get_pixmap(matrix=matrix, alpha=False)
        base.save(folder / f"pages/p{number}-base.png")
        layers = []
        for key in SOURCE_TYPES:
            if not any(item["page"] == number and item["source_type"] == key for item in findings):
                continue
            set_visible_layers(doc, [key])
            overlay = layer_overlay(base, doc[at[number]].get_pixmap(matrix=matrix, alpha=False))
            overlay.save(folder / f"pages/p{number}-{key}.png")
            layers.append({"key": key, "image": f"pages/p{number}-{key}.png"})
        sheets.append({"id": f"p{number}", "doc": "アップロードした施工図", "page": number, "title": f"{number} ページ目（朱書き）",
                       "image": f"pages/p{number}.png", "base_image": f"pages/p{number}-base.png", "layers": layers,
                       "width": pix.width, "height": pix.height})
    for item in findings:
        # 指摘の切り抜きには、その種類の朱書きだけを出す
        set_visible_layers(doc, [item["source_type"]])
        page = doc[at[item["page"]]]
        rects = [to_rect(page, box) for box in item["regions"]]
        clip = page.rect
        if rects:
            whole = rects[0]
            for rect in rects[1:]:
                whole |= rect
            clip = (whole + (-CROP_MARGIN, -CROP_MARGIN, CROP_MARGIN, CROP_MARGIN)) & page.rect
        zoom = CROP_DPI / 72
        page.get_pixmap(matrix=pymupdf.Matrix(zoom, zoom), clip=clip, alpha=False).save(folder / f"findings/{item['number']}.png")
    return sheets


def to_view(item, slug, classified):
    refs, floor = member_refs(item, classified, slug)
    box = item["regions"][0] if item["regions"] else [0, 0, 1, 1]
    sources = "、".join(f"{e['drawing']} {e['page']}" for e in item.get("evidence", []))
    if item.get("checklist"):
        sources = f"チェックリスト {item['checklist']['id']} {item['checklist']['basis']}"
    # 議事録の番号と本文は、詳細の「議事録の該当箇所」に出す
    minutes_refs = [{"id": e["page"], "text": e["where"]} for e in item.get("evidence", [])] if item["source_type"] == "minutes" else None
    if minutes_refs:
        sources = ""
    label = SOURCE_TYPES[item["source_type"]]["label"]
    return {
        "id": str(item["number"]),
        "severity": item["severity"],
        "category": item["category"],
        "title": item["title"],
        "content": item["content"] + (f"（根拠：{sources}）" if sources else "") + merge_findings.merged_note(item),
        "drawing": {"doc": "アップロードした施工図", "page": item["page"], "bbox": box, "sheet": f"p{item['page']}"},
        "members": {"grids": item["grids"], "marks": item["marks"], "floor": floor or ""},
        "model_refs": refs,
        "source": "ai",
        "key_ids": [],
        "planted": False,
        "evidence": [{"doc": "アップロードした施工図", "page": item["page"], "where": f"朱書き {item['number']}", "text": "",
                      "bbox": box, "image": f"findings/{item['number']}.png"}],
        "number": item["number"],
        "source_type": item["source_type"],
        "source_label": label,
        "needs_confirmation": item["needs_confirmation"],
        "checklist_id": item.get("checklist", {}).get("id"),
        "minutes_refs": minutes_refs,
        "merged_numbers": item.get("merged_numbers"),
        # 根拠カードで値を並べるための項目。朱書きの短い注記と、枠が複数のときの全部の枠
        "comment": item.get("comment"),
        "reason": item.get("reason") or None,
        "regions": item["regions"],
        "sheet_value": item.get("sheet_value") or None,
        "design_value": item.get("design_value") or item.get("decided_value") or None,
        "sources": [{"doc": e["drawing"], "page": e["page"], "where": e["where"]} for e in item.get("evidence", [])],
        "design_locations": item.get("design_locations"),
        "red_kind": item.get("red_kind"),
        "red_basis": item.get("red_basis"),
    }


def merge_same(client, findings, raw_dir):
    """赤と青の同じ指摘をまとめる。(費用, 注記)。判定に失敗したら、まとめずに別々の枠のまま返す"""
    pairs = merge_findings.candidates(findings)
    if not pairs:
        return 0.0, None
    ids = [merge_findings.pair_id(red, blue) for red, blue in pairs]
    if (raw_dir / "merge-result.json").exists():  # 作り直すときは、前の判定を使う（費用を掛けない）
        same = {entry["pair"] for entry in json.loads((raw_dir / "merge-result.json").read_text())["pairs"] if entry["same"]}
        merge_findings.apply_merges(findings, [(red, blue) for red, blue in pairs if merge_findings.pair_id(red, blue) in same])
        return 0.0, None
    if client is None:  # 止めたあとは、新しくAIを呼ばない
        return 0.0, "赤と青が同じ内容かの判定をしていないので、枠はまとめていません。"
    content = [{"type": "text", "text": merge_findings.prompt_text(pairs)}]
    usd = 0.0
    try:
        reply = call_claude(client, merge_findings.SYSTEM, content, merge_findings.schema(ids), raw_dir, "merge", effort="low")
        usd = message_cost(raw_dir / "merge.json")[2]
        write_json(raw_dir / "merge-result.json", reply)
    except (Exception, SystemExit):
        (raw_dir / "error-merge.txt").write_text(traceback.format_exc())
        if (raw_dir / "merge.json").exists():
            usd = message_cost(raw_dir / "merge.json")[2]
        return usd, "赤と青が同じ内容かの判定が完了しなかったので、枠はまとめていません。"
    same = {entry["pair"] for entry in reply["pairs"] if entry["same"]}
    merge_findings.apply_merges(findings, [(red, blue) for red, blue in pairs if merge_findings.pair_id(red, blue) in same])
    return usd, None


def write_masked(folder, input_path, masks, findings, numbers, **marks):
    """塗りつぶした同じ組を masked/ に作る。朱書きは塗ったあとの図面に重ねる。作れたら True"""
    out = folder / "masked"
    out.mkdir(exist_ok=True)
    masked_input = out / "input.pdf"
    try:
        mask_pdf(input_path, masked_input, masks, numbers)
        make_marked_pdf(masked_input, findings, out / "marked.pdf", **marks)
        render_outputs(out, out / "marked.pdf", findings, numbers)
        return True
    except Exception:
        (folder / "error-masked.txt").write_text(traceback.format_exc())
        return False
    finally:
        masked_input.unlink(missing_ok=True)


def remap_decisions(folder, original_numbers):
    """朱書きから外した指摘の番号を、振り直した番号にする。一度だけ行う"""
    path = folder / "decisions.json"
    if not path.exists():
        return
    data = json.loads(path.read_text())
    if data.get("renumbered"):
        return
    new_of = {old: new for new, old in original_numbers.items()}
    write_json(path, {"excluded": [new_of[number] for number in data["excluded"] if number in new_of], "renumbered": True})


def narrow_findings(client, folder, findings, pages, checklist, project_kind):
    """赤の絞り込み、過去の判断による除外、赤青のまとめ、番号の振り直し。画面と朱書きPDFの書き出しで同じ結果にする。
    pages は [{number, classified}]。client が None のときは保存済みの判定だけを使う"""
    notes = []
    # デモから外した議事録の指摘は出さない
    if (folder / "drop_minutes.flag").exists():
        findings = [item for item in findings if item["source_type"] != "minutes"]
    targets_cache = {}

    def targets_of_page(number):
        if number not in targets_cache:
            title = next(((page.get("classified") or {}).get("title") for page in pages if page["number"] == number), None)
            targets_cache[number] = red_filter.targets_for(checklist or {}, title, project_kind)
        return targets_cache[number]

    filter_usd = 0.0
    filtered, moved_to_blue = [], 0
    # 確定したページの指摘と番号は変えない
    status_path = folder / "sheet_status.json"
    locked = {int(page) for page, value in json.loads(status_path.read_text())["pages"].items() if value.get("confirmed")} if status_path.exists() else set()
    try:
        open_items = [item for item in findings if item["page"] not in locked]
        kept, filtered, moved_to_blue, filter_usd = red_filter.apply(client, open_items, targets_of_page)
        findings = sorted(kept + [item for item in findings if item["page"] in locked], key=lambda item: item["number"])
    except Exception:
        traceback.print_exc()
        notes.append("赤の絞り込みが完了しなかったので、絞り込む前の指摘を出しています。")
    # 過去に人が不要と判断した指摘と同じ種類のものを抑える
    suppressed = []
    try:
        open_items = [item for item in findings if item["page"] not in locked]
        kept, suppressed, feedback_usd = feedback.apply(client, open_items, folder / "raw")
        findings = sorted(kept + [item for item in findings if item["page"] in locked], key=lambda item: item["number"])
        filter_usd += feedback_usd
    except Exception:
        traceback.print_exc()
    if suppressed:
        notes.append(f"過去の判断により {len(suppressed)} 件を除外しました。")
    if filter_usd:
        record_cost(EXPERIMENTS / "ledger.json", f"upload-{folder.name[:8]}-red-filter", round(filter_usd, 3))
    if filtered or moved_to_blue:
        notes.append(f"食い違いではない表記不足の指摘を {len(filtered) + moved_to_blue} 件、赤から外しました（うち {moved_to_blue} 件はナレッジに当てはまるので青にしました）。")
    merge_usd, merge_note = merge_same(client, findings, folder / "raw")
    if merge_usd:
        record_cost(EXPERIMENTS / "ledger.json", f"upload-{folder.name[:8]}-merge", round(merge_usd, 3))
    if merge_note:
        notes.append(merge_note)
    # 表示の番号は絞り込んだあとで振り直す。理由と朱書きから外す印は、元の番号で引く。確定したページがあるときは振り直さない（欠番が出る）
    original_numbers = {item["number"]: item["number"] for item in findings} if locked else {new: item["number"] for new, item in enumerate(findings, 1)}
    new_of = {old: new for new, old in original_numbers.items()}
    for new_number, item in zip(original_numbers, findings):
        item["number"] = new_number
        if item.get("merged_numbers"):
            item["merged_numbers"] = [new_of[old] for old in item["merged_numbers"] if old in new_of]
    remap_decisions(folder, original_numbers)
    return {"findings": findings, "filtered": filtered, "suppressed": suppressed, "usd": filter_usd, "merge_usd": merge_usd,
            "original_numbers": original_numbers, "notes": notes}


def finish_job(job, folder, slug, pages, checklist, use_knowledge, client, input_path, minutes=(), masks=None, stopped=(), stopped_usd=0.0):
    """ページごとの結果から、朱書きPDFと result.json を作る。stopped は途中で止めて結果がないページ、stopped_usd はその費用"""
    numbers = [page["number"] for page in pages]
    job.update(stage="朱書き", message="朱書きPDFを作成中です", active_pages=[])
    findings = []
    for page in pages:
        findings += page["findings"]
    for number, item in enumerate(findings, 1):
        item["number"] = number
    failed = [page["number"] for page in pages if not page["ok"]]
    notes = []
    if stopped:
        notes.append("途中で止めました。次のページは判定していません（指摘がないという意味ではありません）： " + "、".join(f"p.{n}" for n in stopped))
    narrowed = narrow_findings(client, folder, findings, pages, checklist, load_project(slug).get("kind"))
    findings = narrowed["findings"]
    filtered, suppressed, filter_usd, merge_usd, original_numbers = (narrowed[key] for key in ("filtered", "suppressed", "usd", "merge_usd", "original_numbers"))
    notes += narrowed["notes"]
    # 観点ごとの判定を整理したときに、値が一致するとして外した指摘
    for page in pages:
        filtered += [{**item, "page": page["number"]} for item in page.get("checks", {}).get("design", {}).get("dropped_items", [])]
    if failed:
        notes.append("次のページは判定できませんでした（指摘がないという意味ではありません）： " + "、".join(f"p.{n}" for n in failed))
    unlocated = [item["number"] for item in findings if not item["regions"]]
    if unlocated:
        notes.append("次の指摘は図面上の場所を示せませんでした： " + "、".join(str(n) for n in unlocated))
    for page in pages:
        if page["failed_checks"]:
            names = "、".join(CHECK_LABELS[name] for name in page["failed_checks"])
            notes.append(f"p.{page['number']} は次の照合が完了していません（指摘がないという意味ではありません）： {names}")
    dropped = sum(page.get("checks", {}).get("knowledge", {}).get("dropped", 0) for page in pages)
    if dropped:
        notes.append(f"チェックリストの対象外の項目を根拠にした指摘 {dropped} 件を除きました。")
    dropped = sum(page.get("checks", {}).get("minutes", {}).get("dropped", 0) for page in pages)
    if dropped:
        notes.append(f"議事録の番号が示されていない指摘 {dropped} 件を除きました。")
    minutes_rows = None
    # checklist は全部のチェックリスト。ページごとに使ったものだけを結果に出す
    project_kind = load_project(slug).get("kind")
    checklist_rows = knowledge_check.summary_for(checklist, pages, project_kind) if use_knowledge else None
    use_knowledge = bool(checklist_rows)
    no_list = [str(page["number"]) for page in pages if page.get("ok") and "knowledge" not in page.get("checks", {})]
    if checklist and no_list:
        notes.append("次のページは、種類の合うチェックリストがないので青の照合をしていません： " + "、".join(f"p.{n}" for n in no_list))
    if minutes:
        done = [(page["number"], page["checks"]["minutes"]["item_results"]) for page in pages if "minutes" in page.get("checks", {})]
        minutes_rows = minutes_check.summary_rows(minutes_check.all_items(minutes), done)
    used = ["設計図書"] + (["議事録"] if minutes else []) + (["ナレッジ"] if use_knowledge else [])
    unused = [name for name in ("議事録", "ナレッジ") if name not in used]
    notes.append(f"今回の照合は{'、'.join(used)}です。" + (f"{'、'.join(unused)}の照合は行っていません。" if unused else ""))
    tables = []
    if minutes_rows:
        tables.append(("議事録の確認結果", minutes_rows))
    if checklist_rows:
        tables.append(("チェックリストの確認結果", checklist_rows))
    marked = folder / "marked.pdf"
    marks = {"title": "施工図の朱書き", "notes": notes, "tables": tables, "pages": numbers}
    # 塗りつぶした組は別のプロセスで同時に作る
    with ProcessPoolExecutor(1, mp_context=multiprocessing.get_context("fork")) as pool:
        masked_job = pool.submit(write_masked, folder, input_path, masks, findings, numbers, **marks) if masks else None
        summary = make_marked_pdf(input_path, findings, marked, **marks)
        sheets = render_outputs(folder, marked, findings, numbers)
        masked = bool(masked_job and masked_job.result())
    by_page = {page["number"]: page for page in pages}
    views = [to_view(item, slug, by_page[item["page"]].get("classified")) for item in findings]
    # 理由の項目を足す前の結果は、あとから作った理由を使う（作り直しても消えないように別のファイルに置く）
    reasons_path = folder / "reasons.json"
    if reasons_path.exists():
        reasons = json.loads(reasons_path.read_text())
        for view in views:
            view["reason"] = view["reason"] or reasons.get(str(original_numbers.get(view["number"], view["number"])))
    # 根拠の資料（設計図の切り抜きなど）。作れなくても判定の結果は返す
    basis_usd = 0.0
    try:
        design_basis.SPENT[0] = 0.0
        design_basis.attach(views, load_project(slug), folder, client, minutes, checklist or {})
        basis_usd = design_basis.SPENT[0]
        if basis_usd:
            record_cost(EXPERIMENTS / "ledger.json", f"upload-{folder.name[:8]}-title-blocks", round(basis_usd, 3))
    except Exception:
        traceback.print_exc()
        notes.append("根拠の資料の一部を作れませんでした。文面の根拠は表示できます。")
    usd = round(sum(page["usd"] for page in pages) + merge_usd + stopped_usd + basis_usd + filter_usd, 3)
    # ページの失敗などで内訳に入らなかった費用も、合計と記録に入れる
    if METER.total() - usd > 0.001:
        record_cost(EXPERIMENTS / "ledger.json", f"upload-{folder.name[:8]}-other", round(METER.total() - usd, 3))
        usd = round(METER.total(), 3)
    seconds = round(time.time() - job.started, 1)
    write_json(folder / "result.json", {
        "mode": f"{'、'.join(used)}の照合（設計図書は条件D）。{len(numbers)} ページ、{len(findings)} 件。",
        "findings": views,
        "changes": [],
        "sheets": sheets,
        "masked": masked,
        "failed_pages": failed,
        "stopped_pages": list(stopped),
        "notes": notes,
        "summary": summary,
        "checklist": checklist_rows,
        "minutes": minutes_rows,
        "pages": [{k: page.get(k) for k in ("number", "ok", "usd", "seconds", "checks", "failed_checks", "red_pixels", "error")} |
                  {"title": (page.get("classified") or {}).get("title")} for page in pages],
        "merge_usd": round(merge_usd, 3),
        "filtered": filtered,
        "suppressed": suppressed,
        "usd": usd,
        "seconds": seconds,
    })
    message = f"止めました（{len(numbers)} ページ分の結果、{len(findings)} 件）" if stopped else f"完了しました（{len(findings)} 件）"
    job.update(state="done", stage="完了", message=message, usd=usd)


def main():
    # 始める前の画面に出す、照合に使う資料の数。AIは呼ばない
    if sys.argv[1] == "--inputs":
        print(json.dumps(input_counts(knowledge_check.load_library(), minutes_check.load_minutes(load_project(sys.argv[2]), sys.argv[2]))))
        return
    folder = Path(sys.argv[1]).resolve()
    if UPLOADS.resolve() not in folder.parents:
        sys.exit("uploads の外のフォルダは扱いません")
    job = Job(folder)
    try:
        meta = json.loads((folder / "job.json").read_text())
        slug = meta["project"]
        project = load_project(slug)
        input_path = folder / "input.pdf"
        source = pymupdf.open(input_path)
        if source.needs_pass:
            raise ValueError("パスワード付きのPDFは扱えません")
        page_count = source.page_count
        source.close()
        numbers = meta.get("pages") or [1]
        if not all(1 <= number <= page_count for number in numbers):
            raise ValueError("選んだページがPDFにありません")
        # どの版の設計図書で照合したかを残す。新しい版が入ったときに、再チェックが必要と分かるように
        write_json(folder / "job.json", {**meta, "design_sets": drawing_ledger.current_sets(slug)})
        job.max_usd = meta.get("max_usd")
        for number in numbers:
            job.page_detail(number)
        job.update(pages_total=len(numbers), stage="確認中", message=f"チェックを始めます（全 {len(numbers)} ページ）")

        load_env()
        if not os.environ.get("ANTHROPIC_API_KEY"):
            raise ValueError("ANTHROPIC_API_KEY がありません")
        client = anthropic.Anthropic()
        checklist = knowledge_check.load_library()
        minutes = minutes_check.load_minutes(project, slug)
        preflight(meta, checklist, minutes)
        use_knowledge = "knowledge" in checkers_for(project, checklist, minutes)
        pages, stopped = run_pages(job, numbers, lambda n: check_page(job, client, project, checklist, minutes, input_path, n, folder.name))
        masks = project.get("masks")
        if not stopped:
            finish_job(job, folder, slug, pages, checklist, use_knowledge, client, input_path, minutes, masks)
            write_json(folder / "cost.json", METER.snapshot())
            return
        job.update(stage="止めています", message="止めています。終わったページの朱書きを作っています", active_pages=[])
        # 途中で止めたページの費用。応答の途中の呼び出しは、入力の分と出力の見積もりを入れる
        partial = lambda: max(0.0, METER.total() - sum(page["usd"] for page in pages))
        if pages:
            finish_job(job, folder, slug, pages, checklist, use_knowledge, None, input_path, minutes, masks, stopped, partial())
        else:
            job.update(state="stopped", stage="止めました", message="止めました。終わったページはありません", usd=round(partial(), 3))
        write_json(folder / "cost.json", METER.snapshot())
        record_cost(EXPERIMENTS / "ledger.json", f"upload-{folder.name[:8]}-stopped", round(partial(), 3))
        os._exit(0)  # 走っている呼び出しを待たない
    except (Exception, SystemExit) as error:
        (folder / "error.txt").write_text(traceback.format_exc())
        # 画面には詳細を出さない（図面の場所などが混ざるため）
        message = str(error) if isinstance(error, ValueError) else "判定中にエラーが発生しました"
        job.update(state="error", stage="エラー", message=message, active_pages=[])
        os._exit(1)  # 走っている呼び出しを待たない


if __name__ == "__main__":
    main()
