#!/usr/bin/env bash
set -euo pipefail

# deploy.sh — Build the Coach app locally and deploy to the remote Docker host
#
# Usage:
#   ./deploy.sh                          # normal deploy
#   ./deploy.sh --build-only              # build locally, skip deploy
#   ./deploy.sh --skip-build              # skip build, push existing image
#   ./deploy.sh --context                 # use 'docker --context' instead of SSH pipe
#   ./deploy.sh --prune                   # prune stale Docker images on remote after deploy
#   ./deploy.sh --skip-build --prune      # push existing image, then prune
#   ./deploy.sh --help                    # show this message

REMOTE_USER="cjentan"
REMOTE_HOST="10.9.96.3"
REMOTE_DIR="/docker-data/coach"
SSH_KEY="~/.ssh/id_ed25519_docker"
SSH_CMD="ssh -i $SSH_KEY"
COMPOSE_FILE="docker-compose.yml"
CONTEXT_NAME="remote-coach"

# ── helpers ──────────────────────────────────────────────────────────────────
info()  { printf "\033[1;34m▶\033[0m %s\n" "$*"; }
ok()    { printf "\033[1;32m✓\033[0m %s\n" "$*"; }
err()   { printf "\033[1;31m✗\033[0m %s\n" "$*"; exit 1; }

usage() {
  sed -n '3,10p' "$0" | sed 's/^# \?//'
  exit 0
}

# ── parse flags ──────────────────────────────────────────────────────────────
BUILD=true
DEPLOY=true
USE_CONTEXT=false
PRUNE=false

for arg in "$@"; do
  case "$arg" in
    --build-only)  DEPLOY=false      ;;
    --skip-build)  BUILD=false       ;;
    --context)     USE_CONTEXT=true  ;;
    --prune)       PRUNE=true        ;;
    --help|-h)     usage             ;;
    *)             err "Unknown flag: $arg" ;;
  esac
done

# ── 1. Build ─────────────────────────────────────────────────────────────────
if [ "$BUILD" = true ]; then
  info "Building Docker images..."
  docker compose build
  ok "Build complete"
else
  info "Skipping build"
fi

# ── 2. Deploy ────────────────────────────────────────────────────────────────
if [ "$DEPLOY" = false ]; then
  info "Build-only mode — done"
  exit 0
fi

if [ "$USE_CONTEXT" = true ]; then
  # ── A) Docker context deploy ─────────────────────────────────────────────
  info "Deploying via Docker context \"$CONTEXT_NAME\"..."
  docker compose --context "$CONTEXT_NAME" up -d --build
  ok "Deploy complete (context)"
else
  # ── B) SSH pipe deploy (default) ─────────────────────────────────────────
  info "Syncing config files to $REMOTE_HOST..."
  rsync -avz --exclude '.env' -e "$SSH_CMD" \
    "$COMPOSE_FILE" Dockerfile docker-entrypoint.sh \
    package.json package-lock.json .dockerignore \
    "$REMOTE_USER@$REMOTE_HOST:$REMOTE_DIR/"

  info "Tagging images..."
  docker tag coach-cj-app:latest coach-app:latest 2>/dev/null || true
  docker tag coach-cj-worker:latest coach-worker:latest 2>/dev/null || true

  info "Transferring image to $REMOTE_HOST (this may take a minute)..."
  docker save coach-app:latest | gzip -1 | $SSH_CMD "$REMOTE_USER@$REMOTE_HOST" \
    "docker load && \
     docker tag coach-app:latest coach-worker:latest && \
     cd $REMOTE_DIR && \
     docker compose up -d"

  ok "Deploy complete (SSH pipe)"
fi

# ── 3. Prune stale images ────────────────────────────────────────────
if [ "$PRUNE" = true ]; then
  info "Pruning stale Docker images on $REMOTE_HOST..."
  if [ "$USE_CONTEXT" = true ]; then
    docker --context "$CONTEXT_NAME" image prune -af
    ok "Prune complete (context)"
  else
    $SSH_CMD "$REMOTE_USER@$REMOTE_HOST" "docker image prune -af"
    ok "Prune complete (SSH)"
  fi
fi

# ── 4. Verify ────────────────────────────────────────────────────────────────
info "Verifying deployment..."
if [ "$USE_CONTEXT" = true ]; then
  docker --context "$CONTEXT_NAME" compose ps --format 'table {{.Name}}\t{{.Status}}\t{{.Ports}}'
else
  $SSH_CMD "$REMOTE_USER@$REMOTE_HOST" \
    "cd $REMOTE_DIR && docker compose ps --format 'table {{.Name}}\t{{.Status}}\t{{.Ports}}'"
fi
