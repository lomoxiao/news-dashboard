import { z } from "zod";
import { datePattern, type DailyReport } from "./schema.js";
import { candidateCount, canonicalTheme } from "./trend.js";

/**
 * Macro metrics pipeline.
 *
 * Codex writes a draft (.runtime/metrics/*.json) with one or more days of values and
 * their provenance. TypeScript validates the draft and merges it into the metrics
 * master by date, so re-running a day replaces that day instead of appending.
 */
export const COLLECTED_METRICS = ["arxiv_ai", "arxiv_quantum", "nikkei", "usdjpy"] as const;
export type CollectedMetric = typeof COLLECTED_METRICS[number];

const pointSchema = z.object({
  value: z.number().finite().nullable(),
  source_url: z.string().url().nullable().optional(),
  null_reason: z.string().min(1).nullable().optional(),
}).strict();

const daySchema = z.object({
  date: z.string().regex(datePattern),
  values: z.object({
    arxiv_ai: pointSchema,
    arxiv_quantum: pointSchema,
    nikkei: pointSchema,
    usdjpy: pointSchema,
  }).strict(),
}).strict();

export const metricsDraftSchema = z.object({
  collected_at: z.string().min(1),
  days: z.array(daySchema).min(1),
}).strict();

export type MetricsDraft = z.infer<typeof metricsDraftSchema>;
export type MetricPoint = z.infer<typeof pointSchema>;

const RANGES: Record<CollectedMetric, [number, number]> = {
  arxiv_ai: [1, 5000],
  arxiv_quantum: [1, 3000],
  nikkei: [10000, 150000],
  usdjpy: [50, 300],
};
const MARKET_METRICS: CollectedMetric[] = ["nikkei", "usdjpy"];
const MAX_MARKET_JUMP = 0.15;
const MAX_POINTS = 1000;

export function isWeekend(date: string): boolean {
  const day = new Date(date + "T00:00:00Z").getUTCDay();
  return day === 0 || day === 6;
}

/** Throws with every problem found; returns a short summary when the draft is acceptable. */
export function validateMetricsDraft(input: unknown, today = new Date().toISOString().slice(0, 10)): {
  days: number;
  values: number;
  nulls: number;
} {
  const draft = metricsDraftSchema.parse(input);
  const problems: string[] = [];
  const seen = new Set<string>();
  let values = 0;
  let nulls = 0;
  for (const day of draft.days) {
    if (seen.has(day.date)) problems.push(`${day.date}: date appears twice`);
    seen.add(day.date);
    if (day.date > today) problems.push(`${day.date}: date is in the future`);
    for (const metric of COLLECTED_METRICS) {
      const point = day.values[metric];
      const label = `${day.date} ${metric}`;
      if (point.value === null) {
        nulls += 1;
        if (!point.null_reason) problems.push(`${label}: null value needs null_reason`);
        continue;
      }
      values += 1;
      if (!point.source_url) problems.push(`${label}: value needs source_url`);
      const [min, max] = RANGES[metric];
      if (point.value < min || point.value > max) {
        problems.push(`${label}: ${point.value} is outside ${min}-${max} (use null with null_reason if unavailable)`);
      }
      if (metric.startsWith("arxiv")) {
        if (!Number.isInteger(point.value)) problems.push(`${label}: arXiv count must be an integer`);
        if (point.source_url && !point.source_url.includes("export.arxiv.org/api/")) {
          problems.push(`${label}: arXiv counts must come from the arXiv API totalResults (export.arxiv.org/api/), not RSS`);
        }
      }
      if (MARKET_METRICS.includes(metric) && isWeekend(day.date)) {
        problems.push(`${label}: markets are closed on weekends; use null with null_reason`);
      }
    }
  }
  if (problems.length) throw new Error("Metrics draft rejected:\n- " + problems.join("\n- "));
  return { days: draft.days.length, values, nulls };
}

// ── Master document ──────────────────────────────────────────────

export interface SeriesPoint { date: string; value: number | null; source_url?: string }
export interface Series { label?: string; unit?: string; data: SeriesPoint[] }
export interface MetricsMaster {
  last_updated: string;
  series: {
    arxiv_ai?: Series;
    arxiv_quantum?: Series;
    markets?: { nikkei?: Series; usdjpy?: Series };
    theme_candidates?: Record<string, Series>;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

const SERIES_META: Record<CollectedMetric, { label: string; unit: string }> = {
  arxiv_ai: { label: "AI論文数（cs.AI, 投稿日ベース）", unit: "件/日" },
  arxiv_quantum: { label: "量子論文数（quant-ph, 投稿日ベース）", unit: "件/日" },
  nikkei: { label: "日経平均（終値）", unit: "円" },
  usdjpy: { label: "USD/JPY（終値）", unit: "円" },
};

export function emptyMaster(): MetricsMaster {
  return { last_updated: "", series: {} };
}

function upsertPoint(series: Series | undefined, meta: { label: string; unit: string }, point: SeriesPoint): Series {
  const data = (series?.data ?? []).filter((item) => item.date !== point.date);
  data.push(point);
  data.sort((a, b) => a.date.localeCompare(b.date));
  return { ...series, label: meta.label, unit: meta.unit, data: data.slice(-MAX_POINTS) };
}

function seriesFor(master: MetricsMaster, metric: CollectedMetric): Series | undefined {
  return MARKET_METRICS.includes(metric)
    ? master.series.markets?.[metric as "nikkei" | "usdjpy"]
    : master.series[metric as "arxiv_ai" | "arxiv_quantum"];
}

function nearestPreviousValue(series: Series | undefined, date: string): number | null {
  const previous = (series?.data ?? []).filter((item) => item.date < date && typeof item.value === "number");
  return previous.at(-1)?.value ?? null;
}

/** Merges a validated draft into a copy of the master. Market values that jump >15% are rejected. */
export function mergeMetricsDraft(master: MetricsMaster, draft: MetricsDraft, updatedAt = new Date().toISOString()): MetricsMaster {
  const next: MetricsMaster = structuredClone(master);
  next.series = next.series ?? {};
  const problems: string[] = [];
  for (const day of [...draft.days].sort((a, b) => a.date.localeCompare(b.date))) {
    for (const metric of COLLECTED_METRICS) {
      const point = day.values[metric];
      const current = seriesFor(next, metric);
      if (MARKET_METRICS.includes(metric) && point.value !== null) {
        const previous = nearestPreviousValue(current, day.date);
        if (previous !== null && Math.abs(point.value - previous) / previous > MAX_MARKET_JUMP) {
          problems.push(`${day.date} ${metric}: ${point.value} differs from previous ${previous} by more than ${MAX_MARKET_JUMP * 100}%`);
          continue;
        }
      }
      const stored: SeriesPoint = { date: day.date, value: point.value };
      if (point.value !== null && point.source_url) stored.source_url = point.source_url;
      const updated = upsertPoint(current, SERIES_META[metric], stored);
      if (MARKET_METRICS.includes(metric)) {
        next.series.markets = { ...(next.series.markets ?? {}), [metric]: updated };
      } else {
        next.series[metric] = updated;
      }
    }
  }
  if (problems.length) throw new Error("Metrics merge rejected:\n- " + problems.join("\n- "));
  next.last_updated = updatedAt;
  return next;
}

/** Rebuilds the per-theme candidate-count series from stored reports (dates without a count are skipped). */
export function withThemeCandidates(master: MetricsMaster, reports: DailyReport[]): MetricsMaster {
  const series: Record<string, Series> = {};
  for (const report of [...reports].sort((a, b) => a.date.localeCompare(b.date))) {
    for (const topic of report.topics) {
      const count = candidateCount(topic);
      if (count === null) continue;
      const theme = canonicalTheme(topic.theme);
      const current = series[theme] ?? { label: theme, unit: "件/日", data: [] };
      current.data.push({ date: report.date, value: count });
      series[theme] = current;
    }
  }
  for (const value of Object.values(series)) value.data = value.data.slice(-MAX_POINTS);
  return { ...master, series: { ...master.series, theme_candidates: series } };
}
