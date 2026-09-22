-- 04: audit_program_analysis -- the program-level report.
--
-- NOT YET APPLIED.
--
-- A per-policy analysis sees one document and cannot tell "the client does not
-- have this" from "I was not shown it". The program pass reads every policy in
-- an audit together, which is the only vantage point from which an absence can
-- honestly be asserted -- and then only when every policy in the audit was
-- actually read. That condition is recorded on the row, not just checked in the
-- UI, so a stored report always carries the evidence for its own claims.
--
-- Security posture matches migration 02: RLS enabled, NO policies, NO grants to
-- anon or authenticated. service_role bypasses RLS and is the only way in, so
-- every read and write goes through the server with the admin password checked
-- first. A new table defaults to no grants, but they are revoked explicitly
-- below in case a future default changes underneath us.

-- ---------- PRE-CHECK ----------
-- Expect: zero rows (table does not exist yet).
select table_name from information_schema.tables
 where table_schema = 'public' and table_name = 'audit_program_analysis';

-- ---------- APPLY ----------
begin;

create table if not exists public.audit_program_analysis (
  id                uuid primary key default gen_random_uuid(),
  audit_id          uuid not null references public.audits(id) on delete cascade,

  -- Exactly which policy rows were read, captured at generation time. A report
  -- is only as true as its inputs, and those inputs change: policies get
  -- re-run, re-typed, added. Without this snapshot an old report cannot be
  -- explained, or distinguished from one generated over a different set.
  policies_included jsonb not null default '[]'::jsonb,

  -- Cross-checks assembled in code from the per-policy output -- underlying
  -- limits against umbrella requirements, named insureds, terms, schedules.
  -- Stored because the model reasons ABOUT these; it does not decide what to
  -- compare. Keeping them makes the reasoning auditable after the fact.
  cross_checks      jsonb not null default '{}'::jsonb,

  -- The model's output.
  result            jsonb,

  -- Policies whose analysis had NOT completed when this ran. The guard refuses
  -- to generate while this is non-empty, so on a stored row it should always be
  -- []. It exists so that a report can never quietly claim completeness: if a
  -- future change lets a partial report through, the row says which documents
  -- were unread rather than leaving the gap invisible.
  unread_policies   jsonb not null default '[]'::jsonb,

  model             text,
  generated_by      text,
  generated_at      timestamptz not null default now()
);

-- One audit can be re-analysed as policies are added or re-run; history is kept
-- rather than overwritten, and the newest row is the current report.
create index if not exists audit_program_analysis_audit_idx
  on public.audit_program_analysis (audit_id, generated_at desc);

alter table public.audit_program_analysis enable row level security;

-- No policies are created: with RLS on and none defined, anon and authenticated
-- are denied by default. No explicit DENY is needed, and none of the permissive
-- "Allow all" policies that migration 02 had to remove is created here.
revoke all privileges on table public.audit_program_analysis from anon, authenticated;

commit;

-- ---------- POST-CHECK ----------
-- Expect: rowsecurity = true.
select relname, relrowsecurity as rowsecurity
  from pg_class where relname = 'audit_program_analysis';

-- Expect: zero rows. Any policy here would be a hole.
select policyname, roles::text, cmd from pg_policies
 where schemaname = 'public' and tablename = 'audit_program_analysis';

-- Expect: service_role only. No anon, no authenticated.
select grantee, string_agg(distinct privilege_type, ', ' order by privilege_type) as privs
  from information_schema.role_table_grants
 where table_schema = 'public' and table_name = 'audit_program_analysis'
   and grantee in ('anon','authenticated','service_role')
 group by grantee order by grantee;

-- ============================================================
-- ROLLBACK -- drops the table and everything in it.
--
-- begin;
-- drop table if exists public.audit_program_analysis;
-- commit;
