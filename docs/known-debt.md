# Known Technical Debt

Distilled from the July 2026 bloat audit (`BLOAT.md`, removed) and the current
codebase. The audit's Phases 1–3 (dead code removal, dedup, monolith splits,
integration consolidation, backup/restore hardening, test suite) were largely
executed — these are the items still open as of August 2026.

## Large Monoliths

| File | ~Lines | Notes |
|------|-------:|-------|
| `src/lib/ai-coach.ts` | 2,181 | AI coach: analyze, chat, interview, plan proposals, activity analysis. Partially split (tools/conversation extracted) but still the core monolith. |
| `src/app/[locale]/onboarding/page.tsx` | ~1,228 | 5-step wizard, all steps inline. |
| `src/app/[locale]/dashboard/page.tsx` | ~977 | Widgets + multiple inline `fetch()` calls; `LoadCard` etc. |
| `src/lib/ai-coach-tools.ts` | 1,461 | Tool/function execution for the coach. |

## Dashboard API Round-Trips

The dashboard renders from `/api/dashboard/load` plus supplementary calls
(`trackpoint-insights`, `trends`, `intensity-distribution`, `pmc-history`, `plan`,
`daily-health`) made from the client. Consolidating these into the batched load
endpoint (or fewer grouped endpoints) would cut round-trips.

## Smaller Items

- **`RaceGoal.raceType`** is a free-text `String`, but code hardcodes checks for
  `"marathon"`, `"ultra"` — a type mismatch risk; could be an enum.
- **`DailyHealth`** syncs ~12 fields that aren't surfaced in the UI (deep/light/REM
  sleep seconds, min/max HR, step goal, HRV balance, sleep start/end, max stress).
- **~55 `any` casts** historically clustered in backup/restore and the Garmin/COROS
  sync pipelines.
- **`console.log`** untagged (plain English, no structured tags) in a few lib files
  (`plan-adjuster.ts`, activity-analysis queue, strava-export parser).
- **`export const dynamic = "force-dynamic"`** leftovers on some routes from
  debugging.
- **Dynamic `import("./prisma")`** inside `activity-analysis-queue.ts` and `llm.ts`
  — deliberate cycle avoidance, but per-call overhead.

## Prefer Not To Touch

- `src/lib/plan-generator.ts` is the deterministic weekly-plan fallback and is used
  by `/api/dashboard/plan` — the audit once flagged it as dead, but it is live.
- `eslint-disable` in `fit-parser.ts` for the untyped `fit-file-parser` `require()`
  is legitimate.
