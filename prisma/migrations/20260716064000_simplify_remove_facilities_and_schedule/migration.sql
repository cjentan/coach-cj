-- DropForeignKey
ALTER TABLE "training_availability" DROP CONSTRAINT "training_availability_user_id_fkey";

-- DropForeignKey
ALTER TABLE "training_facilities" DROP CONSTRAINT "training_facilities_user_id_fkey";

-- DropForeignKey
ALTER TABLE "training_log_facilities" DROP CONSTRAINT "training_log_facilities_facility_id_fkey";

-- DropForeignKey
ALTER TABLE "training_log_facilities" DROP CONSTRAINT "training_log_facilities_training_log_id_fkey";

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "training_context" TEXT;

-- DropTable
DROP TABLE "training_availability";

-- DropTable
DROP TABLE "training_facilities";

-- DropTable
DROP TABLE "training_log_facilities";

-- DropEnum
DROP TYPE "FacilityType";

-- DropEnum
DROP TYPE "SurfaceType";

