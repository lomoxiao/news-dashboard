---
# ニュースダッシュボード 日次マクロ指標収集プロンプト
# 実行: Routine② (毎朝6:30 ※Routine①完了後)
---

あなたはデータ収集エージェントです。以下の指標を収集し、
docs/data/metrics/daily/YYYY-MM-DD.json と docs/data/metrics/master.json を更新してください。

## 収集項目

### 1. arXiv論文数
- ArXiv RSS (cs.AI) から当日投稿数を取得
- ArXiv RSS (quant-ph) から当日投稿数を取得

### 2. Google Trends スコア
- config.json の themes[].name ごとにキーワードをWeb Searchで取得
- 相対的な検索関心度（0〜100）を推定して記録

### 3. 株価・為替
- Yahoo Finance APIで日経平均終値・USD/JPY終値を取得
- 取得できない場合は null を記録

## 出力スキーマ: data/metrics/daily/YYYY-MM-DD.json

```json
{
  "date": "YYYY-MM-DD",
  "arxiv_ai": 0,
  "arxiv_quantum": 0,
  "trends": {
    "最新AI情報": 0,
    "NTTドコモ": 0,
    "量子コンピュータ": 0,
    "金融決済": 0
  },
  "markets": {
    "nikkei": null,
    "usdjpy": null
  }
}
```

## master.json 更新ルール
- 各 series の data[] に { "date": "YYYY-MM-DD", "value": N } を追加
- データは時系列順（古い順）で保持
- 最大365件を保持（古いものから削除）
