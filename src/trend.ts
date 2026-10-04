import type { DailyReport } from "./schema.js";

/**
 * Theme "heat" scores computed deterministically from stored reports.
 *
 * score = 50 * (today's signal) / (mean signal of the previous reports), clamped to 0-100.
 * An average day is 50 and a day at twice the recent average is 100.
 *
 * Signal: the theme's `candidate_count` (articles that matched the theme during
 * collection, before filtering and the per-theme cap) when today and enough of
 * the baseline reports carry it; otherwise articles × mean importance.
 */
export const TREND_BASELINE_REPORTS = 7;
export const TREND_HISTORY_LENGTH = 7;
export const MIN_CANDIDATE_BASELINE = 3;
export const NEUTRAL_SCORE = 50;

type Topic = DailyReport["topics"][number];

/**
 * Theme names the daily job used by mistake in Jul-Aug 2026, mapped to the configured
 * name so their history joins up. New reports are rejected at validation instead.
 */
export const THEME_ALIASES: Record<string, string> = {
  "AI": "最新AI情報",
  "NTT・ドコモ": "NTTドコモ",
  "量子技術": "量子コンピュータ",
  "金融": "金融決済",
  "国内重要ニュース": "国内・社会",
};

export function canonicalTheme(theme: string): string {
  return THEME_ALIASES[theme] ?? theme;
}

export function candidateCount(topic: Topic): number | null {
  const value = (topic as { candidate_count?: unknown }).candidate_count;
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}

export function fallbackSignal(topic: Topic): number {
  const articles = topic.articles ?? [];
  if (articles.length === 0) return 0;
  const meanImportance = articles.reduce((sum, article) => sum + article.importance, 0) / articles.length;
  return articles.length * meanImportance;
}

export function scoreFromSignal(signal: number, baseline: number[]): number {
  if (baseline.length === 0) return NEUTRAL_SCORE;
  const mean = baseline.reduce((sum, value) => sum + value, 0) / baseline.length;
  if (mean <= 0) return signal > 0 ? 100 : NEUTRAL_SCORE;
  return Math.round(Math.min(100, Math.max(0, NEUTRAL_SCORE * signal / mean)));
}

/** Scores for every (date, theme) pair, computed over reports in chronological order. */
export function computeTrendScores(reports: DailyReport[]): Map<string, Map<string, number>> {
  const ordered = [...reports].sort((a, b) => a.date.localeCompare(b.date));
  const byTheme = new Map<string, Array<{ date: string; topic: Topic }>>();
  for (const report of ordered) {
    for (const topic of report.topics) {
      const key = canonicalTheme(topic.theme);
      const list = byTheme.get(key) ?? [];
      list.push({ date: report.date, topic });
      byTheme.set(key, list);
    }
  }
  const scores = new Map<string, Map<string, number>>();
  for (const [theme, entries] of byTheme) {
    entries.forEach(({ date, topic }, index) => {
      const previous = entries.slice(Math.max(0, index - TREND_BASELINE_REPORTS), index).map((entry) => entry.topic);
      const todayCandidates = candidateCount(topic);
      const candidateBaseline = previous.map(candidateCount).filter((value): value is number => value !== null);
      const score = todayCandidates !== null && candidateBaseline.length >= MIN_CANDIDATE_BASELINE
        ? scoreFromSignal(todayCandidates, candidateBaseline)
        : scoreFromSignal(fallbackSignal(topic), previous.map(fallbackSignal));
      const forDate = scores.get(date) ?? new Map<string, number>();
      forDate.set(theme, score);
      scores.set(date, forDate);
    });
  }
  return scores;
}

/** Returns the report with trend_score / trend_history / chart_data.trend_scores recomputed. */
export function applyTrendScores(report: DailyReport, scores: Map<string, Map<string, number>>): DailyReport {
  const datesAscending = [...scores.keys()].filter((date) => date <= report.date).sort();
  const topics = report.topics.map((topic) => {
    const history = datesAscending
      .map((date) => scores.get(date)?.get(canonicalTheme(topic.theme)))
      .filter((value): value is number => typeof value === "number")
      .slice(-TREND_HISTORY_LENGTH);
    const score = scores.get(report.date)?.get(canonicalTheme(topic.theme)) ?? NEUTRAL_SCORE;
    return { ...topic, trend_score: score, trend_history: history.length ? history : [score] };
  });
  const chartData = report.chart_data ?? {};
  return {
    ...report,
    topics,
    chart_data: {
      ...chartData,
      trend_scores: Object.fromEntries(topics.map((topic) => [topic.theme, topic.trend_score])),
    },
  };
}

/** Recomputes trends for `report` using stored reports (any stored copy of the same date is replaced). */
export function withTrendScores(report: DailyReport, stored: DailyReport[]): DailyReport {
  const all = stored.filter((item) => item.date !== report.date).concat(report);
  return applyTrendScores(report, computeTrendScores(all));
}
