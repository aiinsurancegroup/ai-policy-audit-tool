-- 03: separate "the analysis failed" from "this is not a policy", and stop the
--     auto-detect sentinel from being mistaken for Commercial Auto.
--
-- NOT YET APPLIED. Run only after the Branch 1 code is deployed: the new code
-- writes FAILED and 'detect', and reads both spellings, so applying this first
-- is safe but applying it against the OLD code would leave statuses the old UI
-- does not recognise.
--
-- Context for anyone reading this later:
--
--   ai_status carried three different kinds of thing in one column. ERROR meant
--   "the run broke" while UNKNOWN meant "this document is not an insurance
--   policy" -- a real finding. The UI showed both as "Invalid - Not a Commercial
--   Policy", so a revoked API key, a retired model string and two function
--   timeouts were all reported to the operator as a verdict about the document.
--   ERROR becomes FAILED. UNKNOWN is left exactly as it is: it is a verdict.
--
--   policy_type held 'auto' for the "Auto-Detect (AI will identify)" sentinel,
--   directly above 'auto_policy' for Commercial Auto. They look like duplicates
--   and are close to opposites. Production proves it: of the four 'auto' rows
--   whose analysis completed, the identified types were GL (x2) and Cyber (x1).
--   Merging the two would have relabelled a GL policy and a Cyber policy as
--   Commercial Auto and asserted a line of business for 11 rows never read.

begin;

-- 1. ERROR -> FAILED. UNKNOWN and PENDING are untouched.
update audit_policies
   set ai_status = 'FAILED'
 where ai_status = 'ERROR';

-- 2. A completed analysis should never leave the sentinel in place: adopt the
--    type the analysis actually identified. Only maps values we recognise, so
--    an unexpected string leaves the row alone rather than inventing a line.
update audit_policies
   set policy_type = case lower(trim(ai_raw_output->>'policy_type'))
         when 'gl'                    then 'gl'
         when 'general liability'     then 'gl'
         when 'cgl'                   then 'gl'
         when 'eo'                    then 'eo'
         when 'e&o'                   then 'eo'
         when 'professional liability' then 'eo'
         when 'do'                    then 'do'
         when 'd&o'                   then 'do'
         when 'cyber'                 then 'cyber'
         when 'cyber liability'       then 'cyber'
         when 'epli'                  then 'epli'
         when 'products'              then 'products'
         when 'wc'                    then 'wc'
         when 'workers compensation'  then 'wc'
         when 'commercial auto'       then 'auto_policy'
         when 'auto'                  then 'auto_policy'
         when 'business auto'         then 'auto_policy'
         when 'property'              then 'property'
         when 'bop'                   then 'property'
         when 'umbrella'              then 'umbrella'
         when 'excess'                then 'umbrella'
       end
 where policy_type = 'auto'
   and ai_status in ('EXCLUDED','SILENT','PARTIAL','AFFIRMATIVE')
   and lower(trim(ai_raw_output->>'policy_type')) in (
         'gl','general liability','cgl','eo','e&o','professional liability',
         'do','d&o','cyber','cyber liability','epli','products','wc',
         'workers compensation','commercial auto','auto','business auto',
         'property','bop','umbrella','excess');

-- 3. Every remaining 'auto' row was never successfully identified, so it keeps
--    the sentinel -- under its unambiguous new name.
update audit_policies
   set policy_type = 'detect'
 where policy_type = 'auto';

-- 4. Overall risk was computed across all statuses, so failed and pending rows
--    fell through to MODERATE and an all-failed audit could read LOW. Risk is
--    now derived from completed verdicts only. Clear it on any audit that has
--    no verdict left to stand on; the next run recomputes it.
update audits a
   set overall_risk = 'UNKNOWN'
 where a.deleted_at is null
   and not exists (
         select 1 from audit_policies p
          where p.audit_id = a.id
            and p.ai_status in ('EXCLUDED','SILENT','PARTIAL','AFFIRMATIVE'));

commit;
