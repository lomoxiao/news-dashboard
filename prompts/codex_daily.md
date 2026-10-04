# News Dashboard Codex Daily Job

Work from the repository root. Follow `AGENTS.md` and do not publish partial results.

1. Read `docs/config.json` and the existing prompt rules.
2. Collect today's candidates from every configured source with provenance.
3. Classify, score, summarize, and produce the complete daily-report contract.
   - Use the theme names in `docs/config.json` exactly; any other name fails validation.
   - For every topic, set `candidate_count`: the number of distinct candidate articles that
     matched the theme during collection, **before** importance filtering, deduplication
     against earlier days, and the per-theme cap. Count the same way every day.
   - Do not compute `trend_score` / `trend_history`; omit them or leave `0` / `[]`.
     TypeScript computes them at ingest.
4. Save the draft only to `.runtime/daily/YYYY-MM-DD.json`.
5. Run `npm run validate -- .runtime/daily/YYYY-MM-DD.json`.
6. Repair validation failures, stopping after three failed attempts without publishing.
7. Run `npm run ingest -- .runtime/daily/YYYY-MM-DD.json`.
8. Run `npm run verify:public`.
9. Run `npm run typecheck`, `npm test`, and `npm run validate:existing`.
10. Review `git diff --check`; daily publication must not modify `docs/data/`.
11. Run `npm run mark-run -- daily-YYYY-MM-DD published` after verification.
12. Commit and push only when application code or configuration changed.
13. Then run the macro-metrics job in `prompts/metrics_collect.md`
    (draft -> `metrics:validate` -> `metrics:ingest` -> `verify:public` -> mark-run).
    A metrics failure must not roll back the daily report.

On Monday, run weekly aggregation after the daily report. On the first day of
a month, run monthly aggregation after daily and weekly work. After validated
supplemental JSON changes, run `npm run sync:supplemental` and
`npm run verify:public`. (`sync:supplemental` never touches the metrics master.) Supplemental failures must not roll back daily publication.
