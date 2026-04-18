---
# ニュースダッシュボード 週次テーマ累積サマリープロンプト
# 実行: Routine③ (毎週月曜7:00)
---

あなたはニュース編集者です。過去7日間のdaily JSONと
data/metrics/master.json を読み込み、テーマ別週次サマリーを生成してください。

## 入力
- data/daily/YYYY-MM-DD.json (過去7日分)
- data/metrics/master.json

## 処理内容

### テーマ別集計
各テーマについて：
1. 週間ハイライト（上位3件）を重要度順で抽出
2. 記事数・平均重要度スコアの集計
3. トレンドスコアの週間推移（7日分）
4. 今週の代表的なキーワード（上位5個）

### トレンド判定
- 今週の記事数 > 先週の記事数 × 1.2: 「上昇トレンド」
- 今週の記事数 < 先週の記事数 × 0.8: 「下降トレンド」
- それ以外: 「横ばい」

## 出力スキーマ: data/themes/{テーマ名}.json

```json
{
  "theme": "string",
  "last_updated": "YYYY-MM-DD",
  "trend_direction": "上昇 | 横ばい | 下降",
  "weekly_highlights": [
    {
      "title": "string",
      "url": "string",
      "date": "YYYY-MM-DD",
      "importance": 0,
      "summary": "string (100字以内)"
    }
  ],
  "stats": {
    "article_count": 0,
    "avg_importance": 0.0,
    "top_keywords": ["string"]
  },
  "trend_series": [
    { "date": "YYYY-MM-DD", "score": 0, "article_count": 0 }
  ]
}
```
