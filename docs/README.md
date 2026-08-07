# Coach — Documentation

Coach is a self-hosted endurance sports coaching platform. It ingests training data
from Garmin/COROS watches, device files (GPX/TCX/FIT/CSV), and a push API; tracks
race goals; builds periodized weekly training plans; detects fatigue across multiple
physiological signals; and provides an AI coaching chat backed by cloud or local LLMs.

The app supports English, Simplified Chinese, and Traditional Chinese.

---

## Documentation Index

| Doc | What it covers |
|-----|----------------|
| [Architecture](architecture.md) | Containers/services, tech stack, auth, i18n, LLM, design rationale |
| [Data Model](data-model.md) | Prisma models, relations, and enums |
| [Analytics](analytics.md) | PMC (CTL/ATL/TSB), fatigue detection, readiness score, plan generation |
| [API](api.md) | HTTP route reference (auth, ingestion, integrations, dashboard, coach, admin) |
| [Push Activity API](push-api.md) | `POST /api/push/activity` — push GPX/TCX/FIT from a watch or script |
| [Development](development.md) | Local dev setup, scripts, testing |
| [Deployment](deployment.md) | Docker Compose, deploy scripts, environment, database ops |
| [Known Technical Debt](known-debt.md) | Open refactoring items, distilled from the July 2026 bloat audit |

---

## Project Snapshot

- **Framework:** Next.js 14 (App Router, RSC) + TypeScript (strict)
- **Database:** PostgreSQL 16 via Prisma 5
- **Queue:** Redis 7 + BullMQ (fatigue monitor, Sunday review, Garmin/COROS sync, activity analysis)
- **Auth:** NextAuth.js v5 (credentials, JWT sessions, bcrypt)
- **UI:** TailwindCSS + shadcn/ui + Recharts
- **LLM:** OpenAI-compatible abstraction — providers: `openai`, `deepseek` (default), `anthropic`, `ollama`
- **i18n:** next-intl — locales: `en`, `zh-CN`, `zh-TW`

See [architecture.md](architecture.md) for the full picture.
