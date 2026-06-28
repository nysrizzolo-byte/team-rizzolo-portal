-- ============================================================
-- Academy knowledge base — editable Vocabulary + Acronyms.
-- kind = 'vocab' (term + definition) or 'acronym' (acronym + meaning + note).
-- Run once in the Supabase SQL Editor (after setup.sql).
-- Read/add/edit: any approved employee (collaborative). Delete: creator or admin.
-- ============================================================

create table if not exists public.academy_items (
  id              uuid primary key default gen_random_uuid(),
  kind            text not null default 'vocab',  -- vocab | acronym
  term            text not null,                  -- the word, or the acronym
  definition      text not null,                  -- plain-English meaning
  note            text,                           -- extra context (mainly acronyms)
  sort            int not null default 0,
  created_by      uuid references auth.users(id) on delete set null,
  created_by_name text,
  created_at      timestamptz not null default now()
);
alter table public.academy_items enable row level security;

drop policy if exists "read academy" on public.academy_items;
create policy "read academy" on public.academy_items
  for select to authenticated using (public.is_approved_employee() or public.is_admin());

drop policy if exists "insert academy" on public.academy_items;
create policy "insert academy" on public.academy_items
  for insert to authenticated with check ((public.is_approved_employee() or public.is_admin()) and created_by = auth.uid());

drop policy if exists "update academy" on public.academy_items;
create policy "update academy" on public.academy_items
  for update to authenticated using (public.is_approved_employee() or public.is_admin()) with check (public.is_approved_employee() or public.is_admin());

drop policy if exists "delete academy" on public.academy_items;
create policy "delete academy" on public.academy_items
  for delete to authenticated using (created_by = auth.uid() or public.is_admin());

-- Seed core vocab + acronyms (only if empty)
insert into public.academy_items (kind, term, definition, note, sort, created_by_name)
select * from (values
  ('vocab', 'Amortization', 'How a loan is paid down over time — each payment covers interest first, then principal, so early payments are mostly interest.', null, 1, 'Sal'),
  ('vocab', 'Escrow', 'A neutral third party (or account) that holds money or documents until the deal''s conditions are met.', null, 2, 'Sal'),
  ('vocab', 'Escrow / impound account', 'The account the servicer uses to collect and pay property taxes and insurance along with the monthly payment.', null, 3, 'Sal'),
  ('vocab', 'Underwriting', 'The lender''s risk review of the borrower and property to approve, condition, or deny the loan.', null, 4, 'Sal'),
  ('vocab', 'Appraisal', 'An independent opinion of the property''s value — the loan is based on the LOWER of price or appraised value.', null, 5, 'Sal'),
  ('vocab', 'Pre-qual vs pre-approval', 'Pre-qual is a quick estimate; pre-approval means the file was reviewed and is far stronger to an agent or seller.', null, 6, 'Sal'),
  ('vocab', 'Contingency', 'A contract condition (financing, appraisal, inspection) that lets a party renegotiate or back out if it isn''t met.', null, 7, 'Sal'),
  ('vocab', 'Earnest money', 'The buyer''s good-faith deposit, credited at closing — can be at risk if the buyer backs out outside their contingencies.', null, 8, 'Sal'),
  ('vocab', 'Closing costs', 'The fees to originate and close the loan (lender, title, appraisal, taxes/escrows) — separate from the down payment.', null, 9, 'Sal'),
  ('vocab', 'Discount points', 'Money paid upfront to permanently lower the rate — 1 point = 1% of the loan amount.', null, 10, 'Sal'),
  ('vocab', 'Rate lock', 'Freezing today''s rate and pricing for a set period so a market move can''t raise the payment before closing.', null, 11, 'Sal'),
  ('vocab', 'Reserves', 'Months of housing payments the borrower must have left after closing, as a cushion for hardship.', null, 12, 'Sal'),
  ('vocab', 'Seasoning', 'How long funds have sat in an account (or how long since an event) — seasoned funds don''t need sourcing.', null, 13, 'Sal'),
  ('vocab', 'Gift funds', 'Down-payment or closing money gifted by an eligible donor — needs a gift letter and a paper trail.', null, 14, 'Sal'),
  ('vocab', 'Seller concession', 'A seller-paid credit toward the buyer''s closing costs — capped by program and LTV.', null, 15, 'Sal'),
  ('vocab', 'Buydown', 'Paying to lower the rate: temporary (3-2-1, 2-1) for the first years, or permanent (points) for the life of the loan.', null, 16, 'Sal'),
  ('vocab', 'Recast', 'Re-amortizing the loan after a large principal payment to lower the monthly payment — same rate and term.', null, 17, 'Sal'),
  ('vocab', 'Title insurance', 'Protects the lender (and optionally the buyer) against ownership or lien problems from the property''s past.', null, 18, 'Sal'),
  ('acronym', 'LTV', 'Loan-to-Value', 'Loan ÷ the lesser of price or appraised value. Drives PMI and pricing.', 101, 'Sal'),
  ('acronym', 'DTI', 'Debt-to-Income', 'Monthly debts ÷ gross monthly income.', 102, 'Sal'),
  ('acronym', 'PITI', 'Principal, Interest, Taxes & Insurance', 'The full monthly housing payment.', 103, 'Sal'),
  ('acronym', 'AUS', 'Automated Underwriting System', 'The engine that returns the recommendation — DU or LPA.', 104, 'Sal'),
  ('acronym', 'DU', 'Desktop Underwriter', 'Fannie Mae''s AUS.', 105, 'Sal'),
  ('acronym', 'LPA', 'Loan Product Advisor', 'Freddie Mac''s AUS.', 106, 'Sal'),
  ('acronym', 'PMI', 'Private Mortgage Insurance', 'On conventional loans above 80% LTV; cancels at 80%.', 107, 'Sal'),
  ('acronym', 'MIP', 'Mortgage Insurance Premium', 'FHA''s mortgage insurance; often for the life of the loan.', 108, 'Sal'),
  ('acronym', 'UFMIP', 'Upfront Mortgage Insurance Premium', 'FHA''s 1.75% upfront MI, usually financed into the loan.', 109, 'Sal'),
  ('acronym', 'APR', 'Annual Percentage Rate', 'Rate plus certain costs — the "true" yearly cost.', 110, 'Sal'),
  ('acronym', 'CTC', 'Clear to Close', 'Underwriting''s green light to schedule closing.', 111, 'Sal'),
  ('acronym', 'LE', 'Loan Estimate', 'Standardized cost disclosure due within 3 business days of application.', 112, 'Sal'),
  ('acronym', 'CD', 'Closing Disclosure', 'Final costs; the borrower must have it 3 business days before closing.', 113, 'Sal'),
  ('acronym', 'COE', 'Certificate of Eligibility', 'Proves VA loan entitlement.', 114, 'Sal'),
  ('acronym', 'EMD', 'Earnest Money Deposit', 'The buyer''s good-faith deposit.', 115, 'Sal'),
  ('acronym', 'HOI', 'Homeowner''s Insurance', 'Property insurance that must be active at closing.', 116, 'Sal'),
  ('acronym', 'ARM', 'Adjustable-Rate Mortgage', 'A loan whose rate adjusts after a fixed period.', 117, 'Sal'),
  ('acronym', 'TBD', 'To Be Determined approval', 'A pre-underwritten approval without a property yet — makes an offer cash-competitive.', 118, 'Sal')
) as v(kind, term, definition, note, sort, created_by_name)
where not exists (select 1 from public.academy_items);
