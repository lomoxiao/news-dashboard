import assert from "node:assert/strict";
import test from "node:test";
import { decayFactor, joinViewerArticles, score } from "../src/interest/scoring.js";
import type { ExposureItem, InterestConfig, ScoringInput, ThemeConfig, ViewerArticle } from "../src/interest/types.js";
import { articleIdForUrl } from "../src/url.js";

const NOW = "2026-07-13T00:00:00.000Z";
const NOW_MS = Date.parse(NOW);
const DAY_MS = 86400000;

function baseConfig(): InterestConfig {
  return {
    window_days: 28,
    half_life_days: 14,
    weights: { expand: 1, source_click: 2, promotion: 3, generation: 1, read: 2, later: 0.5, stale_promotion: -1 },
    stale_after_days: 14,
    repromotion_multiplier: 1.5,
    smoothing_exposures: 8,
    min_exposure: 8,
    lift_boost_threshold: 2,
    lift_decay_threshold: 0.3,
  };
}

function themes(): ThemeConfig[] {
  return [
    { name: "最新AI情報", category: "interested", keywords: ["量子誤り訂正", "エージェント"] },
    { name: "国内・社会", category: "must_know", keywords: ["路線価"] },
  ];
}

function exposure(n: number, overrides: Partial<ExposureItem> = {}): ExposureItem {
  const url = overrides.canonicalUrl ?? `https://example.com/a${n}`;
  return {
    articleId: articleIdForUrl(url),
    canonicalUrl: url,
    date: "2026-07-10",
    themeName: "最新AI情報",
    category: "interested",
    sourceName: "SourceA",
    title: `記事${n}`,
    summaryShort: "要約",
    importance: 3,
    ...overrides,
    ...(overrides.canonicalUrl ? { articleId: articleIdForUrl(overrides.canonicalUrl) } : {}),
  };
}

function input(overrides: Partial<ScoringInput> = {}): ScoringInput {
  return { now: NOW, config: baseConfig(), themes: themes(), exposures: [], events: [], viewerArticles: [], ...overrides };
}

test("decayFactor halves at exactly one half-life", () => {
  assert.equal(decayFactor(NOW_MS, NOW_MS, 14), 1);
  assert.ok(Math.abs(decayFactor(NOW_MS - 14 * DAY_MS, NOW_MS, 14) - 0.5) < 1e-9);
});

test("expand and source_click add decayed weights once per article", () => {
  const item = exposure(1);
  const result = score(input({
    exposures: [item],
    events: [
      { action: "impression", ts: NOW_MS - 1000, date: "2026-07-10", articleId: item.articleId },
      { action: "expand", ts: NOW_MS - 1000, date: "2026-07-10", articleId: item.articleId },
      { action: "expand", ts: NOW_MS - 500, date: "2026-07-10", articleId: item.articleId },
      { action: "source_click", ts: NOW_MS - 500, date: "2026-07-10", url: item.canonicalUrl },
    ],
  }));
  assert.equal(result.funnel.seen, 1);
  assert.equal(result.funnel.expanded, 1);
  assert.equal(result.funnel.sourceClicked, 1);
  const theme = result.themes.find((t) => t.theme === "最新AI情報");
  assert.ok(theme);
  assert.ok(Math.abs(theme.engagement - 3) < 0.01, `engagement=${theme.engagement}`);
});

test("viewer promotion joins by canonical URL and read state adds weight", () => {
  const item = exposure(1, { canonicalUrl: "https://example.com/story?utm_source=x" });
  const viewer: ViewerArticle = {
    viewerId: "url_abc",
    canonicalUrl: "https://EXAMPLE.com/story",
    title: "記事1",
    promotedAt: NOW,
    hasGeneration: true,
    readState: "read",
    readStateUpdatedAt: NOW,
  };
  const result = score(input({ exposures: [item], viewerArticles: [viewer] }));
  assert.equal(result.funnel.promoted, 1);
  assert.equal(result.funnel.read, 1);
  assert.equal(result.outOfConfig.length, 0);
  const theme = result.themes.find((t) => t.theme === "最新AI情報");
  assert.ok(theme && Math.abs(theme.engagement - 6) < 0.01, `engagement=${theme?.engagement}`);
});

test("promoted viewer articles the dashboard never collected become out-of-config discoveries", () => {
  const viewer: ViewerArticle = {
    viewerId: "url_xyz",
    canonicalUrl: "https://note.com/someone/n/n123",
    title: "Noteの記事",
    promotedAt: NOW,
    hasGeneration: true,
    readState: null,
    readStateUpdatedAt: null,
  };
  const old: ViewerArticle = { ...viewer, viewerId: "url_old", canonicalUrl: "https://note.com/old", promotedAt: "2026-01-01T00:00:00Z" };
  const result = score(input({ exposures: [exposure(1)], viewerArticles: [viewer, old] }));
  assert.equal(result.outOfConfig.length, 1);
  assert.equal(result.outOfConfig[0]?.viewerId, "url_xyz");
});

test("stale unread promotion is penalized", () => {
  const item = exposure(1);
  const promotedAt = new Date(NOW_MS - 20 * DAY_MS).toISOString();
  const viewer: ViewerArticle = {
    viewerId: "v1", canonicalUrl: item.canonicalUrl, title: "t",
    promotedAt, hasGeneration: false, readState: null, readStateUpdatedAt: null,
  };
  const result = score(input({ exposures: [item], viewerArticles: [viewer] }));
  const theme = result.themes.find((t) => t.theme === "最新AI情報");
  const decay = decayFactor(Date.parse(promotedAt), NOW_MS, 14);
  const expected = (3 - 1) * decay;
  assert.ok(theme && Math.abs(theme.engagement - expected) < 0.01, `engagement=${theme?.engagement} expected=${expected}`);
});

test("keyword lift concentrates on engaged keyword and smoothing keeps low-data near 1", () => {
  const config = { ...baseConfig(), min_exposure: 2 };
  const hot = Array.from({ length: 6 }, (_, i) =>
    exposure(i, { canonicalUrl: `https://example.com/hot${i}`, title: `量子誤り訂正の進展${i}`, summaryShort: "研究" }));
  const cold = Array.from({ length: 6 }, (_, i) =>
    exposure(100 + i, { canonicalUrl: `https://example.com/cold${i}`, title: `エージェント設計${i}`, summaryShort: "解説" }));
  const events = hot.map((item) => ({
    action: "source_click" as const, ts: NOW_MS - 1000, date: "2026-07-10", articleId: item.articleId,
  }));
  const result = score(input({ config, exposures: [...hot, ...cold], events }));
  const hotStat = result.keywords.find((k) => k.keyword === "量子誤り訂正");
  const coldStat = result.keywords.find((k) => k.keyword === "エージェント");
  assert.ok(hotStat && coldStat);
  assert.ok(hotStat.lift > coldStat.lift, `hot=${hotStat.lift} cold=${coldStat.lift}`);
  assert.ok(hotStat.lift > 1);
  assert.ok(coldStat.lift < 1);
  assert.ok(coldStat.lift > 0.3, "smoothing keeps sparse keywords away from extreme verdicts");
});

test("low exposure keywords get a low-data verdict, never decay-candidate", () => {
  const result = score(input({ exposures: [exposure(1, { title: "量子誤り訂正" })] }));
  const stat = result.keywords.find((k) => k.keyword === "量子誤り訂正");
  assert.equal(stat?.verdict, "low-data");
});

test("must_know themes produce no keyword stats", () => {
  const result = score(input({ exposures: [exposure(1, { themeName: "国内・社会", category: "must_know", title: "路線価上昇" })] }));
  assert.equal(result.keywords.some((k) => k.theme === "国内・社会"), false);
});

test("repromotion multiplier boosts keywords with two or more promotions", () => {
  const config = { ...baseConfig(), min_exposure: 2, smoothing_exposures: 0.0001 };
  const a = exposure(1, { canonicalUrl: "https://example.com/q1", title: "量子誤り訂正A" });
  const b = exposure(2, { canonicalUrl: "https://example.com/q2", title: "量子誤り訂正B" });
  const single = exposure(3, { canonicalUrl: "https://example.com/e1", title: "エージェントA" });
  const filler = exposure(4, { canonicalUrl: "https://example.com/f1", title: "その他" });
  const promote = (item: ExposureItem, id: string): ViewerArticle => ({
    viewerId: id, canonicalUrl: item.canonicalUrl, title: item.title,
    promotedAt: NOW, hasGeneration: false, readState: "read", readStateUpdatedAt: NOW,
  });
  const result = score(input({
    config,
    exposures: [a, b, single, filler],
    viewerArticles: [promote(a, "v1"), promote(b, "v2"), promote(single, "v3")],
  }));
  const doubled = result.keywords.find((k) => k.keyword === "量子誤り訂正");
  const singleStat = result.keywords.find((k) => k.keyword === "エージェント");
  assert.ok(doubled && singleStat);
  // per-article engagement is identical (5); the ×1.5 on promotion weight only helps the repromoted keyword
  const doubledPerExposure = doubled.engagement / doubled.exposures;
  const singlePerExposure = singleStat.engagement / singleStat.exposures;
  assert.ok(doubledPerExposure > singlePerExposure, `${doubledPerExposure} <= ${singlePerExposure}`);
});

test("joinViewerArticles matches across URL tracking variants", () => {
  const id = articleIdForUrl("https://example.com/story");
  const { matched, outOfConfig } = joinViewerArticles(
    [{ viewerId: "v1", canonicalUrl: "https://example.com/story?utm_medium=social", title: "t", promotedAt: NOW, hasGeneration: false, readState: null, readStateUpdatedAt: null }],
    new Set([id]),
    NOW_MS - 28 * DAY_MS,
  );
  assert.equal(matched.size, 1);
  assert.ok(matched.has(id));
  assert.equal(outOfConfig.length, 0);
});
