# Project Status — July 10, 2026

## What's Working

### Core Infrastructure
- **Docker Compose**: 5 containers (app, worker, db, redis, ollama) all start cleanly
- **PostgreSQL**: 2,121 training logs imported from `activities.csv` (2017–2026)
- **Auth**: signup/signin/sessions work. Demo user `demo@coach.app` / `password123` is admin
- **Tailscale**: reverse proxy at `https://coach.oryx-everest.ts.net` with HTTP→HTTPS redirect

### Pages That Load
- Landing page, signin, signup, settings, goals, facilities, body metrics, availability
- Training logs list + detail (with prev/next navigation, touch swipe, auto-saving remarks)
- Data ingestion (CSV, GPX/TCX/FIT, manual entry)
- Admin panel (user management, password reset links)
- LLM test page
- API credentials page (Strava keys stored in DB)

### Data Ingestion
- **CSV import works** — `activities.csv` imported 2,121 records correctly
- **GPX/TCX/FIT** — parser works
- **Manual entry** — works

### Dashboard (Rebuilt — 5 of 8 cards done)
Each card has its own lightweight API endpoint under `/api/dashboard/`. Zero dependencies on the old assessment/lib code — no minifier bugs.

| Card | Status | Endpoint |
|------|--------|----------|
| Readiness Score | ✅ Done | `/api/dashboard/readiness` |
| Stats (distance, elevation, duration, TSS) | ✅ Done | `/api/dashboard/stats` |
| Goal Progress | ✅ Done | `/api/dashboard/goals` |
| Fatigue + Recommendations | ✅ Done | `/api/dashboard/fatigue` |
| Recent Training | ✅ Done | `/api/dashboard/recent` |
| Weekly Plan | ❌ Not yet | — |
| Coach's Notes (LLM) | ❌ Not yet | — |
| Refresh button | ✅ Done | — |

### Other Working Features
- Weekly review schedule configurable per user
- Mobile-responsive navbar with hamburger menu
- Touch swipe on training log detail page
- Auto-saving remarks on training logs

## What's Broken / Blocked

### Strava OAuth
- Token exchange works, but `athlete.id` is undefined because Strava API returns 403 "Inactive"
- **Root cause**: Strava now requires a paid subscription for API access
- **Workaround**: Use CSV import for historical data, direct device files for new activities

### Minifier TDZ Bug (FIXED — July 11, 2026)
- **Root cause**: `computePMC` in both `pmc.ts` and `training-load.ts` used `.map()` with a callback that referenced the results array (`results[index - 7].ctl`), accessing a `const`/`let` variable in its TDZ (Temporal Dead Zone)
- **Prod symptom**: Terser mangles `results` → `l`, producing `ReferenceError: Cannot access 'l' before initialization`
- **Fix**: Replaced `.map()` with a `for-of` loop that builds the array via `.push()`, so the results array is always initialized when accessed
- **Files fixed**: `src/lib/pmc.ts`, `src/lib/training-load.ts` (also renamed `_pos` → `idx` in `computeLinearRegression` to avoid variable collision)

### Worker Container
- Compiles and starts (BullMQ workers for Strava sync, fatigue monitor, Sunday review)
- But Sunday review plan generator uses `training-load.ts` which may have the same minifier issue
- **Not yet verified** whether the worker runs correctly in production

## File Map

Key files for continuing dashboard work:

```
src/app/dashboard/page.tsx          ← Dashboard UI (add cards here)
src/app/api/dashboard/recent/route.ts   ← Recent training endpoint
src/app/api/dashboard/stats/route.ts    ← Weekly stats
src/app/api/dashboard/goals/route.ts    ← Goal progress
src/app/api/dashboard/fatigue/route.ts  ← Fatigue + recommendations
src/app/api/dashboard/readiness/route.ts ← Readiness score
src/lib/training-load.ts            ← Has minifier bug (computeLinearRegression)
src/lib/pmc.ts                      ← Clean PMC module (computePMC only)
src/lib/coach-notes.ts              ← LLM coach notes generator (unused by new dashboard)
src/workers/entrypoint.ts           ← Background worker (needs verification)
```

## Next Steps

### Priority: Finish Dashboard Cards
1. **Weekly Plan** — needs a new `/api/dashboard/plan` endpoint that calls `generateWeeklyPlan` from `plan-generator.ts`, then a card showing the week's scheduled sessions
2. **Coach's Notes** — call `generateCoachNotes` from `coach-notes.ts` (requires working LLM), show in a card. Can use the same pattern as `POST /api/assessments/calculate` but without the problematic assessment imports

### Priority: Fix Strava (if subscription obtained)
1. Verify Strava API app is "Active" on strava.com/settings/api
2. Ensure `public_url` is set in DB (Settings → API Credentials → Public URL)
3. The callback flow now uses `public_url` from DB for all redirects

### Nice to Have
- Worker verification — test that Sunday review generates plans correctly
- Remove the old broken `/api/assessments/current` and `/api/assessments/calculate` routes
- Or rewrite them to use the clean `/api/dashboard/` pattern

### Build & Deploy Commands
```bash
# Full build
docker compose build --no-cache app && docker compose up -d --force-recreate app

# Build app + worker
docker compose build --no-cache app worker && docker compose up -d --force-recreate app worker

# Local build (no Docker)
npm run build
```

### Database
```bash
# Check data
docker exec coach-db psql -U coach -d coach -c "SELECT COUNT(*) FROM training_logs;"
docker exec coach-db psql -U coach -d coach -c "SELECT type, COUNT(*) FROM training_logs GROUP BY type;"
```
