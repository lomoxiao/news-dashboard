// Payments Landscape のフロントエンド用 Firebase 設定。
// apiKeyは秘密情報ではない（Firestoreへのアクセス制御はセキュリティルールが担う）ので、
// このファイルは公開リポジトリ・公開サイトに含めてよい。
// 参照：https://firebase.google.com/docs/projects/api-keys
export const firebaseConfig = {
  apiKey: "AIzaSyCPj3rmUL9p66nUQ9d8C8PDrIQ-TS3mAJ0",
  authDomain: "payments-landscape-registry.firebaseapp.com",
  projectId: "payments-landscape-registry",
  storageBucket: "payments-landscape-registry.firebasestorage.app",
  messagingSenderId: "1023710225637",
  appId: "1:1023710225637:web:508f24bfe62c484521600c",
  measurementId: "G-Z8NYSYYP6N",
};
