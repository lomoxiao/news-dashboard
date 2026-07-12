import path from "node:path";
import { exportPublicJson } from "./exporter.js";
import { FirestoreStore } from "./firestore.js";
import { readDailyReport, repositoryRoot } from "./files.js";
import { migrateExisting } from "./migration.js";
import { backfillPublicData, refreshPublicIndex, syncSupplementalData, verifyPublishedData } from "./publisher.js";
import { validateExistingReports, validateReportSemantics } from "./validation.js";

const [command, ...args] = process.argv.slice(2);

try {
  switch (command) {
    case "validate": {
      const file = requiredFile(args[0]);
      print(validateReportSemantics(await readDailyReport(file)));
      break;
    }
    case "validate-existing": {
      const results = await validateExistingReports();
      print({
        reports: results.length,
        articles: results.reduce((sum, item) => sum + item.articles, 0),
        duplicateArticles: results.reduce((sum, item) => sum + item.duplicateArticles, 0),
        summaryLengthViolations: results.reduce((sum, item) => sum + item.summaryLengthViolations, 0),
      });
      break;
    }
    case "migrate": {
      print(await migrateExisting(args.includes("--dry-run")));
      break;
    }
    case "ingest": {
      const file = requiredFile(args[0]);
      const report = await readDailyReport(file);
      validateReportSemantics(report);
      const runId = `daily-${report.date}`;
      const store = new FirestoreStore();
      await store.beginRun(runId, "daily");
      try {
        await store.upsertReport(report, runId, headlineForReport(report));
        await refreshPublicIndex(store);
        await store.markRun(runId, "firestore_written", { date: report.date });
      } catch (error) {
        await store.markRun(runId, "failed", { error: errorMessage(error) });
        throw error;
      }
      print({ runId, date: report.date, status: "firestore_written" });
      break;
    }
    case "mark-run": {
      const runId = args[0];
      const status = args[1];
      if (!runId || !status) throw new Error("Usage: cli.ts mark-run <runId> <status>");
      const store = new FirestoreStore();
      await store.markRun(runId, status);
      print({ runId, status });
      break;
    }
    case "export":
      print(await exportPublicJson());
      break;
    case "publish:backfill":
      print(await backfillPublicData(args.includes("--dry-run")));
      break;
    case "verify:public":
      print(await verifyPublishedData());
      break;
    case "sync:supplemental":
      print(await syncSupplementalData());
      break;
    default:
      throw new Error("Usage: cli.ts <validate|validate-existing|migrate|ingest|export|publish:backfill|verify:public|sync:supplemental|mark-run> [args]");
  }
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exitCode = 1;
}

function requiredFile(value: string | undefined): string {
  if (!value) throw new Error("A JSON file path is required");
  return path.resolve(repositoryRoot, value);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function headlineForReport(report: Awaited<ReturnType<typeof readDailyReport>>): string {
  const preferred = report.top_summary.journalist;
  if (preferred?.lead) return preferred.lead;
  return Object.values(report.top_summary)[0]?.lead ?? report.date;
}

function print(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}
