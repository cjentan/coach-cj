-- CreateIndex
CREATE INDEX "fatigue_alerts_user_id_acknowledged_detected_at_idx" ON "fatigue_alerts"("user_id", "acknowledged", "detected_at");

-- CreateIndex
CREATE INDEX "weekly_plans_user_id_coach_notes_generated_at_idx" ON "weekly_plans"("user_id", "coach_notes", "generated_at");
