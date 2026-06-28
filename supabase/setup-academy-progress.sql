-- ============================================================
-- Academy per-user progress: flashcard mastery (per level) + games completed.
-- Each user reads/writes only their own rows; admins can read everyone's (for the Admin tab).
-- Run in the Supabase SQL Editor. Click "Run without RLS" if the linter pops.
-- ============================================================

create table if not exists public.academy_progress (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  user_name  text,
  scope      text not null,                  -- 'level' | 'game'
  key        text not null,                  -- '1'..'4' for levels; "type:title" for games
  mastered   jsonb not null default '[]'::jsonb,  -- array of mastered card ids (levels only)
  total      int  not null default 0,        -- denominator
  completed  boolean not null default false,
  updated_at timestamptz not null default now(),
  unique (user_id, scope, key)
);
alter table public.academy_progress enable row level security;

drop policy if exists "read own or admin academy_progress" on public.academy_progress;
create policy "read own or admin academy_progress" on public.academy_progress
  for select to authenticated using (user_id = auth.uid() or public.is_admin());

drop policy if exists "insert own academy_progress" on public.academy_progress;
create policy "insert own academy_progress" on public.academy_progress
  for insert to authenticated with check (user_id = auth.uid() and (public.is_approved_employee() or public.is_admin()));

drop policy if exists "update own academy_progress" on public.academy_progress;
create policy "update own academy_progress" on public.academy_progress
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
