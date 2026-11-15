import assert from "node:assert/strict";
import test from "node:test";
import { buildDigestInput, digestConfigSchema, type DigestConfig } from "../src/digest.js";
import type { DailyReport } from "../src/schema.js";

const config: DigestConfig = {
  chapters: [
    { title: "AI", themes: ["最新AI情報"] },
    { title: "金融決済", themes: ["金融決済"] },
    { title: "量子", themes: ["量子コンピュータ"] },
  ],
  per_chapter_max: 3,
  total_max: 9,
};

function article(title: string, importance: number, extra: Record<string, unknown> = {}) {
  return {
    title,
    url: `https://example.com/${encodeURIComponent(title)}`,
    source: "Example",
    summary_short: `${title} short`,
    summary_long: `${title} long`,
    importance,
    ...extra,
  };
}

function report(topics: Array<{ theme: string; articles: ReturnType<typeof article>[] }>): DailyReport {
  return {
    date: "2026-11-15",
    generated_at: "2026-11-15T06:00:00+09:00",
    top_summary: {},
    topics: topics.map((topic) => ({
      theme: topic.theme,
      category: "interested" as const,
      trend_score: 0,
      trend_history: [],
      summary_short: "s",
      summary_long: "l",
      articles: topic.articles,
      related: [],
    })),
  } as DailyReport;
}

test("章の順に、importance の高い順で上限件数まで選ぶ", () => {
  const digest = buildDigestInput(report([
    { theme: "金融決済", articles: [article("p1", 4), article("p2", 5)] },
    { theme: "最新AI情報", articles: [article("a1", 3), article("a2", 5), article("a3", 4), article("a4", 5)] },
  ]), config, "now");

  assert.equal(digest.schemaVersion, 1);
  assert.equal(digest.date, "2026-11-15");
  assert.deepEqual(digest.chapters.map((chapter) => chapter.title), ["AI", "金融決済"]);
  assert.deepEqual(digest.chapters[0]?.articles.map((item) => item.title), ["a2", "a4", "a3"]);
  assert.deepEqual(digest.chapters[1]?.articles.map((item) => item.title), ["p2", "p1"]);
  assert.equal(digest.chapters[0]?.articles[0]?.summary, "a2 long");
});

test("fetch_failed の記事と、対象外テーマの記事は含めない", () => {
  const digest = buildDigestInput(report([
    { theme: "最新AI情報", articles: [article("ok", 3), article("ng", 5, { fetch_failed: true })] },
    { theme: "NTTドコモ", articles: [article("docomo", 5)] },
    { theme: "国内・社会", articles: [article("society", 5)] },
  ]), config, "now");

  assert.deepEqual(digest.chapters.map((chapter) => chapter.title), ["AI"]);
  assert.deepEqual(digest.chapters[0]?.articles.map((item) => item.title), ["ok"]);
});

test("記事が0件の章は省き、全章0件なら chapters は空になる", () => {
  const some = buildDigestInput(report([{ theme: "量子コンピュータ", articles: [article("q1", 4)] }]), config, "now");
  assert.deepEqual(some.chapters.map((chapter) => chapter.title), ["量子"]);

  const none = buildDigestInput(report([{ theme: "国内・社会", articles: [article("s1", 5)] }]), config, "now");
  assert.deepEqual(none.chapters, []);
});

test("合計の上限を超えたら、記事数の多い章の末尾から削る", () => {
  const digest = buildDigestInput(report([
    { theme: "最新AI情報", articles: [article("a1", 5), article("a2", 4), article("a3", 3)] },
    { theme: "金融決済", articles: [article("p1", 5), article("p2", 4), article("p3", 3)] },
    { theme: "量子コンピュータ", articles: [article("q1", 5)] },
  ]), { ...config, total_max: 5 }, "now");

  assert.equal(digest.chapters.reduce((sum, chapter) => sum + chapter.articles.length, 0), 5);
  assert.deepEqual(digest.chapters.map((chapter) => chapter.articles.length), [2, 2, 1]);
  assert.deepEqual(digest.chapters[0]?.articles.map((item) => item.title), ["a1", "a2"]);
});

test("同じURLの記事は最初の章だけに入れる", () => {
  const shared = article("shared", 5);
  const digest = buildDigestInput(report([
    { theme: "最新AI情報", articles: [shared] },
    { theme: "金融決済", articles: [shared, article("p1", 3)] },
  ]), config, "now");

  assert.deepEqual(digest.chapters[1]?.articles.map((item) => item.title), ["p1"]);
});

test("設定の形を検証する", () => {
  assert.throws(() => digestConfigSchema.parse({ chapters: [], per_chapter_max: 3, total_max: 9 }));
  assert.doesNotThrow(() => digestConfigSchema.parse(config));
});
