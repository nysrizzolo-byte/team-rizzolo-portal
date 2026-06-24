-- ============================================================
-- Branch Protocols — upgrade the guidelines table into a shared,
-- admins-only leadership board (attributed posts), still binding on the AI bots.
-- Run once in the Supabase SQL Editor (after setup-assistant.sql).
-- ============================================================

-- Attribution + dates for the shared board feed.
alter table public.guidelines add column if not exists author_name text;
alter table public.guidelines add column if not exists created_at timestamptz not null default now();

-- READ is now ADMINS ONLY — this is a private leadership board.
-- The AI bots still get every protocol because the edge function reads them
-- server-side with the service-role key (bypasses RLS); non-admin browsers cannot.
drop policy if exists "read guidelines" on public.guidelines;
drop policy if exists "read guidelines (admins only)" on public.guidelines;
create policy "read guidelines (admins only)" on public.guidelines
  for select to authenticated
  using (public.is_admin());

-- WRITE stays admin-only (any admin can post / edit / delete) — unchanged, kept for clarity.
drop policy if exists "admin write guidelines" on public.guidelines;
create policy "admin write guidelines" on public.guidelines
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());
