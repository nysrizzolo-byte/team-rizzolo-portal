-- ============================================================
-- AI Assistant — program guidelines (reference) + chat transcripts
-- Run once in the Supabase SQL Editor (after setup.sql).
-- ============================================================

-- Helper: is the caller an approved admin? -----------------------------------
create or replace function public.is_admin()
returns boolean
language sql security definer set search_path = public stable
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.status = 'approved' and p.role = 'admin'
  );
$$;

-- 1) Guidelines: admin-managed program reference the assistant draws on -------
create table if not exists public.guidelines (
  id          uuid primary key default gen_random_uuid(),
  title       text not null,
  content     text not null,
  created_by  uuid references auth.users(id) on delete set null,
  updated_at  timestamptz not null default now()
);
alter table public.guidelines enable row level security;

drop policy if exists "read guidelines" on public.guidelines;
create policy "read guidelines" on public.guidelines
  for select to authenticated
  using (public.is_approved_employee());

drop policy if exists "admin write guidelines" on public.guidelines;
create policy "admin write guidelines" on public.guidelines
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- 2) Chat logs: full transcripts (who, which file, every message) -------------
create table if not exists public.chat_logs (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid references auth.users(id) on delete set null,
  user_name        text,
  conversation_id  uuid,
  file_name        text,
  role             text not null check (role in ('user','assistant')),
  content          text not null,
  created_at       timestamptz not null default now()
);
alter table public.chat_logs enable row level security;

-- a user can log their own messages
drop policy if exists "insert own chat" on public.chat_logs;
create policy "insert own chat" on public.chat_logs
  for insert to authenticated
  with check (auth.uid() = user_id);

-- a user reads their own; an admin reads everyone's (for transcripts)
drop policy if exists "read own or admin" on public.chat_logs;
create policy "read own or admin" on public.chat_logs
  for select to authenticated
  using (auth.uid() = user_id or public.is_admin());
