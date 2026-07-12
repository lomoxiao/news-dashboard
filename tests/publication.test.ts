import assert from "node:assert/strict";
import test from "node:test";
import { buildPublicIndex, sourceIndex, type StoredReport } from "../src/publication.js";
import type { DailyReport, PublicIndex } from "../src/schema.js";

function report(date: string, sources: string[]): DailyReport {
  return {
    date,
    generated_at: date + "T06:00:00+09:00",
    top_summary: {
      journalist: {
        lead: "Lead",
        highlights: [],
        must_read: { title: "Article", url: "https://example.com", reason: "Reason" },
      },
    },
    topics: [{
      theme: "Theme",
      category: "interested",
      trend_score: 1,
      trend_history: [],
      summary_short: "Short",
      summary_long: "Long",
      articles: sources.map((source, index) => ({
        title: "Article " + index,
        url: "https://example.com/" + date + "/" + index,
        source,
        summary_short: "Short",
        summary_long: "Long",
        importance: 3,
      })),
      related: [],
    }],
  };
}

test("sourceIndex recounts reports and preserves known source URLs", () => {
  assert.deepEqual(sourceIndex([
    report("2026-07-12", ["Beta", "Alpha"]),
    report("2026-07-11", ["Alpha"]),
  ], [
    { name: "Alpha", url: "https://example.com/alpha", count: 99 },
    { name: "Unused", url: "https://example.com/unused", count: 1 },
  ]), [
    { name: "Alpha", count: 2, url: "https://example.com/alpha" },
    { name: "Beta", count: 1, url: "" },
  ]);
});

test("buildPublicIndex is deterministic and limits archive entries to 365", () => {
  const reports: StoredReport[] = Array.from({ length: 366 }, (_, index) => {
    const day = String(index + 1).padStart(3, "0");
    return { report: report("2026-" + day.slice(0, 2) + "-" + day.slice(1), ["Alpha"]), headline: "H" + index };
  });
  const legacy: PublicIndex = {
    last_updated: "old",
    reports: [],
    all_sources: [{ name: "Alpha", url: "https://example.com/alpha", count: 1 }],
  };
  const index = buildPublicIndex(reports, legacy, "2026-07-12T00:00:00.000Z");
  assert.equal(index.reports.length, 365);
  assert.equal(index.last_updated, "2026-07-12T00:00:00.000Z");
  assert.deepEqual(index.all_sources, [{ name: "Alpha", count: 366, url: "https://example.com/alpha" }]);
});
