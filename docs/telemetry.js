// Interest-engine telemetry: buffered, append-only, fails silent.
// Events queue in localStorage (works signed-out) and flush to
// dashboardEvents/{uid}/events once an allowlisted user is signed in.
import { SDK_VERSION, firestoreApi } from "./firestore-data.js";

const AUTH_SDK = `https://www.gstatic.com/firebasejs/${SDK_VERSION}/firebase-auth.js`;

const QUEUE_KEY = "nd-tel-queue";
const SEEN_PREFIX = "nd-tel-seen-";
const SEEN_RETENTION_DAYS = 7;
const FLUSH_SIZE = 10;
const FLUSH_INTERVAL_MS = 15000;
const FLUSH_BATCH_LIMIT = 100;
const MAX_QUEUE = 500;
const IMPRESSION_DWELL_MS = 1000;

const state = {
  user: null,
  flushing: false,
  authApiPromise: null,
  getDate: () => null,
  listeners: new Set(),
};

// ── queue (localStorage) ──
function readQueue() {
  try { return JSON.parse(localStorage.getItem(QUEUE_KEY)) ?? []; } catch { return []; }
}
function writeQueue(queue) {
  try { localStorage.setItem(QUEUE_KEY, JSON.stringify(queue.slice(-MAX_QUEUE))); } catch { /* quota */ }
}
export function queuedEventCount() {
  return readQueue().length;
}

// ── impression dedup (per report date) ──
function seenKey(date) { return SEEN_PREFIX + date; }
function markSeen(date, id) {
  let seen;
  try { seen = new Set(JSON.parse(localStorage.getItem(seenKey(date))) ?? []); } catch { seen = new Set(); }
  if (seen.has(id)) return false;
  seen.add(id);
  try { localStorage.setItem(seenKey(date), JSON.stringify([...seen])); } catch { /* quota */ }
  return true;
}
function pruneSeenKeys() {
  const cutoff = new Date(Date.now() - SEEN_RETENTION_DAYS * 86400000).toISOString().slice(0, 10);
  try {
    for (const key of Object.keys(localStorage)) {
      if (key.startsWith(SEEN_PREFIX) && key.slice(SEEN_PREFIX.length) < cutoff) localStorage.removeItem(key);
    }
  } catch { /* ignore */ }
}

// ── auth ──
async function authApi() {
  if (!state.authApiPromise) {
    state.authApiPromise = Promise.all([firestoreApi(), import(AUTH_SDK)])
      .then(([fs, authSdk]) => ({ auth: authSdk.getAuth(fs.app), ...authSdk }));
  }
  return state.authApiPromise;
}

export function currentUser() {
  return state.user;
}

export async function signIn(email, password) {
  const api = await authApi();
  await api.signInWithEmailAndPassword(api.auth, email, password);
}

export async function signOutUser() {
  const api = await authApi();
  await api.signOut(api.auth);
}

export async function initTelemetry({ getDate, onAuthChange } = {}) {
  if (getDate) state.getDate = getDate;
  if (onAuthChange) state.listeners.add(onAuthChange);
  pruneSeenKeys();
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") void flush();
  });
  setInterval(() => void flush(), FLUSH_INTERVAL_MS);
  try {
    const api = await authApi();
    api.onAuthStateChanged(api.auth, (user) => {
      state.user = user;
      for (const listener of state.listeners) listener(user);
      void flush();
    });
  } catch (error) {
    console.warn("telemetry: auth unavailable", error);
  }
}

// ── events ──
export function logEvent(action, meta = {}) {
  try {
    const date = meta.date ?? state.getDate();
    if (!date) return;
    const event = { v: 1, ts: Date.now(), date, action };
    if (meta.articleId) event.articleId = String(meta.articleId).slice(0, 128);
    if (meta.theme) event.theme = String(meta.theme).slice(0, 60);
    if (meta.url) event.url = String(meta.url).slice(0, 600);
    const queue = readQueue();
    queue.push(event);
    writeQueue(queue);
    if (queue.length >= FLUSH_SIZE) void flush();
  } catch { /* telemetry must never break the app */ }
}

async function flush() {
  if (state.flushing || !state.user) return;
  const queue = readQueue();
  if (!queue.length) return;
  state.flushing = true;
  try {
    const api = await firestoreApi();
    const events = queue.slice(0, FLUSH_BATCH_LIMIT);
    const batch = api.writeBatch(api.db);
    const eventsCollection = api.collection(api.db, "dashboardEvents", state.user.uid, "events");
    for (const event of events) batch.set(api.doc(eventsCollection), event);
    await batch.commit();
    writeQueue(readQueue().slice(events.length));
  } catch (error) {
    console.warn("telemetry: flush failed (queued for retry)", error);
  } finally {
    state.flushing = false;
  }
}

// ── impressions (IntersectionObserver, 50% × 1s dwell) ──
const dwellTimers = new Map();
let observer = null;

function recordImpression(el) {
  if (!el.isConnected) return;
  const date = state.getDate();
  if (!date) return;
  const id = el.dataset.telId || el.dataset.telUrl;
  if (!id || !markSeen(date, id)) return;
  logEvent("impression", { articleId: el.dataset.telId, theme: el.dataset.telTheme, url: el.dataset.telUrl });
}

export function observeArticleCards(root = document) {
  if (!("IntersectionObserver" in window)) return;
  if (!observer) {
    observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        const el = entry.target;
        if (entry.isIntersecting && entry.intersectionRatio >= 0.5) {
          if (!dwellTimers.has(el)) {
            dwellTimers.set(el, setTimeout(() => {
              dwellTimers.delete(el);
              observer.unobserve(el);
              recordImpression(el);
            }, IMPRESSION_DWELL_MS));
          }
        } else if (dwellTimers.has(el)) {
          clearTimeout(dwellTimers.get(el));
          dwellTimers.delete(el);
        }
      }
    }, { threshold: [0, 0.5, 1] });
  }
  for (const el of root.querySelectorAll(".article-card[data-tel-url]:not([data-tel-observed])")) {
    el.dataset.telObserved = "1";
    observer.observe(el);
  }
}
