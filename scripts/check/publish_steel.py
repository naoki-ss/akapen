"""物件Bの鉄骨施工図と判定結果を、公開する形にして demo-data/sample-b に書き出す。

- 施工図の全ページを、名前の入る図面枠の欄を塗りつぶした画像にする（製作会社、出図印、確認印、担当者）
- 指摘ごとに、赤枠を付けた切り抜きと、同じ箇所の人の朱書きの切り抜きを作る
- 部材からページを引く索引を作る

入力は条件D（物件Bの標準の判定方法）の結果と、index_steel_sheets.py の索引。
画像は書き出し後に目で確認し、review_images.py で記録する。
"""
import json
import re
import shutil
from pathlib import Path

import pymupdf

from common import PRIVATE, REPO, write_json
from sheet_geometry import plan_transform, register

OUT = REPO / "demo-data" / "sample-b"
ROOT = PRIVATE / "experiments"
RED = (0.78, 0.21, 0.11)
SHEET_DPI = 170
CROP_DPI = 140
MARGIN = 45
DOC = "鉄骨施工図"
# 名前の入る欄（ページに対する 0〜1）。工事名称と図面名は残す
MASKS = [(0.43, 0.935, 0.627, 1.0), (0.795, 0.935, 0.96, 1.0)]
MASK_COLOR = (225, 225, 225)

# 判定に使ったページ。hits は採点の結果（scores-p*.json）で、指摘の番号は結果の順番
PAGES = {
    2: {"run": "D-p2-20261102-185043", "human_page": 2, "floor": "2F",
        "hits": {"H12": [1], "H10": [6]}, "targets": ["H01", "H10", "H11", "H12"], "near": {}},
    3: {"run": "D-p3-20261102-185959", "human_page": 3, "floor": "3F",
        "hits": {"P302": [11], "P305": [5]}, "targets": ["P302", "P305"], "near": {"P303": [8], "P304": [8]}},
    6: {"run": "D-p6-20261104-082646-22640", "human_page": 4, "floor": "RF",
        "hits": {"R405": [2], "R406": [3]}, "targets": ["R405", "R406"], "near": {}},
}
# 人の朱書きの位置（スキャンのページに対する 0〜1。目で読んだ値）
HUMAN_REGIONS = {
    "H01": (0.56, 0.85, 0.93, 0.92), "H02": (0.2, 0.02, 0.36, 0.36), "H03": (0.125, 0.34, 0.175, 0.62),
    "H04": (0.2, 0.71, 0.66, 0.8), "H05": (0.38, 0.65, 0.58, 0.79), "H06": (0.38, 0.09, 0.5, 0.16),
    "H07": (0.73, 0.7, 0.92, 0.87), "H08": (0.22, 0.7, 0.7, 0.76), "H09": (0.31, 0.6, 0.6, 0.7),
    "H10": (0.75, 0.09, 0.98, 0.11), "H11": (0.18, 0.33, 0.22, 0.36), "H12": (0.75, 0.64, 0.92, 0.69),
    "H13": (0.58, 0.88, 0.93, 0.93), "H14": (0.42, 0.24, 0.46, 0.29), "H15": (0.49, 0.07, 0.57, 0.09),
    "H16": (0.75, 0.37, 0.98, 0.39),
    "P301": (0.25, 0.12, 0.33, 0.33), "P302": (0.2, 0.05, 0.28, 0.27), "P303": (0.13, 0.33, 0.175, 0.6),
    "P304": (0.22, 0.71, 0.66, 0.78), "P305": (0.37, 0.82, 0.46, 0.875), "P306": (0.22, 0.68, 0.72, 0.74),
    "P307": (0.42, 0.22, 0.46, 0.27),
}
HUMAN_FILES = {2: PRIVATE / "check-runs/steel-20261102-182033/human-p2.json", 3: ROOT / "human-p3.json", 6: ROOT / "human-p6.json"}
# AIが返した範囲を目で見て直したもの（スクリーンショットで確認。画面にも補正と出す）
REGION_FIXES = {
    "p2-03": (0.01, 0.944, 0.15, 0.958),  # 1行上の「鉄骨柱」に掛かっていた。指摘は「大梁」の行
    "p2-08": (0.34, 0.6, 0.58, 0.64),  # X3 側だけだった。指摘は X3 と X7 の両方
}
PLAN_FLOORS = {2: "2F", 3: "3F", 6: "RF", 7: "PHRF"}
# 伏図の柱部材リストは、その階の下の柱を載せている
COLUMN_PLANS = {"1F": [1, 2], "2F": [3], "3F": [6], "RF": [7]}


def to_rect(page, box):
    return pymupdf.Rect(box[0] * page.rect.width, box[1] * page.rect.height,
                        box[2] * page.rect.width, box[3] * page.rect.height)


def apply_masks(pix, zoom, masks):
    """Pixmap の座標は切り抜きの左上が (pix.x, pix.y)"""
    for rect in masks:
        mask = pymupdf.IRect(int(rect.x0 * zoom), int(rect.y0 * zoom), int(rect.x1 * zoom) + 1, int(rect.y1 * zoom) + 1)
        mask &= pymupdf.IRect(pix.x, pix.y, pix.x + pix.width, pix.y + pix.height)
        if not mask.is_empty:
            pix.set_rect(mask, MASK_COLOR)


def sheet_masks(page):
    return [to_rect(page, box) for box in MASKS]


def crop(page, region, masks, path, frame=None):
    """region の周りを切り抜いて保存する。frame があれば赤枠を付ける"""
    clip = (pymupdf.Rect(region) + (-MARGIN, -MARGIN, MARGIN, MARGIN)) & page.rect
    zoom = CROP_DPI / 72
    if frame:
        page.draw_rect(frame + (-3, -3, 3, 3), color=RED, width=2.2)
    pix = page.get_pixmap(matrix=pymupdf.Matrix(zoom, zoom), clip=clip, colorspace=pymupdf.csRGB, alpha=False)
    apply_masks(pix, zoom, masks)
    path.parent.mkdir(parents=True, exist_ok=True)
    pix.save(path)


def single_page(document, page_no):
    copy = pymupdf.open()
    copy.insert_pdf(document, from_page=page_no - 1, to_page=page_no - 1)
    return copy, copy[0]


def scan_transform(sheet, scan):
    """施工図の座標 → スキャンの座標"""
    result = register(sheet, scan)
    return lambda r: pymupdf.Rect(r.x0 * result["scale"] + result["dx"], r.y0 * result["scale"] + result["dy"],
                                  r.x1 * result["scale"] + result["dx"], r.y1 * result["scale"] + result["dy"])


def inverse(transform):
    origin, unit = transform(pymupdf.Rect(0, 0, 0, 0)), transform(pymupdf.Rect(1, 1, 1, 1))
    scale, dx, dy = unit.x0 - origin.x0, origin.x0, origin.y0
    return lambda r: pymupdf.Rect((r.x0 - dx) / scale, (r.y0 - dy) / scale, (r.x1 - dx) / scale, (r.y1 - dy) / scale)


def valid_region(region):
    x0, y0, x1, y1 = [min(1, max(0, float(v))) for v in region]
    return (min(x0, x1), min(y0, y1), max(x0, x1), max(y0, y1))


def box_of(page, rect):
    return [round(rect.x0 / page.rect.width, 4), round(rect.y0 / page.rect.height, 4),
            round(rect.x1 / page.rect.width, 4), round(rect.y1 / page.rect.height, 4)]


def model_refs(finding, floor, members):
    """符号と通りから3Dの部材を決める。通りの指定があれば、その通りの部材だけにする"""
    tokens = set(re.findall(r"[XY]\d", " ".join(finding["grids"])))
    refs = []
    for member in members:
        if member["floor"] != floor or member["mark"] not in finding["marks"]:
            continue
        if tokens and not tokens & set(re.findall(r"[XY]\d", member["grid"])):
            continue
        refs.append(f"{member['type']}|{member['floor']}|{member['grid']}")
    return refs


def publish_page(sheet_no, config, sheet_doc, human_doc, members):
    result = json.loads((ROOT / config["run"] / "result.json").read_text())
    _, sheet = single_page(sheet_doc, sheet_no)
    _, scan = single_page(human_doc, config["human_page"])
    to_scan = scan_transform(sheet, scan)
    scan_masks = [to_scan(rect) for rect in sheet_masks(sheet)]
    findings = []
    for number, item in enumerate(result["findings"], 1):
        finding_id = f"p{sheet_no}-{number:02d}"
        fixed = REGION_FIXES.get(finding_id)
        region = to_rect(sheet, fixed or valid_region(item["region"]))
        _, marked = single_page(sheet_doc, sheet_no)
        marked = marked
        crop(marked, region, sheet_masks(marked), OUT / f"findings/{finding_id}.png", frame=region)
        crop(scan, to_scan(region), scan_masks, OUT / f"human/{finding_id}.png")
        sources = "、".join(f"{e['drawing']} {e['page']}" for e in item.get("evidence", []))
        # 図面全体の表示でも文字に枠線が掛からないように、切り抜きの赤枠と同じだけ広げる
        box = box_of(sheet, (region + (-3, -3, 3, 3)) & sheet.rect)
        findings.append({
            "id": finding_id,
            "severity": item["severity"],
            "category": item["category"],
            "title": item["title"],
            "content": item["content"] + (f"（根拠：{sources}）" if sources else ""),
            "drawing": {"doc": DOC, "page": sheet_no, "bbox": box, "sheet": f"s{sheet_no:02d}"},
            "members": {"grids": item["grids"], "marks": item["marks"], "floor": config["floor"]},
            "model_refs": model_refs(item, config["floor"], members),
            "source": "ai",
            "key_ids": [],
            "planted": False,
            "evidence": [{
                "doc": DOC, "page": sheet_no, "where": f"p.{sheet_no} の該当箇所" + ("、枠の位置は目で見て補正" if fixed else ""), "text": "",
                "bbox": box, "image": f"findings/{finding_id}.png",
            }],
            "human_view": {"image": f"human/{finding_id}.png", "note": f"人のチェック図 p.{config['human_page']} の同じ範囲"},
        })
    return findings, human_items(sheet_no, config, sheet, scan, to_scan, scan_masks)


def human_items(sheet_no, config, sheet, scan, to_scan, scan_masks):
    source = json.loads(HUMAN_FILES[sheet_no].read_text())
    to_sheet = inverse(to_scan)
    title = {2: "2SL 梁伏図", 3: "3SL 梁伏図", 6: "RSL 梁伏図"}[sheet_no]
    items = []
    for item in source["items"]:
        region = item.get("region") or HUMAN_REGIONS[item["id"]]
        scan_rect = to_rect(scan, region)
        sheet_rect = to_sheet(scan_rect) & sheet.rect
        crop(scan, scan_rect, scan_masks, OUT / f"human/{item['id']}.png")
        crop(sheet, sheet_rect, sheet_masks(sheet), OUT / f"human/{item['id']}-before.png")
        numbers = config["hits"].get(item["id"], [])
        near = config["near"].get(item["id"], [])
        if numbers:
            summary = "AIも同じ問題を指摘しました。"
        elif near:
            summary = "AIは近い内容を指摘しました（採点の対象外）。"
        elif item["id"] in config["targets"]:
            summary = "図面の照合で判断できるはずですが、AIは見逃しました。"
        else:
            summary = "打合せや製作上の判断など、図面の照合だけでは判断しにくい朱書きです。"
        items.append({
            "id": item["id"],
            "drawing": f"{title}：{item['kind']}",
            "note": item["text"],
            "summary": summary,
            "key_id": None,
            "image": f"human/{item['id']}.png",
            "finding_ids": [f"p{sheet_no}-{n:02d}" for n in [*numbers, *near]],
            "ai_image": f"human/{item['id']}-before.png",
            "sheet": f"s{sheet_no:02d}",
            "bbox": box_of(sheet, sheet_rect),
        })
    return items


def publish_sheets(sheet_doc, model):
    sheets, indexes = [], {}
    zoom = SHEET_DPI / 72
    for page in sheet_doc:
        number = page.number + 1
        index = json.loads((ROOT / f"sheet-index/p{number}/result.json").read_text())
        indexes[number] = index
        pix = page.get_pixmap(matrix=pymupdf.Matrix(zoom, zoom), colorspace=pymupdf.csGRAY, alpha=False)
        apply_masks(pix, zoom, sheet_masks(page))
        path = OUT / f"sheets/p{number:02d}.png"
        path.parent.mkdir(parents=True, exist_ok=True)
        pix.save(path)
        sheets.append({
            "id": f"s{number:02d}", "doc": DOC, "page": number,
            "title": index["title"].replace("¯", "〜").replace("~", "〜"),
            "image": f"sheets/p{number:02d}.png", "width": pix.width, "height": pix.height,
        })
    return sheets, indexes


def member_box(member, transform, page):
    kx, ox, ky, oy = transform
    if member["type"] == "column":
        x0 = x1 = member["x"]
        y0 = y1 = member["y"]
    else:
        x0, x1 = member["x0"], member["x1"]
        y0, y1 = member["y0"], member["y1"]
    rect = pymupdf.Rect(min(x0, x1) * kx + ox - 9, min(y0, y1) * ky + oy - 9,
                        max(x0, x1) * kx + ox + 9, max(y0, y1) * ky + oy + 9)
    rect.normalize()
    return box_of(page, rect)


def member_sheets(sheet_doc, indexes, model):
    transforms = {n: plan_transform(sheet_doc[n - 1], model["grid_x"], model["grid_y"]) for n in (1, 2, 3, 6, 7)}
    table = {}
    for member in model["members"]:
        key = f"{member['type']}|{member['floor']}|{member['grid']}"
        lines = set(re.findall(r"[XY]\d", member["grid"])) if member["type"] == "column" else {member["grid"].split("/")[0]}
        refs = []
        if member["floor"] == "基礎":
            table[key] = refs
            continue
        plans = COLUMN_PLANS.get(member["floor"], []) if member["type"] == "column" else \
            [n for n, floor in PLAN_FLOORS.items() if floor == member["floor"]]
        for number in plans:
            page = sheet_doc[number - 1]
            refs.append({"sheet": f"s{number:02d}", "reason": f"{member['grid']} の {member['mark']}（平面の位置に赤枠）",
                         "bbox": member_box(member, transforms[number], page)})
        for number, index in indexes.items():
            for frame in index["frames"]:
                line = frame["grid_line"]
                if index["kind"] == "軸組図" and line in lines:
                    refs.append({"sheet": f"s{number:02d}", "reason": f"{line} 通りの軸組図", "bbox": frame["region"]})
                elif index["kind"] == "継手基準図" and member["mark"] in frame["marks"]:
                    refs.append({"sheet": f"s{number:02d}", "reason": f"{member['mark']} の継手", "bbox": frame["region"]})
                elif index["kind"] in ("受け材", "その他", "手摺") and line in lines and member["mark"] in frame["marks"]:
                    refs.append({"sheet": f"s{number:02d}", "reason": f"{line} 通りの{index['kind']}に {member['mark']} が出ています", "bbox": frame["region"]})
        table[key] = refs
    return table


def main():
    config = json.loads((ROOT / "config.json").read_text())
    sheet_doc = pymupdf.open(config["sheet"])
    human_doc = pymupdf.open(config["human"])
    model = json.loads((OUT / "model.json").read_text())
    for name in ("findings", "human", "sheets"):
        if (OUT / name).exists():
            shutil.rmtree(OUT / name)

    sheets, indexes = publish_sheets(sheet_doc, model)
    write_json(OUT / "sheets.json", {
        "sheets": sheets,
        "member_sheets": member_sheets(sheet_doc, indexes, model),
        "empty_note": "基礎の部材の施工図はまだ取り込んでいません（取り込み済みは鉄骨施工図のみ）。",
    })
    findings, items = [], []
    for sheet_no, page_config in PAGES.items():
        page_findings, page_items = publish_page(sheet_no, page_config, sheet_doc, human_doc, model["members"])
        findings += page_findings
        items += page_items
    write_json(OUT / "check-result.json", {
        "mode": "Claude（照合の手順あり：物件Bの標準の判定方法）。2SL・3SL・RSL の梁伏図を各ページ1回判定した結果です。AIは人の朱書きを見ていません。",
        "findings": findings,
        "changes": [],
    })
    write_json(OUT / "human-compare.json", {"items": items})
    size = sum(p.stat().st_size for p in OUT.rglob("*.png")) / 1e6
    print(f"ページ {len(sheets)}、指摘 {len(findings)}、人の朱書き {len(items)}、画像 {size:.1f}MB")


if __name__ == "__main__":
    main()
