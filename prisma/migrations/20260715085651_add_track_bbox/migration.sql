-- AlterTable
ALTER TABLE "training_logs" ADD COLUMN     "track_max_lat" DOUBLE PRECISION,
ADD COLUMN     "track_max_lng" DOUBLE PRECISION,
ADD COLUMN     "track_min_lat" DOUBLE PRECISION,
ADD COLUMN     "track_min_lng" DOUBLE PRECISION;

-- CreateIndex
CREATE INDEX "training_logs_user_id_track_min_lat_track_max_lat_idx" ON "training_logs"("user_id", "track_min_lat", "track_max_lat");

-- CreateIndex
CREATE INDEX "training_logs_user_id_track_min_lng_track_max_lng_idx" ON "training_logs"("user_id", "track_min_lng", "track_max_lng");
