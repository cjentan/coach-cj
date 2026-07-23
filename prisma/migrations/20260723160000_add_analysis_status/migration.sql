-- CreateEnum
CREATE TYPE "AnalysisStatus" AS ENUM ('pending', 'processing', 'completed', 'failed');

-- AlterTable
ALTER TABLE "training_logs" ADD COLUMN "analysis_status" "AnalysisStatus";
