"""設計図書との照合の呼び出し。設計図書の部分はキャッシュして使い回す。"""
import json
import time
from pathlib import Path

import pymupdf

from claude_api import MAX_TOKENS, MODEL, PRICE_INPUT, PRICE_OUTPUT
from common import write_json
from review_steel_sheet import render
from steel_experiment import image_block, pdf_block

COLUMNS, ROWS = 4, 3
# キャッシュの書き込みの料金（入力に対する倍率）
CACHE_WRITE_1H = 2.0
CACHE_WRITE_5M = 1.25
CACHE_READ_RATE = 0.1

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
    with client.beta.messages.stream(
        model=MODEL,
        max_tokens=MAX_TOKENS,
        betas=["server-side-fallback-2026-07-01"],
        fallbacks="default",
        system=[{"type": "text", "text": system, "cache_control": {"type": "ephemeral", "ttl": "1h"}}],
        output_config={"effort": effort, "format": {"type": "json_schema", "schema": schema}},
        messages=[{"role": "user", "content": content}],
    ) as stream:
        for _ in stream:
            if on_start:
                on_start()
                on_start = None
        message = stream.get_final_message()
    write_json(raw_dir / f"{name}.json", message.model_dump(mode="json"))
    usage = message.usage
    written = usage.cache_creation_input_tokens or 0
    read = usage.cache_read_input_tokens or 0
    detail = usage.cache_creation
    long_lived = (detail.ephemeral_1h_input_tokens or 0) if detail else 0
    usd = ((usage.input_tokens + long_lived * CACHE_WRITE_1H + (written - long_lived) * CACHE_WRITE_5M + read * CACHE_READ_RATE) * PRICE_INPUT
           + usage.output_tokens * PRICE_OUTPUT) / 1_000_000
    seconds = round(time.time() - started, 1)
    print(f"{name}: {seconds}秒 入力 {usage.input_tokens} 書込 {written} 読込 {read} 出力 {usage.output_tokens} {usd:.3f}ドル")
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
    "details": "設計図書の詳細図・標準図（部分詳細図、鉄骨詳細図、片持梁、デッキ受け、ピン接合リスト）に指定された部材や接合が、施工図の描き方や注記と合っているかを確かめます。",
}


def run_focus(client, system, config, plan, page, output_note, schema, raw_dir, effort="low"):
    """観点ごとに並行で判定する。1つ目の応答が始まってから残りを始めると、施工図の画像のキャッシュが効く。
    (指摘, 読めなかった内容, 費用, 秒)"""
    import threading
    from concurrent.futures import ThreadPoolExecutor

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
        if index > 0:
            first_started.wait(90)
        content = [*base, {"type": "text", "text": f"この施工図のページを設計図と照らし合わせます。今回の確認の観点だけを見てください。\n\n観点：{text}{output_note}"}]
        return call(client, system + RED_RULE, content, schema, raw_dir, f"focus-{key}", effort, first_started.set if index == 0 else None)

    with ThreadPoolExecutor(len(FOCUS)) as pool:
        results = list(pool.map(one, enumerate(FOCUS.items())))
    findings, unreadable, usd = [], [], 0.0
    for reply, cost, _ in results:
        findings += reply["findings"]
        unreadable += reply.get("unreadable", [])
        usd += cost
    return findings, unreadable, usd, round(time.time() - started, 1)


CONSOLIDATE_SYSTEM = """あなたは施工図チェックの結果を整理する担当です。複数の観点で別々に確認した設計図書との照合の指摘を、文面だけから整理します。図面は見ません。

指摘ごとに次を書きます。
- duplicate_of：ほかの指摘と同じ箇所の同じ内容なら、残す指摘のキー（一番詳しいもの）。残す指摘と違うものだけに書き、なければ空。部材と食い違いの中身が同じなら同じ内容です。別の部材や別の値の指摘はまとめません
- kind：
  - 食い違い：値・寸法・材質・部材符号・位置が設計図書と食い違っている
  - 未反映：設計図書にある部材・変更・記入が施工図に反映されていない。「記入なし」「表示なし」でも、設計図書に根拠が示されていれば未反映です
  - 表記不足：施工図の書き方が足りないだけで、どの設計図書にも根拠が示されていない
  - 一致：文面の値を換算すると同じで、食い違いではない（例：SLはFLから基準の差を引いた値なので、基準の差の分だけ違う2つの値は同じです）。「確認してください」とだけ書かれ、違いが示されていないものも一致とします
- knowledge_id：表記不足のとき、候補のチェック項目に、はっきり当てはまるものがあればそのID。なければ空
- basis：判断の根拠を30字程度で。設計図書の場所と内容を書きます

迷うときは食い違いか未反映にして残します。"""


def consolidate(client, findings, targets, raw_dir):
    """重複をまとめ、種類を決める。(残す指摘, 外した指摘, {番号: 判定}, 費用)。失敗したら全部残す"""
    from claude_api import call_claude

    if not findings:
        return findings, [], {}, 0.0
    keys = [f"f{index}" for index in range(len(findings))]
    lines = ["候補のチェック項目:", *[f"- {t['id']}：{t['item']}（{t['content']}）" for t in targets], "", "指摘:"]
    for key, item in zip(keys, findings):
        lines.append(f"[{key}] {item['title']}\n本文：{item['content']}\n施工図：{item.get('sheet_value') or ''}\n設計図書：{item.get('design_value') or ''}\n")
    schema = {
        "type": "object", "additionalProperties": False, "required": ["items"],
        "properties": {"items": {"type": "array", "items": {
            "type": "object", "additionalProperties": False, "required": ["key", "duplicate_of", "kind", "knowledge_id", "basis"],
            "properties": {"key": {"type": "string", "enum": keys}, "duplicate_of": {"type": "string"},
                           "kind": {"type": "string", "enum": ["食い違い", "未反映", "表記不足", "一致"]},
                           "knowledge_id": {"type": "string"}, "basis": {"type": "string"}},
        }}},
    }
    try:
        reply = call_claude(client, CONSOLIDATE_SYSTEM, [{"type": "text", "text": "\n".join(lines)}], schema, raw_dir, "consolidate", effort="low")
    except Exception as error:
        print(f"整理できませんでした: {error}")
        return findings, [], {}, 0.0
    usage = json.loads((raw_dir / "consolidate.json").read_text())["usage"]
    usd = (usage["input_tokens"] * PRICE_INPUT + usage["output_tokens"] * PRICE_OUTPUT) / 1_000_000
    by_key = {entry["key"]: entry for entry in reply["items"]}
    kept, dropped, verdicts = [], [], {}
    for key, item in zip(keys, findings):
        entry = by_key.get(key)
        target = entry and entry["duplicate_of"]
        if target and target != key and target in by_key:
            continue
        if entry and entry["kind"] == "一致":
            dropped.append({"source_type": "design", "title": item["title"], "content": item["content"], "reason": entry["basis"]})
            continue
        if entry:
            verdicts[len(kept)] = {"kind": entry["kind"], "reason": entry["basis"], "knowledge_id": entry["knowledge_id"]}
        kept.append(item)
    return kept, dropped, verdicts, usd
