# 検証用のデータ

製品の画面では使わない、精度の確認に使ったデータの置き場です。

| ファイル | 内容 |
|---|---|
| `sample-x/answer-key.json` | 別の物件の正解（デモ用に寸法を加工） |
| `sample-x/eval-report.json` | 正解との突き合わせの結果（`scripts/check/evaluate.py`） |
| `sample-x/run-stats.json` | 同じ条件で繰り返した判定の集計（`scripts/check/repeat_runs.py`） |
| `sample-*/human-compare.json`、`sample-*/human/` | 人の朱書きとAIの指摘の比較と、その切り抜き画像 |
| `sample-b/finding-human-views.json` | 物件Bの指摘ごとの、同じ範囲の人の朱書き |

画像は公開前に目で確認し、`demo-data/image-review.json` に記録しています（`scripts/check/check_public.py` が確認します）。
