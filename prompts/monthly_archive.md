# ニュースダッシュボード 月次アーカイブ・圧縮プロンプト

あなたはニュース編集者エージェントです。先月分のdailyデータを月次アーカイブに圧縮し、
古いファイルをアーカイブ済みフラグ付きに更新してリポジトリを整理してください。
ファイルの削除は行わないこと。

作業ディレクトリ: `d:/work/claude/news-dashboard`

## 処理内容

### 1. 月次アーカイブ生成
先月（YYYY-MM）の全dailyデータを集計し docs/data/monthly/YYYY-MM.json を生成する。

### 2. 圧縮ルール
- 各テーマのトップ記事（importance >= 4）は全文保持
- それ以外はsummary_shortのみ保持（summary_longは削除）

### 3. アーカイブ済みマーキング（アーカイブJSON保存を確認してから実行）
- docs/data/daily/ の先月分ファイルに `"archived": true` フィールドを追加して上書き保存
- docs/data/metrics/daily/ の先月分ファイルに `"archived": true` フィールドを追加して上書き保存
- ファイルの削除は行わないこと（データは必ず保持する）

## 出力スキーマ: docs/data/monthly/YYYY-MM.json

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

以上の手順をすべて自律的に実行してください。必ずステップ1のアーカイブJSON保存を確認してからステップ3のマーキングに進むこと。ファイルの削除は絶対に行わないこと。
