import { readFileSync } from "node:fs";
import { cert, getApp, getApps, initializeApp } from "firebase-admin/app";
import { getDatabase, type Database } from "firebase-admin/database";
import type { Firestore } from "firebase-admin/firestore";
import type { ExposureItem, TelemetryEvent, ViewerArticle } from "./types.js";

const VIEWER_APP_NAME = "viewer-rtdb";
const EVENT_ACTIONS = new Set(["impression", "expand", "source_click"]);

export function viewerDatabase(): Database {
  const keyPath = process.env.VIEWER_SERVICE_ACCOUNT_PATH?.trim();
  const databaseURL = process.env.VIEWER_DATABASE_URL?.trim();
  if (!keyPath || !databaseURL) {
    throw new Error("Set VIEWER_SERVICE_ACCOUNT_PATH and VIEWER_DATABASE_URL (viewer RTDB read access)");
  }
  const app = getApps().some((a) => a.name === VIEWER_APP_NAME)
    ? getApp(VIEWER_APP_NAME)
    : initializeApp({ credential: cert(JSON.parse(readFileSync(keyPath, "utf8"))), databaseURL }, VIEWER_APP_NAME);
  return getDatabase(app);
}

export async function readExposures(db: Firestore, sinceDate: string): Promise<ExposureItem[]> {
  const snapshot = await db.collection("reportItems").where("reportDate", ">=", sinceDate).get();
  return snapshot.docs.flatMap((doc) => {
    const data = doc.data();
    if (typeof data.articleId !== "string" || typeof data.reportDate !== "string") return [];
    return [{
      articleId: data.articleId,
      canonicalUrl: String(data.canonicalUrl ?? ""),
      date: data.reportDate,
      themeName: String(data.themeName ?? ""),
      category: String(data.category ?? ""),
      sourceName: String(data.sourceName ?? ""),
      title: String(data.title ?? ""),
      summaryShort: String(data.summaryShort ?? ""),
      importance: Number(data.importance ?? 0),
    }];
  });
}

export async function readTelemetryEvents(db: Firestore, sinceMs: number): Promise<TelemetryEvent[]> {
  const events: TelemetryEvent[] = [];
  for (const parent of await db.collection("dashboardEvents").listDocuments()) {
    const snapshot = await parent.collection("events").where("ts", ">=", sinceMs).get();
    for (const doc of snapshot.docs) {
      const data = doc.data();
      if (!EVENT_ACTIONS.has(String(data.action)) || typeof data.ts !== "number") continue;
      events.push({
        action: data.action as TelemetryEvent["action"],
        ts: data.ts,
        date: String(data.date ?? ""),
        ...(typeof data.articleId === "string" && data.articleId ? { articleId: data.articleId } : {}),
        ...(typeof data.url === "string" && data.url ? { url: data.url } : {}),
      });
    }
  }
  return events;
}

export async function pruneTelemetryEvents(db: Firestore, cutoffMs: number): Promise<number> {
  let removed = 0;
  for (const parent of await db.collection("dashboardEvents").listDocuments()) {
    for (;;) {
      const snapshot = await parent.collection("events").where("ts", "<", cutoffMs).limit(400).get();
      if (snapshot.empty) break;
      const batch = db.batch();
      for (const doc of snapshot.docs) batch.delete(doc.ref);
      await batch.commit();
      removed += snapshot.size;
    }
  }
  return removed;
}

interface RawArtifact {
  status?: unknown;
  updatedAt?: unknown;
}

interface RawViewerArticle {
  canonicalUrl?: unknown;
  originalUrl?: unknown;
  title?: unknown;
  updatedAt?: unknown;
  registeredAt?: unknown;
  lastRegisteredAt?: unknown;
  deletedAt?: unknown;
  slides?: RawArtifact;
  manga?: RawArtifact;
}

export async function readViewerArticles(db: Database): Promise<ViewerArticle[]> {
  const [articlesSnapshot, readStateSnapshot] = await Promise.all([
    db.ref("articles").get(),
    db.ref("readState").get(),
  ]);
  const articles = (articlesSnapshot.val() ?? {}) as Record<string, RawViewerArticle>;
  const readStateRoot = (readStateSnapshot.val() ?? {}) as Record<string, Record<string, { state?: unknown; updatedAt?: unknown }>>;

  // Merge read state across uids (single-user in practice); keep the latest update.
  const readByArticle = new Map<string, { state: "read" | "later"; updatedAt: string }>();
  for (const items of Object.values(readStateRoot)) {
    for (const [articleId, entry] of Object.entries(items ?? {})) {
      const state = entry?.state;
      const updatedAt = typeof entry?.updatedAt === "string" ? entry.updatedAt : "";
      if (state !== "read" && state !== "later") continue;
      const existing = readByArticle.get(articleId);
      if (!existing || updatedAt > existing.updatedAt) readByArticle.set(articleId, { state, updatedAt });
    }
  }

  const result: ViewerArticle[] = [];
  for (const [viewerId, raw] of Object.entries(articles)) {
    if (raw.deletedAt) continue;
    const canonicalUrl = typeof raw.canonicalUrl === "string" && raw.canonicalUrl
      ? raw.canonicalUrl
      : typeof raw.originalUrl === "string" ? raw.originalUrl : "";
    if (!canonicalUrl) continue;
    const promotedAt = firstString(raw.registeredAt, raw.lastRegisteredAt, raw.slides?.updatedAt, raw.manga?.updatedAt, raw.updatedAt);
    const readEntry = readByArticle.get(viewerId);
    result.push({
      viewerId,
      canonicalUrl,
      title: typeof raw.title === "string" ? raw.title : "",
      promotedAt,
      hasGeneration: Boolean(raw.slides?.status || raw.manga?.status),
      readState: readEntry?.state ?? null,
      readStateUpdatedAt: readEntry?.updatedAt ?? null,
    });
  }
  return result;
}

function firstString(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value === "string" && value.length > 0) return value;
  }
  return null;
}
