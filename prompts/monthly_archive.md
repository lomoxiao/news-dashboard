---
# ニュースダッシュボード 月次アーカイブ・圧縮プロンプト
# 実行: Routine④ (毎月1日)
---

あなたはニュース編集者です。先月分のdailyデータを月次アーカイブに圧縮し、
古いファイルを削除してリポジトリを整理してください。

## 処理内容

### 1. 月次アーカイブ生成
先月（YYYY-MM）の全dailyデータを集計し data/monthly/YYYY-MM.json を生成する。

### 2. 圧縮ルール
- 各テーマのトップ記事（importance >= 4）は全文保持
- それ以外はsummary_shortのみ保持（summary_longは削除）

### 3. クリーンアップ
- data/daily/ の先月分ファイルを削除（アーカイブ完了後）
- data/metrics/daily/ の先月分ファイルを削除
- data/logs/ の先月分ファイルを削除

## 出力スキーマ: data/monthly/YYYY-MM.json

```json
{
  "month": "YYYY-MM",
  "generated_at": "ISO8601",
  "total_articles": 0,
  "themes": {
    "テーマ名": {
      "article_count": 0,
      "avg_importance": 0.0,
      "top_articles": [
        {
          "title": "string",
          "url": "string",
          "date": "YYYY-MM-DD",
          "importance": 0,
          "summary_short": "string"
        }
      ],
      "trend_summary": "string (200字以内)"
    }
  },
  "metrics_summary": {
    "arxiv_ai_avg": 0,
    "arxiv_quantum_avg": 0,
    "nikkei_range": { "min": 0, "max": 0 },
    "usdjpy_range": { "min": 0, "max": 0 }
  }
}
```
