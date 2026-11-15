import { z } from "zod";
import type { DailyReport } from "./schema.js";

/**
 * "今日のまとめ" の材料づくり。検証済みの日次レポートから、章ごとの上位記事と要約を取り出す。
 * AI は使わない純粋な関数。出力の形は article-to-slides-automation 側
 * (src/domains/digest/digestInput.ts) の検証と対になっているため、変えるときは両方を直す。
 */
export const DIGEST_SCHEMA_VERSION = 1;

export const digestConfigSchema = z.object({
  chapters: z.array(z.object({
    title: z.string().min(1),
    themes: z.array(z.string().min(1)).min(1),
  })).min(1),
  per_chapter_max: z.number().int().positive(),
  total_max: z.number().int().positive(),
});

export type DigestConfig = z.infer<typeof digestConfigSchema>;

export interface DigestArticle {
  title: string;
  url: string;
  source: string;
  summary: string;
  importance: number;
}

export interface DigestChapter {
  title: string;
  articles: DigestArticle[];
}

export interface DigestInput {
  schemaVersion: typeof DIGEST_SCHEMA_VERSION;
  date: string;
  generatedAt: string;
  chapters: DigestChapter[];
}

export function buildDigestInput(report: DailyReport, config: DigestConfig, generatedAt: string): DigestInput {
  const seenUrls = new Set<string>();
  const chapters: DigestChapter[] = config.chapters.map((chapter) => {
    const candidates = report.topics
      .filter((topic) => chapter.themes.includes(topic.theme))
      .flatMap((topic) => topic.articles)
      .filter((article) => article.fetch_failed !== true);
    // importance の高い順。同点は元の並びを保つ(Array.prototype.sort は安定)
    const ranked = [...candidates].sort((a, b) => b.importance - a.importance);
    const articles: DigestArticle[] = [];
    for (const article of ranked) {
      if (articles.length >= config.per_chapter_max) break;
      if (seenUrls.has(article.url)) continue;
      seenUrls.add(article.url);
      articles.push({
        title: article.title,
        url: article.url,
        source: article.source,
        summary: article.summary_long,
        importance: article.importance,
      });
    }
    return { title: chapter.title, articles };
  });

  // 合計の上限を超える場合は、記事数が最も多い章(同数なら後ろの章)の末尾から削る
  let total = chapters.reduce((sum, chapter) => sum + chapter.articles.length, 0);
  while (total > config.total_max) {
    let target: DigestChapter | undefined;
    for (const chapter of chapters) {
      if (!target || chapter.articles.length >= target.articles.length) target = chapter;
    }
    if (!target || target.articles.length === 0) break;
    target.articles.pop();
    total -= 1;
  }

  return {
    schemaVersion: DIGEST_SCHEMA_VERSION,
    date: report.date,
    generatedAt,
    // 記事が0件の章は省く。全章0件なら chapters は空配列(受け取り側が「該当なし」として扱う)
    chapters: chapters.filter((chapter) => chapter.articles.length > 0),
  };
}
