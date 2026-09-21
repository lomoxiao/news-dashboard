# Payments Landscape — Firebase バックエンド一式

`decisions/2026-09-21-payments-landscape-firebase-architecture.md`（Vault内）に基づく成果物です。フェーズ0「準備」・フェーズ1「公開データの最小構築＋4画面（PC）静的サイト」は完了しています（プロジェクトID: `payments-landscape-registry`）。企業ページの「最近の記事（未確認・自動要約）」欄（news-dashboardの記事との連携、newsRefs）も実装済みです。

## 位置づけ

このリポジトリ内での役割分担：

- **`landscape/`（このフォルダ）** — Firestoreセキュリティルール・同期スクリプトなど、公開しない裏方一式。`docs/` の外にあるので GitHub Pages では配信されない。
- **`docs/landscape/`** — 実際にGitHub Pagesで配信される静的サイト本体（全体図・企業の関係図・関係の履歴・週次ニュースの4画面）。

このリポジトリ直下の `firestore.rules`・`firebase.json` 等（既存のnews-dashboard本体用）とは**別のFirebaseプロジェクト**（`payments-landscape-registry`）を使っています。混同しないよう、このフォルダの中で完結させています（2026-09-21、`firestore.rules`の混在によるセキュリティ事故の影響範囲を分離するために別プロジェクトへ、と決定した経緯があります）。

正本はVault（`projects/payments-weekly/`、決済業界の週次リサーチ）です。ここにあるのはVaultのデータをFirestoreへ同期するツールと、それを表示する静的サイトだけで、Vaultなしでは動きません。

## 中身

- `firestore.rules` — public 5コレクション（entities / relations / evidence / weeklyDigests / newsRefs）は誰でも読み取り可・クライアント書き込み不可、private 3コレクション（notes / researchRequests / proposalNotes）は本人のみ読み書き可、それ以外は全拒否
- `firestore.indexes.json` — 複合インデックスは今のところ無し（空の雛形）
- `firebase.json` / `.firebaserc` — 上記をFirebase CLIから扱うための設定（プロジェクトは`payments-landscape-registry`固定）
- `test/rules.test.mjs` — ルールの単体テスト
- `sync/` — Vault → Firestore の同期スクリプト（下記）
- `package.json` — 上記の依存関係

## 同期スクリプト（Vault → Firestore）

`sync/` に、Vaultの実データをFirestoreの公開コレクションへ変換する同期スクリプトがあります。

### 中身

- `sync/index.mjs` — 実行のエントリーポイント
- `sync/lib/loadVault.mjs` — vocabulary.yaml・evidence・週次レポートを読む
- `sync/lib/buildPublic.mjs` — 許可リストのフィールドだけを抽出し、Firestore用の形に変換する（relations は evidence の frontmatter から集約、weeklyDigests は週次レポートのMarkdownから機械的に抽出）
- `sync/lib/checks.mjs` — 公開前チェック（許可リスト外フィールド・個人情報・禁止語・publish:false）
  - 禁止語リストは `<Vaultルート>/.private/deny-words.txt`（Git管理外）。勤務先名・社内プロジェクト名など、機械的に検知できない機微語を本人が追記する場所。空でもチェック自体は動く。
- `sync/lib/firestoreSync.mjs` — Firestoreとの差分表示・本人確認後のバッチ書き込み
- `sync/lib/newsDashboardSource.mjs` / `sync/lib/newsRefs.mjs` — news-dashboardの記事との連携（下記「newsRefs」参照）

**この処理はすべて決定論的（LLM不使用）で、本人が手動で実行したときだけ動きます（自動実行はしません）。**

### 実行方法

初回のみ依存関係をインストールします。

```
cd landscape
npm install --omit=dev
```

**ドライラン**（サービスアカウントキー無しでもOK。Firestoreには接続せず、変換結果を `sync/out/*.json` に書き出すだけ）：

```
node sync/index.mjs --vault <Vaultのルートパス>
```

**本番実行**（Firestoreへの書き込み。サービスアカウントキーが必要）：

```
GOOGLE_APPLICATION_CREDENTIALS="<Vaultのルート>\.private\firebase\payments-landscape-registry-firebase-adminsdk-xxxxx.json" ^
  node sync/index.mjs --vault <Vaultのルートパス>
```

実行すると、Firestoreの現在の内容と比較した差分（追加・変更・削除）が表示され、`y` と答えたときだけ書き込まれます。

サービスアカウントキーの生成手順・保管場所（`<Vaultのルート>\.private\firebase\`、Git管理外）は、Vault側の元のREADME（このリポジトリに移設する前のもの）またはVaultの `projects/payments-weekly/log.md` の記録を参照してください。鍵ファイル自体はVault側に置いたままで、このリポジトリには一切含みません。

### newsRefs（news-dashboardの記事との連携）

企業ページ（`player.html`）の「最近の記事（未確認・自動要約）」欄のデータです。
（decisions/2026-09-20-payments-landscape-publication.md 3-2節）

- 同期スクリプトを実行するたび、news-dashboard（別のFirebaseプロジェクト。認証情報は不要、公開読み取り可のコレクションを読むだけ）から直近14日分の記事を取得します。
- 「金融決済」テーマの記事だけを対象に、Vaultの企業辞書（vocabulary.yaml）の名前・別名との**単純な部分文字列一致**で企業に紐付けます（LLMは使わない）。
- 日本経済新聞・日経クロステック・NCBライブラリなど有料媒体の記事は、見出しとリンクのみ（要約は表示しない）。新しい有料媒体が増えたら `sync/lib/newsRefs.mjs` の `PAYWALLED_SOURCES` に追記してください（機械的には判定できないため）。
- 同じ記事がVaultのevidenceにもある場合は「確認済み」バッジを付けます（URLを正規化して突き合わせ）。
- news-dashboardの記事からLandscape本体（企業・関係・確度）を自動で作ることはありません。newsRefsはあくまで参考情報です。
- news-dashboardに接続できない環境（このサンドボックスなど、firestore.googleapis.comへのネットワークが無い場合）では、警告を出して**newsRefsだけをスキップ**し、他の4コレクションは通常どおり同期します。Firestore上の既存newsRefsもそのまま残ります。
- `--news-days <N>`（デフォルト14）で取得日数を変更、`--skip-news-refs` で最初からスキップできます。

## サイト本体（`docs/landscape/`）

- `index.html` — 全体図
- `player.html` — 企業の関係図（放射状SVG図。外部可視化ライブラリは不使用）。サイドバー下部に「最近の記事（未確認・自動要約）」欄（newsRefs、上記参照）
- `edge.html` — 関係の履歴
- `news.html` — 週次ニュース
- `css/base.css` — 共通デザイントークン・スタイル
- `js/` — 各画面のロジック、Firestore読み取り（`firebase-init.js`・`data.js`）、`firebaseConfig.js`（Web版のFirebase設定。秘密鍵ではなく公開して問題ない値）、`auth.js`（本人専用サインイン。下記参照）

ブラウザから直接Firestoreの公開コレクションを読み取る、素のHTML/CSS/JS（ビルド不要）です。

### サインイン（本人専用機能の入り口）

各画面ヘッダー右上に、サインインボタンを表示します（`js/auth.js`、`#auth-widget`）。
（decisions/2026-09-21-payments-landscape-firebase-architecture.md 2節・5節）

- **Googleサインイン**を使う。Gmailアカウントで認証すると自動的に`email_verified: true`になるため、`firestore.rules`の`isOwner()`（`lomoxiao@gmail.com`かつ`email_verified`）とそのまま組み合わせられ、パスワード管理やAdmin SDKでの手動設定が不要。
- 許可されたメールアドレス（`lomoxiao@gmail.com`）以外でサインインした場合は「利用できません」と表示するだけで、実際のアクセス制御はあくまで`firestore.rules`側が行う（UIの出し分けはユーザー体験のためだけで、セキュリティ境界ではない）。
- **初回セットアップとして、Firebaseコンソールで`payments-landscape-registry`プロジェクトの Authentication → Sign-in method → Google を有効化してください**（このリポジトリ側の変更だけでは有効になりません）。
- `notes`（コメント・追記）・`researchRequests`（追加調査依頼）などの本人専用機能は今後この認証基盤の上に実装する（まだ未実装）。

## （参考）CLIでルールを反映する方法

```
npm install -g firebase-tools   # 未導入の場合
firebase login
cd landscape
firebase deploy --only firestore:rules
```
