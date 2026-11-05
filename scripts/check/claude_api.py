"""Claude API の呼び出しの共通処理。"""
import json
import os
import threading

from common import REPO, write_json

MODEL = "claude-opus-5-5"
MAX_TOKENS = 64000
# 100万トークンあたりの料金（ドル）
PRICE_INPUT = 4
PRICE_OUTPUT = 20
# キャッシュの料金（入力に対する倍率）
CACHE_WRITE_1H = 2.0
CACHE_WRITE_5M = 1.25
CACHE_READ_RATE = 0.1
# 応答の途中で止めた呼び出しの出力トークンの見積もり（日本語と JSON で1文字あたり）
TOKENS_PER_CHAR = 0.5


def usage_usd(usage):
    """API の usage（dict）から費用を出す。キャッシュの書き込みと読み込みも入れる"""
    written = usage.get("cache_creation_input_tokens") or 0
    read = usage.get("cache_read_input_tokens") or 0
    long_lived = (usage.get("cache_creation") or {}).get("ephemeral_1h_input_tokens") or 0
    weighted = usage["input_tokens"] + long_lived * CACHE_WRITE_1H + (written - long_lived) * CACHE_WRITE_5M + read * CACHE_READ_RATE
    return (weighted * PRICE_INPUT + (usage.get("output_tokens") or 0) * PRICE_OUTPUT) / 1_000_000


class Meter:
    """この処理で使った費用。応答の途中で止めた呼び出しも、入力の分と出力の見積もりを入れる"""

    def __init__(self):
        self.lock = threading.Lock()
        self.finished = 0.0
        self.calls = {}

    def begin(self):
        with self.lock:
            handle = object()
            self.calls[handle] = {"input": None, "chars": 0}
            return handle

    def started(self, handle, usage):
        with self.lock:
            self.calls[handle]["input"] = usage_usd({**usage, "output_tokens": 0})

    def wrote(self, handle, chars):
        with self.lock:
            self.calls[handle]["chars"] += chars

    def finish(self, handle, usage):
        with self.lock:
            del self.calls[handle]
            self.finished += usage_usd(usage)

    def _estimate(self, call):
        return (call["input"] or 0.0) + call["chars"] * TOKENS_PER_CHAR * PRICE_OUTPUT / 1_000_000

    def total(self):
        with self.lock:
            return self.finished + sum(self._estimate(call) for call in self.calls.values())

    def snapshot(self):
        """内訳。unanswered は応答が始まる前に止めたので費用が分からない呼び出しの数"""
        with self.lock:
            estimated = sum(self._estimate(call) for call in self.calls.values())
            return {"usd": round(self.finished + estimated, 3), "finished": round(self.finished, 3), "in_flight_estimate": round(estimated, 3),
                    "in_flight": len(self.calls), "unanswered": sum(call["input"] is None for call in self.calls.values())}


METER = Meter()


def load_env():
    """.env.local の値を読む。値は表示しない"""
    path = next((p for p in (REPO / ".env.local", REPO / "scripts/.env.local") if p.exists()), None)
    if path is None:
        return
    for line in path.read_text().splitlines():
        if "=" in line and not line.lstrip().startswith("#"):
            key, value = line.split("=", 1)
            os.environ.setdefault(key.strip(), value.strip().strip("\"'"))


def stream_message(client, system, content, schema, raw_dir, name, effort, on_start=None):
    """1回呼び出し、生の応答を保存する。費用は METER に入る。on_start は応答が始まったときに呼ぶ（キャッシュが使えるようになる）"""
    handle = METER.begin()
    with client.beta.messages.stream(
        model=MODEL,
        max_tokens=MAX_TOKENS,
        betas=["server-side-fallback-2026-07-01"],
        fallbacks="default",
        system=system,
        output_config={"effort": effort, "format": {"type": "json_schema", "schema": schema}},
        messages=[{"role": "user", "content": content}],
    ) as stream:
        for event in stream:
            if event.type == "message_start":
                METER.started(handle, event.message.usage.model_dump(mode="json"))
                if on_start:
                    on_start()
            elif event.type == "text":
                METER.wrote(handle, len(event.text))
            elif event.type == "thinking":
                METER.wrote(handle, len(event.thinking))
        message = stream.get_final_message()
    METER.finish(handle, message.usage.model_dump(mode="json"))
    write_json(raw_dir / f"{name}.json", message.model_dump(mode="json"))
    return message


def call_claude(client, system, content, schema, raw_dir, name, effort="high"):
    """1回呼び出し、生の応答を保存して JSON を返す"""
    message = stream_message(client, system, content, schema, raw_dir, name, effort)
    usage = message.usage
    print(f"{name}: モデル {message.model}、入力 {usage.input_tokens} / 出力 {usage.output_tokens} トークン")
    if message.stop_reason != "end_turn":
        raise SystemExit(f"{name} の応答が完了していません: {message.stop_reason}（{raw_dir}）")
    return json.loads(next(b.text for b in message.content if b.type == "text"))
