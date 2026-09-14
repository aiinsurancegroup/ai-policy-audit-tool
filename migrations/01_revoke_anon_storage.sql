-- ============================================================
-- STEP 1 of 2 — Remove anonymous access to the `policies` bucket
-- ============================================================
--
-- Run this BEFORE 02_revoke_anon_tables.sql, and test a client-portal
-- upload immediately afterwards. This step is isolated precisely because
-- it carries the one risky assumption in the whole change:
--
--   ClientPortal still calls supabase.storage.uploadToSignedUrl() with the
--   browser's anon key (src/App.jsx:251). That call is expected to survive
--   because it authorizes via the server-issued signed token rather than
--   the anon role's storage policy. If that assumption is wrong, uploads
--   break for every client at once -- so it gets its own step and its own
--   test, rather than being discovered inside a combined migration.
--
-- SCOPE: only the two anon policies that target bucket_id = 'policies'.
-- The `policy-uploads` and `carrier-app-forms` buckets belong to the
-- submissions tool, are governed by separate `authenticated` policies, and
-- are NOT touched here. Verify that with the pre-check below.

-- ---------- PRE-CHECK: what exists right now ----------
-- Expect 9 rows:
--   2  anon policies on bucket 'policies'        <- dropped below
--   4  'carrier-app-forms' authenticated policies   <- KEPT
--   3  'policy-uploads'    authenticated policies   <- KEPT
select policyname, roles::text, cmd, qual, with_check
from pg_policies
where schemaname = 'storage' and tablename = 'objects'
order by policyname;

-- ---------- APPLY ----------
begin;

-- Named individually. Each one's USING/WITH CHECK clause is
-- `bucket_id = 'policies'`, so dropping them removes anonymous access to
-- that bucket only; no other bucket's policies are named or affected.
drop policy if exists "Allow anon reads"   on storage.objects;
drop policy if exists "Allow anon uploads" on storage.objects;

commit;

-- ---------- POST-CHECK ----------
-- Expect: no rows with roles = {anon}. The four authenticated policies for
-- 'carrier-app-forms' and 'policy-uploads' must still be present.
select policyname, roles::text, cmd, qual
from pg_policies
where schemaname = 'storage' and tablename = 'objects'
order by policyname;

-- ---------- TEST BEFORE PROCEEDING ----------
-- 1. Generate a client link from the admin UI.
-- 2. Open it, sign consent, attach a PDF, submit.
-- 3. Confirm: submission succeeds, and the object appears under
--      select name from storage.objects
--      where bucket_id = 'policies' and name like '<audit_id>/%';
-- 4. Also confirm the submissions tool still uploads to 'policy-uploads'
--    and 'carrier-app-forms'.
-- Only then run 02_revoke_anon_tables.sql.

-- ============================================================
-- ROLLBACK -- restores the exact prior state
-- ============================================================
-- begin;
-- create policy "Allow anon reads" on storage.objects
--   for select to anon
--   using (bucket_id = 'policies');
-- create policy "Allow anon uploads" on storage.objects
--   for insert to anon
--   with check (bucket_id = 'policies');
-- commit;
