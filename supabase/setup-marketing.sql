-- ============================================================
-- Marketing people directory — the shared pool of people who appear on
-- marketing material (LEFT + RIGHT). Each row is a person: a team member
-- OR a realtor/referral contact. Both dropdowns read the same list, so
-- anyone can be placed on either side (interchangeable).
-- Read/add/edit: any approved employee (collaborative). Delete: creator or admin.
-- Run once in the Supabase SQL Editor (after setup.sql).
-- ============================================================

create table if not exists public.marketing_people (
  id              uuid primary key default gen_random_uuid(),
  name            text not null,
  title           text,                     -- e.g. "Loan Officer", "Licensed RE Salesperson"
  company         text,                     -- e.g. "NAF", "Keller Williams"
  phone           text,
  email           text,
  nmls            text,                     -- NMLS # (LO) or license # (agent)
  kind            text not null default 'team',  -- 'team' | 'realtor'
  headshot        text,                     -- data URL (optional photo)
  created_by      uuid references auth.users(id) on delete set null,
  created_by_name text,
  updated_at      timestamptz not null default now(),
  created_at      timestamptz not null default now()
);
alter table public.marketing_people enable row level security;

drop policy if exists "read mkt_people" on public.marketing_people;
create policy "read mkt_people" on public.marketing_people
  for select to authenticated
  using (public.is_approved_employee() or public.is_admin());

drop policy if exists "insert mkt_people" on public.marketing_people;
create policy "insert mkt_people" on public.marketing_people
  for insert to authenticated
  with check ((public.is_approved_employee() or public.is_admin()) and created_by = auth.uid());

drop policy if exists "update mkt_people" on public.marketing_people;
create policy "update mkt_people" on public.marketing_people
  for update to authenticated
  using (public.is_approved_employee() or public.is_admin())
  with check (public.is_approved_employee() or public.is_admin());

drop policy if exists "delete mkt_people" on public.marketing_people;
create policy "delete mkt_people" on public.marketing_people
  for delete to authenticated
  using (created_by = auth.uid() or public.is_admin());

grant select, insert, update, delete on public.marketing_people to authenticated;
