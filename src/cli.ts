import path from "node:path";
import { exportPublicJson } from "./exporter.js";
import { FirestoreStore } from "./firestore.js";
import { readDailyReport, readJson, repositoryRoot } from "./files.js";
import { emptyMaster, mergeMetricsDraft, metricsDraftSchema, validateMetricsDraft, withThemeCandidates, type MetricsMaster } from "./metrics.js";
import { computeTrendScores, applyTrendScores, withTrendScores } from "./trend.js";
import { isDeepStrictEqual } from "node:util";
import { migrateExisting } from "./migration.js";
import { backfillPublicData, refreshPublicIndex, syncSupplementalData, verifyPublishedData } from "./publisher.js";
import { configuredThemeNames, validateExistingReports, validateReportSemantics } from "./validation.js";

const [command, ...args] = process.argv.slice(2);

try {
  switch (command) {
    case "validate": {
      const file = requiredFile(args[0]);
      print(validateReportSemantics(await readDailyReport(file), true, await configuredThemeNames()));
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
      const draft = await readDailyReport(file);
      validateReportSemantics(draft, true, await configuredThemeNames());
      const runId = `daily-${draft.date}`;
      const store = new FirestoreStore();
      await store.beginRun(runId, "daily");
      let report = draft;
      try {
        const stored = (await store.readReports()).map((item) => item.report);
        // Trend scores are always computed here, never taken from the draft.
        report = withTrendScores(draft, stored);
        await store.upsertReport(report, runId, headlineForReport(report));
        await refreshPublicIndex(store);
        await store.markRun(runId, "firestore_written", { date: report.date });
      } catch (error) {
        await store.markRun(runId, "failed", { error: errorMessage(error) });
        throw error;
      }
      // The theme candidate chart is derived data; a failure here must not fail the daily report.
      let themeSeries = "unchanged";
      try {
        themeSeries = await refreshThemeCandidates(store);
      } catch (error) {
        themeSeries = "failed: " + errorMessage(error);
      }
      print({
        runId,
        date: report.date,
        status: "firestore_written",
        trendScores: report.chart_data?.trend_scores,
        themeSeries,
      });
      break;
    }
    case "trend:recompute": {
      const dryRun = args.includes("--dry-run");
      const store = new FirestoreStore();
      const reports = (await store.readReports()).map((item) => item.report);
      const scores = computeTrendScores(reports);
      const changed = reports
        .map((report) => ({ before: report, after: applyTrendScores(report, scores) }))
        .filter(({ before, after }) => !isDeepStrictEqual(before, after));
      if (!dryRun && changed.length) await store.updateReportPayloads(changed.map(({ after }) => after));
      print({
        dryRun,
        reports: reports.length,
        changed: changed.length,
        latest: changed.slice(0, 3).map(({ after }) => ({ date: after.date, trendScores: after.chart_data?.trend_scores })),
      });
      break;
    }
    case "metrics:validate": {
      const file = requiredFile(args[0]);
      print(validateMetricsDraft(await readJson(file)));
      break;
    }
    case "metrics:ingest": {
      const file = requiredFile(args[0]);
      const dryRun = args.includes("--dry-run");
      const input = await readJson(file);
      const summary = validateMetricsDraft(input);
      const draft = metricsDraftSchema.parse(input);
      const dates = draft.days.map((day) => day.date).sort();
      const runId = dates.length === 1 ? `metrics-${dates[0]}` : `metrics-${dates[0]}_${dates[dates.length - 1]}`;
      const store = new FirestoreStore();
      const master = await currentMetricsMaster(store);
      const reports = (await store.readReports()).map((item) => item.report);
      const next = withThemeCandidates(mergeMetricsDraft(master, draft), reports);
      if (!dryRun) {
        await store.beginRun(runId, "metrics");
        try {
          await store.writeMetricsMaster(next);
          await store.markRun(runId, "firestore_written", { dates });
        } catch (error) {
          await store.markRun(runId, "failed", { error: errorMessage(error) });
          throw error;
        }
      }
      print({ runId, dryRun, ...summary, dates: [dates[0], dates[dates.length - 1]] });
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
    case "interest:score": {
      const { runInterestScore } = await import("./interest/run.js");
      print(await runInterestScore(args.includes("--dry-run")));
      break;
    }
    case "interest:grant": {
      const uid = args[0];
      if (!uid) throw new Error("Usage: cli.ts interest:grant <uid>");
      const store = new FirestoreStore();
      await store.db.collection("access").doc(uid).set({ grantedAt: new Date().toISOString() }, { merge: true });
      print({ uid, status: "granted" });
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
      throw new Error("Usage: cli.ts <validate|validate-existing|migrate|ingest|trend:recompute|metrics:validate|metrics:ingest|export|publish:backfill|verify:public|sync:supplemental|mark-run|interest:grant|interest:score> [args]");
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

async function currentMetricsMaster(store: FirestoreStore): Promise<MetricsMaster> {
  const stored = await store.readMetricsMaster();
  if (stored && typeof stored === "object" && "series" in stored) return stored as MetricsMaster;
  try {
    return await readJson(path.join(repositoryRoot, "docs", "data", "metrics", "master.json")) as MetricsMaster;
  } catch {
    return emptyMaster();
  }
}

async function refreshThemeCandidates(store: FirestoreStore): Promise<string> {
  const master = await currentMetricsMaster(store);
  const reports = (await store.readReports()).map((item) => item.report);
  const next = withThemeCandidates(master, reports);
  if (isDeepStrictEqual(next, master)) return "unchanged";
  await store.writeMetricsMaster(next);
  return "updated";
}

function print(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}
