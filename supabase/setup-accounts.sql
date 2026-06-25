-- ============================================================
-- Admin account management (Accounts tab in the Admin panel).
-- Lets any admin read every profile and approve / set clearance / revoke.
-- Run once in the Supabase SQL Editor (after setup.sql).
-- "read own profile" stays in place for non-admins; these are additive (OR'd).
-- is_admin() is SECURITY DEFINER (bypasses RLS) so there is no recursion.
-- ============================================================

drop policy if exists "admin read all profiles" on public.profiles;
create policy "admin read all profiles" on public.profiles
  for select to authenticated
  using (public.is_admin());

drop policy if exists "admin update profiles" on public.profiles;
create policy "admin update profiles" on public.profiles
  for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());
