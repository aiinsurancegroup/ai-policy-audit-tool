-- ============================================================
-- AI POLICY AUDIT TOOL — DATABASE SCHEMA
-- Run this in Supabase SQL Editor (Dashboard → SQL Editor → New Query)
-- ============================================================
--
-- This file reflects the LIVE schema as introspected on 2026-09-14, plus
-- the locked-down security posture from migrations/.
--
-- The previous version of this file had drifted badly from production: it
-- was missing client_token and every consent column on `audits`, missing
-- storage_path on `audit_policies`, and its "Allow all" RLS block described
-- a security model that is no longer true. Policies were being written
-- against a file that did not match the database. Keep this file in step
-- with any future schema change.
--
-- NOTE ON SHARED PROJECT: this Supabase project also hosts the submissions
-- tool (submission_*, questionnaire_*) and the marketing site (blog_posts).
-- Those are NOT defined here and must not be touched by this file. They
-- read and write with the anon key and have no server-side fallback.

-- ============================================================
-- 1. AUDITS — Master record for each client audit
-- ============================================================
CREATE TABLE audits (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  client_name TEXT NOT NULL,
  client_industry TEXT NOT NULL,
  client_contact TEXT,
  client_email TEXT,
  status TEXT NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'VALIDATED', 'ARCHIVED')),
  overall_risk TEXT CHECK (overall_risk IN ('HIGH', 'MODERATE', 'LOW', 'UNKNOWN')),
  file_count INTEGER DEFAULT 0,
  validated_by TEXT,
  validated_at TIMESTAMPTZ,
  created_by TEXT DEFAULT 'system',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  deleted_at TIMESTAMPTZ,  -- soft delete, never hard delete

  -- ---- Public client portal ----
  -- The bearer credential in the client's ?token= URL. UNIQUE both to keep
  -- lookups unambiguous and because the portal resolves exactly one row by
  -- it. Currently generated with Math.random() and never expires -- see
  -- OPEN ITEMS at the foot of this file.
  client_token TEXT UNIQUE,
  client_submitted_at TIMESTAMPTZ,  -- set server-side; also closes the audit
                                    -- to re-submission

  -- ---- Consent, recorded server-side by /api/client/portal ----
  -- This is the authoritative consent record. client_consents below is a
  -- secondary log written by the admin side.
  consent_name TEXT,       -- typed signature
  consent_company TEXT,    -- copied from client_name, never client-supplied
  consent_statement TEXT,  -- the exact text agreed to, from the server constant
  consent_timestamp TIMESTAMPTZ,  -- server clock, NOT the browser's

  -- Admin-facing free text. The client portal deliberately does NOT write
  -- here; the signer's title goes to activity_log.details instead.
  notes TEXT
);

-- ============================================================
-- 2. AUDIT_POLICIES — Each policy document analyzed within an audit
-- ============================================================
CREATE TABLE audit_policies (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  audit_id UUID NOT NULL REFERENCES audits(id) ON DELETE CASCADE,
  policy_type TEXT NOT NULL,
  file_name TEXT NOT NULL,
  file_size_bytes INTEGER,
  carrier TEXT,
  policy_number TEXT,
  effective_date TEXT,
  expiration_date TEXT,

  -- No CHECK constraint, matching production. The original constraint was
  -- dropped at some point, which is why the code can write 'PENDING' -- a
  -- value the original list did not include. Nothing at the database level
  -- rejects a forged value; /api/client/portal forces PENDING in code.
  -- See OPEN ITEMS.
  ai_status TEXT,

  risk_level TEXT CHECK (risk_level IN ('HIGH', 'MODERATE', 'LOW')),
  ai_raw_output JSONB,      -- original AI response, never modified
  validated_output JSONB,   -- human-reviewed version
  summary TEXT,
  validation_status TEXT DEFAULT 'PENDING' CHECK (validation_status IN ('PENDING', 'VALIDATED', 'REJECTED')),
  validated_by TEXT,
  validated_at TIMESTAMPTZ,
  validation_notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),

  -- Path within the `policies` storage bucket, always '<audit_id>/<file>'.
  -- The server chooses this path; the client cannot influence the folder.
  storage_path TEXT
);

-- ============================================================
-- 3. FINDING_VALIDATIONS — Per-finding human review log
-- ============================================================
CREATE TABLE finding_validations (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  policy_id UUID NOT NULL REFERENCES audit_policies(id) ON DELETE CASCADE,
  finding_index INTEGER NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('CONFIRMED', 'REJECTED', 'MODIFIED')),
  original_finding JSONB NOT NULL,  -- what the AI said
  modified_finding JSONB,  -- what the human changed it to (if modified)
  validator_name TEXT NOT NULL,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- 4. CLIENT_CONSENTS — Secondary authorization record
-- ============================================================
-- Written by the ADMIN side only. The client portal records consent on
-- audits.consent_* instead (see above), which is authoritative. Note
-- client_email is NOT NULL here while audits.client_email is nullable, so
-- this table cannot be populated for every audit.
CREATE TABLE client_consents (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  audit_id UUID REFERENCES audits(id) ON DELETE SET NULL,
  client_name TEXT NOT NULL,
  client_title TEXT,
  client_company TEXT NOT NULL,
  client_email TEXT NOT NULL,
  consent_text TEXT NOT NULL,  -- the exact text they agreed to
  signed_name TEXT NOT NULL,  -- typed signature
  signed_at TIMESTAMPTZ DEFAULT NOW(),
  ip_address TEXT
);

-- ============================================================
-- 5. ACTIVITY_LOG — Complete compliance trail
-- ============================================================
-- The column is performed_by. Application code wrote `actor` for the
-- table's entire existence, so every insert was rejected and the table sat
-- at 0 rows across 13 audits. Both write sites and the read site were
-- corrected; the admin UI now raises a visible banner when a log write
-- fails rather than swallowing it.
CREATE TABLE activity_log (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  audit_id UUID REFERENCES audits(id) ON DELETE SET NULL,
  action TEXT NOT NULL,  -- e.g. 'AUDIT_CREATED', 'POLICY_ANALYZED', 'CLIENT_SUBMITTED'
  details JSONB,  -- flexible payload; includes server-captured ip for client actions
  performed_by TEXT NOT NULL DEFAULT 'system',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- INDEXES for performance
-- ============================================================
CREATE INDEX idx_audits_status ON audits(status) WHERE deleted_at IS NULL;
CREATE INDEX idx_audits_created ON audits(created_at DESC);
CREATE INDEX idx_audit_policies_audit ON audit_policies(audit_id);
CREATE INDEX idx_finding_validations_policy ON finding_validations(policy_id);
CREATE INDEX idx_client_consents_audit ON client_consents(audit_id);
CREATE INDEX idx_activity_log_audit ON activity_log(audit_id);
CREATE INDEX idx_activity_log_created ON activity_log(created_at DESC);
-- audits.client_token needs no explicit index: UNIQUE creates one, and that
-- is the index the portal's hot lookup path uses.

-- ============================================================
-- AUTO-UPDATE updated_at on audits
-- ============================================================
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql
-- DELIBERATE DEVIATION FROM PRODUCTION: the live function has an unpinned
-- search_path, which the Supabase security linter flags
-- (function_search_path_mutable). A fresh install should not inherit that,
-- so it is pinned here. To fix the existing database, re-run this CREATE OR
-- REPLACE against it -- it is not part of migrations/.
SET search_path = ''

CREATE TRIGGER audits_updated_at
  BEFORE UPDATE ON audits
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ============================================================
-- ROW LEVEL SECURITY — deny by default
-- ============================================================
-- These five tables are reachable ONLY by service_role, which bypasses RLS
-- and keeps its grants. All application access goes through two serverless
-- endpoints that hold the service role key:
--
--   /api/admin/audit    password-gated admin operations
--   /api/client/portal  public client portal, authorized per-request by
--                       the client_token in the request body
--
-- The browser's anon key can no longer read or write these tables. The one
-- remaining anon-key call in the frontend is a storage upload to a
-- server-issued signed URL, which authorizes via the signed token.
--
-- This REPLACES the previous "Allow all" policies, which granted every
-- operation to the `public` role -- meaning anyone holding the anon key
-- (shipped in the JS bundle) could read, modify, DELETE or TRUNCATE every
-- audit, consent record and log entry.

ALTER TABLE audits ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_policies ENABLE ROW LEVEL SECURITY;
ALTER TABLE finding_validations ENABLE ROW LEVEL SECURITY;
ALTER TABLE client_consents ENABLE ROW LEVEL SECURITY;
ALTER TABLE activity_log ENABLE ROW LEVEL SECURITY;

-- No policies are created. With RLS enabled and zero policies, every role
-- that does not bypass RLS is denied by default -- no explicit DENY needed.

-- Supabase grants table privileges to anon and authenticated by default, so
-- revoke them explicitly. Each table is named individually and on purpose:
-- NEVER broaden this to "ALL TABLES IN SCHEMA public" -- that would strip
-- the submissions tool and the marketing blog, which share this project and
-- legitimately rely on the anon key.
REVOKE ALL PRIVILEGES ON TABLE audits              FROM anon, authenticated;
REVOKE ALL PRIVILEGES ON TABLE audit_policies      FROM anon, authenticated;
REVOKE ALL PRIVILEGES ON TABLE client_consents     FROM anon, authenticated;
REVOKE ALL PRIVILEGES ON TABLE finding_validations FROM anon, authenticated;
REVOKE ALL PRIVILEGES ON TABLE activity_log        FROM anon, authenticated;

-- ============================================================
-- STORAGE — the `policies` bucket
-- ============================================================
-- Create via Dashboard → Storage, or:
--   insert into storage.buckets (id, name, public) values ('policies','policies',false);
--
-- The bucket is PRIVATE. It must have NO anon policies: client uploads go
-- to short-lived signed URLs minted by /api/client/portal, which needs no
-- anon storage policy, and admin downloads stream through /api/admin/audit
-- on the service role key.
--
-- Do not add policies for the `policy-uploads` or `carrier-app-forms`
-- buckets here -- those belong to the submissions tool.
--
-- See migrations/01_revoke_anon_storage.sql for removing the two legacy
-- anon policies ("Allow anon reads" / "Allow anon uploads") from an
-- existing project.

-- ============================================================
-- OPEN ITEMS — known gaps, tracked but not yet addressed
-- ============================================================
-- 1. audit_policies.ai_status has no CHECK constraint in production. To
--    restore one it must include every value the code actually writes:
--      ALTER TABLE audit_policies ADD CONSTRAINT audit_policies_ai_status_check
--        CHECK (ai_status IN ('PENDING','EXCLUDED','SILENT','PARTIAL',
--                             'AFFIRMATIVE','ERROR','UNKNOWN'));
--    Verify against live data before applying.
--
-- 2. client_token is generated with Math.random() (not a CSPRNG), has no
--    expiry and no revocation. Two independent copies of the generator
--    exist: src/App.jsx and api/send-email.js.
--
-- 3. The `policies` bucket has no file_size_limit and no allowed_mime_types.
--    The endpoint enforces PDF-only and a 25MB cap in code; the bucket
--    itself enforces nothing.
--
-- 4. A failed client submission leaves an orphaned storage object: the
--    upload happens before the database write. No cleanup strategy yet.
--
-- 5. Failed activity_log writes surface only as an in-session admin banner.
--    There is no durable record of a log write that did not land.
--
-- 6. finding_validations has 0 rows despite the validation UI existing.
--    Unexplained -- may be genuine non-use rather than a defect.
--
-- 7. Archiving an audit silently kills the client's link. resolveAudit
--    filters on `deleted_at is null`, so an operator who archives an audit
--    locks out a client who is mid-flow -- they get "Invalid or expired
--    link" with no explanation, and no one is told it happened.
--
--    Decided behaviour, to build AFTER the token fix (item 2):
--      a. Warn before archiving an audit that still has a live token and
--         no client_submitted_at -- the operator is cutting off a client
--         who has not submitted yet.
--      b. Archived audits still ACCEPT submissions. Archiving is an
--         inbox-management action, not a revocation; a client who already
--         holds a link should never be blocked by it.
--      c. A submission into an archived audit surfaces it back on the
--         dashboard, so documents are never received silently.
--
--    Sequenced after item 2 because proper revocation belongs with the
--    token work: once tokens can be expired or revoked deliberately,
--    "archived" no longer has to double as a revocation mechanism, and
--    (b) stops being a compromise.
