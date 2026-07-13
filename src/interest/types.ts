export interface InterestConfig {
  window_days: number;
  half_life_days: number;
  weights: {
    expand: number;
    source_click: number;
    promotion: number;
    generation: number;
    read: number;
    later: number;
    stale_promotion: number;
  };
  stale_after_days: number;
  repromotion_multiplier: number;
  smoothing_exposures: number;
  min_exposure: number;
  lift_boost_threshold: number;
  lift_decay_threshold: number;
}

export interface ThemeConfig {
  name: string;
  category: "interested" | "must_know";
  keywords: string[];
}

export interface ExposureItem {
  articleId: string;
  canonicalUrl: string;
  date: string;
  themeName: string;
  category: string;
  sourceName: string;
  title: string;
  summaryShort: string;
  importance: number;
}

export interface TelemetryEvent {
  action: "impression" | "expand" | "source_click";
  ts: number;
  date: string;
  articleId?: string;
  url?: string;
}

export interface ViewerArticle {
  viewerId: string;
  canonicalUrl: string;
  title: string;
  promotedAt: string | null;
  hasGeneration: boolean;
  readState: "read" | "later" | null;
  readStateUpdatedAt: string | null;
}

export interface ScoringInput {
  now: string;
  config: InterestConfig;
  themes: ThemeConfig[];
  exposures: ExposureItem[];
  events: TelemetryEvent[];
  viewerArticles: ViewerArticle[];
}

export interface KeywordStat {
  theme: string;
  keyword: string;
  exposures: number;
  seen: number;
  promotions: number;
  engagement: number;
  lift: number;
  verdict: "boost-candidate" | "decay-candidate" | "neutral" | "low-data";
}

export interface ThemeStat {
  theme: string;
  category: string;
  collected: number;
  seen: number;
  expanded: number;
  sourceClicked: number;
  promoted: number;
  read: number;
  engagement: number;
}

export interface SourceStat {
  source: string;
  collected: number;
  seen: number;
  engagement: number;
  promoted: number;
}

export interface OutOfConfigItem {
  viewerId: string;
  canonicalUrl: string;
  title: string;
  promotedAt: string | null;
  readState: "read" | "later" | null;
  hasGeneration: boolean;
}

export interface InterestAggregate {
  version: 1;
  generatedAt: string;
  windowDays: number;
  since: string;
  until: string;
  funnel: {
    collected: number;
    seen: number;
    expanded: number;
    sourceClicked: number;
    promoted: number;
    read: number;
  };
  eventCounts: Record<string, number>;
  themes: ThemeStat[];
  sources: SourceStat[];
  keywords: KeywordStat[];
  outOfConfig: OutOfConfigItem[];
}
