-- Adds an optional short marketing blurb to each person in the directory, so co-branded
-- materials (e.g. the 203k agent leave-behind) can show a per-person description that
-- travels with whoever is selected. Safe to run repeatedly.
alter table public.marketing_people add column if not exists blurb text;

-- Optional: seed blurbs for the baseline team (edit freely; only fills blanks).
update public.marketing_people set blurb =
  'Runs Long Island''s renovation-lending desk. He''s the one other loan officers call when a file gets hard. 340+ client reviews.'
  where name = 'Salvatore Rizzolo' and (blurb is null or blurb = '');

update public.marketing_people set blurb =
  'Jesse makes renovation and purchase financing simple for Long Island buyers and agents — fast pre-approvals, straight answers, and a real plan for the homes other lenders won''t touch.'
  where name = 'Jesse Cone' and (blurb is null or blurb = '');
