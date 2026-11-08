"""GitHub に上がっている全部（全ブランチの全コミットの全ファイル、コミットメッセージ、issue とコメントと編集履歴）を、
公開してはいけない情報がないか文字で調べる。画像の中身は調べない（目で見る。SKILL.md の手順 4）。

  python3 .claude/skills/public-check/audit_history.py [リポジトリ（owner/name）]

GitHub から新しく取り直したものを調べる（手元の作業中のファイルではなく、公開される中身そのもの）。
禁止語と点検語は ~/sekozu-data/dummy_map.json（リポジトリの外）から読む。語そのものはリポジトリにも画面にも出さず「禁止語の n 番目」と出す。
"""
import collections
import glob
import json
import os
import re
import subprocess
import sys
import tempfile

PRIVATE = os.path.expanduser("~/sekozu-data")
REPO = sys.argv[1] if len(sys.argv) > 1 else "naoki-ss/akapen"
BINARY = re.compile(r"\.(png|jpe?g|gif|ico|webp|glb|pdf|woff2?|ttf)$", re.I)
# npm の依存の一覧は外部のURLとハッシュだらけなので、URL とドライブIDの形の検査からは外す（禁止語は調べる）
NOISY = ("package-lock.json",)
# この点検のファイル自身は、秘密情報の形の検査の正規表現を含むので、形の検査からは外す
SELF = ".claude/skills/public-check/audit_history.py"

config = json.load(open(os.path.join(PRIVATE, "dummy_map.json")))
confirmers = set()
for path in glob.glob(os.path.join(PRIVATE, "uploads/*/sheet_status.json")):
    for page in json.load(open(path)).get("pages", {}).values():
        if (page.get("confirmed") or {}).get("by"):
            confirmers.add(page["confirmed"]["by"])
# 画面に出してよい語の一覧（禁止語の番号で出す）
secret_words = [w for w in config["forbidden_words"] if w] + sorted(confirmers)
labels = {w: f"禁止語の {i + 1} 番目" for i, w in enumerate(config["forbidden_words"]) if w}
labels.update({w: "確定者の名前" for w in confirmers})
# 点検語：社内ツール名、他社サービス名、非公開の物件の手がかり、社内システムのドメイン。これも語そのものは画面に出さない
plain_words = config.get("audit_words", [])
plain_labels = {w: f"点検語の {i + 1} 番目" for i, w in enumerate(plain_words)}
allowed_phrases = config.get("allowed_phrases", [])
numbers = [str(n) for n in config["forbidden_numbers"]]
numbers_exempt = tuple(config.get("numbers_exempt_paths", []))
allowed_in_file = config.get("allowed_in_file", {})

PATTERNS = {
    "ドライブIDの形": re.compile(r"(?<![A-Za-z0-9_+/=-])1[A-Za-z0-9_-]{32,43}(?![A-Za-z0-9_+/=-])"),
    "URL": re.compile(r"https?://[^\s\"'<>)\]]+"),
    "秘密情報の形": re.compile(r"sk-ant-[A-Za-z0-9]|ghp_[A-Za-z0-9]{20}|github_pat_|AKIA[0-9A-Z]{16}|BEGIN [A-Z ]*PRIVATE KEY|xox[bp]-"
                          r"|(?i:(api[_-]?key|password|passwd|secret|token)\s*[:=]\s*[\"'][^\"']{8,})"),
    "メールアドレス": re.compile(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[a-z]{2,}"),
}
# 問題にしない URL とメール（開発用の画面、GitHub と Anthropic の noreply）
OK_VALUES = re.compile(r"^(http://localhost(:\d+)?\S*|\S+@users\.noreply\.github\.com|noreply@anthropic\.com)$")

hits = collections.defaultdict(set)


def scan(text, where, path=""):
    stripped = text
    for phrase in allowed_phrases:
        stripped = stripped.replace(phrase, "")
    for word in secret_words:
        if word in stripped and word not in allowed_in_file.get(path, []):
            hits[labels[word]].add(where)
    for word in plain_words:
        if word in text:
            hits[plain_labels[word]].add(where)
    if not path.startswith(numbers_exempt):
        for number in numbers:
            if re.search(r"(?<![0-9,.a-f])" + re.escape(number) + r"(?![0-9a-f])", text):
                hits[f"非公開の物件の数値 {number}"].add(where)
    if path.endswith(NOISY) or path == SELF:
        return
    for name, pattern in PATTERNS.items():
        for match in pattern.finditer(text):
            value = match.group(0)
            if OK_VALUES.match(value):
                continue
            if name == "ドライブIDの形" and not (re.search("[A-Z]", value) and re.search("[a-z]", value)):
                continue
            hits[f"{name}：{value[:60]}"].add(where)


def git(*args, **kw):
    return subprocess.run(["git", *args], capture_output=True, check=True, **kw).stdout


with tempfile.TemporaryDirectory() as tmp:
    clone = os.path.join(tmp, "repo")
    if os.path.isdir(REPO):  # 手元のリポジトリを試しに調べるとき（issue は調べない）
        subprocess.run(["git", "clone", "--quiet", "--no-local", REPO, clone], check=True, capture_output=True)
    else:
        subprocess.run(["gh", "repo", "clone", REPO, clone, "--", "--quiet", "--no-single-branch"], check=True, capture_output=True)
    branches = {b for b in git("-C", clone, "branch", "-r", "--format=%(refname:short)", text=True).split() if b != "origin/HEAD" and b != "origin"}
    commits = git("-C", clone, "rev-list", "--all", text=True).split()
    blobs = 0
    for line in git("-C", clone, "rev-list", "--objects", "--all", text=True).splitlines():
        sha, _, path = line.partition(" ")
        if not path or BINARY.search(path):
            continue
        if git("-C", clone, "cat-file", "-t", sha, text=True).strip() != "blob":
            continue
        try:
            text = git("-C", clone, "cat-file", "-p", sha).decode()
        except UnicodeDecodeError:
            continue
        blobs += 1
        scan(text, path, path)
    log = git("-C", clone, "log", "--all", "--format=%h%x01%an <%ae>%n%cn <%ce>%n%B%x00", text=True)
    for entry in log.split("\x00"):
        if entry.strip():
            short, _, body = entry.strip().partition("\x01")
            scan(body, f"コミット {short}")

query = """query($owner:String!,$name:String!,$endCursor:String){repository(owner:$owner,name:$name){
 issues(first:20,after:$endCursor){pageInfo{hasNextPage endCursor} nodes{number title body
  userContentEdits(first:50){nodes{diff}}
  comments(first:50){nodes{body userContentEdits(first:20){nodes{diff}}}}}}
 pullRequests{totalCount} releases{totalCount} refs(refPrefix:"refs/tags/"){totalCount}}}"""
issues = 0
extras = {}
owner, _, name = REPO.partition("/")
raw = None if os.path.isdir(REPO) else subprocess.run(["gh", "api", "graphql", "--paginate", "-f", f"query={query}", "-F", f"owner={owner}", "-F", f"name={name}"],
                     capture_output=True, text=True)
if raw and raw.returncode:
    sys.exit("issue を取れませんでした：" + raw.stderr[-500:])
for chunk in re.findall(r"\{\"data\".*?(?=\{\"data\"|$)", raw.stdout if raw else "", re.S):
    repo = json.loads(chunk)["data"]["repository"]
    extras = {"PR": repo["pullRequests"]["totalCount"], "リリース": repo["releases"]["totalCount"], "タグ": repo["refs"]["totalCount"]}
    for issue in repo["issues"]["nodes"]:
        issues += 1
        where = f"issue #{issue['number']}"
        scan(issue["title"] + "\n" + (issue["body"] or ""), where)
        for edit in issue["userContentEdits"]["nodes"]:
            scan(edit["diff"] or "", where + " の編集履歴")
        for comment in issue["comments"]["nodes"]:
            scan(comment["body"], where + " のコメント")
            for edit in comment["userContentEdits"]["nodes"]:
                scan(edit["diff"] or "", where + " のコメントの編集履歴")

summary = [f"ブランチ {len(branches)}", f"コミット {len(commits)}", f"文字のファイル {blobs}", f"issue {issues}", *(f"{k} {v}" for k, v in extras.items())]
print(f"対象：{REPO}　" + "、".join(summary))
if not hits:
    print("見つかったもの：0件")
for key in sorted(hits):
    places = sorted(hits[key])
    print(f"- {key}：{len(places)} か所　{', '.join(places[:5])}{' ほか' if len(places) > 5 else ''}")
sys.exit(1 if hits else 0)
