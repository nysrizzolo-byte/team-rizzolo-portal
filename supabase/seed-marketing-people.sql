-- Seed the marketing people directory with the Team Rizzolo loan officers (baseline),
-- reusing the exact same headshots the Pre-Approval letter uses (pa-assets/*.png).
-- Idempotent: only seeds when the table is empty.
insert into public.marketing_people (name, title, company, phone, email, nmls, kind, headshot, created_by_name)
select * from (values
  ('James Codomo',      'Licensed Loan Officer Assistant', 'NAF', '631.889.7075',   'James.Codomo@nafinc.com',    '1737350', 'team', 'https://nysrizzolo-byte.github.io/team-rizzolo-portal/pa-assets/james.png',   'Baseline (pre-approval roster)'),
  ('Salvatore Rizzolo', 'Branch Manager',                  'NAF', '(631) 946-0654', 'sal.rizzolo@nafinc.com',     '1489171', 'team', 'https://nysrizzolo-byte.github.io/team-rizzolo-portal/pa-assets/sal.png',     'Baseline (pre-approval roster)'),
  ('Theresa Feehan',    'Senior Loan Officer',             'NAF', '(631) 521-5667', 'theresa.feehan@nafinc.com',  '1903644', 'team', 'https://nysrizzolo-byte.github.io/team-rizzolo-portal/pa-assets/theresa.png', 'Baseline (pre-approval roster)'),
  ('Yhma Karimy',       'Senior Loan Officer',             'NAF', '631.357.0085',   'yhma.karimy@nafinc.com',     '2128896', 'team', 'https://nysrizzolo-byte.github.io/team-rizzolo-portal/pa-assets/yhma.png',    'Baseline (pre-approval roster)'),
  ('Richard Luxmore',   'Loan Consultant',                 'NAF', '(631) 769-2445', 'Richard.Luxmore@nafinc.com', '2021785', 'team', 'https://nysrizzolo-byte.github.io/team-rizzolo-portal/pa-assets/rich.png',    'Baseline (pre-approval roster)'),
  ('Felix Diaz',        'Senior Loan Officer',             'NAF', '(347) 605-9840', 'felix.diaz@nafinc.com',      '1848197', 'team', 'https://nysrizzolo-byte.github.io/team-rizzolo-portal/pa-assets/felix.png',   'Baseline (pre-approval roster)')
) as v(name, title, company, phone, email, nmls, kind, headshot, created_by_name)
where not exists (select 1 from public.marketing_people);
