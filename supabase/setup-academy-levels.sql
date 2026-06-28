-- ============================================================
-- Academy: add difficulty level (1-4) + level the existing terms + load a big batch.
-- Run in the Supabase SQL Editor. If the linter pops a modal, click "Run without RLS".
-- Dollar-quoted ($$...$$) so apostrophes are safe. Inserts skip terms already present.
-- ============================================================

alter table public.academy_items add column if not exists level int not null default 1;

-- Level the existing seeded terms (Level 1 stays default).
update public.academy_items set level = 2 where term in
  ('Amortization','Escrow / impound account','Contingency','Discount points','Rate lock','Reserves','Gift funds','Seller concession','Title insurance','AUS','DU','LPA','MIP','APR','CTC','LE','CD','HOI');
update public.academy_items set level = 3 where term in
  ('Seasoning','Buydown','Recast','UFMIP','COE','ARM','TBD');

insert into public.academy_items (kind, term, definition, note, level, sort, created_by_name)
select v.kind, v.term, v.definition, v.note, v.level, v.sort, v.created_by_name
from (values
  -- ── Level 1 — Foundations ──
  ('vocab', $$FHA loan$$, $$A government-insured loan with low down payments (3.5%) and flexible credit — popular with first-time buyers.$$, null, 1, 20, $$Sal$$),
  ('vocab', $$Conventional loan$$, $$A loan not backed by a government agency; follows Fannie/Freddie guidelines. Strong credit usually pays less.$$, null, 1, 21, $$Sal$$),
  ('vocab', $$VA loan$$, $$A loan guaranteed by the VA for eligible veterans and service members — often $0 down and no monthly MI.$$, null, 1, 22, $$Sal$$),
  ('vocab', $$USDA loan$$, $$A government loan for eligible rural/suburban properties and low-to-moderate income — often $0 down.$$, null, 1, 23, $$Sal$$),
  ('vocab', $$Down payment$$, $$The cash the buyer puts toward the price upfront; the rest is financed.$$, null, 1, 24, $$Sal$$),
  ('vocab', $$Principal$$, $$The amount actually borrowed (the loan balance), separate from interest.$$, null, 1, 25, $$Sal$$),
  ('vocab', $$Interest$$, $$The cost of borrowing, charged as a percentage of the outstanding balance.$$, null, 1, 26, $$Sal$$),
  ('vocab', $$Fixed-rate mortgage$$, $$A loan whose rate and principal-and-interest payment stay the same for the whole term.$$, null, 1, 27, $$Sal$$),
  ('vocab', $$Loan term$$, $$The length of the loan — usually 30 or 15 years.$$, null, 1, 28, $$Sal$$),
  ('vocab', $$Credit score$$, $$A number (300-850) summarizing credit risk; drives eligibility and pricing.$$, null, 1, 29, $$Sal$$),
  ('vocab', $$Mortgage$$, $$A loan secured by real estate — the property is the collateral.$$, null, 1, 30, $$Sal$$),
  ('vocab', $$Refinance$$, $$Replacing your current mortgage with a new one — for a better rate, term, or cash out.$$, null, 1, 31, $$Sal$$),
  ('vocab', $$Equity$$, $$The portion of the home you own — value minus what you owe.$$, null, 1, 32, $$Sal$$),
  ('vocab', $$Closing$$, $$The final step where documents are signed and the loan funds.$$, null, 1, 33, $$Sal$$),
  ('acronym', $$FICO$$, $$Fair Isaac Corporation (credit score)$$, $$The credit score lenders rely on; drives eligibility and pricing.$$, 1, 34, $$Sal$$),
  -- ── Level 2 — Building Blocks ──
  ('vocab', $$Origination fee$$, $$The lender's charge to process and originate the loan.$$, null, 2, 40, $$Sal$$),
  ('vocab', $$Underwriting conditions$$, $$Items underwriting requires before issuing the final approval.$$, null, 2, 41, $$Sal$$),
  ('vocab', $$Escrow waiver$$, $$Paying taxes and insurance yourself instead of through an escrow account — allowed at lower LTVs.$$, null, 2, 42, $$Sal$$),
  ('vocab', $$Float-down$$, $$An option to take a lower rate if the market improves after you've locked.$$, null, 2, 43, $$Sal$$),
  ('vocab', $$Promissory note$$, $$The borrower's legal promise to repay the loan.$$, null, 2, 44, $$Sal$$),
  ('vocab', $$Lock period$$, $$How long the rate lock lasts — e.g., 30, 45, or 60 days.$$, null, 2, 45, $$Sal$$),
  ('vocab', $$Front-end vs back-end DTI$$, $$Housing-only ratio vs total-debt ratio — programs cap each.$$, null, 2, 46, $$Sal$$),
  ('vocab', $$Lender credit$$, $$The lender pays some closing costs in exchange for a slightly higher rate.$$, null, 2, 47, $$Sal$$),
  ('acronym', $$VOE$$, $$Verification of Employment$$, $$Employer confirmation of job and income — written or verbal.$$, 2, 48, $$Sal$$),
  ('acronym', $$VOD$$, $$Verification of Deposit$$, $$Bank confirmation of account balances and history.$$, 2, 49, $$Sal$$),
  ('acronym', $$CLTV$$, $$Combined Loan-to-Value$$, $$All liens ÷ value — used when there's a second mortgage or HELOC.$$, 2, 50, $$Sal$$),
  ('acronym', $$HOA$$, $$Homeowners Association$$, $$Community body that charges dues and sets rules; dues count in DTI.$$, 2, 51, $$Sal$$),
  ('acronym', $$LLPA$$, $$Loan-Level Price Adjustment$$, $$Risk-based pricing hits on conventional loans by FICO and LTV.$$, 2, 52, $$Sal$$),
  -- ── Level 3 — Applied ──
  ('vocab', $$High-balance loan$$, $$A conventional loan above the standard conforming limit but within the high-cost-area ceiling.$$, null, 3, 60, $$Sal$$),
  ('vocab', $$Jumbo loan$$, $$A loan above the conforming/high-balance limit — stricter guidelines, often held in portfolio.$$, null, 3, 61, $$Sal$$),
  ('vocab', $$Conforming loan limit$$, $$The max loan Fannie/Freddie will buy; set annually by the FHFA.$$, null, 3, 62, $$Sal$$),
  ('vocab', $$FHA self-sufficiency test$$, $$For FHA 3-4 unit, the rents must cover the payment by a set margin.$$, null, 3, 63, $$Sal$$),
  ('vocab', $$Amendatory clause$$, $$FHA/VA addendum letting the buyer cancel if the appraised value comes in low.$$, null, 3, 64, $$Sal$$),
  ('vocab', $$Subordination$$, $$Re-ordering lien priority so a refinanced first mortgage stays ahead of an existing second.$$, null, 3, 65, $$Sal$$),
  ('vocab', $$Escrow analysis$$, $$The annual review that adjusts your escrow payment for tax and insurance changes.$$, null, 3, 66, $$Sal$$),
  ('vocab', $$Gift of equity$$, $$Buying from family below market — the equity difference counts as the down payment.$$, null, 3, 67, $$Sal$$),
  ('vocab', $$Non-occupant co-borrower$$, $$A co-borrower who won't live in the home but helps the file qualify.$$, null, 3, 68, $$Sal$$),
  ('vocab', $$Title commitment$$, $$The title company's promise to insure, listing the requirements and exceptions to clear.$$, null, 3, 69, $$Sal$$),
  ('acronym', $$MCC$$, $$Mortgage Credit Certificate$$, $$A tax credit for a portion of mortgage interest for eligible buyers.$$, 3, 70, $$Sal$$),
  ('acronym', $$PIW$$, $$Property Inspection Waiver$$, $$AUS waives the appraisal on eligible loans (an appraisal waiver).$$, 3, 71, $$Sal$$),
  ('acronym', $$POA$$, $$Power of Attorney$$, $$Authorization for someone to sign on a borrower's behalf — needs lender approval.$$, 3, 72, $$Sal$$),
  -- ── Level 4 — Advanced / Niche ──
  ('acronym', $$HPML$$, $$Higher-Priced Mortgage Loan$$, $$A loan whose APR exceeds a threshold — triggers escrow and appraisal rules.$$, 4, 80, $$Sal$$),
  ('acronym', $$HOEPA$$, $$Home Ownership & Equity Protection Act$$, $$High-cost-loan protections and limits.$$, 4, 81, $$Sal$$),
  ('acronym', $$HECM$$, $$Home Equity Conversion Mortgage$$, $$The FHA reverse mortgage.$$, 4, 82, $$Sal$$),
  ('vocab', $$Reverse mortgage$$, $$A loan for 62+ that converts equity to cash with no monthly payment — repaid when the home is sold.$$, null, 4, 83, $$Sal$$),
  ('vocab', $$Non-QM loan$$, $$A loan outside the Qualified Mortgage rules — bank-statement, DSCR, asset-depletion, etc.$$, null, 4, 84, $$Sal$$),
  ('acronym', $$DSCR$$, $$Debt-Service Coverage Ratio$$, $$Qualifies an investment loan on the property's rent vs payment, not personal income.$$, 4, 85, $$Sal$$),
  ('acronym', $$ATR/QM$$, $$Ability-to-Repay / Qualified Mortgage$$, $$The rule requiring lenders verify a borrower can repay.$$, 4, 86, $$Sal$$),
  ('vocab', $$Bank-statement loan$$, $$A non-QM loan qualifying self-employed income from deposits instead of tax returns.$$, null, 4, 87, $$Sal$$),
  ('vocab', $$Asset-depletion loan$$, $$Qualifying income derived from a borrower's liquid assets.$$, null, 4, 88, $$Sal$$),
  ('acronym', $$IRRRL$$, $$Interest Rate Reduction Refinance Loan$$, $$The VA's streamlined refinance.$$, 4, 89, $$Sal$$),
  ('vocab', $$FHA Streamline$$, $$A simplified FHA-to-FHA refinance with limited documentation.$$, null, 4, 90, $$Sal$$),
  ('vocab', $$ARM caps$$, $$Limits on how much an ARM's rate can move — initial, periodic, and lifetime.$$, null, 4, 91, $$Sal$$),
  ('vocab', $$Index & margin$$, $$An ARM's rate equals a market index plus a fixed margin.$$, null, 4, 92, $$Sal$$),
  ('vocab', $$Recapture tax$$, $$A federal tax some bond/MCC borrowers owe if they sell early at a gain.$$, null, 4, 93, $$Sal$$),
  ('vocab', $$ITIN loan$$, $$A loan for borrowers using an ITIN instead of a Social Security number.$$, null, 4, 94, $$Sal$$),
  ('vocab', $$Piggyback (80-10-10)$$, $$A first plus second mortgage combo used to avoid PMI or a jumbo.$$, null, 4, 95, $$Sal$$),
  ('vocab', $$Construction-to-perm$$, $$A loan that funds the build, then converts to a permanent mortgage.$$, null, 4, 96, $$Sal$$),
  ('vocab', $$203(k) loan$$, $$An FHA loan that finances the purchase plus renovation in one loan.$$, null, 4, 97, $$Sal$$)
) as v(kind, term, definition, note, level, sort, created_by_name)
where not exists (select 1 from public.academy_items a where a.term = v.term);
