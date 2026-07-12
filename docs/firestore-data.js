import { firebaseConfig } from "./firebase-config.js";

const SDK_VERSION = "12.1.0";
const APP_SDK = `https://www.gstatic.com/firebasejs/${SDK_VERSION}/firebase-app.js`;
const FIRESTORE_SDK = `https://www.gstatic.com/firebasejs/${SDK_VERSION}/firebase-firestore.js`;
const documentCache = new Map();
let firestoreApiPromise;

export const dataStatus = {
  usedFallback: false,
  errors: [],
};

async function firestoreApi() {
  if (!firestoreApiPromise) {
    firestoreApiPromise = Promise.all([import(APP_SDK), import(FIRESTORE_SDK)])
      .then(([appSdk, firestoreSdk]) => {
        const app = appSdk.initializeApp(firebaseConfig);
        return { db: firestoreSdk.getFirestore(app), ...firestoreSdk };
      });
  }
  return firestoreApiPromise;
}

async function readPublished(collectionName, documentId) {
  const key = collectionName + "/" + documentId;
  if (!documentCache.has(key)) {
    documentCache.set(key, (async () => {
      const api = await firestoreApi();
      const snapshot = await api.getDoc(api.doc(api.db, collectionName, documentId));
      if (!snapshot.exists()) throw new Error("Published Firestore document not found: " + key);
      return snapshot.data().payload;
    })());
  }
  return documentCache.get(key);
}

async function fallbackJson(path) {
  const response = await fetch("./" + path + "?v=" + Date.now());
  if (!response.ok) throw new Error("Fallback JSON not found: " + path);
  return response.json();
}

async function firestoreFirst(collectionName, documentId, fallbackPath) {
  try {
    return await readPublished(collectionName, documentId);
  } catch (error) {
    dataStatus.usedFallback = true;
    dataStatus.errors.push(error instanceof Error ? error.message : String(error));
    try {
      return await fallbackJson(fallbackPath);
    } catch (fallbackError) {
      dataStatus.errors.push(fallbackError instanceof Error ? fallbackError.message : String(fallbackError));
      return null;
    }
  }
}

export function loadIndex() {
  return firestoreFirst("publicDashboard", "index", "data/index.json");
}

export function loadMetrics() {
  return firestoreFirst("publicDashboard", "metrics", "data/metrics/master.json");
}

export function loadReport(date) {
  return firestoreFirst("publicReports", date, "data/daily/" + date + ".json");
}

export function loadReports(dates) {
  return Promise.all(dates.map(loadReport));
}
