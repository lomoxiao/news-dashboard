import assert from "node:assert/strict";
import test from "node:test";
import { articleIdForUrl, canonicalizeUrl } from "../src/url.js";

test("canonicalizeUrl removes tracking data and sorts query parameters", () => {
  assert.equal(
    canonicalizeUrl("HTTPS://Example.COM:443/news/?utm_source=x&b=2&a=1#top"),
    "https://example.com/news?a=1&b=2",
  );
});

test("article IDs are stable across tracking variants", () => {
  assert.equal(
    articleIdForUrl("https://example.com/story?utm_medium=social"),
    articleIdForUrl("https://EXAMPLE.com/story"),
  );
});
