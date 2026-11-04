"""施工図PDFの上に朱書きを重ね、最後に一覧のページを付ける。

元の図面は書き換えない。朱書きは別の層（PDFのレイヤー）として重ねるので、
PDFビューアで層を消すと元の図面に戻る。

指摘の形（1件）:
  number, source_type, page（1始まり）, regions（ページに対する 0〜1 の範囲のリスト）,
  comment, title, content, evidence（[{drawing, page, where}]）, needs_confirmation

色は指摘の種類で決める。種類を足すときは SOURCE_TYPES に足す。
"""
import io
import os
from pathlib import Path

import numpy as np
import pymupdf
from fontTools import subset
from fontTools.ttLib import TTCollection, TTFont

from merge_findings import merged_note

RED = (0.8, 0.1, 0.1)
BLUE = (0.05, 0.3, 0.8)
SOURCE_TYPES = {
    "design": {"label": "設計図書", "color": RED},
    "minutes": {"label": "議事録", "color": RED},
    "knowledge": {"label": "ナレッジ", "color": BLUE},
}
FONT_FILES = [
    os.environ.get("SEKOZU_FONT", ""),
    "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc",
    "/usr/share/fonts/noto-cjk/NotoSansCJK-Regular.ttc",
]
FONT_NAME = "skjp"
NOTICE = "AIが挙げた確認候補です。確定する前に人が確認してください。"
LEGEND_TITLE = "凡例"
# A3 の図面での文字の大きさ。ページの大きさに合わせて変える
BASE_WIDTH = 1191
COMMENT_SIZE = 8.5
COMMENT_WIDTH = 165
MAX_COMMENT_CHARS = 60


def build_font(text):
    """使う文字だけの日本語フォントを作る。全文字を埋め込むと1ファイル10MB以上になる"""
    path = next((p for p in FONT_FILES if p and Path(p).exists()), None)
    if path is None:
        raise RuntimeError("日本語フォントが見つかりません。SEKOZU_FONT にフォントのパスを指定してください")
    font = TTCollection(path).fonts[0] if path.endswith((".ttc", ".otc")) else TTFont(path)
    options = subset.Options()
    options.layout_features = []
    options.notdef_outline = True
    # 文字番号を変えない。変えると PDF の中の文字が別の字や空白になる
    options.retain_gids = True
    subsetter = subset.Subsetter(options)
    subsetter.populate(text="".join(sorted(set(text))) + " ")
    subsetter.subset(font)
    buffer = io.BytesIO()
    font.save(buffer)
    return buffer.getvalue()


# 行の頭に来ないようにする文字
NO_LINE_START = "、。，．）」』】〕？！・ー"


def wrap(text, font, size, width):
    lines, line = [], ""
    for char in text:
        if char == "\n":
            lines.append(line)
            line = ""
        elif font.text_length(line + char, fontsize=size) > width and char not in NO_LINE_START:
            lines.append(line)
            line = char
        else:
            line += char
    if line:
        lines.append(line)
    return lines or [""]


def to_rect(page, box):
    width, height = page.rect.width, page.rect.height
    return pymupdf.Rect(box[0] * width, box[1] * height, box[2] * width, box[3] * height)


def valid_regions(regions):
    """読めない範囲を落とす。小さすぎる枠は見えないので広げる"""
    boxes = []
    for region in regions or []:
        if len(region) != 4:
            continue
        x0, y0, x1, y1 = [min(1.0, max(0.0, float(v))) for v in region]
        x0, x1 = min(x0, x1), max(x0, x1)
        y0, y1 = min(y0, y1), max(y0, y1)
        if x1 - x0 < 0.012:
            x0, x1 = max(0, (x0 + x1) / 2 - 0.006), min(1, (x0 + x1) / 2 + 0.006)
        if y1 - y0 < 0.012:
            y0, y1 = max(0, (y0 + y1) / 2 - 0.006), min(1, (y0 + y1) / 2 + 0.006)
        boxes.append([round(v, 4) for v in (x0, y0, x1, y1)])
    return boxes


class Canvas:
    """表示の向きの座標で描く。回転したページでは、元の向きの座標に直して重ねる"""

    def __init__(self, page, layer):
        self.page = page
        self.layer = layer
        self.matrix = page.derotation_matrix
        self.shape = page.new_shape()

    def _rect(self, rect):
        return pymupdf.Rect(pymupdf.Point(rect.x0, rect.y0) * self.matrix, pymupdf.Point(rect.x1, rect.y1) * self.matrix).normalize()

    def rect(self, rect, color=None, fill=None, width=1.0, opacity=1.0):
        self.shape.draw_rect(self._rect(rect))
        self.shape.finish(color=color, fill=fill, width=width, fill_opacity=opacity, oc=self.layer)

    def line(self, a, b, color, width=0.7):
        self.shape.draw_line(pymupdf.Point(a) * self.matrix, pymupdf.Point(b) * self.matrix)
        self.shape.finish(color=color, width=width, oc=self.layer)

    def text(self, point, text, size, color=(0, 0, 0)):
        self.shape.insert_text(pymupdf.Point(point) * self.matrix, text, fontname=FONT_NAME, fontsize=size,
                               color=color, rotate=self.page.rotation, oc=self.layer)

    def commit(self):
        self.shape.commit(overlay=True)


def ink_map(page):
    """図面の線の多さ。コメントを線の少ない場所に置くために使う"""
    pix = page.get_pixmap(matrix=pymupdf.Matrix(0.5, 0.5), colorspace=pymupdf.csGRAY, alpha=False)
    gray = np.frombuffer(pix.samples, dtype=np.uint8).reshape(pix.h, pix.w)
    return np.cumsum(np.cumsum((gray < 200).astype(np.int64), axis=0), axis=1)


def ink_in(table, rect):
    x0, y0 = max(0, int(rect.x0 * 0.5)), max(0, int(rect.y0 * 0.5))
    x1, y1 = min(table.shape[1] - 1, int(rect.x1 * 0.5)), min(table.shape[0] - 1, int(rect.y1 * 0.5))
    if x1 <= x0 or y1 <= y0:
        return 0
    return int(table[y1, x1] - table[y0, x1] - table[y1, x0] + table[y0, x0])


def overlap(a, b):
    box = pymupdf.Rect(a) & pymupdf.Rect(b)
    return 0 if box.is_empty else box.width * box.height


def place_comment(page, frame, size, ink, taken, frames):
    """枠の近くで、線が少なく、ほかの朱書きと重ならない場所を探す"""
    width, height = size
    W, H = page.rect.width, page.rect.height
    gap = 6
    centers = []
    for dy in (0, -50, 50, -110, 110):
        centers += [(frame.x1 + gap, frame.y0 + dy), (frame.x0 - gap - width, frame.y0 + dy)]
    for dx in (0, -80, 80, -180, 180):
        centers += [(frame.x0 + dx, frame.y0 - gap - height), (frame.x0 + dx, frame.y1 + gap)]
    for dx, dy in ((70, -70), (-70, -70), (70, 70), (-70, 70), (150, 0), (-150, 0), (0, -150), (0, 150)):
        centers += [(frame.x1 + dx, frame.y0 + dy), (frame.x0 + dx - width, frame.y0 + dy)]
    best, best_score = None, None
    for index, (x, y) in enumerate(centers):
        x = min(max(4, x), W - width - 4)
        y = min(max(4, y), H - height - 4)
        rect = pymupdf.Rect(x, y, x + width, y + height)
        score = ink_in(ink, rect) * 2 + index * 0.5
        score += sum(overlap(rect, other) for other in taken) * 40
        score += sum(overlap(rect, other) for other in frames) * 0.6
        if best_score is None or score < best_score:
            best, best_score = rect, score
    return best


def tag_spots(page, frame, width, height):
    """番号を置く候補。枠の上の辺、下の辺、左の辺、右の辺に沿って順に並べる"""
    W, H = page.rect.width, page.rect.height
    xs = [frame.x0 + step * (width + 1) for step in range(int(max(frame.width, width) / (width + 1)))] or [frame.x0]
    ys = [frame.y0 + step * (height + 1) for step in range(int(max(frame.height, height) / (height + 1)))] or [frame.y0]
    spots = [(x, frame.y0 - height) for x in xs] + [(x, frame.y1) for x in xs]
    spots += [(frame.x0 - width, y) for y in ys] + [(frame.x1, y) for y in ys]
    spots.append((frame.x0, frame.y0))
    return [pymupdf.Rect(x, y, x + width, y + height) for x, y in spots if x >= 0 and y >= 0 and x + width <= W and y + height <= H]


def place_tag(page, frame, number, scale, font, taken):
    """枠の番号の場所。ほかの番号やコメントに隠れない場所を、枠の辺に沿って探す"""
    size = 8.5 * scale
    label = str(number)
    width = font.text_length(label, fontsize=size) + 5 * scale
    height = size + 3 * scale
    spots = tag_spots(page, frame, width, height) or [pymupdf.Rect(frame.x0, frame.y0, frame.x0 + width, frame.y0 + height)]
    return min(spots, key=lambda spot: sum(overlap(spot, other) for other in taken) > 0)


def draw_tag(canvas, tag, number, color, scale):
    canvas.rect(tag, color=color, fill=color)
    canvas.text((tag.x0 + 2.5 * scale, tag.y1 - 2.2 * scale), str(number), 8.5 * scale, (1, 1, 1))


def draw_legend(page, layer, font):
    canvas = Canvas(page, layer)
    scale = page.rect.width / BASE_WIDTH
    size = 7.5 * scale
    x, y = 8 * scale, 8 * scale
    width, height = 240 * scale, 39 * scale
    canvas.rect(pymupdf.Rect(x, y, x + width, y + height), color=(0.4, 0.4, 0.4), fill=(1, 1, 1), width=0.5, opacity=0.9)
    line = y + 11 * scale
    canvas.text((x + 5 * scale, line), f"{LEGEND_TITLE}（番号は最後の一覧ページと対応）", size)
    line += 12 * scale
    canvas.rect(pymupdf.Rect(x + 5 * scale, line - 7 * scale, x + 15 * scale, line), color=RED, width=1.2)
    canvas.text((x + 18 * scale, line), "赤：設計図書・議事録との矛盾", size, RED)
    canvas.rect(pymupdf.Rect(x + 136 * scale, line - 7 * scale, x + 146 * scale, line), color=BLUE, width=1.2)
    canvas.text((x + 149 * scale, line), "青：ナレッジ", size, BLUE)
    line += 11 * scale
    canvas.text((x + 5 * scale, line), NOTICE, size * 0.92, (0.25, 0.25, 0.25))
    canvas.commit()


def mark_page(doc, page, items, layers, font, font_buffer, legend_layer):
    scale = page.rect.width / BASE_WIDTH
    ink = ink_map(page)
    page.insert_font(fontname=FONT_NAME, fontbuffer=font_buffer)
    frames = [to_rect(page, box) for item in items for box in item["regions"]]
    taken = [pymupdf.Rect(0, 0, 255 * scale, 55 * scale)]
    drawn = set()
    tags = []
    for item in items:
        if item["number"] in drawn:
            continue
        # まとめた指摘は1組で描く。赤を先にする
        numbers = item.get("merged_numbers", [item["number"]])
        group = sorted((other for other in items if other["number"] in numbers), key=lambda other: other["source_type"] == "knowledge")
        drawn.update(numbers)
        draw_group(page, group, layers, font, scale, ink, taken, frames, tags)
    # 番号は最後に描く。あとから描く枠の線が数字にかからないようにする
    for tag, number, source_type in tags:
        canvas = Canvas(page, layers[source_type])
        draw_tag(canvas, tag, number, SOURCE_TYPES[source_type]["color"], scale)
        canvas.commit()
    draw_legend(page, legend_layer, font)


def draw_group(page, group, layers, font, scale, ink, taken, frames, tags):
    """1つの枠と1つのコメントを描く。色ごとに自分の層に描くので、層を消すとその色の枠と番号と文だけが消える"""
    canvases = [Canvas(page, layers[item["source_type"]]) for item in group]
    colors = [SOURCE_TYPES[item["source_type"]]["color"] for item in group]
    rects = [to_rect(page, box) for box in group[0]["regions"]]
    outer = 2.2 * scale * (len(group) - 1)
    for rect in rects:
        for index, (item, canvas, color) in enumerate(zip(group, canvases, colors)):
            # 2色の枠は、内側に赤、外側に青を沿わせて1つの枠に見せる
            outset = index * 2.2 * scale
            canvas.rect(rect + (-outset, -outset, outset, outset), color=color, width=1.6 * scale)
            tag = place_tag(page, rect + (-outer, -outer, outer, outer), item["number"], scale, font, taken)
            taken.append(tag)
            tags.append((tag, item["number"], item["source_type"]))
    size = COMMENT_SIZE * scale
    blocks = []
    for item in group:
        comment = (item["comment"] or item["title"])[:MAX_COMMENT_CHARS]
        if item.get("needs_confirmation"):
            comment = f"[要確認] {comment}"
        blocks.append(wrap(f"{item['number']}. {comment}", font, size, COMMENT_WIDTH * scale - 8 * scale))
    widest = max(font.text_length(line, fontsize=size) for lines in blocks for line in lines)
    line_count = sum(len(lines) for lines in blocks)
    box_size = (widest + 8 * scale, line_count * size * 1.3 + 6 * scale)
    # 枠がない指摘は、ページの左上の凡例の下から順に置く
    anchor = rects[0] if rects else pymupdf.Rect(10 * scale, 60 * scale, 10 * scale, 60 * scale)
    box = place_comment(page, anchor, box_size, ink, taken, frames)
    taken.append(box)
    if rects:
        start = pymupdf.Point(min(max(anchor.x0, box.x0), box.x1), min(max(anchor.y0, box.y0), box.y1))
        end = pymupdf.Point(min(max(box.x0, anchor.x0), anchor.x1), min(max(box.y0, anchor.y0), anchor.y1))
        if abs(start - end) > 4:
            canvases[0].line(start, end, colors[0], 0.7 * scale)
    y = box.y0 + 3 * scale + size
    for index, (lines, canvas, color) in enumerate(zip(blocks, canvases, colors)):
        # 白い地は最初の色だけに付ける。あとから塗ると先の文字が隠れる
        canvas.rect(box, color=color, fill=(1, 1, 1) if index == 0 else None, width=0.8 * scale, opacity=0.93 if index == 0 else 1.0)
        for line in lines:
            canvas.text((box.x0 + 4 * scale, y), line, size, color)
            y += size * 1.3
    for canvas in canvases:
        canvas.commit()


class ListPages:
    """最後の一覧ページ。A3 の図面でも A4 横で印刷できる大きさにする"""
    WIDTH, HEIGHT = 842, 595
    MARGIN = 28
    COLUMNS = [("番号", 30), ("種類", 50), ("図面", 34), ("内容", 395), ("根拠の図面とページ", 225), ("要確認", 42)]
    RESULT_COLUMNS = [("項目", 34), ("内容", 326), ("結果", 130), ("ページ", 40), ("理由", 256)]
    SIZE = 8

    def __init__(self, doc, font, font_buffer, title):
        self.doc, self.font, self.font_buffer, self.title = doc, font, font_buffer, title
        self.page = None
        self.count = 0
        self.columns = self.COLUMNS

    def new_page(self, table=True):
        self.page = self.doc.new_page(width=self.WIDTH, height=self.HEIGHT)
        self.page.insert_font(fontname=FONT_NAME, fontbuffer=self.font_buffer)
        self.count += 1
        y = self.MARGIN + 12
        self.text((self.MARGIN, y), f"{self.title}（一覧 {self.count}）", 13)
        y += 16
        x = self.MARGIN
        for key in SOURCE_TYPES:
            spec = SOURCE_TYPES[key]
            self.page.draw_rect((x, y - 7, x + 9, y), color=spec["color"], width=1.2)
            self.text((x + 12, y), spec["label"], self.SIZE, spec["color"])
            x += 12 + self.font.text_length(spec["label"], fontsize=self.SIZE) + 12
        self.text((x + 6, y), NOTICE, self.SIZE, (0.3, 0.3, 0.3))
        self.y = y + 8
        if table:
            self.row([name for name, _ in self.columns], header=True)

    def text(self, point, text, size, color=(0, 0, 0)):
        self.page.insert_text(point, text, fontname=FONT_NAME, fontsize=size, color=color)

    def row(self, cells, color=(0, 0, 0), header=False):
        size = self.SIZE
        wrapped = [wrap(str(cell), self.font, size, width - 6) for cell, (_, width) in zip(cells, self.columns)]
        height = max(len(lines) for lines in wrapped) * size * 1.35 + 5
        if self.y + height > self.HEIGHT - self.MARGIN:
            if self.page is not None and not header:
                self.new_page()
        x = self.MARGIN
        for index, (lines, (_, width)) in enumerate(zip(wrapped, self.columns)):
            rect = pymupdf.Rect(x, self.y, x + width, self.y + height)
            self.page.draw_rect(rect, color=(0.6, 0.6, 0.6), fill=(0.92, 0.92, 0.92) if header else None, width=0.4)
            y = self.y + size + 1.5
            cell_color = color if index in (0, 1) else (0, 0, 0)
            for line in lines:
                self.text((x + 3, y), line, size, cell_color)
                y += size * 1.35
            x += width
        self.y += height


def result_cells(row):
    pages = "、".join(f"p.{n}" for n in row["pages"])
    content = f"{row['item']}：{row['content']}" if row["item"] else row["content"]
    return [row["id"], content, row["result"], pages, row["reason"]]


def evidence_text(item):
    parts = [f"{e.get('drawing', '')} {e.get('page', '')} {e.get('where', '')}".strip() for e in item.get("evidence", [])]
    return "\n".join(parts) if parts else "（根拠の記載なし）"


def content_text(item):
    return f"{item['title']}\n{item['content']}{merged_note(item)}"


def collect_text(findings, title, notes, tables=()):
    text = [LEGEND_TITLE, NOTICE, title, "（番号は最後の一覧ページと対応）赤：設計図書・議事録との矛盾青：ナレッジ一覧0123456789.[要確認] 枠なし（根拠の記載なし）はいあり"]
    text += [name for name, _ in ListPages.COLUMNS] + [spec["label"] for spec in SOURCE_TYPES.values()] + list(notes)
    for item in findings:
        text += [item["comment"] or "", content_text(item), evidence_text(item)]
    for heading, rows in tables:
        text += [heading] + [name for name, _ in ListPages.RESULT_COLUMNS]
        for row in rows:
            text += [str(cell) for cell in result_cells(row)]
    return "".join(text)


def make_marked_pdf(source_path, findings, out_path, title="施工図の朱書き", notes=(), tables=()):
    """朱書きを重ねたPDFを書き出す。notes は一覧の最後に書く注記。tables は [(見出し, 項目ごとの結果)]（別の表にする）"""
    font_buffer = build_font(collect_text(findings, title, notes, tables))
    font = pymupdf.Font(fontbuffer=font_buffer)
    doc = pymupdf.open(source_path)
    sheet_count = doc.page_count
    layers = {key: doc.add_ocg(f"朱書き（{spec['label']}）", on=True) for key, spec in SOURCE_TYPES.items()}
    legend_layer = doc.add_ocg("凡例", on=True)
    for number in range(sheet_count):
        items = [item for item in findings if item["page"] == number + 1]
        mark_page(doc, doc[number], items, layers, font, font_buffer, legend_layer)

    pages = ListPages(doc, font, font_buffer, title)
    pages.new_page()
    for item in findings:
        spec = SOURCE_TYPES[item["source_type"]]
        pages.row([item["number"], spec["label"], f"p.{item['page']}", content_text(item), evidence_text(item),
                   "はい" if item.get("needs_confirmation") else ""], color=spec["color"])
    for note in notes:
        pages.y += 8
        for line in wrap(note, font, ListPages.SIZE, ListPages.WIDTH - 2 * ListPages.MARGIN):
            # 注記は下の余白まで使う。1行のために表の見出しだけのページを作らない
            if pages.y + 11 > ListPages.HEIGHT - ListPages.MARGIN / 2:
                pages.new_page(table=False)
            pages.y += 11
            pages.text((ListPages.MARGIN, pages.y), line, ListPages.SIZE)
    for heading, rows in tables:
        pages.columns = ListPages.RESULT_COLUMNS
        pages.title = heading
        pages.new_page()
        for row in rows:
            pages.row(result_cells(row))
    doc.save(out_path, garbage=1, deflate=True)
    doc.close()
    return {"sheet_pages": sheet_count, "list_pages": pages.count}


def set_visible_layers(doc, source_types):
    """指定した種類の朱書きの層だけを表示する。凡例は常に表示する"""
    labels = {f"朱書き（{SOURCE_TYPES[key]['label']}）" for key in source_types}
    for config in doc.layer_ui_configs():
        if config["text"].startswith("朱書き"):
            doc.set_layer_ui_config(config["number"], 0 if config["text"] in labels else 2)


def layer_overlay(base, layered):
    """朱書きの層だけを透明な背景の画像にする。base は朱書きなし、layered はその層だけを表示したページの Pixmap"""
    before = np.frombuffer(base.samples, dtype=np.uint8).reshape(base.h, base.w, base.n)
    after = np.frombuffer(layered.samples, dtype=np.uint8).reshape(layered.h, layered.w, layered.n)
    alpha = (before != after).any(axis=2).astype(np.uint8) * 255
    rgba = np.dstack([after, alpha])
    return pymupdf.Pixmap(pymupdf.csRGB, layered.w, layered.h, rgba.tobytes(), True)


def layers_off_pixmap(path, page_number, zoom=1.0):
    """朱書きの層を全部消してページを描く（元の図面と同じになることの確認用）"""
    doc = pymupdf.open(path)
    for config in doc.layer_ui_configs():
        doc.set_layer_ui_config(config["number"], 2)
    return doc[page_number].get_pixmap(matrix=pymupdf.Matrix(zoom, zoom), alpha=False)
