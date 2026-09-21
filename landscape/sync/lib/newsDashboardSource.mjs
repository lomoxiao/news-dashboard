// news-dashboard（別プロジェクト）の公開コレクション publicReports/{date} を、
// 匿名の公開読み取りとして取得する。
// news-dashboard側のFirestoreルールは `match /publicReports/{date} { allow read: if true; }`
// なので、サービスアカウント等の認証情報は不要（news-dashboard/docs/firebase-config.js と
// 同じ、apiKey等はどれも秘密情報ではない公開値）。
//
// 参照：decisions/2026-09-21-payments-landscape-firebase-architecture.md
//       news-dashboard/firestore.rules

import { initializeApp, getApps, getApp } from "firebase/app";
import { getFirestore, doc, getDoc } from "firebase/firestore";

// news-dashboard/docs/firebase-config.js と同一の値（公開情報）。
const NEWS_DASHBOARD_CONFIG = {
  projectId: "news-dashboard-registry",
  appId: "1:29569354078:web:df7035f6eda48792be27cf",
  storageBucket: "news-dashboard-registry.firebasestorage.app",
  apiKey: "AIzaSyDN6SC-spKvsE5Y7wXs2OJeM7_b_XZ_d-A",
  authDomain: "news-dashboard-registry.firebaseapp.com",
  messagingSenderId: "29569354078",
};
const APP_NAME = "news-dashboard-readonly";

function newsDashboardDb() {
  const app = getApps().some((a) => a.name === APP_NAME)
    ? getApp(APP_NAME)
    : initializeApp(NEWS_DASHBOARD_CONFIG, APP_NAME);
  return getFirestore(app);
}

function isoDate(d) {
  return d.toISOString().slice(0, 10);
}

/**
 * 直近 `days` 日分の publicReports/{date} を取得する（存在しない日はスキップ）。
 * ネットワークが到達できない環境（このサンドボックスなど）では例外を投げるので、
 * 呼び出し側で捕捉して「取得できなかった」扱いにすること。
 * @returns {Promise<object[]>} payload（{date, topics:[...]}）の配列。新しい順。
 */
export async function fetchRecentReports({ days = 14, today = new Date() } = {}) {
  const db = newsDashboardDb();
  const reports = [];
  for (let i = 0; i < days; i++) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    const dateStr = isoDate(d);
    const snap = await getDoc(doc(db, "publicReports", dateStr));
    if (snap.exists()) {
      const data = snap.data();
      if (data?.payload) reports.push(data.payload);
    }
  }
  return reports;
}
