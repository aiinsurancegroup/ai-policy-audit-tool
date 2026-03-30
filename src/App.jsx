import React, { useState, useEffect, useRef } from 'react';
import { supabase } from './supabase';

// =============== CONSTANTS ===============
const NAVY = '#1A2B45';
const GOLD = '#B8972A';
const DARK_BG = '#0F1923';
const LIGHT_BG = '#F8F6F1';
const WHITE = '#FFFFFF';
const LIGHT_GOLD = '#F5EFE0';
const MID_GRAY = '#6B7280';
const LIGHT_GRAY = '#E5E7EB';
const RED = '#DC2626';
const GREEN = '#16A34A';
const ORANGE = '#EA580C';
const YELLOW_BG = '#FFFBEB';

const ACCESS_CODE = 'AuditTool2026!';

const POLICY_TYPES = [
  { id: 'gl', label: 'General Liability (CGL)', icon: '🛡️' },
  { id: 'eo', label: 'Errors & Omissions (E&O)', icon: '⚖️' },
  { id: 'do', label: 'Directors & Officers (D&O)', icon: '🏛️' },
  { id: 'cyber', label: 'Cyber Liability', icon: '🔒' },
  { id: 'epli', label: 'Employment Practices (EPLI)', icon: '👥' },
  { id: 'products', label: 'Products / Completed Ops', icon: '📦' },
];

const INDUSTRIES = [
  'Financial Services / Wealth Management', 'Healthcare / Medical', 'Legal / Law Firm',
  'Technology / SaaS', 'Insurance / Brokerage', 'Manufacturing',
  'Retail / E-Commerce', 'Real Estate', 'Education', 'Other',
];

const CONSENT_TEXT = 'I authorize The AI Insurance Group to review my company\'s commercial insurance policies for the purpose of identifying AI-related coverage gaps and exclusions. I understand this review is informational and does not constitute a coverage determination, legal advice, or binding insurance transaction. Policy analysis is AI-assisted and validated by a licensed insurance professional.';

const ANALYSIS_PROMPT = `You are an expert insurance policy analyst specializing in AI-related exclusions, endorsements, and coverage gaps.

YOUR TASK: Read the entire policy document and identify ALL provisions related to artificial intelligence, machine learning, automated decision-making, algorithms, generative AI, or large language models.

SPECIFIC FORMS AND PATTERNS TO LOOK FOR:

1. VERISK / ISO FORMS (effective January 1, 2026):
   - CG 40 47 01 26: "Exclusion - Generative Artificial Intelligence"
   - CG 40 48 01 26: "Exclusion - Generative Artificial Intelligence - Coverage B Only"
   - CG 35 08 01 26: "Exclusion - Generative Artificial Intelligence" (broader form)

2. CARRIER-SPECIFIC EXCLUSIONS:
   - W.R. Berkley PC 51380: Absolute AI exclusion
   - Cincinnati Financial, Hamilton, Philadelphia Insurance, AIG AI exclusions
   - Any other carrier-specific AI or technology exclusions

3. KEY LANGUAGE PATTERNS:
   "artificial intelligence", "AI", "machine learning", "automated decision", "algorithm", "generative AI", "large language model", "LLM", "neural network", "deep learning", "chatbot", "virtual assistant", "computer-generated content", "technology services exclusion"

4. COVERAGE MODIFICATIONS TO FLAG:
   - Sublimits on technology-related claims
   - Modified definitions of "professional services" excluding AI-assisted work
   - Modified "wrongful act" definitions carving out algorithmic decisions
   - Cyber exclusions not covering AI-specific risks
   - D&O exclusions for technology governance failures
   - EPLI exclusions for automated hiring/termination
   - Products liability exclusions for software/AI-embedded products

5. ALSO NOTE:
   - Policy effective/expiration dates
   - Whether coverage is "silent" on AI (no mention = gap)
   - Any affirmative AI coverage or endorsements
   - Retroactive dates affecting AI claims

OUTPUT FORMAT - Respond ONLY in this exact JSON structure:
{
  "policy_type": "GL|EO|DO|Cyber|EPLI|Products|Other",
  "carrier": "carrier name",
  "policy_number": "if visible",
  "effective_date": "if visible",
  "expiration_date": "if visible",
  "ai_status": "EXCLUDED|SILENT|PARTIAL|AFFIRMATIVE",
  "risk_level": "HIGH|MODERATE|LOW",
  "findings": [
    {
      "id": "f1",
      "type": "EXCLUSION|SUBLIMIT|DEFINITION_CHANGE|ENDORSEMENT|SILENT_GAP|AFFIRMATIVE",
      "form_number": "form number or null",
      "description": "Clear description",
      "policy_section": "Where in the policy",
      "impact": "What this means for AI claims",
      "verbatim_excerpt": "Key 5-10 word phrase from policy"
    }
  ],
  "coverage_gaps": [
    { "id": "g1", "description": "Specific gap description" }
  ],
  "recommendations": [
    "Specific recommendation"
  ],
  "summary": "2-3 sentence executive summary"
}

If not an insurance policy: {"error": "Not an insurance policy", "ai_status": "UNKNOWN"}
Be thorough. Miss nothing.`;

// =============== STYLES ===============
const S = {
  app: { fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif", background: LIGHT_BG, minHeight: '100vh', color: NAVY },
  loginWrap: { display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', background: `linear-gradient(135deg, ${DARK_BG} 0%, ${NAVY} 100%)`, padding: 20 },
  loginBox: { background: WHITE, borderRadius: 16, padding: '48px 40px', maxWidth: 420, width: '100%', boxShadow: '0 24px 80px rgba(0,0,0,0.3)' },
  header: { background: NAVY, padding: '16px 28px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', position: 'sticky', top: 0, zIndex: 100 },
  logoText: { color: GOLD, fontSize: 18, fontWeight: 700, letterSpacing: 1.2 },
  logoSub: { color: 'rgba(255,255,255,0.5)', fontSize: 11, letterSpacing: 2, marginTop: 2 },
  content: { maxWidth: 1100, margin: '0 auto', padding: '32px 24px' },
  card: { background: WHITE, borderRadius: 12, padding: 28, boxShadow: '0 2px 12px rgba(0,0,0,0.06)', marginBottom: 20 },
  btn: { background: GOLD, color: WHITE, border: 'none', borderRadius: 8, padding: '12px 28px', fontSize: 14, fontWeight: 600, cursor: 'pointer' },
  btnSm: { background: GOLD, color: WHITE, border: 'none', borderRadius: 6, padding: '6px 16px', fontSize: 12, fontWeight: 600, cursor: 'pointer' },
  btnOutline: { background: 'transparent', color: NAVY, border: `2px solid ${NAVY}`, borderRadius: 8, padding: '10px 24px', fontSize: 14, fontWeight: 600, cursor: 'pointer' },
  btnDanger: { background: 'transparent', color: RED, border: `1px solid ${RED}`, borderRadius: 6, padding: '6px 14px', fontSize: 12, cursor: 'pointer' },
  btnGreen: { background: GREEN, color: WHITE, border: 'none', borderRadius: 6, padding: '6px 16px', fontSize: 12, fontWeight: 600, cursor: 'pointer' },
  btnRed: { background: RED, color: WHITE, border: 'none', borderRadius: 6, padding: '6px 16px', fontSize: 12, fontWeight: 600, cursor: 'pointer' },
  btnGray: { background: '#F3F4F6', color: MID_GRAY, border: `1px solid ${LIGHT_GRAY}`, borderRadius: 6, padding: '6px 16px', fontSize: 12, fontWeight: 600, cursor: 'pointer' },
  input: { width: '100%', padding: '12px 16px', border: `1px solid ${LIGHT_GRAY}`, borderRadius: 8, fontSize: 14, outline: 'none', boxSizing: 'border-box' },
  textarea: { width: '100%', padding: '12px 16px', border: `1px solid ${LIGHT_GRAY}`, borderRadius: 8, fontSize: 14, outline: 'none', boxSizing: 'border-box', resize: 'vertical', minHeight: 60 },
  select: { width: '100%', padding: '12px 16px', border: `1px solid ${LIGHT_GRAY}`, borderRadius: 8, fontSize: 14, outline: 'none', background: WHITE, boxSizing: 'border-box' },
  label: { display: 'block', fontSize: 13, fontWeight: 600, color: NAVY, marginBottom: 6 },
  badge: (l) => ({ display: 'inline-block', padding: '4px 12px', borderRadius: 20, fontSize: 11, fontWeight: 700, background: l === 'HIGH' || l === 'EXCLUDED' ? '#FEE2E2' : l === 'MODERATE' || l === 'SILENT' ? '#FEF3C7' : l === 'LOW' || l === 'AFFIRMATIVE' ? '#DCFCE7' : '#F3F4F6', color: l === 'HIGH' || l === 'EXCLUDED' ? RED : l === 'MODERATE' || l === 'SILENT' ? ORANGE : l === 'LOW' || l === 'AFFIRMATIVE' ? GREEN : MID_GRAY }),
  dropzone: { border: `2px dashed ${LIGHT_GRAY}`, borderRadius: 12, padding: 40, textAlign: 'center', cursor: 'pointer', background: '#FAFAFA' },
  tag: { display: 'inline-block', padding: '3px 10px', borderRadius: 4, fontSize: 11, fontWeight: 600 },
  sectionTitle: { fontSize: 13, fontWeight: 700, letterSpacing: 1.5, textTransform: 'uppercase', color: GOLD, marginBottom: 16 },
  stat: { textAlign: 'center', padding: 20 },
  statNum: { fontSize: 36, fontWeight: 700, color: NAVY, lineHeight: 1 },
  statLabel: { fontSize: 12, color: MID_GRAY, marginTop: 6 },
  draftBanner: { background: '#FEF3C7', border: `1px solid ${ORANGE}`, borderRadius: 8, padding: '14px 20px', marginBottom: 20, display: 'flex', alignItems: 'center', gap: 12, fontSize: 14, color: NAVY },
  validatedBanner: { background: '#DCFCE7', border: `1px solid ${GREEN}`, borderRadius: 8, padding: '14px 20px', marginBottom: 20, display: 'flex', alignItems: 'center', gap: 12, fontSize: 14, color: NAVY },
};

// =============== HELPERS ===============
const formatDate = (iso) => new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
const formatDateTime = (iso) => new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
const fileToBase64 = (file) => new Promise((resolve, reject) => { const r = new FileReader(); r.onload = () => resolve(r.result.split(',')[1]); r.onerror = reject; r.readAsDataURL(file); });

const calculateOverallRisk = (policies) => {
  const statuses = policies.map((p) => p.ai_status).filter(Boolean);
  if (statuses.includes('EXCLUDED')) return 'HIGH';
  if (statuses.includes('SILENT')) return 'MODERATE';
  if (statuses.every((s) => s === 'AFFIRMATIVE')) return 'LOW';
  return 'MODERATE';
};

// =============== MAIN APP ===============
export default function App() {
  const [authed, setAuthed] = useState(() => { try { return sessionStorage.getItem('aipat_auth') === 'true'; } catch { return false; } });
  const [pw, setPw] = useState('');
  const [pwErr, setPwErr] = useState('');
  const [screen, setScreen] = useState('dashboard');
  const [audits, setAudits] = useState([]);
  const [currentAuditId, setCurrentAuditId] = useState(null);
  const [currentAudit, setCurrentAudit] = useState(null);
  const [currentPolicies, setCurrentPolicies] = useState([]);
  const [activityLog, setActivityLog] = useState([]);
  const [loading, setLoading] = useState(false);
  const [loadMsg, setLoadMsg] = useState('');
  const [progress, setProgress] = useState({ current: 0, total: 0, label: '' });
  const [error, setError] = useState('');
  const [dbReady, setDbReady] = useState(false);

  // Validator name (persists in session)
  const [validatorName, setValidatorName] = useState(() => { try { return sessionStorage.getItem('aipat_validator') || ''; } catch { return ''; } });
  const [showValidatorPrompt, setShowValidatorPrompt] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [tempValidator, setTempValidator] = useState('');

  // New audit form
  const [clientName, setClientName] = useState('');
  const [clientIndustry, setClientIndustry] = useState('');
  const [clientContact, setClientContact] = useState('');
  const [clientEmail, setClientEmail] = useState('');
  const [consentName, setConsentName] = useState('');
  const [consentCompany, setConsentCompany] = useState('');
  const [consentChecked, setConsentChecked] = useState(false);
  const [uploadedFiles, setUploadedFiles] = useState([]);
  const fileInputRef = useRef(null);

  // =============== DATABASE OPS ===============
  useEffect(() => {
    if (authed) {
      loadAudits();
      setDbReady(true);
    }
  }, [authed]);

  const loadAudits = async () => {
    const { data, error } = await supabase
      .from('audits')
      .select('*')
      .eq('is_deleted', false)
      .order('created_at', { ascending: false });
    if (data) setAudits(data);
    if (error) console.error('Load error:', error);
  };

  const loadAuditDetail = async (auditId) => {
    const { data: audit } = await supabase.from('audits').select('*').eq('id', auditId).single();
    const { data: policies } = await supabase.from('audit_policies').select('*').eq('audit_id', auditId).order('created_at');
    if (audit) setCurrentAudit(audit);
    if (policies) setCurrentPolicies(policies);
  };

  const loadActivityLog = async (auditId) => {
    const query = supabase.from('activity_log').select('*').order('created_at', { ascending: false }).limit(200);
    if (auditId) query.eq('audit_id', auditId);
    const { data } = await query;
    if (data) setActivityLog(data);
  };

  const logActivity = async (auditId, action, actor, details = {}) => {
    await supabase.from('activity_log').insert({ audit_id: auditId, action, actor, details });
  };

  // =============== AUTH ===============
  const handleLogin = () => {
    if (pw === ACCESS_CODE) { setAuthed(true); setPwErr(''); try { sessionStorage.setItem('aipat_auth', 'true'); } catch {} }
    else setPwErr('Incorrect password');
  };

  const handleLogout = () => { setAuthed(false); try { sessionStorage.removeItem('aipat_auth'); } catch {} };

  const setValidator = (name) => {
    setValidatorName(name);
    try { sessionStorage.setItem('aipat_validator', name); } catch {}
  };

  // =============== FILE HANDLING ===============
  const handleFileUpload = (e) => {
    const files = Array.from(e.target.files).filter(f => f.type === 'application/pdf');
    setUploadedFiles((prev) => [...prev, ...files.map((f) => ({ id: Math.random().toString(36).substr(2, 9), name: f.name, size: f.size, file: f, policyType: '' }))]);
  };

  const handleDrop = (e) => {
    e.preventDefault();
    e.currentTarget.style.borderColor = LIGHT_GRAY;
    const files = Array.from(e.dataTransfer.files).filter(f => f.type === 'application/pdf');
    setUploadedFiles((prev) => [...prev, ...files.map((f) => ({ id: Math.random().toString(36).substr(2, 9), name: f.name, size: f.size, file: f, policyType: '' }))]);
  };

  // =============== ANALYSIS ===============
  const analyzePolicy = async (file, policyType, clientInfo) => {
    const base64Data = await fileToBase64(file.file);
    const response = await fetch('/api/analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        system: ANALYSIS_PROMPT,
        messages: [{
          role: 'user',
          content: [
            { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: base64Data } },
            { type: 'text', text: `Analyze this ${policyType} policy for ${clientInfo.name} (Industry: ${clientInfo.industry}). Find ALL AI-related exclusions, gaps, and coverage issues. Respond ONLY with JSON.` },
          ],
        }],
      }),
    });
    if (!response.ok) throw new Error(`Analysis failed (${response.status})`);
    const data = await response.json();
    const text = data.content?.map((i) => i.type === 'text' ? i.text : '').join('') || '';
    try { return JSON.parse(text.replace(/```json|```/g, '').trim()); }
    catch { return { error: 'Could not parse results', ai_status: 'UNKNOWN' }; }
  };

  const runFullAudit = async () => {
    if (!clientName || !clientIndustry || uploadedFiles.length === 0 || !consentChecked || !consentName) return;
    const untagged = uploadedFiles.filter((f) => !f.policyType);
    if (untagged.length > 0) { setError('Please assign a policy type to all uploaded files.'); return; }

    setError('');
    setLoading(true);
    setScreen('analyzing');

    // Create audit record
    const { data: audit, error: auditErr } = await supabase.from('audits').insert({
      client_name: clientName,
      client_industry: clientIndustry,
      client_contact: clientContact,
      client_email: clientEmail,
      file_count: uploadedFiles.length,
      consent_name: consentName,
      consent_company: consentCompany,
      consent_statement: CONSENT_TEXT,
      consent_timestamp: new Date().toISOString(),
    }).select().single();

    if (auditErr || !audit) { setError('Failed to create audit record.'); setLoading(false); setScreen('new-audit'); return; }

    await logActivity(audit.id, 'AUDIT_CREATED', validatorName || 'System', { client: clientName, industry: clientIndustry, file_count: uploadedFiles.length });
    await logActivity(audit.id, 'CONSENT_RECORDED', consentName, { consent_name: consentName, consent_company: consentCompany });

    // Analyze each policy
    const total = uploadedFiles.length;
    for (let i = 0; i < total; i++) {
      const file = uploadedFiles[i];
      const typeLabel = POLICY_TYPES.find((p) => p.id === file.policyType)?.label || file.policyType;
      setProgress({ current: i + 1, total, label: typeLabel });
      setLoadMsg(`Analyzing ${typeLabel}...`);

      let result;
      try {
        result = await analyzePolicy(file, typeLabel, { name: clientName, industry: clientIndustry });
      } catch (err) {
        result = { error: err.message, ai_status: 'ERROR' };
      }

      // Add IDs to findings and gaps if missing
      if (result.findings) result.findings = result.findings.map((f, idx) => ({ ...f, id: f.id || `f${idx + 1}` }));
      if (result.coverage_gaps) result.coverage_gaps = result.coverage_gaps.map((g, idx) => typeof g === 'string' ? { id: `g${idx + 1}`, description: g } : { ...g, id: g.id || `g${idx + 1}` });

      await supabase.from('audit_policies').insert({
        audit_id: audit.id,
        file_name: file.name,
        policy_type: file.policyType,
        ai_raw_output: result,
        ai_status: result.ai_status || 'UNKNOWN',
        risk_level: result.risk_level || null,
      });

      await logActivity(audit.id, 'POLICY_ANALYZED', 'System', { file: file.name, policy_type: typeLabel, ai_status: result.ai_status });
    }

    // Calculate overall risk
    const { data: policies } = await supabase.from('audit_policies').select('ai_status').eq('audit_id', audit.id);
    const risk = calculateOverallRisk(policies || []);
    await supabase.from('audits').update({ overall_risk: risk }).eq('id', audit.id);

    // Reset form and navigate
    setClientName(''); setClientIndustry(''); setClientContact(''); setClientEmail('');
    setConsentName(''); setConsentCompany(''); setConsentChecked(false); setUploadedFiles([]);
    setLoading(false);
    setCurrentAuditId(audit.id);
    await loadAuditDetail(audit.id);
    await loadAudits();
    setScreen('report');
  };

  // =============== VALIDATION ===============
  const validateFinding = async (policyId, findingId, status, notes = '') => {
    if (!validatorName) { setShowValidatorPrompt(true); return; }

    const policy = currentPolicies.find((p) => p.id === policyId);
    if (!policy) return;

    const raw = policy.ai_raw_output;
    const validated = policy.validated_output || JSON.parse(JSON.stringify(raw));

    if (validated.findings) {
      validated.findings = validated.findings.map((f) => {
        if (f.id === findingId) {
          return { ...f, validation_status: status, validated_by: validatorName, validated_at: new Date().toISOString(), validation_notes: notes, original_description: status === 'MODIFIED' ? f.description : undefined };
        }
        return f;
      });
    }

    await supabase.from('audit_policies').update({ validated_output: validated }).eq('id', policyId);
    await logActivity(currentAudit.id, `FINDING_${status}`, validatorName, { policy_file: policy.file_name, finding_id: findingId, notes });

    // Refresh
    await loadAuditDetail(currentAudit.id);
  };

  const validateGap = async (policyId, gapId, status) => {
    if (!validatorName) { setShowValidatorPrompt(true); return; }

    const policy = currentPolicies.find((p) => p.id === policyId);
    if (!policy) return;

    const validated = policy.validated_output || JSON.parse(JSON.stringify(policy.ai_raw_output));
    if (validated.coverage_gaps) {
      validated.coverage_gaps = validated.coverage_gaps.map((g) => {
        if (g.id === gapId) return { ...g, validation_status: status, validated_by: validatorName, validated_at: new Date().toISOString() };
        return g;
      });
    }

    await supabase.from('audit_policies').update({ validated_output: validated }).eq('id', policyId);
    await logActivity(currentAudit.id, `GAP_${status}`, validatorName, { policy_file: policy.file_name, gap_id: gapId });
    await loadAuditDetail(currentAudit.id);
  };

  const canFinalize = () => {
    if (!currentPolicies.length) return false;
    for (const p of currentPolicies) {
      const v = p.validated_output || p.ai_raw_output;
      if (v.findings?.some((f) => !f.validation_status)) return false;
      if (v.coverage_gaps?.some((g) => !g.validation_status)) return false;
    }
    return true;
  };

  const finalizeAudit = async () => {
    if (!validatorName) { setShowValidatorPrompt(true); return; }
    if (!canFinalize()) return;

    await supabase.from('audits').update({ status: 'VALIDATED', validated_by: validatorName, validated_at: new Date().toISOString() }).eq('id', currentAudit.id);
    await logActivity(currentAudit.id, 'AUDIT_VALIDATED', validatorName, {});
    await loadAuditDetail(currentAudit.id);
    await loadAudits();
  };

  // =============== SOFT DELETE ===============
  const softDeleteAudit = async (id) => {
    if (!window.confirm('Archive this audit? It will be hidden but preserved for compliance.')) return;
    await supabase.from('audits').update({ is_deleted: true }).eq('id', id);
    await logActivity(id, 'AUDIT_ARCHIVED', validatorName || 'Unknown', {});
    await loadAudits();
  };

  // =============== EXPORT / BACKUP ===============
  const exportAllData = async () => {
    const { data: allAudits } = await supabase.from('audits').select('*').order('created_at', { ascending: false });
    const { data: allPolicies } = await supabase.from('audit_policies').select('*').order('created_at');
    const { data: allActivity } = await supabase.from('activity_log').select('*').order('created_at', { ascending: false }).limit(5000);

    const exportData = {
      exported_at: new Date().toISOString(),
      exported_by: validatorName || 'Unknown',
      audits: allAudits || [],
      policies: allPolicies || [],
      activity_log: allActivity || [],
    };

    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `ai-audit-backup-${new Date().toISOString().split('T')[0]}.json`;
    a.click();
    URL.revokeObjectURL(url);

    await logActivity(null, 'DATA_EXPORTED', validatorName || 'Unknown', { record_count: (allAudits?.length || 0) + (allPolicies?.length || 0) });
  };

  // =============== NAVIGATE ===============
  const openAudit = async (id) => {
    setCurrentAuditId(id);
    await loadAuditDetail(id);
    setScreen('report');
  };

  const openActivityLog = async (auditId) => {
    await loadActivityLog(auditId || null);
    setScreen('activity');
  };

  // =============== RENDER: LOGIN ===============
  if (!authed) {
    return (
      <div style={S.loginWrap}>
        <div style={S.loginBox}>
          <div style={{ textAlign: 'center', marginBottom: 32 }}>
            <div style={{ fontSize: 14, fontWeight: 700, letterSpacing: 2, color: GOLD, marginBottom: 8 }}>THE AI INSURANCE GROUP</div>
            <div style={{ fontSize: 26, fontWeight: 700, color: NAVY, marginBottom: 8 }}>Policy Audit Tool</div>
            <div style={{ fontSize: 14, color: MID_GRAY }}>AI-powered coverage gap analysis</div>
          </div>
          <div style={{ marginBottom: 20 }}>
            <label style={S.label}>Password</label>
            <input type="password" style={S.input} value={pw} onChange={(e) => setPw(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && handleLogin()} placeholder="Enter access password" />
            {pwErr && <div style={{ color: RED, fontSize: 13, marginTop: 8 }}>{pwErr}</div>}
          </div>
          <button style={{ ...S.btn, width: '100%' }} onClick={handleLogin}>Sign In</button>
          <div style={{ textAlign: 'center', marginTop: 24, fontSize: 11, color: MID_GRAY }}>Authorized personnel only. All activity is logged.</div>
        </div>
      </div>
    );
  }

 const HelpModal = () => !showHelp ? null : (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', zIndex: 2000, overflow: 'auto' }}>
      <div style={{ maxWidth: 800, margin: '40px auto', background: WHITE, borderRadius: 16, padding: '40px 36px', position: 'relative', maxHeight: '90vh', overflow: 'auto' }}>
        <button onClick={() => setShowHelp(false)} style={{ position: 'sticky', top: 0, float: 'right', background: NAVY, color: WHITE, border: 'none', borderRadius: 8, padding: '8px 16px', cursor: 'pointer', fontSize: 14, fontWeight: 600, zIndex: 10 }}>✕ Close</button>
        <div style={{ fontSize: 13, fontWeight: 700, letterSpacing: 2, color: GOLD, marginBottom: 8 }}>THE AI INSURANCE GROUP</div>
        <h1 style={{ fontSize: 28, fontWeight: 700, color: NAVY, marginBottom: 4 }}>AI Policy Audit Tool</h1>
        <p style={{ fontSize: 14, color: MID_GRAY, marginBottom: 24 }}>Standard Operating Procedure</p>
        <div style={{ borderTop: `2px solid ${GOLD}`, paddingTop: 24 }}>
          <h2 style={{ fontSize: 20, fontWeight: 700, color: NAVY, marginTop: 24, marginBottom: 8 }}>Overview</h2>
          <p style={{ fontSize: 14, lineHeight: 1.7, color: '#333', marginBottom: 12 }}>This tool analyzes commercial insurance policies to identify AI-related exclusions, coverage gaps, and endorsements. Claude AI scans every page and produces a structured analysis that you validate before delivering to the client.</p>
          <p style={{ fontSize: 14, lineHeight: 1.7, color: '#333', marginBottom: 12 }}><strong>Scans for:</strong> Verisk ISO forms (CG 40 47, CG 40 48, CG 35 08), carrier-specific exclusions (W.R. Berkley PC 51380, Cincinnati Financial, Hamilton, Philadelphia, AIG), sublimits, definition changes, silent gaps, and affirmative AI endorsements.</p>
          <p style={{ fontSize: 14, lineHeight: 1.7, color: '#333', marginBottom: 12 }}><strong>Policy types:</strong> GL, E&O, D&O, Cyber, EPLI, Products/Completed Ops.</p>
          <p style={{ fontSize: 14, lineHeight: 1.7, color: '#333', marginBottom: 12 }}><strong>Time:</strong> ~10 min AI analysis + ~20 min validation = ~30 min total per audit.</p>
          <div style={{ background: LIGHT_GOLD, borderLeft: `3px solid ${GOLD}`, padding: '12px 16px', borderRadius: 4, fontSize: 13, color: NAVY, margin: '16px 0', fontStyle: 'italic' }}>Important: The AI generates a draft. You must review every finding. Your professional judgment is the final word.</div>
          <h2 style={{ fontSize: 20, fontWeight: 700, color: NAVY, marginTop: 32, marginBottom: 12 }}>Step-by-Step Process</h2>
          {[
            { n: '1', t: 'Log In', d: 'Go to audit.theaiinsurancegroup.com. Enter the password and click Sign In. Enter your full name when prompted — it is recorded on all actions.' },
            { n: '2', t: 'Start a New Audit', d: 'Click + New Audit on the Dashboard.' },
            { n: '3', t: 'Enter Client Information', d: 'Enter client/company name exactly as on policies. Select industry. Optionally add contact name and email.' },
            { n: '4', t: 'Capture Client Authorization', d: 'Type the client\'s full name (electronic signature), company, and check the authorization box. You MUST have their actual verbal or written authorization first. Timestamped and stored permanently.' },
            { n: '5', t: 'Upload Policy Documents', d: 'Drag/drop or click to upload PDFs. Tag each file with the correct policy type (GL, E&O, D&O, Cyber, EPLI, Products). Every file must be tagged. Request full policies, not just dec pages.' },
            { n: '6', t: 'Run AI Analysis', d: 'Click "Run AI Coverage Audit." Each policy takes 1–2 minutes. Do not close the browser tab.' },
            { n: '7', t: 'Review Draft Report', d: 'Report opens in DRAFT status (yellow banner). Statuses: ⛔ AI EXCLUDED = confirmed gap. ⚠️ SILENT = ambiguous gap. 🔶 PARTIAL = limited. ✅ COVERED = affirmative.' },
            { n: '8', t: 'Validate Findings', d: '✓ Confirm = accurate. ✗ Reject = wrong/false positive. ✏ Modify = partially correct (add a note). Read each finding before validating.' },
            { n: '9', t: 'Validate Coverage Gaps', d: '✓ Confirm = real gap. ✗ Reject = not applicable to this client.' },
            { n: '10', t: 'Finalize Audit', d: 'Once all items reviewed, click green "Finalize Audit" button. Status changes to VALIDATED with your name and timestamp.' },
            { n: '11', t: 'Print / Save as PDF', d: 'Click "Print / Save as PDF." Select Save as PDF in your browser. This is your client deliverable.' },
            { n: '12', t: 'Present to Client', d: 'Walk through the report: overall risk → policy-by-policy findings → gaps → recommendations → next steps for placing coverage.' },
          ].map((step) => (
            <div key={step.n} style={{ display: 'flex', gap: 14, marginBottom: 16 }}>
              <div style={{ width: 32, height: 32, borderRadius: '50%', background: NAVY, color: WHITE, display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: 14, flexShrink: 0 }}>{step.n}</div>
              <div><div style={{ fontSize: 15, fontWeight: 700, color: NAVY, marginBottom: 4 }}>{step.t}</div><div style={{ fontSize: 14, lineHeight: 1.6, color: '#333' }}>{step.d}</div></div>
            </div>
          ))}
          <h2 style={{ fontSize: 20, fontWeight: 700, color: NAVY, marginTop: 32, marginBottom: 12 }}>Compliance Rules</h2>
          {['Never deliver a DRAFT report to a client.', 'Never fabricate client consent.', 'Never present AI analysis as a coverage determination.', 'Validate every finding — do not bulk-confirm withou
  // =============== RENDER: VALIDATOR PROMPT MODAL ===============
  const ValidatorModal = () => showValidatorPrompt ? (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
      <div style={{ background: WHITE, borderRadius: 16, padding: 32, maxWidth: 420, width: '90%', boxShadow: '0 24px 80px rgba(0,0,0,0.3)' }}>
        <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 8 }}>Validator Identification</div>
        <div style={{ fontSize: 14, color: MID_GRAY, marginBottom: 20 }}>Your name will be recorded on all validation actions for compliance purposes.</div>
        <label style={S.label}>Full Name</label>
        <input style={S.input} value={tempValidator} onChange={(e) => setTempValidator(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && tempValidator.trim()) { setValidator(tempValidator.trim()); setShowValidatorPrompt(false); setTempValidator(''); } }} placeholder="e.g. Sal Martorano" autoFocus />
        <div style={{ display: 'flex', gap: 12, marginTop: 20 }}>
          <button style={S.btn} onClick={() => { if (tempValidator.trim()) { setValidator(tempValidator.trim()); setShowValidatorPrompt(false); setTempValidator(''); } }}>Confirm</button>
          <button style={S.btnOutline} onClick={() => { setShowValidatorPrompt(false); setTempValidator(''); }}>Cancel</button>
        </div>
      </div>
    </div>
  ) : null;

  // =============== RENDER: HEADER ===============
  const Header = ({ backLabel, onBack, extra }) => (
    <div style={S.header} className="no-print">
      <div><div style={S.logoText}>AI POLICY AUDIT TOOL</div><div style={S.logoSub}>THE AI INSURANCE GROUP</div></div>
      <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
       <HelpModal />
        <button onClick={() => setShowHelp(true)} style={{ background: 'transparent', color: GOLD, border: '1px solid #B8972A', borderRadius: 6, padding: '6px 14px', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>📖 How To Use</button>
        {validatorName && <span style={{ color: 'rgba(255,255,255,0.4)', fontSize: 12 }}>Validator: {validatorName}</span>}
        {extra}
        {onBack && <button style={{ ...S.btnOutline, color: WHITE, borderColor: 'rgba(255,255,255,0.3)', fontSize: 13 }} onClick={onBack}>{backLabel || '← Back'}</button>}
      </div>
    </div>
  );

  // =============== RENDER: ANALYZING ===============
  if (screen === 'analyzing' && loading) {
    const pct = progress.total > 0 ? (progress.current / progress.total) * 100 : 0;
    return (
      <div style={S.app}><Header />
        <div style={{ ...S.content, display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '60vh' }}>
          <div style={{ textAlign: 'center', maxWidth: 500 }}>
            <div style={{ width: 64, height: 64, border: `4px solid ${LIGHT_GRAY}`, borderTopColor: GOLD, borderRadius: '50%', margin: '0 auto 24px', animation: 'spin 1s linear infinite' }} />
            <div style={{ fontSize: 22, fontWeight: 700, marginBottom: 8 }}>Analyzing Policies</div>
            <div style={{ fontSize: 14, color: MID_GRAY, marginBottom: 24 }}>{loadMsg}</div>
            <div style={{ background: LIGHT_GRAY, borderRadius: 8, height: 8, overflow: 'hidden', marginBottom: 12 }}>
              <div style={{ background: GOLD, height: '100%', width: `${pct}%`, borderRadius: 8, transition: 'width 0.5s' }} />
            </div>
            <div style={{ fontSize: 13, color: MID_GRAY }}>Policy {progress.current} of {progress.total}</div>
            <div style={{ marginTop: 32, padding: 20, background: LIGHT_GOLD, borderRadius: 8, fontSize: 13, lineHeight: 1.6 }}>
              Scanning for Verisk CG 40 47, CG 40 48, CG 35 08, W.R. Berkley PC 51380, carrier-specific exclusions, sublimits, definition changes, and silent coverage gaps...
            </div>
          </div>
        </div>
      </div>
    );
  }

  // =============== RENDER: ACTIVITY LOG ===============
  if (screen === 'activity') {
    return (
      <div style={S.app}><Header backLabel="← Dashboard" onBack={() => setScreen('dashboard')} /><ValidatorModal />
        <div style={S.content}>
          <div style={{ fontSize: 24, fontWeight: 700, marginBottom: 8 }}>Activity Log</div>
          <div style={{ fontSize: 14, color: MID_GRAY, marginBottom: 24 }}>Complete compliance trail of all audit actions</div>
          <div style={S.card}>
            {activityLog.length === 0 ? <div style={{ textAlign: 'center', padding: 40, color: MID_GRAY }}>No activity recorded yet.</div> : (
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead>
                  <tr style={{ borderBottom: `2px solid ${LIGHT_GRAY}` }}>
                    <th style={{ textAlign: 'left', padding: '10px 8px', color: MID_GRAY, fontWeight: 600 }}>Timestamp</th>
                    <th style={{ textAlign: 'left', padding: '10px 8px', color: MID_GRAY, fontWeight: 600 }}>Action</th>
                    <th style={{ textAlign: 'left', padding: '10px 8px', color: MID_GRAY, fontWeight: 600 }}>Actor</th>
                    <th style={{ textAlign: 'left', padding: '10px 8px', color: MID_GRAY, fontWeight: 600 }}>Details</th>
                  </tr>
                </thead>
                <tbody>
                  {activityLog.map((a) => (
                    <tr key={a.id} style={{ borderBottom: `1px solid ${LIGHT_GRAY}` }}>
                      <td style={{ padding: '10px 8px', whiteSpace: 'nowrap' }}>{formatDateTime(a.created_at)}</td>
                      <td style={{ padding: '10px 8px' }}><span style={{ ...S.tag, background: a.action.includes('VALIDATED') || a.action.includes('CONFIRMED') ? '#DCFCE7' : a.action.includes('REJECTED') ? '#FEE2E2' : LIGHT_GOLD, color: a.action.includes('VALIDATED') || a.action.includes('CONFIRMED') ? GREEN : a.action.includes('REJECTED') ? RED : GOLD }}>{a.action}</span></td>
                      <td style={{ padding: '10px 8px' }}>{a.actor || '—'}</td>
                      <td style={{ padding: '10px 8px', color: MID_GRAY, maxWidth: 300, overflow: 'hidden', textOverflow: 'ellipsis' }}>{a.details ? JSON.stringify(a.details).substring(0, 100) : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </div>
    );
  }

  // =============== RENDER: REPORT ===============
  if (screen === 'report' && currentAudit) {
    const a = currentAudit;
    const isDraft = a.status === 'DRAFT';
    const totalFindings = currentPolicies.reduce((sum, p) => sum + (p.ai_raw_output?.findings?.length || 0), 0);
    const totalGaps = currentPolicies.reduce((sum, p) => sum + (p.ai_raw_output?.coverage_gaps?.length || 0), 0);
    const exclusionCount = currentPolicies.filter((p) => p.ai_status === 'EXCLUDED').length;

    // Count validated items
    let validatedCount = 0, totalItems = 0;
    currentPolicies.forEach((p) => {
      const v = p.validated_output || p.ai_raw_output;
      (v.findings || []).forEach((f) => { totalItems++; if (f.validation_status) validatedCount++; });
      (v.coverage_gaps || []).forEach((g) => { totalItems++; if (g.validation_status) validatedCount++; });
    });

    return (
      <div style={S.app}><Header backLabel="← Dashboard" onBack={() => { setCurrentAudit(null); setScreen('dashboard'); }} extra={
        <button style={{ ...S.btnSm, background: 'transparent', color: 'rgba(255,255,255,0.6)', border: '1px solid rgba(255,255,255,0.2)' }} onClick={() => openActivityLog(a.id)}>📋 Audit Trail</button>
      } /><ValidatorModal />

        <div style={S.content}>
          {/* Status Banner */}
          {isDraft ? (
            <div style={S.draftBanner}>
              <span style={{ fontSize: 20 }}>⚠️</span>
              <div style={{ flex: 1 }}>
                <strong>DRAFT — Pending Validation</strong>
                <div style={{ fontSize: 13, color: MID_GRAY, marginTop: 2 }}>
                  {validatedCount} of {totalItems} items reviewed. All findings and gaps must be confirmed, rejected, or modified before this report can be finalized.
                </div>
              </div>
              {canFinalize() && <button style={S.btnGreen} onClick={finalizeAudit}>✓ Finalize Audit</button>}
            </div>
          ) : (
            <div style={S.validatedBanner}>
              <span style={{ fontSize: 20 }}>✅</span>
              <div>
                <strong>VALIDATED</strong> by {a.validated_by} on {formatDateTime(a.validated_at)}
              </div>
            </div>
          )}

          {/* Report Header */}
          <div style={{ ...S.card, background: NAVY, color: WHITE, padding: '36px 32px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 16 }}>
              <div>
                <div style={{ fontSize: 13, color: GOLD, fontWeight: 600, letterSpacing: 1.5, marginBottom: 8 }}>AI COVERAGE AUDIT REPORT</div>
                <div style={{ fontSize: 28, fontWeight: 700, marginBottom: 4 }}>{a.client_name}</div>
                <div style={{ fontSize: 14, color: 'rgba(255,255,255,0.6)' }}>{a.client_industry} &bull; {formatDate(a.created_at)}</div>
              </div>
              <div style={{ ...S.badge(a.overall_risk), fontSize: 14, padding: '8px 20px' }}>{a.overall_risk} RISK</div>
            </div>
          </div>

          {/* Stats */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16, marginBottom: 20 }}>
            {[
              { num: currentPolicies.length, label: 'Policies Analyzed' },
              { num: totalFindings, label: 'AI Findings' },
              { num: exclusionCount, label: 'Explicit Exclusions' },
              { num: totalGaps, label: 'Coverage Gaps' },
            ].map((st, i) => (
              <div key={i} style={{ ...S.card, ...S.stat }}><div style={S.statNum}>{st.num}</div><div style={S.statLabel}>{st.label}</div></div>
            ))}
          </div>

          {/* Policy Results */}
          {currentPolicies.map((policy) => {
            const typeInfo = POLICY_TYPES.find((p) => p.id === policy.policy_type);
            const raw = policy.ai_raw_output;
            const v = policy.validated_output || raw;

            return (
              <div key={policy.id} style={S.card}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20, flexWrap: 'wrap', gap: 8 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <span style={{ fontSize: 24 }}>{typeInfo?.icon || '📄'}</span>
                    <div>
                      <div style={{ fontSize: 18, fontWeight: 700 }}>{typeInfo?.label || raw.policy_type || 'Policy'}</div>
                      <div style={{ fontSize: 12, color: MID_GRAY }}>{policy.file_name}{raw.carrier ? ` \u2022 ${raw.carrier}` : ''}</div>
                    </div>
                  </div>
                  <div style={S.badge(policy.ai_status)}>
                    {policy.ai_status === 'EXCLUDED' ? '⛔ AI EXCLUDED' : policy.ai_status === 'SILENT' ? '⚠️ SILENT ON AI' : policy.ai_status === 'PARTIAL' ? '🔶 PARTIAL' : policy.ai_status === 'AFFIRMATIVE' ? '✅ AI COVERED' : '❓ UNKNOWN'}
                  </div>
                </div>

                {raw.summary && <div style={{ padding: 16, background: LIGHT_GOLD, borderRadius: 8, fontSize: 14, lineHeight: 1.7, marginBottom: 16, borderLeft: `3px solid ${GOLD}` }}>{raw.summary}</div>}

                {/* Findings with validation */}
                {v.findings?.length > 0 && (
                  <div style={{ marginBottom: 16 }}>
                    <div style={S.sectionTitle}>Findings</div>
                    {v.findings.map((f) => {
                      const vs = f.validation_status;
                      const bgColor = vs === 'REJECTED' ? '#F9FAFB' : f.type === 'EXCLUSION' ? '#FEF2F2' : f.type === 'SILENT_GAP' ? '#FFFBEB' : f.type === 'AFFIRMATIVE' ? '#F0FDF4' : '#F9FAFB';
                      const borderColor = vs === 'REJECTED' ? LIGHT_GRAY : f.type === 'EXCLUSION' ? RED : f.type === 'SILENT_GAP' ? ORANGE : f.type === 'AFFIRMATIVE' ? GREEN : LIGHT_GRAY;

                      return (
                        <div key={f.id} style={{ padding: 14, background: bgColor, borderRadius: 8, marginBottom: 8, borderLeft: `3px solid ${borderColor}`, opacity: vs === 'REJECTED' ? 0.5 : 1 }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8, flexWrap: 'wrap' }}>
                            <div style={{ flex: 1 }}>
                              <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 6, flexWrap: 'wrap' }}>
                                <span style={{ ...S.tag, background: f.type === 'EXCLUSION' ? '#FEE2E2' : f.type === 'SILENT_GAP' ? '#FEF3C7' : LIGHT_GOLD, color: f.type === 'EXCLUSION' ? RED : f.type === 'SILENT_GAP' ? ORANGE : GOLD }}>{f.type?.replace('_', ' ')}</span>
                                {f.form_number && <span style={{ fontSize: 12, color: MID_GRAY, fontFamily: 'monospace' }}>{f.form_number}</span>}
                                {vs && <span style={{ ...S.tag, background: vs === 'CONFIRMED' ? '#DCFCE7' : vs === 'REJECTED' ? '#FEE2E2' : '#FEF3C7', color: vs === 'CONFIRMED' ? GREEN : vs === 'REJECTED' ? RED : ORANGE }}>
                                  {vs === 'CONFIRMED' ? '✓ Confirmed' : vs === 'REJECTED' ? '✗ Rejected' : '✏ Modified'} by {f.validated_by}
                                </span>}
                              </div>
                              <div style={{ fontSize: 14, fontWeight: 600, color: NAVY, marginBottom: 4 }}>{f.description}</div>
                              {f.impact && <div style={{ fontSize: 13, color: MID_GRAY, lineHeight: 1.5 }}>{f.impact}</div>}
                              {f.validation_notes && <div style={{ fontSize: 12, color: NAVY, marginTop: 6, fontStyle: 'italic', background: '#F9FAFB', padding: '6px 10px', borderRadius: 4 }}>Note: {f.validation_notes}</div>}
                            </div>

                            {/* Validation buttons - only show in DRAFT mode */}
                            {isDraft && !vs && (
                              <div style={{ display: 'flex', gap: 6, flexShrink: 0 }} className="no-print">
                                <button style={S.btnGreen} onClick={() => validateFinding(policy.id, f.id, 'CONFIRMED')}>✓ Confirm</button>
                                <button style={S.btnRed} onClick={() => validateFinding(policy.id, f.id, 'REJECTED')}>✗ Reject</button>
                                <button style={S.btnGray} onClick={() => {
                                  const notes = prompt('Add a note about this modification:');
                                  if (notes !== null) validateFinding(policy.id, f.id, 'MODIFIED', notes);
                                }}>✏ Modify</button>
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}

                {/* Coverage Gaps with validation */}
                {v.coverage_gaps?.length > 0 && (
                  <div style={{ marginBottom: 16 }}>
                    <div style={S.sectionTitle}>Coverage Gaps</div>
                    {v.coverage_gaps.map((g) => {
                      const gs = g.validation_status;
                      return (
                        <div key={g.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8, padding: '10px 14px', background: gs === 'REJECTED' ? '#F9FAFB' : '#FEF2F2', borderRadius: 8, opacity: gs === 'REJECTED' ? 0.5 : 1 }}>
                          <div style={{ display: 'flex', gap: 10, alignItems: 'center', flex: 1 }}>
                            <span style={{ color: RED, fontSize: 16 }}>✗</span>
                            <span style={{ fontSize: 14 }}>{g.description}</span>
                            {gs && <span style={{ ...S.tag, fontSize: 10, background: gs === 'CONFIRMED' ? '#DCFCE7' : '#FEE2E2', color: gs === 'CONFIRMED' ? GREEN : RED }}>
                              {gs === 'CONFIRMED' ? '✓' : '✗'} {g.validated_by}
                            </span>}
                          </div>
                          {isDraft && !gs && (
                            <div style={{ display: 'flex', gap: 6 }} className="no-print">
                              <button style={S.btnGreen} onClick={() => validateGap(policy.id, g.id, 'CONFIRMED')}>✓</button>
                              <button style={S.btnRed} onClick={() => validateGap(policy.id, g.id, 'REJECTED')}>✗</button>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}

                {/* Recommendations */}
                {raw.recommendations?.length > 0 && (
                  <div>
                    <div style={S.sectionTitle}>Recommendations</div>
                    {raw.recommendations.map((rec, ri) => (
                      <div key={ri} style={{ display: 'flex', gap: 10, marginBottom: 8, fontSize: 14, lineHeight: 1.5 }}>
                        <span style={{ color: GREEN, flexShrink: 0 }}>→</span><span>{typeof rec === 'string' ? rec : rec.description}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}

          {/* Consent Record */}
          {a.consent_name && (
            <div style={{ ...S.card, background: '#F9FAFB', borderLeft: `3px solid ${MID_GRAY}` }}>
              <div style={S.sectionTitle}>Client Authorization on File</div>
              <div style={{ fontSize: 13, lineHeight: 1.6, color: MID_GRAY }}>
                <strong style={{ color: NAVY }}>{a.consent_name}</strong>{a.consent_company ? ` (${a.consent_company})` : ''} authorized this review on {formatDateTime(a.consent_timestamp)}.
              </div>
            </div>
          )}

          {/* Footer Actions */}
          <div style={{ ...S.card, background: NAVY, color: WHITE, textAlign: 'center', padding: 36 }} className="no-print">
            <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 20 }}>
              {isDraft ? 'Review all findings above, then finalize.' : 'Audit validated and ready for client delivery.'}
            </div>
            <div style={{ display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap' }}>
              {!isDraft && <button style={S.btn} onClick={() => window.print()}>Print / Save as PDF</button>}
              {isDraft && canFinalize() && <button style={{ ...S.btn, background: GREEN }} onClick={finalizeAudit}>✓ Finalize Audit</button>}
              <button style={{ ...S.btnOutline, color: WHITE, borderColor: 'rgba(255,255,255,0.3)' }} onClick={() => { setCurrentAudit(null); setScreen('dashboard'); }}>Back to Dashboard</button>
            </div>
          </div>

          <div style={{ textAlign: 'center', marginTop: 16, fontSize: 11, color: MID_GRAY }}>
            This report was generated using AI-assisted analysis{a.status === 'VALIDATED' ? ` and validated by ${a.validated_by}` : ''}. It is not a coverage determination. Final coverage interpretations should be confirmed with the issuing carrier. The AI Insurance Group provides coverage gap identification services through its broker relationship with Alexander Capital Insurance.
          </div>
        </div>
      </div>
    );
  }

  // =============== RENDER: NEW AUDIT ===============
  if (screen === 'new-audit') {
    const formReady = clientName && clientIndustry && consentChecked && consentName && uploadedFiles.length > 0 && uploadedFiles.every((f) => f.policyType);
    return (
      <div style={S.app}><Header backLabel="← Cancel" onBack={() => setScreen('dashboard')} /><ValidatorModal />
        <div style={S.content}>
          <div style={{ fontSize: 24, fontWeight: 700, marginBottom: 8 }}>New Coverage Audit</div>
          <div style={{ fontSize: 14, color: MID_GRAY, marginBottom: 32 }}>Upload client policy documents for AI coverage gap analysis</div>

          {error && <div style={{ padding: 14, background: '#FEF2F2', borderRadius: 8, color: RED, fontSize: 14, marginBottom: 20 }}>{error}</div>}

          {/* Client Info */}
          <div style={S.card}>
            <div style={S.sectionTitle}>Client Information</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
              <div><label style={S.label}>Client / Company Name *</label><input style={S.input} value={clientName} onChange={(e) => setClientName(e.target.value)} placeholder="e.g. Smith & Associates LLP" /></div>
              <div><label style={S.label}>Industry *</label>
                <select style={S.select} value={clientIndustry} onChange={(e) => setClientIndustry(e.target.value)}>
                  <option value="">Select industry...</option>
                  {INDUSTRIES.map((ind) => <option key={ind} value={ind}>{ind}</option>)}
                </select>
              </div>
              <div><label style={S.label}>Contact Name</label><input style={S.input} value={clientContact} onChange={(e) => setClientContact(e.target.value)} placeholder="Primary contact" /></div>
              <div><label style={S.label}>Contact Email</label><input style={S.input} value={clientEmail} onChange={(e) => setClientEmail(e.target.value)} placeholder="email@company.com" /></div>
            </div>
          </div>

          {/* Client Consent */}
          <div style={{ ...S.card, borderLeft: `3px solid ${GOLD}` }}>
            <div style={S.sectionTitle}>Client Authorization *</div>
            <div style={{ fontSize: 13, lineHeight: 1.7, color: MID_GRAY, padding: 16, background: '#F9FAFB', borderRadius: 8, marginBottom: 16 }}>{CONSENT_TEXT}</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
              <div><label style={S.label}>Authorizing Person's Full Name *</label><input style={S.input} value={consentName} onChange={(e) => setConsentName(e.target.value)} placeholder="Client's full name (typed signature)" /></div>
              <div><label style={S.label}>Company</label><input style={S.input} value={consentCompany} onChange={(e) => setConsentCompany(e.target.value)} placeholder="Company name" /></div>
            </div>
            <label style={{ display: 'flex', gap: 10, alignItems: 'flex-start', cursor: 'pointer', fontSize: 14 }}>
              <input type="checkbox" checked={consentChecked} onChange={(e) => setConsentChecked(e.target.checked)} style={{ marginTop: 3, width: 18, height: 18, accentColor: GOLD }} />
              <span>I confirm that the above-named individual has authorized The AI Insurance Group to review their commercial insurance policies for AI-related coverage gaps.</span>
            </label>
          </div>

          {/* File Upload */}
          <div style={S.card}>
            <div style={S.sectionTitle}>Policy Documents</div>
            <div
              style={S.dropzone}
              onClick={() => fileInputRef.current?.click()}
              onDragOver={(e) => { e.preventDefault(); e.currentTarget.style.borderColor = GOLD; e.currentTarget.style.background = LIGHT_GOLD; }}
              onDragLeave={(e) => { e.preventDefault(); e.currentTarget.style.borderColor = LIGHT_GRAY; e.currentTarget.style.background = '#FAFAFA'; }}
              onDrop={handleDrop}
            >
              <div style={{ fontSize: 36, marginBottom: 8 }}>📄</div>
              <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 4 }}>Drop policy PDFs here or click to browse</div>
              <div style={{ fontSize: 13, color: MID_GRAY }}>Upload GL, E&O, D&O, Cyber, EPLI, and Products policies.</div>
              <input ref={fileInputRef} type="file" accept=".pdf" multiple style={{ display: 'none' }} onChange={handleFileUpload} />
            </div>
            {uploadedFiles.length > 0 && (
              <div style={{ marginTop: 20 }}>
                {uploadedFiles.map((file) => (
                  <div key={file.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px', background: '#FAFAFA', borderRadius: 8, marginBottom: 8, flexWrap: 'wrap' }}>
                    <span style={{ fontSize: 20 }}>📄</span>
                    <div style={{ flex: 1, minWidth: 150 }}>
                      <div style={{ fontSize: 14, fontWeight: 600 }}>{file.name}</div>
                      <div style={{ fontSize: 11, color: MID_GRAY }}>{(file.size / 1024).toFixed(0)} KB</div>
                    </div>
                    <select style={{ ...S.select, width: 'auto', minWidth: 200, padding: '8px 12px', fontSize: 13, borderColor: file.policyType ? GREEN : ORANGE }} value={file.policyType} onChange={(e) => setUploadedFiles((prev) => prev.map((f) => f.id === file.id ? { ...f, policyType: e.target.value } : f))}>
                      <option value="">Tag policy type...</option>
                      {POLICY_TYPES.map((p) => <option key={p.id} value={p.id}>{p.icon} {p.label}</option>)}
                    </select>
                    <button style={{ background: 'none', border: 'none', color: RED, cursor: 'pointer', fontSize: 18 }} onClick={() => setUploadedFiles((prev) => prev.filter((f) => f.id !== file.id))}>×</button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Submit */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div style={{ fontSize: 13, color: MID_GRAY }}>
              {uploadedFiles.length} {uploadedFiles.length === 1 ? 'policy' : 'policies'}
              {!consentChecked && <span style={{ color: ORANGE }}> &bull; Client authorization required</span>}
            </div>
            <button style={{ ...S.btn, opacity: formReady ? 1 : 0.4, padding: '14px 36px', fontSize: 16 }} onClick={runFullAudit} disabled={!formReady}>
              🔍 Run AI Coverage Audit
            </button>
          </div>
        </div>
      </div>
    );
  }

  // =============== RENDER: DASHBOARD ===============
  return (
    <div style={S.app}><Header extra={
      <div style={{ display: 'flex', gap: 8 }}>
        <button style={{ ...S.btnSm, background: 'transparent', color: 'rgba(255,255,255,0.6)', border: '1px solid rgba(255,255,255,0.2)' }} onClick={() => openActivityLog()}>📋 Activity Log</button>
        <button style={{ ...S.btnSm, background: 'transparent', color: 'rgba(255,255,255,0.6)', border: '1px solid rgba(255,255,255,0.2)' }} onClick={exportAllData}>💾 Export Backup</button>
        <button style={{ ...S.btn, padding: '8px 20px' }} onClick={() => setScreen('new-audit')}>+ New Audit</button>
        <button style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,0.4)', cursor: 'pointer', fontSize: 12 }} onClick={handleLogout}>Sign Out</button>
      </div>
    } /><ValidatorModal />

      <div style={S.content}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 32 }}>
          <div>
            <div style={{ fontSize: 24, fontWeight: 700, marginBottom: 4 }}>Audit Dashboard</div>
            <div style={{ fontSize: 14, color: MID_GRAY }}>AI-powered commercial insurance coverage gap analysis</div>
          </div>
          {!validatorName && (
            <button style={S.btnOutline} onClick={() => setShowValidatorPrompt(true)}>Set Validator Name</button>
          )}
        </div>

        {/* Stats */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16, marginBottom: 28 }}>
          <div style={{ ...S.card, ...S.stat }}><div style={S.statNum}>{audits.length}</div><div style={S.statLabel}>Total Audits</div></div>
          <div style={{ ...S.card, ...S.stat }}><div style={{ ...S.statNum, color: RED }}>{audits.filter((a) => a.overall_risk === 'HIGH').length}</div><div style={S.statLabel}>High Risk</div></div>
          <div style={{ ...S.card, ...S.stat }}><div style={{ ...S.statNum, color: GREEN }}>{audits.filter((a) => a.status === 'VALIDATED').length}</div><div style={S.statLabel}>Validated</div></div>
          <div style={{ ...S.card, ...S.stat }}><div style={{ ...S.statNum, color: ORANGE }}>{audits.filter((a) => a.status === 'DRAFT').length}</div><div style={S.statLabel}>Drafts Pending</div></div>
        </div>

        {/* Audit List */}
        {audits.length === 0 ? (
          <div style={{ ...S.card, textAlign: 'center', padding: '60px 32px' }}>
            <div style={{ fontSize: 48, marginBottom: 16 }}>📋</div>
            <div style={{ fontSize: 20, fontWeight: 700, marginBottom: 8 }}>No Audits Yet</div>
            <div style={{ fontSize: 14, color: MID_GRAY, maxWidth: 400, margin: '0 auto 24px' }}>Upload a client's commercial insurance policies to identify AI-related exclusions and coverage gaps.</div>
            <button style={S.btn} onClick={() => setScreen('new-audit')}>+ Start First Audit</button>
          </div>
        ) : (
          <div>
            <div style={S.sectionTitle}>All Audits</div>
            {audits.map((audit) => (
              <div key={audit.id} style={{ ...S.card, cursor: 'pointer' }} onClick={() => openAudit(audit.id)}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
                  <div>
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                      <div style={{ fontSize: 17, fontWeight: 700 }}>{audit.client_name}</div>
                      <span style={{ ...S.tag, background: audit.status === 'VALIDATED' ? '#DCFCE7' : '#FEF3C7', color: audit.status === 'VALIDATED' ? GREEN : ORANGE, fontSize: 10 }}>{audit.status}</span>
                    </div>
                    <div style={{ fontSize: 13, color: MID_GRAY, marginTop: 4 }}>
                      {audit.client_industry} &bull; {audit.file_count} policies &bull; {formatDate(audit.created_at)}
                      {audit.validated_by && ` \u2022 Validated by ${audit.validated_by}`}
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <span style={S.badge(audit.overall_risk)}>{audit.overall_risk} RISK</span>
                    <button style={S.btnDanger} onClick={(e) => { e.stopPropagation(); softDeleteAudit(audit.id); }}>Archive</button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        <div style={{ textAlign: 'center', marginTop: 24, fontSize: 11, color: MID_GRAY }}>
          &copy; 2026 The AI Insurance Group. All audit data is stored securely and retained for compliance. Policy analysis powered by Claude AI.
        </div>
      </div>
    </div>
  );
}
