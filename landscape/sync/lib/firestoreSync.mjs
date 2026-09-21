// Firestore への差分表示・バッチ書き込み。
// サービスアカウントキーが無ければ「ドライラン」として、
// ローカルにスナップショットJSONを書き出すだけに留める（本人が中身を目でレビューできるように）。
// 実際の書き込みは、本人がdiffを見て確認したときだけ行う（自動実行はしない）。

import { writeFile, mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import readline from "node:readline/promises";

export function hasCredentials() {
  return Boolean(process.env.GOOGLE_APPLICATION_CREDENTIALS);
}

/**
 * サービスアカウントキーがある場合だけ firebase-admin を動的import する。
 * （キーが無い環境でも import エラーでスクリプト全体が落ちないようにするため）
 */
async function initAdmin() {
  const admin = await import("firebase-admin");
  if (admin.default.apps.length === 0) {
    admin.default.initializeApp({
      credential: admin.default.credential.applicationDefault(),
    });
  }
  const app = admin.default.app();
  // どのプロジェクトに接続しているか必ず表示する（環境変数の設定ミスで
  // 意図しないプロジェクトに書き込んでしまう事故を早期発見するため）。
  // admin.app().options.projectId はAdmin SDK内部で明示指定しない限り
  // 空になることがあるため、鍵ファイル自体のproject_idを読んで表示する。
  const credPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  let keyProjectId = "(不明)";
  if (credPath) {
    try {
      const keyJson = JSON.parse(await readFile(credPath, "utf8"));
      keyProjectId = keyJson.project_id ?? "(project_idフィールド無し)";
    } catch {
      keyProjectId = "(鍵ファイルの読み込みに失敗)";
    }
  }
  console.log(`  GOOGLE_APPLICATION_CREDENTIALS: ${credPath ?? "(未設定)"}`);
  console.log(`  鍵ファイル内のproject_id: ${keyProjectId}`);
  return app.firestore();
}

/** 現在Firestoreに入っているドキュメントを { id: data } の形で取得する。 */
async function fetchCurrent(db, collectionName) {
  const snap = await db.collection(collectionName).get();
  const out = {};
  for (const doc of snap.docs) out[doc.id] = doc.data();
  return out;
}

/** 新旧を比較し、追加・変更・削除を仕分ける。 */
function diffCollection(currentById, nextDocs) {
  const nextById = Object.fromEntries(nextDocs.map((d) => [d.id, d]));
  const added = [];
  const changed = [];
  const removed = [];

  for (const [id, doc] of Object.entries(nextById)) {
    if (!(id in currentById)) {
      added.push(id);
    } else if (JSON.stringify(currentById[id]) !== JSON.stringify(doc)) {
      changed.push(id);
    }
  }
  for (const id of Object.keys(currentById)) {
    if (!(id in nextById)) removed.push(id);
  }
  return { added, changed, removed };
}

/**
 * ドライラン：Firestoreに接続せず、公開用データをローカルJSONに書き出すだけ。
 * サービスアカウントキーが無いときのデフォルト動作。
 */
export async function dryRun(publicData, outDir) {
  await mkdir(outDir, { recursive: true });
  for (const [collection, docs] of Object.entries(publicData)) {
    await writeFile(
      path.join(outDir, `${collection}.json`),
      JSON.stringify(docs, null, 2),
      "utf8"
    );
  }
  return Object.fromEntries(Object.entries(publicData).map(([k, v]) => [k, v.length]));
}

/**
 * 本番実行：Firestoreと差分比較し、diffを表示して本人の確認を待ち、
 * Yと答えたときだけサービスアカウントでバッチ書き込みする。
 */
export async function syncToFirestore(publicData) {
  const db = await initAdmin();

  const diffs = {};
  for (const [collection, docs] of Object.entries(publicData)) {
    const current = await fetchCurrent(db, collection);
    diffs[collection] = diffCollection(current, docs);
  }

  console.log("\n=== 差分 ===");
  let totalChanges = 0;
  for (const [collection, d] of Object.entries(diffs)) {
    console.log(`\n[${collection}]`);
    console.log(`  追加: ${d.added.length}件 ${d.added.slice(0, 10).join(", ")}${d.added.length > 10 ? " ..." : ""}`);
    console.log(`  変更: ${d.changed.length}件 ${d.changed.slice(0, 10).join(", ")}${d.changed.length > 10 ? " ..." : ""}`);
    console.log(`  削除: ${d.removed.length}件 ${d.removed.slice(0, 10).join(", ")}${d.removed.length > 10 ? " ..." : ""}`);
    totalChanges += d.added.length + d.changed.length + d.removed.length;
  }

  if (totalChanges === 0) {
    console.log("\n差分はありません。書き込みは行いません。");
    return { written: false, diffs };
  }

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const answer = await rl.question("\nこの内容でFirestoreに書き込みますか？ (y/N): ");
  rl.close();
  if (answer.trim().toLowerCase() !== "y") {
    console.log("中止しました。書き込みは行っていません。");
    return { written: false, diffs };
  }

  // バッチ書き込み（削除されたドキュメントは delete、それ以外は set）
  for (const [collection, docs] of Object.entries(publicData)) {
    const d = diffs[collection];
    let batch = db.batch();
    let opCount = 0;
    const commitIfFull = async () => {
      if (opCount >= 400) {
        // Firestoreのバッチ上限（500）に余裕を持たせる
        await batch.commit();
        batch = db.batch();
        opCount = 0;
      }
    };

    for (const doc of docs) {
      if (d.added.includes(doc.id) || d.changed.includes(doc.id)) {
        batch.set(db.collection(collection).doc(doc.id), doc);
        opCount++;
        await commitIfFull();
      }
    }
    for (const id of d.removed) {
      batch.delete(db.collection(collection).doc(id));
      opCount++;
      await commitIfFull();
    }
    if (opCount > 0) await batch.commit();
  }

  console.log("\n書き込みが完了しました。");
  return { written: true, diffs };
}
