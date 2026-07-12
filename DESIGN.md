# Coach — Design Document

Coach is a self-hosted endurance sports coaching platform. It pulls training data from Strava and device files (GPX/TCX/FIT/CSV), builds periodized weekly training plans for race goals, detects fatigue across 8 physiological signals, and generates AI-powered coaching analysis via local or cloud LLMs.

---

## 1. Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                      Docker Host                             │
│                                                              │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────────┐ │
│  │  coach-   │  │  coach-  │  │  coach-  │  │  coach-      │ │
│  │  app      │  │  worker  │  │  db      │  │  redis       │ │
│  │  :3000    │  │          │  │  :5432   │  │  :6379       │ │
│  │  Next.js  │  │  BullMQ  │  │  PG 16   │  │  Redis 7     │ │
│  └─────┬─────┘  └────┬─────┘  └────┬─────┘  └──────┬───────┘ │
│        │              │             │               │         │
│  ┌─────┴──────────────┴─────────────┴───────────────┴───────┐│
│  │  coach-ollama   :11434                                    ││
│  │  Ollama (local LLM — optional)                            ││
│  └───────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────┘
```

### Services

| Container | Image | Role |
|-----------|-------|------|
| `coach-app` | Node.js 20 Alpine | Next.js 14 server (SSR, API routes, pages) |
| `coach-worker` | Same image, different entrypoint | Background jobs: Strava sync, fatigue monitor, Sunday review |
| `coach-db` | PostgreSQL 16 Alpine | Persistent storage |
| `coach-redis` | Redis 7 Alpine | BullMQ job queue backing store |
| `coach-ollama` | ollama/ollama | Local LLM inference (optional; can swap to DeepSeek/OpenAI cloud) |

### Technology Stack

| Layer | Choice | Notes |
|-------|--------|-------|
| Framework | Next.js 14 App Router | React Server Components + API routes in one project |
| Language | TypeScript | Strict mode, full-stack type safety |
| Database | PostgreSQL 16 | Via Prisma ORM |
| ORM | Prisma 5 | Schema-first, auto-generated types, migrations |
| Auth | NextAuth.js v5 | JWT sessions with credentials provider |
| Styling | TailwindCSS + shadcn/ui | Utility-first CSS + Radix-based accessible components |
| Charts | Recharts | Training data visualizations |
| Job Queue | BullMQ + Redis | Strava sync, fatigue monitor, Sunday review |
| LLM | Ollama (default) / DeepSeek / OpenAI | OpenAI-compatible API abstraction |
| Container | Docker Compose | 5-service orchestration |

### Key Design Decisions

**Why Next.js?** Single project for both frontend and API — no CORS, shared TypeScript, server components for auth-protected data fetching.

**Why PostgreSQL over SQLite?** Multi-user from day one. Row-level ownership (`userId` on every table) ensures isolation. Prisma generates the queries.

**Why BullMQ over cron?** Strava syncs, fatigue checks, and Sunday reviews are job-queue work: retry semantics, concurrency control, and a dashboard (via Redis) come free.

**Why Ollama first?** The app is self-hosted on Docker. Ollama runs locally, needs no API key, and keeps training data private. The LLM module abstracts providers, so switching to DeepSeek cloud is a one-line env change.

---

## 2. Data Model

All tables have `userId` foreign keys to `User`. Every API query scopes by session user.

```
User
├── StravaConnection     (1:1)
├── TrainingLog[]        (1:N)
├── RaceGoal[]           (1:N)
├── TrainingFacility[]   (1:N)
├── BodyMetric[]         (1:N)
├── TrainingAvailability[](1:N)
├── WeeklyAssessment[]   (1:N)
├── WeeklyPlan[]         (1:N)
└── FatigueAlert[]       (1:N)
```

### Core Entities

**User** — email, name, bcrypt password hash. Created via signup API.

**StravaConnection** — OAuth2 tokens (access + refresh), expiry, athlete ID. One per user. Token refresh happens transparently before each API call.

**TrainingLog** — a single activity (run, ride, swim, etc.). Uniquely identified by `(userId, externalId, source)`. Sources: `strava`, `manual` (CSV/GPX/manual entry), `garmin` (future). TSS is estimated from HR/duration when not provided by the device.

**RaceGoal** — target race with date, distance, elevation, priority (A/B/C), status (active/completed/cancelled). The plan generator prioritizes A-goals and the nearest race date.

**TrainingFacility** — a training venue or equipment (Gunung Pulai road, power trainer, pool). Type, distance, elevation, surface. Linked to availability slots.

**BodyMetric** — recorded weight, height, resting HR. Time-series for fatigue detection (resting HR drift, weight drift).

**TrainingAvailability** — a recurring time window on a specific weekday, linked to specific facility IDs. Example: "Saturday 5:30–10:00, facilities: Gunung Pulai, Road Loop."

**WeeklyAssessment** — snapshot of readiness for a given week. CTL/ATL/TSB from the PMC model, readiness score (0–100), volume/elevation/duration aggregates, per-goal progress %, human-readable recommendations.

**WeeklyPlan** — auto-generated training plan for the upcoming week. JSON array of planned sessions (day, type, description, distance, elevation, facility), adjustments from last week, trajectory assessment, and optional AI coach notes.

**FatigueAlert** — raised when fatigue signals cross thresholds. Severity (low/medium/high/critical), contributing signals as JSON, rest recommendation, acknowledged flag.

---

## 3. API Design

### Authentication

All API routes call `const session = await auth()` from NextAuth. Unauthenticated requests return 401. The middleware redirects unauthenticated page requests to `/auth/signin`.

```
POST /api/auth/signup        — register (name, email, password → bcrypt hash)
GET  /api/auth/[...nextauth] — NextAuth handler (signin callback, session, JWT)
```

### RESTful CRUD

| Resource | List/Create | Get/Update/Delete |
|----------|-------------|-------------------|
| Goals | `GET/POST /api/goals` | `GET/PUT/DELETE /api/goals/[id]` |
| Facilities | `GET/POST /api/facilities` | `GET/PUT/DELETE /api/facilities/[id]` |
| Body Metrics | `GET/POST /api/body-metrics` | `DELETE /api/body-metrics/[id]` |
| Availability | `GET/POST /api/availability` | `DELETE /api/availability/[id]` |
| Training Logs | `GET /api/training-logs` (query: type, from, to, limit) | `GET /api/training-logs/[id]` |

### Integrations

```
GET  /api/integrations/strava/connect   — returns Strava OAuth URL
GET  /api/integrations/strava/callback  — OAuth redirect target, exchanges code for tokens
GET  /api/integrations/strava/status    — connection status + last sync time
POST /api/integrations/strava/sync      — manual sync trigger (paginates activities, upserts)
DEL  /api/integrations/strava/status    — disconnect
```

### Data Ingestion

```
POST /api/ingestion/csv     — multipart upload activities.csv (Strava export)
POST /api/ingestion/gpx     — multipart upload .gpx/.tcx/.fit files
POST /api/ingestion/manual  — JSON body: manual activity entry
```

### Assessments & Plans

```
GET  /api/assessments/current     — real-time readiness computation + fatigue check
GET  /api/assessments/history     — historical trend (future)
POST /api/assessments/calculate   — force recalculation
GET  /api/weekly-plan/current     — this week's training plan (includes coachNotes)
PUT  /api/weekly-plan/[date]      — user override of generated plan
GET  /api/fatigue-alerts          — recent fatigue alerts
PUT  /api/fatigue-alerts/[id]/acknowledge — dismiss alert
```

---

## 4. Analytics Engine

### PMC Model (Performance Management Chart)

Based on Banister's impulse-response model, popularized by TrainingPeaks.

```
CTL (Fitness) = TSS_today × (1 - e^(-1/42)) + CTL_yesterday × e^(-1/42)
ATL (Fatigue) = TSS_today × (1 - e^(-1/7))  + ATL_yesterday × e^(-1/7)
TSB (Form)    = CTL - ATL
```

- CTL is a 42-day exponentially weighted moving average (EWMA) of daily TSS
- ATL is a 7-day EWMA
- TSB positive = fresh/peaking, TSB negative = fatigued/building
- Ramp rate = week-over-week CTL change (target: 5–10 pts/week)

### Fatigue Detection (8 signals)

Runs daily via the fatigue-monitor worker. Each signal contributes a weighted score (0–100). Severity thresholds: low (<18), medium (18–34), high (35–59), critical (≥60).

| Signal | Source | Weight | What It Detects |
|--------|--------|--------|-----------------|
| TSB depth | PMC model | 25% | How far below zero current TSB is |
| TSB duration | PMC model | 20% | Consecutive days with negative TSB |
| Resting HR drift | BodyMetric.restingHr | 18% | +5 bpm above 2-week baseline → autonomic stress |
| Exercise HR drift | TrainingLog avgHr vs baseline | 12% | +6 bpm at same pace → accumulating fatigue |
| Training monotony | Daily TSS array | 10% | stddev/mean > 0.8 → repetitive loading, injury risk |
| Training strain | TSS × monotony | 10% | Combined load metric > 3000 |
| Weight drift | BodyMetric.weightKg | 5% | >1.5 kg loss in 7 days → under-fueling |

### Readiness Score (0–100)

Weekly composite:
- **TSB/Form** (25%): higher TSB = more ready
- **Volume adherence** (25%): actual vs target weekly distance
- **Elevation adherence** (20%): actual vs target weekly vert
- **Consistency** (15%): % of planned sessions completed
- **Fatigue penalty** (15%): active fatigue alerts reduce the score

Interpretation: ≥70 "On Track", 50–70 "Needs Attention", <50 "Off Track"

### Sunday Review & Plan Generator

Runs weekly. Pipeline:

1. **Trajectory analysis** — linear regression over last 4 weeks of volume. Compare ramp rate against required rate to hit goal distance by race date (typical target: peak volume ≈ 70% of race distance, 4 weeks out).

2. **Gap calculation** — volume gap, elevation gap, long-run duration gap, consistency gap.

3. **Plan generation** — allocates sessions to available days:
   - Long run/ride assigned to the day with the most time and suitable facility
   - Quality sessions (intervals, tempo) on trainer or road days
   - Hill repeats on days with trail/elevation access
   - Easy/recovery runs fill remaining slots
   - Rest days for unavailable days
   - Facility conflict avoidance: never schedule hill repeats without trail access

4. **Fatigue override** — if fatigue severity is high/critical, plan volume is reduced to 40–60%.

5. **Adjustments** — human-readable diff from last week: "↑ Long run +5 km — 4 weeks behind on volume for 100km race"

---

## 5. LLM Integration

The LLM module (`src/lib/llm.ts`) abstracts providers behind an OpenAI-compatible interface:

```
LLM_PROVIDER=ollama|deepseek|openai|anthropic
LLM_BASE_URL=http://ollama:11434/v1
LLM_MODEL=mistral:7b
```

The coach notes generator (`src/lib/coach-notes.ts`) builds a structured prompt containing the athlete's complete data snapshot (goals, 4-week history, PMC numbers, fatigue signals, generated plan) and asks the LLM for a 3–4 paragraph coaching analysis. The output is stored in `WeeklyPlan.coachNotes` and displayed on the dashboard.

If the LLM is unavailable, the system degrades gracefully — the weekly plan is still generated and delivered without the narrative analysis.

---

## 6. Data Ingestion Pipeline

```
                     ┌─────────────┐
                     │   Sources    │
                     └──────┬──────┘
            ┌───────────────┼───────────────┐
            ▼               ▼               ▼
     ┌────────────┐  ┌────────────┐  ┌────────────┐
     │ Strava API │  │ File Upload │  │   Manual   │
     │  (OAuth)   │  │ GPX/TCX/FIT │  │   Entry    │
     │            │  │    CSV      │  │            │
     └─────┬──────┘  └──────┬─────┘  └──────┬─────┘
           │                │               │
           ▼                ▼               ▼
     ┌────────────────────────────────────────────┐
     │              TrainingLog                     │
     │  (userId, externalId, source) UNIQUE         │
     │  Upsert prevents duplicates                  │
     └────────────────────────────────────────────┘
```

### Strava API
- OAuth2 flow with `activity:read_all` scope
- Sync worker runs every 2 hours for all connected users
- Token refresh happens transparently
- Paginated fetch (50 per page) since last sync timestamp

### Strava CSV Export
- Upload `activities.csv` from strava.com → Settings → Download Your Data
- Parses all standard columns (date, name, type, moving time, distance, elevation, HR, power, calories)
- Uses the Strava Activity ID for deduplication

### GPX/TCX/FIT Files
- **GPX**: XML with `<trkpt>` elements. Distance via Haversine, elevation from `<ele>`, HR from extensions.
- **TCX**: Garmin's XML with lap summaries (`TotalTimeSeconds`, `DistanceMeters`) and trackpoint-level data.
- **FIT**: Garmin's binary format via `fit-file-parser`. Session summaries extracted first (most accurate); falls back to record-level computation.

### Manual Entry
- Form with activity type, date/time, duration, distance, elevation, HR, calories, notes
- TSS auto-estimated from HR and duration
- Stored with `source: "manual"`, unique external ID

---

## 7. Security

- **Authentication**: NextAuth v5 with JWT sessions. Passwords bcrypt-hashed (12 rounds).
- **Authorization**: Every API route verifies session and scopes queries to `userId`.
- **Multi-tenant isolation**: All tables include `userId`. Prisma queries always filter `where: { userId: session.user.id }`.
- **Strava tokens**: Stored in DB, never exposed to client. Token refresh happens server-side.
- **Input validation**: All API inputs validated with Zod schemas.
- **LLM data**: When using local Ollama, training data never leaves the machine. Cloud providers receive a structured prompt but no PII beyond the athlete's name.

---

## 8. File Structure

```
coach/
├── docker-compose.yml            # 5 services: app, worker, db, redis, ollama
├── Dockerfile                    # Multi-stage: deps → builder → runner
├── tsconfig.json                 # Next.js TypeScript config
├── tsconfig.worker.json          # Worker compilation config (tsc → dist-workers/)
├── package.json
├── .env                          # Local dev config
├── prisma/
│   ├── schema.prisma             # 10 models, enums, indexes
│   └── seed.ts                   # Demo user, facilities, goals, schedule
├── src/
│   ├── app/                      # Next.js App Router pages + API routes
│   │   ├── page.tsx              # Landing page
│   │   ├── layout.tsx            # Root layout + navbar
│   │   ├── globals.css           # Tailwind + shadcn CSS variables
│   │   ├── dashboard/            # Main dashboard
│   │   ├── training-logs/        # Activity browser + detail
│   │   ├── goals/                # Race goals CRUD + detail
│   │   ├── facilities/           # Training venues
│   │   ├── body-metrics/         # Weight/HR tracking
│   │   ├── availability/         # Weekly schedule editor
│   │   ├── ingestion/            # Data import (Strava, CSV, GPX, manual)
│   │   ├── settings/             # Profile + Strava connect
│   │   ├── auth/                 # Sign in / sign up
│   │   └── api/                  # 19 API route handlers
│   ├── components/
│   │   ├── ui/                   # shadcn primitives (button, card, input, etc.)
│   │   ├── layout/navbar.tsx     # Navigation bar
│   │   └── dashboard/            # Dashboard sub-components (future)
│   ├── lib/
│   │   ├── prisma.ts             # Prisma client singleton
│   │   ├── auth.ts               # NextAuth configuration
│   │   ├── redis.ts              # Redis connection + BullMQ helpers
│   │   ├── strava.ts             # Strava OAuth + API client + TSS estimator
│   │   ├── csv-parser.ts         # Strava CSV export parser
│   │   ├── gpx-parser.ts         # GPX + TCX XML parser (Haversine distance)
│   │   ├── fit-parser.ts         # FIT binary parser (session + record level)
│   │   ├── training-load.ts      # PMC model: CTL/ATL/TSB, monotony, strain, regression
│   │   ├── fatigue-detector.ts   # 8-signal fatigue detection
│   │   ├── assessment.ts         # Readiness score computation
│   │   ├── plan-generator.ts     # Weekly plan generation + trajectory analysis
│   │   ├── coach-notes.ts        # LLM coaching analysis prompt builder
│   │   ├── llm.ts                # Multi-provider LLM abstraction
│   │   └── utils.ts              # Formatting, date helpers
│   ├── workers/
│   │   └── entrypoint.ts         # BullMQ workers + in-process scheduler
│   ├── types/
│   │   └── next-auth.d.ts        # Session type augmentation
│   └── middleware.ts             # Auth guard for routes
└── data/                         # Docker volumes (Postgres, Redis, Ollama models)
```

---

## 9. Training Data Flow

```
Week View:

  Mon ● Easy run        8 km   50m D+   HR 128   TSS 45
  Tue ● Intervals        —     —        HR 155   TSS 72
  Wed ○ Rest
  Thu ● Tempo run       12 km  100m D+  HR 148   TSS 88
  Fri ● Easy run        6 km   30m D+   HR 125   TSS 32
  Sat ● Long trail run  25 km  1200m D+ HR 142   TSS 160
  Sun ○ Recovery

  ─────────────────────────────────────────────────
  Weekly: 51 km | 1380m D+ | 5h 12m | 6 activities
  CTL: 72.3  ATL: 84.1  TSB: -11.8
  Readiness: 68/100 ("Needs Attention")
  ─────────────────────────────────────────────────

  Sunday evening → Sunday Review Worker runs:
    1. Computes trajectory: volume +5% /week, on track
    2. Gap: elevation is 22% behind for 100km race goal
    3. Generates next week's plan with extra hill repeats
    4. LLM generates coach notes (if configured)
    5. Plan + notes saved to DB, displayed on dashboard
```

---

## 10. Future Directions

- **Garmin Connect direct** — requires Garmin API partner agreement; Strava hub handles this for now
- **Training peaks import** — similar CSV format
- **Email/push notifications** — fatigue alert when severity reaches high, Sunday plan ready
- **Workout builder** — structured interval sessions (warmup, work, recovery, cooldown blocks)
- **Nutrition logging** — caloric intake vs expenditure, macro tracking
- **Race predictor** — estimate finish time based on training data (Riegel formula or similar)
- **Multi-athlete coach dashboard** — coach role that can view/manage multiple athletes
- **Mobile PWA** — service worker for offline access, push notifications
