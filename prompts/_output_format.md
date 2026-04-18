# Layer3: 出力フォーマット定義

## サマリー生成ルール
- summary_short: 1文・50字以内・主語と述語を含む
- summary_long: 3〜5文・150字以内・背景→事実→影響の順で記述
- 数値は必ず単位付きで記載（例：「約30%増」「152円台」）
- 固有名詞は正式名称を使用（略称不可）
- 量子コンピュータ論文：英語アブストラクトを日本語に翻訳してサマリー作成

## 重要度スコア（importance）の基準
- 5: 社会・経済への広範な影響が確定
- 4: 特定業界・分野への明確な影響
- 3: 注目度は高いが、影響範囲は限定的
- 2: 参考情報として有用
- 1: トレンド把握用途

## JSONスキーマ: data/daily/YYYY-MM-DD.json

```json
{
  "date": "YYYY-MM-DD",
  "generated_at": "ISO8601",
  "top_summary": {
    "journalist": {
      "lead": "string",
      "highlights": [
        { "theme": "string", "text": "string (150字以内)" }
      ],
      "must_read": {
        "title": "string",
        "url": "string",
        "reason": "string",
        "bookmark_count": 0
      }
    },
    "friendly": { "...": "同上" },
    "brief": { "...": "同上" },
    "analytical": { "...": "同上" }
  },
  "topics": [
    {
      "theme": "string",
      "category": "interested | must_know",
      "trend_score": 0,
      "trend_history": [0],
      "summary_short": "string (50字以内)",
      "summary_long": "string (150字以内)",
      "articles": [
        {
          "title": "string",
          "url": "string",
          "source": "string",
          "summary_short": "string (50字以内)",
          "summary_long": "string (150字以内)",
          "importance": 1,
          "fetch_failed": false
        }
      ],
      "related": ["url"]
    }
  ],
  "chart_data": {
    "trend_scores": { "themeName": 0 },
    "source_distribution": { "sourceName": 0 },
    "importance_distribution": { "1": 0, "2": 0, "3": 0, "4": 0, "5": 0 }
  }
}
```

## JSONスキーマ: docs/data/index.json 更新ルール
- reports[] に { "date": "YYYY-MM-DD", "headline": "string (1行)" } を先頭に追加
- all_sources[] に新規ソースがあれば追加（url・name・count を更新）
- 最大365件を保持（古いものから削除）
