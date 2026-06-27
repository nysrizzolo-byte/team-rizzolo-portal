-- ============================================================
-- Usage tracking — one row per tool action, for the Admin Usage tab.
-- Run once in the Supabase SQL Editor (after setup.sql).
-- Insert: any signed-in user logs their own actions. Read: admins only.
-- ============================================================

create table if not exists public.usage_log (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid references auth.users(id) on delete set null,
  user_name  text,
  action     text not null,   -- doc_review | assistant | monday_push | doc_organizer | pdf_split | academy | visit
  detail     text,
  created_at timestamptz not null default now()
);
alter table public.usage_log enable row level security;

drop policy if exists "insert own usage" on public.usage_log;
create policy "insert own usage" on public.usage_log
  for insert to authenticated
  with check (auth.uid() = user_id);

drop policy if exists "read usage (admin)" on public.usage_log;
create policy "read usage (admin)" on public.usage_log
  for select to authenticated
  using (public.is_admin());

create index if not exists usage_log_created_idx on public.usage_log (created_at);
