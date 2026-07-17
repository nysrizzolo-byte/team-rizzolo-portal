-- Quick Asks — lightweight person-to-person to-dos that live in the portal rail.
-- NOT for deal work (that stays in monday: stips/conditions). This is for quick asks
-- like "call the title company back" that today evaporate in texts.
--
-- Model: one row per ask. The assignee checks it off; each side clears their OWN copy
-- (cleared_by_creator / cleared_by_assignee), so an ask stays on the asker's board until
-- THEY erase it — they get to see it was actually done first.

create table if not exists public.todos (
  id uuid primary key default gen_random_uuid(),
  created_by uuid not null references auth.users(id) on delete cascade,
  created_by_name text,
  assignee_id uuid not null references auth.users(id) on delete cascade,
  assignee_name text,
  body text not null,
  note text not null default '',
  done boolean not null default false,
  done_at timestamptz,
  cleared_by_creator boolean not null default false,
  cleared_by_assignee boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists todos_assignee_idx on public.todos (assignee_id);
create index if not exists todos_creator_idx on public.todos (created_by);

alter table public.todos enable row level security;

-- You can only ever see an ask you sent or received.
drop policy if exists "todos read own" on public.todos;
create policy "todos read own" on public.todos
  for select using (auth.uid() = created_by or auth.uid() = assignee_id);

-- You can only create an ask as yourself.
drop policy if exists "todos insert own" on public.todos;
create policy "todos insert own" on public.todos
  for insert with check (auth.uid() = created_by);

-- Either side can update (assignee checks off; both can add the shared note; each clears their own copy).
drop policy if exists "todos update own" on public.todos;
create policy "todos update own" on public.todos
  for update using (auth.uid() = created_by or auth.uid() = assignee_id);

-- Team roster for the assignee picker. profiles RLS is read-own/admin-only, so a plain
-- select can't list teammates — this SECURITY DEFINER fn returns ONLY id/name/role for
-- approved team members (never partners, never emails), and only to approved staff.
create or replace function public.team_roster()
returns table (id uuid, name text, role text)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not (public.is_approved_employee() or public.is_admin()) then
    raise exception 'not authorized';
  end if;
  return query
    select p.id,
           nullif(trim(coalesce(p.first_name,'') || ' ' || coalesce(p.last_name,'')), '') as name,
           p.role
    from public.profiles p
    where p.status = 'approved'
      and p.role in ('employee','admin','bizdev')
    order by 2;
end;
$$;

revoke all on function public.team_roster() from public, anon;
grant execute on function public.team_roster() to authenticated;
