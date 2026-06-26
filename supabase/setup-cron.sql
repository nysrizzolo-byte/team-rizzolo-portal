-- ============================================================
-- Daily monday.com → Team Calendar sync (pg_cron + pg_net).
-- Runs the monday-sync edge function every morning at 11:00 UTC (~7am ET).
-- Run once in the Supabase SQL Editor (after the monday-sync function is deployed).
-- ============================================================

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- remove a prior schedule of the same name if it exists (ignore error if not)
do $$
begin
  perform cron.unschedule('monday-sync-daily');
exception when others then null;
end $$;

select cron.schedule(
  'monday-sync-daily',
  '0 11 * * *',
  $$
    select net.http_post(
      url     := 'https://dbgpjcglemwfhrttxnyh.supabase.co/functions/v1/monday-sync',
      headers := '{"Content-Type":"application/json"}'::jsonb,
      body    := '{}'::jsonb
    );
  $$
);
