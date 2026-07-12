-- CreateEnum
CREATE TYPE "ActivityType" AS ENUM ('run', 'ride', 'swim', 'hike', 'walk', 'workout', 'other');

-- CreateEnum
CREATE TYPE "ActivitySource" AS ENUM ('strava', 'garmin', 'manual');

-- CreateEnum
CREATE TYPE "GoalStatus" AS ENUM ('active', 'completed', 'cancelled');

-- CreateEnum
CREATE TYPE "GoalPriority" AS ENUM ('A', 'B', 'C');

-- CreateEnum
CREATE TYPE "FacilityType" AS ENUM ('road', 'trail', 'track', 'trainer', 'pool', 'gym');

-- CreateEnum
CREATE TYPE "SurfaceType" AS ENUM ('tarmac', 'gravel', 'trail', 'track', 'treadmill', 'trainer');

-- CreateEnum
CREATE TYPE "AlertSeverity" AS ENUM ('low', 'medium', 'high', 'critical');

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "strava_connections" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "strava_user_id" BIGINT NOT NULL,
    "access_token" TEXT NOT NULL,
    "refresh_token" TEXT NOT NULL,
    "token_expires_at" TIMESTAMP(3) NOT NULL,
    "last_sync_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "strava_connections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "training_logs" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "external_id" TEXT,
    "source" "ActivitySource" NOT NULL DEFAULT 'strava',
    "type" "ActivityType" NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "start_date" TIMESTAMP(3) NOT NULL,
    "duration_seconds" INTEGER NOT NULL,
    "distance_meters" DOUBLE PRECISION,
    "elevation_gain_meters" DOUBLE PRECISION,
    "average_hr" DOUBLE PRECISION,
    "max_hr" DOUBLE PRECISION,
    "average_power" DOUBLE PRECISION,
    "normalized_power" DOUBLE PRECISION,
    "calories" DOUBLE PRECISION,
    "tss" DOUBLE PRECISION,
    "raw_json" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "training_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "race_goals" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "race_type" TEXT NOT NULL,
    "target_date" TIMESTAMP(3) NOT NULL,
    "distance_meters" DOUBLE PRECISION NOT NULL,
    "elevation_gain_meters" DOUBLE PRECISION,
    "target_time_seconds" INTEGER,
    "priority" "GoalPriority" NOT NULL DEFAULT 'B',
    "status" "GoalStatus" NOT NULL DEFAULT 'active',
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "race_goals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "training_facilities" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "FacilityType" NOT NULL,
    "distance_meters" DOUBLE PRECISION,
    "elevation_gain_meters" DOUBLE PRECISION,
    "surface" "SurfaceType",
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "training_facilities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "body_metrics" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "recorded_at" TIMESTAMP(3) NOT NULL,
    "weight_kg" DOUBLE PRECISION NOT NULL,
    "height_cm" DOUBLE PRECISION,
    "resting_hr" DOUBLE PRECISION,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "body_metrics_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "training_availability" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "day_of_week" INTEGER NOT NULL,
    "start_time" TEXT NOT NULL,
    "end_time" TEXT NOT NULL,
    "facility_ids" TEXT[],
    "notes" TEXT,
    "effective_from" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "training_availability_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "weekly_assessments" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "week_start_date" TIMESTAMP(3) NOT NULL,
    "acute_training_load" DOUBLE PRECISION,
    "chronic_training_load" DOUBLE PRECISION,
    "tsb" DOUBLE PRECISION,
    "readiness_score" INTEGER,
    "fitness_score" DOUBLE PRECISION,
    "fatigue_score" DOUBLE PRECISION,
    "form_score" DOUBLE PRECISION,
    "weekly_volume_meters" DOUBLE PRECISION,
    "weekly_elevation_meters" DOUBLE PRECISION,
    "weekly_duration_seconds" INTEGER,
    "goal_progress_pct" JSONB,
    "recommendations" TEXT[],
    "raw_data" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "weekly_assessments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "weekly_plans" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "week_start_date" TIMESTAMP(3) NOT NULL,
    "generated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "target_volume_meters" DOUBLE PRECISION,
    "target_elevation_meters" DOUBLE PRECISION,
    "target_duration_seconds" INTEGER,
    "planned_sessions" JSONB NOT NULL,
    "adjustments" TEXT[],
    "trajectory_assessment" TEXT,
    "coach_notes" TEXT,
    "overrides_existing" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "weekly_plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fatigue_alerts" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "detected_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "severity" "AlertSeverity" NOT NULL,
    "signals" JSONB NOT NULL DEFAULT '[]',
    "recommendation" TEXT NOT NULL,
    "recommended_rest_days" INTEGER NOT NULL DEFAULT 0,
    "acknowledged" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fatigue_alerts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "strava_connections_user_id_key" ON "strava_connections"("user_id");

-- CreateIndex
CREATE INDEX "training_logs_user_id_start_date_idx" ON "training_logs"("user_id", "start_date");

-- CreateIndex
CREATE UNIQUE INDEX "training_logs_user_id_external_id_source_key" ON "training_logs"("user_id", "external_id", "source");

-- CreateIndex
CREATE INDEX "race_goals_user_id_status_idx" ON "race_goals"("user_id", "status");

-- CreateIndex
CREATE INDEX "body_metrics_user_id_recorded_at_idx" ON "body_metrics"("user_id", "recorded_at");

-- CreateIndex
CREATE INDEX "training_availability_user_id_day_of_week_idx" ON "training_availability"("user_id", "day_of_week");

-- CreateIndex
CREATE UNIQUE INDEX "weekly_assessments_user_id_week_start_date_key" ON "weekly_assessments"("user_id", "week_start_date");

-- CreateIndex
CREATE UNIQUE INDEX "weekly_plans_user_id_week_start_date_key" ON "weekly_plans"("user_id", "week_start_date");

-- CreateIndex
CREATE INDEX "fatigue_alerts_user_id_detected_at_idx" ON "fatigue_alerts"("user_id", "detected_at");

-- AddForeignKey
ALTER TABLE "strava_connections" ADD CONSTRAINT "strava_connections_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "training_logs" ADD CONSTRAINT "training_logs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "race_goals" ADD CONSTRAINT "race_goals_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "training_facilities" ADD CONSTRAINT "training_facilities_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "body_metrics" ADD CONSTRAINT "body_metrics_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "training_availability" ADD CONSTRAINT "training_availability_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "weekly_assessments" ADD CONSTRAINT "weekly_assessments_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "weekly_plans" ADD CONSTRAINT "weekly_plans_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fatigue_alerts" ADD CONSTRAINT "fatigue_alerts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
