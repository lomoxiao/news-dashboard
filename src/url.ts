import { createHash } from "node:crypto";

const trackingParameters = new Set([
  "fbclid", "gclid", "mc_cid", "mc_eid", "ref", "ref_src",
]);

export function canonicalizeUrl(input: string): string {
  const url = new URL(input);
  url.hash = "";
  url.hostname = url.hostname.toLowerCase();
  if ((url.protocol === "https:" && url.port === "443") ||
      (url.protocol === "http:" && url.port === "80")) url.port = "";

  for (const key of [...url.searchParams.keys()]) {
    if (key.toLowerCase().startsWith("utm_") || trackingParameters.has(key.toLowerCase())) {
      url.searchParams.delete(key);
    }
  }

  const sorted = [...url.searchParams.entries()].sort(([ak, av], [bk, bv]) =>
    ak.localeCompare(bk) || av.localeCompare(bv));
  url.search = "";
  for (const [key, value] of sorted) url.searchParams.append(key, value);
  if (url.pathname.length > 1) url.pathname = url.pathname.replace(/\/+$/, "");
  return url.toString();
}

export function articleIdForUrl(input: string): string {
  return createHash("sha256").update(canonicalizeUrl(input)).digest("hex");
}
