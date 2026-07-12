# News Dashboard Agent Guide

## Purpose

Collect public news, validate it, store canonical and public projections in
Cloud Firestore, and serve the dashboard directly from Firestore on GitHub Pages.

## Responsibilities

- Codex researches, classifies, scores, and summarizes candidate articles.
- TypeScript validates output, canonicalizes URLs, removes duplicates, and
  atomically writes canonical and public Firestore documents.
- Never let a prompt directly mutate Firestore or publish unvalidated output.

## Required workflow

1. Work from the repository root; never depend on an absolute path.
2. Generate a draft report under `.runtime/`.
3. Run `npm run validate -- <draft-file>`.
4. Run `npm run ingest -- <draft-file>` only after validation succeeds.
5. Run `npm run verify:public` and all verification commands.
6. Mark the run published only after the public projection is verified.
7. Commit or push only when application code or configuration changed; daily
   data publication does not require Git.

## Verification

```powershell
npm run typecheck
npm test
npm run validate:existing
npm run migrate:dry
npm run verify:public
```

## Safety

- Keep Firebase credentials outside this repository.
- Use `GOOGLE_APPLICATION_CREDENTIALS` with a least-privilege service account.
- Public clients may read only `publicReports` and approved `publicDashboard` documents.
- All client writes and internal collection reads stay denied.
- Do not enable Firebase billing, Cloud Storage, Cloud Functions, or Cloud Run.
- Do not delete legacy JSON; it is the frozen fallback and rollback source.
- Do not stop Claude until seven comparison runs satisfy `docs/CODEX_MIGRATION.md`.
- A failed supplemental task must not invalidate a successful daily report.

## Public data contract

`docs/index.html` reads Firestore public projections first. Files below
`docs/data/` are frozen fallback data and are not updated by the daily job.
