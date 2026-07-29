# Bloat & Redundancy Audit

Generated 2026-07-29 from analysis of all 293 source files across 7 parallel agents.

---

## 🔴 Critical — High Impact, Low Risk to Fix

### 1. Duplicate Types (`coach-chat.tsx` vs `training-plan-types.ts`)
- `PlanDay`, `PlanDayPlanned`, `PlanDayActual` defined identically in both
- **Fix:** Remove from `coach-chat.tsx`, import from `training-plan-types.ts`

### 2. `PHASE_COLORS` Triplicated
- `training-plan/route.ts:19`, `plan-proposal-card.tsx:11`, `training-plan-summary-card.tsx:8`
- Each has slightly different entries (Recovery/Rebuild missing from API route version)
- **Fix:** Extract to shared constant module

### 3. `chat()` / `chatWithTools()` in `llm.ts` — 80% Duplicate
- Lines 109–183 and 247–324 share identical HTTP fetch, abort-signal, error handling
- **Fix:** Extract `sendChatCompletion()` helper, call from both

### 4. `computeReadiness()` / `computeFatigue()` Triplicated
- `metrics-snapshot.ts` implements simplified copies
- `/api/dashboard/readiness` and `/api/dashboard/fatigue` have standalone copies
- `training-context.ts` has third copies (lines 289-399)
- **Fix:** Extract core algorithms to shared lib module, import everywhere

### 5. Garmin / COROS Sync Pipeline ~80% Duplicate
- Both `garmin.ts` and `coros.ts` import the same modules and follow identical pattern: fetch → filter → download → parse FIT → simplify trackpoints → classify → upsert → snapshot
- Both have 5 matching route files (`connect`, `disconnect`, `reset-sync`, `status`, `sync`)
- **Fix:** Extract shared sync pipeline, parameterize provider-specific bits

### 6. `ACTIVITY_TYPES` / `SUB_TYPE_OPTIONS` Tripled
- `import-modal.tsx`, `ingestion/page.tsx`, and partially `onboarding/page.tsx`
- ~30 identical subtype label definitions
- **Fix:** Extract to shared constants

### 7. `SOURCE_LABELS` / `SOURCE_COLORS` Duplicated
- `activities/page.tsx` and `activities/[id]/page.tsx` both define source badge styling
- **Fix:** Extract to shared constants

### 8. 10 Dead API Routes (~800 Lines)
**No client fetch call exists for any of these — fully subsumed by `/api/dashboard/load`:**
1. `/api/dashboard/stats` (95 lines)
2. `/api/dashboard/recent` (24 lines)
3. `/api/dashboard/readiness` (146 lines)
4. `/api/dashboard/fatigue` (141 lines)
5. `/api/dashboard/goals` (58 lines)
6. `/api/dashboard/pmc` (88 lines)
7. `/api/dashboard/notes` (29 lines)
8. `/api/dashboard/snapshot` (58 lines)
9. `/api/fatigue-alerts` (15 lines)
10. `/api/weekly-plan/current` (19 lines)

**Fix:** Remove or slim to wrappers

### 9. Dead Lib Files (~420 Lines)
- **`coach-notes.ts`** (218 lines) — `generateCoachNotes()` replaced by `ai-coach.ts` Zod-validated approach
- **`plan-generator.ts`** (201 lines) — `generateWeeklyPlan()` replaced by LLM-based plan generation
- **Fix:** Remove files

---

## 🟡 Medium Impact

### 10. Haversine Formula Triplicated
Same formula in `gpx-parser.ts`, `route-matching.ts`, `trackpoint-charts.ts`
**Fix:** Move to `utils.ts`

### 11. TSS Calculation Quadruplicated
`durationSec × intensity² / 36` formula in `csv-parser.ts`, `fit-parser.ts`, `gpx-parser.ts`, `trackpoint-metrics.ts`
**Fix:** Extract to `utils.ts`

### 12. Normalized Power (4th-Power Rolling Avg) Duplicated
`gpx-parser.ts` and `trackpoint-metrics.ts`
**Fix:** Extract shared helper

### 13. Sport Type Mapping Triplicated
`csv-parser.ts` (Strava CSV strings), `fit-parser.ts` (FIT sport/sub_sport codes), `gpx-parser.ts` (name-based heuristics)
**Fix:** Map files to common enums in a single module

### 14. 16 Dashboard API Routes — Many Tiny
| Route | Lines |
|---|---|
| `/recent` | 24 |
| `/goals` | 58 |
| `/snapshot` | 58 |
| `/pmc-history` | 65 |
| `/preferences` | 87 |
| `/pmc` | 88 |
| `/stats` | 95 |
| `/trends` | 132 |
| `/fatigue` | 141 |
| `/readiness` | 146 |
| `/plan` | 198 |
| `/trackpoint-insights` | 210 |
| `/notes` | 249 |
| `/load` | 312 |
| `/coach` | 332 |
| `/intensity-distribution` | 77 |

16 separate HTTP round-trips to render one dashboard page.
**Fix:** Merge to 3-4 batched endpoints

### 15. `ai-coach.ts` — 2229-Line Monolith
15 exports across: analysis, chat, interview, plan proposals, activity analysis, context management.
**Fix:** Split into `ai-analysis.ts`, `ai-chat.ts`, `ai-planning.ts`, `ai-interview.ts`

### 16. `JSON.parse(JSON.stringify(...))` — 10+ Occurrences
Used in `ai-coach.ts` and `ai-coach-tools.ts` for deep cloning
**Fix:** Replace with `structuredClone()`

### 17. i18n Duplication Across Namespaces
- 858 keys/language, `settings` = 326 (38%)
- `settings.goals` duplicates top-level `goals` (~25 keys)
- `map` (5 keys) duplicates `heatmap` (6 keys)
- `dashboard.noPlanSet` / `training-plan.noPlanSet`
- **Fix:** Hoist shared to `common`, merge `map→heatmap`

### 18. `backup/route.ts` (480) + `restore/route.ts` (491) — Heavy `any`
- ~70 `as any` / `: any` casts combined
- Repetitive per-model map/build loops
- `$queryRawUnsafe` (SQL injection surface)
- **Fix:** Generics + per-model serializers

### 19. `coach-chat.tsx` — 1200-Line Monolithic Component
SSE streaming, conversation CRUD, plan proposals, suggestion management, dual render modes, auto-scroll, keyboard shortcuts, progress feeds. Two complete JSX render trees.
**Fix:** Split into `CoachMessageList`, `CoachMessageBubble`, `CoachInputBar`, `CoachInterviewPanel`

### 20. `dashboard/page.tsx` — 1009 Lines
8+ inline `fetch()` calls + inline `HrZoneCard` / `HealthMetricsCard` components
**Fix:** Widget components + batched data endpoint

### 21. `onboarding/page.tsx` — 1249 Lines
5-step wizard, all steps and inline components in one file
**Fix:** Step components

### 22. `activities/[id]/page.tsx` — 898 Lines
`LogCard` component (405 lines) inline with 15+ props. Inline swipe detection, keyboard nav, auto-save, analysis polling.
**Fix:** Extract `LogCard`

### 23. `calendar-view.tsx` — 844 Lines
Four internal components: `DayCell`, `WeekListView`, `DayCard`, `DayDetailContent`
**Fix:** Extract to separate files

### 24. `StatItem` (MonthlySummary) / `WeekStatRow` (WeeklySummary) — Identical
Same icon+label+value+bar pattern
**Fix:** Extract `StatRow` shared component

### 25. Redirect Stub Pages — 12 Files
`goals/page.tsx`, `goals/[id]/page.tsx`, `body-metrics/page.tsx`, `availability/page.tsx`, `llm-test/page.tsx`, `settings/goals/page.tsx`, `settings/body-metrics/page.tsx`, `settings/analysis/page.tsx`, `settings/credentials/page.tsx`, `settings/integrations/page.tsx`, `settings/backup-restore/page.tsx`, `settings/danger-zone/page.tsx`
**Fix:** Move to `next.config.js` redirects

### 26. Past-Day Filtering Logic Duplicated in `ai-coach-tools.ts`
Both `executeUpdateWeeklyPlan` and `executeCreateTrainingPhase` repeat the same `sessionDate < todayStart` skip logic
**Fix:** Extract shared "skip past days" helper

---

## 🟢 Minor

### 27. ~55 `any` Type Abuses
Clustered in `backup/route.ts`, `restore/route.ts`, `garmin.ts`, `coros.ts`, `metrics-snapshot.ts`

### 28. 31 `console.log` in Production Code
- `plan-adjuster.ts` = 8 (plain English, no tags — fix)
- `coach-notes.ts` = 4 (plain English)
- `workers/entrypoint.ts` = 16 (structured tags — acceptable)
- `heatmap/page.tsx` = 1 (client-side — unwanted)

### 29. `DailyHealth` Over-Collection
~12 fields synced from Garmin but never surfaced: `deepSleepSeconds`, `lightSleepSeconds`, `remSleepSeconds`, `awakeSeconds`, `minHeartRate`, `maxHeartRate`, `stepGoal`, `hrvBalance`, `sleepStartLocal`, `sleepEndLocal`, `maxStress`

### 30. `RaceGoal.raceType` is Free-Text String (Not Enum)
Code hardcodes checks for `"marathon"`, `"ultra"` — type mismatch risk.

### 31. `CoachSuggestion.userId` Denormalized
Reachable via `conversation → user`, stored + indexed redundantly.

### 32. `plan-adjuster.ts` Triple-Nested Retry
Three retry paths (parse fail → guardrail fail → return-violations) in 378 lines.
**Fix:** Linearize.

### 33. Dynamic Imports Inside Functions
`await import("./prisma")` inside `activity-analysis-queue.ts` (lines 36, 51) and `llm.ts` (line 210) instead of top-level — deliberate cycle avoidance but adds per-call overhead.

### 34. Worker Startup Logs Every Boot
`entrypoint.ts:418-423` prints every worker name + description — dev-only.

### 35. `export const dynamic = "force-dynamic"` Carryover
Seen on backup route etc. — likely left over from debugging.

### 36. 1 `eslint-disable` — Legitimate
`fit-parser.ts:15` for `require()` of untyped `fit-file-parser`.

---

## 📊 Summary

| Category | Count | Effort |
|---|---|---|
| 🔴 Duplicate types/constants | 7 instances | Small |
| 🔴 Dead API routes | 10 endpoints (~800 lines) | Remove |
| 🔴 Dead lib files | 2 files (~420 lines) | Remove |
| 🔴 Monolithic files >800 lines | 6 files (10,724 lines combined) | Refactor |
| 🟡 API route proliferation | 16 dashboard endpoints | Consolidate |
| 🟡 Algorithm duplication | 4 formulas copied 2-4× each | Extract to utils |
| 🟡 Redirect stub pages | 12 files | Move to config |
| 🟡 i18n duplication | 3 namespace overlaps | Merge |
| 🟡 `any` type abuse | ~55 occurrences | Type hardening |
| 🟡 Deep-clone pattern | `JSON.parse(JSON.stringify(...))` 10× | `structuredClone` |
| 🟢 `console.log` cleanup | 12 untagged calls | Structure |
| 🟢 `DailyHealth` over-collection | ~12 unsurfaced fields | Prune |
| 🟢 `RaceGoal.raceType` | String, not enum | Schema fix |

---

## 🎯 Recommended Order

### Phase 1 — Quick mechanical wins (no behavioral change)
1. **Remove dead code:** 10 dead API routes + `coach-notes.ts` + `plan-generator.ts` (~1,200 lines)
2. **Deduplicate types:** `PlanDay*` from `coach-chat.tsx`, `PHASE_COLORS`, `ACTIVITY_TYPES`, `SOURCE_LABELS`
3. **Extract `StatRow`** from MonthlySummary/WeeklySummary
4. **Merge `map→heatmap`** i18n namespace
5. **Move 12 redirect stubs** to `next.config.js`
6. **Extract `sendChatCompletion()`** in `llm.ts`
7. **Hoist shared i18n keys** (`settings.goals→goals`, dashboard→`common`)

### Phase 2 — Structural refactors
8. **Extract shared algorithms:** Haversine, TSS, NP, sport-type mappings → `utils.ts` or `geo.ts`
9. **Split `ai-coach.ts`** (2229 lines) → domain modules
10. **Split `coach-chat.tsx`** (1200 lines) → sub-components
11. **Extract dashboard/LoadCard/onboarding/LogCard/calendar sub-components**

### Phase 3 — API and data consolidation
12. **Merge 16 dashboard routes** → 3-4 batched endpoints
13. **Parameterize Garmin/COROS** integration routes
14. **Deduplicate `metrics-snapshot.ts`** + `training-context.ts` with shared lib
15. **Type-harden** backup/restore routes
16. **Prune `DailyHealth`** sync of unused fields
17. **Convert `RaceGoal.raceType`** to enum
