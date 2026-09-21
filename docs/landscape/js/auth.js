// Firebase Authによるサインイン（本人専用機能の入り口）。
// Googleサインインを使う（Gmailアカウントは自動的にemail_verified: trueになるため、
// firestore.rulesのisOwner()（メールアドレス一致＋email_verified）とそのまま組み合わせられる。
// news-dashboard本体はメール/パスワード方式だが、そちらのルールはemail_verifiedを見ておらず、
// こちらのルールは見ているため、あえてGoogleサインインを選んだ — 本人が別途パスワードを
// 管理したりAdmin SDKでemailVerifiedを手動設定したりする手間が要らない）。
// 参照：decisions/2026-09-21-payments-landscape-firebase-architecture.md 2節・5節

import { initializeApp, getApps, getApp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
import {
  getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged,
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";
import { firebaseConfig } from "./firebaseConfig.js";

const OWNER_EMAIL = "lomoxiao@gmail.com";

function app() {
  return getApps().length ? getApp() : initializeApp(firebaseConfig);
}

const auth = getAuth(app());
const provider = new GoogleAuthProvider();

/** firestore.rulesのisOwner()と同じ判定（表示の出し分け用。実際のアクセス制御はルール側が行う）。 */
export function isOwner(user) {
  return !!user && user.email === OWNER_EMAIL && !!user.emailVerified;
}

export function currentUser() {
  return auth.currentUser;
}

export async function signIn() {
  await signInWithPopup(auth, provider);
}

export async function signOutUser() {
  await signOut(auth);
}

export function onAuthChange(callback) {
  return onAuthStateChanged(auth, callback);
}

// ── 各画面共通のヘッダーウィジェット（#auth-widget があれば自動的にマウントする）──
function el(tag, attrs = {}, text) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") node.className = v;
    else if (k.startsWith("on") && typeof v === "function") node.addEventListener(k.slice(2), v);
    else node.setAttribute(k, v);
  }
  if (text !== undefined) node.textContent = text;
  return node;
}

function renderWidget(container, user) {
  container.innerHTML = "";
  const handleSignOut = () => { signOutUser().catch((e) => console.error(e)); };
  if (isOwner(user)) {
    container.appendChild(el("span", { class: "pl-auth-email" }, user.email));
    container.appendChild(el("button", { class: "pl-auth-btn", type: "button", onclick: handleSignOut }, "サインアウト"));
  } else if (user) {
    // サインインはしたが、許可されたメールアドレスと一致しない（本人専用機能は使えない）
    container.appendChild(el("span", { class: "pl-auth-denied" }, `${user.email} は利用できません`));
    container.appendChild(el("button", { class: "pl-auth-btn", type: "button", onclick: handleSignOut }, "サインアウト"));
  } else {
    const handleSignIn = () => {
      signIn().catch((e) => {
        console.error(e);
        alert("サインインに失敗しました。" + (e?.message ?? ""));
      });
    };
    container.appendChild(el("button", { class: "pl-auth-btn", type: "button", onclick: handleSignIn }, "サインイン"));
  }
}

function mountAuthWidget() {
  const container = document.getElementById("auth-widget");
  if (!container) return;
  onAuthChange((user) => renderWidget(container, user));
}

mountAuthWidget();
