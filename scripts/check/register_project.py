"""設計図書から建物データと3Dを作る（物件の登録）。結果はリポジトリの外に置く。

  python register_project.py <物件名の短い記号> --name 表示名 --design 構造図.pdf [--revised 差替図面.pdf] --stage A|B|C|D|E

  A  文字だけでページの種類を判定する（AIなし）
  B  文字で決まらないページを小さな画像で判定する
  C  3種類を各1枚読んで、形式と費用を確かめる
  D  必要なページを全部読む（読んだページは読み直さない）
  E  検算して、建物データと3Dを作る（AIなし）

記号は ~/sekozu-data/projects/<記号>/ のフォルダ名になる。
"""
import argparse
import hashlib
import json
import shutil
import sys
import traceback
from concurrent.futures import FIRST_COMPLETED, ThreadPoolExecutor, wait

from pathlib import Path

import anthropic
import pymupdf

import building_data
import building_pages
import building_read
from ai_review import call_claude, load_env
from check_upload import message_cost
from common import PRIVATE, write_json
from review_steel_sheet import render
from steel_experiment import ROOT as EXPERIMENTS, image_block, record_cost, tiles

WORKERS = 3
# 同じPDFの同じページは読み直さない
CACHE = PRIVATE / "projects" / "_cache"


class Register:
    def __init__(self, args):
        self.args = args
        self.folder = PRIVATE / "projects" / args.slug
        self.raw = self.folder / "raw"
        self.raw.mkdir(parents=True, exist_ok=True)
        self.docs = {"D1": pymupdf.open(args.design)}
        if args.revised:
            self.docs["D2"] = pymupdf.open(args.revised)
        self.pages_path = self.folder / "pages.json"
        self.hashes = {key: hashlib.sha256(Path(doc.name).read_bytes()).hexdigest()[:24] for key, doc in self.docs.items()}

    def doc(self, source):
        return self.docs[source]

    def load_pages(self):
        return json.loads(self.pages_path.read_text())

    def client(self):
        load_env()
        return anthropic.Anthropic()

    def spend(self, label, usd):
        record_cost(EXPERIMENTS / "ledger.json", f"register-{self.args.slug}-{label}", round(usd, 3))
        return usd

    def stage_a_quiet(self):
        design = building_pages.classify_by_text(self.args.design, "D1")
        revised = building_pages.classify_by_text(self.args.revised, "D2") if self.args.revised else []
        building_pages.apply_replacements(design, revised)
        pages = design + revised
        write_json(self.pages_path, pages)
        return pages

    def stage_a(self):
        pages = self.stage_a_quiet()
        for entry in pages:
            print(entry["source"], entry["page"], entry["kind"], entry["title"], "読む" if entry["read"] else "", entry["replaced_by"] or "")
        print("題名が読めないページ", [(e["source"], e["page"]) for e in pages if not e["title"]])
        print("読むページ数", sum(e["read"] for e in pages))

    def stage_b(self):
        print(f"費用 {self.stage_b_quiet():.3f} ドル")

    def stage_b_quiet(self):
        pages = self.load_pages()
        client = self.client()
        total = 0.0

        def one(entry):
            raw_dir = self.raw / f"{entry['source']}-p{entry['page']}"
            raw_dir.mkdir(exist_ok=True)
            content = [image_block(render(self.doc(entry["source"])[entry["page"] - 1])), {"type": "text", "text": "このページを判定してください。"}]
            reply = call_claude(client, building_pages.AI_SYSTEM, content, building_pages.AI_SCHEMA, raw_dir, "kind")
            return entry, reply, message_cost(raw_dir / "kind.json")[2]

        unknown = [e for e in pages if not e["title"]]
        with ThreadPoolExecutor(WORKERS) as pool:
            for entry, reply, usd in pool.map(one, unknown):
                total += usd
                entry.update(how="AI", kind=reply["kind"], title=building_pages.normalize(reply["title"]))
                text = " ".join(word[4] for word in building_pages.display_words(self.doc(entry["source"])[entry["page"] - 1]))
                entry["read"] = building_pages.needed(entry["kind"], entry["title"], text)
                print(entry["source"], entry["page"], entry["kind"], entry["title"], "読む" if entry["read"] else "", round(usd, 3))
        building_pages.apply_replacements([e for e in pages if e["source"] == "D1"], [e for e in pages if e["source"] == "D2"])
        write_json(self.pages_path, pages)
        self.spend("kinds", total)
        return total

    def cache_path(self, entry):
        return CACHE / f"{self.hashes[entry['source']]}-p{entry['page']}-{entry['kind']}.json"

    def cached(self, entry):
        return (self.folder / "reads" / f"{entry['source']}-p{entry['page']}.json").exists() or self.cache_path(entry).exists()

    def read_page(self, client, entry):
        name = f"{entry['source']}-p{entry['page']}"
        path = self.folder / "reads" / f"{name}.json"
        path.parent.mkdir(exist_ok=True)
        if path.exists():
            return entry, 0.0, False
        if self.cache_path(entry).exists():
            shutil.copy(self.cache_path(entry), path)
            return entry, 0.0, False
        raw_dir = self.raw / name
        raw_dir.mkdir(exist_ok=True)
        system, schema, _ = building_read.READERS[entry["kind"]]
        content = building_read.build_content(self.doc(entry["source"])[entry["page"] - 1], entry["kind"], image_block, render, tiles)
        reply = call_claude(client, system, content, schema, raw_dir, "read")
        write_json(path, {"source": entry["source"], "page": entry["page"], "kind": entry["kind"], "title": entry["title"], "reply": reply})
        CACHE.mkdir(parents=True, exist_ok=True)
        shutil.copy(path, self.cache_path(entry))
        return entry, message_cost(raw_dir / "read.json")[2], True

    def read_many(self, entries, on_page=None, should_stop=None):
        """(費用, 読めなかったページ, 止めたか)。1ページの失敗で全体を止めない"""
        client = self.client() if any(not self.cached(e) for e in entries) else None
        total = 0.0
        failed = []

        def one(entry):
            try:
                return self.read_page(client, entry)
            except (Exception, SystemExit):
                raw_dir = self.raw / f"{entry['source']}-p{entry['page']}"
                raw_dir.mkdir(exist_ok=True)
                (raw_dir / "error.txt").write_text(traceback.format_exc())
                return entry, 0.0, None

        pool = ThreadPoolExecutor(WORKERS)
        pending = {pool.submit(one, entry) for entry in entries}
        stopped = False
        while pending:
            done, pending = wait(pending, timeout=1, return_when=FIRST_COMPLETED)
            for future in done:
                entry, usd, fresh = future.result()
                if fresh is None:
                    failed.append(entry)
                elif fresh:
                    self.spend(f"{entry['source']}-p{entry['page']}", usd)
                total += usd
                print(entry["source"], entry["page"], entry["kind"], entry["title"], round(usd, 3))
                if on_page:
                    on_page(entry, total)
            if should_stop and should_stop() and pending:
                stopped = True
                break
        pool.shutdown(wait=not stopped, cancel_futures=stopped)
        print(f"費用 {total:.3f} ドル")
        return total, failed, stopped

    def stage_c(self):
        targets = [e for e in self.load_pages() if e["read"]]
        pilot = []
        for kind in ("伏図", "軸組図", "リスト"):
            # 基礎でない最初の階の伏図を使う
            rows = [e for e in targets if e["kind"] == kind and "基礎" not in e["title"]] or [e for e in targets if e["kind"] == kind]
            pilot += rows[:1]
        self.read_many(pilot)

    def stage_d(self):
        self.read_many([e for e in self.load_pages() if e["read"]])

    def stage_e(self):
        reads_dir = self.folder / "reads"
        reads = [json.loads(path.read_text()) for path in sorted(reads_dir.glob("*.json"))] if reads_dir.exists() else []
        data = building_data.build(reads, self.doc)
        data["name"] = self.args.name
        data["sources"] = [{"id": key, "role": "構造図" if key == "D1" else "差替図面", "pages": doc.page_count} for key, doc in self.docs.items()]
        data["pages"] = self.load_pages()
        model = building_data.to_model(data, self.args.name)
        data["model_status"] = "作成済み" if model else "3Dなし"
        write_json(self.folder / "building.json", data)
        if model:
            write_json(self.folder / "model.json", model)
        need = [c for c in data["checks"] if c["result"] == "要確認"]
        print(f"3D {data['model_status']}。通り {len(data['grids']['x'])}×{len(data['grids']['y'])}、階 {len(data['levels'])}、柱 {len(data['columns'])}、梁 {len(data['beams'])}、要確認 {len(need)}、参考 {len(data['checks']) - len(need)}")
        for row in need:
            print(" ", row["kind"], row["message"])
        return data, model


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("slug")
    parser.add_argument("--name", required=True)
    parser.add_argument("--design", required=True)
    parser.add_argument("--revised")
    parser.add_argument("--stage", required=True, choices=list("ABCDE"))
    args = parser.parse_args()
    if "/" in args.slug or ".." in args.slug:
        sys.exit("記号に使えない文字があります")
    getattr(Register(args), f"stage_{args.stage.lower()}")()


if __name__ == "__main__":
    main()
