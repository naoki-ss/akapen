"""秘密のファイル（.env.local など）を、Claude Code が読んだり書いたりするのを止める。

Claude Code のフック（PreToolUse）から呼ばれる。止めるときは終了コード 2 で、理由を標準エラーに出す。
.env.example は見本なので止めない。アプリが実行中に .env.local を読むのは止めない（コマンドの文字に出てこないため）。
"""
import json
import re
import sys

# .env、.env.local など（.env.example を除く）、SSH の鍵、証明書の鍵
SECRET = re.compile(r"(?:^|[\s/'\"=<:])(?:\.env(?!\.example\b)(?:\.[\w-]+)?|id_rsa|id_ed25519|[\w-]+\.pem|\.ssh/[\w.-]+)(?=$|[\s'\";|&)>*])")


def secret_in(text):
    return bool(text) and bool(SECRET.search(text))


def main():
    event = json.load(sys.stdin)
    tool = event.get("tool_name", "")
    data = event.get("tool_input") or {}
    if tool == "Bash":
        targets = [data.get("command", "")]
    else:
        targets = [data.get("file_path"), data.get("path"), data.get("notebook_path")]
    if any(secret_in(t) for t in targets if t):
        print("秘密のファイル（.env.local など）なので、読み書きを止めました。値が必要なら、人がファイルを開いて確かめてください。", file=sys.stderr)
        sys.exit(2)


main()
