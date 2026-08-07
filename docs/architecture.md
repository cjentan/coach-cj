# Architecture

## Overview

Coach is a self-hosted, multi-tenant endurance sports coaching platform. Training
data arrives from Garmin/COROS watches, device files (GPX/TCX/FIT), a Strava CSV
export, manual entry, or a watch-push API. The platform computes performance
metrics (CTL/ATL/TSB), detects fatigue, builds weekly plans, and drives an AI
coaching chat.

## Services (Docker Compose)

```
┌───────────────────────────────────────────────────────────────┐
│                     Docker Host                                │
│                                                               │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────────┐   │
│  │ coach-app │  │coach-    │  │ coach-db │  │ coach-redis  │   │
│  │  :3000    │  │ worker   │  │  :5433→  │  │  :6380→      │   │
│  │  Next.js  │  │  BullMQ  │  │  PG 16   │  │  Redis 7     │   │
│  └─────┬─────┘  └────┬─────┘  └────┬─────┘  └──────┬───────┘   │
│        │              │             │               │          │
│  ┌─────┴──────────────┴─────────────┴───────────────┴────────┐  │
│  │                coach-tailscale  (reverse proxy)            │  │
│  └───────────────────────────────────────────────────────────┘  │
└───────────────────────────────────────────────────────────────┘
```

| Container | Role |
|-----------|------|
| `coach-app` | Next.js 14 server (SSR, API routes, pages), port 3000 |
| `coach-worker` | BullMQ workers + in-process scheduler (same image, `worker-runner` target) |
| `coach-db` | PostgreSQL 16 Alpine — persistent storage (host port 5433) |
| `coach-redis` | Redis 7 Alpine — BullMQ backing store (host port 6380) |
| `coach-tailscale` | Tailscale reverse proxy exposing `https://coach.oryx-everest.ts.net` |

LLM inference is **not** containerized: the app calls cloud providers (DeepSeek by
default) or a user-configured endpoint. See [LLM integration](#llm-integration).

## Technology Stack

| Layer | Choice | Notes |
|-------|--------|-------|
| Framework | Next.js 14 App Router | React Server Components + API routes in one project |
| Language | TypeScript | Strict mode, full-stack type safety |
| Database | PostgreSQL 16 | Via Prisma ORM |
| ORM | Prisma 5 | Schema-first, auto-generated types, migrations |
| Auth | NextAuth.js v5 | JWT sessions, credentials provider |
| i18n | next-intl | Locales: `en`, `zh-CN`, `zh-TW`, routed under `[locale]` |
| Styling | TailwindCSS + shadcn/ui | Utility-first CSS + Radix-based accessible components |
| Charts | Recharts | Training data visualizations |
| Job Queue | BullMQ + Redis | Garmin/COROS sync, fatigue monitor, Sunday review, activity analysis |
| LLM | OpenAI-compatible API | Providers: `deepseek` (default), `openai`, `anthropic`, `ollama` |
| Maps | Leaflet | Route map on activity detail |
| Container | Docker Compose | 5 services |

## Key Design Decisions

- **Why Next.js?** Single project for both frontend and API — no CORS, shared
  TypeScript, server components for auth-protected data fetching.
- **Why PostgreSQL over SQLite?** Multi-user from day one. Row-level ownership
  (`userId` on every table) ensures isolation.
- **Why BullMQ over cron?** Syncs, fatigue checks, and Sunday reviews are
  job-queue work: retry semantics, concurrency control, and a dashboard come free.
- **Why cloud LLMs by default?** The default provider is DeepSeek (`deepseek-v4-flash`)
  for cost/quality. A local Ollama instance can be pointed at via `llmBaseUrl`
  per-user, keeping training data on-machine when desired.

## Routing & Middleware

All pages live under `src/app/[locale]/`. `src/middleware.ts`:

1. Bypasses i18n for `/api/`, `/_next/`, and static files.
2. Runs next-intl middleware (locale detection + redirect to locale-prefixed URL).
3. Applies auth rules and rewrites a `REDIRECT_MAP` of removed/renamed paths
   (e.g. `/goals` → `/settings/training`).

## Auth

- NextAuth v5 with a credentials provider; passwords bcrypt-hashed.
- Signup, signin, reset password (email via Resend), and admin reset links.
- Every API route calls `auth()` and scopes all queries to `session.user.id`.
- `src/middleware.ts` redirects unauthenticated page requests to sign-in.

## LLM Integration

`src/lib/llm.ts` abstracts providers behind an OpenAI-compatible interface:

```
PROVIDER_MODELS:
  openai     gpt-4o, gpt-4o-mini, ...
  deepseek   deepseek-v4-flash        ← default
  anthropic  claude-sonnet-4, claude-3-5-sonnet-latest, ...
  ollama     llama3, mistral, mixtral, ...
```

Per-user LLM settings (`llmProvider`, `llmApiKey`, `llmBaseUrl`, `llmModel`) are
stored on the `User` model and managed in **Settings → AI Coach**. `isLlmConfigured`
returns `true` for Ollama (no key needed) and otherwise requires a non-empty key.
`getDefaultLlmConfig()` falls back to DeepSeek with `deepseek-v4-flash`.

The AI coach (`src/lib/ai-coach.ts`) uses the abstraction for chat, initial
interviews, plan proposals, and per-activity analysis. If the LLM is unavailable,
the weekly plan is still generated deterministically — see [Analytics](analytics.md).

## File Structure (top level)

```
coach/
├── docker-compose.yml        # 5 services: app, worker, db, redis, tailscale
├── Dockerfile                # Multi-stage: deps → builder → app/worker runners
├── deploy.sh                 # Build locally → deploy to remote Docker host
├── deploy-local.sh           # Run dev server against Dockerized db+redis
├── prisma/schema.prisma      # 20 models + enums
├── src/
│   ├── app/[locale]/         # Locale-prefixed pages
│   ├── app/api/              # HTTP route handlers (see api.md)
│   ├── components/           # UI + feature components (coach, training-plan, ui…)
│   ├── lib/                  # Business logic, parsers, metrics, LLM, integrations
│   ├── workers/entrypoint.ts # BullMQ workers + scheduler
│   ├── i18n/                 # next-intl routing + request config
│   ├── test/                 # Vitest unit/integration tests
│   ├── types/                # TypeScript type augmentations
│   └── middleware.ts         # i18n + auth + redirects
└── data/                     # Docker volumes (Postgres, Redis, uploads, backups)
```

## Data Ingestion Pipeline

```
                     ┌─────────────┐
                     │   Sources    │
                     └──────┬──────┘
      ┌─────────────────────┼─────────────────────┐
      ▼                     ▼                     ▼
┌────────────┐      ┌──────────────┐      ┌────────────┐
│ Garmin /   │      │ File upload  │      │   Manual   │
│ COROS sync │      │ GPX/TCX/FIT  │      │   entry    │
│ (watch)    │      │ CSV export   │      │            │
└─────┬──────┘      └──────┬───────┘      └─────┬──────┘
      │                    │                    │
      ▼                    ▼                    ▼
┌────────────────────────────────────────────────────────┐
│              TrainingLog (userId, externalId, source)   │
│              unique — upsert prevents duplicates        │
└────────────────────────────────────────────────────────┘
```

- **Garmin / COROS** — OAuth/credential sessions sync activities (and Garmin
  health data) via BullMQ workers every 4 hours. Garmin FIT data is parsed for
  session-level summaries first, falling back to record-level computation.
- **GPX / TCX / FIT upload** — GPX: `<trkpt>` elements, distance via Haversine,
  elevation from `<ele>`, HR from extensions. TCX: Garmin XML lap summaries.
  FIT: binary via `fit-file-parser`, session summaries first. `sport-mappings.ts`
  maps each format's sport codes to shared `ActivityType`/`ActivitySubType` enums.
- **Strava CSV export** — `activities.csv` from Strava's data download; uses the
  Strava activity ID for dedup (OAuth API sync was dropped when Strava restricted
  free-tier API access).
- **Watch push** — devices push GPX/TCX/FIT to `POST /api/push/activity` with an
  API key (see [push-api.md](push-api.md)).
- **Manual entry** — form entry; TSS auto-estimated from HR and duration.

TSS, normalized power, and trackpoint simplification are shared across parsers
via `training-math.ts` / `simplify-trackpoints.ts`.

## Training Data Flow (a typical week)

```
Week view:
  Mon ● Easy run        8 km    50 m D+    HR 128   TSS 45
  Tue ● Intervals       —       —          HR 155   TSS 72
  Wed ○ Rest
  Thu ● Tempo run       12 km   100 m D+   HR 148   TSS 88
  Fri ● Easy run        6 km    30 m D+    HR 125   TSS 32
  Sat ● Long trail run  25 km   1200 m D+  HR 142   TSS 160
  Sun ○ Recovery

  Weekly: 51 km | 1380 m D+ | 5h 12m | 6 activities
  CTL: 72.3   ATL: 84.1   TSB: -11.8   Readiness: 68/100

  Sunday evening → Sunday review worker:
    1. Computes trajectory (volume ramp vs goal requirement)
    2. Detects gaps (elevation, long-run, consistency)
    3. Generates next week's plan (deterministic fallback, or LLM-assisted)
    4. Optionally adds LLM coach notes
    5. Plan saved to DB, shown on dashboard
```

## Security

- **Authentication:** NextAuth v5 JWT sessions; passwords bcrypt-hashed.
- **Authorization:** Every API route verifies the session and scopes queries to `userId`.
- **Multi-tenant isolation:** All user tables include `userId`; Prisma queries always
  filter `where: { userId: session.user.id }`.
- **Secrets:** Device-session tokens (Garmin OAuth1/OAuth2, COROS access token) are
  stored in the DB and never exposed to the client.
- **API keys:** Watch-push and external access use hashed `ApiKey` records
  (`coach_*`), verified server-side.
- **Input validation:** API inputs validated with Zod schemas.
- **LLM data:** A structured prompt is sent to the configured provider; no PII beyond
  the athlete's name, and data never leaves the machine when using local Ollama.
