-- Precomputed trackpoint metrics on TrainingLog.
-- Computed once at ingestion (and backfilled for existing rows) so dashboard
-- chart routes can aggregate these scalars instead of loading full rawJson
-- trackpoint blobs (which can exceed 10MB per activity) into the server heap.
ALTER TABLE "training_logs" ADD COLUMN "zone1_pct" DOUBLE PRECISION;
ALTER TABLE "training_logs" ADD COLUMN "zone2_pct" DOUBLE PRECISION;
ALTER TABLE "training_logs" ADD COLUMN "zone3_pct" DOUBLE PRECISION;
ALTER TABLE "training_logs" ADD COLUMN "zone4_pct" DOUBLE PRECISION;
ALTER TABLE "training_logs" ADD COLUMN "zone5_pct" DOUBLE PRECISION;
ALTER TABLE "training_logs" ADD COLUMN "intensity_analyzed_seconds" INTEGER;
ALTER TABLE "training_logs" ADD COLUMN "decoupling_pct" DOUBLE PRECISION;
ALTER TABLE "training_logs" ADD COLUMN "efficiency_factor" DOUBLE PRECISION;
ALTER TABLE "training_logs" ADD COLUMN "trackpoint_normalized_power" DOUBLE PRECISION;
