create table if not exists public.stip_closed (
  deal_id     text not null,
  person      text not null,
  deal_name   text,
  late_points int  not null default 0,
  completed   int  not null default 0,
  no_due      int  not null default 0,
  closed_at   date,
  captured_at timestamptz not null default now(),
  primary key (deal_id, person)
);
alter table public.stip_closed enable row level security;
drop policy if exists stip_closed_admin_read on public.stip_closed;
create policy stip_closed_admin_read on public.stip_closed for select
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin' and p.status = 'approved'));
