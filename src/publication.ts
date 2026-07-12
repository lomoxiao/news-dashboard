import type { DailyReport, PublicIndex } from "./schema.js";

export interface StoredReport {
  report: DailyReport;
  headline: string;
}

export function buildPublicIndex(
  reports: StoredReport[],
  legacy: PublicIndex | null,
  updatedAt = new Date().toISOString(),
): PublicIndex {
  return {
    ...(legacy ?? { last_updated: "", reports: [], all_sources: [] }),
    last_updated: updatedAt,
    reports: reports.slice(0, 365).map(({ report, headline }) => ({
      date: report.date,
      headline,
    })),
    all_sources: sourceIndex(reports.map(({ report }) => report), legacy?.all_sources ?? []),
  };
}

export function sourceIndex(
  reports: Array<{ topics: Array<{ articles: Array<{ source: string }> }> }>,
  legacy: PublicIndex["all_sources"],
): PublicIndex["all_sources"] {
  const urls = new Map(legacy.map((source) => [source.name, source.url]));
  const counts = new Map<string, number>();
  for (const report of reports) {
    for (const topic of report.topics) {
      for (const article of topic.articles) {
        counts.set(article.source, (counts.get(article.source) ?? 0) + 1);
      }
    }
  }
  return [...counts.entries()]
    .map(([name, count]) => ({ name, count, url: urls.get(name) ?? "" }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}
