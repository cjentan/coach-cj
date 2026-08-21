-- Backfill WeeklyPlan.anchor_goal_id for existing plans.
--
-- The anchor is the race a plan was created around, but it was never persisted
-- before this column existed, so existing plans have anchor_goal_id = NULL and
-- would fall back to the old (drifting) goals[0] until regenerated. This sets
-- the anchor on each user's ACTIVE plan to their current primary active goal,
-- mirroring the exact ordering the app uses:
--   1. primary goal = active races ordered by priority ASC, then target_date ASC
--      (prisma GoalPriority enum order is A,B,C so 'A' < 'B' < 'C').
--   2. active plan   = earliest week with week_start_date >= current week
--      (Postgres date_trunc('week', ...) = Monday), else the most recent plan.
-- Idempotent: only touches plans whose anchor_goal_id IS NULL.

-- Primary active goal per user (rank 1 == app's goals[0]).
WITH ranked_goal AS (
  SELECT rg.user_id,
         rg.id AS goal_id,
         row_number() OVER (
           PARTITION BY rg.user_id
           ORDER BY rg.priority ASC, rg.target_date ASC, rg.id ASC
         ) AS rn
  FROM race_goals rg
  WHERE rg.status = 'active'
),
-- Active plan per user: earliest current/future week, else most recent plan.
active_plan AS (
  SELECT wp.user_id, wp.id, wp.week_start_date
  FROM weekly_plans wp
  JOIN (
    SELECT user_id, min(week_start_date) AS ws
    FROM weekly_plans
    WHERE week_start_date >= date_trunc('week', CURRENT_DATE)
    GROUP BY user_id
  ) f ON f.user_id = wp.user_id AND f.ws = wp.week_start_date
  WHERE wp.anchor_goal_id IS NULL

  UNION ALL

  SELECT wp.user_id, wp.id, wp.week_start_date
  FROM weekly_plans wp
  JOIN (
    SELECT user_id, max(week_start_date) AS ws
    FROM weekly_plans
    WHERE week_start_date < date_trunc('week', CURRENT_DATE)
    GROUP BY user_id
  ) p ON p.user_id = wp.user_id AND p.ws = wp.week_start_date
  WHERE wp.anchor_goal_id IS NULL
    AND NOT EXISTS (
      SELECT 1 FROM weekly_plans f
      WHERE f.user_id = wp.user_id
        AND f.week_start_date >= date_trunc('week', CURRENT_DATE)
    )
)
UPDATE weekly_plans wp
SET anchor_goal_id = rg.goal_id
FROM active_plan ap
JOIN ranked_goal rg ON rg.user_id = ap.user_id AND rg.rn = 1
WHERE wp.id = ap.id;
