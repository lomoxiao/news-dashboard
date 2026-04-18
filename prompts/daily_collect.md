---
# ニュースダッシュボード 日次収集プロンプト
# 実行: claude --prompt "$(cat prompts/daily_collect.md)"
---

<!-- Layer1: ロール定義 -->
{% include _role.md %}

<!-- Layer2: 収集手順 -->

## 収集手順（必ずこの順番で実行すること）

### Step1: ソース収集
config.json の themes[] を読み込み、各テーマのキーワードで
Web Search を実行する。1テーマあたり最低3件・最大10件収集。

### Step2: テーマ毎振り分け（優先順位順）
1. NTTドコモ関連キーワードを含む記事
   → 内容がAIであってもNTTドコモテーマに優先振り分け
2. 複数テーマに該当する記事
   → 最も関連度の高いテーマに1件として計上
   → 他テーマには related[] にURLのみ記載（本文重複なし）
3. 量子コンピュータ × 金融の記事（例：量子暗号）
   → 「量子コンピュータ」テーマに計上し、金融決済のrelated[]にも記載

### Step3: 重要度スコアリング
各記事を以下の基準で1〜5点でスコアリングする。
- 複数メディアで共通して報じられている: +2点
- 数値・データが含まれている: +1点
- 社会・経済・技術への影響が明確: +1点
- 一次情報源（公式発表・論文）である: +1点
- テーマの importance_boost を加算する
スコア3点以上のみ採用する。

### Step4: 本文fetch
採用記事のURLをfetchして本文を取得する。
取得できない場合はリード文のみで処理を続行する。
量子コンピュータの英語論文はアブストラクトのみ取得し日本語に翻訳する。

### Step5: サマリー生成
_style_instructions.md の指示に従い、4文体でサマリーを同時生成する。

### Step6: 自己チェック（出力前に必ず実行）
- [ ] すべての summary_short が50字以内
- [ ] 意見・推測表現が含まれていない
- [ ] すべての記事にURLが含まれている
- [ ] importance スコアが基準通り
- [ ] テーマ間の重複本文がない
問題があれば修正してから出力すること。

### Step7: JSON出力・エラー処理
data/daily/YYYY-MM-DD.json と data/index.json を更新する。
- Web Searchで結果が0件: 該当テーマをskipしてdocs/data/logs/YYYY-MM-DD.logに記録
- fetchが失敗: リード文のみで処理続行・fetch_failed:true を付与
- JSON生成エラー: 処理中断しエラー内容をdocs/data/logs/YYYY-MM-DD.logに記録

**出力パス**: `docs/data/daily/YYYY-MM-DD.json`、`docs/data/index.json`

<!-- Layer3: 出力フォーマット -->
{% include _output_format.md %}
