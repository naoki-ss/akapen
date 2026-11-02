"""デモの指摘を赤く光らせるのに必要な部材だけを、demo-data のモデルに足す。値はダミー。

何度実行しても同じ結果になる。
"""
import json

from common import DEMO, write_json

PATH = DEMO / "model.json"

PILE_MARKS = {
    "X1-Y1": "P1", "X2-Y1": "P1", "X3-Y1": "P2", "X4-Y1": "P2",
    "X1-Y2": "P1", "X2-Y2": "P1", "X3-Y2": "P5", "X4-Y2": "P2",
    "X1-Y3": "P3", "X2-Y3": "P1", "X3-Y3": "P5", "X4-Y3": "P5",
    "X1-Y4": "P3", "X2-Y4": "P7", "X3-Y4": "P6", "X4-Y4": "P4",
    "X3-Y5": "P4", "X4-Y5": "P8",
}
# 通り芯からの芯ずれ（ダミー）
OFFSET_X = {"X1": 700, "X2": -700, "X3": 700, "X4": -700}
OFFSET_Y = {"Y1": 700, "Y2": 0, "Y3": 0, "Y4": 0, "Y5": -700}
OFFSET_Y_BY_GRID = {"X1-Y4": -700, "X2-Y4": -300}


def main():
    model = json.loads(PATH.read_text())
    grid_x, grid_y = model["grid_x"], model["grid_y"]
    members = [m for m in model["members"] if not m.get("demo_added")]
    for member in members:
        if member["type"] != "pile":
            continue
        grid = member["grid"]
        x_name, y_name = grid.split("-")
        member["mark"] = PILE_MARKS[grid]
        member["x"] = grid_x[x_name] + OFFSET_X[x_name]
        member["y"] = grid_y[y_name] + OFFSET_Y_BY_GRID.get(grid, OFFSET_Y[y_name])

    members += [
        {
            "type": "pile", "mark": "TC杭", "grid": "TC", "floor": "基礎", "demo_added": True,
            "x": grid_x["X4"] + 2900, "y": grid_y["Y1"] + 4600, "z0": -15000, "z1": -1800,
            "radius": 500,
        },
        {
            "type": "slab", "mark": "TC基礎", "grid": "TC基礎", "floor": "基礎", "demo_added": True,
            "x0": grid_x["X4"] + 1650, "y0": grid_y["Y1"] + 3350,
            "x1": grid_x["X4"] + 4150, "y1": grid_y["Y1"] + 5850,
            "z": -300, "thickness": 1000,
        },
        {
            "type": "beam", "mark": "B70A", "grid": "X3-X4/Y4-Y5", "floor": "基礎", "demo_added": True,
            "x0": grid_x["X3"] + 2400, "y0": grid_y["Y4"], "x1": grid_x["X3"] + 2400, "y1": grid_y["Y5"],
            "z": 0, "width": 400, "depth": 600,
        },
        {
            "type": "slab", "mark": "FS30（消火ポンプ室）", "grid": "X3-X4/Y4-Y5", "floor": "基礎",
            "demo_added": True,
            "x0": grid_x["X3"] + 2000, "y0": grid_y["Y4"] + 2000, "x1": grid_x["X4"], "y1": grid_y["Y5"],
            "z": -2100, "thickness": 300,
        },
    ]
    model["members"] = members
    write_json(PATH, model)
    print(f"部材 {len(members)} 件")


if __name__ == "__main__":
    main()
