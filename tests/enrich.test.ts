import assert from "node:assert/strict";
import test from "node:test";
import { enrichReportWithArticleIds } from "../src/enrich.js";
import type { DailyReport } from "../src/schema.js";
import { articleIdForUrl } from "../src/url.js";

function sampleReport(): DailyReport {
  return {
    date: "2026-07-12",
    generated_at: "2026-07-12T06:00:00+09:00",
    top_summary: {},
    topics: [
      {
        theme: "最新AI情報",
        category: "interested",
        trend_score: 5,
        trend_history: [3, 5],
        summary_short: "要約",
        summary_long: "長い要約",
        related: [],
        articles: [
          {
            title: "記事A",
            url: "https://example.com/story?utm_source=x",
            source: "Example",
            summary_short: "短い",
            summary_long: "長い",
            importance: 3,
          },
        ],
      },
    ],
  };
}

function firstArticle(report: DailyReport) {
  const article = report.topics[0]?.articles[0];
  assert.ok(article);
  return article;
}

test("enrichReportWithArticleIds injects canonical articleId", () => {
  const enriched = enrichReportWithArticleIds(sampleReport());
  assert.equal(
    firstArticle(enriched).articleId,
    articleIdForUrl("https://example.com/story"),
  );
});

test("enrichReportWithArticleIds keeps existing articleId and is idempotent", () => {
  const report = sampleReport();
  firstArticle(report).articleId = "preset-id";
  const once = enrichReportWithArticleIds(report);
  const twice = enrichReportWithArticleIds(once);
  assert.equal(firstArticle(once).articleId, "preset-id");
  assert.deepEqual(twice, once);
});

test("enrichReportWithArticleIds does not mutate the input report", () => {
  const report = sampleReport();
  enrichReportWithArticleIds(report);
  assert.equal(firstArticle(report).articleId, undefined);
});
