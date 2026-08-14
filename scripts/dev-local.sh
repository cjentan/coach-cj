#!/usr/bin/env bash
set -euo pipefail

# Run the Coach app locally without building the full Docker stack.
#
# Only the lightweight infra (postgres + redis) runs as Docker containers;
# the app and worker run natively via node/npm. This avoids the multi-minute
# Docker image build and the production-only tailscale service.
#
#   scripts/dev-local.sh            # infra + migrations + dev server + worker
#   scripts/dev-local.sh --app      # infra + migrations + dev server only
#
# Requires .env with DATABASE_URL / REDIS_URL pointing at the infra ports the
# containers publish (localhost:5433 / localhost:6380), plus NEXTAUTH_SECRET.
#
# Ctrl+C stops the app + worker. The db/redis containers stay up so the next
# run is fast and ./data (postgres, redis, uploads) is preserved.

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

MODE="${1:-}"

# ── Preflight ─────────────────────────────────────────────────
if [[ ! -f .env ]]; then
  echo "ERROR: .env not found — copy one in before running." >&2
  exit 1
fi

if [[ "$MODE" != "" && "$MODE" != "--app" ]]; then
  echo "Usage: $0 [--app]" >&2
  exit 1
fi

if curl -s -o /dev/null http://localhost:3000 2>/dev/null; then
  echo "ERROR: something is already listening on :3000 (a dev server is already running?)." >&2
  exit 1
fi

# ── 1. Infra (postgres + redis) ──────────────────────────────
echo "==> Starting infra containers (db, redis)…"
docker compose up -d db redis

echo "==> Waiting for db + redis to be healthy…"
db="" redis=""
for _ in $(seq 1 30); do
  db="$(docker inspect -f '{{.State.Health.Status}}' coach-db 2>/dev/null || true)"
  redis="$(docker inspect -f '{{.State.Health.Status}}' coach-redis 2>/dev/null || true)"
  [[ "$db" == "healthy" && "$redis" == "healthy" ]] && break
  sleep 1
done
if [[ "$db" != "healthy" || "$redis" != "healthy" ]]; then
  echo "ERROR: infra not healthy (db=$db, redis=$redis)" >&2
  exit 1
fi

# ── 2. Migrations ────────────────────────────────────────────
echo "==> Applying DB migrations…"
npm run db:migrate:deploy

# ── 3. App + worker ──────────────────────────────────────────
if [[ "$MODE" == "--app" ]]; then
  echo "==> Starting dev server on http://localhost:3000 (Ctrl+C to stop)…"
  exec npm run dev
fi

echo "==> Starting dev server + worker (Ctrl+C to stop)…"
DEV_PID=""
WORKER_PID=""
cleanup() {
  echo ""
  echo "==> stopping app + worker…"
  [[ -n "$DEV_PID" ]] && kill "$DEV_PID" 2>/dev/null || true
  [[ -n "$WORKER_PID" ]] && kill "$WORKER_PID" 2>/dev/null || true
  wait 2>/dev/null || true
}
trap cleanup INT TERM EXIT

npm run dev &
DEV_PID=$!

# `npm run worker` does not load .env (tsx doesn't read it), so load it here.
# Without this the worker would silently connect to the wrong DB/redis.
node --env-file=.env --import tsx src/workers/entrypoint.ts &
WORKER_PID=$!

wait
