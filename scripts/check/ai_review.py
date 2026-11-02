"""Claude API で図面を読み、プログラムの候補の確認と追加の指摘を行う。

実図面を送るので、リクエストの要約と生の応答は ~/sekozu-data/check-runs/ にだけ保存する。
指摘の根拠は「図面から取った単語のID」で受け取り、実在しないIDを含む指摘は捨てる。

  python ai_review.py --dry-run   # 送る内容の量だけ確認する（APIは呼ばない）
  python ai_review.py             # .env.local の ANTHROPIC_API_KEY を使って実行する
"""
import argparse
import base64
import json
import os
import subprocess
import sys
from datetime import datetime

import anthropic
import pymupdf

from common import DOCS, REPO, RUNS, evidence, norm_bbox, open_page, page_words, union, write_json
from program_checks import TABLE_PATH

MODEL = "claude-opus-5-5"
MAX_TOKENS = 64000

# 送るページ（doc, ページ番号）。杭リスト・基礎リスト・基礎梁リストまで含める
PAGES = [
    ("kui_new", 1),
    ("kui_old", 1),
    ("kui_old", 2),
    ("kiso_fuse", 1),
    ("kiso_danmen", 1),
    ("kozo", 8),
    ("kozo", 9),
    ("kozo", 17),
    ("kozo", 18),
    ("kozo", 19),
]

CATEGORIES = ["杭仕様", "施工順", "符号", "レベル", "寸法", "図面枠", "その他"]

SYSTEM = """あなたは建設会社の施工図チェック担当です。施工図を設計図（構造図）と照らし合わせ、施工前に直すべき食い違いを見つけます。

入力:
- 図面のPDFと、各ページから取り出した単語の一覧（ID、文字、位置）
- プログラムが見つけた候補の一覧
- 図面の改訂の目的

判断の基準:
- 改訂の目的どおりの変更は指摘しません。changes に記録するだけです。ただし、その変更が他の図面や表に反映されていない場合は、反映漏れとして指摘します。
- 仮設の部材が構造図にないことは、それだけでは指摘しません。
- 指摘は、施工に影響する実質的な食い違いに絞ります。図面の体裁や好みは指摘しません。
- レベルを比べるときは、図面に書かれた基準で換算してから比べます。図面に書かれていない納まりがありえる場合は、断定せずに確認を求めます。
- 候補の確認では、図面を読んで本当に食い違っているかを判断し、誤りなら rejected_candidates に理由を書きます。

文章の書き方:
- 「矛盾です」「誤りです」と断定せず、「〜と〜が食い違っています」「〜の可能性があります。ご確認ください」と書きます。
- 2つの図面の値を、どちらが正しいかを決めつけずに並べます。
- 現場名、会社名、人名は書きません。

根拠:
- 指摘には根拠を2つ以上付けます（同じ図面内の食い違いなら同じ図面の2か所でかまいません）。
- 根拠の word_ids には、該当箇所の単語のIDを、単語の一覧からそのまま写します。文字として存在しない内容を根拠にしません。"""

SCHEMA = {
    "type": "object",
    "additionalProperties": False,
    "required": ["findings", "rejected_candidates", "changes"],
    "properties": {
        "findings": {
            "type": "array",
            "items": {
                "type": "object",
                "additionalProperties": False,
                "required": ["candidate_id", "category", "title", "content", "severity", "members", "evidence"],
                "properties": {
                    "candidate_id": {"type": ["string", "null"]},
                    "category": {"type": "string", "enum": CATEGORIES},
                    "title": {"type": "string"},
                    "content": {"type": "string"},
                    "severity": {"type": "string", "enum": ["高", "中", "低"]},
                    "members": {
                        "type": "object",
                        "additionalProperties": False,
                        "required": ["grids", "marks", "floor"],
                        "properties": {
                            "grids": {"type": "array", "items": {"type": "string"}},
                            "marks": {"type": "array", "items": {"type": "string"}},
                            "floor": {"type": "string"},
                        },
                    },
                    "evidence": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "additionalProperties": False,
                            "required": ["where", "text", "word_ids"],
                            "properties": {
                                "where": {"type": "string"},
                                "text": {"type": "string"},
                                "word_ids": {"type": "array", "items": {"type": "string"}},
                            },
                        },
                    },
                },
            },
        },
        "rejected_candidates": {
            "type": "array",
            "items": {
                "type": "object",
                "additionalProperties": False,
                "required": ["candidate_id", "reason"],
                "properties": {"candidate_id": {"type": "string"}, "reason": {"type": "string"}},
            },
        },
        "changes": {
            "type": "array",
            "items": {
                "type": "object",
                "additionalProperties": False,
                "required": ["description", "intended"],
                "properties": {"description": {"type": "string"}, "intended": {"type": "boolean"}},
            },
        },
    },
}


def load_env():
    """.env.local の値を読む。値は表示しない"""
    path = next((p for p in (REPO / ".env.local", REPO / "scripts/.env.local") if p.exists()), None)
    if path is None:
        return
    for line in path.read_text().splitlines():
        if "=" in line and not line.lstrip().startswith("#"):
            key, value = line.split("=", 1)
            os.environ.setdefault(key.strip(), value.strip().strip("\"'"))


def build_word_index():
    """(本文に入れる一覧, ID → 単語の位置)"""
    lines, index = [], {}
    for doc, page_no in PAGES:
        page = open_page(doc, page_no)
        lines.append(f"\n## {doc} p{page_no}（{DOCS[doc]['name']}）")
        words = page_words(page)
        if not words:
            lines.append("文字データなし（画像を読んでください。根拠の word_ids は空にせず PAGE を使います）")
            word_id = f"{doc}:{page_no}:PAGE"
            index[word_id] = {"doc": doc, "page": page_no, "rect": tuple(page.rect), "text": ""}
            lines.append(f"{word_id} PAGE")
            continue
        for i, word in enumerate(words):
            word_id = f"{doc}:{page_no}:{i}"
            index[word_id] = {"doc": doc, "page": page_no, "rect": word["rect"], "text": word["text"]}
            x, y, *_ = norm_bbox(page, word["rect"])
            lines.append(f"{word_id} {word['text']} ({x:.3f},{y:.3f})")
    return "\n".join(lines), index


def build_pdf_blocks():
    """図面ごとに必要なページだけのPDFにして渡す"""
    blocks = []
    by_doc = {}
    for doc, page_no in PAGES:
        by_doc.setdefault(doc, []).append(page_no)
    for doc, pages in by_doc.items():
        source = pymupdf.open(DOCS[doc]["path"])
        subset = pymupdf.open()
        for page_no in pages:
            subset.insert_pdf(source, from_page=page_no - 1, to_page=page_no - 1)
        pages_text = ",".join(f"p{p}" for p in pages)
        blocks.append({"type": "text", "text": f"次のPDFは {doc}（{DOCS[doc]['name']}）の {pages_text} です。"})
        blocks.append({
            "type": "document",
            "source": {
                "type": "base64",
                "media_type": "application/pdf",
                "data": base64.standard_b64encode(subset.tobytes()).decode(),
            },
        })
    return blocks


def build_user_content(program, word_list):
    candidates = [
        {k: f[k] for k in ("id", "category", "title", "content", "members")}
        for f in program["findings"]
    ]
    notes = (
        "図面の改訂の目的: kui_new は kui_old の施工順を変更した版です。打設順が変わること自体は意図した変更です。\n\n"
        f"プログラムの候補:\n{json.dumps(candidates, ensure_ascii=False, indent=1)}\n\n"
        f"単語の一覧（ID 文字 (x,y)。x,y はページに対する0〜1の位置）:\n{word_list}\n\n"
        "候補を確認し、プログラムの照合では見つからない食い違いがあれば挙げてください。"
        "符号、寸法、部材サイズ、レベルを、施工図同士と、施工図と構造図の間で照合してください。"
    )
    return build_pdf_blocks() + [{"type": "text", "text": notes}]


def resolve_evidence(items, index):
    """単語IDを枠に変える。実在しないIDがあれば None を返す"""
    resolved = []
    for item in items:
        words = []
        for word_id in item["word_ids"]:
            if word_id not in index:
                return None
            words.append(index[word_id])
        if not words or len({(w["doc"], w["page"]) for w in words}) != 1:
            return None
        resolved.append(evidence(
            words[0]["doc"], words[0]["page"], union(w["rect"] for w in words), item["where"], item["text"],
        ))
    return resolved


def merge(program, reply, index):
    """プログラムの候補とAIの判断をまとめる"""
    by_id = {f["id"]: f for f in program["findings"]}
    rejected = {r["candidate_id"]: r["reason"] for r in reply["rejected_candidates"]}
    findings, dropped = [], []
    used = set()
    for item in reply["findings"]:
        resolved = resolve_evidence(item["evidence"], index)
        candidate = by_id.get(item["candidate_id"] or "")
        if candidate:
            used.add(candidate["id"])
            merged = dict(candidate, source="program+ai")
            merged["content"] = item["content"]
            if resolved:
                merged["evidence"] = resolved
            findings.append(merged)
        elif resolved and len(resolved) >= 2:
            findings.append({
                "category": item["category"],
                "severity": item["severity"],
                "title": item["title"],
                "content": item["content"],
                "members": item["members"],
                "model_refs": [],
                "evidence": resolved,
                "source": "ai",
            })
        else:
            dropped.append(item)
    # AIが触れなかった候補も、プログラムの結果として残す
    for finding in program["findings"]:
        if finding["id"] not in used and finding["id"] not in rejected:
            findings.append(finding)
    for i, finding in enumerate(findings, 1):
        finding["id"] = f"F-{i:02d}"
    return {
        "findings": findings,
        "changes": program["changes"],
        "ai_changes": reply["changes"],
        "rejected_candidates": rejected,
        "dropped_without_evidence": dropped,
    }


TABLE_SCHEMA = {
    "type": "object",
    "additionalProperties": False,
    "required": ["rows"],
    "properties": {
        "rows": {
            "type": "array",
            "items": {
                "type": "object",
                "additionalProperties": False,
                "required": ["no", "order"],
                "properties": {"no": {"type": "integer"}, "order": {"type": "integer"}},
            },
        }
    },
}


def call_claude(client, system, content, schema, raw_dir, name):
    """1回呼び出し、生の応答を保存して JSON を返す"""
    with client.beta.messages.stream(
        model=MODEL,
        max_tokens=MAX_TOKENS,
        betas=["server-side-fallback-2026-07-01"],
        fallbacks="default",
        system=system,
        output_config={"effort": "high", "format": {"type": "json_schema", "schema": schema}},
        messages=[{"role": "user", "content": content}],
    ) as stream:
        message = stream.get_final_message()
    write_json(raw_dir / f"{name}.json", message.model_dump(mode="json"))
    usage = message.usage
    print(f"{name}: モデル {message.model}、入力 {usage.input_tokens} / 出力 {usage.output_tokens} トークン")
    if message.stop_reason != "end_turn":
        raise SystemExit(f"{name} の応答が完了していません: {message.stop_reason}（{raw_dir}）")
    return json.loads(next(b.text for b in message.content if b.type == "text"))


def read_table(client, raw_dir):
    """画像PDFの杭一覧表から打設順を読む"""
    source = pymupdf.open(DOCS["kui_old"]["path"])
    subset = pymupdf.open()
    subset.insert_pdf(source, from_page=1, to_page=1)
    content = [
        {
            "type": "document",
            "source": {
                "type": "base64",
                "media_type": "application/pdf",
                "data": base64.standard_b64encode(subset.tobytes()).decode(),
            },
        },
        {"type": "text", "text": "図面の杭一覧表から、杭番号（No.1〜No.18）ごとの打設順を読み取ってください。TC杭は含めません。"},
    ]
    reply = call_claude(client, "図面の表を正確に読み取ります。", content, TABLE_SCHEMA, raw_dir, "read_table")
    return {str(row["no"]): row["order"] for row in reply["rows"]}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    if args.dry_run:
        program = json.loads((RUNS / "program.json").read_text())
        word_list, index = build_word_index()
        content = build_user_content(program, word_list)
        pdf_bytes = sum(len(b["source"]["data"]) for b in content if b["type"] == "document")
        print(f"単語 {len(index)} 件、本文 {len(word_list)} 文字、PDF {pdf_bytes / 1e6:.1f}MB（base64）")
        return

    load_env()
    if not os.environ.get("ANTHROPIC_API_KEY"):
        raise SystemExit(".env.local に ANTHROPIC_API_KEY がありません")

    client = anthropic.Anthropic()
    stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    raw_dir = RUNS / f"ai-{stamp}"

    # 1. 画像の一覧表を読み、手で転記した値と置き換えてプログラム照合をやり直す
    orders = read_table(client, raw_dir)
    previous = json.loads(TABLE_PATH.read_text())["orders"]
    differs = {k: (previous.get(k), orders.get(k)) for k in sorted(set(previous) | set(orders), key=int)
               if previous.get(k) != orders.get(k)}
    print(f"一覧表の読み取り {len(orders)} 行、手の転記との差 {len(differs)} 件: {differs}")
    write_json(TABLE_PATH, {"source": f"Claude API（{MODEL}）が読み取り", "orders": orders})
    subprocess.run([sys.executable, "-W", "ignore", "program_checks.py"], check=True, cwd=REPO / "scripts/check")

    # 2. 候補の確認と追加の照合
    program = json.loads((RUNS / "program.json").read_text())
    word_list, index = build_word_index()
    content = build_user_content(program, word_list)
    reply = call_claude(client, SYSTEM, content, SCHEMA, raw_dir, "review")
    result = merge(program, reply, index)
    write_json(raw_dir / "merged.json", result)
    write_json(RUNS / "latest.json", result)
    print(f"指摘 {len(result['findings'])} 件、候補の却下 {len(result['rejected_candidates'])} 件、"
          f"根拠不足で除外 {len(result['dropped_without_evidence'])} 件。生データ: {raw_dir}")


if __name__ == "__main__":
    main()
