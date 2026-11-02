"""鉄骨施工図と設計図の照合の条件を比べる実験。

  python steel_experiment.py --condition C --page 2 --dry-run
  python steel_experiment.py --condition C --page 2

条件は1つずつ足していく。
  A 施工図＋構造図（review_steel_sheet.py で実施）
  B A＋差替図面
  C B＋施工図を細かく分割し、同じ階の伏図も分割して渡す
  D C＋照合の手順を決めて1つずつ確認させる

設定と記録は ~/sekozu-data/experiments/ に置く（図面の場所を含むのでコミットしない）。
- 人の朱書きのある図面は内容のハッシュで拒否する。施工図と構造図は赤があれば送らない
- プロンプトは正解の指摘を知らなくても書ける一般的な内容だけにする
- 予算の上限を超えそうなら API を呼ばない
"""
import argparse
import base64
import copy
import hashlib
import json
import os
import sys
import time
from datetime import datetime
from pathlib import Path

import anthropic
import pymupdf

import ai_review
from ai_review import MODEL, call_claude, load_env
from common import PRIVATE, write_json
from repeat_runs import PRICE_INPUT, PRICE_OUTPUT
from review_steel_sheet import SCHEMA, SYSTEM, red_pixels, render

ROOT = PRIVATE / "experiments"
# 予算の判定に使う出力の見込み（トークン）。実際の費用は応答の値で記録する
OUTPUT_ESTIMATE = 25000

REVISED_NOTE = """

設計図について:
- 設計図は2種類あります。構造図と、その後に出された差替図面です。差替図面の赤い書き込みは設計者による訂正です。
- 同じ内容が両方にあれば、新しい差替図面を基準にします。差替図面にないページは構造図を基準にします。"""

PROCEDURE = """

次の手順で照合し、結果を inventory と findings に書いてください。
(1) 施工図に出てくる部材符号を、図とリストの両方から全部書き出す。
(2) 符号ごとに、構造図のリスト・伏図・軸組図の断面、位置、レベル、基準線を突き合わせる。
(3) リストにあって図にない符号、図にあってリストにない符号を探す。
(4) 食い違いごとに、根拠になる図面とページを evidence に示す。"""


def tiles(page, columns, rows, overlap=0.06):
    """[(PNG, 範囲の説明)] 重なりのある分割図"""
    width, height = page.rect.width, page.rect.height
    images = []
    for row in range(rows):
        for column in range(columns):
            x0, x1 = max(0, column / columns - overlap), min(1, (column + 1) / columns + overlap)
            y0, y1 = max(0, row / rows - overlap), min(1, (row + 1) / rows + overlap)
            rect = pymupdf.Rect(x0 * width, y0 * height, x1 * width, y1 * height)
            images.append((render(page, rect), f"全体の x {x0:.2f}〜{x1:.2f}、y {y0:.2f}〜{y1:.2f}"))
    return images


def image_block(png):
    return {"type": "image", "source": {"type": "base64", "media_type": "image/png",
                                        "data": base64.standard_b64encode(png).decode()}}


def pdf_block(data):
    return {"type": "document", "source": {"type": "base64", "media_type": "application/pdf",
                                           "data": base64.standard_b64encode(data).decode()}}


def sha256(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def schema_for(condition):
    schema = copy.deepcopy(SCHEMA)
    if condition != "D":
        return schema
    finding = schema["properties"]["findings"]["items"]
    finding["required"].append("evidence")
    finding["properties"]["evidence"] = {
        "type": "array",
        "items": {
            "type": "object",
            "additionalProperties": False,
            "required": ["drawing", "page", "where"],
            "properties": {"drawing": {"type": "string"}, "page": {"type": "string"}, "where": {"type": "string"}},
        },
    }
    schema["required"].append("inventory")
    schema["properties"]["inventory"] = {
        "type": "array",
        "items": {
            "type": "object",
            "additionalProperties": False,
            "required": ["mark", "in_sheet_drawing", "in_sheet_list", "sheet_section", "design_section", "result"],
            "properties": {
                "mark": {"type": "string"},
                "in_sheet_drawing": {"type": "boolean"},
                "in_sheet_list": {"type": "boolean"},
                "sheet_section": {"type": "string"},
                "design_section": {"type": "string"},
                "result": {"type": "string"},
            },
        },
    }
    return schema


def build_inputs(condition, page_config, config):
    """(content, 記録用の入力一覧)"""
    for path in (config["sheet"], config["design"], config["revised"]):
        if sha256(path) in config["deny_sha256"].values():
            sys.exit(f"AIに見せない図面です: {Path(path).name}")

    sheet = pymupdf.open(config["sheet"])
    design = pymupdf.open(config["design"])
    revised = pymupdf.open(config["revised"])
    sheet_page = sheet[page_config["sheet_page"] - 1]
    design_pages = sorted([page_config["design_plan"], *config["design_common_pages"]])

    red = {"施工図": red_pixels(sheet_page), **{f"構造図 p{p}": red_pixels(design[p - 1]) for p in design_pages}}
    marked = {k: v for k, v in red.items() if v}
    if marked:
        sys.exit(f"赤い部分があるページは送りません: {marked}")

    columns, rows = (4, 3) if condition in ("C", "D") else (3, 2)
    content = [{"type": "text", "text": "施工図：全体図"}, image_block(render(sheet_page))]
    labels = []
    for png, place in tiles(sheet_page, columns, rows):
        labels.append(place)
        content += [{"type": "text", "text": f"施工図：{place} の分割図"}, image_block(png)]

    subset = pymupdf.open()
    for page_no in design_pages:
        subset.insert_pdf(design, from_page=page_no - 1, to_page=page_no - 1)
    content += [{"type": "text", "text": f"次のPDFは構造図の p{','.join(map(str, design_pages))} です。"},
                pdf_block(subset.tobytes())]
    content += [{"type": "text", "text": "次のPDFは差替図面です（全ページ）。"},
                pdf_block(Path(config["revised"]).read_bytes())]

    plan_tiles = []
    if condition in ("C", "D"):
        plans = [("構造図", design, page_config["design_plan"])]
        if page_config["revised_plan"]:
            plans.append(("差替図面", revised, page_config["revised_plan"]))
        for name, document, page_no in plans:
            for png, place in tiles(document[page_no - 1], 3, 2):
                plan_tiles.append(f"{name} p{page_no} {place}")
                content += [{"type": "text", "text": f"{name} p{page_no}（伏図）：{place} の分割図"}, image_block(png)]

    request = "この施工図のページを設計図と照らし合わせ、確認すべき点を挙げてください。"
    if condition == "D":
        request += PROCEDURE
    content.append({"type": "text", "text": request})

    record = {
        "condition": condition,
        "sheet": {"file": Path(config["sheet"]).name, "sha256": sha256(config["sheet"]), "page": page_config["sheet_page"],
                  "tiles": f"{columns}x{rows}"},
        "design": {"file": Path(config["design"]).name, "sha256": sha256(config["design"]), "pages": design_pages},
        "revised": {"file": Path(config["revised"]).name, "sha256": sha256(config["revised"]), "pages": "all"},
        "plan_tiles": plan_tiles,
        "red_pixels": red,
    }
    return content, record


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--condition", choices=["B", "C", "D"], required=True)
    parser.add_argument("--page", required=True, help="config.json の pages のキー")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    config = json.loads((ROOT / "config.json").read_text())
    started = time.perf_counter()
    content, record = build_inputs(args.condition, config["pages"][args.page], config)
    system = SYSTEM + REVISED_NOTE
    schema = schema_for(args.condition)
    prepared = time.perf_counter()

    load_env()
    if not os.environ.get("ANTHROPIC_API_KEY"):
        sys.exit(".env.local に ANTHROPIC_API_KEY がありません")
    client = anthropic.Anthropic()

    counted = client.messages.count_tokens(model=MODEL, system=system,
                                           messages=[{"role": "user", "content": content}]).input_tokens
    estimate = (counted * PRICE_INPUT + OUTPUT_ESTIMATE * PRICE_OUTPUT) / 1_000_000
    ledger_path = ROOT / "ledger.json"
    ledger = json.loads(ledger_path.read_text())
    spent = sum(run["usd"] for run in ledger["runs"])
    print(f"入力 {counted} トークン、見込み {estimate:.2f} ドル、使用済み {spent:.2f} / {ledger['budget_usd']:.2f} ドル")
    if args.dry_run:
        return
    if spent + estimate > ledger["budget_usd"]:
        sys.exit("予算の上限を超えそうなので実行しません")

    # 出力が多くても予算を超えないように、残額から出力の上限を決める
    remaining = ledger["budget_usd"] - spent - counted * PRICE_INPUT / 1_000_000
    ai_review.MAX_TOKENS = min(ai_review.MAX_TOKENS, int(remaining * 1_000_000 / PRICE_OUTPUT))

    run_id = f"{args.condition}-p{args.page}-{datetime.now().strftime('%Y%m%d-%H%M%S')}"
    raw_dir = ROOT / run_id
    write_json(raw_dir / "inputs.json", record)
    write_json(raw_dir / "prompt.json", {
        "system": system,
        "text_blocks": [b["text"] for b in content if b["type"] == "text"],
        "schema": schema,
    })

    before_call = time.perf_counter()
    try:
        reply = call_claude(client, system, content, schema, raw_dir, "review")
    finally:
        finished = time.perf_counter()
        # 途中で止まった回の費用も記録する
        response = raw_dir / "review.json"
        if response.exists():
            message = json.loads(response.read_text())
            usage = message["usage"]
            cost = (usage["input_tokens"] * PRICE_INPUT + usage["output_tokens"] * PRICE_OUTPUT) / 1_000_000
            ledger["runs"].append({"id": run_id, "usd": round(cost, 3)})
            write_json(ledger_path, ledger)
            write_json(raw_dir / "metrics.json", {
                "model": message["model"],
                "stop_reason": message["stop_reason"],
                "input_tokens": usage["input_tokens"],
                "output_tokens": usage["output_tokens"],
                "cost_usd": round(cost, 3),
                "prepare_seconds": round(prepared - started, 1),
                "api_seconds": round(finished - before_call, 1),
                "total_seconds": round(finished - started, 1),
            })
    write_json(raw_dir / "result.json", reply)
    print((raw_dir / "metrics.json").read_text())
    print(f"指摘 {len(reply['findings'])} 件。使用済み {sum(r['usd'] for r in ledger['runs']):.2f} ドル。結果: {raw_dir}")


if __name__ == "__main__":
    main()
