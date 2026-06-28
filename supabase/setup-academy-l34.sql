-- ============================================================
-- Academy content batch 2 — beef up Level 3 (Applied) + Level 4 (Advanced/Niche).
-- Run in the Supabase SQL Editor; click "Run without RLS" if the linter pops.
-- Dollar-quoted; skips any term already present.
-- ============================================================

insert into public.academy_items (kind, term, definition, note, level, sort, created_by_name)
select v.kind, v.term, v.definition, v.note, v.level, v.sort, v.created_by_name
from (values
  -- ── Level 3 — Applied ──
  ('vocab', $$Cash-out refinance$$, $$Refinancing for more than you owe and taking the difference in cash — stricter LTV limits apply.$$, null, 3, 200, $$Sal$$),
  ('vocab', $$Rate-and-term refinance$$, $$Refinancing to change the rate or term without taking cash out.$$, null, 3, 201, $$Sal$$),
  ('vocab', $$PMI cancellation$$, $$Requesting PMI removal at 80% LTV (by request) or automatic termination at 78%.$$, null, 3, 202, $$Sal$$),
  ('vocab', $$Appraisal contingency$$, $$A contract clause letting the buyer renegotiate or exit if the value comes in low.$$, null, 3, 203, $$Sal$$),
  ('vocab', $$Inspection contingency$$, $$A clause letting the buyer act on inspection findings — repair, credit, or walk.$$, null, 3, 204, $$Sal$$),
  ('vocab', $$Compensating factors$$, $$Strengths (reserves, low LTV, long job history) that justify approving a higher DTI.$$, null, 3, 205, $$Sal$$),
  ('vocab', $$Residual income$$, $$The VA's leftover-income test — money remaining after major monthly expenses.$$, null, 3, 206, $$Sal$$),
  ('vocab', $$Manual underwrite$$, $$A human underwrite when AUS refers or won't run — stricter ratios and reserves.$$, null, 3, 207, $$Sal$$),
  ('vocab', $$Conditional approval$$, $$Approval subject to clearing specific listed conditions before closing.$$, null, 3, 208, $$Sal$$),
  ('vocab', $$Rapid rescore$$, $$A fast credit update to reflect paid-down balances or corrected errors.$$, null, 3, 209, $$Sal$$),
  ('vocab', $$Tradeline$$, $$An individual credit account on the report (card, auto, mortgage).$$, null, 3, 210, $$Sal$$),
  ('vocab', $$Credit inquiry$$, $$A pull of the credit report; too many in a short window can ding the score.$$, null, 3, 211, $$Sal$$),
  ('vocab', $$Charge-off$$, $$A debt the creditor wrote off as a loss — may need payoff or an explanation.$$, null, 3, 212, $$Sal$$),
  ('vocab', $$Collection account$$, $$An unpaid debt sent to collections; programs treat them differently by balance.$$, null, 3, 213, $$Sal$$),
  ('vocab', $$Waiting period$$, $$Required time after a bankruptcy, foreclosure, or short sale before eligibility.$$, null, 3, 214, $$Sal$$),
  ('vocab', $$Large deposit$$, $$A deposit beyond normal income that underwriting requires you to source.$$, null, 3, 215, $$Sal$$),
  ('vocab', $$Bridge loan$$, $$Short-term financing to buy a new home before the current one sells.$$, null, 3, 216, $$Sal$$),
  ('vocab', $$Second mortgage$$, $$A subordinate lien behind the first mortgage.$$, null, 3, 217, $$Sal$$),
  ('vocab', $$Occupancy type$$, $$Primary, second home, or investment — each is priced and guided differently.$$, null, 3, 218, $$Sal$$),
  ('vocab', $$Escrow holdback$$, $$Funds held at closing for incomplete repairs, released once the work is done.$$, null, 3, 219, $$Sal$$),
  ('vocab', $$Concurrent close$$, $$Closing a sale and a purchase together, often back-to-back the same day.$$, null, 3, 220, $$Sal$$),
  ('vocab', $$Tangible net benefit$$, $$A required, real benefit to the borrower to justify a refinance (rate, term, or cash).$$, null, 3, 221, $$Sal$$),
  ('acronym', $$HELOC$$, $$Home Equity Line of Credit$$, $$A revolving second lien you draw against, like a credit card on your equity.$$, 3, 222, $$Sal$$),
  ('acronym', $$ROV$$, $$Reconsideration of Value$$, $$A formal request for the appraiser to review value with new comps.$$, 3, 223, $$Sal$$),
  ('acronym', $$AVM$$, $$Automated Valuation Model$$, $$A software-generated property value estimate.$$, 3, 224, $$Sal$$),
  -- ── Level 4 — Advanced / Niche ──
  ('vocab', $$Condo warrantability$$, $$Whether a condo project meets Fannie/Freddie standards; non-warrantable needs special financing.$$, null, 4, 300, $$Sal$$),
  ('vocab', $$HOA questionnaire$$, $$The condo/HOA project review of budget, owner-occupancy, insurance, and litigation.$$, null, 4, 301, $$Sal$$),
  ('vocab', $$Manufactured home loan$$, $$Financing for a HUD-code factory-built home on a permanent foundation.$$, null, 4, 302, $$Sal$$),
  ('vocab', $$Co-op loan$$, $$A share loan for a cooperative — you own shares, not real estate (common in NYC).$$, null, 4, 303, $$Sal$$),
  ('vocab', $$Portfolio loan$$, $$A loan the lender keeps instead of selling — flexible, non-agency guidelines.$$, null, 4, 304, $$Sal$$),
  ('vocab', $$Assumable loan$$, $$A loan a qualified buyer can take over at the existing rate (common on VA/FHA).$$, null, 4, 305, $$Sal$$),
  ('vocab', $$Delayed financing$$, $$A cash buyer refinancing soon after purchase to pull their cash back out.$$, null, 4, 306, $$Sal$$),
  ('vocab', $$Seller financing$$, $$The seller acts as the lender, carrying the note instead of a bank.$$, null, 4, 307, $$Sal$$),
  ('vocab', $$Cross-collateralization$$, $$Using one property's equity to help secure a loan on another.$$, null, 4, 308, $$Sal$$),
  ('vocab', $$Appraisal gap coverage$$, $$A buyer's contract promise to cover a shortfall between price and appraised value.$$, null, 4, 309, $$Sal$$),
  ('vocab', $$Escalation clause$$, $$A contract term that auto-raises the offer to beat competing bids, up to a cap.$$, null, 4, 310, $$Sal$$),
  ('vocab', $$Lock extension$$, $$Paying to extend a rate lock past its expiration date.$$, null, 4, 311, $$Sal$$),
  ('vocab', $$Worst-case pricing$$, $$Re-pricing a lock that expired at the worse of the original or current market.$$, null, 4, 312, $$Sal$$),
  ('vocab', $$VA funding fee$$, $$The VA's one-time fee in place of monthly MI — waived for some disabled veterans.$$, null, 4, 313, $$Sal$$),
  ('vocab', $$VA entitlement$$, $$The guaranty amount a veteran can use; restored when the prior VA loan is paid off.$$, null, 4, 314, $$Sal$$),
  ('vocab', $$VA Tidewater$$, $$A VA appraisal process that flags when value may come in below the contract price.$$, null, 4, 315, $$Sal$$),
  ('vocab', $$USDA guarantee fee$$, $$USDA's upfront and annual fees that function like mortgage insurance.$$, null, 4, 316, $$Sal$$),
  ('vocab', $$FHA flip rule$$, $$Restrictions on financing a quickly-resold property (90-day and 91-180 day rules).$$, null, 4, 317, $$Sal$$),
  ('vocab', $$MIP refund$$, $$A partial UFMIP refund when refinancing FHA-to-FHA within the eligible window.$$, null, 4, 318, $$Sal$$),
  ('vocab', $$SAFE Act$$, $$The licensing law for mortgage loan originators, administered through the NMLS.$$, null, 4, 319, $$Sal$$),
  ('vocab', $$QM points & fees cap$$, $$The 3% cap on points and fees for a loan to be a Qualified Mortgage.$$, null, 4, 320, $$Sal$$),
  ('acronym', $$RESPA$$, $$Real Estate Settlement Procedures Act$$, $$Bans kickbacks/referral fees and governs settlement disclosures.$$, 4, 321, $$Sal$$),
  ('acronym', $$TRID$$, $$TILA-RESPA Integrated Disclosure$$, $$The LE/CD rule set and its timing requirements.$$, 4, 322, $$Sal$$),
  ('acronym', $$TILA$$, $$Truth in Lending Act$$, $$Requires APR and finance-charge disclosure to borrowers.$$, 4, 323, $$Sal$$),
  ('acronym', $$ECOA$$, $$Equal Credit Opportunity Act$$, $$Prohibits discrimination in lending.$$, 4, 324, $$Sal$$),
  ('acronym', $$HMDA$$, $$Home Mortgage Disclosure Act$$, $$Requires lenders to report mortgage application/loan data.$$, 4, 325, $$Sal$$),
  ('acronym', $$NMLS$$, $$Nationwide Multistate Licensing System$$, $$The registry and license system for mortgage loan originators.$$, 4, 326, $$Sal$$),
  ('acronym', $$MBS$$, $$Mortgage-Backed Security$$, $$Bonds backed by pools of mortgages — their trading drives mortgage rates.$$, 4, 327, $$Sal$$)
) as v(kind, term, definition, note, level, sort, created_by_name)
where not exists (select 1 from public.academy_items a where a.term = v.term);
