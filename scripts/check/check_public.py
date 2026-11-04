"""公開するファイルに、実名や実寸法が混ざっていないかを確認する。

禁止語の一覧は実名を含むのでリポジトリの外（~/sekozu-data/dummy_map.json）に置く。
画像の中身は文字として調べられないので、目で確認した画像のハッシュを
demo-data/image-review.json に記録し、記録と違う画像があれば止める。
"""
import hashlib
import json
import re
import subprocess
import sys

from common import PRIVATE, REPO

config = json.loads((PRIVATE / "dummy_map.json").read_text())
names = config["forbidden_words"]
numbers = config["forbidden_numbers"]
# 公開してよい物件名。単独の社名は別の物件の手がかりになるので禁止語のまま残す
phrases = config.get("allowed_phrases", [])
# 別の物件の実寸法は、公開を認めた物件のフォルダでは調べない（同じ数値が別の意味で出てくる）
numbers_exempt = tuple(config.get("numbers_exempt_paths", []))
# 利用者が公開してよいと判断した語（ファイルごと）
allowed = config.get("allowed_in_file", {})
review_path = REPO / "demo-data" / "image-review.json"
reviewed = json.loads(review_path.read_text()) if review_path.exists() else {}
files = subprocess.run(
    ["git", "ls-files", "--cached", "--others", "--exclude-standard"],
    capture_output=True, text=True, cwd=REPO,
).stdout.split("\n")



problems = []
# アップロードされた図面と結果は、リポジトリの外にだけ置く
uploads = PRIVATE / "uploads"
if uploads.resolve().is_relative_to(REPO.resolve()):
    problems.append("アップロードの保存先がリポジトリの中です")
upload_hashes = {}
if uploads.exists():
    for item in uploads.rglob("*"):
        if item.is_file():
            upload_hashes[hashlib.sha256(item.read_bytes()).hexdigest()] = item.name
print(f"アップロードのファイル {len(upload_hashes)} 種類と照合")

# 社内のチェックリストは公開してよいか決まるまで入れない。本体と同じファイル、項目の文章の転記を止める。
# 短い文（「設計図通りか」など）は一般的な言い回しと区別できないので調べない
SPACES = re.compile(r"\s+")
CHECKLIST_MIN_CHARS = 8
checklist_phrases = {}
checklist_hashes = set()
knowledge = PRIVATE / "knowledge"
if knowledge.resolve().is_relative_to(REPO.resolve()):
    problems.append("チェックリストの保存先がリポジトリの中です")
for source in sorted(knowledge.glob("*.json")) if knowledge.exists() else []:
    checklist_hashes.add(hashlib.sha256(source.read_bytes()).hexdigest())
    for entry in json.loads(source.read_text())["items"]:
        for field in ("item", "content", "note"):
            phrase = SPACES.sub("", entry[field])
            if len(phrase) >= CHECKLIST_MIN_CHARS:
                checklist_phrases[phrase] = f"{entry['id']} の {field}"
print(f"チェックリストの文 {len(checklist_phrases)} 件と照合")

for name in filter(None, files):
    path = REPO / name
    if path.is_file() and hashlib.sha256(path.read_bytes()).hexdigest() in upload_hashes:
        problems.append(f"{name}: アップロードされたファイルと同じ内容です")
    if path.is_file() and hashlib.sha256(path.read_bytes()).hexdigest() in checklist_hashes:
        problems.append(f"{name}: チェックリストの本体と同じ内容です")
    if not path.is_file() or path.name == "package-lock.json":
        continue
    if path.suffix.lower() == ".png" and name.startswith("demo-data/"):
        if reviewed.get(name) != hashlib.sha256(path.read_bytes()).hexdigest():
            problems.append(f"{name}: 目で確認した記録と違う画像です")
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
    compact = SPACES.sub("", text)
    for phrase, where in checklist_phrases.items():
        if phrase in compact:
            problems.append(f"{name}: チェックリスト（{where}）の文と一致")
    for phrase in phrases:
        text = text.replace(phrase, "")
    targets = names if name.startswith(numbers_exempt) else names + numbers
    for word in targets:
        # 数値は長い数値の一部に一致しないよう、前後が数字でないものだけを見る
        pattern = rf"(?<![\d,]){re.escape(word)}(?![\d,])" if word[0].isdigit() else re.escape(word)
        if word not in allowed.get(name, []) and re.search(pattern, text):
            # 実名を画面に出さないよう、位置だけを表示する
            problems.append(f"{name}: 禁止語の {(names + numbers).index(word) + 1} 番目に一致")

print(f"確認 {len(files)} ファイル、問題 {len(problems)} 件")
for problem in problems:
    print(" ", problem)
sys.exit(1 if problems else 0)
