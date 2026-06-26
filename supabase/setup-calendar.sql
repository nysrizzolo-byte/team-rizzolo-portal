-- ============================================================
-- Team Calendar — shared events the team adds themselves.
-- Run once in the Supabase SQL Editor (after setup.sql).
-- Read: any approved employee/admin. Add: approved employee, stamped as self.
-- Edit/Delete: the creator, or any admin.
-- ============================================================

create table if not exists public.events (
  id              uuid primary key default gen_random_uuid(),
  title           text not null,
  event_date      date not null,
  event_time      text,
  category        text not null default 'other',
  notes           text,
  created_by      uuid references auth.users(id) on delete set null,
  created_by_name text,
  created_at      timestamptz not null default now()
);
alter table public.events enable row level security;

drop policy if exists "read events" on public.events;
create policy "read events" on public.events
  for select to authenticated
  using (public.is_approved_employee() or public.is_admin());

drop policy if exists "insert events" on public.events;
create policy "insert events" on public.events
  for insert to authenticated
  with check ((public.is_approved_employee() or public.is_admin()) and created_by = auth.uid());

drop policy if exists "update events" on public.events;
create policy "update events" on public.events
  for update to authenticated
  using (created_by = auth.uid() or public.is_admin())
  with check (created_by = auth.uid() or public.is_admin());

drop policy if exists "delete events" on public.events;
create policy "delete events" on public.events
  for delete to authenticated
  using (created_by = auth.uid() or public.is_admin());

create index if not exists events_date_idx on public.events (event_date);
