-- Reset stuck "pending" analysis statuses where no analysis was ever completed.
-- These were set during activity creation but never processed by the worker
-- (e.g., large batch imports that skipped the queue).
UPDATE training_logs
SET analysis_status = NULL
WHERE analysis_status = 'pending'
  AND (coach_analysis IS NULL OR coach_analysis = '');
