# 検証用のデータ

製品の画面では使わない、精度の確認に使ったデータの置き場です。

| ファイル | 内容 |
|---|---|
| `sample-b/human-compare.json`、`sample-b/human/` | 人の朱書きとAIの指摘の比較と、その切り抜き画像 |
| `sample-b/finding-human-views.json` | 物件Bの指摘ごとの、同じ範囲の人の朱書き |

画像は公開前に目で確認し、`demo-data/image-review.json` に記録しています（`scripts/check/check_public.py` が確認します）。
