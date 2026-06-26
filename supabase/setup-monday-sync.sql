-- ============================================================
-- monday.com → Team Calendar sync support.
-- Adds source/external_id/synced_at to events so the sync job can
-- upsert (dedupe), update moved dates, and remove stale entries.
-- Run once in the Supabase SQL Editor (after setup-calendar.sql).
-- ============================================================

alter table public.events add column if not exists source      text not null default 'manual';
alter table public.events add column if not exists external_id text;
alter table public.events add column if not exists synced_at   timestamptz;

-- one calendar row per monday item (NULLs allowed for manual events)
create unique index if not exists events_external_id_key on public.events (external_id);
