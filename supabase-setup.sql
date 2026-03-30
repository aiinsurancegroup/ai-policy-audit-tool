-- ============================================================
-- AI POLICY AUDIT TOOL — DATABASE SCHEMA
-- Run this in Supabase SQL Editor (Dashboard → SQL Editor → New Query)
-- ============================================================

-- 1. AUDITS — Master record for each client audit
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
  deleted_at TIMESTAMPTZ  -- soft delete, never hard delete
);

-- 2. AUDIT_POLICIES — Each policy document analyzed within an audit
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
  ai_status TEXT CHECK (ai_status IN ('EXCLUDED', 'SILENT', 'PARTIAL', 'AFFIRMATIVE', 'ERROR', 'UNKNOWN')),
  risk_level TEXT CHECK (risk_level IN ('HIGH', 'MODERATE', 'LOW')),
  ai_raw_output JSONB,  -- original AI response, never modified
  validated_output JSONB,  -- human-reviewed version
  summary TEXT,
  validation_status TEXT DEFAULT 'PENDING' CHECK (validation_status IN ('PENDING', 'VALIDATED', 'REJECTED')),
  validated_by TEXT,
  validated_at TIMESTAMPTZ,
  validation_notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. FINDING_VALIDATIONS — Per-finding human review log
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

-- 4. CLIENT_CONSENTS — Authorization records
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

-- 5. ACTIVITY_LOG — Complete compliance trail
CREATE TABLE activity_log (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  audit_id UUID REFERENCES audits(id) ON DELETE SET NULL,
  action TEXT NOT NULL,  -- e.g. 'AUDIT_CREATED', 'POLICY_ANALYZED', 'FINDING_CONFIRMED', 'REPORT_VALIDATED', 'REPORT_EXPORTED'
  details JSONB,  -- flexible payload for any action-specific data
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

-- ============================================================
-- AUTO-UPDATE updated_at on audits
-- ============================================================
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER audits_updated_at
  BEFORE UPDATE ON audits
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ============================================================
-- DISABLE ROW LEVEL SECURITY (internal tool, password-protected)
-- ============================================================
ALTER TABLE audits ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_policies ENABLE ROW LEVEL SECURITY;
ALTER TABLE finding_validations ENABLE ROW LEVEL SECURITY;
ALTER TABLE client_consents ENABLE ROW LEVEL SECURITY;
ALTER TABLE activity_log ENABLE ROW LEVEL SECURITY;

-- Allow all operations with the anon key (tool is password-gated)
CREATE POLICY "Allow all" ON audits FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all" ON audit_policies FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all" ON finding_validations FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all" ON client_consents FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all" ON activity_log FOR ALL USING (true) WITH CHECK (true);
