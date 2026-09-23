-- 07: take away the blanket grants, hand back only what each role uses.
--
-- Ten tables granted anon and authenticated the full set -- SELECT, INSERT,
-- UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER. Nothing anonymous was ever
-- exploitable through them, because RLS is on and no policy admitted an
-- anonymous write. That is the point: the grant is what makes a future RLS
-- mistake catastrophic rather than merely wrong, and it is the same revoke
-- migration 02 already performed for the six audit-tool tables.
--
-- ORDER MATTERS, AND IT IS THE OPPOSITE OF WHAT IT LOOKS LIKE
-- A GRANT is the outer gate and RLS the inner one; a policy cannot admit what
-- the grant never permitted. So revoking everything from authenticated would
-- silently kill every staff and admin policy migration 06 just created. The
-- grants below are restored deliberately, and the policies then narrow them.
--
-- TRUNCATE, REFERENCES and TRIGGER are not restored to anyone. No application
-- role has ever needed them, and TRUNCATE in particular bypasses row-level
-- security entirely -- a policy cannot stop it.

-- ------------------------------------------------------------------- revoke
do $$
declare t text;
begin
  foreach t in array array[
    'questionnaire_types',
    'questionnaire_questions',
    'questionnaire_submissions',
    'submission_client_profile',
    'submission_coverage',
    'submission_loss_history',
    'submission_carrier_app',
    'submission_carrier_market',
    'submission_match_result',
    'blog_posts'
  ] loop
    execute format('revoke all on public.%I from anon, authenticated', t);
  end loop;
end $$;

-- --------------------------------------------------------------- anon: back
-- Exactly what the public questionnaire and the public site read, and nothing
-- else. Each is already narrowed further by an existing anon policy.
grant select on public.questionnaire_types     to anon;  -- policy: true
grant select on public.questionnaire_questions to anon;  -- policy: true
grant select on public.blog_posts              to anon;  -- policy: published = true

-- The one anonymous write on the system. The policy restricts it to
-- status = 'submitted'; the grant restricts it to INSERT, so a submitted form
-- cannot be read back, amended or removed by whoever sent it.
grant insert on public.questionnaire_submissions to anon;

-- ------------------------------------------------------ authenticated: back
-- Restores what the staff and admin policies from migration 06 need in order to
-- apply at all. The policies decide who; these grants decide what is even
-- reachable.
do $$
declare t text;
begin
  foreach t in array array[
    'questionnaire_types',
    'questionnaire_questions',
    'questionnaire_submissions',
    'submission_client_profile',
    'submission_coverage',
    'submission_loss_history',
    'submission_carrier_app',
    'submission_match_result'
  ] loop
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
  end loop;
end $$;

-- Reference data the carrier matcher reads. Read-only in policy, so read-only
-- in grant: there is no reason for the application to be able to write it.
grant select on public.submission_carrier_market to authenticated;

-- blog_posts has no authenticated policy, so it gets no authenticated grant.
-- Posts are edited through the service role.

-- ----------------------------------------------------------------- rollback
--   grant all on public.<table> to anon, authenticated;
-- Restores the blanket grants. Only useful to recover an outage, and it puts
-- back the loaded gun this migration exists to unload.
