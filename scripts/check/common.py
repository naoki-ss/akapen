"""施工図チェックの共通処理。

実図面と生の結果は ~/sekozu-data/ に置き、リポジトリには入れない（CLAUDE.md 参照）。
"""
import json
from pathlib import Path

PRIVATE = Path.home() / "sekozu-data"
REPO = Path(__file__).resolve().parents[2]
RUNS = PRIVATE / "check-runs"
# 検証用のデータ（人の朱書き、正解、採点）。画面では使わない
VALIDATION = REPO / "validation"

def write_json(path: Path, data) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n")
