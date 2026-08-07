# Development

## Prerequisites

- Node.js 20+
- Docker + Docker Compose (for PostgreSQL and Redis)

## Quick Start (local)

```bash
./deploy-local.sh            # starts db+redis via Docker, runs migrations, starts dev server
```

`deploy-local.sh` runs only the `db` and `redis` Compose services on your host
(ports 5433 and 6380), applies pending Prisma migrations, and starts the Next.js
dev server with hot-reload. Flags:

| Flag | Effect |
|------|--------|
| `--worker` | Also run the BullMQ worker (`npm run worker`) |
| `--services-only` | Start Docker services, then exit |
| `--app-only` | Run the app only (assumes services already up) |
| `--no-migrate` | Skip migrations |
| `--seed` | Seed demo data (`demo@coach.app` / `password123`, admin) |
| `--reset-db` | **Drop all data** and re-seed |
| `--help` | Show usage |

## npm Scripts

| Script | Description |
|--------|-------------|
| `npm run dev` | Next.js dev server |
| `npm run build` | Production build |
| `npm run start` | Production server |
| `npm run worker` | Run BullMQ worker via tsx (`src/workers/entrypoint.ts`) |
| `npm run lint` | `next lint` |
| `npm test` | Vitest unit/integration tests (`vitest run`) |
| `npm run test:watch` | Vitest watch mode |
| `npm run test:coverage` | Vitest with coverage |
| `npm run test:e2e` | Playwright end-to-end tests |
| `npm run test:e2e:ui` | Playwright UI mode |
| `npm run test:e2e:debug` | Playwright debug |
| `npm run db:generate` | `prisma generate` |
| `npm run db:migrate` | `prisma migrate dev` |
| `npm run db:migrate:deploy` | `prisma migrate deploy` |
| `npm run db:seed` | Seed demo data |
| `npm run db:studio` | Prisma Studio |

## Testing

- **Unit/integration tests** (Vitest): 280+ tests across `src/**/__tests__` and
  `src/test/` — parsers, metrics, plan generation, route handlers.
- **Component tests** (Vitest + Testing Library): 50+ across `src/components/`.
- **E2E** (Playwright): auth guards, sign-in flows, activity detail, etc. in `e2e/`.

```bash
npm test                    # all unit/integration
npm run test:e2e            # Playwright
```

## Environment Variables

| Variable | Default | Purpose |
|----------|---------|---------|
| `DATABASE_URL` | `postgresql://coach:coach@localhost:5433/coach` | Prisma connection |
| `REDIS_URL` | `redis://localhost:6380` | BullMQ backing store |
| `NEXTAUTH_URL` | `http://localhost:3000` | NextAuth base URL |
| `NEXTAUTH_SECRET` | dev-only default | Session signing secret |
| `DEEPSEEK_API_KEY` | — | Default LLM provider key (see Settings → AI Coach) |

## Code Layout

- `src/app/[locale]/` — pages (dashboard, activities, training-plan, settings, admin, …)
- `src/app/api/` — route handlers (see [api.md](api.md))
- `src/lib/` — business logic: metrics, parsers, integrations, LLM, workers helpers
- `src/components/` — UI + feature components
- `src/workers/entrypoint.ts` — BullMQ workers + in-process scheduler
- `src/i18n/` — next-intl routing config
- `prisma/schema.prisma` — data model (see [data-model.md](data-model.md))
