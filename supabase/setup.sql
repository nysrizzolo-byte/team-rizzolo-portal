-- ============================================================
-- Team Rizzolo Portal — Auth, Roles & DU Review storage
-- Run once in the Supabase SQL Editor.
--
-- What it sets up:
--   • profiles table: first/last name, email, role, approval status
--   • auto-create a (pending) profile when someone signs in for the first time
--   • RLS so users can only read their own profile
--   • a private "du-review" storage bucket
--   • storage RLS so ONLY approved Employees/Admins can read/write DU files
--
-- Approval workflow: a new sign-in lands as role='pending', status='pending'.
-- An admin (you) approves in the dashboard: set status='approved' and role.
-- ============================================================

-- 1) Profiles ---------------------------------------------------------------
create table if not exists public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  email       text,
  first_name  text,
  last_name   text,
  role        text not null default 'pending'
                check (role in ('pending','employee','partner','admin')),
  status      text not null default 'pending'
                check (status in ('pending','approved','rejected')),
  created_at  timestamptz not null default now()
);

-- 2) Auto-create a profile row on new auth user ----------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, first_name, last_name)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'first_name', ''),
    coalesce(new.raw_user_meta_data->>'last_name', '')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- 3) RLS on profiles: a user can read (and update name on) only their own row
alter table public.profiles enable row level security;

drop policy if exists "read own profile" on public.profiles;
create policy "read own profile" on public.profiles
  for select to authenticated
  using (auth.uid() = id);

-- (role/status are NOT user-updatable; admins change them via the dashboard,
--  which uses the service role and bypasses RLS.)

-- 4) Helper: is the caller an approved employee (or admin)? -----------------
create or replace function public.is_approved_employee()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and p.status = 'approved'
      and p.role in ('employee','admin')
  );
$$;

-- 5) Private DU Review bucket ----------------------------------------------
insert into storage.buckets (id, name, public)
values ('du-review', 'du-review', false)
on conflict (id) do nothing;

-- 6) Storage RLS: only approved Employees/Admins can use the du-review bucket
drop policy if exists "du-review read"   on storage.objects;
drop policy if exists "du-review write"  on storage.objects;
drop policy if exists "du-review delete" on storage.objects;

create policy "du-review read" on storage.objects
  for select to authenticated
  using (bucket_id = 'du-review' and public.is_approved_employee());

create policy "du-review write" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'du-review' and public.is_approved_employee());

create policy "du-review delete" on storage.objects
  for delete to authenticated
  using (bucket_id = 'du-review' and public.is_approved_employee());
