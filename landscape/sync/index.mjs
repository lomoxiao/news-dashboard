#!/usr/bin/env node
// Payments Landscape 同期スクリプト（Vault → Firestore）
// 決定論的な処理のみ。LLMは使わない。自動実行もしない（本人が手動で実行する）。
//
// 手順（decisions/2026-09-21-payments-landscape-firebase-architecture.md 3節と対応）：
//   1. vocabulary.yaml・evidence frontmatter・週次レポート frontmatter を読む
//   2. 許可リストのフィールドだけを抽出する
//   3. 公開前チェック（4項目）を実行し、1つでも該当したら停止する
//   4. 差分（追加・変更・削除）を表示する
//   5. 本人が確認したときだけ、サービスアカウントでFirestoreにバッチ書き込みする
//
// 使い方：
//   node index.mjs --vault /path/to/brain
//   （GOOGLE_APPLICATION_CREDENTIALS が設定されていなければ、
//    Firestoreには繋がずローカルJSON（./out/）に書き出すだけの「ドライラン」になる）

import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadVocabulary, loadEvidence, loadWeeklyReports, loadDenyWords } from "./lib/loadVault.mjs";
import { buildEntities, buildEvidence, buildRelations, buildWeeklyDigests } from "./lib/buildPublic.mjs";
import { runPrePublishChecks } from "./lib/checks.mjs";
import { hasCredentials, dryRun, syncToFirestore } from "./lib/firestoreSync.mjs";
import { fetchRecentReports } from "./lib/newsDashboardSource.mjs";
import { buildNewsRefs } from "./lib/newsRefs.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function parseArgs(argv) {
  const args = { vault: process.env.VAULT_DIR, newsDays: 14, skipNewsRefs: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--vault") args.vault = argv[++i];
    if (argv[i] === "--news-days") args.newsDays = Number(argv[++i]);
    if (argv[i] === "--skip-news-refs") args.skipNewsRefs = true;
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.vault) {
    console.error("Vaultのパスを指定してください（--vault <path> または環境変数 VAULT_DIR）");
    process.exit(1);
  }
  const projectDir = path.join(args.vault, "projects", "payments-weekly");

  // 1. 読む
  console.log("[1/5] Vaultを読み込み中...");
  const vocabulary = await loadVocabulary(projectDir);
  const rawEvidenceList = await loadEvidence(projectDir);
  const reports = await loadWeeklyReports(projectDir);
  const denyWords = await loadDenyWords(projectDir);
  console.log(`  entities: ${Object.keys(vocabulary.entities ?? {}).length}件`);
  console.log(`  evidence: ${rawEvidenceList.length}件（読み込んだ全件。publish:falseの除外はこの後）`);
  console.log(`  週次レポート: ${reports.length}件`);

  // 2. 抽出
  console.log("\n[2/5] 許可リストのフィールドを抽出中...");
  const entities = buildEntities(vocabulary);
  const evidence = buildEvidence(rawEvidenceList);
  const relations = buildRelations(rawEvidenceList);
  const weeklyDigests = buildWeeklyDigests(reports, evidence);
  const publicData = { entities, relations, evidence, weeklyDigests };
  console.log(`  entities: ${entities.length}件 / relations: ${relations.length}件 / evidence: ${evidence.length}件 / weeklyDigests: ${weeklyDigests.length}件`);
  if (evidence.length !== rawEvidenceList.length) {
    console.log(`  （publish:false のため ${rawEvidenceList.length - evidence.length}件を除外）`);
  }

  // 2.5. news-dashboard の記事を取得し、企業名と文字照合してnewsRefsを組み立てる
  //      （decisions/2026-09-20-payments-landscape-publication.md 3-2節）。
  //      news-dashboardは別プロジェクトの「公開読み取り可」コレクションを読むだけで、
  //      認証情報は不要。ただしネットワークが到達できない環境では取得自体に失敗するので、
  //      その場合はnewsRefsに一切触れず（Firestore上の既存データもそのまま）に進む。
  if (args.skipNewsRefs) {
    console.log("\n[2.5/5] --skip-news-refs が指定されたため、newsRefsの更新をスキップします。");
  } else {
    console.log(`\n[2.5/5] news-dashboardの直近${args.newsDays}日分の記事を取得し、企業と照合中...`);
    try {
      const newsDashboardReports = await fetchRecentReports({ days: args.newsDays });
      const newsRefs = buildNewsRefs({ reports: newsDashboardReports, vocabulary, publicEvidence: evidence });
      publicData.newsRefs = newsRefs;
      console.log(`  取得したレポート: ${newsDashboardReports.length}日分 / 企業と一致した記事: ${newsRefs.length}件`);
    } catch (err) {
      console.warn(`  news-dashboardの記事を取得できませんでした（${err.message}）。`);
      console.warn("  newsRefsは今回更新しません（Firestore上の既存データがあればそのまま残ります）。");
      console.warn("  ネットワークが到達できない環境で実行している場合は、通常の動作です。");
    }
  }

  // 3. 公開前チェック
  console.log("\n[3/5] 公開前チェック中...");
  const result = runPrePublishChecks({ publicData, rawEvidenceList, denyWords });
  for (const w of result.warnings) console.warn(`  警告: ${w}`);
  if (!result.ok) {
    console.error(`\n公開前チェックに違反があります。書き込みを中止します。\n`);
    for (const v of result.violations) console.error(`  - ${v}`);
    process.exit(1);
  }
  console.log("  問題なし。");

  // 4-5. 差分表示 → 本人確認 → 書き込み（またはドライラン）
  if (!hasCredentials()) {
    console.log("\n[4-5/5] GOOGLE_APPLICATION_CREDENTIALS が未設定のため、ドライランで実行します。");
    console.log("  （Firestoreには接続せず、ローカルJSONに書き出すだけです）");
    const outDir = path.join(__dirname, "out");
    const counts = await dryRun(publicData, outDir);
    console.log(`  書き出し先: ${outDir}`);
    console.log(`  件数: ${JSON.stringify(counts)}`);
    console.log("\n  実際にFirestoreへ反映するには、サービスアカウントキーを用意し、");
    console.log("  GOOGLE_APPLICATION_CREDENTIALS=<キーのパス> を付けて再実行してください。");
    return;
  }

  console.log("\n[4-5/5] Firestoreと差分比較します...");
  await syncToFirestore(publicData);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
