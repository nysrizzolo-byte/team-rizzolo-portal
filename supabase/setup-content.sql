-- ============================================================
-- Content Library — social-media educational content tracker.
-- Rows = content ideas; filmed_by = checklist of who's filmed it.
-- Run once in the Supabase SQL Editor (after setup.sql).
-- Read/add/edit: any approved employee (collaborative board). Delete: creator or admin.
-- ============================================================

create table if not exists public.content_library (
  id              uuid primary key default gen_random_uuid(),
  title           text not null,            -- the hook / topic
  angle           text,                     -- the non-obvious insight (1-liner)
  category        text,
  status          text not null default 'idea',   -- idea | scripted | filmed | posted
  filmed_by       text[] not null default '{}',   -- names: Theresa, Rich, Felix, Matt, Sal
  written_by      text,
  notes           text,                     -- script / notes
  created_by      uuid references auth.users(id) on delete set null,
  created_by_name text,
  created_at      timestamptz not null default now()
);
alter table public.content_library enable row level security;

drop policy if exists "read content" on public.content_library;
create policy "read content" on public.content_library
  for select to authenticated
  using (public.is_approved_employee() or public.is_admin());

drop policy if exists "insert content" on public.content_library;
create policy "insert content" on public.content_library
  for insert to authenticated
  with check ((public.is_approved_employee() or public.is_admin()) and created_by = auth.uid());

drop policy if exists "update content" on public.content_library;
create policy "update content" on public.content_library
  for update to authenticated
  using (public.is_approved_employee() or public.is_admin())
  with check (public.is_approved_employee() or public.is_admin());

drop policy if exists "delete content" on public.content_library;
create policy "delete content" on public.content_library
  for delete to authenticated
  using (created_by = auth.uid() or public.is_admin());

-- Seed the starter ideas (only if the table is empty)
insert into public.content_library (title, angle, category, created_by_name)
select * from (values
  ('Good credit and still picking FHA?', 'When FHA beats conventional at 95% LTV on the MI + rate math — then strip MI later with a refi.', 'Programs', 'Sal'),
  ('Seller concessions on Long Island without scaring the seller', 'Appraisal-gap + concession contract wording that still protects the seller if value falls short.', 'Negotiation', 'Sal'),
  ('You "won" a 6% credit and your lender took half back', 'Concession caps by program/LTV — how buyers lose credits they negotiated.', 'Negotiation', 'Sal'),
  ('A higher offer can net the seller MORE than a lower one', 'Reframing price + concession around the seller''s NET, with the math.', 'Negotiation', 'Sal'),
  ('Buy a 2-family with 3.5% down and let the tenant qualify you', 'FHA on 2–4 units, rental income, and the 3–4 unit self-sufficiency test.', 'Investment', 'Sal'),
  ('Appraisal came in low — you have four plays, not one', 'Renegotiate / cover the gap / dispute (ROV) / walk — judgment content.', 'Negotiation', 'Sal'),
  ('A $1.1M loan in NY isn''t "jumbo"', 'High-balance vs jumbo locally — and why it changes your options.', 'Programs', 'Sal'),
  ('Rate buydown vs. price cut: which saves you more?', 'The breakeven math on a 2-1 buydown vs a price reduction.', 'Strategy', 'Sal'),
  ('Self-employed and write everything off?', 'When a bank-statement / P&L loan beats an agency loan.', 'Self-employed', 'Sal'),
  ('Your pre-approval isn''t a guarantee', 'The 5 moves that quietly kill it before closing.', 'Process', 'Sal')
) as v(title, angle, category, created_by_name)
where not exists (select 1 from public.content_library);
