-- ============================================================
-- Academy content batch 6 (final) — finish Level 3 + Level 4 at 100 each.
-- L3: title defects, appraisal conditions, credit events, gift/grant docs.
-- L4: non-QM/investor depth, prepay structures, trust/estate, NY co-op. Dedup by term.
-- ============================================================

insert into public.academy_items (kind, term, definition, note, level, sort, created_by_name)
select v.kind, v.term, v.definition, v.note, v.level, v.sort, v.created_by_name
from (values
  -- ── Level 3 — Applied ──
  ('vocab', $$Cloud on title$$, $$Any claim or defect that clouds clear ownership and must be cleared to close.$$, null, 3, 270, $$Sal$$),
  ('vocab', $$Easement$$, $$A right for others to use part of your property, like utilities or access.$$, null, 3, 271, $$Sal$$),
  ('vocab', $$Encroachment$$, $$When a structure crosses onto a neighboring property line.$$, null, 3, 272, $$Sal$$),
  ('vocab', $$Chain of title$$, $$The historical record of a property's ownership transfers.$$, null, 3, 273, $$Sal$$),
  ('vocab', $$Quitclaim deed$$, $$A deed transferring whatever interest the grantor has, with no warranty.$$, null, 3, 274, $$Sal$$),
  ('vocab', $$Lien release$$, $$A recorded document removing a paid-off lien from title.$$, null, 3, 275, $$Sal$$),
  ('vocab', $$Judgment lien$$, $$A court-ordered lien from an unpaid debt that attaches to the property.$$, null, 3, 276, $$Sal$$),
  ('vocab', $$Mechanic's lien$$, $$A contractor's lien for unpaid work done on the property.$$, null, 3, 277, $$Sal$$),
  ('vocab', $$Subject-to repairs$$, $$An appraisal that requires repairs before the value is considered final.$$, null, 3, 278, $$Sal$$),
  ('vocab', $$Health & safety items$$, $$Appraiser-flagged hazards (peeling paint, missing handrail) that must be fixed.$$, null, 3, 279, $$Sal$$),
  ('vocab', $$Well & septic$$, $$Inspections and clearances required for homes on well water or septic systems.$$, null, 3, 280, $$Sal$$),
  ('vocab', $$Termite inspection$$, $$A wood-destroying-organism report, often required on VA and FHA loans.$$, null, 3, 281, $$Sal$$),
  ('vocab', $$Repair escrow$$, $$Funds held to complete required repairs shortly after closing.$$, null, 3, 282, $$Sal$$),
  ('vocab', $$Re-inspection (1004D)$$, $$A follow-up appraisal confirming repairs or completion.$$, null, 3, 283, $$Sal$$),
  ('vocab', $$Credit dispute$$, $$A tradeline the borrower is contesting; often must be resolved to proceed.$$, null, 3, 284, $$Sal$$),
  ('vocab', $$Authorized user$$, $$Being added to someone else's credit card; counted differently in scoring.$$, null, 3, 285, $$Sal$$),
  ('vocab', $$Re-aging$$, $$A creditor resetting a delinquent account back to current status.$$, null, 3, 286, $$Sal$$),
  ('vocab', $$Credit supplement$$, $$An updated report verifying a specific change, like a paid collection.$$, null, 3, 287, $$Sal$$),
  ('vocab', $$Gift fund documentation$$, $$The donor letter, proof of ability, and transfer trail required for gifts.$$, null, 3, 288, $$Sal$$),
  ('vocab', $$Donor ability$$, $$Proof that a gift donor actually had the funds they gave.$$, null, 3, 289, $$Sal$$),
  ('vocab', $$DPA grant$$, $$Down-payment-assistance money that's a true grant — no repayment required.$$, null, 3, 290, $$Sal$$),
  ('vocab', $$Verification of rent$$, $$Proof of on-time rent history, useful for thin-credit borrowers.$$, null, 3, 291, $$Sal$$),
  ('vocab', $$Non-purchasing spouse$$, $$A spouse not on the loan whose debts or title rights may still matter.$$, null, 3, 292, $$Sal$$),
  ('vocab', $$Closing extension$$, $$Extending the contract's closing date by agreement.$$, null, 3, 293, $$Sal$$),
  ('vocab', $$Rate lock expiration$$, $$When a lock lapses and the loan needs an extension or a re-price.$$, null, 3, 294, $$Sal$$),
  -- ── Level 4 — Advanced / Niche ──
  ('vocab', $$Interest reserves$$, $$Funds set aside to cover loan payments during construction or rehab.$$, null, 4, 370, $$Sal$$),
  ('vocab', $$Prepayment penalty$$, $$A fee for paying off early — common on DSCR and investor loans.$$, null, 4, 371, $$Sal$$),
  ('vocab', $$Step-down prepay$$, $$A prepayment penalty that declines each year, like 5/4/3/2/1.$$, null, 4, 372, $$Sal$$),
  ('vocab', $$Yield maintenance$$, $$A prepay penalty calculated to preserve the lender's expected yield.$$, null, 4, 373, $$Sal$$),
  ('vocab', $$Cross-collateral release$$, $$Freeing one property from a blanket loan as the others are sold or paid down.$$, null, 4, 374, $$Sal$$),
  ('vocab', $$DSCR ratio tiers$$, $$Pricing and eligibility bands by how well rent covers the payment (1.0 vs 1.25+).$$, null, 4, 375, $$Sal$$),
  ('vocab', $$Short-term rental income$$, $$Qualifying a DSCR loan on Airbnb/market rents for a short-term-rental property.$$, null, 4, 376, $$Sal$$),
  ('vocab', $$Stated income$$, $$A legacy non-QM approach using declared, unverified income.$$, null, 4, 377, $$Sal$$),
  ('vocab', $$Asset utilization$$, $$Treating a percentage of liquid assets as monthly qualifying income.$$, null, 4, 378, $$Sal$$),
  ('vocab', $$40-year term$$, $$An extended amortization that lowers payments — non-QM or in a modification.$$, null, 4, 379, $$Sal$$),
  ('vocab', $$Balloon payment$$, $$A large lump sum due at the end of a short-term loan.$$, null, 4, 380, $$Sal$$),
  ('vocab', $$Interest-only period$$, $$A set early window where the payment covers only interest, not principal.$$, null, 4, 381, $$Sal$$),
  ('vocab', $$Recourse vs non-recourse$$, $$Whether the lender can pursue you personally beyond just the property.$$, null, 4, 382, $$Sal$$),
  ('vocab', $$Entity vesting (LLC)$$, $$Closing an investment loan in an LLC's name rather than personally.$$, null, 4, 383, $$Sal$$),
  ('vocab', $$Inter vivos trust$$, $$Holding title in a revocable living trust — agencies allow it with conditions.$$, null, 4, 384, $$Sal$$),
  ('vocab', $$Life estate$$, $$A right to occupy a home for life, with ownership passing to another afterward.$$, null, 4, 385, $$Sal$$),
  ('vocab', $$Probate sale$$, $$Buying a property from a deceased owner's estate through the courts.$$, null, 4, 386, $$Sal$$),
  ('vocab', $$PACE lien$$, $$A property-assessed clean-energy lien that can block agency financing until cleared.$$, null, 4, 387, $$Sal$$),
  ('vocab', $$Solar lease/UCC$$, $$Leased solar panels with a UCC filing that complicates title and payoff.$$, null, 4, 388, $$Sal$$),
  ('vocab', $$Co-op underlying mortgage$$, $$The blanket loan on the whole co-op building, sitting behind your share loan.$$, null, 4, 389, $$Sal$$),
  ('vocab', $$Co-op maintenance$$, $$The monthly co-op charge covering building costs and the underlying mortgage.$$, null, 4, 390, $$Sal$$),
  ('vocab', $$Assignment of mortgage$$, $$Transferring the existing lien to the new lender — what makes a NY CEMA work.$$, null, 4, 391, $$Sal$$)
) as v(kind, term, definition, note, level, sort, created_by_name)
where not exists (select 1 from public.academy_items a where a.term = v.term);
