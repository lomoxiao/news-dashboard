// Firestore セキュリティルールの単体テスト（雛形）
// 参照：decisions/2026-09-21-payments-landscape-firebase-architecture.md
//   「非公開コレクション（notes・researchRequests・proposalNotes）は
//    Firestoreセキュリティルールで本人のUID以外を拒否する。
//    実装時はFirebaseのRules Unit Testingでこの拒否を自動テストする。」
//
// 実行方法：
//   1. firebase-tools をインストール（npm i -D firebase-tools @firebase/rules-unit-testing）
//   2. firebase emulators:exec --only firestore "node --test test/rules.test.mjs"

import { readFileSync } from "node:fs";
import { before, after, describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  initializeTestEnvironment,
  assertSucceeds,
  assertFails,
} from "@firebase/rules-unit-testing";

const OWNER_EMAIL = "lomoxiao@gmail.com";
let testEnv;

before(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: "payments-landscape-rules-test",
    firestore: {
      rules: readFileSync("firestore.rules", "utf8"),
    },
  });
});

after(async () => {
  await testEnv.cleanup();
});

describe("公開コレクション（entities / relations / evidence / weeklyDigests / newsRefs）", () => {
  it("誰でも読み取れる（未認証でも可）", async () => {
    const db = testEnv.unauthenticatedContext().firestore();
    await assertSucceeds(db.collection("entities").doc("visa").get());
  });

  it("クライアントからは書き込めない（本人の認証済みユーザーでも不可）", async () => {
    const db = testEnv
      .authenticatedContext("owner-uid", { email: OWNER_EMAIL, email_verified: true })
      .firestore();
    await assertFails(
      db.collection("entities").doc("hacked").set({ name: "不正な書き込み" })
    );
  });
});

describe("非公開コレクション（notes / researchRequests / proposalNotes）", () => {
  it("未認証では読み書きできない", async () => {
    const db = testEnv.unauthenticatedContext().firestore();
    await assertFails(db.collection("notes").doc("n1").get());
    await assertFails(db.collection("notes").doc("n1").set({ body: "x" }));
  });

  it("本人以外のログインユーザーでは読み書きできない", async () => {
    const db = testEnv
      .authenticatedContext("someone-else-uid", {
        email: "someone-else@example.com",
        email_verified: true,
      })
      .firestore();
    await assertFails(db.collection("researchRequests").doc("r1").get());
  });

  it("メール未確認の本人アカウントでは読み書きできない", async () => {
    const db = testEnv
      .authenticatedContext("owner-uid", { email: OWNER_EMAIL, email_verified: false })
      .firestore();
    await assertFails(db.collection("proposalNotes").doc("p1").get());
  });

  it("本人（メール確認済み）は読み書きできる", async () => {
    const db = testEnv
      .authenticatedContext("owner-uid", { email: OWNER_EMAIL, email_verified: true })
      .firestore();
    await assertSucceeds(
      db.collection("notes").doc("n1").set({ body: "テストメモ", createdAt: Date.now() })
    );
    await assertSucceeds(db.collection("notes").doc("n1").get());
  });
});

describe("想定外のコレクション", () => {
  it("デフォルト拒否が効く", async () => {
    const db = testEnv
      .authenticatedContext("owner-uid", { email: OWNER_EMAIL, email_verified: true })
      .firestore();
    await assertFails(db.collection("somethingUnexpected").doc("x").get());
  });
});
