# Codex migration runbook

## Architecture

Codex creates a draft. TypeScript validates it and writes canonical Firestore
data plus a public projection. GitHub Pages reads the public projection through
the Firebase Web SDK. Existing static JSON remains a frozen fallback.

Public client reads are limited to:

- `publicReports/{YYYY-MM-DD}`
- `publicDashboard/index`
- `publicDashboard/metrics`

Canonical collections, run metadata, and all client writes remain private.

## Local prerequisites

- Firebase remains on the Spark plan without billing.
- `GOOGLE_APPLICATION_CREDENTIALS` points outside the repository and uses `roles/datastore.user`.
- `FIREBASE_PROJECT_ID` is `news-dashboard-registry`.
- Production must not define `FIRESTORE_EMULATOR_HOST`.

## Public projection backfill

```powershell
npm ci
npm run typecheck
npm test
npm run validate:existing
npm run publish:backfill:dry
npm run publish:backfill
npm run verify:public
```

The backfill is idempotent and does not delete legacy JSON or canonical documents.

## Rules and website rollout

```powershell
npm run test:rules
firebase deploy --only "firestore:rules,firestore:indexes" --project "news-dashboard-registry"
```

Publish GitHub Pages only after production backfill and verification succeed.
The browser falls back to frozen JSON when Firestore cannot be reached.

## Scheduled task

Normal publication is `draft -> validate -> ingest -> verify:public -> mark-run published`.
It does not run `npm run export` or commit daily JSON. Export remains manual only.

## Cutover gate

- Codex task completes for seven consecutive days.
- Duplicate URLs are zero and canonical/public projections match.
- Retrying the same date is idempotent.
- Credentials, Spark quota, all dashboard views, and forced fallback remain healthy.

## Rollback

Pause Codex, reactivate Claude, and revert the website data-adapter change to
serve frozen JSON. Do not delete Firestore data while investigating.
