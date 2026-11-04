"""赤と青が同じ箇所・同じ内容を指摘したものをまとめる。

同じ箇所は枠の重なりで候補を絞り、同じ内容かどうかは Claude に聞く。
まとめても指摘は消さない。図面の枠を1つにして両方の番号を付け、一覧には両方の根拠を残す。
判定に失敗したら、まとめない（別々の枠のまま）。
"""
OVERLAP_RATIO = 0.5

SYSTEM = """あなたは施工図チェックの指摘を整理する担当です。同じ図面の上で近い場所を指している2つの指摘について、同じ内容かどうかを判定します。

- 同じ：同じ箇所について、確認を求めている対象と食い違いの中身が同じ。根拠の図面や書きぶりが違っていても同じとします。
- 別：同じ部材や近い場所でも、確認を求めている中身が違う。片方の内容がもう片方に含まれるだけのときも別とします。
- 迷うときは別とします。"""


def schema(pair_ids):
    return {
        "type": "object",
        "additionalProperties": False,
        "required": ["pairs"],
        "properties": {
            "pairs": {
                "type": "array",
                "items": {
                    "type": "object",
                    "additionalProperties": False,
                    "required": ["pair", "same", "reason"],
                    "properties": {
                        "pair": {"type": "string", "enum": pair_ids},
                        "same": {"type": "boolean"},
                        "reason": {"type": "string"},
                    },
                },
            },
        },
    }


def overlap_ratio(a, b):
    """重なりの面積 / 小さいほうの枠の面積"""
    width = min(a[2], b[2]) - max(a[0], b[0])
    height = min(a[3], b[3]) - max(a[1], b[1])
    if width <= 0 or height <= 0:
        return 0.0
    smaller = min((a[2] - a[0]) * (a[3] - a[1]), (b[2] - b[0]) * (b[3] - b[1]))
    return width * height / smaller if smaller > 0 else 0.0


def candidates(findings):
    """(赤の指摘, 青の指摘) のうち、同じページで枠が重なるもの"""
    pairs = []
    reds = [item for item in findings if item["source_type"] != "knowledge"]
    blues = [item for item in findings if item["source_type"] == "knowledge"]
    for red in reds:
        for blue in blues:
            if red["page"] == blue["page"] and any(
                overlap_ratio(a, b) >= OVERLAP_RATIO for a in red["regions"] for b in blue["regions"]
            ):
                pairs.append((red, blue))
    return pairs


def prompt_text(pairs):
    blocks = []
    for red, blue in pairs:
        lines = [f"組 {pair_id(red, blue)}"]
        for label, item in (("指摘A", red), ("指摘B", blue)):
            lines.append(f"{label}：{item['title']}。{item['content']}（通り：{'、'.join(item['grids'])}／符号：{'、'.join(item['marks'])}）")
        blocks.append("\n".join(lines))
    return "次の組ごとに、指摘Aと指摘Bが同じ内容かどうかを判定してください。\n\n" + "\n\n".join(blocks)


def pair_id(red, blue):
    return f"{red['number']}-{blue['number']}"


def union_box(boxes):
    return [min(b[0] for b in boxes), min(b[1] for b in boxes), max(b[2] for b in boxes), max(b[3] for b in boxes)]


def apply_merges(findings, same_pairs):
    """same_pairs は [(赤, 青)]。つながる指摘をまとめ、枠を1つにする。元の枠は original_regions に残す"""
    parent = {item["number"]: item["number"] for item in findings}

    def root(number):
        while parent[number] != number:
            number = parent[number]
        return number

    for red, blue in same_pairs:
        parent[root(red["number"])] = root(blue["number"])
    groups = {}
    for item in findings:
        groups.setdefault(root(item["number"]), []).append(item)
    for group in groups.values():
        if len(group) < 2:
            continue
        box = union_box([region for item in group for region in item["regions"]])
        numbers = [item["number"] for item in group]
        for item in group:
            item["original_regions"] = item["regions"]
            item["regions"] = [box]
            item["merged_numbers"] = numbers


def merged_note(item):
    numbers = item.get("merged_numbers")
    if not numbers:
        return ""
    return "（番号 " + "、".join(str(n) for n in numbers) + " は同じ箇所・同じ内容のため、図面の枠は1つです）"
