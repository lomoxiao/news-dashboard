import assert from "node:assert/strict";
import test from "node:test";
import type { DailyReport } from "../src/schema.js";
import { applyTrendScores, computeTrendScores, scoreFromSignal, withTrendScores } from "../src/trend.js";

function report(date: string, themes: Record<string, { articles?: number; importance?: number; candidates?: number }>): DailyReport {
  return {
    date,
    generated_at: date + "T06:00:00+09:00",
    top_summary: {},
    topics: Object.entries(themes).map(([theme, spec]) => ({
      theme,
      category: "interested" as const,
      trend_score: 100,
      trend_history: [100, 100],
      summary_short: "s",
      summary_long: "l",
      related: [],
      ...(spec.candidates === undefined ? {} : { candidate_count: spec.candidates }),
      articles: Array.from({ length: spec.articles ?? 3 }, (_, i) => ({
        title: "t" + i,
        url: `https://example.com/${date}/${theme}/${i}`,
        source: "S",
        summary_short: "s",
        summary_long: "l",
        importance: spec.importance ?? 4,
      })),
    })),
  };
}

test("an average day scores 50, double the average 100, and the score is capped", () => {
  assert.equal(scoreFromSignal(10, [10, 10]), 50);
  assert.equal(scoreFromSignal(20, [10, 10]), 100);
  assert.equal(scoreFromSignal(40, [10, 10]), 100);
  assert.equal(scoreFromSignal(5, [10, 10]), 25);
  assert.equal(scoreFromSignal(7, []), 50);
});

test("identical days no longer saturate at 100", () => {
  const reports = ["2026-09-01", "2026-09-02", "2026-09-03"].map((d) => report(d, { Tech: {} }));
  const scores = computeTrendScores(reports);
  assert.deepEqual([...scores.values()].map((m) => m.get("Tech")), [50, 50, 50]);
});

test("candidate_count drives the score once enough baseline days carry it", () => {
  const reports = [
    report("2026-09-01", { Tech: { candidates: 10 } }),
    report("2026-09-02", { Tech: { candidates: 10 } }),
    report("2026-09-03", { Tech: { candidates: 10 } }),
    report("2026-09-04", { Tech: { candidates: 30 } }),
    report("2026-09-05", { Tech: { candidates: 5 } }),
  ];
  const scores = computeTrendScores(reports);
  assert.equal(scores.get("2026-09-04")?.get("Tech"), 100);
  // baseline for 09-05 = mean(10,10,10,30) = 15 → 50*5/15 ≈ 17
  assert.equal(scores.get("2026-09-05")?.get("Tech"), 17);
});

test("falls back to articles × importance when candidate counts are missing", () => {
  const reports = [
    report("2026-09-01", { Q: { articles: 3, importance: 4 } }),
    report("2026-09-02", { Q: { articles: 6, importance: 4 } }),
  ];
  assert.equal(computeTrendScores(reports).get("2026-09-02")?.get("Q"), 100);
});

test("applyTrendScores rewrites score, history and chart_data from computed values", () => {
  const reports = ["2026-09-01", "2026-09-02"].map((d) => report(d, { Tech: {}, Q: { articles: 1 } }));
  const updated = applyTrendScores(reports[1]!, computeTrendScores(reports));
  assert.equal(updated.topics[0]!.trend_score, 50);
  assert.deepEqual(updated.topics[0]!.trend_history, [50, 50]);
  assert.deepEqual(updated.chart_data?.trend_scores, { Tech: 50, Q: 50 });
});

test("withTrendScores ignores a stored copy of the same date (idempotent re-runs)", () => {
  const stored = [report("2026-09-01", { Tech: {} }), report("2026-09-02", { Tech: { articles: 30 } })];
  const draft = report("2026-09-02", { Tech: {} });
  assert.equal(withTrendScores(draft, stored).topics[0]!.trend_score, 50);
});

test("historical theme-name variants share one history", () => {
  const reports = [report("2026-08-01", { "金融": {} }), report("2026-08-02", { "金融決済": { articles: 6 } })];
  assert.equal(computeTrendScores(reports).get("2026-08-02")?.get("金融決済"), 100);
});
