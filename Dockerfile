# Stage 1: Install ALL dependencies (including devDependencies for building)
FROM node:20-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts

# Stage 2: Build
FROM node:20-slim AS builder
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*

# Layer 1: Copy deps (only invalidated when package.json/lock changes)
COPY --from=deps /app/node_modules ./node_modules

# Layer 2: Copy Prisma schema & generate client (only invalidated when schema changes)
COPY prisma ./prisma
RUN npx prisma generate

# Layer 3: Copy source & build (invalidated on any source change)
COPY . .
RUN npm run build
# Compile worker TypeScript for the background job container
RUN npx tsc -p tsconfig.worker.json

# Stage 3: Runner
FROM node:20-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
RUN apt-get update && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*

# Next.js standalone output
COPY --from=builder /app/public ./public
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static

# Compiled worker (from tsc)
COPY --from=builder /app/dist-workers ./dist-workers

# Prisma client
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma

# Full node_modules for worker dependencies (bullmq, ioredis, etc.)
COPY --from=builder /app/node_modules ./node_modules

# Entrypoint script (runs prisma migrate before starting)
COPY docker-entrypoint.sh ./
RUN chmod +x docker-entrypoint.sh

# Ensure the data directory is writable for the geocode cache
RUN mkdir -p /app/data && chmod 777 /app/data

USER node
EXPOSE 3000
ENV PORT=3000
ENTRYPOINT ["./docker-entrypoint.sh"]
