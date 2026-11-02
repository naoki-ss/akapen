"""人のチェック図から、比較画面に出す部分だけを切り抜く。

スキャン画像は文字を置き換えられないので、切り抜きを小さくし、寸法と名前を塗りつぶす。
塗りつぶす位置は切り抜き画像のピクセル座標（目で確認して決めた値）。
"""
import pymupdf

from common import DEMO, PRIVATE, write_json

CHECK = PRIVATE / "shikouzu/check"
OUT = DEMO / "human"
SCALE = 300 / 72
MASK = (225, 225, 225)


def crop(pdf, page_no, clip, masks, name):
    page = pymupdf.open(CHECK / pdf)[page_no - 1]
    pix = page.get_pixmap(matrix=pymupdf.Matrix(SCALE, SCALE), clip=pymupdf.Rect(clip))
    # Pixmap の座標は切り抜きの左上が (pix.x, pix.y)
    for x0, y0, x1, y1 in masks:
        pix.set_rect(pymupdf.IRect(pix.x + x0, pix.y + y0, pix.x + x1, pix.y + y1), MASK)
    OUT.mkdir(parents=True, exist_ok=True)
    pix.save(OUT / name)
    return f"human/{name}"


def main():
    items = [
        {
            "id": "H1",
            "drawing": "杭伏せ図のチェックバック（9/2）",
            "note": "「構造図にありませんが何の杭でしょうか」",
            "summary": "人はTC杭が構造図にないことを質問しました。チェック機能の照合では、TC杭と基礎の高さの関係も確認の対象にしています。",
            "key_id": "F1",
            "image": crop(
                "kui_check_260902.pdf", 1,
                (748, 500, 1085, 640),
                [(0, 165, 100, 210), (55, 283, 120, 312), (422, 40, 455, 100), (425, 265, 455, 330),
                 (183, 216, 412, 254), (0, 530, 218, 575)],
                "H1.png",
            ),
        },
        {
            "id": "H2",
            "drawing": "基礎伏せ図のチェックバック（9/30）",
            "note": "小梁の符号の横に手書きで「B70A」",
            "summary": "人の朱書きで伏せ図は B70A に直りました。断面図には B70B が残っていて、チェック機能はこの残りを見つけます。",
            "key_id": "F4",
            "image": crop(
                "kiso_check_260930.pdf", 1,
                (818, 448, 856, 524),
                [(22, 70, 58, 135), (88, 75, 122, 135), (95, 228, 126, 317), (128, 85, 159, 130)],
                "H2.png",
            ),
        },
        {
            "id": "H3",
            "drawing": "基礎伏せ図のチェックバック（9/28、9/30）",
            "note": "床レベル、水勾配、釜場の位置などの朱書きが複数",
            "summary": "人は納まりや施工性まで踏み込んで直しています。今のチェック機能の照合範囲には入っていません。",
            "key_id": None,
        },
    ]
    write_json(DEMO / "human-compare.json", {"items": items})
    print(f"{len(items)} 件を書き出しました")


if __name__ == "__main__":
    main()
