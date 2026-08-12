/**
 * Local convenience launcher for the trackpoint-metrics backfill.
 *
 * The canonical script lives at `src/workers/backfill-trackpoint-metrics.ts`
 * so it compiles into `dist-workers` and can be run inside the production
 * worker container with plain node:
 *
 *   docker compose exec worker node --expose-gc --max-old-space-size=1024 \
 *     dist-workers/workers/backfill-trackpoint-metrics.js
 *
 * Run this file locally with tsx:
 *   npx tsx scripts/backfill-trackpoint-metrics.ts
 */

import "../src/workers/backfill-trackpoint-metrics";
