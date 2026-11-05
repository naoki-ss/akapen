"""Claude API の呼び出しの共通処理。"""
import json
import os

from common import REPO, write_json

MODEL = "claude-opus-5-5"
MAX_TOKENS = 64000
# 100万トークンあたりの料金（ドル）
PRICE_INPUT = 4
PRICE_OUTPUT = 20


def load_env():
    """.env.local の値を読む。値は表示しない"""
    path = next((p for p in (REPO / ".env.local", REPO / "scripts/.env.local") if p.exists()), None)
    if path is None:
        return
    for line in path.read_text().splitlines():
        if "=" in line and not line.lstrip().startswith("#"):
            key, value = line.split("=", 1)
            os.environ.setdefault(key.strip(), value.strip().strip("\"'"))


def call_claude(client, system, content, schema, raw_dir, name, effort="high"):
    """1回呼び出し、生の応答を保存して JSON を返す"""
    with client.beta.messages.stream(
        model=MODEL,
        max_tokens=MAX_TOKENS,
        betas=["server-side-fallback-2026-07-01"],
        fallbacks="default",
        system=system,
        output_config={"effort": effort, "format": {"type": "json_schema", "schema": schema}},
        messages=[{"role": "user", "content": content}],
    ) as stream:
        message = stream.get_final_message()
    write_json(raw_dir / f"{name}.json", message.model_dump(mode="json"))
    usage = message.usage
    print(f"{name}: モデル {message.model}、入力 {usage.input_tokens} / 出力 {usage.output_tokens} トークン")
    if message.stop_reason != "end_turn":
        raise SystemExit(f"{name} の応答が完了していません: {message.stop_reason}（{raw_dir}）")
    return json.loads(next(b.text for b in message.content if b.type == "text"))
