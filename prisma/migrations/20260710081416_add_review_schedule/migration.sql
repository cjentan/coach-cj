-- AlterTable
ALTER TABLE "users" ADD COLUMN     "review_day_of_week" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "review_time" TEXT NOT NULL DEFAULT '18:00';
