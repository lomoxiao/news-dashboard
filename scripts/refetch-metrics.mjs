// Repairs a macro-metrics draft (.runtime/metrics/*.json) in place, following prompts/metrics_collect.md:
//   1. Market closes (nikkei, usdjpy) are re-fetched from the Yahoo Finance chart API and assigned
//      to dates in the exchange's local time zone (meta.exchangeTimezoneName). Converting the UTC
//      timestamps to UTC dates shifts USD/JPY one day early (London-midnight bars).
//   2. arXiv counts that failed with HTTP 429 are re-fetched from the arXiv API (totalResults),
//      3+ seconds apart, waiting 30s/60s/90s on 429 before giving up (null + null_reason).
// Progress is saved after every arXiv day, so the script can be re-run after an interruption.
// A backup of the original is written once to <file>.before-refetch.
//
// Usage: node scripts/refetch-metrics.mjs .runtime/metrics/<file>.json [--markets-only|--arxiv-only]
// Then:  npm run metrics:validate -- .runtime/metrics/<file>.json
import { copyFile, readFile, rename, writeFile, access } from "node:fs/promises";
import { pathToFileURL } from "node:url";

const UA = { "User-Agent": "Mozilla/5.0 (news-dashboard metrics backfill)" };
const ARXIV_GAP_MS = 3500;
const RETRY_WAITS_MS = [30000, 60000, 90000];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const MARKETS = {
  nikkei: { symbol: "^N225", label: "Nikkei 225" },
  usdjpy: { symbol: "JPY=X", label: "USD/JPY" },
};

export function weekdayName(date) {
  return ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][new Date(date + "T00:00:00Z").getUTCDay()];
}

/** Local calendar date (YYYY-MM-DD) of a UTC epoch-second timestamp in an IANA time zone. */
export function localDate(epochSeconds, timeZone) {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" })
    .format(new Date(epochSeconds * 1000));
}

/** Maps a Yahoo chart API response to { date -> close } using the exchange's local time zone. */
export function closesByLocalDate(chartJson) {
  const result = chartJson?.chart?.result?.[0];
  if (!result) throw new Error("unexpected chart response: " + JSON.stringify(chartJson?.chart?.error ?? chartJson).slice(0, 200));
  const timeZone = result.meta?.exchangeTimezoneName;
  if (!timeZone) throw new Error("chart response has no meta.exchangeTimezoneName");
  const closes = result.indicators?.quote?.[0]?.close ?? [];
  const map = new Map();
  (result.timestamp ?? []).forEach((ts, i) => {
    const close = closes[i];
    if (typeof close === "number" && Number.isFinite(close)) map.set(localDate(ts, timeZone), Math.round(close * 100) / 100);
  });
  return { timeZone, map };
}

async function fetchWithRetry(url, label) {
  for (let attempt = 0; ; attempt++) {
    const response = await fetch(url, { headers: UA });
    if (response.status !== 429 || attempt >= RETRY_WAITS_MS.length) return response;
    console.log(`  ${label}: HTTP 429, waiting ${RETRY_WAITS_MS[attempt] / 1000}s`);
    await sleep(RETRY_WAITS_MS[attempt]);
  }
}

async function saveDraft(file, draft) {
  const tmp = file + ".tmp";
  await writeFile(tmp, JSON.stringify(draft, null, 2) + "\n", "utf8");
  await rename(tmp, file);
}

async function refetchMarkets(draft) {
  const dates = draft.days.map((d) => d.date).sort();
  const period1 = Math.floor(Date.parse(dates[0] + "T00:00:00Z") / 1000) - 5 * 86400;
  const period2 = Math.floor(Date.parse(dates[dates.length - 1] + "T00:00:00Z") / 1000) + 5 * 86400;
  for (const [key, { symbol, label }] of Object.entries(MARKETS)) {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&period1=${period1}&period2=${period2}`;
    const response = await fetchWithRetry(url, label);
    if (!response.ok) throw new Error(`${label}: HTTP ${response.status} — markets left unchanged`);
    const { timeZone, map } = closesByLocalDate(await response.json());
    let values = 0;
    for (const day of draft.days) {
      const weekday = weekdayName(day.date);
      const close = map.get(day.date);
      if (weekday === "Saturday" || weekday === "Sunday") {
        day.values[key] = { value: null, null_reason: `market closed (${weekday})` };
      } else if (close !== undefined) {
        day.values[key] = { value: close, source_url: url };
        values++;
      } else {
        day.values[key] = { value: null, null_reason: `no daily close in ${label} chart (market holiday or no data)` };
      }
    }
    console.log(`${label}: ${values} closes assigned by ${timeZone} local date`);
  }
}

export function arxivUrl(category, date) {
  const d = date.replaceAll("-", "");
  return `https://export.arxiv.org/api/query?search_query=cat:${category}+AND+submittedDate:[${d}0000+TO+${d}2359]&max_results=0`;
}

async function refetchArxiv(draft, file) {
  const targets = [];
  for (const day of draft.days) {
    for (const [key, category] of [["arxiv_ai", "cs.AI"], ["arxiv_quantum", "quant-ph"]]) {
      const point = day.values[key];
      if (point.value === null && /429/.test(point.null_reason ?? "")) targets.push({ day, key, category });
    }
  }
  console.log(`arXiv: ${targets.length} values to re-fetch (about ${Math.ceil(targets.length * ARXIV_GAP_MS / 60000)}+ minutes)`);
  let fixed = 0;
  for (const [index, { day, key, category }] of targets.entries()) {
    const url = arxivUrl(category, day.date);
    try {
      const response = await fetchWithRetry(url, `${day.date} ${category}`);
      if (!response.ok) {
        day.values[key] = { value: null, null_reason: `fetch failed: HTTP ${response.status}` };
      } else {
        const match = (await response.text()).match(/<opensearch:totalResults[^>]*>(\d+)</);
        const total = match ? Number(match[1]) : NaN;
        if (Number.isFinite(total) && total > 0) {
          day.values[key] = { value: total, source_url: url };
          fixed++;
        } else {
          day.values[key] = { value: null, null_reason: match ? "arXiv API totalResults was 0" : "totalResults not found in arXiv API response" };
        }
      }
    } catch (error) {
      day.values[key] = { value: null, null_reason: `fetch failed: ${error instanceof Error ? error.message : String(error)}` };
    }
    await saveDraft(file, draft);
    console.log(`  [${index + 1}/${targets.length}] ${day.date} ${category}: ${day.values[key].value ?? day.values[key].null_reason}`);
    await sleep(ARXIV_GAP_MS);
  }
  console.log(`arXiv: ${fixed}/${targets.length} recovered`);
}

async function main() {
  const [file, mode] = process.argv.slice(2);
  if (!file) throw new Error("Usage: node scripts/refetch-metrics.mjs <draft.json> [--markets-only|--arxiv-only]");
  const backup = file + ".before-refetch";
  try { await access(backup); } catch { await copyFile(file, backup); console.log("backup: " + backup); }
  const draft = JSON.parse(await readFile(file, "utf8"));
  if (mode !== "--arxiv-only") {
    await refetchMarkets(draft);
    await saveDraft(file, draft);
  }
  if (mode !== "--markets-only") await refetchArxiv(draft, file);
  draft.collected_at = new Date().toISOString();
  await saveDraft(file, draft);
  console.log("done. next: npm run metrics:validate -- " + file);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((error) => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
}
