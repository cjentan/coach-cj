# Changelog

All notable changes to **Coach** are documented in this file. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

The version is tracked in `package.json` (`APP_VERSION`) and rendered in **Settings → About**.
On each release, bump `package.json#version` and move/add a dated entry below `## [Unreleased]`.

## [Unreleased]

## [1.0.1] - 2026-08-24

### Fixed
- **Readiness no longer bottoms out early in the week**: the race readiness card and the readiness score compared the *partial* current week's volume/elevation against *full-week* targets, so on Monday–Wednesday an otherwise healthy, on-plan athlete scored "behind". Partial-week volume and elevation are now prorated to a 7-day equivalent before scoring (matching the same-day normalization already used for the last-week comparison windows). The projection is additionally capped at 1.2× the athlete's recent 4-week average weekly volume, so a low-frequency (3×/week) trainer isn't over-credited for a single early-week session.
- **AI Coach "this day has already passed" guard**: the coach could no longer edit a **Sunday** (and sometimes other days) in the current week because the check resolved the weekday slot against the week's **Monday** instead of the real date — an off-by-one between the `0=Sunday..6=Saturday` convention and the Monday-anchored week. Editing *Sunday, 23 Aug* therefore reported *"Cannot change Sunday (2026-08-17) — this day has already passed"* (2026-08-17 being the Monday). The guard now maps each slot to its true calendar date, so future days stay editable and genuinely past days are still rejected.
- **Timezone-aware AI coach activity resolution**: the coach chat could miss activities it was asked to analyze because `query_activities` and planned-session matching ran against UTC instants while the user reasoned in their local calendar. The browser-reported timezone offset is now threaded end-to-end, so activity queries and planned-session matches align to the user's local days. The activity detail page's analysis-status poll also no longer spins forever when a job is stuck at "pending" — it stops after 2 minutes and shows a stalled message with a retry button.

## [1.0.0] - 2026-08-21

Baseline release — the first versioned build of Coach.

### Added
- **Versioning**: single source of truth in `package.json`, surfaced in a new **Settings → About** page together with a rendered change log.
- **Training intelligence**: goal-based weekly training plans, fatigue detection across 8 signals (TSB, HR drift, monotony, strain, …), and a 0–100 readiness score.
- **Anchor goals**: each training plan is anchored to the race it was created for, so adding races later no longer drifts the plan's primary goal.
- **AI Coach** with chat, activity analysis, training-phase generation, and a multi-provider LLM backend (OpenAI-compatible endpoints plus DeepInfra).
- **Data import**: Garmin Connect, COROS, GPX, FIT, CSV, Strava export, and manual entry; automatic duplicate detection and resolution.
- **Settings**: profile & appearance, training setup (maximum heart rate / Karvonen HR zones, body metrics, training context), AI coach & LLM configuration, integrations, and data backup/restore/wipe.
- **Admin**: user management, LLM default + per-user configuration, prompt management, and plan-engine settings.
- **Admin review sweep**: a "Run review for all users" action on the Training Plan tab enqueues a full weekly review for every user with an active race goal, deduplicated so a successful review isn't re-run in the same week.
- **Integrations data wipe**: wiping "Integrations" clears Garmin and COROS connection sessions while leaving imported activities intact.
- **Localization**: English, Simplified Chinese (`zh-CN`), and Traditional Chinese (`zh-TW`).

### Changed
- **Faster scheduled syncs**: incremental activity syncs now pass a server-side date window to Garmin/COROS, fetching only the recent slice and cutting a typical sync from ~7.9 MB to ~0.2 MB (~97%) while keeping the client-side cutoff as a safety net.
- **Server backups are single-slot**: each user's backup is stored at a fixed path (`<userId>.tar.gz`), so triggering a new backup overwrites the previous file rather than keeping a version history.
- Training-plan calendar end is now derived from the plan's actual extent, so multi-race plans spanning months render every week instead of truncating at the first race.
- Refactored the AI coach into focused modules (tool definitions, activity analysis, and shared utilities) with no behavior change.
- Adopted ESLint (`next/core-web-vitals`) and Prettier across the codebase.

### Fixed
- **Large backup/restore**: restoring a big history no longer blows the ~536 MB JSON string limit — training-log GPS `raw_json` is written back per-activity in small batches inside one transaction instead of a single giant insert, and `weekly_plans.anchor_goal_id` is now preserved in backups and restores.
- **Plan proposal card** is no longer shown once a plan already exists.

[1.0.0]: https://github.com/cjentan/coach-cj/releases/tag/v1.0.0
