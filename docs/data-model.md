# Data Model

Source of truth: [`prisma/schema.prisma`](../prisma/schema.prisma). All user-owned
tables have a `userId` foreign key to `User` and every API query scopes by the
session user.

## Overview

```
User
├── GarminSession         (1:1)
├── CorosSession          (1:1)
├── TrainingLog[]         (1:N)
├── DuplicateGroup[]      (1:N)
├── RaceGoal[]            (1:N)
├── BodyMetric[]          (1:N)
├── DailyHealth[]         (1:N)
├── WeeklyAssessment[]    (1:N)
├── WeeklyPlan[]          (1:N)
├── FatigueAlert[]        (1:N)
├── AnalysisReport[]      (1:N)
├── ApiKey[]              (1:N)
├── CoachConversation[]   (1:N)
└── CoachSuggestion[]     (1:N)

AppSetting                (global key/value, no userId)
```

## Core Entities

### User
Email, name, bcrypt password hash, `role` (`user`/`admin`). Holds per-user config:
LLM settings, weekly review schedule (`reviewDayOfWeek`, `reviewTime`,
`reviewDayOfMonth`), analysis trigger (`weekly` / `every_n_days`), `trainingContext`
free-text, `dashboardPrefs` JSON, and `locale`.

### TrainingLog
A single activity. Uniquely identified by `(userId, externalId, source)`.
Sources: `strava` (CSV export), `garmin`, `coros`, `manual`, `watch_push`.
Carries duration/distance/elevation/HR/power/calories, computed TSS, and optional
`simplifiedTrackPoints` (JSON) with track bounding-box columns for map queries.
Supports duplicate merging (`duplicateGroupId`, `mergedIntoId`), subtype,
workout-type classification, race flag, and LLM `coachAnalysis`.

### DuplicateGroup
Groups `TrainingLog`s detected as duplicates (pending / resolved_merged /
resolved_keep_both) with `keptActivityId` and resolution note.

### RaceGoal
Target race with name, `raceType` (free text, e.g. marathon/ultra), target date,
distance, elevation, target time, priority (A/B/C), status (active/completed/
cancelled), notes, `goalStatement`, and `courseProfile` JSON.

### BodyMetric
Recorded weight/height/resting HR as a time-series (`recordedAt`), used for
fatigue drift signals.

### DailyHealth
Daily health snapshot synced from Garmin/COROS: resting/max HR, sleep stages,
sleep score, Body Battery, stress, HRV, steps. One row per `(userId, date)`.

### WeeklyAssessment
Snapshot of readiness for a week: CTL/ATL/TSB (`acute`/`chronic`/`tsb`), readiness
score, fitness/fatigue/form scores, weekly volume/elevation/duration aggregates,
per-goal progress %, recommendations, and raw data.

### WeeklyPlan
Auto-generated plan for a week: target volume/elevation/duration, `plannedSessions`
(JSON array), human-readable `adjustments`, `trajectoryAssessment`, optional LLM
`coachNotes`, and `adjustmentHistory`. One per `(userId, weekStartDate)`.

### FatigueAlert
Raised when fatigue signals cross thresholds: severity (low/medium/high/critical),
contributing `signals` JSON, recommendation, recommended rest days, acknowledged flag.

### Integration Sessions
- **GarminSession** — Garmin OAuth1 + OAuth2 tokens (JSON), display name, Garmin user
  ID, last activity sync + health sync timestamps.
- **CorosSession** — COROS access token, COROS user ID, last sync.

### Analysis & AI Coach
- **AnalysisReport** — record of a generated analysis (`reportType`,
  `triggeredBy`, input snapshot, output content, reasoning, metrics).
- **CoachConversation** — an AI coach thread with `contextSnapshot` JSON.
- **CoachMessage** — one message in a conversation (role, content, token count).
- **CoachSuggestion** — a proposed plan change from the coach (type, title,
  description, `changes` JSON, status: pending/applied).

### ApiKey
Hashed API keys (`keyPrefix` + `keyHash`) for the push API and external clients.

### AppSetting
Global key/value app settings (admin-editable, e.g. LLM prompts, email settings).

## Enums

| Enum | Values |
|------|--------|
| `ActivityType` | run, ride, swim, hike, walk, workout, other |
| `ActivitySubType` | 30+ subtypes (trail_running, road_cycling, open_water, strength_training, …) |
| `ActivitySource` | strava, garmin, manual, watch_push, coros |
| `AnalysisStatus` | pending, processing, completed, failed |
| `DuplicateStatus` | pending, resolved_merged, resolved_keep_both |
| `GoalStatus` | active, completed, cancelled |
| `GoalPriority` | A, B, C |
| `AlertSeverity` | low, medium, high, critical |

## Historical Note

Earlier versions of the schema had `StravaConnection`, `TrainingFacility`, and
`TrainingAvailability` models. These were removed: Strava is now ingested via CSV
export rather than OAuth, and facilities/scheduling were replaced by a free-text
`trainingContext` field on `User`.
