-- CreateEnum
CREATE TYPE "DuplicateStatus" AS ENUM ('pending', 'resolved_merged', 'resolved_keep_both');

-- AlterEnum
ALTER TYPE "ActivitySource" ADD VALUE 'watch_push';

-- AlterTable
ALTER TABLE "training_logs" ADD COLUMN     "duplicate_group_id" TEXT,
ADD COLUMN     "duplicate_status" "DuplicateStatus",
ADD COLUMN     "merged_into_id" TEXT;

-- CreateTable
CREATE TABLE "training_log_facilities" (
    "training_log_id" TEXT NOT NULL,
    "facility_id" TEXT NOT NULL,
    "assigned_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "training_log_facilities_pkey" PRIMARY KEY ("training_log_id","facility_id")
);

-- CreateTable
CREATE TABLE "duplicate_groups" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "status" "DuplicateStatus" NOT NULL DEFAULT 'pending',
    "resolution" TEXT,
    "kept_activity_id" TEXT,
    "merged_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "duplicate_groups_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "duplicate_groups_user_id_status_idx" ON "duplicate_groups"("user_id", "status");

-- CreateIndex
CREATE INDEX "training_logs_duplicate_group_id_idx" ON "training_logs"("duplicate_group_id");

-- CreateIndex
CREATE INDEX "training_logs_merged_into_id_idx" ON "training_logs"("merged_into_id");

-- AddForeignKey
ALTER TABLE "training_logs" ADD CONSTRAINT "training_logs_duplicate_group_id_fkey" FOREIGN KEY ("duplicate_group_id") REFERENCES "duplicate_groups"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "training_logs" ADD CONSTRAINT "training_logs_merged_into_id_fkey" FOREIGN KEY ("merged_into_id") REFERENCES "training_logs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "training_log_facilities" ADD CONSTRAINT "training_log_facilities_training_log_id_fkey" FOREIGN KEY ("training_log_id") REFERENCES "training_logs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "training_log_facilities" ADD CONSTRAINT "training_log_facilities_facility_id_fkey" FOREIGN KEY ("facility_id") REFERENCES "training_facilities"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "duplicate_groups" ADD CONSTRAINT "duplicate_groups_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
