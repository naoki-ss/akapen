"""公開するファイルに、実名や実寸法が混ざっていないかを確認する。

禁止語の一覧は実名を含むのでリポジトリの外（~/sekozu-data/dummy_map.json）に置く。
画像の中身までは調べられないので、画像は目で確認する。
"""
import json
import re
import subprocess
import sys
import unicodedata

from common import PRIVATE, REPO

config = json.loads((PRIVATE / "dummy_map.json").read_text())
words = config["forbidden_words"] + config["forbidden_numbers"]
sections = config.get("sample_b_sections", [])
mark_sizes = config.get("sample_b_mark_sizes", [])
# 利用者が公開してよいと判断した語（ファイルごと）
allowed = config.get("allowed_in_file", {})
files = subprocess.run(
    ["git", "ls-files", "--cached", "--others", "--exclude-standard"],
    capture_output=True, text=True, cwd=REPO,
).stdout.split("\n")



def compact(text):
    """断面の書き方の揺れをそろえる（空白、x と ×、全角の数字や記号、桁区切り）"""
    text = unicodedata.normalize("NFKC", text)
    text = re.sub(r"[\s,]", "", text)
    text = re.sub(r"(?<=\d)[xX*](?=\d)", "×", text)
    return re.sub(r"[－ー―‐-]", "-", text)


problems = []
for name in filter(None, files):
    path = REPO / name
    if not path.is_file() or path.name == "package-lock.json":
        continue
    if path.suffix.lower() in {".pdf", ".jww", ".dxf", ".dwg"}:
        if not name.startswith("demo-data/"):
            problems.append(f"{name}: 図面ファイルです")
        continue
    if path.name.startswith(".env") and path.name != ".env.example":
        problems.append(f"{name}: 環境変数のファイルです")
        continue
    try:
        text = path.read_text()
    except UnicodeDecodeError:
        continue
    for word in words:
        # 数値は長い数値の一部に一致しないよう、前後が数字でないものだけを見る
        pattern = rf"(?<![\d,]){re.escape(word)}(?![\d,])" if word[0].isdigit() else re.escape(word)
        if word not in allowed.get(name, []) and re.search(pattern, text):
            # 実名を画面に出さないよう、位置だけを表示する
            problems.append(f"{name}: 禁止語の {words.index(word) + 1} 番目に一致")
    # 公開の確認が取れていない物件の断面と、符号と寸法の組み合わせ
    packed = compact(text)
    for index, section in enumerate(sections, 1):
        if compact(section) in packed:
            problems.append(f"{name}: 禁止した断面の {index} 番目に一致")
    # 符号の境目が分かるように、語の間の空白は残して照合する
    spaced = re.sub(r"\s*×\s*", "×", re.sub(r"(?<=\d)\s*[xX*]\s*(?=\d)", "×", unicodedata.normalize("NFKC", text))).replace(",", "")
    for index, (mark, size) in enumerate(mark_sizes, 1):
        if re.search(rf"(?<![A-Za-z0-9]){re.escape(mark)}(?!\d).{{0,30}}?(?<![\d.]){re.escape(compact(size))}(?!\d)", spaced):
            problems.append(f"{name}: 禁止した符号と寸法の組み合わせの {index} 番目に一致")

print(f"確認 {len(files)} ファイル、問題 {len(problems)} 件")
for problem in problems:
    print(" ", problem)
sys.exit(1 if problems else 0)
