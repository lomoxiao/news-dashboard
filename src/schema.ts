import { z } from "zod";

export const datePattern = /^\d{4}-\d{2}-\d{2}$/;

export const articleSchema = z.object({
  title: z.string().min(1),
  url: z.string().url(),
  articleId: z.string().min(1).optional(),
  source: z.string().min(1),
  summary_short: z.string().min(1),
  summary_long: z.string().min(1),
  importance: z.number().int().min(1).max(5),
  fetch_failed: z.boolean().optional(),
}).passthrough();

export const mustReadSchema = z.object({
  title: z.string().min(1),
  url: z.string().url(),
  reason: z.string().min(1),
  bookmark_count: z.number().int().nonnegative().nullable().optional(),
}).passthrough();

export const styleSummarySchema = z.object({
  lead: z.string().min(1),
  highlights: z.array(z.object({
    theme: z.string().min(1),
    text: z.string().min(1),
  }).passthrough()),
  must_read: mustReadSchema,
}).passthrough();

export const topicSchema = z.object({
  theme: z.string().min(1),
  category: z.enum(["interested", "must_know"]),
  trend_score: z.number(),
  trend_history: z.array(z.number()),
  summary_short: z.string().min(1),
  summary_long: z.string().min(1),
  articles: z.array(articleSchema),
  related: z.array(z.string().url()).default([]),
}).passthrough();

export const dailyReportSchema = z.object({
  date: z.string().regex(datePattern),
  generated_at: z.string().min(1),
  top_summary: z.record(z.string(), styleSummarySchema),
  topics: z.array(topicSchema).min(1),
  chart_data: z.record(z.string(), z.unknown()).optional(),
  archived: z.boolean().optional(),
}).passthrough();

export const publicIndexSchema = z.object({
  last_updated: z.string(),
  reports: z.array(z.object({
    date: z.string().regex(datePattern),
    headline: z.string(),
  }).passthrough()),
  all_sources: z.array(z.object({
    name: z.string(),
    url: z.string(),
    count: z.number(),
  }).passthrough()).default([]),
}).passthrough();

export type DailyReport = z.infer<typeof dailyReportSchema>;
export type PublicIndex = z.infer<typeof publicIndexSchema>;
