"""実図面でのチェック結果を、公開してよい形に変換して demo-data に書き出す。

- 文章の数値は ~/sekozu-data/dummy_map.json でダミー値に置き換える。表にない数値があれば止める
- 図面は根拠の周辺だけを切り抜く。図面枠は含めず、表にない数値は塗りつぶす
- 実名の混入は check_public.py で確認する
"""
import json
import re
import shutil

import pymupdf

from common import DEMO, DOCS, PRIVATE, RUNS, write_json
from evaluate import matches

MAP = json.loads((PRIVATE / "dummy_map.json").read_text())["numbers"]
OUT_DIR = DEMO / "findings"
RED = (0.78, 0.21, 0.11)
DPI = 200
NUMBER = re.compile(r"\d[\d,]*(?:\.\d+)?")
# 符号・通り芯・杭番号に含まれる数字はそのまま残す
KEEP_TOKEN = re.compile(
    r"^(?:[XY]\d|No[.,]?\d+|P\d|F\d\w*|FG\d+\w*|FB\d+\w*|FC[GB]\d+|FS\d+|B\d+\w*|C\d\w*|CS\d+|S\d+|EW?\d+|W\d+\w*"
    r"|1[CS]L|[①-⑳].*)$"
)
# 現場の確認が取れるまで「要確認」にする分類
NEEDS_CONFIRMATION = {"レベル"}


# AIの文章に混ざる内部の図面IDを、呼び名に置き換える
DOC_ID = re.compile(r"(kui_new|kui_old|kiso_fuse|kiso_danmen|kozo)( p\d+)?\s*")


def plain_doc_names(text: str) -> str:
    return DOC_ID.sub(lambda m: "" if m[2] else DOCS[m[1]]["name"], text)


def dummy_text(text: str) -> str:
    """文章の数値を置き換える。公開してよいか判断できない数値は止める"""
    text = plain_doc_names(text)

    def replace(match):
        token = match[0]
        start = match.start()
        before = text[start - 1] if start else ""
        # 符号（X3、P5、No.11 など）の数字と、100 未満の数（本数・順番）はそのまま
        if before and (before.isalpha() or before in "./／"):
            return token
        if to_int(token) < 100:
            return token
        if token in MAP:
            return MAP[token]
        raise SystemExit(f"dummy_map.json にない数値です: {token}（{text[:40]}…）")

    return NUMBER.sub(replace, text)


def to_int(token: str) -> int:
    return int(re.sub(r"\D", "", token.split(".")[0]) or 0)


def dummy_token(token: str):
    """図面上の単語。置き換えた文字列、またはそのままなら token、塗りつぶすなら None"""
    if KEEP_TOKEN.match(token) or not re.search(r"\d", token):
        return token
    level = re.match(r"(.*?1[CS]L)(.*)$", token)
    if level:
        rest = dummy_token(level[2]) if re.search(r"\d", level[2]) else level[2]
        return None if rest is None else level[1] + rest
    pieces = NUMBER.split(token)
    numbers = NUMBER.findall(token)
    out = pieces[0]
    for number, rest in zip(numbers, pieces[1:]):
        if to_int(number) < 100 and "." not in number and not token[0].isdigit():
            out += number
        elif number in MAP:
            out += MAP[number]
        else:
            return None
        out += rest
    return out


def crop_clip(page, bbox):
    w, h = page.rect.width, page.rect.height
    wide = bbox[2] - bbox[0] > 0.2 or bbox[3] - bbox[1] > 0.2
    margin = 14 if wide else 70
    rect = pymupdf.Rect(bbox[0] * w, bbox[1] * h, bbox[2] * w, bbox[3] * h)
    clip = pymupdf.Rect(rect.x0 - margin, rect.y0 - margin, rect.x1 + margin, rect.y1 + margin)
    clip &= page.rect
    # 図面枠は下端にある。切り抜きに入れない
    clip.y1 = min(clip.y1, h * 0.91)
    return rect, clip


def draw_text(page, origin, text, size, vertical):
    """Φ などの記号は helv にないので、英数字と分けて描く"""
    if vertical:
        font = "helv" if text.isascii() else "japan"
        page.insert_text(origin, text, fontname=font, fontsize=size, rotate=90)
        return
    x, y = origin
    for run in re.findall(r"[ -~]+|[^ -~]+", text):
        font = "helv" if run.isascii() else "japan"
        page.insert_text((x, y), run, fontname=font, fontsize=size)
        x += pymupdf.get_text_length(run, fontname=font, fontsize=size)


def render_evidence(ev, name):
    """根拠の周辺を切り抜き、数値を処理して、赤枠を付けた PNG にする"""
    source = pymupdf.open(DOCS[ev["doc"]]["path"])
    doc = pymupdf.open()
    doc.insert_pdf(source, from_page=ev["page"] - 1, to_page=ev["page"] - 1)
    page = doc[0]
    rect, clip = crop_clip(page, ev["bbox"])

    inserts = []
    for x0, y0, x1, y1, token, *_ in page.get_text("words", clip=clip):
        replacement = dummy_token(token)
        if replacement == token:
            continue
        word = pymupdf.Rect(x0, y0, x1, y1)
        page.add_redact_annot(word, fill=(1, 1, 1))
        if replacement is not None:
            inserts.append((word, replacement))
    page.apply_redactions(graphics=pymupdf.PDF_REDACT_LINE_ART_NONE)
    for word, text in inserts:
        vertical = word.height > word.width * 1.5
        size = min(word.width, word.height) * 0.9
        origin = (word.x1 - size * 0.15, word.y1) if vertical else (word.x0, word.y1 - size * 0.15)
        draw_text(page, origin, text, size, vertical)
    page.draw_rect(rect + (-8, -8, 8, 8), color=RED, width=2.0)

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    path = OUT_DIR / name
    page.get_pixmap(dpi=DPI, clip=clip).save(path)
    return f"findings/{name}"


def render_order_table(changes, name):
    """画像PDFの一覧表は塗りつぶせないので、打設順だけの表を作り直す"""
    rows = sorted(changes, key=lambda c: c["no"])
    doc = pymupdf.open()
    page = doc.new_page(width=340, height=44 + 24 * len(rows))
    heads = [("杭番号", 20), ("通り芯", 90), ("一覧表（変更前）", 160), ("平面図（変更後）", 255)]
    for text, x in heads:
        page.insert_text((x, 26), text, fontname="japan", fontsize=10)
    page.draw_line((14, 34), (326, 34))
    for i, row in enumerate(rows):
        y = 54 + 24 * i
        page.insert_text((20, y), f"No.{row['no']}", fontname="helv", fontsize=11)
        page.insert_text((90, y), row["grid"], fontname="helv", fontsize=11)
        page.insert_text((190, y), str(row["before"]), fontname="helv", fontsize=11)
        page.insert_text((285, y), str(row["after"]), fontname="helv", fontsize=11, color=RED)
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    page.get_pixmap(dpi=DPI).save(OUT_DIR / name)
    return f"findings/{name}"


def model_refs(finding):
    """AIの指摘には3Dの部材がないので、内容から該当部材を決める"""
    if finding.get("model_refs"):
        return finding["model_refs"]
    text = finding["title"] + finding["content"]
    if "TC" in text:
        return ["pile|基礎|TC", "slab|基礎|TC基礎"]
    grids = finding["members"].get("grids", [])
    # 区画で示された指摘は、その区画のスラブを光らせる
    refs = [f"slab|基礎|{g}" for g in grids if re.fullmatch(r"X\d-X\d/Y\d-Y\d", g)]
    return refs + [f"pile|基礎|{g}" for g in grids if re.fullmatch(r"X\d-Y\d", g)]


def key_ids(finding):
    """正解のどの項目に当たるか（AIと人の比較画面で使う）"""
    key = json.loads((DEMO / "answer-key.json").read_text())
    return [e["id"] for e in key["entries"] if e["kind"] in ("real", "planted") and matches(e, finding)]


def publish_finding(finding, changes):
    evidence = []
    for i, ev in enumerate(finding["evidence"], 1):
        name = f"{finding['id']}-{i}.png"
        if ev["doc"] == "kui_old":
            image = render_order_table(changes, name)
            note = "元の表は画像PDFのため、打設順だけを表に作り直しています"
        else:
            image = render_evidence(ev, name)
            note = None
        evidence.append({
            "doc": ev["doc_name"],
            "page": ev["page"],
            "where": plain_doc_names(ev["where"]),
            "text": dummy_text(ev["text"]),
            "bbox": ev["bbox"],
            "image": image,
            **({"note": note} if note else {}),
        })
    confirmed = finding.get("confirmed", False)
    severity = finding["severity"]
    if finding["category"] in NEEDS_CONFIRMATION and not confirmed:
        severity = "要確認"
    return {
        "id": finding["id"],
        "severity": severity,
        "category": finding["category"],
        "title": dummy_text(finding["title"]),
        "content": dummy_text(finding["content"]),
        "drawing": {"doc": evidence[0]["doc"], "page": evidence[0]["page"], "bbox": evidence[0]["bbox"]},
        "members": finding["members"],
        "model_refs": model_refs(finding),
        "source": finding["source"],
        "key_ids": key_ids(finding),
        "planted": "P1" in key_ids(finding),
        "evidence": evidence,
    }


def main():
    source = RUNS / "latest.json"
    if not source.exists():
        source = RUNS / "program.json"
    run = json.loads(source.read_text())
    if OUT_DIR.exists():
        shutil.rmtree(OUT_DIR)
    findings = [publish_finding(f, run["changes"]) for f in run["findings"]]
    write_json(DEMO / "check-result.json", {
        "mode": "プログラム照合＋Claude" if source.name == "latest.json" else "プログラム照合のみ（Claude未実行）",
        "findings": findings,
        "changes": run["changes"],
    })
    print(f"{source.name} → {len(findings)} 件を公開用に変換しました")


if __name__ == "__main__":
    main()
