-- ============================================================
-- Marketing material CATALOG + PERSISTENCE
-- One row per piece of marketing material. Two jobs:
--   1) PERSISTENCE ("the trail"): while Create Material builds a piece with AI,
--      the project autosaves here (status='draft'). If the tab closes or the
--      page won't load, nothing is lost — anyone with access reopens it and
--      picks up where it left off (collaborative, like the people directory).
--   2) CATALOG: a finished piece is filed away (status='saved') under its
--      material type. Already-done files (a finished PDF/deck/image) can also
--      be dropped in (source='upload') and filed the same way.
--
-- Audience: Create Material is an ADMIN pilot in the UI, but RLS mirrors the
-- people directory (any approved employee or admin) so that when Sal opens the
-- feature to the team, no server change is needed. Delete: creator or admin.
-- Run once in the Supabase SQL Editor (after setup.sql + setup-marketing.sql).
-- ============================================================

create table if not exists public.marketing_materials (
  id              uuid primary key default gen_random_uuid(),
  title           text not null default 'Untitled',
  material_type   text not null default 'one-pager',  -- one-pager|slideshow|social|openhouse|signin|other
  status          text not null default 'draft',       -- 'draft' (in-progress trail) | 'saved' (filed in catalog)
  source          text not null default 'ai',           -- 'ai' (built here) | 'upload' (dropped-in finished file)
  left_person     jsonb,                                 -- snapshot {id,name,title,company,phone,email,nmls,headshot}
  right_person    jsonb,
  front_html      text,                                  -- AI-built draft (front side)
  back_html       text,                                  -- AI-built draft (back side, one-pagers)
  chat_history    jsonb,                                 -- the conversation that produced it
  file_path       text,                                  -- storage path (source='upload')
  file_name       text,
  file_type       text,
  created_by      uuid references auth.users(id) on delete set null default auth.uid(),
  created_by_name text,
  updated_by_name text,
  updated_at      timestamptz not null default now(),
  created_at      timestamptz not null default now()
);
alter table public.marketing_materials enable row level security;

create index if not exists marketing_materials_updated_idx on public.marketing_materials (updated_at desc);
create index if not exists marketing_materials_status_idx  on public.marketing_materials (status, material_type);

drop policy if exists "read mkt_mat" on public.marketing_materials;
create policy "read mkt_mat" on public.marketing_materials
  for select to authenticated
  using (public.is_approved_employee() or public.is_admin());

drop policy if exists "insert mkt_mat" on public.marketing_materials;
create policy "insert mkt_mat" on public.marketing_materials
  for insert to authenticated
  with check ((public.is_approved_employee() or public.is_admin()) and created_by = auth.uid());

drop policy if exists "update mkt_mat" on public.marketing_materials;
create policy "update mkt_mat" on public.marketing_materials
  for update to authenticated
  using (public.is_approved_employee() or public.is_admin())
  with check (public.is_approved_employee() or public.is_admin());

drop policy if exists "delete mkt_mat" on public.marketing_materials;
create policy "delete mkt_mat" on public.marketing_materials
  for delete to authenticated
  using (created_by = auth.uid() or public.is_admin());

grant select, insert, update, delete on public.marketing_materials to authenticated;

-- ---- Storage bucket for dropped-in finished files (private) ----
insert into storage.buckets (id, name, public)
values ('marketing-files', 'marketing-files', false)
on conflict (id) do nothing;

drop policy if exists "mkt_files read"   on storage.objects;
create policy "mkt_files read" on storage.objects
  for select to authenticated
  using (bucket_id = 'marketing-files' and (public.is_approved_employee() or public.is_admin()));

drop policy if exists "mkt_files insert" on storage.objects;
create policy "mkt_files insert" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'marketing-files' and (public.is_approved_employee() or public.is_admin()));

drop policy if exists "mkt_files update" on storage.objects;
create policy "mkt_files update" on storage.objects
  for update to authenticated
  using (bucket_id = 'marketing-files' and (public.is_approved_employee() or public.is_admin()))
  with check (bucket_id = 'marketing-files' and (public.is_approved_employee() or public.is_admin()));

drop policy if exists "mkt_files delete" on storage.objects;
create policy "mkt_files delete" on storage.objects
  for delete to authenticated
  using (bucket_id = 'marketing-files' and (public.is_approved_employee() or public.is_admin()));
