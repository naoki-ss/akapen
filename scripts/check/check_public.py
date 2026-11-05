"""公開するファイルに、実名や実寸法が混ざっていないかを確認する。

禁止語の一覧は実名を含むのでリポジトリの外（~/sekozu-data/dummy_map.json）に置く。
画像の中身は文字として調べられないので、目で確認した画像のハッシュを
demo-data/image-review.json に記録し（validation/ の画像も同じ）、記録と違う画像があれば止める。

--staged を付けると、ステージした内容も調べる（コミット前のフック .githooks/pre-commit が使う）。
"""
import hashlib
import json
import re
import subprocess
import sys

from common import PRIVATE, REPO

config = json.loads((PRIVATE / "dummy_map.json").read_text())
# 確定した担当者の名前も禁止語にする。画面にもコードにも出さない。記録はリポジトリの外にだけある
confirmers = sorted({entry["confirmed"]["by"]
                     for path in (PRIVATE / "uploads").glob("*/sheet_status.json")
                     for entry in json.loads(path.read_text())["pages"].values() if entry.get("confirmed")})
names = [*config["forbidden_words"], *confirmers]
numbers = config["forbidden_numbers"]
# 公開してよい物件名。単独の社名は非公開の物件の手がかりになるので禁止語のまま残す
phrases = config.get("allowed_phrases", [])
# 非公開の物件の実寸法は、公開を認めた物件のフォルダでは調べない（同じ数値が別の意味で出てくる）
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
# 登録した物件の建物データと3D（非公開の物件の寸法を含む）も、リポジトリの外にだけ置く
registered = PRIVATE / "projects"
if registered.resolve().is_relative_to(REPO.resolve()):
    problems.append("登録した物件の保存先がリポジトリの中です")
if registered.exists():
    for item in registered.rglob("*"):
        if item.is_file():
            upload_hashes[hashlib.sha256(item.read_bytes()).hexdigest()] = item.name
# ナレッジの取り込みで入れた元のファイルも、リポジトリの外にだけ置く
imports = PRIVATE / "knowledge-imports"
if imports.resolve().is_relative_to(REPO.resolve()):
    problems.append("ナレッジの取り込みの保存先がリポジトリの中です")
if imports.exists():
    for item in imports.rglob("*"):
        if item.is_file():
            upload_hashes[hashlib.sha256(item.read_bytes()).hexdigest()] = item.name
print(f"アップロードと登録のファイル {len(upload_hashes)} 種類と照合")

# 社内のチェックリストは公開してよいか決まるまで入れない。本体と同じファイル、項目の文章の転記を止める。
# 短い文（「設計図通りか」など）は一般的な言い回しと区別できないので調べない
SPACES = re.compile(r"\s+")
CONFIRMER_FIELD = re.compile(r"(confirmed\??\.|item\.|\bfinal\??\.)by\b")
CHECKLIST_MIN_CHARS = 8
checklist_phrases = {}
checklist_hashes = set()
knowledge = PRIVATE / "knowledge"
if knowledge.resolve().is_relative_to(REPO.resolve()):
    problems.append("チェックリストの保存先がリポジトリの中です")


def checklist_texts(value, inside=False):
    """ファイルの形によらず、項目（リストの中）の日本語の文をすべて取り出す。ファイルの説明や種類の値は調べない"""
    if isinstance(value, str):
        if inside and not value.isascii():
            yield value
    elif isinstance(value, dict):
        for child in value.values():
            yield from checklist_texts(child, inside)
    elif isinstance(value, list):
        for child in value:
            yield from checklist_texts(child, True)


for source in sorted(item for item in knowledge.rglob("*") if item.is_file()) if knowledge.exists() else []:
    checklist_hashes.add(hashlib.sha256(source.read_bytes()).hexdigest())
    if source.suffix != ".json":
        continue
    for text in checklist_texts(json.loads(source.read_text())):
        phrase = SPACES.sub("", text)
        if len(phrase) >= CHECKLIST_MIN_CHARS:
            checklist_phrases[phrase] = source.name
print(f"チェックリストの文 {len(checklist_phrases)} 件と照合")

def check_file(name, data, label=""):
    """1ファイルの中身を調べる。data はファイルの内容（バイト列）"""
    path = REPO / name
    digest = hashlib.sha256(data).hexdigest()
    # 根拠の設計図の切り抜きは、判定の結果の画像と同じ内容になる。目で確認した記録があるものだけ認める
    confirmed_basis = "/design/" in name and name.startswith("demo-data/") and reviewed.get(name) == digest
    if digest in upload_hashes and not confirmed_basis:
        problems.append(f"{label}{name}: アップロードされたファイルと同じ内容です")
    if digest in checklist_hashes:
        problems.append(f"{label}{name}: チェックリストの本体と同じ内容です")
    if path.name == "package-lock.json":
        return
    if path.suffix.lower() == ".png" and name.startswith(("demo-data/", "validation/")):
        if reviewed.get(name) != digest:
            problems.append(f"{label}{name}: 目で確認した記録と違う画像です")
        return
    if path.suffix.lower() in {".pdf", ".jww", ".dxf", ".dwg"}:
        if not name.startswith("demo-data/"):
            problems.append(f"{label}{name}: 図面ファイルです")
        return
    if path.name.startswith(".env") and path.name != ".env.example":
        problems.append(f"{label}{name}: 環境変数のファイルです")
        return
    try:
        text = data.decode()
    except UnicodeDecodeError:
        return
    # 画面のコードが確定者の名前を受け取っていないか
    if path.suffix == ".tsx" and CONFIRMER_FIELD.search(text):
        problems.append(f"{label}{name}: 確定者の名前を画面に渡しています")
    compact = SPACES.sub("", text)
    for phrase, where in checklist_phrases.items():
        if phrase in compact:
            problems.append(f"{label}{name}: チェックリスト（{where}）の文と一致")
    for phrase in phrases:
        text = text.replace(phrase, "")
    targets = names if name.startswith(numbers_exempt) else names + numbers
    for word in targets:
        # 数値は長い数値の一部に一致しないよう、前後が数字でないものだけを見る
        pattern = rf"(?<![\d,]){re.escape(word)}(?![\d,])" if word[0].isdigit() else re.escape(word)
        if word not in allowed.get(name, []) and re.search(pattern, text):
            # 実名を画面に出さないよう、位置だけを表示する
            problems.append(f"{label}{name}: 禁止語の {(names + numbers).index(word) + 1} 番目に一致")


for name in filter(None, files):
    path = REPO / name
    # 公開するのは本社屋だけ。別の物件の置き場が戻ってこないようにする
    if "sample-x" in name or "sample_x" in name:
        problems.append(f"{name}: 別の物件のファイルです")
    if path.is_file():
        check_file(name, path.read_bytes())

# コミットされるのは作業中のファイルではなく、ステージした内容。そちらも調べる
if "--staged" in sys.argv:
    staged = subprocess.run(["git", "diff", "--cached", "--name-only", "--diff-filter=ACMRT", "-z"],
                            capture_output=True, text=True, cwd=REPO, check=True).stdout.split("\0")
    for name in filter(None, staged):
        blob = subprocess.run(["git", "show", f":{name}"], capture_output=True, cwd=REPO, check=True).stdout
        check_file(name, blob, "（ステージ）")

print(f"確認 {len(files)} ファイル、問題 {len(problems)} 件")
for problem in problems:
    print(" ", problem)
sys.exit(1 if problems else 0)
