// Vercel serverless function: the program-level report.
//
// A per-policy analysis reads ONE document. It cannot tell "the client does not
// carry this" from "I was not shown it", so it is forbidden from claiming
// either (see the SCOPE section of ANALYSIS_PROMPT). This endpoint is the only
// vantage point from which an absence can honestly be asserted: it reads every
// policy in one audit together.
//
// Two rules make that honesty structural rather than a matter of prompt wording:
//
//   1. The guard. If ANY policy in the audit did not analyse successfully, the
//      report is refused outright and the unread documents are named. A gap
//      report built over a document nobody read is the exact failure this
//      feature exists to prevent -- it would name a coverage the client may
//      hold. The check runs HERE, on the server, not only in the UI.
//
//   2. The cross-checks are computed in code, from the stored per-policy JSON,
//      and handed to the model as facts. The model reasons about them; it does
//      not decide what to compare, and it is never asked to recall a limit.
//
// Deliberately absent: premium figures beyond what a document printed, and any
// saving, estimate or projection. Same reason as in the per-policy prompt.
//
// Required Vercel environment variables (all already set):
//   ANTHROPIC_API_KEY, AUDIT_ADMIN_PASSWORD, SUPABASE_SERVICE_ROLE_KEY,
//   VITE_SUPABASE_URL

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || "https://dtgsegabaivtgyccrcxi.supabase.co";
const MODEL = "claude-opus-5";
const MAX_TOKENS = 16000;
const EFFORT = "low";

// Mirrors src/App.jsx. A run that did not finish says nothing about the
// document and must never be read as evidence of absence.
const VERDICT_STATUSES = new Set(["EXCLUDED", "SILENT", "PARTIAL", "AFFIRMATIVE"]);
const isAnalysed = (s) => VERDICT_STATUSES.has(s) || s === "UNKNOWN";

function requestHost(req) {
  const fwd = req.headers["x-forwarded-host"];
  const host = (Array.isArray(fwd) ? fwd[0] : fwd) || req.headers.host || "";
  return host.split(",")[0].trim().toLowerCase();
}

function isAllowedOrigin(origin, req) {
  if (!origin) return false;
  let originHost;
  try { originHost = new URL(origin).host.toLowerCase(); } catch { return false; }
  if (requestHost(req) && originHost === requestHost(req)) return true;
  return (process.env.ALLOWED_ORIGINS || "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean).includes(origin.toLowerCase());
}

const sbHeaders = (key, extra) => ({
  apikey: key, Authorization: "Bearer " + key, "Content-Type": "application/json", ...(extra || {}),
});

// --- cross-checks ----------------------------------------------------------
//
// Everything below reads ONLY what the per-policy analyses already extracted.
// Nothing is inferred, and a value that was never extracted stays null rather
// than being filled with a plausible one.

const num = (v) => {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v !== "string") return null;
  // "$1,000,000" / "1M" / "1,000,000 per occurrence"
  const m = v.replace(/,/g, "").match(/\$?\s*(\d+(?:\.\d+)?)\s*(m|mm|million|k)?/i);
  if (!m) return null;
  const n = parseFloat(m[1]);
  const unit = (m[2] || "").toLowerCase();
  if (unit === "k") return n * 1e3;
  if (unit === "m" || unit === "mm" || unit === "million") return n * 1e6;
  return n;
};

const normName = (s) => (typeof s === "string" ? s.toUpperCase().replace(/[^A-Z0-9]/g, "") : "");

function buildCrossChecks(policies) {
  const rows = policies.map((p) => {
    const raw = p.ai_raw_output || {};
    return {
      policy_id: p.id,
      policy_type: p.policy_type,
      file_name: p.file_name,
      carrier: p.carrier || raw.carrier || null,
      policy_number: p.policy_number || raw.policy_number || null,
      effective_date: p.effective_date || raw.effective_date || null,
      expiration_date: p.expiration_date || raw.expiration_date || null,
      named_insured: raw.named_insured || raw.insured || null,
      limits: raw.general_review?.limits_assessment ?? null,
      raw,
    };
  });

  const umbrellas = rows.filter((r) => r.policy_type === "umbrella");
  const underlying = rows.filter((r) => r.policy_type !== "umbrella");

  // Underlying limits vs what an umbrella requires. Reported as a comparison
  // only where BOTH numbers were actually extracted; anything else is
  // "not_extracted", never a pass.
  const underlying_vs_umbrella = umbrellas.map((u) => {
    const req = u.raw.underlying_required || u.raw.general_review?.underlying_required || null;
    return {
      umbrella_file: u.file_name,
      umbrella_policy_number: u.policy_number,
      requirements_extracted: !!req,
      requirements: req ?? null,
      comparisons: req
        ? underlying.map((p) => {
            const required = num(req[p.policy_type] ?? req.auto ?? req.general_liability ?? null);
            const actual = num(p.raw.general_review?.occurrence_limit ?? p.raw.limits ?? null);
            return {
              file_name: p.file_name,
              policy_type: p.policy_type,
              required,
              actual,
              comparison:
                required === null || actual === null
                  ? "not_extracted"
                  : actual >= required ? "meets_or_exceeds" : "below_requirement",
            };
          })
        : [],
      note: req ? null : "This umbrella's underlying requirements were not extracted, so no comparison is possible. Say so; do not assume the underlying limits are adequate.",
    };
  });

  // Named insureds across policies. Differences are often legitimate (a DBA, an
  // affiliate), so this is surfaced for the agent, not judged here.
  const insureds = rows.map((r) => ({ file_name: r.file_name, named_insured: r.named_insured }));
  const distinctInsureds = [...new Set(insureds.map((i) => normName(i.named_insured)).filter(Boolean))];

  const terms = rows.map((r) => ({
    file_name: r.file_name,
    policy_type: r.policy_type,
    effective_date: r.effective_date,
    expiration_date: r.expiration_date,
  }));

  return {
    generated_at: new Date().toISOString(),
    policy_count: rows.length,
    lines_present: [...new Set(rows.map((r) => r.policy_type))],
    underlying_vs_umbrella,
    named_insureds: { per_policy: insureds, distinct_normalised_count: distinctInsureds.length },
    terms,
    carriers: [...new Set(rows.map((r) => r.carrier).filter(Boolean))],
  };
}

const SYSTEM_PROMPT = `You are reviewing an insurance PROGRAM: every policy in one audit, together. Each policy was analysed separately beforehand and could only describe its own document; you are the first step that sees them side by side.

TODAY'S DATE is given in the user message. It is the only present you may reason from. A policy whose expiration date has passed is EXPIRED and must be described that way.

FOUR STATES. Every coverage line you discuss resolves to exactly one:
  present       a policy in this audit covers it
  absent        NO policy in this audit covers it, AND every policy was read successfully
  not_supplied  no document for this line was uploaded, so nothing is known about it
  failed_unread a document exists but its analysis did not complete

You may assert "absent" ONLY because every policy in this audit was read successfully — that is the whole reason this pass exists. If you are uncertain whether a line was supplied, it is not_supplied, never absent. Reporting a coverage as missing when the client holds it destroys trust in the entire report; saying "not supplied" when it was is merely a question the agent asks.

CROSS-CHECKS are supplied to you as computed facts in the user message: underlying limits against umbrella requirements, named insureds, policy terms, carriers. Reason about them. Do not recompute them, do not recall limits from memory, and where a value is marked not_extracted say so rather than treating it as adequate.

NEVER state or imply a premium saving, a percentage reduction, a dollar figure the documents do not show, or any projection. You cannot see quotes, loss history or rating basis.

RESPOND ONLY with this JSON:
{
  "program_summary": "3-4 sentences on the program as a whole, across all policies",
  "lines": [{"line": "e.g. Commercial Auto", "state": "present|absent|not_supplied|failed_unread", "evidence": "which file shows it, or why nothing is known"}],
  "cross_policy_findings": [{"category": "UNDERLYING_LIMITS|NAMED_INSURED|TERM_ALIGNMENT|SCHEDULE|STRUCTURE", "severity": "HIGH|MODERATE|LOW", "finding": "what was found across policies", "evidence": "the specific policies and values involved", "recommendation": "what the agent should do"}],
  "questions_for_client": ["what is genuinely unknown and must be asked rather than assumed"],
  "expired_or_expiring": ["policies expired or expiring soon, measured against TODAY'S DATE"]
}`;

export default async function handler(req, res) {
  const origin = req.headers.origin;
  const originOk = isAllowedOrigin(origin, req);
  if (originOk) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
    res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, x-admin-password");
  }
  if (req.method === "OPTIONS") return res.status(originOk ? 200 : 403).end();
  if (req.method !== "POST") { res.setHeader("Allow", "POST"); return res.status(405).json({ error: "Method not allowed" }); }
  if (!originOk) return res.status(403).json({ error: "Forbidden" });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  const adminPassword = process.env.AUDIT_ADMIN_PASSWORD;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!apiKey || !adminPassword || !serviceKey) return res.status(500).json({ error: "Server not configured" });
  if (req.headers["x-admin-password"] !== adminPassword) return res.status(401).json({ error: "Unauthorized" });

  const { audit_id: auditId, generated_by: generatedBy, today } = req.body || {};
  if (!auditId || typeof auditId !== "string") return res.status(400).json({ error: "Missing audit_id" });

  try {
    const polRes = await fetch(`${SUPABASE_URL}/rest/v1/audit_policies?audit_id=eq.${encodeURIComponent(auditId)}&order=created_at`, { headers: sbHeaders(serviceKey) });
    if (!polRes.ok) return res.status(502).json({ error: "Could not load policies", upstream_status: polRes.status });
    const policies = await polRes.json();
    if (!Array.isArray(policies) || policies.length === 0) return res.status(400).json({ error: "This audit has no policies" });

    // THE GUARD. Enforced here so it cannot be bypassed by calling the endpoint
    // directly -- the UI button is a convenience, not the control.
    const unread = policies
      .filter((p) => !isAnalysed(p.ai_status))
      .map((p) => ({ policy_id: p.id, file_name: p.file_name, ai_status: p.ai_status }));
    if (unread.length) {
      return res.status(409).json({
        error: "Cannot generate a program report while any policy is unread",
        reason: "An absence can only be asserted when every policy in the audit was actually read. These were not, so any line they cover would be reported as missing.",
        unread_policies: unread,
      });
    }

    const crossChecks = buildCrossChecks(policies);
    const policiesIncluded = policies.map((p) => ({ policy_id: p.id, policy_type: p.policy_type, file_name: p.file_name, ai_status: p.ai_status }));

    const userContent = [
      `TODAY'S DATE: ${typeof today === "string" && today.slice(0, 10).match(/^\d{4}-\d{2}-\d{2}$/) ? today : new Date().toISOString().slice(0, 10)}`,
      ``,
      `POLICIES IN THIS AUDIT (${policies.length}), every one analysed successfully:`,
      JSON.stringify(policiesIncluded, null, 2),
      ``,
      `COMPUTED CROSS-CHECKS (facts, not to be recomputed):`,
      JSON.stringify(crossChecks, null, 2),
      ``,
      `PER-POLICY ANALYSIS OUTPUT:`,
      JSON.stringify(policies.map((p) => ({ file_name: p.file_name, policy_type: p.policy_type, ai_status: p.ai_status, analysis: p.ai_raw_output })), null, 2),
      ``,
      `Produce the program-level report as JSON. Remember: "absent" is permitted only because every policy here was read; anything you are unsure was supplied is not_supplied.`,
    ].join("\n");

    const aiRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: MAX_TOKENS,
        output_config: { effort: EFFORT },
        system: SYSTEM_PROMPT,
        messages: [{ role: "user", content: userContent }],
      }),
    });

    if (!aiRes.ok) {
      const detail = await aiRes.text();
      console.error(`[program-report] upstream failed ${aiRes.status}: ${detail.slice(0, 300)}`);
      return res.status(502).json({ error: "Upstream API request failed", upstream_status: aiRes.status, details: detail.slice(0, 500) });
    }

    const data = await aiRes.json();
    if (data.stop_reason === "max_tokens") console.error("[program-report] response truncated at max_tokens");
    const text = (data.content || []).filter((c) => c.type === "text").map((c) => c.text).join("");

    let result;
    try {
      result = JSON.parse(text.replace(/```json|```/g, "").trim());
    } catch {
      return res.status(502).json({ error: "Program report was not valid JSON", details: text.slice(0, 500) });
    }

    const insert = await fetch(`${SUPABASE_URL}/rest/v1/audit_program_analysis`, {
      method: "POST",
      headers: sbHeaders(serviceKey, { Prefer: "return=representation" }),
      body: JSON.stringify({
        audit_id: auditId,
        policies_included: policiesIncluded,
        cross_checks: crossChecks,
        result,
        unread_policies: [],
        model: data.model || MODEL,
        generated_by: typeof generatedBy === "string" ? generatedBy.slice(0, 200) : "operator",
      }),
    });
    if (!insert.ok) {
      const detail = await insert.text();
      // The report itself is sound; only storing it failed. Return it rather
      // than discarding work that has already been paid for.
      console.error(`[program-report] insert failed ${insert.status}: ${detail.slice(0, 300)}`);
      return res.status(200).json({ result, cross_checks: crossChecks, policies_included: policiesIncluded, stored: false, store_error: `HTTP ${insert.status}` });
    }
    const rows = await insert.json();
    return res.status(200).json({ result, cross_checks: crossChecks, policies_included: policiesIncluded, stored: true, row: Array.isArray(rows) ? rows[0] : rows });
  } catch (e) {
    return res.status(500).json({ error: "Server error", message: e.message });
  }
}
