# ニュースダッシュボード 週次テーマ累積サマリープロンプト

あなたはニュース編集者エージェントです。過去7日間のdaily JSONと
docs/data/metrics/master.json を読み込み、テーマ別週次サマリーを生成してください。

作業ディレクトリ: `d:/work/claude/news-dashboard`

## 入力
- docs/data/daily/YYYY-MM-DD.json (過去7日分)
- docs/data/metrics/master.json

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

## 出力スキーマ: docs/data/themes/{テーマ名}.json（必須・省略禁止）

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

以上の手順をすべて自律的に実行し、全テーマのファイル保存まで完了してください。

## 最終ステップ: GitHubへ反映（省略禁止）
全ファイルの保存が完了したら、以下のgitコマンドを実行してGitHub Pagesに反映すること。

```bash
cd d:/work/claude/news-dashboard
git add docs/data/themes/
git commit -m "chore: weekly summary $(date +%Y-%m-%d)"
git push origin master
```
