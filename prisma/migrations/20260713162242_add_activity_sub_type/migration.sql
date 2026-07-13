-- CreateEnum
CREATE TYPE "ActivitySubType" AS ENUM ('trail_running', 'treadmill', 'virtual_run', 'mountain_biking', 'gravel_cycling', 'road_cycling', 'indoor_cycling', 'virtual_ride', 'handcycle', 'open_water', 'lap_swimming', 'strength_training', 'crossfit', 'yoga', 'elliptical', 'stair_stepper', 'pilates', 'rock_climbing', 'surfing', 'stand_up_paddling', 'kayaking', 'canoeing', 'rowing', 'ice_skating', 'inline_skating', 'nordic_skiing', 'alpine_skiing', 'backcountry_skiing', 'snowboarding', 'snowshoeing', 'soccer', 'tennis', 'golf', 'wheelchair');

-- AlterTable
ALTER TABLE "training_logs" ADD COLUMN     "subType" "ActivitySubType";
