import { isDeepStrictEqual } from "node:util";
import { enrichReportWithArticleIds } from "./enrich.js";
import { FirestoreStore } from "./firestore.js";
import { buildPublicIndex } from "./publication.js";
import type { DailyReport } from "./schema.js";
import { loadSupplementalData } from "./supplemental.js";

export interface PublishSummary {
  reports: number;
  metrics: boolean;
  dryRun: boolean;
}

export function reportsMatchForPublication(canonical: DailyReport, published: DailyReport): boolean {
  return isDeepStrictEqual(
    enrichReportWithArticleIds(canonical),
    enrichReportWithArticleIds(published),
  );
}

export async function refreshPublicIndex(store: FirestoreStore): Promise<number> {
  const reports = await store.readReports();
  const legacy = await store.readPublicIndex();
  await store.writePublicIndex(buildPublicIndex(reports, legacy));
  return reports.length;
}

export async function backfillPublicData(dryRun: boolean): Promise<PublishSummary> {
  const store = new FirestoreStore();
  const reports = await store.readReports();
  const supplemental = await store.readSupplementalData();
  if (!dryRun) {
    for (const { report, headline } of reports) {
      await store.writePublicReport(report, headline);
    }
    await store.writePublicIndex(buildPublicIndex(reports, await store.readPublicIndex()));
    if (supplemental.metricsMaster !== null) {
      await store.writeSupplementalData({
        metricsMaster: supplemental.metricsMaster,
        metricDaily: [],
        themes: [],
        monthly: [],
      });
    }
  }
  return { reports: reports.length, metrics: supplemental.metricsMaster !== null, dryRun };
}

export async function syncSupplementalData(): Promise<{ files: number }> {
  const supplemental = await loadSupplementalData();
  const store = new FirestoreStore();
  await store.writeSupplementalData(supplemental);
  return {
    files: (supplemental.metricsMaster === null ? 0 : 1)
      + supplemental.metricDaily.length + supplemental.themes.length + supplemental.monthly.length,
  };
}

export async function verifyPublishedData(): Promise<{ reports: number; metrics: boolean }> {
  const store = new FirestoreStore();
  const reports = await store.readReports();
  const publishedIndex = await store.readPublishedIndex();
  const expectedIndex = buildPublicIndex(
    reports,
    await store.readPublicIndex(),
    publishedIndex?.last_updated,
  );
  if (!publishedIndex || !isDeepStrictEqual(publishedIndex, expectedIndex)) {
    throw new Error("Published index does not match canonical reports");
  }
  for (const { report } of reports) {
    const published = await store.readPublicReport(report.date);
    if (!published || !reportsMatchForPublication(report, published)) {
      throw new Error(`Published report does not match canonical report: ${report.date}`);
    }
  }
  const supplemental = await store.readSupplementalData();
  const publishedMetrics = await store.readPublishedMetrics();
  if (!isDeepStrictEqual(publishedMetrics, supplemental.metricsMaster)) {
    throw new Error("Published metrics do not match canonical metrics");
  }
  return { reports: reports.length, metrics: supplemental.metricsMaster !== null };
}
