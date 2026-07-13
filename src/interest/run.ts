import path from "node:path";
import { deleteApp } from "firebase-admin/app";
import { FieldValue } from "firebase-admin/firestore";
import { z } from "zod";
import { FirestoreStore } from "../firestore.js";
import { readJson, repositoryRoot, writeJson } from "../files.js";
import { pruneTelemetryEvents, readExposures, readTelemetryEvents, readViewerArticles, viewerDatabase } from "./collector.js";
import { score } from "./scoring.js";
import type { InterestAggregate, ScoringInput } from "./types.js";

const DAY_MS = 86400000;
const EVENT_RETENTION_DAYS = 60;

const interestConfigSchema = z.object({
  window_days: z.number().int().positive(),
  half_life_days: z.number().positive(),
  weights: z.object({
    expand: z.number(),
    source_click: z.number(),
    promotion: z.number(),
    generation: z.number(),
    read: z.number(),
    later: z.number(),
    stale_promotion: z.number(),
  }),
  stale_after_days: z.number().positive(),
  repromotion_multiplier: z.number().positive(),
  smoothing_exposures: z.number().positive(),
  min_exposure: z.number().int().positive(),
  lift_boost_threshold: z.number().positive(),
  lift_decay_threshold: z.number().positive(),
});

const themesSchema = z.array(z.object({
  name: z.string().min(1),
  category: z.enum(["interested", "must_know"]),
  keywords: z.array(z.string()).default([]),
}).passthrough());

export interface InterestRunSummary {
  weekId: string;
  dryRun: boolean;
  outputFile: string;
  funnel: InterestAggregate["funnel"];
  keywords: number;
  outOfConfig: number;
  prunedEvents: number;
}

export async function runInterestScore(dryRun: boolean, now = new Date().toISOString()): Promise<InterestRunSummary> {
  const rawConfig = await readJson(path.join(repositoryRoot, "config.json")) as Record<string, unknown>;
  const config = interestConfigSchema.parse(rawConfig.interest);
  const themes = themesSchema.parse(rawConfig.themes);

  const store = new FirestoreStore();
  const nowMs = Date.parse(now);
  const sinceMs = nowMs - config.window_days * DAY_MS;
  const sinceDate = new Date(sinceMs).toISOString().slice(0, 10);

  const viewerDb = viewerDatabase();
  let exposures;
  let events;
  let viewerArticles;
  try {
    [exposures, events, viewerArticles] = await Promise.all([
      readExposures(store.db, sinceDate),
      readTelemetryEvents(store.db, sinceMs),
      readViewerArticles(viewerDb),
    ]);
  } finally {
    // goOffline() leaves reconnect timers behind; deleting the app is the only
    // reliable way to let the process exit.
    await deleteApp(viewerDb.app).catch(() => {});
  }

  const input: ScoringInput = { now, config, themes, exposures, events, viewerArticles };
  const aggregate = score(input);

  const weekId = isoWeekId(new Date(nowMs));
  const outputFile = path.join(repositoryRoot, "interest-work", `${aggregate.until}-w${config.window_days}.json`);
  await writeJson(outputFile, aggregate);

  let prunedEvents = 0;
  if (!dryRun) {
    await store.db.collection("interestAggregates").doc(weekId).set({
      weekId,
      payload: aggregate,
      updatedAt: FieldValue.serverTimestamp(),
    });
    prunedEvents = await pruneTelemetryEvents(store.db, nowMs - EVENT_RETENTION_DAYS * DAY_MS);
  }

  return {
    weekId,
    dryRun,
    outputFile,
    funnel: aggregate.funnel,
    keywords: aggregate.keywords.length,
    outOfConfig: aggregate.outOfConfig.length,
    prunedEvents,
  };
}

export function isoWeekId(date: Date): string {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((d.getTime() - yearStart.getTime()) / DAY_MS + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}
