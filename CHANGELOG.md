# Changelog

All notable changes to **Coach** are documented in this file. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

The version is tracked in `package.json` (`APP_VERSION`) and rendered in **Settings → About**.
On each release, bump `package.json#version` and move/add a dated entry below `## [Unreleased]`.

## [Unreleased]

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
- **Localization**: English, Simplified Chinese (`zh-CN`), and Traditional Chinese (`zh-TW`).

### Changed
- Training-plan calendar end is now derived from the plan's actual extent, so multi-race plans spanning months render every week instead of truncating at the first race.
- Refactored the AI coach into focused modules (tool definitions, activity analysis, and shared utilities) with no behavior change.
- Adopted ESLint (`next/core-web-vitals`) and Prettier across the codebase.

[1.0.0]: https://github.com/cjentan/coach-cj/releases/tag/v1.0.0
