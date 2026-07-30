# Stage 1: Install ALL dependencies (including devDependencies for building)
FROM node:20-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts

# Stage 2: Build
FROM node:20-slim AS builder
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends \
    openssl \
    libcairo2-dev libpango1.0-dev libjpeg-dev libgif-dev librsvg2-dev \
    build-essential pkg-config \
    && rm -rf /var/lib/apt/lists/*

# Layer 1: Copy deps (only invalidated when package.json/lock changes)
COPY --from=deps /app/node_modules ./node_modules

# Layer 2: Copy Prisma schema & generate client (only invalidated when schema changes)
COPY prisma ./prisma
RUN npx prisma generate

# Rebuild native modules (canvas was skipped by --ignore-scripts in deps stage)
RUN npm rebuild canvas

# Layer 3: Copy source & build (invalidated on any source change)
COPY . .
RUN npm run build
# Compile worker TypeScript for the background job container
RUN npx tsc -p tsconfig.worker.json
# Resolve @/* path aliases to relative paths so the compiled JS
# runs with plain node (tsc preserves aliases in output)
RUN npx tsc-alias -p tsconfig.worker.json
# Collect garmin-connect's full npm dependency tree (obfuscated code means
# every require() for an external package is invisible to the standalone
# trace). Recursively follows transitive deps from the full node_modules.
RUN mkdir -p /app/garmin-deps && node -e "\
const {readFileSync, existsSync, cpSync, mkdirSync} = require('fs');\
const {join, dirname} = require('path');\
const seen = new Set();\
function copyTree(name) {\
  if (seen.has(name)) return;\
  const src = join('/app/node_modules', name);\
  if (!existsSync(join(src, 'package.json'))) return;\
  seen.add(name);\
  const dst = join('/app/garmin-deps/node_modules', name);\
  mkdirSync(dirname(dst), {recursive: true});\
  cpSync(src, dst, {recursive: true, force: true});\
  Object.keys(\
    JSON.parse(readFileSync(join(src, 'package.json'), 'utf-8')).dependencies || {}\
  ).forEach(copyTree);\
}\
Object.keys(JSON.parse(readFileSync(\
  '/app/node_modules/@gooin/garmin-connect/package.json', 'utf-8'\
)).dependencies || {}).forEach(copyTree);\
console.log('collected ' + seen.size + ' garmin dep packages');\
"

# Stage 3a: App runner — Next.js standalone output with traced node_modules only
FROM node:20-slim AS app-runner
WORKDIR /app
ENV NODE_ENV=production
RUN apt-get update && apt-get install -y --no-install-recommends \
    openssl \
    libcairo2 libpango-1.0-0 libpangocairo-1.0-0 libgif7 librsvg2-2 libjpeg62-turbo \
    && rm -rf /var/lib/apt/lists/*

# Next.js standalone output — includes a traced node_modules (62 MB) with
# only the packages the server actually needs at runtime (prisma client +
# engine, canvas, react, next, bcryptjs, etc.). This replaces the previous
# 740 MB full node_modules copy, saving ~680 MB in the final image.
COPY --from=builder /app/.next/standalone ./

# @gooin/garmin-connect is fully obfuscated — every file uses dynamically-
# constructed require() paths that Next.js's static trace (@vercel/nft)
# cannot follow. Its dist subdirectories AND its npm dependency packages
# (axios, qs, lodash, etc.) all get dropped from the standalone output.
# Copy the full dist directory and the pre-collected dependency tree.
COPY --from=builder \
  /app/node_modules/@gooin/garmin-connect/dist \
  ./node_modules/@gooin/garmin-connect/dist
COPY --from=builder /app/garmin-deps/node_modules ./node_modules

# Static assets (CSS/JS chunks) — not inside .next/standalone, the server
# resolves them relative to cwd as `.next/static/`
COPY --from=builder /app/.next/static ./.next/static

# Public assets (favicon, manifest, icons, etc.)
COPY --from=builder /app/public ./public

# Prisma migration files (needed by prisma migrate deploy in entrypoint)
COPY --from=builder /app/prisma ./prisma

# Install prisma CLI globally so the entrypoint can run migrations.
# Pin to v5 to match the project's Prisma version — v7 dropped datasource.url support in schema.
RUN npm install -g prisma@5

COPY docker-entrypoint.sh ./
RUN chmod +x docker-entrypoint.sh

RUN mkdir -p /app/data && chmod 777 /app/data
USER node
EXPOSE 3000
ENV PORT=3000
ENTRYPOINT ["./docker-entrypoint.sh"]

# Stage 3b: Worker runner — production-pruned node_modules for background jobs
FROM node:20-slim AS worker-runner
WORKDIR /app
ENV NODE_ENV=production
RUN apt-get update && apt-get install -y --no-install-recommends \
    openssl \
    && rm -rf /var/lib/apt/lists/*

# Worker compiled output
COPY --from=builder /app/dist-workers ./dist-workers

# Prisma for DB access
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma

# All dependencies, then strip devDependencies (typescript, tailwindcss,
# @types, etc.) — only production deps like bullmq, ioredis, @prisma/client
# survive for the worker runtime.
COPY --from=builder /app/package.json ./
COPY --from=builder /app/node_modules ./node_modules
RUN npm prune --production

USER node
ENTRYPOINT ["node", "dist-workers/workers/entrypoint.js"]
