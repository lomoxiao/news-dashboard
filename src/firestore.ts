import { applicationDefault, getApps, initializeApp } from "firebase-admin/app";
import { FieldValue, type Firestore, getFirestore } from "firebase-admin/firestore";
import { enrichReportWithArticleIds } from "./enrich.js";
import { dailyReportSchema, publicIndexSchema, type DailyReport, type PublicIndex } from "./schema.js";
import type { SupplementalData, SupplementalDocument } from "./supplemental.js";
import { articleIdForUrl, canonicalizeUrl } from "./url.js";

function createFirestore(): Firestore {
  if (!getApps().length) {
    const projectId = process.env.FIREBASE_PROJECT_ID;
    initializeApp({
      credential: applicationDefault(),
      ...(projectId ? { projectId } : {}),
    });
  }
  return getFirestore();
}

export class FirestoreStore {
  readonly db: Firestore;

  constructor(db = createFirestore()) {
    this.db = db;
  }

  async beginRun(runId: string, jobType: string): Promise<void> {
    await this.db.collection("runs").doc(runId).set({
      runId,
      jobType,
      status: "started",
      startedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
  }

  async markRun(runId: string, status: string, details: Record<string, unknown> = {}): Promise<void> {
    await this.db.collection("runs").doc(runId).set({
      status,
      ...details,
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
  }

  async upsertReport(
    report: DailyReport,
    runId: string,
    headline = "",
    rejectDuplicateUrls = true,
  ): Promise<void> {
    report = enrichReportWithArticleIds(report);
    const batch = this.db.batch();
    const seenInReport = new Set<string>();
    batch.set(this.db.collection("reports").doc(report.date), {
      date: report.date,
      generatedAt: report.generated_at,
      headline,
      runId,
      status: "firestore_written",
      schemaVersion: 1,
      articleCount: report.topics.reduce((sum, topic) => sum + topic.articles.length, 0),
      payload: report,
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
    batch.set(this.db.collection("publicReports").doc(report.date), {
      date: report.date,
      generatedAt: report.generated_at,
      headline,
      payload: report,
      updatedAt: FieldValue.serverTimestamp(),
    });

    for (const topic of report.topics) {
      for (const article of topic.articles) {
        const canonicalUrl = canonicalizeUrl(article.url);
        const articleId = articleIdForUrl(article.url);
        if (seenInReport.has(articleId)) {
          if (rejectDuplicateUrls) throw new Error(`Duplicate article URL in ${report.date}: ${canonicalUrl}`);
          continue;
        }
        seenInReport.add(articleId);

        batch.set(this.db.collection("articles").doc(articleId), {
          articleId,
          canonicalUrl,
          title: article.title,
          sourceName: article.source,
          seenDates: FieldValue.arrayUnion(report.date),
          updatedAt: FieldValue.serverTimestamp(),
        }, { merge: true });

        batch.set(this.db.collection("reportItems").doc(`${report.date}_${articleId}`), {
          reportDate: report.date,
          articleId,
          canonicalUrl,
          title: article.title,
          sourceName: article.source,
          themeName: topic.theme,
          category: topic.category,
          importance: article.importance,
          summaryShort: article.summary_short,
          summaryLong: article.summary_long,
          fetchFailed: article.fetch_failed ?? false,
          runId,
        }, { merge: true });
      }
    }
    await batch.commit();
  }

  async writePublicIndex(index: PublicIndex): Promise<void> {
    const batch = this.db.batch();
    batch.set(this.db.collection("metadata").doc("publicIndex"), { payload: index }, { merge: true });
    batch.set(this.db.collection("publicDashboard").doc("index"), { payload: index });
    await batch.commit();
  }

  async writeSupplementalData(data: SupplementalData): Promise<void> {
    const batch = this.db.batch();
    if (data.metricsMaster !== null) {
      batch.set(this.db.collection("metadata").doc("metricsMaster"), { payload: data.metricsMaster });
      batch.set(this.db.collection("publicDashboard").doc("metrics"), { payload: data.metricsMaster });
    }
    addSupplemental(batch, this.db, "metrics", data.metricDaily);
    addSupplemental(batch, this.db, "themeSummaries", data.themes);
    addSupplemental(batch, this.db, "monthlyReports", data.monthly);
    await batch.commit();
  }

  async readSupplementalData(): Promise<SupplementalData> {
    const [master, metrics, themes, monthly] = await Promise.all([
      this.db.collection("metadata").doc("metricsMaster").get(),
      this.db.collection("metrics").get(),
      this.db.collection("themeSummaries").get(),
      this.db.collection("monthlyReports").get(),
    ]);
    return {
      metricsMaster: master.exists ? master.data()?.payload ?? null : null,
      metricDaily: readSupplemental(metrics.docs),
      themes: readSupplemental(themes.docs),
      monthly: readSupplemental(monthly.docs),
    };
  }

  async readReports(): Promise<Array<{ report: DailyReport; headline: string }>> {
    const snapshot = await this.db.collection("reports").orderBy("date", "desc").get();
    return snapshot.docs.map((doc) => {
      const data = doc.data();
      return {
        report: enrichReportWithArticleIds(dailyReportSchema.parse(data.payload)),
        headline: typeof data.headline === "string" ? data.headline : "",
      };
    });
  }

  async readPublicIndex(): Promise<PublicIndex | null> {
    const snapshot = await this.db.collection("metadata").doc("publicIndex").get();
    if (!snapshot.exists) return null;
    return publicIndexSchema.parse(snapshot.data()?.payload);
  }

  async writePublicReport(report: DailyReport, headline: string): Promise<void> {
    await this.db.collection("publicReports").doc(report.date).set({
      date: report.date,
      generatedAt: report.generated_at,
      headline,
      payload: report,
      updatedAt: FieldValue.serverTimestamp(),
    });
  }

  async readPublicReport(date: string): Promise<DailyReport | null> {
    const snapshot = await this.db.collection("publicReports").doc(date).get();
    if (!snapshot.exists) return null;
    return dailyReportSchema.parse(snapshot.data()?.payload);
  }

  async readPublishedIndex(): Promise<PublicIndex | null> {
    const snapshot = await this.db.collection("publicDashboard").doc("index").get();
    if (!snapshot.exists) return null;
    return publicIndexSchema.parse(snapshot.data()?.payload);
  }

  async readPublishedMetrics(): Promise<unknown | null> {
    const snapshot = await this.db.collection("publicDashboard").doc("metrics").get();
    return snapshot.exists ? snapshot.data()?.payload ?? null : null;
  }
}

function safeDocumentId(id: string): string {
  return encodeURIComponent(id).replace(/\./g, "%2E");
}

function addSupplemental(
  batch: FirebaseFirestore.WriteBatch,
  db: Firestore,
  collection: string,
  documents: SupplementalDocument[],
): void {
  for (const document of documents) {
    batch.set(db.collection(collection).doc(safeDocumentId(document.id)), document);
  }
}

function readSupplemental(docs: FirebaseFirestore.QueryDocumentSnapshot[]): SupplementalDocument[] {
  return docs.map((doc) => {
    const data = doc.data();
    return { id: String(data.id), fileName: String(data.fileName), payload: data.payload };
  }).sort((a, b) => a.fileName.localeCompare(b.fileName));
}
