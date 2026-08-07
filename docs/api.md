# API Reference

All routes live under `src/app/api/`. Every authenticated route calls NextAuth's
`auth()` and scopes queries to the session user; unauthenticated requests return
`401`. Page routes are locale-prefixed (`/[locale]/…`); API routes are **not**.

## Auth

| Route | Methods | Description |
|-------|---------|-------------|
| `/api/auth/[...nextauth]` | (NextAuth handler) | Sign in/out, session, JWT |
| `/api/auth/signup` | POST | Register (name, email, password → bcrypt) |
| `/api/auth/reset-password` | POST | Request/reset password via email |
| `/api/auth/email-status` | GET | Check whether an email is registered |

## Goals

| Route | Methods | Description |
|-------|---------|-------------|
| `/api/goals` | GET, POST | List / create race goals |
| `/api/goals/[id]` | GET, PUT, DELETE | Get / update / delete a goal |
| `/api/goals/[id]/course` | POST | Save course profile for a goal |

## Body Metrics & Daily Health

| Route | Methods | Description |
|-------|---------|-------------|
| `/api/body-metrics` | GET, POST | List / record weight, height, resting HR |
| `/api/body-metrics/[id]` | DELETE | Delete a metric |
| `/api/daily-health` | GET | Daily health snapshot (`?days=N`) from Garmin/COROS |

## Activities

| Route | Methods | Description |
|-------|---------|-------------|
| `/api/activities` | GET | List (query: type, from, to, limit, …) |
| `/api/activities/[id]` | GET, PUT, DELETE | Get / update (remarks, isRace, …) / delete |
| `/api/activities/[id]/gpx` | GET | Download original GPX |
| `/api/activities/[id]/similar` | GET | Similar activities (dedup hints) |
| `/api/activities/[id]/promote-to-goal` | POST | Promote an activity to a race goal |
| `/api/activities/filter-options` | GET | Filter dropdown options |
| `/api/activities/monthly-stats` | GET | Monthly volume/elevation/duration stats |

## Duplicates

| Route | Methods | Description |
|-------|---------|-------------|
| `/api/duplicates/detect` | POST | Run duplicate detection |
| `/api/duplicates/list` | GET | List duplicate groups |
| `/api/duplicates/resolve` | POST | Resolve (merge / keep both) |
| `/api/duplicates/resnapshot` | POST | Recompute snapshots for a group |

## Data Ingestion

| Route | Methods | Description |
|-------|---------|-------------|
| `/api/ingestion/csv` | POST | Multipart Strava `activities.csv` import |
| `/api/ingestion/gpx` | POST | Multipart `.gpx/.tcx/.fit` import |
| `/api/ingestion/manual` | POST | JSON manual activity entry |
| `/api/ingestion/strava-export` | POST | Strava export archive import |

## Integrations

Garmin and COROS share one dynamic route (see `src/lib/integration-routes.ts`):

`/api/integrations/[provider]/[action]` — provider: `garmin` | `coros`

| Action | Methods | Description |
|--------|---------|-------------|
| `connect` | POST | Connect with email/password (+ Garmin MFA code) |
| `status` | GET | Connection status + last sync + activity count |
| `sync` | POST | Trigger activity (+ Garmin health) sync |
| `reset-sync` | POST | Reset the sync cursor |
| `disconnect` | DELETE | Disconnect and clear session |

## Dashboard

| Route | Methods | Description |
|-------|---------|-------------|
| `/api/dashboard/load` | GET | **Main batched snapshot** — PMC, readiness, fatigue, aggregates, goal progress in one call |
| `/api/dashboard/coach` | POST | AI coach chat endpoint |
| `/api/dashboard/plan` | GET | Current / week-offset plan |
| `/api/dashboard/plan/adjust` | POST | Apply a plan adjustment |
| `/api/dashboard/preferences` | GET, PUT | Dashboard display preferences |
| `/api/dashboard/pmc-history` | GET | CTL/ATL/TSB series (`?days=N`) |
| `/api/dashboard/trends` | GET | Volume trends (`?weeks=N&grouping=…`) |
| `/api/dashboard/intensity-distribution` | GET | Training intensity distribution (`?days=N`) |
| `/api/dashboard/trackpoint-insights` | GET | Trackpoint-derived insights |

## Training Plan

| Route | Methods | Description |
|-------|---------|-------------|
| `/api/training-plan` | GET, DELETE | Get current plan / clear a week |

## Push API

| Route | Methods | Description |
|-------|---------|-------------|
| `/api/push/activity` | POST | Push GPX/TCX/FIT from a watch or script (API-key auth) — see [push-api.md](push-api.md) |

## Admin (role: `admin`)

| Route | Methods | Description |
|-------|---------|-------------|
| `/api/admin/users` | GET, PUT | List / edit users (role, reset) |
| `/api/admin/reset-link` | POST | Generate a password-reset link for a user |
| `/api/admin/email-settings` | GET, PUT, POST | SMTP/email configuration |
| `/api/admin/prompts` | GET, PUT | Edit LLM coach prompts |

## Settings

| Route | Methods | Description |
|-------|---------|-------------|
| `/api/settings/analysis` | GET, PUT | Analysis trigger config |
| `/api/settings/api-keys` | GET, POST, DELETE | Manage `coach_*` API keys (push API) |
| `/api/settings/llm` | GET, PUT | Per-user LLM provider/model/key |
| `/api/settings/locale` | PUT | Change user locale |
| `/api/settings/onboarding` | GET, PUT | Onboarding state |
| `/api/settings/training-context` | GET, PUT | Free-text training context |
| `/api/settings/change-password` | POST | Change password |
| `/api/settings/backup` | GET, POST | Create / list backups |
| `/api/settings/backup/download` | GET | Download a backup |
| `/api/settings/restore` | POST | Restore from a backup |
| `/api/settings/wipe-data` | DELETE | Wipe all user data |

## Misc

| Route | Methods | Description |
|-------|---------|-------------|
| `/api/llm-test` | GET, POST | Test LLM connectivity |

## Conventions

- Auth is required everywhere except `/api/auth/*` and `/api/push/activity`
  (which requires a `Bearer` API key instead).
- All inputs validated with Zod.
- Errors are returned as JSON with an appropriate status code.
