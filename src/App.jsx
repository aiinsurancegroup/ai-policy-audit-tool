import React, { useState, useEffect, useRef } from 'react';
import { supabase } from './supabase';
import { unreviewedCount, bulkConfirmPatch } from './reviewActions';
import BrandLogo, { BRAND_NAVY, BRAND_GOLD } from './BrandLogo';

const NAVY = '#1A2B45', GOLD = '#B8972A', DARK_BG = '#0F1923', LIGHT_BG = '#F8F6F1';
const WHITE = '#FFFFFF', LIGHT_GOLD = '#F5EFE0', MID_GRAY = '#6B7280', LIGHT_GRAY = '#E5E7EB';
const RED = '#DC2626', GREEN = '#16A34A', ORANGE = '#EA580C';

// All admin operations go through /api/admin/audit with an x-admin-password header.
// The password and service role key live in Vercel env vars, not in this bundle.
async function adminApi(password, body) {
  const r = await fetch('/api/admin/audit', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-admin-password': password },
    body: JSON.stringify(body),
  });
  return r;
}
async function adminJson(password, body) {
  const r = await adminApi(password, body);
  if (!r.ok) return null;
  try { return await r.json(); } catch { return null; }
}

// 'detect' is the "identify this for me" sentinel, NOT an automobile policy.
// It was called 'auto' and sat one row above 'auto_policy' (Commercial Auto),
// which reads as a duplicate and is the opposite of one: production rows tagged
// 'auto' were identified by the analysis as GL and Cyber. Renamed so the two can
// never be conflated. A completed analysis overwrites the sentinel with the type
// it actually found (see resolveDetectedType), so a finished row always states
// what the policy is.
const POLICY_TYPES = [
  { id: 'detect', label: 'Auto-Detect (AI will identify)', icon: '🔍' },
  { id: 'gl', label: 'General Liability (CGL)', icon: '🛡️' },
  { id: 'eo', label: 'Errors & Omissions (E&O)', icon: '⚖️' },
  { id: 'do', label: 'Directors & Officers (D&O)', icon: '🏛️' },
  { id: 'cyber', label: 'Cyber Liability', icon: '🔒' },
  { id: 'epli', label: 'Employment Practices (EPLI)', icon: '👥' },
  { id: 'products', label: 'Products / Completed Ops', icon: '📦' },
  { id: 'wc', label: 'Workers Compensation', icon: '⚠️' },
    { id: 'auto_policy', label: 'Commercial Auto', icon: '🚗' },
    // Split out from auto_policy: an excess auto layer and a physical damage
    // policy sit at different heights in the tower and cover different things,
    // and folding all three into "Commercial Auto" made the program report
    // unable to say which one a finding was about.
    { id: 'excess_auto', label: 'Excess Auto', icon: '🛞' },
    { id: 'auto_physical_damage', label: 'Auto Physical Damage', icon: '🔧' },
    { id: 'property', label: 'Property / BOP', icon: '🏢' },
    { id: 'umbrella', label: 'Umbrella / Excess', icon: '☂️' },
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

  DATES — YOU HAVE NO CLOCK:
  You cannot know today's date. It is supplied in the user message as TODAY'S DATE, and that value is the ONLY present you may reason from. Every statement about renewals, timing, urgency or what happens "next" must be measured against it. Compare the policy's expiration date to it before writing anything time-related: if expiration is in the past the policy has EXPIRED and must be described that way, not as an upcoming renewal. Never suggest acting by a date that has already passed.

  SCOPE — WHAT THIS ANALYSIS CAN AND CANNOT SAY:
  You are reading EXACTLY ONE document. Other policies the client holds are analyzed separately and you cannot see them. Therefore:
  - You may state what IS in this document.
  - You may state that a coverage is NOT EVIDENCED IN THIS DOCUMENT.
  - You must NEVER state or imply that the client lacks a coverage line, has no umbrella, has no auto policy, or needs to purchase a line. A line absent from this document may be fully covered by another policy you were not shown.
  - Phrase every absence as "not evidenced in this document" or "no [line] coverage appears in this policy", never as "the client has no [line]" or "this business needs [line]".
  - Do not compare this policy against other policies, and do not comment on overlaps between policies. A separate program-level review does that with every policy in hand.

  COVERAGE GAPS (within this document only — absence here is not proof of absence overall):
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

  PART 3 — AGENT OPPORTUNITY ANALYSIS (INTERNAL — NEVER SHOWN TO THE CLIENT):
  This section is for the producing agent's eyes only and will NEVER appear in any client-facing report. Identify sales angles, cross-sell opportunities, and credible reasons for the agent to initiate a follow-up call.

  NEVER ESTIMATE MONEY. Do not state or imply a percentage saving, a dollar saving, a premium reduction, or any projected figure — not as a range, not as "roughly", not as an illustration. You cannot see the client's other quotes, loss history, or rating basis, so any such number is invented and would be quoted back to a client as though it were analysis. Report the premium printed on the document if it is shown, and nothing beyond it.

  LOOK FOR:
  - Structural premium issues the agent could raise (outdated endorsements, missing credits, over-insurance) — described qualitatively, with no figures attached
  - Coverage lines not evidenced in THIS document that a business of this type commonly carries (e.g. EPLI for a 50+ employee company, Cyber for a tech firm, an AI-specific endorsement for an AI-using firm). Frame these as worth confirming with the client, never as confirmed absences — the client may already hold them on a policy you were not shown.
  - Limits well above or below industry norms for this business type and size
  - Multi-carrier setups that could be consolidated to a single carrier for better terms
  - Renewal timing that creates a natural conversation window (effective dates within 90-120 days)
  - Any structural issue that gives the agent a credible, value-add reason to call — not a sales pitch

  GOAL: Generate a specific lead hook the producing agent can use to open a conversation. Be concrete. Avoid generic "consider reviewing your coverage" language. The agent should walk away knowing exactly WHY to call and WHAT to discuss.

  RESPOND ONLY with this JSON:
  {
    "policy_type": "EXACTLY ONE of: gl | eo | do | cyber | epli | products | wc | auto_policy | excess_auto | auto_physical_damage | property | umbrella | other  (auto_policy = a primary business/commercial auto policy; excess_auto = an excess or following-form layer sitting ABOVE a primary auto policy; auto_physical_damage = a policy covering damage to the vehicles themselves rather than liability to others; umbrella = a general umbrella or excess liability policy over multiple lines; use other ONLY if genuinely none of these fit)",
    "carrier": "carrier name",
    "policy_number": "if visible",
    "effective_date": "if visible",
    "expiration_date": "if visible",
    "ai_status": "EXCLUDED|SILENT|PARTIAL|AFFIRMATIVE",
    "risk_level": "HIGH|MODERATE|LOW",
    "findings": [{"type": "EXCLUSION|SUBLIMIT|DEFINITION_CHANGE|ENDORSEMENT|SILENT_GAP|AFFIRMATIVE", "form_number": "if identified or null", "description": "what was found", "policy_section": "where in policy", "impact": "what this means for AI claims", "verbatim_excerpt": "5-10 word key phrase"}],
    "coverage_gaps": ["gaps within THIS document — phrase each as not evidenced here, never as a coverage the client lacks"],
    "recommendations": ["specific recommendations"],
    "general_review": {
      "limits_assessment": "ADEQUATE|BELOW_STANDARD|REVIEW_NEEDED",
      "estimated_adequacy": "WELL_COVERED|GAPS_FOUND|UNDER_INSURED|OVER_INSURED",
      "general_findings": [{"category": "LIMITS|COVERAGE_GAP|STRUCTURE|PREMIUM", "issue": "what was found", "severity": "HIGH|MODERATE|LOW", "recommendation": "what to do about it"}],
      "general_summary": "2-3 sentence overview of non-AI coverage status"
    },
    "summary": "2-3 sentence executive summary covering BOTH AI and general coverage",
    "agent_opportunities": {
      "lead_hook": "single sentence the agent can use to open a follow-up call",
      "primary_opportunity": "the single strongest sales angle from this policy",
      "premium_as_shown": "the premium exactly as printed on the document, or null if not shown. NEVER an estimate, a saving, or a projection.",
      "talking_points": ["3-5 specific points the agent should bring up on the call"],
      "lines_not_evidenced_here": ["coverage lines not evidenced in THIS document that are worth confirming with the client — NOT confirmed absences"],
      "urgency_factors": ["what makes this time-sensitive, measured against TODAY'S DATE as given in the user message. If the expiration date is already in the past, the FIRST factor must say so plainly: 'This policy EXPIRED on <date> — confirm whether it was renewed before relying on any of this analysis.' Never propose a marketing or renewal timeline that has already passed."]
    }
  }

  If not an insurance policy: {"error": "Not an insurance policy", "ai_status": "UNKNOWN"}
  Be thorough. Miss nothing.`;

// ---------------------------------------------------------------------------
// ai_status vocabulary. Three kinds of value that must never share a bucket:
//
//   verdicts            the analysis completed and reached a conclusion about
//                       AI coverage: EXCLUDED | SILENT | PARTIAL | AFFIRMATIVE
//   UNKNOWN             completed, and the conclusion is "this is not an
//                       insurance policy". A real finding about the document.
//   FAILED  (ERROR)     the analysis did NOT complete. Says nothing whatever
//                       about the document. ERROR is the legacy spelling and is
//                       still read so old rows keep their meaning.
//   PENDING             uploaded, not yet analysed.
//
// Conflating FAILED with UNKNOWN is what let a revoked API key, a retired model
// and two function timeouts all render as "Invalid - Not a Commercial Policy".
const VERDICT_STATUSES = ['EXCLUDED', 'SILENT', 'PARTIAL', 'AFFIRMATIVE'];
const isVerdict = (s) => VERDICT_STATUSES.includes(s);
const isFailed = (s) => s === 'FAILED' || s === 'ERROR';
const isPending = (s) => s === 'PENDING' || !s;
// "Analysed" means the run finished, whatever it concluded. UNKNOWN counts:
// the document was read and found not to be a policy. FAILED and PENDING do not.
const isAnalysed = (s) => isVerdict(s) || s === 'UNKNOWN';

// The analysis reports the type it identified. Map it back to our ids so the
// 'detect' sentinel never survives a completed run. Anything unrecognised
// returns null and the existing type is kept -- never overwrite with a guess.
const AI_TYPE_TO_ID = {
  // Our own ids, which is what the prompt now asks for.
  'auto_policy': 'auto_policy', 'other': null,
  // Free-text spellings, kept because rows written before the prompt asked for
  // ids still carry them, and a model can always drift back to prose.
  gl: 'gl', 'general liability': 'gl', cgl: 'gl', 'commercial general liability': 'gl',
  'excess_auto': 'excess_auto', 'excess auto': 'excess_auto', 'commercial excess auto': 'excess_auto', 'auto excess': 'excess_auto',
  'auto_physical_damage': 'auto_physical_damage', 'auto physical damage': 'auto_physical_damage', 'physical damage': 'auto_physical_damage',
  'hired and non-owned auto': 'auto_policy',
  'excess liability': 'umbrella', 'commercial umbrella': 'umbrella', 'excess/umbrella': 'umbrella',
  eo: 'eo', 'e&o': 'eo', 'errors & omissions': 'eo', 'errors and omissions': 'eo', 'professional liability': 'eo',
  do: 'do', 'd&o': 'do', 'directors & officers': 'do', 'directors and officers': 'do',
  cyber: 'cyber', 'cyber liability': 'cyber',
  epli: 'epli', 'employment practices': 'epli', 'employment practices liability': 'epli',
  products: 'products', 'products/completed ops': 'products', 'products liability': 'products',
  wc: 'wc', 'workers compensation': 'wc', "workers' compensation": 'wc', 'workers comp': 'wc',
  'commercial auto': 'auto_policy', auto: 'auto_policy', 'business auto': 'auto_policy', 'auto policy': 'auto_policy',
  property: 'property', bop: 'property', 'property/bop': 'property', 'businessowners': 'property',
  umbrella: 'umbrella', excess: 'umbrella', 'umbrella/excess': 'umbrella',
};
const resolveDetectedType = (aiType) => {
  if (!aiType || typeof aiType !== 'string') return null;
  return AI_TYPE_TO_ID[aiType.trim().toLowerCase()] ?? null;
};

// Turn a non-OK /api/analyze response into something a human can act on.
// The endpoint distinguishes its own 401/403/413 from an upstream 502 and puts
// the real upstream status in the body; surface that rather than a bare code.
const describeFailure = async (resp) => {
  let body = null;
  try { body = await resp.json(); } catch {}
  if (body?.upstream_status) return `Analysis service error (HTTP ${resp.status}, upstream ${body.upstream_status})`;
  if (resp.status === 401) return 'Not authorised — sign out and sign in again';
  if (resp.status === 403) return 'Request rejected as coming from an unrecognised origin';
  if (resp.status === 413) return 'Document too large to analyse';
  if (resp.status === 504) return 'Analysis timed out — the document may be too long';
  return `Analysis request failed (HTTP ${resp.status}${body?.error ? `: ${body.error}` : ''})`;
};

// One place that decides what a policy row's outcome was, so the report, the
// risk roll-up and the finalise gate can never disagree.
const failureReason = (pol) => {
  const raw = pol?.ai_raw_output || {};
  return raw.failure?.message || raw.error || 'the analysis did not complete';
};

// The model has no clock. Without being told the date it reasons from whenever
// its training ended, which is how a policy expiring 8/30/2026 drew the advice
// "begin marketing by May 2026" -- a deadline three months in the past. Sent in
// the user message, not the system prompt, so the system prompt stays identical
// between runs. Written out in full as well as ISO so it cannot be misread.
const todayISO = () => {
  const d = new Date();
  return `${d.toISOString().slice(0, 10)} (${d.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })})`;
};

// The largest PDF that can reach the analysis endpoint. The file is base64
// encoded into the request body, which adds about a third, and the server caps
// that body at 4MB (Vercel rejects anything over 4.5MB before our code runs).
// Checked here as well as on the server so the operator is told immediately,
// by a message naming the actual file, rather than after a wasted upload.
// The server reads the PDF from storage now, so the old ~3MB request-body
// ceiling is gone and this is storage's limit, matching the client portal.
const MAX_PDF_BYTES = 25 * 1024 * 1024;
const mb = (bytes) => (bytes / 1048576).toFixed(1);

// Anthropic refuses a PDF over 600 pages whatever route it arrives by, and no
// amount of compression changes a page count. It cannot be checked here without
// parsing the file, so it is named in the failure rather than predicted.
const PAGE_LIMIT_HINT = 'If the document is longer than 600 pages, split it and upload each part as its own policy.';

// Put an operator's file in storage, by the same route the client portal uses:
// the server mints a signed URL and owns the path, the bytes go straight to
// storage. Returns the storage path the analysis will be asked to read.
async function uploadToStorage(password, auditId, file) {
  const resp = await adminApi(password, {
    action: 'upload_url', audit_id: auditId,
    file_name: file.name, file_size_bytes: file.size,
  });
  if (!resp.ok) {
    const body = await resp.json().catch(() => null);
    throw new Error(body?.error || 'Could not prepare the upload.');
  }
  const { path, upload_token } = await resp.json();
  const { error } = await supabase.storage.from('policies').uploadToSignedUrl(path, upload_token, file);
  if (error) throw new Error(`Upload failed for ${file.name}. Please try again.`);
  return path;
}

// One analysis call. Extracted because there were two near-identical copies of
// this and replace/re-run/add would have made five; a fix applied to four of
// five copies is how the "|| 'UNKNOWN'" bug survived as long as it did.
// The document is named, not carried: the server reads it from storage. The
// browser used to base64 the PDF into this body, which is what capped an
// analysis at roughly 3MB regardless of what storage would hold.
async function analyzePdf(password, { storagePath, fileName, label, clientName, clientIndustry }) {
  try {
    const resp = await fetch('/api/analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-admin-password': password },
      body: JSON.stringify({
        system: ANALYSIS_PROMPT,
        storage_path: storagePath,
        file_name: fileName,
        // The server prepends the document block to this content array.
        messages: [{ role: 'user', content: [
          { type: 'text', text: "TODAY'S DATE: " + todayISO() + '\n\nAnalyze this ' + label + ' policy for ' + clientName + ' (Industry: ' + clientIndustry + '). Find ALL AI-related exclusions, gaps, and coverage issues. Respond ONLY with JSON.' },
        ] }],
      }),
    });
    if (!resp.ok) throw new Error(await describeFailure(resp));
    const data = await resp.json();
    const txt = data.content?.map(c => c.type === 'text' ? c.text : '').join('') || '';
    return JSON.parse(txt.replace(/```json|```/g, '').trim());
  } catch (e) {
    return { ai_status: 'FAILED', failure: { message: e.message, at: new Date().toISOString() } };
  }
}

// The columns an analysis writes, so replace / re-run / add all record a result
// the same way and a failed row never keeps stale values from a previous run.
function analysisColumns(result, fallbackType) {
  const status = result.ai_status || 'FAILED';
  return {
    ai_status: status,
    risk_level: isVerdict(status) ? (result.risk_level || null) : null,
    ai_raw_output: result,
    summary: isFailed(status) ? null : (result.summary || null),
    carrier: result.carrier || null,
    policy_number: result.policy_number || null,
    effective_date: result.effective_date || null,
    expiration_date: result.expiration_date || null,
    policy_type: (isAnalysed(status) && resolveDetectedType(result.policy_type)) || fallbackType,
    validation_status: 'PENDING',
  };
}

// --- Level 3: the client document ------------------------------------------
//
// Rendered entirely from the stored Level 1 row. It makes no API call, so it
// cannot introduce a claim that was not already reviewed on screen -- that is
// what makes "the client PDF contains nothing not visible in Level 1" a
// property of the code rather than a promise.
//
// agent_notes is never read here. Not filtered, not conditionally hidden:
// simply never referenced, so no future edit can leak it by flipping a flag.
// Navy and gold are taken from the logo artwork itself, imported rather than
// retyped, so the document cannot drift out of register with the mark.
const BRAND = {
  navy: BRAND_NAVY,
  gold: BRAND_GOLD,
  wordmark: 'The AI Insurance Group',
  subtitle: 'Coverage Review Report',
  preparedBy: 'Prepared by Sal Martorano',
  licence: 'NJ Insurance Producer License No. 3004245927',
  contact: 'sal@theaiinsurancegroup.com · 917-981-0245',
  footer: 'The AI Insurance Group · NJ Insurance Producer License No. 3004245927 · sal@theaiinsurancegroup.com · 917-981-0245',
};

// Muted enough to sit in a table without shouting, distinct enough to read at
// a glance. Not the app's RED/GREEN, which are UI signal colours and look
// cheap on a printed page.
const TERM_EXPIRED = '#9B2C2C';
const TERM_INFORCE = '#2F6B4F';

const BASIS_NOTE = 'This review is based solely on the documents provided for analysis. A coverage line shown as not provided was not supplied for review and may well be in force. Findings are for informational purposes and do not constitute a coverage determination, legal advice, or a binding coverage opinion. Final coverage interpretations should be confirmed with the issuing carrier.';

function ClientDocument({ audit, report, onBack }) {
  const table = report?.policy_table || [];
  const position = report?.coverage_position || [];
  const inPlace = position.filter(p => p.state === 'present');
  const gaps = position.filter(p => p.state === 'absent');
  const notProvided = position.filter(p => p.state === 'not_supplied');
  const recs = report?.client_recommendations || [];

  // A client has never seen the upload file names and they mean nothing to
  // them -- "2025-2026 Shamrock Materials Excess Auto Policy.pdf" is our
  // filing, not their policy. Everything the client reads identifies a policy
  // the way their broker would: carrier, line, policy number.
  const describePolicy = (fileName) => {
    const row = table.find(r => r.file_name === fileName);
    if (!row) return null;
    const carrier = row.carrier_short || row.carrier;
    return [carrier, row.line].filter(Boolean).join(' ') + (row.policy_number ? `, ${row.policy_number}` : '');
  };

  // The prompt is told not to put file names in client-facing text, but a
  // prompt is an instruction and this is a guarantee: any file name that does
  // appear in prose is swapped for the same carrier-and-number description, so
  // one cannot reach the client even if the model ignores the instruction.
  const scrub = (text) => {
    if (typeof text !== 'string') return text;
    return table.reduce((acc, r) => {
      if (!r.file_name) return acc;
      const described = describePolicy(r.file_name);
      const stem = r.file_name.replace(/\.pdf$/i, '');
      return acc.split(r.file_name).join(described || 'the policy').split(stem).join(described || 'the policy');
    }, text);
  };

  // The soonest term end still ahead of us. Expired policies are excluded --
  // a date already past is not a renewal to plan for, and showing one as the
  // next renewal would be worse than showing nothing.
  const fmtDay = (iso) => {
    const d = new Date(`${iso}T00:00:00`);
    return isNaN(d) ? iso : d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
  };
  const nextRenewal = (() => {
    const upcoming = table
      .filter(r => r.term_status?.state !== 'expired' && /^\d{4}-\d{2}-\d{2}$/.test(r.expiration_date || ''))
      .map(r => r.expiration_date)
      .sort();
    return upcoming.length ? fmtDay(upcoming[0]) : null;
  })();

  // Dated by when the review was finalized, not by when someone opens it.
  // Using today would mean the same document printed twice carries two
  // different dates, and a client could receive a report dated later than the
  // analysis behind it. Falls back to the report's own date, then to today.
  const isoDate = (audit.validated_at ? String(audit.validated_at).slice(0, 10) : null)
    || report?.generated_for_date
    || new Date().toISOString().slice(0, 10);
  const longDate = new Date(`${isoDate}T00:00:00`).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });

  // The browser uses document.title as the default file name when saving to
  // PDF, so this sets the tab title and what lands in the client's downloads
  // folder at once. Restored on unmount so the rest of the app is unaffected.
  const docTitle = `${audit.client_name} — Coverage Review — ${isoDate}`;
  useEffect(() => {
    const previous = document.title;
    document.title = docTitle;
    return () => { document.title = previous; };
  }, [docTitle]);

  // A deliberate type scale rather than ad-hoc sizes: one large display size
  // for the client name, one small-caps size for section headings, one body
  // size, one caption size. Everything on the page is one of these four.
  const T = {
    display: { fontSize: 34, fontWeight: 600, color: BRAND.navy, letterSpacing: -0.6, lineHeight: 1.15 },
    section: { fontSize: 10.5, fontWeight: 700, color: BRAND.gold, letterSpacing: 0.9, textTransform: 'uppercase' },
    body: { fontSize: 11.5, lineHeight: 1.75, color: '#374151' },
    caption: { fontSize: 9.5, lineHeight: 1.7, color: '#6B7280' },
  };
  const rule = { borderBottom: '1px solid ' + BRAND.gold, paddingBottom: 7, marginBottom: 20 };
  const Section = ({ title, children, breakBefore }) => (
    <section className={`pdf-keep${breakBefore ? ' pdf-break' : ''}`} style={{ marginBottom: 44 }}>
      <div style={{ ...T.section, ...rule }}>{title}</div>
      {children}
    </section>
  );
  // Small coloured dots carry status. Glyphs like a tick or an exclamation mark
  // read as a web UI; a dot reads as print.
  const Dot = ({ tone }) => (
    <span style={{ display: 'inline-block', width: 7, height: 7, borderRadius: '50%', background: tone, flexShrink: 0, marginTop: 7 }} />
  );
  // Two columns throughout: the thing on the left, what is said about it on
  // the right. Nothing runs on as a sentence with a dash in the middle.
  const Row = ({ tone, label, detail, last }) => (
    <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start', padding: '9px 0', borderBottom: last ? 'none' : '1px solid #F3F4F6' }}>
      <Dot tone={tone} />
      <div style={{ width: 190, flexShrink: 0, fontSize: 11.5, fontWeight: 600, color: BRAND.navy, lineHeight: 1.5 }}>{label}</div>
      <div style={{ flex: 1, ...T.body, fontSize: 11 }}>{detail || ''}</div>
    </div>
  );
  const th = { padding: '0 8px 8px', fontSize: 8.5, fontWeight: 700, color: '#6B7280', letterSpacing: 0.6, textTransform: 'uppercase', textAlign: 'left', borderBottom: '1px solid ' + BRAND.gold };
  const cell = { padding: '10px', fontSize: 10.5, color: '#374151', verticalAlign: 'top', lineHeight: 1.5 };

  return (
    <div style={{ background: WHITE, minHeight: '100vh' }}>
      <div className="no-print" style={{ background: BRAND.navy, padding: '12px 28px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
        <div style={{ color: WHITE, fontSize: 13 }}>Client document — preview. Use Print to save as PDF.</div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button style={{ ...S.btn, padding: '8px 18px', fontSize: 13 }} onClick={() => window.print()}>Print / Save as PDF</button>
          <button style={{ ...S.btnOut, padding: '8px 18px', fontSize: 13 }} onClick={onBack}>← Back to audit</button>
        </div>
      </div>

      <div className="pdf-doc" style={{ maxWidth: 780, margin: '0 auto', padding: '0 0 64px', color: '#1F2937' }}>

        {/* Cover. The navy band carries the wordmark; everything below it is
            white space and one large name, which is what makes it read as a
            cover page rather than the top of a web page. */}
        <div className="pdf-keep" style={{ padding: '40px 40px 0' }}>
          <BrandLogo tone="light" width={180} />
          <div style={{ fontSize: 9.5, marginTop: 12, letterSpacing: 1.8, textTransform: 'uppercase', color: BRAND.gold }}>{BRAND.subtitle}</div>

          <div style={{ marginTop: 84 }}>
            <div style={T.display}>{audit.client_name}</div>
            {audit.client_industry && <div style={{ ...T.body, marginTop: 10, color: '#6B7280' }}>{audit.client_industry}</div>}
          </div>

          {/* What the review covered, in figures, before any of the detail.
              Each is counted from the table and the coverage position rather
              than stated by anyone, so they cannot disagree with the pages
              that follow. */}
          <div style={{ marginTop: 30, borderTop: '1px solid ' + BRAND.gold, borderBottom: '1px solid #E5E7EB', padding: '16px 0', display: 'flex', gap: 44, flexWrap: 'wrap' }}>
            {[
              ['Policies reviewed', String(table.length)],
              ['Gaps identified', String(gaps.length)],
              ['Next renewal', nextRenewal || '—'],
            ].map(([label, value]) => (
              <div key={label}>
                <div style={{ fontSize: 8.5, letterSpacing: 1, textTransform: 'uppercase', color: '#6B7280', fontWeight: 700 }}>{label}</div>
                <div style={{ fontSize: 17, fontWeight: 600, color: BRAND.navy, marginTop: 5, fontVariantNumeric: 'tabular-nums' }}>{value}</div>
              </div>
            ))}
          </div>

          {/* Prepared for. Operator-entered, because the named insured on a
              declarations page is the legal entity and not always the name the
              client should be addressed by. Renders only when supplied. */}
          {(audit.named_insured || audit.mailing_address) && (
            <div style={{ marginTop: 30 }}>
              <div style={{ ...T.section, marginBottom: 8 }}>Prepared for</div>
              {audit.named_insured && <div style={{ fontSize: 12.5, fontWeight: 600, color: BRAND.navy, lineHeight: 1.5 }}>{audit.named_insured}</div>}
              {audit.mailing_address && (
                <div style={{ ...T.caption, marginTop: 4, whiteSpace: 'pre-line' }}>{audit.mailing_address}</div>
              )}
            </div>
          )}

          <div style={{ marginTop: 34 }}>
            <div style={T.caption}>{longDate}</div>
            <div style={{ ...T.caption, color: '#374151', marginTop: 3 }}>{BRAND.preparedBy}</div>
          </div>
        </div>

        <div style={{ padding: '0 40px' }}>

          {/* Coverage summary. Row banding instead of gridlines, and the one
              column of figures right-aligned so the decimal points line up. */}
          <Section title="Coverage Summary" breakBefore>
            <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed' }}>
              {/* Policy number and Expires are both nowrap, so each needs the
                  room to hold its longest real value: the table is fixed
                  layout, where a column too narrow overflows rather than
                  wraps. Limits gives up the width -- it is the one column
                  that reads fine over two lines. */}
              <colgroup><col style={{ width: '17%' }} /><col style={{ width: '13%' }} /><col style={{ width: '21%' }} /><col style={{ width: '20%' }} /><col style={{ width: '15%' }} /><col style={{ width: '14%' }} /></colgroup>
              <thead><tr>
                {['Coverage', 'Carrier', 'Policy Number', 'Limits', 'Expires', 'Premium'].map(h =>
                  <th key={h} style={{ ...th, textAlign: h === 'Premium' ? 'right' : 'left' }}>{h}</th>)}
              </tr></thead>
              <tbody>
                {table.map((r, i) => (
                  <tr key={i} className="pdf-keep" style={{ background: i % 2 ? '#F8FAFC' : WHITE }}>
                    <td style={{ ...cell, fontWeight: 600, color: BRAND.navy }}>{r.line}</td>
                    <td style={cell}>{r.carrier_short || r.carrier || '—'}</td>
                    {/* A policy number is one token even when it contains a
                        space, as in "IEPUW00315825 / 01". break-all split it
                        mid-number, which makes it unusable for looking the
                        policy up -- the one thing this column is for. */}
                    <td style={{ ...cell, whiteSpace: 'nowrap', fontSize: 10, fontVariantNumeric: 'tabular-nums' }}>{r.policy_number || '—'}</td>
                    <td style={cell}>{r.key_limits || '—'}</td>
                    {/* An expired term is the one thing in this table a client
                        must not skim past, and an in-force one is the
                        reassurance the rest of the row is worth reading. */}
                    <td style={{ ...cell, whiteSpace: 'nowrap', color: r.term_status?.state === 'expired' ? TERM_EXPIRED : TERM_INFORCE, fontWeight: 600 }}>
                      {r.expiration_date || '—'}
                      {r.term_status?.state === 'expired'
                        ? <span style={{ display: 'block', fontSize: 9, fontWeight: 400, letterSpacing: 0.3 }}>expired</span>
                        : null}
                    </td>
                    <td style={{ ...cell, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{r.premium_total || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Section>

          {/* What's in place. The client sees the carrier and policy number they
              would recognise, never the name of the file we were sent. */}
          {inPlace.length > 0 && (
            <Section title="Coverage In Place">
              {inPlace.map((p, i) => (
                <Row key={i} tone="#15803D" label={p.line} last={i === inPlace.length - 1}
                     detail={describePolicy(p.policy) || scrub(p.note)} />
              ))}
            </Section>
          )}

          {/* Gaps and items not provided, kept visibly distinct: one is a
              finding, the other is a document we were never given. */}
          {gaps.length > 0 && (
            <Section title="Coverage Gaps">
              <div style={{ ...T.caption, marginTop: -6, marginBottom: 6 }}>Not carried on the policies reviewed</div>
              {gaps.map((p, i) => (
                <Row key={i} tone="#B91C1C" label={p.line} detail={scrub(p.note)} last={i === gaps.length - 1} />
              ))}
            </Section>
          )}

          {notProvided.length > 0 && (
            <Section title="Not provided for review">
              <div style={{ ...T.caption, marginTop: -6, marginBottom: 6 }}>Please confirm whether these are in force</div>
              {notProvided.map((p, i) => (
                <Row key={i} tone="#9CA3AF" label={p.line} detail={scrub(p.note)} last={i === notProvided.length - 1} />
              ))}
            </Section>
          )}

          {recs.length > 0 && (
            <Section title="Recommendations">
              {recs.map((r, i) => (
                <div key={i} className="pdf-keep" style={{ display: 'flex', gap: 14, alignItems: 'flex-start', padding: '9px 0', borderBottom: i === recs.length - 1 ? 'none' : '1px solid #F3F4F6' }}>
                  <span style={{ fontSize: 11.5, fontWeight: 600, color: BRAND.navy, minWidth: 16, lineHeight: 1.75 }}>{i + 1}</span>
                  <span style={T.body}>{scrub(r)}</span>
                </div>
              ))}
            </Section>
          )}

          {/* Basis, in small grey type. A box with a border would give it the
              weight of a finding; it is a qualification, not a finding. */}
          <div className="pdf-keep" style={{ ...T.caption, borderTop: '1px solid #E5E7EB', paddingTop: 14 }}>
            <span style={{ color: '#374151', fontWeight: 600 }}>Basis of this review. </span>{BASIS_NOTE}
          </div>
        </div>
      </div>

      {/* Repeats on every printed page (position: fixed in the print sheet),
          which is what a licence number in a footer has to do. */}
      <div className="pdf-footer" style={{ display: 'flex', alignItems: 'center', gap: 12, fontSize: 8.5, color: '#6B7280', padding: '8px 40px', borderTop: '1px solid ' + BRAND.gold, background: WHITE }}>
        <BrandLogo tone="light" width={86} style={{ flexShrink: 0 }} />
        {/* The mark alone does not name the agency in text, and the licence
            line has to be attributable to a named producer on its face. */}
        <div style={{ lineHeight: 1.5 }}>
          <div>{BRAND.wordmark} · {BRAND.licence}</div>
          <div>{BRAND.contact}</div>
        </div>
      </div>
    </div>
  );
}

const genId = () => Math.random().toString(36).substr(2, 9);
const fmtDate = (iso) => new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
const fmtDateTime = (iso) => new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });

// logActivity lives at module scope but needs to reach React state to raise a
// visible alarm. App registers a real handler on mount.
let logFailureSink = () => {};

// Routed through /api/admin/audit so it survives revoking the anon grants.
// Takes the admin password because module scope cannot see React state.
const logActivity = async (password, auditId, action, details, performedBy = 'system') => {
  try {
    const r = await adminApi(password, {
      action: 'insert',
      table: 'activity_log',
      payload: { audit_id: auditId, action, details, performed_by: performedBy },
    });
    if (!r.ok) throw new Error('server returned ' + r.status);
    return true;
  } catch (e) {
    // Do not swallow: this is the compliance trail. The operation itself is
    // allowed to continue, but the gap must be visible to the operator.
    console.error('Activity log write failed:', action, e);
    logFailureSink({ action, reason: String(e?.message || e), at: new Date().toISOString() });
    return false;
  }
};

// Only completed verdicts carry risk. A failed or pending policy said nothing,
// and a document that is not a policy carries no coverage risk -- previously
// every one of those fell through to MODERATE, or worse let an all-failed audit
// read LOW, which is an audit asserting a coverage position nobody established.
const calcRisk = (statuses) => {
  const verdicts = statuses.filter(isVerdict);
  if (!verdicts.length) return 'UNKNOWN';
  if (verdicts.includes('EXCLUDED')) return 'HIGH';
  if (verdicts.includes('SILENT')) return 'MODERATE';
  if (verdicts.every(s => s === 'AFFIRMATIVE')) return 'LOW';
  return 'MODERATE';
};

// ============ CLIENT PORTAL (public, no auth) ============
// Talks only to /api/client/portal. The one remaining direct Supabase call is
// an upload to a server-issued signed URL, which authorizes via the signed
// token rather than the anon key's storage policy, so it keeps working once
// the anon grants are revoked.
async function portalApi(body) {
  const r = await fetch('/api/client/portal', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  let data = null;
  try { data = await r.json(); } catch { /* non-JSON error body */ }
  if (!r.ok) throw new Error(data?.error || 'Request failed. Please try again.');
  return data;
}

function ClientPortal({ token }) {
  const [audit, setAudit] = useState(null);
  const [consentText, setConsentText] = useState('');
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
      try {
        const data = await portalApi({ action: 'lookup', token });
        if (data.client_submitted_at) setDone(true);
        setAudit(data);
        setConsentText(data.consent_statement);
      } catch {
        setAudit(null); // renders the existing "Invalid Link" state
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
      // 1. One signed URL per file; the bytes go straight to storage and never
      //    through the function. The server owns the path.
      const uploaded = [];
      for (const f of files) {
        const { path, upload_token } = await portalApi({
          action: 'upload_url', token,
          file_name: f.name, file_size_bytes: f.size,
        });
        const { error: upErr } = await supabase.storage
          .from('policies')
          .uploadToSignedUrl(path, upload_token, f.file);
        // Unlike before, an upload failure aborts instead of logging and
        // continuing: otherwise consent is recorded for a missing document.
        if (upErr) throw new Error(`Upload failed for ${f.name}. Please try again.`);
        uploaded.push({
          policy_type: f.pt, file_name: f.name,
          file_size_bytes: f.size, storage_path: path,
        });
      }

      // 2. Consent and document records in one server-side step. The server
      //    stamps both timestamps and the consent statement.
      await portalApi({
        action: 'submit', token,
        signer_name: signerName, signer_title: signerTitle,
        files: uploaded,
      });
      // CLIENT_SUBMITTED is logged server-side now, with the real IP.
      setDone(true);
    } catch (e) { setError(e.message || 'Submission failed.'); }
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
          <div style={{ background: '#F9FAFB', borderRadius: 8, padding: 16, marginBottom: 16, fontSize: 13, lineHeight: 1.7, maxHeight: 150, overflowY: 'auto' }}>{consentText}</div>
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
  // Buttons that sit on a light card. btnOut above is white-on-transparent for
  // the navy header bar; on a light background it renders white text on
  // near-white and is effectively invisible. Disabled is grey-on-grey with a
  // not-allowed cursor -- visibly unavailable, rather than an enabled-looking
  // button dimmed by opacity, which reads as a rendering glitch.
  actionBtn: (disabled, opts = {}) => ({
    background: disabled ? '#F3F4F6' : (opts.primary ? NAVY : WHITE),
    color: disabled ? '#9CA3AF' : (opts.primary ? WHITE : NAVY),
    border: '1px solid ' + (disabled ? LIGHT_GRAY : NAVY),
    borderRadius: 6,
    padding: opts.small ? '6px 12px' : '9px 18px',
    fontSize: opts.small ? 12 : 13,
    fontWeight: 600,
    cursor: disabled ? 'not-allowed' : 'pointer',
    whiteSpace: 'nowrap',
  }),
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

  const [authed, setAuthed] = useState(false);
  const [adminPw, setAdminPw] = useState('');
  const [pw, setPw] = useState('');
  const [authErr, setAuthErr] = useState('');
  const [loggingIn, setLoggingIn] = useState(false);
  const [screen, setScreen] = useState('dashboard');
  const [audits, setAudits] = useState([]);
  const [curAudit, setCurAudit] = useState(null);
  const [curPolicies, setCurPolicies] = useState([]);
  const [loading, setLoading] = useState(false);
  const [loadMsg, setLoadMsg] = useState('');
  const [progress, setProgress] = useState({ c: 0, t: 0, l: '' });
  const [error, setError] = useState('');
  const [actLog, setActLog] = useState([]);
  const [logFailures, setLogFailures] = useState([]);

  // A compliance trail that fails quietly is worse than no trail at all.
  useEffect(() => {
    logFailureSink = (f) => setLogFailures(prev => [...prev, f]);
    return () => { logFailureSink = () => {}; };
  }, []);

  const [clientName, setClientName] = useState('');
  const [clientInd, setClientInd] = useState('');
  const [clientContact, setClientContact] = useState('');
  // Cover-block fields. Operator-entered: a declarations page names the legal
  // entity ("... LLC DBA ..."), which is right on paper and wrong on a cover
  // addressed to the client.
  const [namedInsured, setNamedInsured] = useState('');
  const [mailingAddress, setMailingAddress] = useState('');
  const [coverSaving, setCoverSaving] = useState(false);
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
  const [expandedPolicies, setExpandedPolicies] = useState(new Set());
  const [rowBusy, setRowBusy] = useState(null);   // policy id, or 'new'
  const [rowErr, setRowErr] = useState('');
  const [addType, setAddType] = useState('detect');
  const replaceRef = useRef(null);
  const addRef = useRef(null);
  const replaceTarget = useRef(null);
  const [progReport, setProgReport] = useState(null);
  const [progLoading, setProgLoading] = useState(false);
  const [progErr, setProgErr] = useState('');

  useEffect(() => { if (authed) loadAudits(); }, [authed]);

  const loadAudits = async () => {
    const data = await adminJson(adminPw, { action: 'select', table: 'audits', filter: { deleted_at: null }, order: 'created_at.desc' });
    setAudits(Array.isArray(data) ? data : []);
  };

  // A generated report is stored, so re-opening the audit should show it rather
  // than making the operator pay to generate it again.
  const loadProgramReport = async (auditId) => {
    const rows = await adminJson(adminPw, {
      action: 'select', table: 'audit_program_analysis',
      filter: { audit_id: auditId }, order: 'generated_at.desc', limit: 1,
    });
    const row = Array.isArray(rows) ? rows[0] : null;
    setProgReport(row?.result || null);
    setProgErr('');
  };

  const loadPolicies = async (id) => {
    const data = await adminJson(adminPw, { action: 'select', table: 'audit_policies', filter: { audit_id: id }, order: 'created_at' });
    return Array.isArray(data) ? data : [];
  };

  const login = async () => {
    if (!pw || loggingIn) return;
    setLoggingIn(true);
    setAuthErr('');
    try {
      const r = await adminApi(pw, { action: 'verify' });
      if (r.ok) { setAdminPw(pw); setAuthed(true); setPw(''); }
      else if (r.status === 401) setAuthErr('Incorrect password');
      else setAuthErr('Could not reach server. Try again.');
    } catch (e) {
      setAuthErr('Network error: ' + e.message);
    }
    setLoggingIn(false);
  };

  const logout = () => { setAuthed(false); setAdminPw(''); };

  const openAudit = async (audit) => {
    const pols = await loadPolicies(audit.id);
    setCurAudit(audit); setCurPolicies(pols);
    const a = {}, n = {};
    pols.forEach((p, pi) => {
      const out = p.validated_output || p.ai_raw_output;
      (out?.findings || []).forEach((_, fi) => { a[`${pi}-${fi}`] = p.validation_status === 'VALIDATED' ? 'CONFIRMED' : ''; n[`${pi}-${fi}`] = ''; });
    });
    setFActions(a); setFNotes(n); setValName(''); setError('');
    await loadProgramReport(audit.id);
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
    // The other upload paths have always checked this; this one never did, so
    // an oversize file here failed at the far end with a generic message.
    const tooBig = files.filter(f => f.size > MAX_PDF_BYTES);
    if (tooBig.length) {
      setError(`${tooBig.map(f => `${f.name} (${mb(f.size)} MB)`).join(', ')} — over the ${mb(MAX_PDF_BYTES)} MB limit. ${PAGE_LIMIT_HINT}`);
      return;
    }
    setError(''); setLoading(true); setScreen('analyzing');

    const auditResp = await adminApi(adminPw, { action: 'insert', table: 'audits', returnRow: true, payload: {
      client_name: clientName, client_industry: clientInd, client_contact: clientContact,
      client_email: clientEmail, status: 'DRAFT', file_count: files.length, created_by: 'operator',
      named_insured: namedInsured.trim() || null, mailing_address: mailingAddress.trim() || null,
    }});
    if (!auditResp.ok) { setError('Failed to create audit.'); setLoading(false); setScreen('new-audit'); return; }
    const auditRows = await auditResp.json().catch(() => null);
    const audit = Array.isArray(auditRows) ? auditRows[0] : auditRows;
    if (!audit || !audit.id) { setError('Failed to create audit.'); setLoading(false); setScreen('new-audit'); return; }

    await adminApi(adminPw, { action: 'insert', table: 'client_consents', payload: {
      audit_id: audit.id, client_name: signerName, client_title: signerTitle,
      client_company: clientName, client_email: clientEmail, consent_text: CONSENT_TEXT, signed_name: signerName,
    }});
    await logActivity(adminPw, audit.id, 'AUDIT_CREATED', { client: clientName, files: files.length }, 'operator');
    await logActivity(adminPw, audit.id, 'CONSENT_SIGNED', { signer: signerName }, signerName);

    const statuses = [];
    for (let i = 0; i < files.length; i++) {
      const f = files[i];
      const lbl = POLICY_TYPES.find(p => p.id === f.pt)?.label || f.pt;
      setProgress({ c: i + 1, t: files.length, l: lbl });
      setLoadMsg('Analyzing ' + lbl + '...');

      // Stored before analysed, and the path kept on the row, so this document
      // can be re-run later. Admin uploads used to stream straight to the API
      // and keep nothing, which made Re-run impossible for every row they made.
      let storagePath = null, result;
      try {
        setLoadMsg('Uploading ' + lbl + '...');
        storagePath = await uploadToStorage(adminPw, audit.id, f.file);
        setLoadMsg('Analyzing ' + lbl + '...');
        result = await analyzePdf(adminPw, { storagePath, fileName: f.name, label: lbl, clientName, clientIndustry: clientInd });
      } catch (e) {
        result = { ai_status: 'FAILED', failure: { message: e.message, at: new Date().toISOString() } };
      }

      // A missing status means the run did not produce one, which is a failure.
      // It used to default to UNKNOWN -- a real verdict -- so a broken run was
      // recorded as "this is not an insurance policy".
      const status = result.ai_status || 'FAILED';
      statuses.push(status);
      await adminApi(adminPw, { action: 'insert', table: 'audit_policies', payload: {
        audit_id: audit.id,
        policy_type: (isAnalysed(status) && resolveDetectedType(result.policy_type)) || f.pt,
        file_name: f.name, file_size_bytes: f.size, storage_path: storagePath,
        carrier: result.carrier || null, policy_number: result.policy_number || null,
        effective_date: result.effective_date || null, expiration_date: result.expiration_date || null,
        ai_status: status, risk_level: isVerdict(status) ? (result.risk_level || null) : null,
        ai_raw_output: result,
        summary: isFailed(status) ? null : (result.summary || null),
        validation_status: 'PENDING',
      }});
      await logActivity(adminPw, audit.id, 'POLICY_ANALYZED', { type: lbl, file: f.name, status, findings: result.findings?.length || 0, ...(isFailed(status) ? { failure: result.failure?.message } : {}) }, 'system');
    }

    const risk = calcRisk(statuses);
    await adminApi(adminPw, { action: 'update', table: 'audits', filter: { id: audit.id }, payload: { overall_risk: risk } });
    audit.overall_risk = risk;

    await loadAudits();
    const pols = await loadPolicies(audit.id);
    setCurAudit(audit); setCurPolicies(pols);
    setProgReport(null); setProgErr('');
    setLoading(false); setScreen('report');
    setClientName(''); setClientInd(''); setClientContact(''); setClientEmail(''); setNamedInsured(''); setMailingAddress('');
    setConsentOk(false); setSignerName(''); setSignerTitle(''); setFiles([]);
    const a = {};
    pols.forEach((p, pi) => (p.ai_raw_output?.findings || []).forEach((_, fi) => { a[pi + '-' + fi] = ''; }));
    setFActions(a); setFNotes({}); setValName('');
  };

  // Policies whose analysis never completed. A report must not be finalized
  // while any of these are in it: the findings, the coverage gaps and the
  // overall risk would all be drawn from a document nobody actually read.
  const unanalysedPolicies = () => curPolicies.filter(p => !isAnalysed(p.ai_status));

  // --- acting on a single policy row, in place -----------------------------
  //
  // A failed row keeps its identity: same audit, same row, same position in the
  // report. Replacing the file or re-running it updates that row rather than
  // adding a second one, so the audit does not accumulate a fossil per attempt.

  const refreshAfterPolicyChange = async (auditId) => {
    const pols = await loadPolicies(auditId);
    setCurPolicies(pols);
    const risk = calcRisk(pols.map(p => p.ai_status));
    await adminApi(adminPw, { action: 'update', table: 'audits', filter: { id: auditId }, payload: { overall_risk: risk, file_count: pols.length } });
    setCurAudit(prev => prev ? { ...prev, overall_risk: risk, file_count: pols.length } : prev);
    // The stored program report described the previous set of policies.
    setProgReport(null);
    await loadAudits();
    return pols;
  };

  const runOnePolicy = async (pol, { storagePath, fileName, fileSize, typeId }) => {
    const label = POLICY_TYPES.find(p => p.id === (typeId || pol.policy_type))?.label || pol.policy_type;
    setRowBusy(pol.id); setRowErr('');
    try {
      const result = await analyzePdf(adminPw, {
        storagePath, fileName: fileName || pol.file_name, label,
        clientName: curAudit.client_name, clientIndustry: curAudit.client_industry,
      });
      const payload = {
        ...analysisColumns(result, typeId || pol.policy_type),
        // A replacement carries a new document, so the row's pointer to the old
        // one must move with it or a later re-run would analyse the file the
        // operator just replaced.
        ...(fileName ? { file_name: fileName, file_size_bytes: fileSize, storage_path: storagePath } : {}),
      };
      const upd = await adminApi(adminPw, { action: 'update', table: 'audit_policies', filter: { id: pol.id }, payload });
      if (!upd.ok) { setRowErr('Analysis finished but the result could not be saved.'); return; }
      await logActivity(adminPw, curAudit.id, fileName ? 'POLICY_FILE_REPLACED' : 'POLICY_RERUN',
        { file: fileName || pol.file_name, status: payload.ai_status, ...(isFailed(payload.ai_status) ? { failure: result.failure?.message } : {}) }, 'operator');
      await refreshAfterPolicyChange(curAudit.id);
      if (isFailed(payload.ai_status)) setRowErr(`${fileName || pol.file_name}: ${failureReason({ ai_raw_output: result })}`);
    } finally {
      setRowBusy(null);
    }
  };

  // Replace the document in an existing row, then analyse it.
  const replaceFile = async (pol, file) => {
    if (!file) return;
    if (!file.name.toLowerCase().endsWith('.pdf')) { setRowErr('Only PDF files can be analysed.'); return; }
    if (file.size > MAX_PDF_BYTES) {
      setRowErr(`${file.name} is ${mb(file.size)} MB, over the ${mb(MAX_PDF_BYTES)} MB storage limit. ${PAGE_LIMIT_HINT}`);
      return;
    }
    setRowBusy(pol.id); setRowErr('');
    let path;
    try {
      path = await uploadToStorage(adminPw, curAudit.id, file);
    } catch (e) {
      setRowErr(e.message); setRowBusy(null); return;
    } finally {
      setRowBusy(null);
    }
    await runOnePolicy(pol, { storagePath: path, fileName: file.name, fileSize: file.size, typeId: pol.policy_type });
  };

  // Re-run the document already held for this row. Every row has one now: an
  // admin upload is stored before it is analysed, exactly like a client one.
  // Rows created before that change still have no storage_path, and for those
  // the document was never kept, so Replace remains the only route.
  const rerunPolicy = async (pol) => {
    if (!pol.storage_path) { setRowErr('This document was uploaded before documents were stored, so it cannot be re-run. Use Replace file.'); return; }
    await runOnePolicy(pol, { storagePath: pol.storage_path });
  };

  // A late document joins the audit as a new row.
  const addPolicy = async (file, typeId) => {
    if (!file) return;
    if (!file.name.toLowerCase().endsWith('.pdf')) { setRowErr('Only PDF files can be analysed.'); return; }
    if (file.size > MAX_PDF_BYTES) {
      setRowErr(`${file.name} is ${mb(file.size)} MB, over the ${mb(MAX_PDF_BYTES)} MB storage limit. ${PAGE_LIMIT_HINT}`);
      return;
    }
    setRowBusy('new'); setRowErr('');
    try {
      const label = POLICY_TYPES.find(p => p.id === typeId)?.label || typeId;
      let storagePath = null, result;
      try {
        storagePath = await uploadToStorage(adminPw, curAudit.id, file);
        result = await analyzePdf(adminPw, { storagePath, fileName: file.name, label, clientName: curAudit.client_name, clientIndustry: curAudit.client_industry });
      } catch (e) {
        result = { ai_status: 'FAILED', failure: { message: e.message, at: new Date().toISOString() } };
      }
      const ins = await adminApi(adminPw, { action: 'insert', table: 'audit_policies', payload: {
        audit_id: curAudit.id, file_name: file.name, file_size_bytes: file.size, storage_path: storagePath,
        ...analysisColumns(result, typeId),
      }});
      if (!ins.ok) { setRowErr('Analysis finished but the new policy could not be saved.'); return; }
      await logActivity(adminPw, curAudit.id, 'POLICY_ADDED', { file: file.name, type: label, status: result.ai_status || 'FAILED' }, 'operator');
      await refreshAfterPolicyChange(curAudit.id);
      if (isFailed(result.ai_status || 'FAILED')) setRowErr(`${file.name}: ${failureReason({ ai_raw_output: result })}`);
    } finally {
      setRowBusy(null);
    }
  };

  // The program-level pass: the only place an absence can honestly be asserted,
  // because it is the only one that sees every policy at once. The server
  // enforces the same "every policy must have been read" rule -- this button
  // is a convenience, not the control.
  const generateProgramReport = async () => {
    if (unanalysedPolicies().length || !curPolicies.length) return;
    setProgErr(''); setProgLoading(true);
    try {
      const resp = await fetch('/api/admin/program-report', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-admin-password': adminPw },
        body: JSON.stringify({ audit_id: curAudit.id, generated_by: valName || 'operator', today: todayISO().slice(0, 10) }),
      });
      const data = await resp.json().catch(() => null);
      if (!resp.ok) {
        // 409 is the guard refusing, and it names the documents it could not
        // read. That is an answer, not a malfunction -- show it as one.
        if (resp.status === 409 && data?.unread_policies) {
          setProgErr(`${data.reason} Unread: ${data.unread_policies.map(u => u.file_name).join(', ')}`);
        } else {
          setProgErr(data?.error ? `${data.error}${data.upstream_status ? ` (upstream ${data.upstream_status})` : ''}` : `Request failed (HTTP ${resp.status})`);
        }
        return;
      }
      setProgReport(data.result);
      if (data.stored === false) setProgErr('Report generated but could not be saved: ' + (data.store_error || 'unknown'));
      await logActivity(adminPw, curAudit.id, 'PROGRAM_REPORT_GENERATED', { policies: data.policies_included?.length ?? 0 }, valName || 'operator');
    } catch (e) {
      setProgErr('Network error: ' + e.message);
    } finally {
      setProgLoading(false);
    }
  };

  // Bulk confirm. Only fills in findings that are still UNREVIEWED, so an
  // earlier Reject or Modify is never silently overwritten by a later bulk
  // click. Nothing is written to the database here -- it sets exactly the same
  // local state the per-finding buttons set -- so every finding can still be
  // changed individually afterwards, and a misclick costs nothing until
  // Validate & Finalize writes the trail.
  const unreviewedIn = (policyIndex) => unreviewedCount(curPolicies, fActions, policyIndex);

  const confirmAll = async (policyIndex) => {
    const { patch, count, perFile } = bulkConfirmPatch(curPolicies, fActions, policyIndex);
    if (!count) return;
    setFActions(prev => ({ ...prev, ...patch }));
    // One entry, not one per finding, and a distinct action name: the trail
    // should show that these were accepted in bulk rather than read one by one.
    await logActivity(adminPw, curAudit.id, 'FINDINGS_BULK_CONFIRMED',
      { scope: policyIndex === undefined ? 'whole audit' : 'single policy', findings_confirmed: count, policies: perFile },
      valName || 'operator');
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
    if (unanalysedPolicies().length) {
      setError('Cannot finalize: ' + unanalysedPolicies().map(p => p.file_name).join(', ') + ' did not analyse successfully. Re-run or remove before finalizing.');
      return;
    }
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
        await adminApi(adminPw, { action: 'insert', table: 'finding_validations', payload: {
          policy_id: pol.id, finding_index: fi, action: act,
          original_finding: findings[fi], modified_finding: act === 'MODIFIED' ? { ...findings[fi], _note: note } : null,
          validator_name: valName, notes: note,
        }});
        if (act !== 'REJECTED') validated.push(act === 'MODIFIED' ? { ...findings[fi], _validator_note: note } : findings[fi]);
        await logActivity(adminPw, curAudit.id, 'FINDING_' + act, { type: pol.policy_type, idx: fi, desc: findings[fi].description }, valName);
      }

      await adminApi(adminPw, { action: 'update', table: 'audit_policies', filter: { id: pol.id }, payload: {
        validated_output: { ...raw, findings: validated }, validation_status: 'VALIDATED',
        validated_by: valName, validated_at: now,
      }});
    }

    await adminApi(adminPw, { action: 'update', table: 'audits', filter: { id: curAudit.id }, payload: { status: 'VALIDATED', validated_by: valName, validated_at: now } });
    await logActivity(adminPw, curAudit.id, 'REPORT_VALIDATED', { validator: valName, policies: curPolicies.length }, valName);

    await loadAudits();
    const updated = { ...curAudit, status: 'VALIDATED', validated_by: valName, validated_at: now };
    const pols = await loadPolicies(curAudit.id);
    setCurAudit(updated); setCurPolicies(pols);
  };

  const softDel = async (id) => {
    if (!window.confirm('Archive this audit? Hidden but preserved for compliance.')) return;
    await adminApi(adminPw, { action: 'soft_delete_audit', id });
    await logActivity(adminPw, id, 'AUDIT_ARCHIVED', {}, 'operator');
    await loadAudits();
  };

  const sendToClient = async () => {
    if (!clientName || !clientInd) return;
    setError('');
    const token = genId() + genId() + genId();
    const resp = await adminApi(adminPw, { action: 'insert', table: 'audits', returnRow: true, payload: {
      client_name: clientName, client_industry: clientInd, client_contact: clientContact,
      client_email: clientEmail, status: 'DRAFT', file_count: 0, client_token: token,
      named_insured: namedInsured.trim() || null, mailing_address: mailingAddress.trim() || null,
    }});
    if (!resp.ok) { setError('Failed to create audit.'); return; }
    const rows = await resp.json().catch(() => null);
    const audit = Array.isArray(rows) ? rows[0] : rows;
    if (!audit || !audit.id) { setError('Failed to create audit.'); return; }
    await logActivity(adminPw, audit.id, 'CLIENT_LINK_CREATED', { client: clientName }, 'operator');
    const link = window.location.origin + '?token=' + token;
    setClientLink(link);
    await loadAudits();
    setClientName(''); setClientInd(''); setClientContact(''); setClientEmail(''); setNamedInsured(''); setMailingAddress('');
  };

  const runAuditFromStorage = async (audit) => {
    const pols = await loadPolicies(audit.id);
    if (!pols.length) { setError('No documents uploaded by client yet.'); return; }
    setLoading(true); setScreen('analyzing');
    setCurAudit(audit);

    const statuses = [];
    for (let i = 0; i < pols.length; i++) {
      const pol = pols[i];
      // Re-run anything that has not produced a verdict: PENDING as before, and
      // now FAILED too, so a run that broke can be retried without re-uploading.
      if (!isPending(pol.ai_status) && !isFailed(pol.ai_status)) { statuses.push(pol.ai_status); continue; }
      const lbl = POLICY_TYPES.find(p => p.id === pol.policy_type)?.label || pol.policy_type;
      setProgress({ c: i + 1, t: pols.length, l: lbl });
      setLoadMsg('Analyzing ' + lbl + '...');

      // The document stays on the server. It used to be downloaded here, sent
      // to the browser as base64 and posted straight back, which is the round
      // trip that made a 25MB client upload unanalysable.
      const result = pol.storage_path
        ? await analyzePdf(adminPw, { storagePath: pol.storage_path, fileName: pol.file_name, label: lbl, clientName: audit.client_name, clientIndustry: audit.client_industry })
        : { ai_status: 'FAILED', failure: { message: 'No stored document for this row', at: new Date().toISOString() } };

      const status = result.ai_status || 'FAILED';
      statuses.push(status);
      await adminApi(adminPw, { action: 'update', table: 'audit_policies', filter: { id: pol.id }, payload: {
        ai_status: status, risk_level: isVerdict(status) ? (result.risk_level || null) : null,
        ai_raw_output: result,
        summary: isFailed(status) ? null : (result.summary || null),
        carrier: result.carrier || null,
        policy_number: result.policy_number || null,
        // Keep the stored type honest once the run has identified the document.
        ...(isAnalysed(status) && resolveDetectedType(result.policy_type)
          ? { policy_type: resolveDetectedType(result.policy_type) }
          : {}),
      }});
      await logActivity(adminPw, audit.id, 'POLICY_ANALYZED', { type: lbl, file: pol.file_name, status, ...(isFailed(status) ? { failure: result.failure?.message } : {}) }, 'system');
    }

    const risk = calcRisk(statuses);
    await adminApi(adminPw, { action: 'update', table: 'audits', filter: { id: audit.id }, payload: { overall_risk: risk, file_count: pols.length } });
    audit.overall_risk = risk; audit.file_count = pols.length;

    await loadAudits();
    const updatedPols = await loadPolicies(audit.id);
    setCurAudit(audit); setCurPolicies(updatedPols);
    // A re-run changes what the program report was based on, so the stored one
    // no longer describes this audit. Clear it rather than show a stale report.
    setProgReport(null); setProgErr('');
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
    const filter = auditId ? { audit_id: auditId } : {};
    const limit = auditId ? 100 : 200;
    const data = await adminJson(adminPw, { action: 'select', table: 'activity_log', filter, order: 'created_at.desc', limit });
    setActLog(Array.isArray(data) ? data : []);
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
          <input type="password" style={S.input} value={pw} onChange={e => setPw(e.target.value)} onKeyDown={e => e.key === 'Enter' && login()} placeholder="Enter access password" disabled={loggingIn} />
          {authErr && <div style={{ color: RED, fontSize: 13, marginTop: 8 }}>{authErr}</div>}
        </div>
        <button style={{ ...S.btn, width: '100%', opacity: loggingIn ? 0.6 : 1 }} onClick={login} disabled={loggingIn}>{loggingIn ? 'Signing in…' : 'Sign In'}</button>
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
    <>
    <div style={S.header} className="no-print">
      <div><div style={{ color: GOLD, fontSize: 18, fontWeight: 700, letterSpacing: 1.2 }}>AI POLICY AUDIT TOOL</div>
      <div style={{ color: 'rgba(255,255,255,0.5)', fontSize: 11, letterSpacing: 2, marginTop: 2 }}>THE AI INSURANCE GROUP</div></div>
      <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
        <HelpModal />
        <button onClick={() => setShowHelp(true)} style={{ background: 'transparent', color: GOLD, border: '1px solid ' + GOLD, borderRadius: 6, padding: '6px 14px', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>📖 How To Use</button>
        {right}
      </div>
    </div>
    {logFailures.length > 0 && (
      <div className="no-print" style={{ background: '#FEF2F2', borderBottom: '2px solid ' + RED, padding: '12px 28px', display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 13, fontWeight: 700, color: RED }}>
          ⚠ {logFailures.length} activity-log {logFailures.length === 1 ? 'entry' : 'entries'} failed to record
        </span>
        <span style={{ fontSize: 12, color: MID_GRAY }}>
          {logFailures.slice(-3).map(f => f.action).join(', ')}{logFailures.length > 3 ? ' and earlier' : ''} — the compliance trail is incomplete.
        </span>
        <button onClick={() => setLogFailures([])} style={{ marginLeft: 'auto', background: 'transparent', border: '1px solid ' + RED, color: RED, borderRadius: 6, padding: '4px 12px', fontSize: 12, cursor: 'pointer' }}>Dismiss</button>
      </div>
    )}
    </>
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
  // Level 3. Guarded twice over: the button only exists on a finalized audit
  // with a stored report, and this refuses to render without both -- so a
  // stale screen state cannot put an unvalidated report in front of a client.
  if (screen === 'client-doc') {
    if (!curAudit || curAudit.status !== 'VALIDATED' || !progReport) { setScreen('report'); return null; }
    return <ClientDocument audit={curAudit} report={progReport} onBack={() => setScreen('report')} />;
  }

  // Cover details. Separate from the audit form because the operator normally
  // fills these in with the declarations page open, long after the audit was
  // created -- and because every audit that already exists needs a way to get
  // them without being recreated.
  if (screen === 'cover-details') {
    if (!curAudit) { setScreen('dashboard'); return null; }
    const saveCover = async () => {
      setCoverSaving(true);
      const payload = { named_insured: namedInsured.trim() || null, mailing_address: mailingAddress.trim() || null };
      const r = await adminApi(adminPw, { action: 'update', table: 'audits', filter: { id: curAudit.id }, payload });
      setCoverSaving(false);
      if (!r.ok) { setError('Could not save the cover details.'); return; }
      setCurAudit(prev => ({ ...prev, ...payload }));
      await logActivity(adminPw, curAudit.id, 'COVER_DETAILS_UPDATED', {}, valName || 'operator');
      await loadAudits();
      setScreen('report');
    };
    return (
      <div style={S.app}>
        <Hdr right={<button style={S.btnOut} onClick={() => setScreen('report')}>← Back to report</button>} />
        <div style={S.content}>
          <div style={{ fontSize: 24, fontWeight: 700, marginBottom: 8 }}>Cover Details</div>
          <div style={{ fontSize: 14, color: MID_GRAY, marginBottom: 20, lineHeight: 1.6 }}>
            These appear in the "Prepared for" block on the client document's cover. Leave them blank and the block does not render.
          </div>
          <div style={S.card}>
            <div style={{ marginBottom: 16 }}>
              <label style={S.label}>Named Insured</label>
              <input style={S.input} value={namedInsured} onChange={e => setNamedInsured(e.target.value)} placeholder="As it should appear to the client" />
              <div style={{ fontSize: 12, color: MID_GRAY, marginTop: 6, lineHeight: 1.5 }}>
                What the client should be addressed as, which is not always what the declarations page says. A dec page reading
                "Thomas F. Corbett Associates, LLC DBA Shamrock Materials LLC" is correct on paper and wrong on a cover.
              </div>
            </div>
            <div style={{ marginBottom: 20 }}>
              <label style={S.label}>Mailing Address</label>
              <textarea style={{ ...S.input, minHeight: 84, resize: 'vertical', fontFamily: 'inherit' }} value={mailingAddress} onChange={e => setMailingAddress(e.target.value)} placeholder={'Street\nCity, ST ZIP'} />
              <div style={{ fontSize: 12, color: MID_GRAY, marginTop: 6 }}>Line breaks are preserved as typed.</div>
            </div>
            <button style={S.actionBtn(coverSaving, { primary: true })} disabled={coverSaving} onClick={saveCover}>
              {coverSaving ? 'Saving…' : 'Save cover details'}
            </button>
          </div>
        </div>
      </div>
    );
  }

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
                  <span style={{ fontSize: 13, color: MID_GRAY }}>by {log.performed_by}</span>
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
            const typeInfo2 = POLICY_TYPES.find(p => p.id === pol.policy_type);
            // Three outcomes, three messages. A failed run is NOT a verdict
            // about the document and must never be reported as one.
            const st2 = pol.ai_status;
            const failed2 = isFailed(st2) || isPending(st2);
            const isValid = isVerdict(st2);
            const outcomeText = failed2
              ? (isPending(st2) ? 'Not analysed yet' : 'Analysis failed — ' + failureReason(pol))
              : isValid
                ? (st2 === 'EXCLUDED' ? 'Valid — AI Exclusion Found' : st2 === 'SILENT' ? 'Valid — Silent on AI' : st2 === 'PARTIAL' ? 'Valid — Partial Coverage' : st2 === 'AFFIRMATIVE' ? 'Valid — AI Covered' : 'Valid Policy')
                : 'Read — not an insurance policy';
            return (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px', borderRadius: 8, marginBottom: 8, background: isValid ? '#F0FDF4' : failed2 ? '#FFFBEB' : '#FEF2F2', border: '1px solid ' + (isValid ? GREEN : failed2 ? ORANGE : RED) }}>
                <span style={{ fontSize: 20 }}>{isValid ? '✅' : failed2 ? '⚠️' : '❌'}</span>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 14, fontWeight: 700, color: NAVY }}>{typeInfo2?.label || pol.policy_type}</div>
                  <div style={{ fontSize: 12, color: MID_GRAY }}>{pol.file_name}</div>
                </div>
                <div style={{ fontSize: 13, fontWeight: 600, color: isValid ? GREEN : failed2 ? ORANGE : RED, textAlign: 'right', maxWidth: 320 }}>
                  {outcomeText}
                  {failed2 && !isPending(st2) && <div style={{ fontSize: 11, fontWeight: 400, color: MID_GRAY, marginTop: 2 }}>Nothing was read from this document.</div>}
                  {/* A failed row is actionable in place: same audit, same row,
                      so the audit does not collect one fossil per attempt.
                      Re-run appears only when the document was actually stored
                      -- admin uploads stream straight to the API and keep
                      nothing, so for those rows the file is gone and Replace is
                      the only honest option. */}
                  {failed2 && (
                    <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end', marginTop: 6, flexWrap: 'wrap' }}>
                      <button
                        style={S.actionBtn(!!rowBusy, { small: true, primary: true })}
                        disabled={!!rowBusy}
                        onClick={() => { replaceTarget.current = pol; setRowErr(''); replaceRef.current?.click(); }}>
                        {rowBusy === pol.id ? 'Working…' : '↑ Replace file'}
                      </button>
                      {pol.storage_path ? (
                        <button
                          style={S.actionBtn(!!rowBusy, { small: true })}
                          disabled={!!rowBusy}
                          onClick={() => rerunPolicy(pol)}>
                          ↻ Re-run
                        </button>
                      ) : (
                        <span style={{ fontSize: 10, fontWeight: 400, color: MID_GRAY, alignSelf: 'center' }} title="Only documents uploaded through a client portal link are stored.">
                          not stored — cannot re-run
                        </span>
                      )}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
          {/* Hidden inputs driving Replace file and Add policy. */}
          <input ref={replaceRef} type="file" accept=".pdf,application/pdf" style={{ display: 'none' }}
            onChange={async e => { const f = e.target.files?.[0]; e.target.value = ''; const t = replaceTarget.current; replaceTarget.current = null; if (f && t) await replaceFile(t, f); }} />
          <input ref={addRef} type="file" accept=".pdf,application/pdf" style={{ display: 'none' }}
            onChange={async e => { const f = e.target.files?.[0]; e.target.value = ''; if (f) await addPolicy(f, addType); }} />

          {rowErr && <div style={{ marginTop: 12, padding: 12, background: '#FEF2F2', borderRadius: 8, color: RED, fontSize: 12, lineHeight: 1.6 }}>{rowErr}</div>}

          {/* A late document joins the existing audit rather than starting a
              second one for the same client. */}
          <div style={{ marginTop: 12, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <span style={{ fontSize: 12, color: MID_GRAY }}>Document arrived late?</span>
            <select value={addType} onChange={e => setAddType(e.target.value)} disabled={!!rowBusy}
              style={{ ...S.input, width: 'auto', padding: '6px 10px', fontSize: 12 }}>
              {POLICY_TYPES.map(pt => <option key={pt.id} value={pt.id}>{pt.icon} {pt.label}</option>)}
            </select>
            <button style={S.actionBtn(!!rowBusy, { small: true })}
              disabled={!!rowBusy} onClick={() => { setRowErr(''); addRef.current?.click(); }}>
              {rowBusy === 'new' ? 'Analyzing…' : '+ Add policy'}
            </button>
            <span style={{ fontSize: 11, color: MID_GRAY }}>PDF, up to {mb(MAX_PDF_BYTES)} MB</span>
          </div>

          {/* Program-level report. Deliberately placed after the per-policy
              list: it is the only view entitled to say a line is absent, and
              only because every policy above was read. */}
          <div style={{ marginTop: 16, padding: 16, background: LIGHT_BG, borderRadius: 8, border: '1px solid ' + LIGHT_GRAY }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
              <div style={{ flex: 1, minWidth: 220 }}>
                <div style={{ fontSize: 14, fontWeight: 700, color: NAVY }}>Program Report</div>
                <div style={{ fontSize: 12, color: MID_GRAY, lineHeight: 1.5 }}>
                  Reads all {curPolicies.length} polic{curPolicies.length === 1 ? 'y' : 'ies'} together. Only this pass can say a coverage line is genuinely absent — a single policy can only say it was not evidenced in that document.
                </div>
              </div>
              <button
                style={S.actionBtn(progLoading || unanalysedPolicies().length > 0 || !curPolicies.length, { primary: true })}
                disabled={progLoading || unanalysedPolicies().length > 0 || !curPolicies.length}
                onClick={generateProgramReport}>
                {progLoading ? 'Generating…' : progReport ? '↻ Regenerate' : 'Generate program report'}
              </button>
            </div>
            {unanalysedPolicies().length > 0 && (
              <div style={{ fontSize: 12, color: ORANGE, marginTop: 8 }}>
                ⚠️ Unavailable while {unanalysedPolicies().map(p => p.file_name).join(', ')} {unanalysedPolicies().length === 1 ? 'is' : 'are'} unread. A gap report built over a document nobody read would name coverage the client may actually hold.
              </div>
            )}
            {progErr && <div style={{ fontSize: 12, color: RED, marginTop: 8, lineHeight: 1.5 }}>{progErr}</div>}
            {progReport && (
              <div style={{ marginTop: 14, paddingTop: 14, borderTop: '1px solid ' + LIGHT_GRAY }}>

                {/* Policy table. Every column but limits/deductibles is computed
                    server-side from the extracted data. */}
                {progReport.policy_table?.length > 0 && (
                  <div style={{ marginBottom: 16 }}>
                    <div style={S.sec}>Policy Table</div>
                    {/* Fixed layout with explicit widths, so the table fits the
                        screen instead of scrolling sideways. Anything that can
                        overrun is truncated with the full value on hover; the
                        long forms live in Level 2. */}
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, tableLayout: 'fixed' }}>
                      <colgroup>
                        <col style={{ width: '20%' }} /><col style={{ width: '11%' }} /><col style={{ width: '13%' }} />
                        <col style={{ width: '19%' }} /><col style={{ width: '11%' }} /><col style={{ width: '11%' }} />
                        <col style={{ width: '8%' }} /><col style={{ width: '7%' }} />
                      </colgroup>
                      <thead>
                        <tr style={{ textAlign: 'left', color: MID_GRAY, borderBottom: '1px solid ' + LIGHT_GRAY }}>
                          {['Line', 'Carrier', 'Policy No.', 'Key Limits', 'Deductible', 'Term', 'Verdict', 'Premium'].map(h => (
                            <th key={h} style={{ padding: '6px 6px', fontWeight: 700, whiteSpace: 'nowrap', fontSize: 11 }}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {progReport.policy_table.map((row, i) => {
                          const ts = row.term_status || {};
                          const dot = ts.state === 'expired' ? RED : ts.state === 'expiring' ? ORANGE : ts.state === 'in_force' ? GREEN : MID_GRAY;
                          const clip = { padding: '7px 6px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' };
                          const none = (t = '—') => <span style={{ color: MID_GRAY }}>{t}</span>;
                          return (
                            <tr key={i} style={{ borderBottom: '1px solid ' + LIGHT_GRAY }}>
                              <td style={{ ...clip, fontWeight: 700, color: NAVY }} title={row.file_name}>{row.line}</td>
                              <td style={clip} title={row.carrier || ''}>{row.carrier_short || row.carrier || none('—')}</td>
                              <td style={clip} title={row.policy_number || ''}>{row.policy_number || none()}</td>
                              <td style={clip} title={row.key_limits || ''}>{row.key_limits || none()}</td>
                              <td style={clip} title={row.deductibles || ''}>{row.deductibles || none()}</td>
                              <td style={{ ...clip, fontWeight: 600 }} title={ts.label || ''}>
                                <span style={{ color: dot, marginRight: 5 }}>●</span>{row.expiration_date || none()}
                              </td>
                              <td style={clip} title={row.ai_verdict?.label || ''}>{row.ai_verdict?.short || row.ai_verdict?.status}</td>
                              <td style={{ ...clip, textAlign: 'right' }} title={row.premium_as_shown || ''}>{row.premium_total || none()}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                    <div style={{ fontSize: 10, color: MID_GRAY, marginTop: 6 }}>
                      <span style={{ color: GREEN }}>●</span> in force &nbsp;
                      <span style={{ color: ORANGE }}>●</span> renews within 90 days &nbsp;
                      <span style={{ color: RED }}>●</span> expired &nbsp;· hover any cell for the full value
                    </div>
                  </div>
                )}

                {/* Limit adequacy: what each layer carries, and whether the
                    primaries satisfy what sits above them. Its own section
                    because it is the question the report gets opened for. */}
                {progReport.limit_adequacy && (
                  <div style={{ marginBottom: 16 }}>
                    <div style={S.sec}>Limit Adequacy</div>
                    {progReport.limit_adequacy.summary && (
                      <div style={{ padding: 12, background: '#FFFBEB', border: '1px solid ' + ORANGE, borderRadius: 6, fontSize: 12, color: '#333', lineHeight: 1.6, marginBottom: 10 }}>
                        {progReport.limit_adequacy.summary}
                      </div>
                    )}
                    {progReport.limit_adequacy.layers?.map((l, i) => (
                      <div key={i} style={{ marginBottom: 10, padding: 12, background: WHITE, border: '1px solid ' + LIGHT_GRAY, borderRadius: 6 }}>
                        <div style={{ fontSize: 13, fontWeight: 700, color: NAVY }}>
                          {l.top_layer_line} sits above{l.policy_number ? ` · ${l.policy_number}` : ''}
                        </div>
                        {!l.requirements_extracted && l.note && (
                          <div style={{ fontSize: 12, color: ORANGE, marginTop: 4, lineHeight: 1.5 }}>{l.note}</div>
                        )}
                        {l.rows?.map((r, j) => {
                          const tone = r.state === 'below_requirement' ? RED : r.state === 'meets_or_exceeds' ? GREEN : MID_GRAY;
                          const label = r.state === 'below_requirement' ? 'BELOW' : r.state === 'meets_or_exceeds' ? 'MEETS' : 'UNKNOWN';
                          return (
                            <div key={j} style={{ display: 'flex', gap: 10, alignItems: 'center', marginTop: 6, fontSize: 12 }}>
                              <span style={{ ...S.tag, background: tone === GREEN ? '#F0FDF4' : tone === RED ? '#FEF2F2' : '#F3F4F6', color: tone, minWidth: 74, textAlign: 'center' }}>{label}</span>
                              <span style={{ flex: 1 }}>{r.line}</span>
                              <span style={{ color: MID_GRAY }}>
                                required {r.required ? '$' + r.required.toLocaleString() : '—'} · carried {r.actual ? '$' + r.actual.toLocaleString() : '—'}
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    ))}
                    {progReport.limit_adequacy.carried?.length > 0 && (
                      <div style={{ padding: 12, background: LIGHT_BG, borderRadius: 6 }}>
                        <div style={{ fontSize: 10, fontWeight: 700, color: MID_GRAY, letterSpacing: 1, textTransform: 'uppercase', marginBottom: 6 }}>Limits Carried</div>
                        {progReport.limit_adequacy.carried.map((c, i) => (
                          <div key={i} style={{ display: 'flex', gap: 10, fontSize: 12, marginBottom: 4, lineHeight: 1.5 }}>
                            <span style={{ minWidth: 150, fontWeight: c.is_top_layer ? 700 : 400, color: c.is_top_layer ? NAVY : '#333' }}>
                              {c.is_top_layer ? '▲ ' : ''}{c.line}
                            </span>
                            <span>{c.key_limits || <span style={{ color: MID_GRAY }}>not extracted</span>}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {/* Program findings: computed first, then the model's synthesis.
                    The order is the point -- the arithmetic is not an opinion. */}
                {(progReport.program_findings?.computed?.length > 0 || progReport.program_findings?.synthesis?.length > 0) && (
                  <div style={{ marginBottom: 16 }}>
                    <div style={S.sec}>Program Findings</div>
                    {progReport.program_findings.computed?.map((f, i) => (
                      <div key={'c' + i} style={{ padding: 12, background: WHITE, borderRadius: 6, border: '1px solid ' + LIGHT_GRAY, borderLeft: '3px solid ' + NAVY, marginBottom: 6 }}>
                        <div style={{ display: 'flex', gap: 8, marginBottom: 4, flexWrap: 'wrap' }}>
                          <span style={{ ...S.tag, background: '#EEF2FF', color: NAVY }}>COMPUTED</span>
                          <span style={{ ...S.tag, background: LIGHT_GOLD, color: NAVY }}>{f.type}</span>
                          <span style={{ ...S.tag, background: f.severity === 'HIGH' ? '#FEE2E2' : f.severity === 'MODERATE' ? '#FEF3C7' : '#F3F4F6', color: f.severity === 'HIGH' ? RED : f.severity === 'MODERATE' ? ORANGE : MID_GRAY }}>{f.severity}</span>
                        </div>
                        <div style={{ fontSize: 13, color: NAVY, lineHeight: 1.5 }}>{f.finding}</div>
                        {f.evidence && <div style={{ fontSize: 12, color: MID_GRAY, marginTop: 4, lineHeight: 1.5 }}>{f.evidence}</div>}
                      </div>
                    ))}
                    {progReport.program_findings.synthesis?.map((f, i) => (
                      <div key={'s' + i} style={{ padding: 12, background: WHITE, borderRadius: 6, border: '1px solid ' + LIGHT_GRAY, marginBottom: 6 }}>
                        <div style={{ display: 'flex', gap: 8, marginBottom: 4, flexWrap: 'wrap' }}>
                          <span style={{ ...S.tag, background: f.severity === 'HIGH' ? '#FEE2E2' : f.severity === 'MODERATE' ? '#FEF3C7' : '#F3F4F6', color: f.severity === 'HIGH' ? RED : f.severity === 'MODERATE' ? ORANGE : MID_GRAY }}>{f.severity || 'LOW'}</span>
                        </div>
                        <div style={{ fontSize: 13, color: NAVY, lineHeight: 1.5 }}>{f.finding}</div>
                        {f.evidence && <div style={{ fontSize: 12, color: MID_GRAY, marginTop: 4, lineHeight: 1.5 }}>{f.evidence}</div>}
                      </div>
                    ))}
                  </div>
                )}

                {/* Coverage position: the four states. */}
                {progReport.coverage_position?.length > 0 && (
                  <div style={{ marginBottom: 16 }}>
                    <div style={S.sec}>Coverage Position</div>
                    {progReport.coverage_position.map((l, i) => {
                      const tone = l.state === 'present' ? GREEN : l.state === 'absent' ? RED : l.state === 'unread' ? ORANGE : MID_GRAY;
                      const label = l.state === 'present' ? 'PRESENT' : l.state === 'absent' ? 'ABSENT' : l.state === 'unread' ? 'UNREAD' : 'NOT SUPPLIED';
                      return (
                        <div key={i} style={{ display: 'flex', gap: 10, marginBottom: 6, fontSize: 13, lineHeight: 1.5, alignItems: 'flex-start' }}>
                          <span style={{ ...S.tag, background: tone === GREEN ? '#F0FDF4' : tone === RED ? '#FEF2F2' : tone === ORANGE ? '#FFFBEB' : '#F3F4F6', color: tone, minWidth: 112, textAlign: 'center', flexShrink: 0 }}>{label}</span>
                          <span><strong>{l.line}</strong>
                            {l.policy && <span style={{ color: MID_GRAY }}> — {l.policy}</span>}
                            {l.note && <span style={{ color: MID_GRAY }}> — {l.note}</span>}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                )}

                {/* Internal. Level 3 strips this entirely. */}
                {progReport.agent_notes && (
                  <div style={{ padding: 14, background: '#F9FAFB', borderRadius: 8, border: '1px dashed ' + MID_GRAY }}>
                    <div style={{ fontSize: 11, fontWeight: 700, color: MID_GRAY, letterSpacing: 1, textTransform: 'uppercase', marginBottom: 8 }}>🔒 Agent Notes — Internal Only, Never Shown To The Client</div>
                    {progReport.agent_notes.lead_hook && <div style={{ fontSize: 13, color: NAVY, fontWeight: 600, marginBottom: 6, lineHeight: 1.5 }}>{progReport.agent_notes.lead_hook}</div>}
                    {progReport.agent_notes.primary_opportunity && <div style={{ fontSize: 13, color: '#333', marginBottom: 8, lineHeight: 1.5 }}>{progReport.agent_notes.primary_opportunity}</div>}
                    {progReport.agent_notes.talking_points?.length > 0 && progReport.agent_notes.talking_points.map((t, i) => (
                      <div key={i} style={{ display: 'flex', gap: 8, marginBottom: 3, fontSize: 12, lineHeight: 1.5 }}><span style={{ color: GOLD }}>•</span><span>{t}</span></div>
                    ))}
                    {progReport.agent_notes.urgency?.length > 0 && progReport.agent_notes.urgency.map((u, i) => (
                      <div key={'u' + i} style={{ fontSize: 12, color: ORANGE, marginTop: 4, lineHeight: 1.5 }}>⏱ {u}</div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
          {/* The "Missing Policy Types" block was removed here. It listed every
              POLICY_TYPES entry not uploaded to this audit and called them
              missing -- so a one-policy audit announced that Commercial Auto
              and Umbrella/Excess were absent, when the client may well hold
              both and simply not have sent them. It knew nothing about the
              client; it only knew what was in this audit. The per-policy
              "Not Evidenced In This Document" section and, later, the
              program-level report make that claim only where it can be
              supported. (It also hardcoded "All 6 policy types" against a list
              of eleven.) */}
        </div>
        {/* Five collapsed cards with findings inside them is a lot of clicking,
            and Finalize is gated on every finding being reviewed. */}
        {curPolicies.length > 1 && (
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginBottom: 8 }} className="no-print">
            <button style={S.actionBtn(false, { small: true })}
              onClick={() => setExpandedPolicies(new Set(curPolicies.map(p => p.id)))}>Expand all</button>
            <button style={S.actionBtn(expandedPolicies.size === 0, { small: true })}
              disabled={expandedPolicies.size === 0}
              onClick={() => setExpandedPolicies(new Set())}>Collapse all</button>
          </div>
        )}
        {curPolicies.map((pol, pi) => {
          const ti = POLICY_TYPES.find(p => p.id === pol.policy_type);
          const out = isDraft ? pol.ai_raw_output : (pol.validated_output || pol.ai_raw_output);
          if (!out) return null;
          const findings = out.findings || [], gaps = out.coverage_gaps || [], recs = out.recommendations || [];
          // Level 2: collapsed by default. The header has to carry enough for
          // the operator to know what is inside without opening it -- above all
          // how many findings still need review, since Finalize is gated on that
          // and an unopened card would otherwise hide the outstanding work.
          const open = expandedPolicies.has(pol.id);
          const reviewed = findings.filter((_, fi) => fActions[pi + '-' + fi]).length;
          const progRow = progReport?.policy_table?.find(r => r.file_name === pol.file_name);

          return (<div key={pol.id} style={S.card}>
            <div
              onClick={() => setExpandedPolicies(prev => { const n = new Set(prev); n.has(pol.id) ? n.delete(pol.id) : n.add(pol.id); return n; })}
              style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: open ? 20 : 0, flexWrap: 'wrap', gap: 8, cursor: 'pointer' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <span style={{ fontSize: 14, color: MID_GRAY, width: 12 }}>{open ? '▾' : '▸'}</span>
                <span style={{ fontSize: 24 }}>{ti?.icon || '📄'}</span>
                <div><div style={{ fontSize: 18, fontWeight: 700 }}>{ti?.label || pol.policy_type}</div>
                <div style={{ fontSize: 12, color: MID_GRAY }}>{pol.file_name}{pol.carrier ? ' • ' + (progRow?.carrier_short || pol.carrier) : ''}</div></div>
              </div>
              {!open && findings.length > 0 && (
                <div style={{ fontSize: 12, color: reviewed === findings.length ? GREEN : ORANGE, fontWeight: 600 }}>
                  {findings.length} finding{findings.length === 1 ? '' : 's'} · {reviewed}/{findings.length} reviewed
                </div>
              )}
              {/* This badge had a case for ERROR but none for FAILED, so once
                  migration 03 renamed the status every failed policy fell
                  through to "UNKNOWN" -- the verdict meaning "read, and not an
                  insurance policy". The status list at the top of the report was
                  fixed; this badge deeper in the body was missed, so the same
                  document was described two different ways on one screen. It now
                  uses the shared helpers, so it cannot drift again. */}
              <div style={S.badge(isFailed(pol.ai_status) ? 'MODERATE' : (pol.risk_level || pol.ai_status))}>
                {isFailed(pol.ai_status) ? '⚠️ ANALYSIS FAILED'
                  : isPending(pol.ai_status) ? '⏳ NOT ANALYSED'
                  : pol.ai_status === 'EXCLUDED' ? '⛔ AI EXCLUDED'
                  : pol.ai_status === 'SILENT' ? '⚠️ SILENT'
                  : pol.ai_status === 'PARTIAL' ? '🔶 PARTIAL'
                  : pol.ai_status === 'AFFIRMATIVE' ? '✅ COVERED'
                  : '❓ NOT A POLICY'}
              </div>
            </div>

            {!open ? null : <>

            {/* The long forms the table deliberately shortened. The table shows
                "Hanover" and "$4,976"; this is where the full legal entity and
                the premium line exactly as printed belong. */}
            <div style={{ padding: 14, background: LIGHT_BG, borderRadius: 8, marginBottom: 16, fontSize: 12, lineHeight: 1.7 }}>
              {pol.carrier && <div><span style={{ color: MID_GRAY }}>Carrier: </span><strong style={{ color: NAVY }}>{pol.carrier}</strong></div>}
              {pol.policy_number && <div><span style={{ color: MID_GRAY }}>Policy number: </span>{pol.policy_number}</div>}
              {(pol.effective_date || pol.expiration_date) && (
                <div><span style={{ color: MID_GRAY }}>Term: </span>{pol.effective_date || '?'} to {pol.expiration_date || '?'}
                  {progRow?.term_status?.label && <span style={{ color: MID_GRAY }}> — {progRow.term_status.label}</span>}</div>
              )}
              {progRow?.key_limits_all?.length > 0 && (
                <div><span style={{ color: MID_GRAY }}>Limits: </span>{progRow.key_limits_all.join(' · ')}</div>
              )}
              {progRow?.deductibles && <div><span style={{ color: MID_GRAY }}>Deductible: </span>{progRow.deductibles}</div>}
              {out.agent_opportunities?.premium_as_shown && (
                <div><span style={{ color: MID_GRAY }}>Premium, as printed on the document: </span>{out.agent_opportunities.premium_as_shown}</div>
              )}
              {pol.ai_status && <div><span style={{ color: MID_GRAY }}>Verdict: </span>{progRow?.ai_verdict?.label || pol.ai_status}</div>}
            </div>

            {/* A failed policy has no findings, gaps or recommendations to show,
                so the card below would render as a policy with nothing wrong
                with it. Say what actually happened instead. */}
            {isFailed(pol.ai_status) && (
              <div style={{ padding: 16, background: '#FFFBEB', borderRadius: 8, border: '1px solid ' + ORANGE, marginBottom: 16 }}>
                <div style={{ fontSize: 14, fontWeight: 700, color: ORANGE, marginBottom: 6 }}>This document was not analysed</div>
                <div style={{ fontSize: 13, color: '#333', lineHeight: 1.6 }}>{failureReason(pol)}</div>
                <div style={{ fontSize: 12, color: MID_GRAY, marginTop: 8, lineHeight: 1.6 }}>
                  Nothing below is derived from this document, and its absence from the findings is not evidence that it contains none. Re-run it before finalizing, or remove it from the audit.
                </div>
              </div>
            )}

            {out.summary && <div style={{ padding: 16, background: LIGHT_GOLD, borderRadius: 8, fontSize: 14, lineHeight: 1.7, marginBottom: 16, borderLeft: '3px solid ' + GOLD }}>{out.summary}</div>}

            {findings.length > 0 && <div style={{ marginBottom: 16 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12, flexWrap: 'wrap' }}>
                <div style={S.sec}>Findings {isDraft && <span style={{ fontWeight: 400, fontSize: 11, color: MID_GRAY }}>— Review each</span>}</div>
                {isDraft && unreviewedIn(pi) > 0 && (
                  <button className="no-print" style={S.actionBtn(false, { small: true })} onClick={() => confirmAll(pi)}>
                    ✓ Confirm remaining {unreviewedIn(pi)}
                  </button>
                )}
              </div>
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

            {out.agent_opportunities && (
              <div className="no-print" style={{
                marginTop: 20, padding: 16, background: '#FEF2F2', border: '2px solid ' + RED, borderRadius: 10,
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12, paddingBottom: 10, borderBottom: '1px solid #FECACA' }}>
                  <span style={{ fontSize: 16 }}>🔒</span>
                  <span style={{ fontSize: 11, fontWeight: 800, color: RED, letterSpacing: 1.2, textTransform: 'uppercase' }}>Agent Notes — Internal — Not Shared with Client</span>
                </div>
                {out.agent_opportunities.lead_hook && (
                  <div style={{ marginBottom: 12, padding: 12, background: WHITE, borderRadius: 6, borderLeft: '3px solid ' + RED }}>
                    <div style={{ fontSize: 10, fontWeight: 700, color: MID_GRAY, letterSpacing: 1, textTransform: 'uppercase', marginBottom: 4 }}>Lead Hook</div>
                    <div style={{ fontSize: 14, fontWeight: 600, color: NAVY, fontStyle: 'italic' }}>"{out.agent_opportunities.lead_hook}"</div>
                  </div>
                )}
                {out.agent_opportunities.primary_opportunity && (
                  <div style={{ marginBottom: 10 }}>
                    <div style={{ fontSize: 10, fontWeight: 700, color: MID_GRAY, letterSpacing: 1, textTransform: 'uppercase', marginBottom: 4 }}>Primary Opportunity</div>
                    <div style={{ fontSize: 13, color: NAVY, lineHeight: 1.5 }}>{out.agent_opportunities.primary_opportunity}</div>
                  </div>
                )}
                {/* "Estimated Premium Impact" was removed. It rendered invented
                    savings ("10-20% ($5,000-$10,000)") in confident green, from
                    a model that cannot see the client's quotes, loss history or
                    rating basis. Only the premium printed on the document is
                    shown now. estimated_premium_impact is deliberately NOT read
                    from older rows -- those figures were invented too. */}
                {out.agent_opportunities.premium_as_shown && (
                  <div style={{ marginBottom: 10 }}>
                    <div style={{ fontSize: 10, fontWeight: 700, color: MID_GRAY, letterSpacing: 1, textTransform: 'uppercase', marginBottom: 4 }}>Premium As Shown On Document</div>
                    <div style={{ fontSize: 13, color: NAVY, fontWeight: 600 }}>{out.agent_opportunities.premium_as_shown}</div>
                  </div>
                )}
                {out.agent_opportunities.talking_points && out.agent_opportunities.talking_points.length > 0 && (
                  <div style={{ marginBottom: 10 }}>
                    <div style={{ fontSize: 10, fontWeight: 700, color: MID_GRAY, letterSpacing: 1, textTransform: 'uppercase', marginBottom: 4 }}>Talking Points</div>
                    {out.agent_opportunities.talking_points.map((tp, i) => (
                      <div key={i} style={{ display: 'flex', gap: 8, marginBottom: 4, fontSize: 13, lineHeight: 1.5 }}><span style={{ color: RED }}>•</span><span>{tp}</span></div>
                    ))}
                  </div>
                )}
                {(() => {
                  // Rows written before the rename carry new_lines_to_write; new
                  // rows carry lines_not_evidenced_here. Read both so existing
                  // audits keep rendering, and label it as what it actually is:
                  // absent from THIS document, not absent from the client's program.
                  const notEvidenced = out.agent_opportunities.lines_not_evidenced_here || out.agent_opportunities.new_lines_to_write;
                  if (!notEvidenced || !notEvidenced.length) return null;
                  return (
                    <div style={{ marginBottom: 10 }}>
                      <div style={{ fontSize: 10, fontWeight: 700, color: MID_GRAY, letterSpacing: 1, textTransform: 'uppercase', marginBottom: 4 }}>Not Evidenced In This Document — Confirm With Client</div>
                      {notEvidenced.map((nl, i) => (
                        <div key={i} style={{ display: 'flex', gap: 8, marginBottom: 4, fontSize: 13, lineHeight: 1.5 }}><span style={{ color: MID_GRAY }}>?</span><span>{nl}</span></div>
                      ))}
                      <div style={{ fontSize: 11, color: MID_GRAY, marginTop: 4, fontStyle: 'italic' }}>This policy alone cannot show whether the client holds these elsewhere.</div>
                    </div>
                  );
                })()}
                {out.agent_opportunities.urgency_factors && out.agent_opportunities.urgency_factors.length > 0 && (
                  <div>
                    <div style={{ fontSize: 10, fontWeight: 700, color: MID_GRAY, letterSpacing: 1, textTransform: 'uppercase', marginBottom: 4 }}>Urgency</div>
                    {out.agent_opportunities.urgency_factors.map((uf, i) => (
                      <div key={i} style={{ display: 'flex', gap: 8, marginBottom: 4, fontSize: 13, lineHeight: 1.5 }}><span style={{ color: ORANGE }}>⏱</span><span>{uf}</span></div>
                    ))}
                  </div>
                )}
              </div>
            )}
            </>}
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
                <button style={{ ...S.btnGreen, width: '100%', opacity: (!valName || !allReviewed() || unanalysedPolicies().length > 0) ? 0.4 : 1 }} onClick={validateAudit} disabled={!valName || !allReviewed() || unanalysedPolicies().length > 0}>
                  ✓ Validate & Finalize Report
                </button>
              </div>
            </div>
            {unanalysedPolicies().length > 0 && (
              <div style={{ fontSize: 12, color: RED, marginBottom: 6 }}>
                ⛔ Cannot finalize: {unanalysedPolicies().map(p => p.file_name).join(', ')} did not analyse successfully.
                A finalized report must not draw findings, gaps or an overall risk rating from a document that was never read. Re-run or remove it first.
              </div>
            )}
            {!allReviewed() && (
              <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
                <div style={{ fontSize: 12, color: ORANGE }}>⚠️ Review all findings above before validating.</div>
                {unreviewedIn() > 0 && (
                  <button style={S.actionBtn(false, { small: true })} onClick={() => confirmAll()}>
                    ✓ Confirm all remaining {unreviewedIn()} across this audit
                  </button>
                )}
              </div>
            )}
          </div>
        )}

        <div style={{ ...S.card, background: NAVY, color: WHITE, textAlign: 'center', padding: 36 }}>
          {/* Neutral by design. This block previously opened with "Ready to
              Close These Gaps?" and named specific markets, which reads as a
              solicitation on a document whose whole purpose is an impartial
              coverage review. */}
          <div style={{ fontSize: 15, color: 'rgba(255,255,255,0.85)', maxWidth: 560, margin: '0 auto 20px', lineHeight: 1.7 }}>
            Questions about this report? Contact The AI Insurance Group — sal@theaiinsurancegroup.com · 917-981-0245.
          </div>
          <div style={{ display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap' }} className="no-print">
            {/* The client document. Only after Validate & Finalize, and only
                when a Level 1 report exists to render from -- it makes no call
                of its own, so without that row there is nothing to print. */}
            {!isDraft && progReport && (
              <button style={S.btnOut} onClick={() => {
                setNamedInsured(a.named_insured || '');
                setMailingAddress(a.mailing_address || '');
                setScreen('cover-details');
              }}>Cover details</button>
            )}
            {!isDraft && (
              progReport
                ? <button style={S.btn} onClick={() => { logActivity(adminPw, a.id, 'CLIENT_DOCUMENT_OPENED', {}, valName || 'operator'); setScreen('client-doc'); }}>📄 Client Document</button>
                : <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.7)', alignSelf: 'center' }}>Generate the program report to produce the client document.</span>
            )}
            {/* Collapsed cards are not rendered at all, so printing without
                expanding them first would silently produce a report missing
                every policy's detail. Expand, let React paint, then print. */}
            {!isDraft && <button style={S.btn} onClick={() => {
              logActivity(adminPw, a.id, 'REPORT_EXPORTED', {}, valName || 'operator');
              setExpandedPolicies(new Set(curPolicies.map(p => p.id)));
              setTimeout(() => window.print(), 150);
            }}>Print / Save as PDF</button>}
            <button style={S.btnOut} onClick={async () => { await loadLog(a.id); setScreen('activity-log'); }}>Activity Log</button>
          </div>
        </div>

        <div style={{ textAlign: 'center', marginTop: 16, fontSize: 11, color: MID_GRAY, lineHeight: 1.6 }}>
          This analysis was generated using AI-assisted document review{!isDraft && a.validated_by ? ' and validated by ' + a.validated_by : ''}.
          It is not a coverage determination. Final coverage interpretations should be confirmed with the issuing carrier.
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
          {/* Both appear on the client document's cover. Optional, and editable
              later from the report screen -- the operator usually has the
              declarations page open there, not here. */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginTop: 16 }}>
            <div>
              <label style={S.label}>Named Insured</label>
              <input style={S.input} value={namedInsured} onChange={e => setNamedInsured(e.target.value)} placeholder="As it should appear to the client" />
            </div>
            <div>
              <label style={S.label}>Mailing Address</label>
              <textarea style={{ ...S.input, minHeight: 62, resize: 'vertical', fontFamily: 'inherit' }} value={mailingAddress} onChange={e => setMailingAddress(e.target.value)} placeholder={'Street\nCity, ST ZIP'} />
            </div>
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
