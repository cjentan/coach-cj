# Analytics Engine

This doc covers the core training-metrics computation: PMC (CTL/ATL/TSB), fatigue
detection, race readiness, and weekly plan generation. Source modules live in
[`src/lib/`](../src/lib/) (`pmc.ts`, `training-load.ts`, `fatigue-detector.ts`,
`race-readiness.ts`, `plan-generator.ts`, `metrics-snapshot.ts`).

## PMC Model (Performance Management Chart)

Based on Banister's impulse-response model (TrainingPeaks-style), implemented in
[`src/lib/pmc.ts`](../src/lib/pmc.ts).

```
CTL (Fitness) = TSS_today × (1 - e^(-1/42)) + CTL_yesterday × e^(-1/42)
ATL (Fatigue) = TSS_today × (1 - e^(-1/7))  + ATL_yesterday × e^(-1/7)
TSB (Form)    = CTL - ATL
```

- **CTL** — 42-day exponentially weighted moving average of daily TSS
- **ATL** — 7-day EWMA
- **TSB** — positive = fresh/peaking, negative = fatigued/building
- **Ramp rate** — week-over-week CTL change (7-day lookback)
- Rest days are filled in (`fillDailyTss`) so CTL/ATL/TSB decay to reflect
  recovery; missing days are counted as zero-TSS days.
- Initial conditions default to CTL = ATL = 30.

## Fatigue Detection (10 signals)

Runs on-demand / via the fatigue-monitor worker. Each signal contributes a weighted
score (0–100); the aggregate determines severity.

| Signal | Weight | Detects |
|--------|--------|---------|
| TSB Depth | 22% | Current TSB well below zero |
| TSB Duration | 18% | Consecutive days with negative TSB |
| Resting HR Drift | 15% | Resting HR above recent baseline |
| Exercise HR Drift | 10% | HR at same effort above baseline |
| Training Monotony | 8% | stddev/mean of daily TSS high (repetitive loading) |
| Training Strain | 8% | TSS × monotony composite |
| HR-Pace Decoupling | 7% | HR:pace drift within a session |
| Efficiency Decline | 5% | Trackpoint-derived efficiency factor trending down |
| Weight Drift (7-day) | 4% | Unplanned weight loss (under-fueling) |
| Threshold Training Load | 3% | Too much time in the threshold/grey zone |

Severity is derived from the weighted score:

| Score | Severity | Recommended action |
|-------|----------|--------------------|
| ≥ 60 | Critical | Full rest week, resume at 40% volume |
| 35–59 | High | 2–4 rest days, resume at 50–60% volume |
| 18–34 | Medium | Reduce volume 30–40%, prioritize easy efforts |
| < 18 | Low | Continue at current levels |

The output includes a human-readable recommendation and recommended rest days, and
is stored as a `FatigueAlert`.

## Race Readiness (0–100)

Per-goal readiness computed in [`src/lib/race-readiness.ts`](../src/lib/race-readiness.ts),
blending current trajectory against the goal's requirements:

| Component | Weight | Notes |
|-----------|--------|-------|
| Volume progression | 45% | Current weekly volume vs required ramp to hit the goal (peak ≈ 70% of race distance, 4 weeks out) |
| Elevation adherence | 20% | Weekly vert vs race profile (defaults to 15% if no elevation goal) |
| TSB / freshness | ~20% | Higher TSB → more ready |
| Consistency | 15% | % of planned sessions completed |
| Volume adherence | 10% | Actual vs target volume this week |

Interpretation: `≥70` on track, `45–69` needs work, `<45` off track. Output includes
per-goal recommendations (e.g. "add more weekly vert", "prioritize recovery").

## Weekly Plan Generation

Two paths produce a `WeeklyPlan`:

### Deterministic generator — `plan-generator.ts`
`generateWeeklyPlan()` builds a week from goal + recent volume/elevation/duration +
consistency + fatigue:

1. Picks the primary goal (highest priority, then nearest date).
2. Computes **required weekly volume** — a linear ramp peaking at ~70% of race
   distance, 4 weeks out.
3. Analyzes the **trajectory** — linear regression over the last 4 weeks of volume.
4. Applies a **fatigue override** — if severity is high/critical, target volume is
   cut to 40–70% and extra rest days are inserted.
5. Allocates sessions across Mon–Sat (long run on Saturday, then intervals, hill
   repeats, tempo, easy runs; Sunday is rest), and emits human-readable
   `adjustments` ("↑ volume X km above last week", "↓ reduced to 50% — fatigue").

### LLM-assisted path
The AI coach can generate/propose plans conversationally, produce structured plan
proposals for approval, and adjust plans based on user feedback. Proposals are
stored as `CoachSuggestion`s and, when applied, update the `WeeklyPlan`.
The deterministic generator remains the fallback when no LLM is configured.

## Dashboard Metrics

The dashboard loads a single batched snapshot (`/api/dashboard/load`,
[`src/lib/metrics-snapshot.ts`](../src/lib/metrics-snapshot.ts)) that computes PMC,
readiness, fatigue, weekly aggregates, and goal progress in one pass, plus
supplementary endpoints for trackpoint insights, trends, intensity distribution,
PMC history, and the current plan. See [API](api.md).
