"""鉄骨施工図のページ上の位置を求める。

- 伏図の通り芯の丸から、建物の座標（mm）とページの座標の対応を作る
- 同じ図面のスキャン（人の朱書き）との位置合わせを、線の相関で求める
"""
import numpy as np
import pymupdf

SCALE = 0.5
# 図面枠の外や、丸の入らない下端を除く
BUBBLE_MIN, BUBBLE_MAX = 18, 23


def grid_bubbles(page):
    """通り芯の丸の中心。[(x, y)]"""
    centers = set()
    for drawing in page.get_drawings():
        rect = drawing["rect"]
        if (BUBBLE_MIN < rect.width < BUBBLE_MAX and abs(rect.width - rect.height) < 1
                and any(item[0] == "c" for item in drawing["items"])):
            centers.add((round((rect.x0 + rect.x1) / 2, 1), round((rect.y0 + rect.y1) / 2, 1)))
    return sorted(centers)


def plan_transform(page, grid_x, grid_y):
    """伏図の (建物 x, 建物 y) → ページ座標の変換 (kx, ox, ky, oy)。

    下の列に X の丸、左の列に Y の丸が並ぶ。全部の通りに丸があるとは限らないので、
    いちばん多く並ぶ行と列を探し、両端の丸を建物の両端の通りに合わせる。
    """
    centers = grid_bubbles(page)
    rows, columns = {}, {}
    for x, y in centers:
        rows.setdefault(round(y), []).append(x)
        columns.setdefault(round(x), []).append(y)
    row = max(rows, key=lambda k: len(rows[k]))
    column = max(columns, key=lambda k: len(columns[k]))
    xs, ys = sorted(rows[row]), sorted(columns[column])
    gx, gy = sorted(grid_x.values()), sorted(grid_y.values())
    kx = (xs[-1] - xs[0]) / (gx[-1] - gx[0])
    # ページの y は下向き、建物の y は上向き
    ky = -(ys[-1] - ys[0]) / (gy[-1] - gy[0])
    return kx, xs[0] - kx * gx[0], ky, ys[-1] - ky * gy[0]


def dark_mask(page, scale=SCALE, colored_out=False):
    """線の部分を 1 にした配列。スキャンの赤やピンクは線に含めない"""
    pix = page.get_pixmap(matrix=pymupdf.Matrix(scale, scale), colorspace=pymupdf.csRGB, alpha=False)
    rgb = np.frombuffer(pix.samples, dtype=np.uint8).reshape(pix.h, pix.w, 3).astype(np.int16)
    mask = rgb.sum(axis=2) < 450
    if colored_out:
        mask &= (rgb[:, :, 0] - rgb[:, :, 2]) < 40
    return mask.astype(np.float32)


def register(sheet_page, scan_page, scales=np.arange(0.92, 1.04, 0.002)):
    """施工図のページ座標 → スキャンのページ座標の変換 (scale, dx, dy) と相関の強さ"""
    target = dark_mask(scan_page, colored_out=True)
    target -= target.mean()
    spectrum = np.fft.rfft2(target)
    best = None
    for scale in scales:
        source = dark_mask(sheet_page, SCALE * scale)
        padded = np.zeros(target.shape, dtype=np.float32)
        height, width = min(source.shape[0], target.shape[0]), min(source.shape[1], target.shape[1])
        padded[:height, :width] = source[:height, :width]
        padded -= padded.mean()
        corr = np.fft.irfft2(spectrum * np.conj(np.fft.rfft2(padded)), s=target.shape)
        y, x = np.unravel_index(np.argmax(corr), corr.shape)
        peak = float(corr[y, x])
        if best is None or peak > best[0]:
            # 周期的なずれを負の値に戻す
            y = y - target.shape[0] if y > target.shape[0] / 2 else y
            x = x - target.shape[1] if x > target.shape[1] / 2 else x
            best = (peak, float(scale), x / SCALE, y / SCALE)
    return {"scale": round(best[1], 4), "dx": round(best[2], 2), "dy": round(best[3], 2), "peak": round(best[0], 1)}
