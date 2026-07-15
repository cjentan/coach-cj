-- CreateTable
CREATE TABLE "garmin_sessions" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "oauth1_token" JSONB NOT NULL,
    "oauth2_token" JSONB NOT NULL,
    "display_name" TEXT,
    "garmin_user_id" INTEGER,
    "last_sync_at" TIMESTAMP(3),
    "last_health_sync_at" TIMESTAMP(3),
    "connected_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "garmin_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "daily_health" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "resting_heart_rate" INTEGER,
    "min_heart_rate" INTEGER,
    "max_heart_rate" INTEGER,
    "sleep_seconds" INTEGER,
    "deep_sleep_seconds" INTEGER,
    "light_sleep_seconds" INTEGER,
    "rem_sleep_seconds" INTEGER,
    "awake_seconds" INTEGER,
    "sleep_score" INTEGER,
    "sleep_start_local" TEXT,
    "sleep_end_local" TEXT,
    "body_battery_min" INTEGER,
    "body_battery_max" INTEGER,
    "avg_stress" INTEGER,
    "max_stress" INTEGER,
    "hrv_balance" INTEGER,
    "hrv_status" TEXT,
    "overnight_hrv" INTEGER,
    "steps" INTEGER,
    "step_goal" INTEGER,
    "raw_data" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "daily_health_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "garmin_sessions_user_id_key" ON "garmin_sessions"("user_id");

-- CreateIndex
CREATE INDEX "daily_health_user_id_date_idx" ON "daily_health"("user_id", "date");

-- CreateIndex
CREATE UNIQUE INDEX "daily_health_user_id_date_key" ON "daily_health"("user_id", "date");

-- AddForeignKey
ALTER TABLE "garmin_sessions" ADD CONSTRAINT "garmin_sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "daily_health" ADD CONSTRAINT "daily_health_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
