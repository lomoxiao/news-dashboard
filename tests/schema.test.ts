import assert from "node:assert/strict";
import test from "node:test";
import path from "node:path";
import { readDailyReport, repositoryRoot } from "../src/files.js";
import { validateReportSemantics } from "../src/validation.js";

test("an existing daily report satisfies the migration contract", async () => {
  const report = await readDailyReport(path.join(repositoryRoot, "docs", "data", "daily", "2026-07-06.json"));
  const result = validateReportSemantics(report);
  assert.equal(result.date, "2026-07-06");
  assert.ok(result.articles > 0);
});
test("unsupported top summary styles are rejected", async () => {
  const report = await readDailyReport(path.join(repositoryRoot, "docs", "data", "daily", "2026-07-06.json"));
  const journalist = report.top_summary.journalist;
  assert.ok(journalist);
  report.top_summary = { balanced: journalist };
  assert.throws(
    () => validateReportSemantics(report),
    /Invalid top_summary styles.*missing=journalist,friendly,brief,analytical.*unexpected=balanced/,
  );
});
