/*
  Warnings:

  - You are about to drop the `strava_connections` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "strava_connections" DROP CONSTRAINT "strava_connections_user_id_fkey";

-- AlterTable
ALTER TABLE "weekly_plans" ADD COLUMN     "adjustment_history" JSONB;

-- DropTable
DROP TABLE "strava_connections";
