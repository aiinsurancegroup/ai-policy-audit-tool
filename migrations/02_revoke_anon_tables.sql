-- ============================================================
-- STEP 2 of 2 — Deny anon/authenticated on the five audit tables
-- ============================================================
--
-- Run ONLY after 01_revoke_anon_storage.sql has been applied AND a client
-- portal upload has been verified to still work.
--
-- PREREQUISITE: the security-fixes branch must already be deployed to
-- production. Against the old code this migration breaks the client
-- portal, all admin activity logging, and the assessment -> link flow
-- simultaneously.
--
-- ------------------------------------------------------------
-- SCOPE -- READ THIS BEFORE EDITING
-- ------------------------------------------------------------
-- This Supabase project is shared by three applications:
--
--   audit tool          audits, audit_policies, client_consents,
--                       finding_validations, activity_log   <- THIS FILE
--   submissions tool    submission_client_profile, submission_coverage,
--                       submission_loss_history, submission_carrier_app,
--                       submission_match_result, questionnaire_*
--   marketing site      blog_posts
--
-- The submissions tool and the marketing site read and write with the
-- ANON key and have no server-side endpoint to fall back on. Every table
-- below is therefore named INDIVIDUALLY.
--
--   NEVER write `REVOKE ... ON ALL TABLES IN SCHEMA public FROM anon`
--   here. That would instantly break the blog, the questionnaire, and the
--   entire submissions tool.
--
-- After this runs, the five tables are reachable only by service_role,
-- which bypasses RLS and keeps its grants. Those go through
-- /api/admin/audit and /api/client/portal.

-- ---------- PRE-CHECK ----------
-- Expect: 5 "Allow all" policies, and anon + authenticated each holding
-- DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE.
select tablename, policyname, roles::text, cmd
from pg_policies
where schemaname = 'public'
  and tablename in ('audits','audit_policies','client_consents','finding_validations','activity_log')
order by tablename;

select grantee, table_name, string_agg(distinct privilege_type, ', ' order by privilege_type) as privs
from information_schema.role_table_grants
where table_schema = 'public'
  and table_name in ('audits','audit_policies','client_consents','finding_validations','activity_log')
  and grantee in ('anon','authenticated','service_role')
group by grantee, table_name
order by table_name, grantee;

-- ---------- APPLY ----------
begin;

-- 1. Drop the permissive policies. Each was
--    FOR ALL TO public USING (true) WITH CHECK (true) -- i.e. every role.
drop policy if exists "Allow all" on public.audits;
drop policy if exists "Allow all" on public.audit_policies;
drop policy if exists "Allow all" on public.client_consents;
drop policy if exists "Allow all" on public.finding_validations;
drop policy if exists "Allow all" on public.activity_log;

-- 2. Remove the underlying grants. Dropping policies alone is not enough:
--    anon and authenticated currently hold TRUNCATE and DELETE on all five.
--    Named one table at a time -- see SCOPE above.
revoke all privileges on table public.audits              from anon, authenticated;
revoke all privileges on table public.audit_policies      from anon, authenticated;
revoke all privileges on table public.client_consents     from anon, authenticated;
revoke all privileges on table public.finding_validations from anon, authenticated;
revoke all privileges on table public.activity_log        from anon, authenticated;

-- RLS stays ENABLED on all five. With no policies and no grants, anon and
-- authenticated are denied by default; no explicit DENY policy is needed.
-- service_role is unaffected: it bypasses RLS and keeps its grants.

commit;

-- ---------- POST-CHECK ----------
-- Expect: zero policy rows.
select tablename, policyname, roles::text
from pg_policies
where schemaname = 'public'
  and tablename in ('audits','audit_policies','client_consents','finding_validations','activity_log');

-- Expect: service_role only. No anon, no authenticated.
select grantee, table_name, string_agg(distinct privilege_type, ', ' order by privilege_type) as privs
from information_schema.role_table_grants
where table_schema = 'public'
  and table_name in ('audits','audit_policies','client_consents','finding_validations','activity_log')
  and grantee in ('anon','authenticated','service_role')
group by grantee, table_name
order by table_name, grantee;

-- Expect: anon grants on the OTHER tools' tables are untouched.
select grantee, table_name, string_agg(distinct privilege_type, ', ' order by privilege_type) as privs
from information_schema.role_table_grants
where table_schema = 'public'
  and table_name in ('blog_posts','questionnaire_submissions','submission_client_profile')
  and grantee = 'anon'
group by grantee, table_name
order by table_name;

-- ---------- VERIFY THE APP ----------
-- Client portal:  open a token link -> loads, consent + upload + submit works
-- Admin:          sign in, create link, archive, Activity Log populated,
--                 no red "activity-log entry failed to record" banner
-- Assessment:     POST /api/send-email returns 200 with a tokenized portalLink
-- Other tools:    blog loads on the marketing site; submissions tool reads
--                 and writes normally

-- ============================================================
-- ROLLBACK -- restores the exact prior state
-- ============================================================
-- begin;
-- grant all privileges on table public.audits              to anon, authenticated;
-- grant all privileges on table public.audit_policies      to anon, authenticated;
-- grant all privileges on table public.client_consents     to anon, authenticated;
-- grant all privileges on table public.finding_validations to anon, authenticated;
-- grant all privileges on table public.activity_log        to anon, authenticated;
--
-- -- Recreated without a TO clause, matching the originals (TO public).
-- create policy "Allow all" on public.audits              for all using (true) with check (true);
-- create policy "Allow all" on public.audit_policies      for all using (true) with check (true);
-- create policy "Allow all" on public.client_consents     for all using (true) with check (true);
-- create policy "Allow all" on public.finding_validations for all using (true) with check (true);
-- create policy "Allow all" on public.activity_log        for all using (true) with check (true);
-- commit;
