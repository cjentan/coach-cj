-- AlterTable
ALTER TABLE "race_goals" ADD COLUMN     "goal_statement" TEXT;

-- AlterTable
ALTER TABLE "training_logs" ADD COLUMN     "workout_type" TEXT;

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "analysis_trigger" TEXT NOT NULL DEFAULT 'weekly',
ADD COLUMN     "analysis_trigger_value" INTEGER NOT NULL DEFAULT 1;

-- CreateTable
CREATE TABLE "analysis_reports" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "report_type" TEXT NOT NULL,
    "triggered_by" TEXT NOT NULL,
    "input_snapshot" JSONB,
    "output_content" TEXT,
    "reasoning" JSONB,
    "metrics" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "analysis_reports_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "analysis_reports_user_id_created_at_idx" ON "analysis_reports"("user_id", "created_at" DESC);

-- AddForeignKey
ALTER TABLE "analysis_reports" ADD CONSTRAINT "analysis_reports_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
