# ニュースダッシュボード マクロ指標の遡及取得（1回だけ実行）

作業ディレクトリ: このリポジトリのルート。`AGENTS.md` と `prompts/metrics_collect.md` のルールに従う。

## 目的

指標収集が止まっていた期間を埋め、あわせて以前の推定値・頭打ちの値（arXiv が 50 件で止まっている等）を
実測値で置き換える。

## 対象期間

**2026-04-12 〜 2026-10-03**（両端を含む毎日）

## やること

1. `prompts/metrics_collect.md` と同じ4項目・同じ取得方法で、対象期間の各日の値を集める。
   - arXiv は日ごとに API を叩く（1日2回 × 期間日数。3 秒以上あける）。
   - 市場は日次チャート API を期間指定で1回取得し、日付ごとに終値を割り当てる（`range=1y` など）。
     データに無い日（土日・祝日）は null＋`null_reason`。
2. すべての日を1つの下書きにまとめる：`.runtime/metrics/backfill-2026-04-12_2026-10-03.json`
   （形式は metrics_collect.md と同じ。`days` に全日分を古い順で並べる）
3. `npm run metrics:validate -- .runtime/metrics/backfill-2026-04-12_2026-10-03.json`
4. 合格したら、まず `npm run metrics:ingest -- .runtime/metrics/backfill-2026-04-12_2026-10-03.json --dry-run` で件数を確認し、
   問題なければ `--dry-run` を外して実行する。
5. `npm run verify:public`

推測値で埋めてはいけない。取れない日は null＋理由でよい。
