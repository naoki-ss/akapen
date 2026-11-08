"""Claude Code が git commit / git push を実行する前に、公開チェックを走らせる。

Claude Code のフック（PreToolUse、Bash）から呼ばれる。問題があれば終了コード 2 で止め、チェックの出力を返す。
commit のときはステージした内容も調べる（--staged）。チェック自体が動かないときも止める。
git の pre-commit フック（.githooks/pre-commit）と同じ検査を、push の前にも、Claude Code の側でも確かめるためのもの。
"""
import json
import os
import re
import subprocess
import sys

GIT = re.compile(r"(?:^|[;&|(]\s*|\s)git\s+(?:-C\s+\S+\s+|-c\s+\S+\s+)*(commit|push)\b")


def main():
    event = json.load(sys.stdin)
    command = (event.get("tool_input") or {}).get("command", "")
    kinds = set(GIT.findall(command))
    if not kinds:
        return
    root = os.environ.get("CLAUDE_PROJECT_DIR") or event.get("cwd") or os.getcwd()
    args = [sys.executable, os.path.join(root, "scripts/check/check_public.py")]
    if "commit" in kinds:
        args.append("--staged")
    try:
        done = subprocess.run(args, cwd=root, capture_output=True, text=True, timeout=300)
    except Exception as error:  # チェックが動かないときも止める
        print(f"公開チェックを実行できなかったので、git {'/'.join(sorted(kinds))} を止めました：{error}", file=sys.stderr)
        sys.exit(2)
    if done.returncode != 0:
        print(f"公開チェックに通らないので、git {'/'.join(sorted(kinds))} を止めました。\n{done.stdout[-3000:]}{done.stderr[-2000:]}", file=sys.stderr)
        sys.exit(2)


main()
