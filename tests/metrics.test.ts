import assert from "node:assert/strict";
import test from "node:test";
import { emptyMaster, mergeMetricsDraft, validateMetricsDraft, withThemeCandidates, type MetricsMaster } from "../src/metrics.js";
import type { DailyReport } from "../src/schema.js";

const API = "https://export.arxiv.org/api/query?search_query=cat:cs.AI";
const MARKET = "https://example.com/quote";

function day(date: string, overrides: Record<string, unknown> = {}) {
  return {
    date,
    values: {
      arxiv_ai: { value: 420, source_url: API },
      arxiv_quantum: { value: 150, source_url: API },
      nikkei: { value: 40000, source_url: MARKET },
      usdjpy: { value: 150.2, source_url: MARKET },
      ...overrides,
    },
  };
}
const draft = (...days: unknown[]) => ({ collected_at: "2026-10-04T06:30:00+09:00", days });

test("accepts a well-formed weekday draft", () => {
  assert.deepEqual(validateMetricsDraft(draft(day("2026-10-02")), "2026-10-04"), { days: 1, values: 4, nulls: 0 });
});

test("rejects values without provenance, nulls without reason, and RSS-based arXiv counts", () => {
  assert.throws(() => validateMetricsDraft(draft(day("2026-10-02", { nikkei: { value: 40000 } })), "2026-10-04"), /needs source_url/);
  assert.throws(() => validateMetricsDraft(draft(day("2026-10-02", { usdjpy: { value: null } })), "2026-10-04"), /needs null_reason/);
  assert.throws(() => validateMetricsDraft(draft(day("2026-10-02", { arxiv_ai: { value: 50, source_url: "https://arxiv.org/rss/cs.AI" } })), "2026-10-04"), /arXiv API/);
});

test("rejects zero / out-of-range values, weekend market values and future dates", () => {
  assert.throws(() => validateMetricsDraft(draft(day("2026-10-02", { arxiv_ai: { value: 0, source_url: API } })), "2026-10-04"), /outside/);
  assert.throws(() => validateMetricsDraft(draft(day("2026-10-03")), "2026-10-04"), /closed on weekends/);
  assert.throws(() => validateMetricsDraft(draft(day("2026-10-05")), "2026-10-04"), /future/);
  assert.throws(() => validateMetricsDraft(draft(day("2026-10-02"), day("2026-10-02")), "2026-10-04"), /twice/);
});

test("weekend draft with market nulls is accepted", () => {
  const weekend = day("2026-10-03", {
    nikkei: { value: null, null_reason: "market closed (Saturday)" },
    usdjpy: { value: null, null_reason: "market closed (Saturday)" },
  });
  assert.equal(validateMetricsDraft(draft(weekend), "2026-10-04").nulls, 2);
});

test("merge upserts by date, keeps order and is idempotent", () => {
  const master: MetricsMaster = {
    last_updated: "",
    series: { arxiv_ai: { data: [{ date: "2026-10-01", value: 400 }, { date: "2026-10-02", value: 1 }] } },
  };
  const parsed = draft(day("2026-10-02"), day("2026-09-30")) as never;
  const once = mergeMetricsDraft(master, parsed, "t");
  const twice = mergeMetricsDraft(once, parsed, "t");
  assert.deepEqual(once, twice);
  assert.deepEqual(once.series.arxiv_ai?.data.map((p) => [p.date, p.value]), [["2026-09-30", 420], ["2026-10-01", 400], ["2026-10-02", 420]]);
  assert.equal(once.series.markets?.nikkei?.data[0]?.source_url, MARKET);
  assert.deepEqual(master.series.arxiv_ai?.data[1], { date: "2026-10-02", value: 1 }, "input master is not mutated");
});

test("merge rejects implausible market jumps", () => {
  const master = mergeMetricsDraft(emptyMaster(), draft(day("2026-10-01")) as never, "t");
  assert.throws(() => mergeMetricsDraft(master, draft(day("2026-10-02", { nikkei: { value: 60000, source_url: MARKET } })) as never), /more than 15%/);
});

test("theme candidate series only includes days that carry candidate_count", () => {
  const reports = [
    { date: "2026-10-01", topics: [{ theme: "Tech", articles: [] }] },
    { date: "2026-10-02", topics: [{ theme: "Tech", candidate_count: 12, articles: [] }] },
  ] as unknown as DailyReport[];
  const next = withThemeCandidates(emptyMaster(), reports);
  assert.deepEqual(next.series.theme_candidates?.Tech?.data, [{ date: "2026-10-02", value: 12 }]);
});
