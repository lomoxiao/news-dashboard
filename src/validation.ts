import { listDailyReportFiles, readDailyReport } from "./files.js";
import type { DailyReport } from "./schema.js";
import { articleIdForUrl } from "./url.js";

export interface ValidationResult {
  date: string;
  articles: number;
  uniqueArticles: number;
  duplicateArticles: number;
  summaryLengthViolations: number;
}

export function validateReportSemantics(report: DailyReport, strict = true): ValidationResult {
  const seen = new Set<string>();
  let articles = 0;
  let duplicateArticles = 0;
  let summaryLengthViolations = 0;
  for (const topic of report.topics) {
    for (const article of topic.articles) {
      articles += 1;
      const id = articleIdForUrl(article.url);
      if (seen.has(id)) {
        duplicateArticles += 1;
        if (strict) throw new Error(`Duplicate URL in ${report.date}: ${article.url}`);
      }
      seen.add(id);
      if ([...article.summary_short].length > 50) {
        summaryLengthViolations += 1;
        if (strict) throw new Error(`summary_short exceeds 50 characters in ${report.date}: ${article.title}`);
      }
    }
  }
  return { date: report.date, articles, uniqueArticles: seen.size, duplicateArticles, summaryLengthViolations };
}

export async function validateExistingReports(): Promise<ValidationResult[]> {
  const results: ValidationResult[] = [];
  for (const file of await listDailyReportFiles()) {
    results.push(validateReportSemantics(await readDailyReport(file), false));
  }
  return results;
}
