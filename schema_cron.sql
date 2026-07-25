-- =============================================================================
-- Supabase Cron Job Setup for Craftopia Daily Quiz
-- =============================================================================
-- HOW TO USE:
--   1. Open Supabase SQL Editor:
--      https://supabase.com/dashboard/project/pgnxsgysnvrgsbuecesc/sql
--   2. Paste this entire script and click "Run"
--
-- WHAT IT DOES:
--   - Enables pg_cron (job scheduler) and pg_net (HTTP requests) extensions
--   - Schedules the quiz cron to run every minute
--   - The Edge Function handles the 24-hour send throttle via last_completed_at
--   - Expired registrations are also cleaned up on each run
-- =============================================================================

-- 1. Enable required extensions
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- 2. Remove existing job if it already exists (safe re-run)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'craftopia-send-daily-quiz') THEN
    PERFORM cron.unschedule('craftopia-send-daily-quiz');
    RAISE NOTICE 'Existing cron job removed.';
  END IF;
END $$;

-- 3. Schedule the cron job to run every minute
--    The Edge Function uses last_completed_at to throttle sends to once per 24h.
--    Running every minute just ensures we never miss a window.
SELECT cron.schedule(
  'craftopia-send-daily-quiz',
  '* * * * *',   -- every minute
  $$
    SELECT net.http_post(
      url     := 'https://pgnxsgysnvrgsbuecesc.supabase.co/functions/v1/api/cron/send_daily_quiz',
      headers := jsonb_build_object(
        'Content-Type',  'application/json',
        'Authorization', 'Bearer sb_publishable_i1qSlBg5OBbnLpSHuDN4UA_bH6bWAVQ'
      ),
      body    := '{}'::jsonb
    );
  $$
);

-- 4. Verify — should show the job listed below
SELECT
  jobid,
  jobname,
  schedule,
  active
FROM cron.job
WHERE jobname = 'craftopia-send-daily-quiz';
