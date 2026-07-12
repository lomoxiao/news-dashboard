import { articleIdForUrl } from "./url.js";
import type { DailyReport } from "./schema.js";

export function enrichReportWithArticleIds(report: DailyReport): DailyReport {
  return {
    ...report,
    topics: report.topics.map((topic) => ({
      ...topic,
      articles: topic.articles.map((article) => {
        if (typeof article.articleId === "string" && article.articleId.length > 0) return article;
        try {
          return { ...article, articleId: articleIdForUrl(article.url) };
        } catch {
          return article;
        }
      }),
    })),
  };
}
