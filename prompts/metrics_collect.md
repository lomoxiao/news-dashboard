# ニュースダッシュボード 日次マクロ指標収集（Codex）

作業ディレクトリ: このリポジトリのルート（絶対パスに依存しないこと）。`AGENTS.md` に従う。

あなたの仕事は **指標の値と取得元を集めて下書きを作ること** だけです。
蓄積データ（Firestore の metricsMaster や `docs/data/metrics/` 配下）を直接編集してはいけません。
検査・蓄積・公開は TypeScript（`npm run metrics:validate` / `npm run metrics:ingest`）が行います。

## 対象日

- 対象日 = **実行日（日本時間）の前日**。例：2026-10-04 の朝に実行 → 対象日 2026-10-03。
- 土日も含めて毎日作成する（土日は市場の値が null になるだけ）。

## 収集項目（4つ）

### 1. arXiv 投稿数（arxiv_ai / arxiv_quantum）
- **必ず arXiv API の総件数（`opensearch:totalResults`）を使う。RSS は使わない**（RSS は1ページ分しか返らず、件数が頭打ちになる）。
- 対象日（UTC の暦日）に投稿された論文数を数える。`max_results=0` にすると件数だけ返る。
  - cs.AI: `https://export.arxiv.org/api/query?search_query=cat:cs.AI+AND+submittedDate:[YYYYMMDD0000+TO+YYYYMMDD2359]&max_results=0`
  - quant-ph: `https://export.arxiv.org/api/query?search_query=cat:quant-ph+AND+submittedDate:[YYYYMMDD0000+TO+YYYYMMDD2359]&max_results=0`
- `source_url` には実際に叩いた URL をそのまま書く。
- 連続で叩くときは 3 秒以上あける（arXiv の利用規約）。HTTP 429（アクセス過多）が返ったら
  30 秒以上待って最大 3 回まで再試行し、それでも失敗した場合だけ null＋`null_reason` にする。

### 2. 日経平均 終値（nikkei）／ 3. USD/JPY 終値（usdjpy）
- 対象日の終値を数値で記録する。毎日 **同じ提供元** を使う。
  - 推奨: Yahoo Finance の日次チャート API（`https://query1.finance.yahoo.com/v8/finance/chart/%5EN225?interval=1d&range=1mo`、`.../chart/JPY=X?...`）。取れなければ日経平均は公式ヒストリカル（indexes.nikkei.co.jp）など。
- `source_url` には値を確認した URL を書く。
- **日付の割り当てに注意：** チャート API の `timestamp` は UTC の秒。これを UTC の日付に直すと、
  為替（JPY=X）は前日にずれる（ロンドン時間の0時区切りのため）。必ず `meta.exchangeTimezoneName`
  （または `meta.gmtoffset`）の取引所ローカル時間に変換してから日付を決めること。
  平日（祝日以外）なのに値が無い日が続く、特定の曜日だけ毎週欠ける、といった場合は日付ずれを疑う。
- **土日・祝日・取得失敗は `null` にして `null_reason` を書く**（例: "market closed (Saturday)", "market holiday (JP)", "fetch failed: HTTP 429"）。0 や推測値を入れてはいけない。

## 出力：`.runtime/metrics/YYYY-MM-DD.json`（YYYY-MM-DD = 対象日）

```json
{
  "collected_at": "2026-10-04T06:30:00+09:00",
  "days": [
    {
      "date": "2026-10-03",
      "values": {
        "arxiv_ai":      { "value": 512, "source_url": "https://export.arxiv.org/api/query?search_query=cat:cs.AI+AND+submittedDate:[202610030000+TO+202610032359]&max_results=0" },
        "arxiv_quantum": { "value": 143, "source_url": "https://export.arxiv.org/api/query?search_query=cat:quant-ph+AND+submittedDate:[202610030000+TO+202610032359]&max_results=0" },
        "nikkei":        { "value": null, "null_reason": "market closed (Saturday)" },
        "usdjpy":        { "value": null, "null_reason": "market closed (Saturday)" }
      }
    }
  ]
}
```

ルール:
- 値があるなら `source_url` 必須。値が `null` なら `null_reason` 必須。
- 上の4項目以外のキーを追加しない（検査で不合格になる）。

## 手順

1. 上の形式で下書きを保存する。
2. `npm run metrics:validate -- .runtime/metrics/YYYY-MM-DD.json`
3. 不合格なら理由を読んで直す（推測値で埋めて合格させるのは禁止。取れないなら null＋理由）。3回失敗したら公開せず終了。
4. `npm run metrics:ingest -- .runtime/metrics/YYYY-MM-DD.json`
5. `npm run verify:public`
6. `npm run mark-run -- metrics-YYYY-MM-DD published`

指標の失敗はニュース日報の公開を取り消さない。
