-- ============================================================
-- Marketing people directory — update 2026-11-02
--   • Remove Rich Luxmore
--   • Add Elvis Regis as TWO entries: (L) NAF loan consultant, (R) Remax realtor
--   • Add Jesse Cone (team, loan consultant)
--   • Add Matt Porcaro as TWO entries: (L) Senior Loan Officer, (R) Renovation Specialist
-- Inserts are idempotent (skip if a row with that exact name already exists).
-- No license #s / headshots provided — left blank; headshots can be dropped in
-- later via the tool (Add person → edit → Headshot). Run once in the Supabase SQL Editor.
-- ============================================================

-- 1) Remove Rich Luxmore (any spelling of the name)
delete from public.marketing_people where name ilike '%luxmore%';

-- 2) Add the new entries
insert into public.marketing_people (name, title, company, phone, email, nmls, kind, created_by_name)
select * from (values
  ('Elvis Regis (L)',  'Loan Consultant',      'New American Funding',    '631.835.2299', 'Elvis.Regis@naf.com', null, 'team',    'Added 2026-11-02'),
  ('Elvis Regis (R)',  null,                   'Remax Integrity Leaders', '631.835.2299', 'elvisregis1@gmail.com', null, 'realtor', 'Added 2026-11-02'),
  ('Jesse Cone',       'Loan Consultant',      'New American Funding',    '631.766.6298', 'jesse.cone@naf.com',  null, 'team',    'Added 2026-11-02'),
  ('Matt Porcaro (L)', 'Senior Loan Officer',  'New American Funding',    '516.865.2334', 'matt.porcaro@naf.com', null, 'team',   'Added 2026-11-02'),
  ('Matt Porcaro (R)', 'Renovation Specialist','New American Funding',    '516.865.2334', 'matt.porcaro@naf.com', null, 'team',   'Added 2026-11-02')
) as v(name, title, company, phone, email, nmls, kind, created_by_name)
where not exists (select 1 from public.marketing_people p where p.name = v.name);

-- 3) Attach headshots (circular PNGs hosted in pa-assets). Safe to run whether the
--    rows were just inserted above or already existed from an earlier run.
update public.marketing_people set headshot = 'https://nysrizzolo-byte.github.io/team-rizzolo-portal/pa-assets/jesse.png'
  where name = 'Jesse Cone';
update public.marketing_people set headshot = 'https://nysrizzolo-byte.github.io/team-rizzolo-portal/pa-assets/matt.png'
  where name in ('Matt Porcaro (L)', 'Matt Porcaro (R)');
update public.marketing_people set headshot = 'https://nysrizzolo-byte.github.io/team-rizzolo-portal/pa-assets/elvis.png'
  where name in ('Elvis Regis (L)', 'Elvis Regis (R)');

-- sanity check: list the directory after
-- select name, kind, company, title, phone, email, (headshot is not null) as has_photo from public.marketing_people order by kind, name;
