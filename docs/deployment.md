# Deployment

The app is self-hosted via Docker Compose on a remote host, reached through a
Tailscale reverse proxy at `https://coach.oryx-everest.ts.net`.

## Services

`docker-compose.yml` defines 5 services:

| Service | Image / build | Notes |
|---------|---------------|-------|
| `app` | `Dockerfile` → `app-runner` | Next.js server, port 3000, memory-limited to 2g |
| `worker` | `Dockerfile` → `worker-runner` | BullMQ workers, compiled to `dist-workers/`, memory-limited to 1.5g |
| `db` | `postgres:16-alpine` | Persistent store in `./data/postgres`, host port 5433 |
| `redis` | `redis:7-alpine` | BullMQ backing store in `./data/redis`, host port 6380 |
| `tailscale` | `tailscale/tailscale` | Reverse proxy + TLS for `coach.oryx-everest.ts.net` |

Volumes: `./data/uploads`, `./data/backups` are shared between app and worker.

## Build

The `Dockerfile` is multi-stage:

1. **deps** — `npm ci` (all deps, `--ignore-scripts`)
2. **builder** — installs canvas system libs, runs `prisma generate`, `npm run
   build`, compiles the worker with `tsc -p tsconfig.worker.json` +
   `tsc-alias`, and collects the obfuscated `@gooin/garmin-connect` dependency
   tree into `garmin-deps`.
3. **app-runner** — uses Next.js `.next/standalone` output (slim image) plus the
   traced `garmin-connect` dist/deps, static assets, and `public/`. Runs
   `prisma migrate deploy` on boot via `docker-entrypoint.sh`.
4. **worker-runner** — copies `dist-workers/`, Prisma client, then prunes
   devDependencies (`npm prune --production`).

## Deploying

### Remote deploy — `./deploy.sh`

Builds images locally, then ships them to the remote Docker host:

| Flag | Effect |
|------|--------|
| *(none)* | Build + deploy via SSH pipe (`docker save` → `docker load`) |
| `--build-only` | Build locally, skip deploy |
| `--skip-build` | Skip build, push existing image |
| `--context` | Use a preconfigured Docker context (`remote-coach`) instead of SSH |
| `--prune` | Prune stale remote images after deploy |
| `--help` | Usage |

Defaults: remote `cjentan@10.9.96.3:/docker-data/coach` via SSH key
`~/.ssh/id_ed25519_docker`. Compose config is rsync'd (excluding `.env`), images
are tagged `coach-app:latest` / `coach-worker:latest`, and `docker compose up -d
--force-recreate` runs on the host.

```bash
./deploy.sh                       # normal deploy
./deploy.sh --build-only          # just build locally
./deploy.sh --skip-build --prune  # push existing image, then clean up stale ones
```

### Local infra — `./deploy-local.sh`

For development: runs only `db` + `redis` via Docker and launches the dev server
on your host. See [development.md](development.md).

## Database Ops

```bash
# Check data on the running container
docker exec coach-db psql -U coach -d coach -c "SELECT COUNT(*) FROM training_logs;"

# Activity type breakdown
docker exec coach-db psql -U coach -d coach \
  -c "SELECT type, COUNT(*) FROM training_logs GROUP BY type;"

# Migrations (run automatically by docker-entrypoint.sh on app boot)
npm run db:migrate:deploy

# Prisma Studio (local)
npm run db:studio
```

Backups and restores are available in-app under **Settings → Data**
(`/api/settings/backup`, `/api/settings/restore`), writing to `./data/backups`.

## Notes

- The `.env` file is local-only and is **not** synced by `deploy.sh`; configure
  production env on the host directly.
- The app entrypoint runs `prisma migrate deploy` before starting, so DB schema
  is applied automatically on deploy.
- The Tailscale service reads its auth config from `/docker-data/homelab-tailscale`
  (host paths) — that setup is external to this repo.
