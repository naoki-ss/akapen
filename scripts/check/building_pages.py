"""構造図のページの種類を判定する。図面枠の題名の文字で決め、文字で決まらないページだけAIに見せる。"""
import re
import unicodedata

import pymupdf

KINDS = {"伏図": "伏図", "軸組": "軸組図", "リスト": "リスト"}
OTHER_TITLES = r"詳細図|標準図|仕様書|断面|配筋|地盤|配置|案内|架構|立面|平面"
# 3Dに使わない伏図と、読む必要があるリスト
SKIP_PLANS = r"杭|小屋|屋根.*母屋"
USEFUL_LISTS = r"鉄骨部材リスト|柱リスト|大梁リスト|基礎梁リスト"
TITLE_ZONE = 0.92

AI_SYSTEM = """建築の構造図の1ページを見て、種類と題名を答えます。
- 伏図：階ごとの平面の図（基礎伏図、2階伏図など）
- 軸組図：通りごとの立面の骨組みの図
- リスト：柱、梁、基礎梁などの断面のリスト
- その他：仕様書、標準図、詳細図、地盤調査図など"""

AI_SCHEMA = {
    "type": "object",
    "additionalProperties": False,
    "required": ["kind", "title"],
    "properties": {
        "kind": {"type": "string", "enum": ["伏図", "軸組図", "リスト", "その他"]},
        "title": {"type": "string"},
    },
}


def normalize(text):
    return unicodedata.normalize("NFKC", text)


def display_words(page):
    """[(x0, y0, x1, y1, 文字)]。回転したページでも、見た目の向きの座標にする"""
    matrix = page.rotation_matrix
    words = []
    for word in page.get_text("words"):
        rect = pymupdf.Rect(word[:4]) * matrix
        rect.normalize()
        words.append((rect.x0, rect.y0, rect.x1, rect.y1, normalize(word[4])))
    return words


def title_of(page, words):
    """図面枠（ページの下の方）にある図面名。見つからなければ None"""
    limit = page.rect.height * TITLE_ZONE
    for word in sorted((w for w in words if w[1] > limit), key=lambda w: -w[0]):
        if re.search(rf"伏図|軸組|リスト|{OTHER_TITLES}", word[4]):
            return word[4]
    return None


def kind_of(title):
    for key, kind in KINDS.items():
        if key in title:
            return kind
    return "その他"


def needed(kind, title, text=""):
    """3Dの材料として読むページか"""
    if kind == "伏図":
        return not re.search(SKIP_PLANS, title)
    if kind == "軸組図":
        return True
    if kind == "リスト":
        # 題名が「断面リスト」のように同じでも、中の見出しで分かる
        return bool(re.search(USEFUL_LISTS, title + " " + text))
    return False


def classify_by_text(path, source):
    doc = pymupdf.open(path)
    pages = []
    for page in doc:
        words = display_words(page)
        title = title_of(page, words)
        text = " ".join(word[4] for word in words)
        entry = {"source": source, "page": page.number + 1, "title": title, "words": len(words), "how": "文字" if title else None,
                 "kind": kind_of(title) if title else None, "read": False, "replaced_by": None}
        if title:
            entry["read"] = needed(entry["kind"], title, text)
        pages.append(entry)
    return pages


def apply_replacements(design, revised):
    """差替図面に同じ題名のページがあれば、そちらを読む。元のページは読まない"""
    latest = {}
    for entry in revised:
        if entry["title"]:
            latest[entry["title"]] = entry
    for entry in design:
        other = latest.get(entry["title"])
        if other:
            entry["replaced_by"] = {"source": other["source"], "page": other["page"]}
            other["read"] = entry["read"] or other["read"]
            entry["read"] = False
    # 差替図面にしかないページは、そのまま判定の結果で読む
