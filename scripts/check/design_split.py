"""設計図書との照合の呼び出し。設計図書の部分はキャッシュして使い回す。"""
import json
import re
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import pymupdf

from claude_api import stream_message, usage_usd
from common import write_json
from review_steel_sheet import render
from steel_experiment import image_block, pdf_block

COLUMNS, ROWS = 4, 3
# キャッシュができるのを待つ上限（秒）
FIRST_WAIT = 90
CONSOLIDATE_EFFORT = "low"
RED_RULE = """

赤にするのは矛盾だけです:
- 出す：値・寸法・材質・部材符号・位置が、設計図書（差替図面を含む）と食い違うもの
- 出す：設計図書にある部材・変更・記入が、施工図に反映されていないもの（「記入なし」「表示なし」でも、設計図書のどこかに根拠があれば出します）
- 出さない：どの設計図書にも根拠がない、施工図の書き方が足りないだけのもの"""

def sheet_regions(page):
    """[(範囲の説明, [(PNG, 説明)])]。列ごとに分ける"""
    width, height = page.rect.width, page.rect.height
    overlap = 0.06
    regions = []
    for column in range(COLUMNS):
        x0, x1 = max(0, column / COLUMNS - overlap), min(1, (column + 1) / COLUMNS + overlap)
        images = []
        for row in range(ROWS):
            y0, y1 = max(0, row / ROWS - overlap), min(1, (row + 1) / ROWS + overlap)
            rect = pymupdf.Rect(x0 * width, y0 * height, x1 * width, y1 * height)
            images.append((render(page, rect), f"全体の x {x0:.2f}〜{x1:.2f}、y {y0:.2f}〜{y1:.2f}"))
        regions.append((f"全体の x {x0:.2f}〜{x1:.2f}", images))
    return regions


def design_blocks(config, plan):
    """設計図書のブロック。どの階でも同じ部分を先に置いてキャッシュし、階で変わるページはそのあとに置く"""
    design = pymupdf.open(config["design"])
    pages = sorted(config["common_pages"])
    subset = pymupdf.open()
    for number in pages:
        subset.insert_pdf(design, from_page=number - 1, to_page=number - 1)
    blocks = [{"type": "text", "text": f"次のPDFは構造図の p{','.join(map(str, pages))} です。"}, pdf_block(subset.tobytes())]
    if config.get("revised"):
        blocks += [{"type": "text", "text": "次のPDFは差替図面です（全ページ）。"}, pdf_block(Path(config["revised"]).read_bytes())]
    blocks[-1] = {**blocks[-1], "cache_control": {"type": "ephemeral", "ttl": "1h"}}
    level_page = plan.get("design")
    if level_page and level_page not in pages:
        single = pymupdf.open()
        single.insert_pdf(design, from_page=level_page - 1, to_page=level_page - 1)
        blocks += [{"type": "text", "text": f"次のPDFは構造図の p{level_page}（この階の伏図）です。"}, pdf_block(single.tobytes())]
    return blocks


def call(client, system, content, schema, raw_dir, name, effort, on_start=None):
    """1回呼ぶ。(返事, 費用, 秒)。on_start は応答が始まったときに呼ぶ（キャッシュが使えるようになる）"""
    started = time.time()
    message = stream_message(client, [{"type": "text", "text": system, "cache_control": {"type": "ephemeral", "ttl": "1h"}}],
                             content, schema, raw_dir, name, effort, on_start)
    usage = message.usage
    usd = usage_usd(usage.model_dump(mode="json"))
    seconds = round(time.time() - started, 1)
    print(f"{name}: {seconds}秒 入力 {usage.input_tokens} 書込 {usage.cache_creation_input_tokens or 0} 読込 {usage.cache_read_input_tokens or 0} 出力 {usage.output_tokens} {usd:.3f}ドル")
    if message.stop_reason != "end_turn":
        raise RuntimeError(f"{name} の応答が完了していません: {message.stop_reason}")
    return json.loads(next(b.text for b in message.content if b.type == "text")), usd, seconds


# 確認の観点。観点を絞ると、浅い思考でも見落としが減る
FOCUS = {
    "list": "施工図の部材リスト（柱・大梁・小梁・デッキ・ルーフデッキ）の各行を、設計図書（差替図面を優先）の部材リストと1行ずつ照合します。断面の寸法、板厚、材質、製作方法を比べます。",
    "revised": "差替図面の赤枠・赤字の訂正を、ページの順に1か所ずつ全部見ます。この階の施工図に関係する訂正が反映されているかを確かめます。追加された部材（間柱など）、ブラケットの長さ、接合の変更、仕上げ（溶融亜鉛メッキなど）を含みます。",
    "notes": "施工図の共通事項の欄（使用材料、高力ボルト、塗装、ベースプレート、アンカーボルトなど）を、設計図書の特記仕様書と部材リストの指定と照合します。",
    "marks": "リストと図の対応を調べます。施工図と設計図のリストにある符号のうち、施工図の図に描かれていないもの（階段まわりの梁など）を探します。施工図の図にある符号のうち、施工図のリストにないもの（間柱など）を探します。",
    "layout": "施工図の伏図の図を、同じ階の設計図の伏図と照合します。部材符号の場所、レベル、基準線を、通りごとに比べます。",
    "details": "施工図の図と注記から、部分的な納まりの指定（デッキ受け、補強リブ、梁天からの下がり寸法、片持梁、ブラケット、ピン接合など）を1つずつ拾います。それぞれについて、設計図書の部分詳細図・鉄骨詳細図・標準図（差替図面の部分詳細図を含む）で同じ部位の指定を探し、材料・寸法・接合を比べます。対応する詳細があって値が違うものは必ず出します。そのあと逆向きに、設計図書の詳細図に指定された部材や接合が施工図にあるかを確かめます。",
}


class FirstWriter:
    """設計図書のキャッシュは全ページで同じ。最初の1回の応答が始まるまで、ほかのページは待つ（書き込みの重複を防ぐ）"""

    def __init__(self):
        self.lock = threading.Lock()
        self.claimed = False
        self.ready = threading.Event()

    def claim(self):
        """最初の1回なら True。それ以外は応答が始まるのを待って False"""
        with self.lock:
            first, self.claimed = not self.claimed, True
        if not first:
            self.ready.wait(FIRST_WAIT)
        return first


SHARED_CACHE = FirstWriter()


def run_focus(client, system, config, plan, page, output_note, schema, raw_dir, effort="low"):
    """観点ごとに並行で判定する。1つ目の応答が始まってから残りを始めると、施工図の画像のキャッシュが効く。
    (指摘, 読めなかった内容, 費用, 秒)"""
    started = time.time()
    base = [*design_blocks(config, plan)]
    for name, path, number in (("構造図", config["design"], plan.get("design")), ("差替図面", config.get("revised"), plan.get("revised"))):
        if path and number:
            doc = pymupdf.open(path)
            base += [{"type": "text", "text": f"{name} p{number}（伏図）の全体図"}, image_block(render(doc[number - 1]))]
    base += [{"type": "text", "text": "施工図：全体図"}, image_block(render(page))]
    for _, images in sheet_regions(page):
        for png, label in images:
            base += [{"type": "text", "text": f"施工図：{label} の分割図"}, image_block(png)]
    base[-1] = {**base[-1], "cache_control": {"type": "ephemeral"}}
    first_started = threading.Event()

    def one(index_item):
        index, (key, text) = index_item
        on_start = None
        if index > 0:
            first_started.wait(FIRST_WAIT)
        else:
            shared_first = SHARED_CACHE.claim()

            def on_start():
                first_started.set()
                if shared_first:
                    SHARED_CACHE.ready.set()
        content = [*base, {"type": "text", "text": f"この施工図のページを設計図と照らし合わせます。今回の確認の観点だけを見てください。\n\n観点：{text}{output_note}"}]
        try:
            return call(client, system + RED_RULE, content, schema, raw_dir, f"focus-{key}", effort, on_start)
        finally:
            # 失敗したときも、待っている呼び出しを止めたままにしない
            if on_start:
                on_start()

    with ThreadPoolExecutor(len(FOCUS)) as pool:
        results = list(pool.map(one, enumerate(FOCUS.items())))
    findings, unreadable, usd = [], [], 0.0
    for reply, cost, _ in results:
        findings += reply["findings"]
        unreadable += reply.get("unreadable", [])
        usd += cost
    return findings, unreadable, usd, round(time.time() - started, 1)


CONSOLIDATE_SYSTEM = """あなたは施工図チェックの結果を整理する担当です。複数の観点で別々に確認した設計図書との照合の指摘を、文面だけから整理します。図面は見ません。

指摘ごとに、次の順に考えて書きます。
- calc：施工図の値と設計図書の値が違う基準で書かれているとき（SLとFLなど）の換算の式。文面に基準の差（例：2FL-130 基準なら SL = FL + 130）があれば、必ず全部の値を換算して式を書きます。例：FL-230 → SL-100、FL-436 → SL-306。換算できなければ空
- kind：
  - 一致：calc で換算すると施工図の値と同じ、または文面の施工図の値と設計図書の値が同じで、食い違いではないと文面から言い切れるものだけ。施工図の値が読めないもの、反映を確認できないものは一致にしません
  - 食い違い：値・寸法・材質・部材符号・位置が設計図書と食い違っている
  - 未反映：設計図書にある部材・変更・記入が施工図に反映されていない。「記入なし」「表示なし」でも、設計図書に根拠が示されていれば未反映です
  - 表記不足：施工図の書き方が足りないだけで、どの設計図書にも根拠が示されていない
- duplicate_of：ほかの指摘と同じ原因なら、残す指摘のキー（一番詳しいもの）。残す指摘と違うものだけに書き、なければ空
  - 同じ原因の例：同じ部材の同じ値の食い違い。同じ差替え（同じ赤枠、同じ追加部材）から来る指摘は、「図に表示なし」「リストにない」「接合が確認できない」のように書き方が違っても同じ原因です
  - 別の部材や別の値の指摘はまとめません
- knowledge_id：表記不足のとき、候補のチェック項目に、はっきり当てはまるものがあればそのID。なければ空
- basis：判断の根拠を30字程度で。設計図書の場所と内容を書きます

迷うときは食い違いか未反映にして、まとめずに残します。"""


def same_level(item):
    """SL の値と FL の値を、文面にある基準の差で換算すると全部同じなら、換算の式を返す（AIに頼らず必ず外す）"""
    design = item.get("design_value") or ""
    base = re.search(r"FL[-−](\d+)\s*基準", design)
    sheet_values = {int(value) for value in re.findall(r"SL[-−](\d+)", item.get("sheet_value") or "")}
    if not base or not sheet_values:
        return None
    design_values = [int(value) for value in re.findall(r"FL[-−](\d+)(?!\d*\s*基準)", design)]
    converted = {value - int(base.group(1)) for value in design_values}
    if converted != sheet_values:
        return None
    return "、".join(f"FL-{value} → SL-{value - int(base.group(1))}" for value in design_values)


def root_of(key, by_key):
    """同じ原因の指摘をたどって、残す指摘のキーを返す。輪になっていたら自分を残す"""
    seen = [key]
    while True:
        entry = by_key.get(seen[-1])
        target = entry and entry["duplicate_of"]
        if not target or target not in by_key or target == seen[-1]:
            return seen[-1]
        if target in seen:
            return key
        seen.append(target)


def merge_into(kept, others):
    """同じ原因の指摘を、残す指摘に合わせる。場所と根拠を失わない"""
    merged = dict(kept)
    for other in others:
        for field in ("regions", "design_locations", "evidence"):
            current = list(merged.get(field) or [])
            current += [value for value in other.get(field) or [] if value not in current]
            if field in kept or field in other:
                merged[field] = current
        if not other.get("needs_confirmation", True):
            merged["needs_confirmation"] = False
    titles = [other["title"] for other in others if other["title"] != kept["title"]]
    if titles:
        merged["content"] = f"{kept['content']}（同じ原因：{'、'.join(titles)}）"
    return merged


def consolidate(client, findings, targets, raw_dir):
    """重複をまとめ、種類を決める。(残す指摘, 外した指摘, {番号: 判定}, 費用)。失敗したら全部残す"""
    from claude_api import call_claude

    converted = [(item, same_level(item)) for item in findings]
    same = [{"source_type": "design", "title": item["title"], "content": item["content"], "reason": f"換算すると同じ：{calc}"} for item, calc in converted if calc]
    findings = [item for item, calc in converted if not calc]
    if not findings:
        return findings, same, {}, 0.0
    keys = [f"f{index}" for index in range(len(findings))]
    lines = ["候補のチェック項目:", *[f"- {t['id']}：{t['item']}（{t['content']}）" for t in targets], "", "指摘:"]
    for key, item in zip(keys, findings):
        lines.append(f"[{key}] {item['title']}\n本文：{item['content']}\n施工図：{item.get('sheet_value') or ''}\n設計図書：{item.get('design_value') or ''}\n")
    schema = {
        "type": "object", "additionalProperties": False, "required": ["items"],
        "properties": {"items": {"type": "array", "items": {
            "type": "object", "additionalProperties": False, "required": ["key", "calc", "kind", "duplicate_of", "knowledge_id", "basis"],
            "properties": {"key": {"type": "string", "enum": keys}, "calc": {"type": "string"},
                           "kind": {"type": "string", "enum": ["食い違い", "未反映", "表記不足", "一致"]},
                           "duplicate_of": {"type": "string"},
                           "knowledge_id": {"type": "string"}, "basis": {"type": "string"}},
        }}},
    }
    try:
        reply = call_claude(client, CONSOLIDATE_SYSTEM, [{"type": "text", "text": "\n".join(lines)}], schema, raw_dir, "consolidate", effort=CONSOLIDATE_EFFORT)
    except Exception as error:
        print(f"整理できませんでした: {error}")
        return findings, same, {}, 0.0
    usd = usage_usd(json.loads((raw_dir / "consolidate.json").read_text())["usage"])
    by_key = {entry["key"]: entry for entry in reply["items"]}
    item_of = dict(zip(keys, findings))
    others = {}
    for key in keys:
        root = root_of(key, by_key)
        if root != key:
            others.setdefault(root, []).append(item_of[key])
    kept, dropped, verdicts = [], same, {}
    for key in keys:
        entry = by_key.get(key)
        if entry and root_of(key, by_key) != key:
            continue
        if entry and entry["kind"] == "一致":
            dropped.append({"source_type": "design", "title": item_of[key]["title"], "content": item_of[key]["content"],
                            "reason": f"{entry['basis']} {entry['calc']}".strip()})
            continue
        if entry:
            verdicts[len(kept)] = {"kind": entry["kind"], "reason": entry["basis"], "knowledge_id": entry["knowledge_id"]}
        kept.append(merge_into(item_of[key], others.get(key, [])))
    return kept, dropped, verdicts, usd
