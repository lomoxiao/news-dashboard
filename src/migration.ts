import { FirestoreStore } from "./firestore.js";
import { listDailyReportFiles, readDailyReport, readPublicIndex } from "./files.js";
import { loadSupplementalData, supplementalCount } from "./supplemental.js";
import { articleIdForUrl } from "./url.js";

export interface MigrationSummary {
  reports: number;
  articleOccurrences: number;
  uniqueArticles: number;
  supplementalFiles: number;
}

export async function migrateExisting(dryRun: boolean): Promise<MigrationSummary> {
  const files = await listDailyReportFiles();
  const index = await readPublicIndex();
  const headlines = new Map(index.reports.map((entry) => [entry.date, entry.headline]));
  const uniqueArticles = new Set<string>();
  let articleOccurrences = 0;
  const reports = [];

  for (const file of files) {
    const report = await readDailyReport(file);
    for (const topic of report.topics) {
      for (const article of topic.articles) {
        uniqueArticles.add(articleIdForUrl(article.url));
        articleOccurrences += 1;
      }
    }
    reports.push(report);
  }

  const supplemental = await loadSupplementalData();
  const supplementalFiles = supplementalCount(supplemental);
  if (!dryRun) {
    const store = new FirestoreStore();
    const runId = `migration-${new Date().toISOString().replace(/[:.]/g, "-")}`;
    await store.beginRun(runId, "migration");
    try {
      for (const report of reports) {
        await store.upsertReport(report, runId, headlines.get(report.date) ?? "", false);
      }
      await store.writePublicIndex(index);
      await store.writeSupplementalData(supplemental);
      await store.markRun(runId, "completed", {
        reports: reports.length,
        articleOccurrences,
        uniqueArticles: uniqueArticles.size,
      });
    } catch (error) {
      await store.markRun(runId, "failed", { error: errorMessage(error) });
      throw error;
    }
  }

  return { reports: reports.length, articleOccurrences, uniqueArticles: uniqueArticles.size, supplementalFiles };
}


function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
