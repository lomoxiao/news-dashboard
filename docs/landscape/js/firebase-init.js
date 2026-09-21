// Firebase初期化。CDNのFirebase JS SDK（モジュール版）を使う。
// apiKeyは秘密情報ではない（アクセス制御はFirestoreセキュリティルールが担う）。
// getApps()/getApp()で「既に初期化済みなら使い回す」ようにしている。auth.js（サインイン
// ウィジェット）が先に読み込まれてinitializeApp()を呼んでいる場合があり、ここで無条件に
// initializeApp()を呼ぶと「Firebase App named '[DEFAULT]' already exists」で例外になるため。
import { initializeApp, getApps, getApp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";
import { firebaseConfig } from "./firebaseConfig.js";

export const app = getApps().length ? getApp() : initializeApp(firebaseConfig);
export const db = getFirestore(app);
