import React, { useState, useEffect, useRef } from 'react';
import { supabase } from './supabase';

const NAVY = '#1A2B45', GOLD = '#B8972A', DARK_BG = '#0F1923', LIGHT_BG = '#F8F6F1';
const WHITE = '#FFFFFF', LIGHT_GOLD = '#F5EFE0', MID_GRAY = '#6B7280', LIGHT_GRAY = '#E5E7EB';
const RED = '#DC2626', GREEN = '#16A34A', ORANGE = '#EA580C';

const ACCESS_CODE = 'AuditTool2026!';

const POLICY_TYPES = [
  { id: 'auto', label: 'Auto-Detect (AI will identify)', icon: '🔍' },
  { id: 'gl', label: 'General Liability (CGL)', icon: '🛡️' },
  { id: 'eo', label: 'Errors & Omissions (E&O)', icon: '⚖️' },
  { id: 'do', label: 'Directors & Officers (D&O)', icon: '🏛️' },
  { id: 'cyber', label: 'Cyber Liability', icon: '🔒' },
  { id: 'epli', label: 'Employment Practices (EPLI)', icon: '👥' },
  { id: 'products', label: 'Products / Completed Ops', icon: '📦' },
];
const INDUSTRIES = [
    'Financial Services / Wealth Management', 'Healthcare / Medical', 'Legal / Law Firm',
    'Technology / SaaS', 'Media / Entertainment / Streaming', 'Digital Services / Software',
    'Insurance / Brokerage', 'Manufacturing', 'Professional Services',
    'Retail / E-Commerce', 'Real Estate', 'Construction',
    'Hospitality / Food Service', 'Transportation / Logistics',
    'Nonprofit', 'Education', 'Other',
  ];

const CONSENT_TEXT = 'I authorize The AI Insurance Group to review and analyze the commercial insurance policy documents provided herein for the purpose of identifying AI-related coverage gaps, exclusions, and endorsements. I understand that this analysis is for informational purposes only and does not constitute a coverage determination, legal advice, or binding coverage opinion. Final coverage interpretations should be confirmed with the issuing carrier(s). I confirm that I am authorized to share these policy documents for review purposes.';

const ANALYSIS_PROMPT = `You are an expert insurance policy analyst specializing in AI-related exclusions, endorsements, coverage gaps, and general commercial insurance adequacy.

  YOUR TASK: Read the entire policy document and perform TWO analyses:

  PART 1 — AI COVERAGE ANALYSIS:
  Identify ALL provisions related to artificial intelligence, machine learning, automated decision-making, algorithms, generative AI, or large language models.

  FORMS TO FIND:
  - CG 40 47 01 26: Exclusion Generative AI (BI/PD)
  - CG 40 48 01 26: Exclusion Generative AI Coverage B Only
  - CG 35 08 01 26: Exclusion Generative AI (broader)
  - W.R. Berkley PC 51380: Absolute AI exclusion
  - Cincinnati Financial, Hamilton, Philadelphia Insurance, AIG AI exclusions
  - Any carrier-specific AI or technology exclusions

  LANGUAGE PATTERNS: artificial intelligence, AI, machine learning, automated decision, automated system, algorithm, generative AI, large language model, LLM, neural network, deep learning, chatbot, virtual assistant, computer-generated content, technology services exclusion

  FLAG: sublimits on tech claims, modified professional services definitions excluding AI, modified wrongful act definitions, cyber exclusions missing AI, D&O tech governance exclusions, EPLI automated hiring exclusions, products liability software exclusions, policy dates, silent coverage (no AI mention = gap)

  PART 2 — GENERAL COVERAGE REVIEW:
  Analyze the policy for common coverage adequacy issues unrelated to AI:

  LIMITS ADEQUACY:
  - Flag GL limits below $1M/$2M occurrence/aggregate
  - Flag professional liability limits below $1M
  - Flag cyber liability limits below $1M
  - Flag umbrella/excess gaps if no umbrella is present
  - Compare limits against industry standards for the business size and type

  COVERAGE GAPS:
  - Missing hired/non-owned auto coverage
  - Missing employment practices liability (EPLI)
  - Missing cyber liability / data breach coverage
  - Missing business interruption / business income coverage
  - Missing waiver of subrogation where commonly required
  - Missing additional insured endorsements
  - Inadequate or missing products/completed operations coverage
  - No personal injury / advertising injury coverage
  - Missing employee benefits liability

  POLICY STRUCTURE ISSUES:
  - Claims-made policies without adequate retroactive dates
  - Sunset clauses or extended reporting period limitations
  - Unusually high deductibles or self-insured retentions
  - Restrictive definitions that narrow coverage
  - Named perils vs. all-risk / special form discrepancies
  - Outdated classification codes
  - Coinsurance penalties in property coverage
  - Gaps between policy periods (lapse exposure)

  PREMIUM INDICATORS:
  - Multiple carriers where bundling may reduce cost
  - Outdated endorsements that could be modernized
  - Missing loss-free credits or experience modifications
  - Coverage overlaps between policies (paying twice for same risk)

  RESPOND ONLY with this JSON:
  {
    "policy_type": "GL|EO|DO|Cyber|EPLI|Products|Other",
    "carrier": "carrier name",
    "policy_number": "if visible",
    "effective_date": "if visible",
    "expiration_date": "if visible",
    "ai_status": "EXCLUDED|SILENT|PARTIAL|AFFIRMATIVE",
    "risk_level": "HIGH|MODERATE|LOW",
    "findings": [{"type": "EXCLUSION|SUBLIMIT|DEFINITION_CHANGE|ENDORSEMENT|SILENT_GAP|AFFIRMATIVE", "form_number": "if identified or null", "description": "what was found", "policy_section": "where in policy", "impact": "what this means for AI claims", "verbatim_excerpt": "5-10 word key phrase"}],
    "coverage_gaps": ["specific gap descriptions"],
    "recommendations": ["specific recommendations"],
    "general_review": {
      "limits_assessment": "ADEQUATE|BELOW_STANDARD|REVIEW_NEEDED",
      "estimated_adequacy": "WELL_COVERED|GAPS_FOUND|UNDER_INSURED|OVER_INSURED",
      "general_findings": [{"category": "LIMITS|COVERAGE_GAP|STRUCTURE|PREMIUM", "issue": "what was found", "severity": "HIGH|MODERATE|LOW", "recommendation": "what to do about it"}],
      "general_summary": "2-3 sentence overview of non-AI coverage status"
    },
    "summary": "2-3 sentence executive summary covering BOTH AI and general coverage"
  }

  If not an insurance policy: {"error": "Not an insurance policy", "ai_status": "UNKNOWN"}
  Be thorough. Miss nothing.`;

const genId = () => Math.random().toString(36).substr(2, 9);
const fmtDate = (iso) => new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
const fmtDateTime = (iso) => new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });

const logActivity = async (auditId, action, details, performedBy = 'system') => {
  try { await supabase.from('activity_log').insert({ audit_id: auditId, action, details, actor: performedBy }); } catch (e) { console.error('Log error:', e); }
};

const fileToBase64 = (file) => new Promise((res, rej) => {
  const r = new FileReader(); r.onload = () => res(r.result.split(',')[1]); r.onerror = () => rej(new Error('Read failed')); r.readAsDataURL(file);
});

const calcRisk = (statuses) => {
  if (statuses.includes('EXCLUDED')) return 'HIGH';
  if (statuses.includes('SILENT')) return 'MODERATE';
  if (statuses.every(s => s === 'AFFIRMATIVE')) return 'LOW';
  return 'MODERATE';
};

// ============ CLIENT PORTAL (public, no auth) ============
function ClientPortal({ token }) {
  const [audit, setAudit] = useState(null);
  const [loadingAudit, setLoadingAudit] = useState(true);
  const [signerName, setSignerName] = useState('');
  const [signerTitle, setSignerTitle] = useState('');
  const [consentOk, setConsentOk] = useState(false);
  const [files, setFiles] = useState([]);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState('');
  const fileRef = useRef(null);

  useEffect(() => {
    (async () => {
      const { data } = await supabase.from('audits').select('*').eq('client_token', token).single();
      if (data) {
        if (data.client_submitted_at) setDone(true);
        setAudit(data);
      }
      setLoadingAudit(false);
    })();
  }, [token]);

  const handleFiles = (fileList) => {
    const pdfs = Array.from(fileList).filter(f => f.name.endsWith('.pdf'));
    setFiles(prev => [...prev, ...pdfs.map(f => ({ id: Math.random().toString(36).substr(2, 9), name: f.name, size: f.size, file: f, pt: '' }))]);
  };

  const submit = async () => {
    if (!signerName || !consentOk || files.length === 0) return;
    if (files.some(f => !f.pt)) { setError('Please tag each file with a policy type.'); return; }
    setSubmitting(true); setError('');

    try {
      // Record consent
      await supabase.from('audits').update({
        consent_name: signerName, consent_company: audit.client_name,
        consent_statement: CONSENT_TEXT, consent_timestamp: new Date().toISOString(),
        client_submitted_at: new Date().toISOString(), file_count: files.length,
        notes: signerTitle ? 'Signer title: ' + signerTitle : null,
      }).eq('id', audit.id);

      // Upload files to storage and create policy records
      for (const f of files) {
        const path = `${audit.id}/${f.id}_${f.name}`;
        const { error: upErr } = await supabase.storage.from('policies').upload(path, f.file);
        if (upErr) console.error('Upload error:', upErr);

        const lbl = POLICY_TYPES.find(p => p.id === f.pt)?.label || f.pt;
        await supabase.from('audit_policies').insert({
          audit_id: audit.id, policy_type: f.pt, file_name: f.name,
          file_size_bytes: f.size, storage_path: path, ai_status: 'PENDING',
          ai_raw_output: {}, validation_status: 'PENDING',
        });
      }

      await logActivity(audit.id, 'CLIENT_SUBMITTED', { signer: signerName, files: files.length }, signerName);
      setDone(true);
    } catch (e) { setError('Submission failed: ' + e.message); }
    setSubmitting(false);
  };

  const cS = {
    wrap: { minHeight: '100vh', background: `linear-gradient(135deg, ${DARK_BG} 0%, ${NAVY} 50%, #1e3a5f 100%)`, padding: '40px 20px' },
    box: { maxWidth: 700, margin: '0 auto', background: WHITE, borderRadius: 16, padding: '40px 36px', boxShadow: '0 24px 80px rgba(0,0,0,0.3)' },
  };

  if (loadingAudit) return <div style={cS.wrap}><div style={{ ...cS.box, textAlign: 'center' }}><div style={{ fontSize: 18, color: NAVY }}>Loading...</div></div></div>;
  if (!audit) return <div style={cS.wrap}><div style={{ ...cS.box, textAlign: 'center' }}><div style={{ fontSize: 20, fontWeight: 700, color: RED, marginBottom: 8 }}>Invalid Link</div><div style={{ fontSize: 14, color: MID_GRAY }}>This audit link is invalid or has expired. Please contact The AI Insurance Group.</div></div></div>;

  if (done) return (
    <div style={cS.wrap}><div style={{ ...cS.box, textAlign: 'center' }}>
      <div style={{ fontSize: 48, marginBottom: 16 }}>✅</div>
      <div style={{ fontSize: 24, fontWeight: 700, color: NAVY, marginBottom: 8 }}>Documents Received</div>
      <div style={{ fontSize: 14, color: MID_GRAY, lineHeight: 1.7, maxWidth: 450, margin: '0 auto' }}>
        Thank you. Your authorization and policy documents have been securely received. The AI Insurance Group will review your policies for AI-related coverage gaps and contact you with the results.
      </div>
      <div style={{ marginTop: 24, fontSize: 13, color: GOLD, fontWeight: 600 }}>THE AI INSURANCE GROUP</div>
    </div></div>
  );

  return (
    <div style={cS.wrap}>
      <div style={{ textAlign: 'center', marginBottom: 24 }}>
        <div style={{ fontSize: 13, fontWeight: 700, letterSpacing: 2, color: GOLD }}>THE AI INSURANCE GROUP</div>
        <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.5)', marginTop: 4 }}>Secure Document Portal</div>
      </div>
      <div style={cS.box}>
        <div style={{ fontSize: 22, fontWeight: 700, color: NAVY, marginBottom: 4 }}>AI Coverage Audit</div>
        <div style={{ fontSize: 14, color: MID_GRAY, marginBottom: 8 }}>for <strong>{audit.client_name}</strong></div>
        <div style={{ fontSize: 13, color: MID_GRAY, marginBottom: 24, lineHeight: 1.6 }}>
          Please review and sign the authorization below, then upload your commercial insurance policy documents. Your documents are encrypted and stored securely.
        </div>

        {error && <div style={{ padding: 14, background: '#FEF2F2', borderRadius: 8, color: RED, fontSize: 14, marginBottom: 20 }}>{error}</div>}

        <div style={{ border: '1px solid ' + GOLD, borderRadius: 12, padding: 24, marginBottom: 24 }}>
          <div style={{ fontSize: 13, fontWeight: 700, letterSpacing: 1.5, textTransform: 'uppercase', color: GOLD, marginBottom: 12 }}>Authorization</div>
          <div style={{ background: '#F9FAFB', borderRadius: 8, padding: 16, marginBottom: 16, fontSize: 13, lineHeight: 1.7, maxHeight: 150, overflowY: 'auto' }}>{CONSENT_TEXT}</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
            <div><label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: NAVY, marginBottom: 6 }}>Your Full Name (Electronic Signature) *</label>
              <input style={{ width: '100%', padding: '12px 16px', border: '1px solid ' + LIGHT_GRAY, borderRadius: 8, fontSize: 14, outline: 'none', boxSizing: 'border-box' }} value={signerName} onChange={e => setSignerName(e.target.value)} placeholder="Type your full name" /></div>
            <div><label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: NAVY, marginBottom: 6 }}>Title</label>
              <input style={{ width: '100%', padding: '12px 16px', border: '1px solid ' + LIGHT_GRAY, borderRadius: 8, fontSize: 14, outline: 'none', boxSizing: 'border-box' }} value={signerTitle} onChange={e => setSignerTitle(e.target.value)} placeholder="e.g. CFO, General Counsel" /></div>
          </div>
          <label style={{ display: 'flex', gap: 10, alignItems: 'flex-start', cursor: 'pointer', fontSize: 14 }}>
            <input type="checkbox" checked={consentOk} onChange={e => setConsentOk(e.target.checked)} style={{ marginTop: 3, width: 18, height: 18 }} />
            <span>I have read and agree to the above authorization.</span>
          </label>
        </div>

        <div style={{ marginBottom: 24 }}>
          <div style={{ fontSize: 13, fontWeight: 700, letterSpacing: 1.5, textTransform: 'uppercase', color: GOLD, marginBottom: 12 }}>Upload Policy Documents</div>
          <div style={{ fontSize: 13, color: MID_GRAY, marginBottom: 12 }}>Upload your commercial insurance policies as PDF files. Include as many as you have: General Liability, E&O, D&O, Cyber, EPLI, Products Liability.</div>
          <div style={{ border: '2px dashed ' + LIGHT_GRAY, borderRadius: 12, padding: 32, textAlign: 'center', cursor: 'pointer', background: '#FAFAFA' }}
            onClick={() => fileRef.current?.click()}
            onDragOver={e => { e.preventDefault(); e.currentTarget.style.borderColor = GOLD; }}
            onDragLeave={e => { e.preventDefault(); e.currentTarget.style.borderColor = LIGHT_GRAY; }}
            onDrop={e => { e.preventDefault(); e.currentTarget.style.borderColor = LIGHT_GRAY; handleFiles(e.dataTransfer.files); }}>
            <div style={{ fontSize: 32, marginBottom: 8 }}>📄</div>
            <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 4 }}>Drop PDFs here or click to browse</div>
            <input ref={fileRef} type="file" accept=".pdf" multiple style={{ display: 'none' }} onChange={e => handleFiles(e.target.files)} />
          </div>
          {files.length > 0 && <div style={{ marginTop: 16 }}>
            {files.map(f => (
              <div key={f.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 14px', background: '#FAFAFA', borderRadius: 8, marginBottom: 8, flexWrap: 'wrap' }}>
                <span>📄</span>
                <div style={{ flex: 1, minWidth: 120 }}><div style={{ fontSize: 14, fontWeight: 600 }}>{f.name}</div><div style={{ fontSize: 11, color: MID_GRAY }}>{(f.size / 1024).toFixed(0)} KB</div></div>
                <select style={{ padding: '8px 12px', border: '1px solid ' + (f.pt ? GREEN : ORANGE), borderRadius: 8, fontSize: 13, background: WHITE }} value={f.pt} onChange={e => setFiles(prev => prev.map(x => x.id === f.id ? { ...x, pt: e.target.value } : x))}>
                  <option value="">Select policy type...</option>{POLICY_TYPES.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}
                </select>
                <button style={{ background: 'none', border: 'none', color: RED, cursor: 'pointer', fontSize: 18 }} onClick={() => setFiles(prev => prev.filter(x => x.id !== f.id))}>×</button>
              </div>
            ))}
          </div>}
        </div>

        <button onClick={submit} disabled={!signerName || !consentOk || files.length === 0 || submitting}
          style={{ width: '100%', background: GOLD, color: WHITE, border: 'none', borderRadius: 8, padding: '14px 28px', fontSize: 16, fontWeight: 600, cursor: 'pointer', opacity: (!signerName || !consentOk || files.length === 0 || submitting) ? 0.4 : 1 }}>
          {submitting ? 'Uploading...' : '🔒 Submit Authorization & Documents'}
        </button>
        <div style={{ textAlign: 'center', marginTop: 16, fontSize: 11, color: MID_GRAY }}>Your documents are encrypted and stored securely. © 2026 The AI Insurance Group.</div>
      </div>
    </div>
  );
}

const S = {
  app: { fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif", background: LIGHT_BG, minHeight: '100vh', color: NAVY },
  loginWrap: { display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', background: `linear-gradient(135deg, ${DARK_BG} 0%, ${NAVY} 100%)`, padding: 20 },
  loginBox: { background: WHITE, borderRadius: 16, padding: '48px 40px', maxWidth: 420, width: '100%', boxShadow: '0 24px 80px rgba(0,0,0,0.3)' },
  header: { background: NAVY, padding: '16px 28px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', position: 'sticky', top: 0, zIndex: 100, flexWrap: 'wrap', gap: 8 },
  content: { maxWidth: 1100, margin: '0 auto', padding: '32px 24px' },
  card: { background: WHITE, borderRadius: 12, padding: 28, boxShadow: '0 2px 12px rgba(0,0,0,0.06)', marginBottom: 20 },
  btn: { background: GOLD, color: WHITE, border: 'none', borderRadius: 8, padding: '12px 28px', fontSize: 14, fontWeight: 600, cursor: 'pointer' },
  btnSm: { background: GOLD, color: WHITE, border: 'none', borderRadius: 6, padding: '8px 16px', fontSize: 13, fontWeight: 600, cursor: 'pointer' },
  btnOut: { background: 'transparent', color: WHITE, border: '1px solid rgba(255,255,255,0.3)', borderRadius: 8, padding: '10px 24px', fontSize: 13, fontWeight: 600, cursor: 'pointer' },
  btnGreen: { background: GREEN, color: WHITE, border: 'none', borderRadius: 8, padding: '12px 28px', fontSize: 15, fontWeight: 600, cursor: 'pointer' },
  btnRed: { background: 'transparent', color: RED, border: '1px solid ' + RED, borderRadius: 6, padding: '6px 14px', fontSize: 12, cursor: 'pointer' },
  btnGhost: { background: 'none', border: 'none', color: 'rgba(255,255,255,0.5)', cursor: 'pointer', fontSize: 12 },
  input: { width: '100%', padding: '12px 16px', border: '1px solid ' + LIGHT_GRAY, borderRadius: 8, fontSize: 14, outline: 'none', boxSizing: 'border-box' },
  select: { width: '100%', padding: '12px 16px', border: '1px solid ' + LIGHT_GRAY, borderRadius: 8, fontSize: 14, outline: 'none', background: WHITE, boxSizing: 'border-box' },
  label: { display: 'block', fontSize: 13, fontWeight: 600, color: NAVY, marginBottom: 6 },
  badge: (l) => ({ display: 'inline-block', padding: '4px 12px', borderRadius: 20, fontSize: 11, fontWeight: 700, background: l === 'HIGH' ? '#FEE2E2' : l === 'MODERATE' ? '#FEF3C7' : l === 'LOW' ? '#DCFCE7' : '#F3F4F6', color: l === 'HIGH' ? RED : l === 'MODERATE' ? ORANGE : l === 'LOW' ? GREEN : MID_GRAY }),
  stBadge: (st) => ({ display: 'inline-block', padding: '4px 12px', borderRadius: 20, fontSize: 11, fontWeight: 700, background: st === 'DRAFT' ? '#FEF3C7' : st === 'VALIDATED' ? '#DCFCE7' : '#F3F4F6', color: st === 'DRAFT' ? ORANGE : st === 'VALIDATED' ? GREEN : MID_GRAY }),
  dropzone: { border: '2px dashed ' + LIGHT_GRAY, borderRadius: 12, padding: 40, textAlign: 'center', cursor: 'pointer', background: '#FAFAFA' },
  tag: { display: 'inline-block', padding: '3px 10px', borderRadius: 4, fontSize: 11, fontWeight: 600, background: LIGHT_GOLD, color: GOLD },
  sec: { fontSize: 13, fontWeight: 700, letterSpacing: 1.5, textTransform: 'uppercase', color: GOLD, marginBottom: 16 },
  stat: { textAlign: 'center', padding: 20 },
  statN: { fontSize: 36, fontWeight: 700, color: NAVY, lineHeight: 1 },
  statL: { fontSize: 12, color: MID_GRAY, marginTop: 6 },
};

export default function App() {
  // Check for client portal token in URL
  const urlParams = new URLSearchParams(window.location.search);
  const clientToken = urlParams.get('token');
  if (clientToken) return <ClientPortal token={clientToken} />;

  const [authed, setAuthed] = useState(() => { try { return localStorage.getItem('aipat2') === 'true'; } catch { return false; } });
  const [pw, setPw] = useState('');
  const [authErr, setAuthErr] = useState('');
  const [screen, setScreen] = useState('dashboard');
  const [audits, setAudits] = useState([]);
  const [curAudit, setCurAudit] = useState(null);
  const [curPolicies, setCurPolicies] = useState([]);
  const [loading, setLoading] = useState(false);
  const [loadMsg, setLoadMsg] = useState('');
  const [progress, setProgress] = useState({ c: 0, t: 0, l: '' });
  const [error, setError] = useState('');
  const [actLog, setActLog] = useState([]);

  const [clientName, setClientName] = useState('');
  const [clientInd, setClientInd] = useState('');
  const [clientContact, setClientContact] = useState('');
  const [clientEmail, setClientEmail] = useState('');
  const [consentOk, setConsentOk] = useState(false);
  const [signerName, setSignerName] = useState('');
  const [signerTitle, setSignerTitle] = useState('');
  const [files, setFiles] = useState([]);
  const fileRef = useRef(null);

  const [valName, setValName] = useState('');
  const [showHelp, setShowHelp] = useState(false);
  const [fActions, setFActions] = useState({});
  const [fNotes, setFNotes] = useState({});
  const [clientLink, setClientLink] = useState('');

  useEffect(() => { if (authed) loadAudits(); }, [authed]);

  const loadAudits = async () => {
    const { data } = await supabase.from('audits').select('*').is('deleted_at', null).order('created_at', { ascending: false });
    setAudits(data || []);
  };

  const loadPolicies = async (id) => {
    const { data } = await supabase.from('audit_policies').select('*').eq('audit_id', id).order('created_at');
    return data || [];
  };

  const login = () => {
    if (pw === ACCESS_CODE) { setAuthed(true); setAuthErr(''); try { localStorage.setItem('aipat2', 'true'); } catch {} }
    else setAuthErr('Incorrect password');
  };

  const logout = () => { setAuthed(false); try { localStorage.setItem('aipat2', 'false'); } catch {} };

  const openAudit = async (audit) => {
    const pols = await loadPolicies(audit.id);
    setCurAudit(audit); setCurPolicies(pols);
    const a = {}, n = {};
    pols.forEach((p, pi) => {
      const out = p.validated_output || p.ai_raw_output;
      (out?.findings || []).forEach((_, fi) => { a[`${pi}-${fi}`] = p.validation_status === 'VALIDATED' ? 'CONFIRMED' : ''; n[`${pi}-${fi}`] = ''; });
    });
    setFActions(a); setFNotes(n); setValName(''); setError('');
    setScreen('report');
  };

  const handleFiles = (fileList) => {
    const pdfs = Array.from(fileList).filter(f => f.name.endsWith('.pdf'));
    setFiles(prev => [...prev, ...pdfs.map(f => ({ id: genId(), name: f.name, size: f.size, file: f, pt: '' }))]);
  };

  const setPT = (id, pt) => setFiles(prev => prev.map(f => f.id === id ? { ...f, pt } : f));
  const rmFile = (id) => setFiles(prev => prev.filter(f => f.id !== id));

  const runAudit = async () => {
   if (!clientName || !clientInd || !files.length) return;
    if (files.some(f => !f.pt)) { setError('Tag all files with a policy type.'); return; }
    setError(''); setLoading(true); setScreen('analyzing');

    const { data: audit, error: err } = await supabase.from('audits').insert({
      client_name: clientName, client_industry: clientInd, client_contact: clientContact,
      client_email: clientEmail, status: 'DRAFT', file_count: files.length, created_by: 'operator',
    }).select().single();

    if (err || !audit) { setError('Failed to create audit.'); setLoading(false); setScreen('new-audit'); return; }

    await supabase.from('client_consents').insert({
      audit_id: audit.id, client_name: signerName, client_title: signerTitle,
      client_company: clientName, client_email: clientEmail, consent_text: CONSENT_TEXT, signed_name: signerName,
    });
    await logActivity(audit.id, 'AUDIT_CREATED', { client: clientName, files: files.length }, 'operator');
    await logActivity(audit.id, 'CONSENT_SIGNED', { signer: signerName }, signerName);

    const statuses = [];
    for (let i = 0; i < files.length; i++) {
      const f = files[i];
      const lbl = POLICY_TYPES.find(p => p.id === f.pt)?.label || f.pt;
      setProgress({ c: i + 1, t: files.length, l: lbl });
      setLoadMsg('Analyzing ' + lbl + '...');

      let result;
      try {
        const b64 = await fileToBase64(f.file);
        const resp = await fetch('/api/analyze', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ system: ANALYSIS_PROMPT, messages: [{ role: 'user', content: [
            { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: b64 } },
            { type: 'text', text: 'Analyze this ' + lbl + ' policy for ' + clientName + ' (Industry: ' + clientInd + '). Find ALL AI-related exclusions, gaps, and coverage issues. Respond ONLY with JSON.' },
          ] }] }),
        });
        if (!resp.ok) throw new Error('API error ' + resp.status);
        const data = await resp.json();
        const txt = data.content?.map(c => c.type === 'text' ? c.text : '').join('') || '';
        result = JSON.parse(txt.replace(/```json|```/g, '').trim());
      } catch (e) { result = { error: e.message, ai_status: 'ERROR' }; }

      statuses.push(result.ai_status || 'UNKNOWN');
      await supabase.from('audit_policies').insert({
        audit_id: audit.id, policy_type: f.pt, file_name: f.name, file_size_bytes: f.size,
        carrier: result.carrier || null, policy_number: result.policy_number || null,
        effective_date: result.effective_date || null, expiration_date: result.expiration_date || null,
        ai_status: result.ai_status || 'UNKNOWN', risk_level: result.risk_level || null,
        ai_raw_output: result, summary: result.summary || null, validation_status: 'PENDING',
      });
      await logActivity(audit.id, 'POLICY_ANALYZED', { type: lbl, file: f.name, status: result.ai_status, findings: result.findings?.length || 0 }, 'system');
    }

    const risk = calcRisk(statuses);
    await supabase.from('audits').update({ overall_risk: risk }).eq('id', audit.id);
    audit.overall_risk = risk;

    await loadAudits();
    const pols = await loadPolicies(audit.id);
    setCurAudit(audit); setCurPolicies(pols);
    setLoading(false); setScreen('report');
    setClientName(''); setClientInd(''); setClientContact(''); setClientEmail('');
    setConsentOk(false); setSignerName(''); setSignerTitle(''); setFiles([]);
    const a = {};
    pols.forEach((p, pi) => (p.ai_raw_output?.findings || []).forEach((_, fi) => { a[pi + '-' + fi] = ''; }));
    setFActions(a); setFNotes({}); setValName('');
  };

  const allReviewed = () => {
    for (let pi = 0; pi < curPolicies.length; pi++) {
      const findings = curPolicies[pi].ai_raw_output?.findings || [];
      for (let fi = 0; fi < findings.length; fi++) { if (!fActions[pi + '-' + fi]) return false; }
    }
    return curPolicies.length > 0;
  };

  const validateAudit = async () => {
    if (!valName.trim()) { setError('Enter your name to validate.'); return; }
    if (!allReviewed()) { setError('Review all findings first.'); return; }
    setError('');
    const now = new Date().toISOString();

    for (let pi = 0; pi < curPolicies.length; pi++) {
      const pol = curPolicies[pi];
      const raw = pol.ai_raw_output || {};
      const findings = raw.findings || [];
      const validated = [];

      for (let fi = 0; fi < findings.length; fi++) {
        const k = pi + '-' + fi, act = fActions[k], note = fNotes[k] || '';
        await supabase.from('finding_validations').insert({
          policy_id: pol.id, finding_index: fi, action: act,
          original_finding: findings[fi], modified_finding: act === 'MODIFIED' ? { ...findings[fi], _note: note } : null,
          validator_name: valName, notes: note,
        });
        if (act !== 'REJECTED') validated.push(act === 'MODIFIED' ? { ...findings[fi], _validator_note: note } : findings[fi]);
        await logActivity(curAudit.id, 'FINDING_' + act, { type: pol.policy_type, idx: fi, desc: findings[fi].description }, valName);
      }

      await supabase.from('audit_policies').update({
        validated_output: { ...raw, findings: validated }, validation_status: 'VALIDATED',
        validated_by: valName, validated_at: now,
      }).eq('id', pol.id);
    }

    await supabase.from('audits').update({ status: 'VALIDATED', validated_by: valName, validated_at: now }).eq('id', curAudit.id);
    await logActivity(curAudit.id, 'REPORT_VALIDATED', { validator: valName, policies: curPolicies.length }, valName);

    await loadAudits();
    const updated = { ...curAudit, status: 'VALIDATED', validated_by: valName, validated_at: now };
    const pols = await loadPolicies(curAudit.id);
    setCurAudit(updated); setCurPolicies(pols);
  };

  const softDel = async (id) => {
    if (!window.confirm('Archive this audit? Hidden but preserved for compliance.')) return;
    await supabase.from('audits').update({ deleted_at: new Date().toISOString() }).eq('id', id);
    await logActivity(id, 'AUDIT_ARCHIVED', {}, 'operator');
    await loadAudits();
  };

  const sendToClient = async () => {
    if (!clientName || !clientInd) return;
    setError('');
    const token = genId() + genId() + genId();
    const { data: audit, error: err } = await supabase.from('audits').insert({
      client_name: clientName, client_industry: clientInd, client_contact: clientContact,
      client_email: clientEmail, status: 'DRAFT', file_count: 0, client_token: token,
    }).select().single();
    if (err || !audit) { setError('Failed to create audit: ' + (err?.message || '')); return; }
    await logActivity(audit.id, 'CLIENT_LINK_CREATED', { client: clientName }, 'operator');
    const link = window.location.origin + '?token=' + token;
    setClientLink(link);
    await loadAudits();
    setClientName(''); setClientInd(''); setClientContact(''); setClientEmail('');
  };

  const runAuditFromStorage = async (audit) => {
    const pols = await loadPolicies(audit.id);
    if (!pols.length) { setError('No documents uploaded by client yet.'); return; }
    setLoading(true); setScreen('analyzing');
    setCurAudit(audit);

    const statuses = [];
    for (let i = 0; i < pols.length; i++) {
      const pol = pols[i];
      if (pol.ai_status !== 'PENDING') { statuses.push(pol.ai_status); continue; }
      const lbl = POLICY_TYPES.find(p => p.id === pol.policy_type)?.label || pol.policy_type;
      setProgress({ c: i + 1, t: pols.length, l: lbl });
      setLoadMsg('Analyzing ' + lbl + '...');

      let result;
      try {
        const { data: fileData } = await supabase.storage.from('policies').download(pol.storage_path);
        if (!fileData) throw new Error('Could not download file');
        const b64 = await new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result.split(',')[1]); r.onerror = rej; r.readAsDataURL(fileData); });
        const resp = await fetch('/api/analyze', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ system: ANALYSIS_PROMPT, messages: [{ role: 'user', content: [
            { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: b64 } },
            { type: 'text', text: 'Analyze this ' + lbl + ' policy for ' + audit.client_name + ' (Industry: ' + audit.client_industry + '). Find ALL AI-related exclusions, gaps, and coverage issues. Respond ONLY with JSON.' },
          ] }] }),
        });
        if (!resp.ok) throw new Error('API error ' + resp.status);
        const data = await resp.json();
        const txt = data.content?.map(c => c.type === 'text' ? c.text : '').join('') || '';
        result = JSON.parse(txt.replace(/```json|```/g, '').trim());
      } catch (e) { result = { error: e.message, ai_status: 'ERROR' }; }

      statuses.push(result.ai_status || 'UNKNOWN');
      await supabase.from('audit_policies').update({
        ai_status: result.ai_status || 'UNKNOWN', risk_level: result.risk_level || null,
        ai_raw_output: result, summary: result.summary || null, carrier: result.carrier || null,
        policy_number: result.policy_number || null,
      }).eq('id', pol.id);
      await logActivity(audit.id, 'POLICY_ANALYZED', { type: lbl, file: pol.file_name, status: result.ai_status }, 'system');
    }

    const risk = calcRisk(statuses);
    await supabase.from('audits').update({ overall_risk: risk, file_count: pols.length }).eq('id', audit.id);
    audit.overall_risk = risk; audit.file_count = pols.length;

    await loadAudits();
    const updatedPols = await loadPolicies(audit.id);
    setCurAudit(audit); setCurPolicies(updatedPols);
    setLoading(false); setScreen('report');
    const a = {};
    updatedPols.forEach((p, pi) => (p.ai_raw_output?.findings || []).forEach((_, fi) => { a[pi + '-' + fi] = ''; }));
    setFActions(a); setFNotes({}); setValName('');
  };

  const exportBackup = async () => {
    try {
      const resp = await fetch('/api/export');
      const data = await resp.json();
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a'); a.href = url;
      a.download = 'audit-backup-' + new Date().toISOString().split('T')[0] + '.json';
      a.click(); URL.revokeObjectURL(url);
    } catch (e) { alert('Export failed: ' + e.message); }
  };

  const loadLog = async (auditId) => {
    const q = auditId
      ? supabase.from('activity_log').select('*').eq('audit_id', auditId).order('created_at', { ascending: false }).limit(100)
      : supabase.from('activity_log').select('*').order('created_at', { ascending: false }).limit(200);
    const { data } = await q;
    setActLog(data || []);
  };

  // ============ LOGIN ============
  if (!authed) return (
    <div style={S.loginWrap}>
      <div style={S.loginBox}>
        <div style={{ textAlign: 'center', marginBottom: 32 }}>
          <div style={{ fontSize: 14, fontWeight: 700, letterSpacing: 2, color: GOLD, marginBottom: 8 }}>THE AI INSURANCE GROUP</div>
          <div style={{ fontSize: 26, fontWeight: 700, color: NAVY, marginBottom: 8 }}>Policy Audit Tool</div>
          <div style={{ fontSize: 14, color: MID_GRAY }}>AI-powered coverage gap analysis</div>
        </div>
        <div style={{ marginBottom: 20 }}>
          <label style={S.label}>Password</label>
          <input type="password" style={S.input} value={pw} onChange={e => setPw(e.target.value)} onKeyDown={e => e.key === 'Enter' && login()} placeholder="Enter access password" />
          {authErr && <div style={{ color: RED, fontSize: 13, marginTop: 8 }}>{authErr}</div>}
        </div>
        <button style={{ ...S.btn, width: '100%' }} onClick={login}>Sign In</button>
        <div style={{ textAlign: 'center', marginTop: 24, fontSize: 11, color: MID_GRAY }}>Authorized personnel only. All activity is logged.</div>
      </div>
    </div>
  );

  const HelpModal = () => !showHelp ? null : (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', zIndex: 2000, overflow: 'auto' }}>
      <div style={{ maxWidth: 800, margin: '40px auto', background: WHITE, borderRadius: 16, padding: '40px 36px', position: 'relative', maxHeight: '90vh', overflow: 'auto' }}>
        <button onClick={() => setShowHelp(false)} style={{ position: 'sticky', top: 0, float: 'right', background: NAVY, color: WHITE, border: 'none', borderRadius: 8, padding: '8px 16px', cursor: 'pointer', fontSize: 14, fontWeight: 600, zIndex: 10 }}>✕ Close</button>
        <div style={{ fontSize: 13, fontWeight: 700, letterSpacing: 2, color: GOLD, marginBottom: 8 }}>THE AI INSURANCE GROUP</div>
        <h1 style={{ fontSize: 28, fontWeight: 700, color: NAVY, marginBottom: 4 }}>AI Policy Audit Tool</h1>
        <p style={{ fontSize: 14, color: MID_GRAY, marginBottom: 24 }}>Standard Operating Procedure</p>
        <div style={{ borderTop: '2px solid ' + GOLD, paddingTop: 24 }}>
          <h2 style={{ fontSize: 20, fontWeight: 700, color: NAVY, marginTop: 24, marginBottom: 8 }}>Overview</h2>
          <p style={{ fontSize: 14, lineHeight: 1.7, color: '#333', marginBottom: 12 }}>This tool analyzes commercial insurance policies to identify AI-related exclusions, coverage gaps, and endorsements. Claude AI scans every page and produces a structured analysis that you validate before delivering to the client.</p>
          <p style={{ fontSize: 14, lineHeight: 1.7, color: '#333', marginBottom: 12 }}><strong>Scans for:</strong> Verisk ISO forms (CG 40 47, CG 40 48, CG 35 08), carrier-specific exclusions (W.R. Berkley PC 51380, Cincinnati Financial, Hamilton, Philadelphia, AIG), sublimits, definition changes, silent gaps, and affirmative AI endorsements.</p>
          <p style={{ fontSize: 14, lineHeight: 1.7, color: '#333', marginBottom: 12 }}><strong>Policy types:</strong> GL, E&O, D&O, Cyber, EPLI, Products/Completed Ops.</p>
          <p style={{ fontSize: 14, lineHeight: 1.7, color: '#333', marginBottom: 12 }}><strong>Time:</strong> ~10 min AI analysis + ~20 min validation = ~30 min total per audit.</p>
          <div style={{ background: LIGHT_GOLD, borderLeft: '3px solid ' + GOLD, padding: '12px 16px', borderRadius: 4, fontSize: 13, color: NAVY, margin: '16px 0', fontStyle: 'italic' }}>Important: The AI generates a draft. You must review every finding. Your professional judgment is the final word.</div>
          <h2 style={{ fontSize: 20, fontWeight: 700, color: NAVY, marginTop: 32, marginBottom: 12 }}>Step-by-Step Process</h2>
          {[
            { n: '1', t: 'Log In', d: 'Go to audit.theaiinsurancegroup.com. Enter the password and click Sign In.' },
            { n: '2', t: 'Start a New Audit', d: 'Click + New Audit on the Dashboard.' },
            { n: '3', t: 'Enter Client Information', d: 'Enter client/company name exactly as on policies. Select industry. Optionally add contact name and email.' },
            { n: '4', t: 'Capture Client Authorization', d: 'Type the client\'s full name (electronic signature), company, and check the authorization box. You MUST have their actual authorization first. Timestamped and stored permanently.' },
            { n: '5', t: 'Upload Policy Documents', d: 'Drag/drop or click to upload PDFs. Tag each file with the correct policy type (GL, E&O, D&O, Cyber, EPLI, Products). Every file must be tagged. Request full policies, not just dec pages.' },
            { n: '6', t: 'Run AI Analysis', d: 'Click "Run AI Coverage Audit." Each policy takes 1-2 minutes. Do not close the browser tab.' },
            { n: '7', t: 'Review Draft Report', d: 'Report opens in DRAFT status (yellow banner). Statuses: AI EXCLUDED = confirmed gap. SILENT ON AI = ambiguous gap. PARTIAL = limited. AI COVERED = affirmative.' },
            { n: '8', t: 'Validate Findings', d: 'Confirm = accurate. Reject = wrong/false positive. Modify = partially correct (add a note). Read each finding before validating.' },
            { n: '9', t: 'Validate Coverage Gaps', d: 'Confirm = real gap. Reject = not applicable to this client.' },
            { n: '10', t: 'Finalize Audit', d: 'Enter your full name, then click "Validate & Finalize Report." Status changes to VALIDATED with your name and timestamp.' },
            { n: '11', t: 'Print / Save as PDF', d: 'Click "Print / Save as PDF." Select Save as PDF in your browser. This is your client deliverable.' },
            { n: '12', t: 'Present to Client', d: 'Walk through the report: overall risk, policy-by-policy findings, gaps, recommendations, and next steps for placing coverage.' },
          ].map((step) => (
            <div key={step.n} style={{ display: 'flex', gap: 14, marginBottom: 16 }}>
              <div style={{ width: 32, height: 32, borderRadius: '50%', background: NAVY, color: WHITE, display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: 14, flexShrink: 0 }}>{step.n}</div>
              <div><div style={{ fontSize: 15, fontWeight: 700, color: NAVY, marginBottom: 4 }}>{step.t}</div><div style={{ fontSize: 14, lineHeight: 1.6, color: '#333' }}>{step.d}</div></div>
            </div>
          ))}
          <h2 style={{ fontSize: 20, fontWeight: 700, color: NAVY, marginTop: 32, marginBottom: 12 }}>Compliance Rules</h2>
          {['Never deliver a DRAFT report to a client.', 'Never fabricate client consent.', 'Never present AI analysis as a coverage determination.', 'Validate every finding — do not bulk-confirm without reading.', 'Never alter the AI\'s original output.', 'Export a backup weekly.', 'Keep credentials confidential.'].map((rule, i) => (
            <div key={i} style={{ fontSize: 14, lineHeight: 1.6, marginBottom: 6 }}><strong style={{ color: RED }}>{i + 1}.</strong> {rule}</div>
          ))}
          <h2 style={{ fontSize: 20, fontWeight: 700, color: NAVY, marginTop: 32, marginBottom: 12 }}>Troubleshooting</h2>
          <p style={{ fontSize: 14, lineHeight: 1.7, color: '#333', marginBottom: 8 }}><strong>Analysis takes too long:</strong> Large docs take longer. If over 5 min, the PDF may be scanned — run through OCR first.</p>
          <p style={{ fontSize: 14, lineHeight: 1.7, color: '#333', marginBottom: 8 }}><strong>Not an insurance policy error:</strong> You uploaded a quote, proposal, or non-policy document.</p>
          <p style={{ fontSize: 14, lineHeight: 1.7, color: '#333', marginBottom: 8 }}><strong>Finding seems wrong:</strong> Click Reject or Modify. Your judgment overrides the AI.</p>
          <p style={{ fontSize: 14, lineHeight: 1.7, color: '#333', marginBottom: 8 }}><strong>Can't see Finalize button:</strong> Enter your name and review all findings first.</p>
          <div style={{ textAlign: 'center', marginTop: 24, fontSize: 12, color: MID_GRAY, borderTop: '1px solid ' + LIGHT_GRAY, paddingTop: 12 }}>© 2026 The AI Insurance Group. Internal use only.</div>
        </div>
      </div>
    </div>
  );

  const Hdr = ({ right }) => (
    <div style={S.header} className="no-print">
      <div><div style={{ color: GOLD, fontSize: 18, fontWeight: 700, letterSpacing: 1.2 }}>AI POLICY AUDIT TOOL</div>
      <div style={{ color: 'rgba(255,255,255,0.5)', fontSize: 11, letterSpacing: 2, marginTop: 2 }}>THE AI INSURANCE GROUP</div></div>
      <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
        <HelpModal />
        <button onClick={() => setShowHelp(true)} style={{ background: 'transparent', color: GOLD, border: '1px solid ' + GOLD, borderRadius: 6, padding: '6px 14px', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>📖 How To Use</button>
        {right}
      </div>
    </div>
  );

  // ============ ANALYZING ============
  if (screen === 'analyzing' && loading) {
    const pct = progress.t > 0 ? (progress.c / progress.t) * 100 : 0;
    return (<div style={S.app}><Hdr />
      <div style={{ ...S.content, display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '60vh' }}>
        <div style={{ textAlign: 'center', maxWidth: 500 }}>
          <div style={{ width: 64, height: 64, border: '4px solid ' + LIGHT_GRAY, borderTopColor: GOLD, borderRadius: '50%', margin: '0 auto 24px', animation: 'spin 1s linear infinite' }} />
          <div style={{ fontSize: 22, fontWeight: 700, marginBottom: 8 }}>Analyzing Policies</div>
          <div style={{ fontSize: 14, color: MID_GRAY, marginBottom: 24 }}>{loadMsg}</div>
          <div style={{ background: LIGHT_GRAY, borderRadius: 8, height: 8, overflow: 'hidden', marginBottom: 12 }}>
            <div style={{ background: GOLD, height: '100%', width: pct + '%', borderRadius: 8, transition: 'width 0.5s' }} />
          </div>
          <div style={{ fontSize: 13, color: MID_GRAY }}>Policy {progress.c} of {progress.t}</div>
          <div style={{ marginTop: 32, padding: 20, background: LIGHT_GOLD, borderRadius: 8, fontSize: 13, lineHeight: 1.6 }}>
            Scanning for Verisk CG 40 47, CG 40 48, CG 35 08, Berkley PC 51380, carrier-specific exclusions, sublimits, definition changes, and silent gaps...
          </div>
        </div>
      </div>
    </div>);
  }

  // ============ ACTIVITY LOG ============
  if (screen === 'activity-log') return (
    <div style={S.app}>
      <Hdr right={<button style={S.btnOut} onClick={() => setScreen('dashboard')}>← Dashboard</button>} />
      <div style={S.content}>
        <div style={{ fontSize: 24, fontWeight: 700, marginBottom: 24 }}>Activity Log</div>
        {actLog.length === 0 ? <div style={{ ...S.card, textAlign: 'center', color: MID_GRAY, padding: 40 }}>No activity yet.</div> : (
          <div style={S.card}>
            {actLog.map((log, i) => (
              <div key={log.id} style={{ padding: '12px 0', borderBottom: i < actLog.length - 1 ? '1px solid ' + LIGHT_GRAY : 'none', display: 'flex', gap: 16, alignItems: 'flex-start' }}>
                <div style={{ fontSize: 11, color: MID_GRAY, minWidth: 140, flexShrink: 0 }}>{fmtDateTime(log.created_at)}</div>
                <div style={{ flex: 1 }}>
                  <span style={{ ...S.tag, marginRight: 8 }}>{log.action}</span>
                  <span style={{ fontSize: 13, color: MID_GRAY }}>by {log.actor}</span>
                  {log.details && <div style={{ fontSize: 12, color: MID_GRAY, marginTop: 4 }}>{JSON.stringify(log.details)}</div>}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );

  // ============ REPORT / VALIDATION ============
  if (screen === 'report' && curAudit) {
    const a = curAudit, isDraft = a.status === 'DRAFT';
    const totalF = curPolicies.reduce((s, p) => s + ((isDraft ? p.ai_raw_output : p.validated_output || p.ai_raw_output)?.findings?.length || 0), 0);
    const totalG = curPolicies.reduce((s, p) => s + ((isDraft ? p.ai_raw_output : p.validated_output || p.ai_raw_output)?.coverage_gaps?.length || 0), 0);
    const exclN = curPolicies.filter(p => p.ai_status === 'EXCLUDED').length;

    return (<div style={S.app}>
      <Hdr right={<button style={S.btnOut} onClick={() => { setCurAudit(null); setCurPolicies([]); setScreen('dashboard'); loadAudits(); }}>← Dashboard</button>} />
      <div style={S.content}>
        {isDraft ? (
          <div style={{ background: '#FFFBEB', border: '1px solid ' + ORANGE, borderRadius: 8, padding: '14px 20px', marginBottom: 20, display: 'flex', gap: 12 }} className="no-print">
            <span style={{ fontSize: 20 }}>⚠️</span>
            <div><div style={{ fontWeight: 700, color: ORANGE }}>DRAFT — Pending Human Validation</div>
            <div style={{ fontSize: 13, color: MID_GRAY }}>Review each finding below, then validate to finalize.</div></div>
          </div>
        ) : (
          <div style={{ background: '#F0FDF4', border: '1px solid ' + GREEN, borderRadius: 8, padding: '14px 20px', marginBottom: 20, display: 'flex', gap: 12 }}>
            <span style={{ fontSize: 20 }}>✅</span>
            <div><div style={{ fontWeight: 700, color: GREEN }}>VALIDATED by {a.validated_by}</div>
            <div style={{ fontSize: 13, color: MID_GRAY }}>{fmtDateTime(a.validated_at)}</div></div>
          </div>
        )}

        <div style={{ ...S.card, background: NAVY, color: WHITE, padding: '36px 32px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 16 }}>
            <div>
              <div style={{ fontSize: 13, color: GOLD, fontWeight: 600, letterSpacing: 1.5, marginBottom: 8 }}>AI COVERAGE AUDIT REPORT</div>
              <div style={{ fontSize: 28, fontWeight: 700, marginBottom: 4 }}>{a.client_name}</div>
              <div style={{ fontSize: 14, color: 'rgba(255,255,255,0.6)' }}>{a.client_industry} • {fmtDate(a.created_at)}</div>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <span style={{ ...S.badge(a.overall_risk), fontSize: 14, padding: '8px 20px' }}>{a.overall_risk} RISK</span>
              <span style={{ ...S.stBadge(a.status), fontSize: 14, padding: '8px 20px' }}>{a.status}</span>
            </div>
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16, marginBottom: 20 }}>
          {[{ n: a.file_count, l: 'Policies' }, { n: totalF, l: 'Findings' }, { n: exclN, l: 'Exclusions' }, { n: totalG, l: 'Gaps' }].map((x, i) => (
            <div key={i} style={{ ...S.card, ...S.stat }}><div style={S.statN}>{x.n}</div><div style={S.statL}>{x.l}</div></div>
          ))}
        </div>

        {error && <div style={{ padding: 14, background: '#FEF2F2', borderRadius: 8, color: RED, fontSize: 14, marginBottom: 20 }}>{error}</div>}
{/* Document Status Summary */}
        <div style={S.card}>
          <div style={S.sec}>📋 Document Review Status</div>
          {curPolicies.map((pol, i) => {
            const raw2 = pol.ai_raw_output || {};
            const typeInfo2 = POLICY_TYPES.find(p => p.id === pol.policy_type);
            const isValid = raw2.ai_status && raw2.ai_status !== 'UNKNOWN' && raw2.ai_status !== 'ERROR' && raw2.ai_status !== 'PENDING' && !raw2.error;
            return (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px', borderRadius: 8, marginBottom: 8, background: isValid ? '#F0FDF4' : '#FEF2F2', border: '1px solid ' + (isValid ? GREEN : RED) }}>
                <span style={{ fontSize: 20 }}>{isValid ? '✅' : '❌'}</span>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 14, fontWeight: 700, color: NAVY }}>{typeInfo2?.label || pol.policy_type}</div>
                  <div style={{ fontSize: 12, color: MID_GRAY }}>{pol.file_name}</div>
                </div>
                <div style={{ fontSize: 13, fontWeight: 600, color: isValid ? GREEN : RED }}>
                  {isValid ? (raw2.ai_status === 'EXCLUDED' ? 'Valid — AI Exclusion Found' : raw2.ai_status === 'SILENT' ? 'Valid — Silent on AI' : raw2.ai_status === 'PARTIAL' ? 'Valid — Partial Coverage' : raw2.ai_status === 'AFFIRMATIVE' ? 'Valid — AI Covered' : 'Valid Policy') : 'Invalid — Not a Commercial Policy'}
                </div>
              </div>
            );
          })}
          {(() => {
            const uploaded = curPolicies.map(p => p.policy_type);
            const missing = POLICY_TYPES.filter(pt => !uploaded.includes(pt.id));
            return missing.length > 0 ? (
              <div style={{ marginTop: 16, padding: 16, background: '#FFFBEB', borderRadius: 8, border: '1px solid ' + ORANGE }}>
                <div style={{ fontSize: 14, fontWeight: 700, color: ORANGE, marginBottom: 8 }}>📎 Missing Policy Types</div>
                <div style={{ fontSize: 13, color: '#333', lineHeight: 1.6 }}>The following were not included. Consider requesting them for a complete analysis:</div>
                <div style={{ marginTop: 8, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  {missing.map(m => <span key={m.id} style={{ padding: '4px 12px', background: '#FEF3C7', borderRadius: 20, fontSize: 12, fontWeight: 600, color: ORANGE }}>{m.icon} {m.label}</span>)}
                </div>
              </div>
            ) : (
              <div style={{ marginTop: 16, padding: 12, background: '#F0FDF4', borderRadius: 8, border: '1px solid ' + GREEN, fontSize: 13, color: GREEN, fontWeight: 600 }}>✅ All 6 policy types included — comprehensive audit</div>
            );
          })()}
        </div>
        {curPolicies.map((pol, pi) => {
          const ti = POLICY_TYPES.find(p => p.id === pol.policy_type);
          const out = isDraft ? pol.ai_raw_output : (pol.validated_output || pol.ai_raw_output);
          if (!out) return null;
          const findings = out.findings || [], gaps = out.coverage_gaps || [], recs = out.recommendations || [];

          return (<div key={pol.id} style={S.card}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20, flexWrap: 'wrap', gap: 8 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <span style={{ fontSize: 24 }}>{ti?.icon || '📄'}</span>
                <div><div style={{ fontSize: 18, fontWeight: 700 }}>{ti?.label || pol.policy_type}</div>
                <div style={{ fontSize: 12, color: MID_GRAY }}>{pol.file_name}{pol.carrier ? ' • ' + pol.carrier : ''}</div></div>
              </div>
              <div style={S.badge(pol.risk_level || pol.ai_status)}>
                {pol.ai_status === 'EXCLUDED' ? '⛔ AI EXCLUDED' : pol.ai_status === 'SILENT' ? '⚠️ SILENT' : pol.ai_status === 'PARTIAL' ? '🔶 PARTIAL' : pol.ai_status === 'AFFIRMATIVE' ? '✅ COVERED' : pol.ai_status === 'ERROR' ? '❌ ERROR' : '❓ UNKNOWN'}
              </div>
            </div>

            {out.summary && <div style={{ padding: 16, background: LIGHT_GOLD, borderRadius: 8, fontSize: 14, lineHeight: 1.7, marginBottom: 16, borderLeft: '3px solid ' + GOLD }}>{out.summary}</div>}

            {findings.length > 0 && <div style={{ marginBottom: 16 }}>
              <div style={S.sec}>Findings {isDraft && <span style={{ fontWeight: 400, fontSize: 11, color: MID_GRAY }}>— Review each</span>}</div>
              {findings.map((f, fi) => {
                const k = pi + '-' + fi, act = fActions[k] || '';
                return (<div key={fi} style={{ padding: 14, background: f.type === 'EXCLUSION' ? '#FEF2F2' : f.type === 'SILENT_GAP' ? '#FFFBEB' : f.type === 'AFFIRMATIVE' ? '#F0FDF4' : '#F9FAFB', borderRadius: 8, marginBottom: 8, borderLeft: '3px solid ' + (f.type === 'EXCLUSION' ? RED : f.type === 'SILENT_GAP' ? ORANGE : f.type === 'AFFIRMATIVE' ? GREEN : LIGHT_GRAY) }}>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 6 }}>
                    <span style={{ ...S.tag, background: f.type === 'EXCLUSION' ? '#FEE2E2' : f.type === 'SILENT_GAP' ? '#FEF3C7' : LIGHT_GOLD, color: f.type === 'EXCLUSION' ? RED : f.type === 'SILENT_GAP' ? ORANGE : GOLD }}>{(f.type || '').replace('_', ' ')}</span>
                    {f.form_number && <span style={{ fontSize: 12, color: MID_GRAY, fontFamily: 'monospace' }}>{f.form_number}</span>}
                  </div>
                  <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 4 }}>{f.description}</div>
                  {f.impact && <div style={{ fontSize: 13, color: MID_GRAY, lineHeight: 1.5 }}>{f.impact}</div>}
                  {f.policy_section && <div style={{ fontSize: 11, color: MID_GRAY, marginTop: 4 }}>Section: {f.policy_section}</div>}
                  {isDraft && (
                    <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid ' + LIGHT_GRAY, display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }} className="no-print">
                      {['CONFIRMED', 'REJECTED', 'MODIFIED'].map(a2 => (
                        <button key={a2} onClick={() => setFActions(prev => ({ ...prev, [k]: a2 }))} style={{
                          padding: '6px 14px', borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: 'pointer', border: 'none',
                          background: act === a2 ? (a2 === 'CONFIRMED' ? GREEN : a2 === 'REJECTED' ? RED : ORANGE) : '#F3F4F6',
                          color: act === a2 ? WHITE : NAVY,
                        }}>{a2 === 'CONFIRMED' ? '✓ Confirm' : a2 === 'REJECTED' ? '✗ Reject' : '✎ Modify'}</button>
                      ))}
                      {(act === 'MODIFIED' || act === 'REJECTED') && (
                        <input style={{ ...S.input, flex: 1, minWidth: 200, padding: '6px 12px', fontSize: 12 }}
                          placeholder="Notes (required)" value={fNotes[k] || ''} onChange={e => setFNotes(prev => ({ ...prev, [k]: e.target.value }))} />
                      )}
                    </div>
                  )}
                </div>);
              })}
            </div>}

            {gaps.length > 0 && <div style={{ marginBottom: 16 }}>
              <div style={S.sec}>Coverage Gaps</div>
              {gaps.map((g, i) => <div key={i} style={{ display: 'flex', gap: 10, marginBottom: 8, fontSize: 14, lineHeight: 1.5 }}><span style={{ color: RED }}>✗</span><span>{g}</span></div>)}
            </div>}

            {recs.length > 0 && <div>
              <div style={S.sec}>Recommendations</div>
              {recs.map((r, i) => <div key={i} style={{ display: 'flex', gap: 10, marginBottom: 8, fontSize: 14, lineHeight: 1.5 }}><span style={{ color: GREEN }}>→</span><span>{r}</span></div>)}
            </div>}
          </div>);
        })}

        {isDraft && (
          <div style={{ ...S.card, border: '2px solid ' + GOLD }} className="no-print">
            <div style={S.sec}>Validate & Finalize Report</div>
            <div style={{ fontSize: 14, color: MID_GRAY, marginBottom: 16, lineHeight: 1.6 }}>
              By validating, you confirm you have reviewed all AI-generated findings and take responsibility for the accuracy of this report.
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 20 }}>
              <div><label style={S.label}>Your Full Name *</label><input style={S.input} value={valName} onChange={e => setValName(e.target.value)} placeholder="e.g. Sal Martorano" /></div>
              <div style={{ display: 'flex', alignItems: 'flex-end' }}>
                <button style={{ ...S.btnGreen, width: '100%', opacity: (!valName || !allReviewed()) ? 0.4 : 1 }} onClick={validateAudit} disabled={!valName || !allReviewed()}>
                  ✓ Validate & Finalize Report
                </button>
              </div>
            </div>
            {!allReviewed() && <div style={{ fontSize: 12, color: ORANGE }}>⚠️ Review all findings above before validating.</div>}
          </div>
        )}

        <div style={{ ...S.card, background: NAVY, color: WHITE, textAlign: 'center', padding: 36 }}>
          <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 8 }}>Ready to Close These Gaps?</div>
          <div style={{ fontSize: 14, color: 'rgba(255,255,255,0.6)', maxWidth: 500, margin: '0 auto 20px' }}>
            The AI Insurance Group works with Lloyd's, Munich Re, and specialty AI liability markets to place affirmative coverage.
          </div>
          <div style={{ display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap' }} className="no-print">
            {!isDraft && <button style={S.btn} onClick={() => { logActivity(a.id, 'REPORT_EXPORTED', {}, valName || 'operator'); window.print(); }}>Print / Save as PDF</button>}
            <button style={S.btnOut} onClick={async () => { await loadLog(a.id); setScreen('activity-log'); }}>Activity Log</button>
          </div>
        </div>

        <div style={{ textAlign: 'center', marginTop: 16, fontSize: 11, color: MID_GRAY, lineHeight: 1.6 }}>
          This analysis was generated using AI-assisted document review{!isDraft && a.validated_by ? ' and validated by ' + a.validated_by : ''}.
          It is not a coverage determination. Final coverage interpretations should be confirmed with the issuing carrier.
          The AI Insurance Group provides coverage gap identification services through Alexander Capital Insurance.
        </div>
      </div>
    </div>);
  }

  // ============ NEW AUDIT ============
  if (screen === 'new-audit') {
    const ready = clientName && clientInd && files.length > 0 && !files.some(f => !f.pt);
    return (<div style={S.app}>
      <Hdr right={<button style={S.btnOut} onClick={() => { setScreen('dashboard'); setClientLink(''); setError(''); }}>← Cancel</button>} />
      <div style={S.content}>
        <div style={{ fontSize: 24, fontWeight: 700, marginBottom: 8 }}>New Coverage Audit</div>
        <div style={{ fontSize: 14, color: MID_GRAY, marginBottom: 32 }}>Choose how to collect the client's documents</div>
        {error && <div style={{ padding: 14, background: '#FEF2F2', borderRadius: 8, color: RED, fontSize: 14, marginBottom: 20 }}>{error}</div>}

        {/* OPTION 1: Send Link to Client */}
        <div style={{ ...S.card, border: '2px solid ' + GOLD }}>
          <div style={S.sec}>📨 Option 1: Send Link to Client (Recommended)</div>
          <div style={{ fontSize: 14, color: MID_GRAY, marginBottom: 16, lineHeight: 1.6 }}>
            Enter the client's info below, generate a secure link, and text or email it to them. They sign the authorization and upload their own policies — no back and forth.
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
            <div><label style={S.label}>Company Name *</label><input style={S.input} value={clientName} onChange={e => setClientName(e.target.value)} placeholder="e.g. Smith & Associates LLP" /></div>
            <div><label style={S.label}>Industry *</label><select style={S.select} value={clientInd} onChange={e => setClientInd(e.target.value)}><option value="">Select...</option>{INDUSTRIES.map(ind => <option key={ind} value={ind}>{ind}</option>)}</select></div>
            <div><label style={S.label}>Contact Name</label><input style={S.input} value={clientContact} onChange={e => setClientContact(e.target.value)} placeholder="Primary contact" /></div>
            <div><label style={S.label}>Contact Email</label><input style={S.input} value={clientEmail} onChange={e => setClientEmail(e.target.value)} placeholder="email@company.com" /></div>
          </div>
          <button style={{ ...S.btn, opacity: (clientName && clientInd) ? 1 : 0.4 }} onClick={sendToClient} disabled={!clientName || !clientInd}>
            🔗 Generate Client Link
          </button>

          {clientLink && (
            <div style={{ marginTop: 16, padding: 16, background: '#DCFCE7', borderRadius: 8, border: '1px solid ' + GREEN }}>
              <div style={{ fontSize: 14, fontWeight: 700, color: GREEN, marginBottom: 8 }}>✅ Link Generated — Send to Client</div>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <input style={{ ...S.input, flex: 1, fontFamily: 'monospace', fontSize: 13 }} value={clientLink} readOnly onClick={e => e.target.select()} />
                <button style={S.btnSm} onClick={() => { navigator.clipboard.writeText(clientLink); }}>📋 Copy</button>
              </div>
              <div style={{ fontSize: 12, color: MID_GRAY, marginTop: 8 }}>Text or email this link. The client signs authorization and uploads their policies directly. You'll see it on your dashboard when they submit.</div>
            </div>
          )}
        </div>

        {/* Divider */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 16, margin: '12px 0' }}>
          <div style={{ flex: 1, height: 1, background: LIGHT_GRAY }} />
          <div style={{ fontSize: 13, color: MID_GRAY, fontWeight: 600 }}>OR</div>
          <div style={{ flex: 1, height: 1, background: LIGHT_GRAY }} />
        </div>

        {/* OPTION 2: Upload Yourself */}
        <div style={S.card}>
          <div style={S.sec}>📄 Option 2: Upload Yourself</div>
          <div style={{ fontSize: 14, color: MID_GRAY, marginBottom: 16, lineHeight: 1.6 }}>
            If you already have the client's policies and authorization, upload them directly and run the analysis now.
          </div>
        </div>

        <div style={S.card}>
          <div style={S.sec}>Client Information</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            <div><label style={S.label}>Company Name *</label><input style={S.input} value={clientName} onChange={e => setClientName(e.target.value)} placeholder="e.g. Smith & Associates LLP" /></div>
            <div><label style={S.label}>Industry *</label><select style={S.select} value={clientInd} onChange={e => setClientInd(e.target.value)}><option value="">Select...</option>{INDUSTRIES.map(ind => <option key={ind} value={ind}>{ind}</option>)}</select></div>
            <div><label style={S.label}>Contact Name</label><input style={S.input} value={clientContact} onChange={e => setClientContact(e.target.value)} placeholder="Primary contact" /></div>
            <div><label style={S.label}>Contact Email</label><input style={S.input} value={clientEmail} onChange={e => setClientEmail(e.target.value)} placeholder="email@company.com" /></div>
          </div>
        </div>


        <div style={S.card}>
          <div style={S.sec}>Policy Documents</div>
          <div style={S.dropzone} onClick={() => fileRef.current?.click()}
            onDragOver={e => { e.preventDefault(); e.currentTarget.style.borderColor = GOLD; }}
            onDragLeave={e => { e.preventDefault(); e.currentTarget.style.borderColor = LIGHT_GRAY; }}
            onDrop={e => { e.preventDefault(); e.currentTarget.style.borderColor = LIGHT_GRAY; handleFiles(e.dataTransfer.files); }}>
            <div style={{ fontSize: 36, marginBottom: 8 }}>📄</div>
            <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 4 }}>Drop policy PDFs here or click to browse</div>
            <div style={{ fontSize: 13, color: MID_GRAY }}>GL, E&O, D&O, Cyber, EPLI, Products Liability</div>
            <input ref={fileRef} type="file" accept=".pdf" multiple style={{ display: 'none' }} onChange={e => handleFiles(e.target.files)} />
          </div>
          {files.length > 0 && <div style={{ marginTop: 20 }}>
            {files.map(f => (
              <div key={f.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px', background: '#FAFAFA', borderRadius: 8, marginBottom: 8, flexWrap: 'wrap' }}>
                <span style={{ fontSize: 20 }}>📄</span>
                <div style={{ flex: 1, minWidth: 150 }}><div style={{ fontSize: 14, fontWeight: 600 }}>{f.name}</div><div style={{ fontSize: 11, color: MID_GRAY }}>{(f.size / 1024).toFixed(0)} KB</div></div>
                <select style={{ ...S.select, width: 'auto', minWidth: 200, padding: '8px 12px', fontSize: 13, borderColor: f.pt ? GREEN : ORANGE }} value={f.pt} onChange={e => setPT(f.id, e.target.value)}>
                  <option value="">Tag type...</option>{POLICY_TYPES.map(p => <option key={p.id} value={p.id}>{p.icon} {p.label}</option>)}
                </select>
                <button style={{ background: 'none', border: 'none', color: RED, cursor: 'pointer', fontSize: 18 }} onClick={() => rmFile(f.id)}>×</button>
              </div>
            ))}
          </div>}
        </div>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ fontSize: 13, color: MID_GRAY }}>
            {files.length} {files.length === 1 ? 'policy' : 'policies'}
            {files.some(f => !f.pt) && <span style={{ color: ORANGE }}> • untagged</span>}
           
          </div>
          <button style={{ ...S.btn, opacity: ready ? 1 : 0.4, padding: '14px 36px', fontSize: 16 }} onClick={runAudit} disabled={!ready}>🔍 Run AI Coverage Audit</button>
        </div>
      </div>
    </div>);
  }

  // ============ DASHBOARD ============
  return (<div style={S.app}>
    <Hdr right={<>
      <button style={S.btnSm} onClick={() => setScreen('new-audit')}>+ New Audit</button>
      <button style={S.btnGhost} onClick={async () => { await loadLog(); setScreen('activity-log'); }}>Activity Log</button>
      <button style={S.btnGhost} onClick={exportBackup}>Backup</button>
      <button style={{ ...S.btnGhost, fontSize: 11 }} onClick={logout}>Sign Out</button>
    </>} />
    <div style={S.content}>
      <div style={{ fontSize: 24, fontWeight: 700, marginBottom: 8 }}>Audit Dashboard</div>
      <div style={{ fontSize: 14, color: MID_GRAY, marginBottom: 32 }}>Manage client AI coverage audits</div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 16, marginBottom: 28 }}>
        <div style={{ ...S.card, ...S.stat }}><div style={S.statN}>{audits.length}</div><div style={S.statL}>Total Audits</div></div>
        <div style={{ ...S.card, ...S.stat }}><div style={{ ...S.statN, color: '#7C3AED' }}>{audits.filter(a => a.client_token && !a.client_submitted_at && !a.overall_risk).length}</div><div style={S.statL}>Awaiting Client</div></div>
        <div style={{ ...S.card, ...S.stat }}><div style={{ ...S.statN, color: RED }}>{audits.filter(a => a.overall_risk === 'HIGH').length}</div><div style={S.statL}>High Risk</div></div>
        <div style={{ ...S.card, ...S.stat }}><div style={{ ...S.statN, color: GREEN }}>{audits.filter(a => a.status === 'VALIDATED').length}</div><div style={S.statL}>Validated</div></div>
        <div style={{ ...S.card, ...S.stat }}><div style={{ ...S.statN, color: ORANGE }}>{audits.filter(a => a.status === 'DRAFT' && a.overall_risk).length}</div><div style={S.statL}>Pending Review</div></div>
      </div>

      {audits.length === 0 ? (
        <div style={{ ...S.card, textAlign: 'center', padding: '60px 32px' }}>
          <div style={{ fontSize: 48, marginBottom: 16 }}>📋</div>
          <div style={{ fontSize: 20, fontWeight: 700, marginBottom: 8 }}>No Audits Yet</div>
          <div style={{ fontSize: 14, color: MID_GRAY, maxWidth: 400, margin: '0 auto 24px' }}>Upload client policies to identify AI-related exclusions and coverage gaps.</div>
          <button style={S.btn} onClick={() => setScreen('new-audit')}>+ Start First Audit</button>
        </div>
      ) : (
        <div>
          <div style={S.sec}>All Audits</div>
          {audits.map(audit => {
            const awaitingClient = audit.client_token && !audit.client_submitted_at && !audit.overall_risk;
            const clientSubmitted = audit.client_submitted_at && !audit.overall_risk;
            return (
            <div key={audit.id} style={{ ...S.card, cursor: 'pointer', border: clientSubmitted ? '2px solid ' + GREEN : 'none' }} onClick={() => { if (!awaitingClient && !clientSubmitted) openAudit(audit); }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
                <div>
                  <div style={{ fontSize: 17, fontWeight: 700 }}>{audit.client_name}</div>
                  <div style={{ fontSize: 13, color: MID_GRAY, marginTop: 4 }}>
                    {audit.client_industry} • {audit.file_count || 0} policies • {fmtDate(audit.created_at)}
                    {audit.validated_by && <span> • Validated by {audit.validated_by}</span>}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                  {awaitingClient && <span style={{ ...S.stBadge('DRAFT'), background: '#EDE9FE', color: '#7C3AED' }}>⏳ Awaiting Client</span>}
                  {clientSubmitted && <button style={S.btnGreen} onClick={e => { e.stopPropagation(); runAuditFromStorage(audit); }}>🔍 Run Analysis</button>}
                  {!awaitingClient && !clientSubmitted && <span style={S.stBadge(audit.status)}>{audit.status}</span>}
                  {audit.overall_risk && <span style={S.badge(audit.overall_risk)}>{audit.overall_risk} RISK</span>}
                  <button style={S.btnRed} onClick={e => { e.stopPropagation(); softDel(audit.id); }}>Archive</button>
                </div>
              </div>
            </div>);
          })}
        </div>
      )}

      <div style={{ ...S.card, marginTop: 20 }}>
        <div style={S.sec}>How It Works</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 20 }}>
          {[
            { s: '1', t: 'Send Link', d: 'Generate a secure link and send to the client.' },
            { s: '2', t: 'Client Signs & Uploads', d: 'Client signs authorization and uploads their policies.' },
            { s: '3', t: 'AI Analysis', d: 'You click Run Analysis — Claude scans for AI exclusions and gaps.' },
            { s: '4', t: 'Validate & Deliver', d: 'Review findings, validate, finalize, and present to client.' },
          ].map((x, i) => (
            <div key={i} style={{ textAlign: 'center' }}>
              <div style={{ width: 36, height: 36, borderRadius: '50%', background: LIGHT_GOLD, color: GOLD, display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, margin: '0 auto 10px' }}>{x.s}</div>
              <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 4 }}>{x.t}</div>
              <div style={{ fontSize: 12, color: MID_GRAY, lineHeight: 1.5 }}>{x.d}</div>
            </div>
          ))}
        </div>
      </div>

      <div style={{ textAlign: 'center', marginTop: 24, fontSize: 11, color: MID_GRAY }}>
        © 2026 The AI Insurance Group. All activity logged. Data backed up to Supabase with automatic daily snapshots.
      </div>
    </div>
  </div>);
}
