#!/usr/bin/env bash
set -euo pipefail

# deploy-local.sh — Run the Coach app locally using Docker-managed infra services
#
# Starts PostgreSQL and Redis via Docker (without the app/worker containers),
# runs any pending database migrations, and launches the Next.js dev server
# on your host machine with hot-reload.
#
# Prerequisites:
#   - Docker & Docker Compose installed and running
#   - Node.js 20+ installed
#
# Usage:
#   ./deploy-local.sh                          # default: start services + run app
#   ./deploy-local.sh --worker                 # also start the background worker
#   ./deploy-local.sh --services-only          # only start Docker services, then exit
#   ./deploy-local.sh --app-only               # only run the app (assumes services up)
#   ./deploy-local.sh --no-migrate             # skip database migrations
#   ./deploy-local.sh --seed                   # seed demo data (demo@coach.app / password123)
#   ./deploy-local.sh --reset-db               # reset database (drops all data!) and re-seed
#   ./deploy-local.sh --help                   # show this message

# ── container names ──────────────────────────────────────────────────────────────
DB_CONTAINER="coach-db"
REDIS_CONTAINER="coach-redis"

# Map of compose service → container name (extracted from docker-compose.yml).
# We run only db + redis via compose, but use plain `docker exec` for readiness
# checks to avoid compose evaluating the full file (which references files that
# may not exist on this machine, e.g. the tailscale env file).

# ── helpers ──────────────────────────────────────────────────────────────────────
info()  { printf "\033[1;34m▶\033[0m %s\n" "$*"; }
ok()    { printf "\033[1;32m✓\033[0m %s\n" "$*"; }
warn()  { printf "\033[1;33m⚠\033[0m %s\n" "$*"; }
err()   { printf "\033[1;31m✗\033[0m %s\n" "$*"; exit 1; }

usage() {
  sed -n '6,22p' "$0" | sed 's/^# \?//'
  exit 0
}

# ── parse flags ──────────────────────────────────────────────────────────────────
RUN_SERVICES=true
RUN_APP=true
RUN_WORKER=false
RUN_MIGRATE=true
SEED_DB=false
RESET_DB=false

for arg in "$@"; do
  case "$arg" in
    --worker)        RUN_WORKER=true     ;;
    --services-only) RUN_APP=false       ;;
    --app-only)      RUN_SERVICES=false  ;;
    --no-migrate)    RUN_MIGRATE=false   ;;
    --seed)          SEED_DB=true        ;;
    --reset-db)      RESET_DB=true       ;;
    --help|-h)       usage               ;;
    *)               err "Unknown flag: $arg" ;;
  esac
done

# ── guardrails ───────────────────────────────────────────────────────────────────
command -v docker &>/dev/null || err "Docker is not installed"
command -v node   &>/dev/null || err "Node.js is not installed"

NODE_VERSION=$(node -v | sed 's/v//' | cut -d. -f1)
[ "$NODE_VERSION" -ge 20 ] || err "Node.js 20+ required (found v$NODE_VERSION)"

# ── 1. Docker infra services ────────────────────────────────────────────────────
if [ "$RUN_SERVICES" = true ]; then
  info "Starting Docker infra services (db, redis)..."
  docker compose -f docker-compose.yml up -d db redis 2>/dev/null || \
    docker compose up -d db redis 2>/dev/null || \
    err "Failed to start Docker services. Is Docker running and docker-compose.yml present?"

  info "Waiting for PostgreSQL to be ready..."
  for i in $(seq 1 30); do
    if docker exec "$DB_CONTAINER" pg_isready -U coach &>/dev/null; then
      ok "PostgreSQL is ready"
      break
    fi
    [ "$i" -eq 30 ] && err "PostgreSQL did not become ready in time"
    sleep 1
  done

  info "Waiting for Redis to be ready..."
  for i in $(seq 1 15); do
    if docker exec "$REDIS_CONTAINER" redis-cli ping 2>/dev/null | grep -q PONG; then
      ok "Redis is ready"
      break
    fi
    [ "$i" -eq 15 ] && err "Redis did not become ready in time"
    sleep 1
  done

  ok "Docker infra services are running"
fi

# ── 2. Reset database (optional) ─────────────────────────────────────────────────
if [ "$RESET_DB" = true ]; then
  warn "Resetting database — this will DROP ALL DATA!"
  npx prisma db push --force-reset
  npx prisma db seed
  ok "Database reset and seeded"
  RUN_MIGRATE=false  # push already handled by force-reset
fi

# ── 3. Prisma generate + migrate ─────────────────────────────────────────────────
if [ "$RUN_MIGRATE" = true ]; then
  info "Generating Prisma client..."
  npx prisma generate

  info "Pushing schema to database..."
  npx prisma db push
  ok "Schema is up to date"
fi

# ── 4. Seed demo data (optional) ────────────────────────────────────────────────
if [ "$SEED_DB" = true ] && [ "$RESET_DB" = false ]; then
  info "Seeding demo data..."
  npx prisma db seed
  ok "Demo data seeded"
fi

# ── 5. Exit if services-only mode ────────────────────────────────────────────────
if [ "$RUN_APP" = false ]; then
  ok "Infra services are running. Start the app manually with:  npm run dev"
  exit 0
fi

# ── 6. Start the app (and optionally the worker) ─────────────────────────────────
info "Starting Next.js dev server..."

if [ "$RUN_WORKER" = true ]; then
  info "Also starting background worker..."
  # Start worker in background, kill it when this script exits
  npx tsx src/workers/entrypoint.ts &
  WORKER_PID=$!
  trap "kill $WORKER_PID 2>/dev/null; exit" INT TERM EXIT
  ok "Worker started (PID $WORKER_PID)"
fi

npm run dev
