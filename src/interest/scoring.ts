import { articleIdForUrl } from "../url.js";
import type {
  ExposureItem,
  InterestAggregate,
  KeywordStat,
  OutOfConfigItem,
  ScoringInput,
  SourceStat,
  TelemetryEvent,
  ThemeStat,
  ViewerArticle,
} from "./types.js";

const DAY_MS = 86400000;

export function decayFactor(eventTime: number, now: number, halfLifeDays: number): number {
  const ageDays = Math.max(0, (now - eventTime) / DAY_MS);
  return 2 ** (-ageDays / halfLifeDays);
}

function toMillis(value: string | number | null): number | null {
  if (value === null) return null;
  const ms = typeof value === "number" ? value : Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

export function resolveEventArticleId(event: TelemetryEvent): string | null {
  if (event.articleId) return event.articleId;
  if (event.url) {
    try {
      return articleIdForUrl(event.url);
    } catch {
      return null;
    }
  }
  return null;
}

interface ArticleSignals {
  seen: boolean;
  expanded: boolean;
  sourceClicked: boolean;
  promoted: boolean;
  read: boolean;
  promotions: number;
  engagement: number;
  promotionEngagement: number;
}

function emptySignals(): ArticleSignals {
  return {
    seen: false, expanded: false, sourceClicked: false, promoted: false, read: false,
    promotions: 0, engagement: 0, promotionEngagement: 0,
  };
}

export interface ViewerJoinResult {
  matched: Map<string, ViewerArticle>;
  outOfConfig: OutOfConfigItem[];
}

export function joinViewerArticles(
  viewerArticles: ViewerArticle[],
  exposureIds: Set<string>,
  sinceMs: number,
): ViewerJoinResult {
  const matched = new Map<string, ViewerArticle>();
  const outOfConfig: OutOfConfigItem[] = [];
  for (const article of viewerArticles) {
    let dashboardId: string | null = null;
    try {
      dashboardId = articleIdForUrl(article.canonicalUrl);
    } catch {
      dashboardId = null;
    }
    if (dashboardId && exposureIds.has(dashboardId)) {
      matched.set(dashboardId, article);
      continue;
    }
    const promotedMs = toMillis(article.promotedAt);
    if (promotedMs !== null && promotedMs >= sinceMs) {
      outOfConfig.push({
        viewerId: article.viewerId,
        canonicalUrl: article.canonicalUrl,
        title: article.title,
        promotedAt: article.promotedAt,
        readState: article.readState,
        hasGeneration: article.hasGeneration,
      });
    }
  }
  return { matched, outOfConfig };
}

export function score(input: ScoringInput): InterestAggregate {
  const { config, themes, exposures, events, viewerArticles } = input;
  const nowMs = Date.parse(input.now);
  const sinceMs = nowMs - config.window_days * DAY_MS;
  const since = new Date(sinceMs).toISOString().slice(0, 10);
  const until = input.now.slice(0, 10);

  const windowExposures = exposures.filter((item) => {
    const ms = toMillis(item.date);
    return ms !== null && ms >= sinceMs;
  });
  const exposureById = new Map<string, ExposureItem>();
  for (const item of windowExposures) {
    if (!exposureById.has(item.articleId)) exposureById.set(item.articleId, item);
  }

  const signals = new Map<string, ArticleSignals>();
  const signalsFor = (articleId: string): ArticleSignals => {
    let entry = signals.get(articleId);
    if (!entry) {
      entry = emptySignals();
      signals.set(articleId, entry);
    }
    return entry;
  };

  // Dashboard telemetry → per-article engagement.
  const eventCounts: Record<string, number> = {};
  for (const event of events) {
    if (event.ts < sinceMs) continue;
    const articleId = resolveEventArticleId(event);
    if (!articleId || !exposureById.has(articleId)) continue;
    eventCounts[event.action] = (eventCounts[event.action] ?? 0) + 1;
    const entry = signalsFor(articleId);
    const decay = decayFactor(event.ts, nowMs, config.half_life_days);
    if (event.action === "impression") {
      entry.seen = true;
    } else if (event.action === "expand") {
      if (!entry.expanded) entry.engagement += config.weights.expand * decay;
      entry.expanded = true;
      entry.seen = true;
    } else if (event.action === "source_click") {
      if (!entry.sourceClicked) entry.engagement += config.weights.source_click * decay;
      entry.sourceClicked = true;
      entry.seen = true;
    }
  }

  // Viewer signals → promotion / generation / read state.
  const { matched, outOfConfig } = joinViewerArticles(viewerArticles, new Set(exposureById.keys()), sinceMs);
  for (const [articleId, viewer] of matched) {
    const entry = signalsFor(articleId);
    const promotedMs = toMillis(viewer.promotedAt) ?? nowMs;
    const promotionDecay = decayFactor(promotedMs, nowMs, config.half_life_days);
    entry.promoted = true;
    entry.promotions += 1;
    entry.engagement += config.weights.promotion * promotionDecay;
    entry.promotionEngagement += config.weights.promotion * promotionDecay;
    if (viewer.hasGeneration) entry.engagement += config.weights.generation * promotionDecay;

    const readMs = toMillis(viewer.readStateUpdatedAt) ?? promotedMs;
    const readDecay = decayFactor(readMs, nowMs, config.half_life_days);
    if (viewer.readState === "read") {
      entry.read = true;
      entry.engagement += config.weights.read * readDecay;
    } else if (viewer.readState === "later") {
      entry.engagement += config.weights.later * readDecay;
    } else if (nowMs - promotedMs >= config.stale_after_days * DAY_MS) {
      entry.engagement += config.weights.stale_promotion * promotionDecay;
    }
  }

  // Theme / source aggregation.
  const themeStats = new Map<string, ThemeStat>();
  const sourceStats = new Map<string, SourceStat>();
  for (const item of windowExposures) {
    const entry = signals.get(item.articleId);
    let theme = themeStats.get(item.themeName);
    if (!theme) {
      theme = { theme: item.themeName, category: item.category, collected: 0, seen: 0, expanded: 0, sourceClicked: 0, promoted: 0, read: 0, engagement: 0 };
      themeStats.set(item.themeName, theme);
    }
    theme.collected += 1;
    let source = sourceStats.get(item.sourceName);
    if (!source) {
      source = { source: item.sourceName, collected: 0, seen: 0, engagement: 0, promoted: 0 };
      sourceStats.set(item.sourceName, source);
    }
    source.collected += 1;
    if (entry) {
      if (entry.seen) { theme.seen += 1; source.seen += 1; }
      if (entry.expanded) theme.expanded += 1;
      if (entry.sourceClicked) theme.sourceClicked += 1;
      if (entry.promoted) { theme.promoted += 1; source.promoted += 1; }
      if (entry.read) theme.read += 1;
      theme.engagement += entry.engagement;
      source.engagement += entry.engagement;
    }
  }

  // Keyword lift (interested themes only; post-hoc substring attribution).
  const uniqueExposures = [...exposureById.values()];
  const totalEngagement = [...signals.values()].reduce((sum, entry) => sum + entry.engagement, 0);
  const totalExposure = uniqueExposures.length;
  const globalDensity = totalExposure > 0 ? totalEngagement / totalExposure : 0;
  const keywords: KeywordStat[] = [];
  for (const theme of themes) {
    if (theme.category !== "interested") continue;
    for (const keyword of theme.keywords) {
      const needle = keyword.toLowerCase();
      const matchedExposures = uniqueExposures.filter((item) =>
        (item.title + " " + item.summaryShort).toLowerCase().includes(needle));
      let engagement = 0;
      let promotionEngagement = 0;
      let promotions = 0;
      let seen = 0;
      for (const item of matchedExposures) {
        const entry = signals.get(item.articleId);
        if (!entry) continue;
        if (entry.seen) seen += 1;
        promotions += entry.promotions;
        promotionEngagement += entry.promotionEngagement;
        engagement += entry.engagement;
      }
      if (promotions >= 2) engagement += promotionEngagement * (config.repromotion_multiplier - 1);
      const exposureCount = matchedExposures.length;
      const smoothing = config.smoothing_exposures;
      const density = globalDensity > 0
        ? (engagement + smoothing * globalDensity) / (exposureCount + smoothing)
        : 0;
      const lift = globalDensity > 0 ? density / globalDensity : 0;
      let verdict: KeywordStat["verdict"] = "neutral";
      if (exposureCount < config.min_exposure) verdict = "low-data";
      else if (lift >= config.lift_boost_threshold) verdict = "boost-candidate";
      else if (lift <= config.lift_decay_threshold) verdict = "decay-candidate";
      keywords.push({
        theme: theme.name,
        keyword,
        exposures: exposureCount,
        seen,
        promotions,
        engagement: round3(engagement),
        lift: round3(lift),
        verdict,
      });
    }
  }
  keywords.sort((a, b) => b.lift - a.lift);

  const funnel = {
    collected: totalExposure,
    seen: count(signals, (s) => s.seen),
    expanded: count(signals, (s) => s.expanded),
    sourceClicked: count(signals, (s) => s.sourceClicked),
    promoted: count(signals, (s) => s.promoted),
    read: count(signals, (s) => s.read),
  };

  return {
    version: 1,
    generatedAt: input.now,
    windowDays: config.window_days,
    since,
    until,
    funnel,
    eventCounts,
    themes: [...themeStats.values()].map(roundTheme).sort((a, b) => b.engagement - a.engagement),
    sources: [...sourceStats.values()].map(roundSource).sort((a, b) => b.engagement - a.engagement),
    keywords,
    outOfConfig,
  };
}

function count(signals: Map<string, ArticleSignals>, predicate: (entry: ArticleSignals) => boolean): number {
  let total = 0;
  for (const entry of signals.values()) if (predicate(entry)) total += 1;
  return total;
}

function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function roundTheme(stat: ThemeStat): ThemeStat {
  return { ...stat, engagement: round3(stat.engagement) };
}

function roundSource(stat: SourceStat): SourceStat {
  return { ...stat, engagement: round3(stat.engagement) };
}
