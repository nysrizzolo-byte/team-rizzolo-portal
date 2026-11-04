-- Adds an optional short marketing blurb to each person in the directory, so co-branded
-- materials (e.g. the 203k agent leave-behind) can show a per-person description that
-- travels with whoever is selected. Safe to run repeatedly.
alter table public.marketing_people add column if not exists blurb text;

-- Optional: seed blurbs for the baseline team (edit freely; only fills blanks).
update public.marketing_people set blurb =
  'Runs Long Island''s renovation-lending desk. He''s the one other loan officers call when a file gets hard. 340+ client reviews.'
  where name = 'Salvatore Rizzolo' and (blurb is null or blurb = '');

-- NOTE: "100+ Long Island families financed" is placeholder flavor — swap in Jesse's real number (or delete that sentence) before using in market.
update public.marketing_people set blurb =
  'Turns "that house needs too much work" into closed deals. Jesse walks Long Island buyers and agents through renovation and purchase financing start to finish — pre-approved fast, clear on every number, no surprises at the table. 100+ Long Island families financed.'
  where name = 'Jesse Cone' and (blurb is null or blurb = '');
