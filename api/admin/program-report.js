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

const LINE_LABELS = {
  gl: "General Liability", eo: "Errors & Omissions", do: "Directors & Officers",
  cyber: "Cyber Liability", epli: "Employment Practices", products: "Products / Completed Ops",
  wc: "Workers Compensation", auto_policy: "Commercial Auto", excess_auto: "Excess Auto",
  auto_physical_damage: "Auto Physical Damage", property: "Property / BOP",
  umbrella: "Umbrella / Excess", detect: "Unidentified", other: "Other",
};
const lineLabel = (t) => LINE_LABELS[t] || t;

// The layers that sit ABOVE something else and therefore carry underlying
// requirements. An excess auto layer does this exactly as an umbrella does --
// while it was folded into auto_policy the cross-check could not see it, so an
// excess layer's requirements were never compared against anything.
const TOP_LAYER_TYPES = new Set(["umbrella", "excess_auto"]);

const parseDate = (s) => {
  if (!s || typeof s !== "string") return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
};

// in force / expired on <date> / renews on <date>, measured against today.
// Computed here rather than asked of the model: it is arithmetic, and the model
// has no clock.
function termStatus(effective, expiration, today) {
  const exp = parseDate(expiration);
  const eff = parseDate(effective);
  if (!exp) return { state: "unknown", label: "Term not extracted" };
  const days = Math.round((exp - today) / 86400000);
  if (days < 0) return { state: "expired", label: `Expired ${expiration}`, days_ago: -days };
  if (eff && eff > today) return { state: "future", label: `Incepts ${effective}`, days_until: Math.round((eff - today) / 86400000) };
  if (days <= 90) return { state: "expiring", label: `Renews ${expiration}`, days_until: days };
  return { state: "in_force", label: `In force to ${expiration}`, days_until: days };
}

const VERDICT_LABELS = {
  EXCLUDED: "Artificial-intelligence exclusion found",
  SILENT: "Silent on artificial intelligence",
  PARTIAL: "Partial artificial-intelligence coverage",
  AFFIRMATIVE: "Affirmative artificial-intelligence coverage",
  UNKNOWN: "Not an insurance policy",
};

// The policy table. Every column except limits/deductibles is taken from stored
// fields or the per-policy output -- never from the model, which cannot be
// asked to recall a carrier name or recompute a date.
function buildPolicyTable(policies, today) {
  return policies.map((p) => {
    const raw = p.ai_raw_output || {};
    return {
      policy_id: p.id,
      file_name: p.file_name,
      line: lineLabel(p.policy_type),
      policy_type: p.policy_type,
      carrier: p.carrier || raw.carrier || null,
      policy_number: p.policy_number || raw.policy_number || null,
      effective_date: p.effective_date || raw.effective_date || null,
      expiration_date: p.expiration_date || raw.expiration_date || null,
      term_status: termStatus(p.effective_date || raw.effective_date, p.expiration_date || raw.expiration_date, today),
      ai_verdict: { status: p.ai_status, label: VERDICT_LABELS[p.ai_status] || p.ai_status },
      premium_as_shown: raw.agent_opportunities?.premium_as_shown ?? null,
      // Filled from the model's reading of its own per-policy analysis, merged
      // in after the call. Null until then.
      key_limits: null,
      deductibles: null,
    };
  });
}

// Program findings that are arithmetic or set comparison, not judgement. These
// are computed, stored as computed, and shown before anything the model says.
function computedFindings(policies, table, crossChecks) {
  const out = [];

  // An expired layer sitting under an in-force one: the tower has a hole in it.
  const inForce = table.filter((r) => r.term_status.state === "in_force" || r.term_status.state === "expiring");
  const expired = table.filter((r) => r.term_status.state === "expired");
  if (expired.length && inForce.length) {
    out.push({
      type: "TERM_ALIGNMENT",
      severity: "HIGH",
      finding: `${expired.length} polic${expired.length === 1 ? "y has" : "ies have"} expired while ${inForce.length} remain${inForce.length === 1 ? "s" : ""} in force.`,
      evidence: `Expired: ${expired.map((r) => `${r.line} (${r.expiration_date})`).join("; ")}. In force: ${inForce.map((r) => r.line).join("; ")}.`,
    });
  }

  // Underlying limits against what an umbrella requires.
  for (const u of crossChecks.underlying_vs_umbrella) {
    if (!u.requirements_extracted) {
      out.push({
        type: "UNDERLYING_LIMITS", severity: "MODERATE",
        finding: `Underlying requirements could not be read from ${u.umbrella_file}, so no policy can be confirmed to satisfy them.`,
        evidence: "Absence of a requirement figure is not evidence that the underlying limits are adequate.",
      });
      continue;
    }
    for (const c of u.comparisons) {
      if (c.comparison === "below_requirement") {
        out.push({
          type: "UNDERLYING_LIMITS", severity: "HIGH",
          finding: `${lineLabel(c.policy_type)} carries less than ${u.umbrella_file} requires beneath it.`,
          evidence: `Required ${c.required.toLocaleString()}, actual ${c.actual.toLocaleString()} (${c.file_name}).`,
        });
      } else if (c.comparison === "not_extracted") {
        out.push({
          type: "UNDERLYING_LIMITS", severity: "MODERATE",
          finding: `Could not compare ${lineLabel(c.policy_type)} against the underlying requirement on ${u.umbrella_file}.`,
          evidence: "One or both figures were not extracted. Not a pass.",
        });
      }
    }
  }

  // Policies an umbrella schedules that were never uploaded.
  if (crossChecks.underlying_named_not_supplied.length) {
    out.push({
      type: "NOT_SUPPLIED", severity: "HIGH",
      finding: `An umbrella names underlying coverage that was not supplied for review.`,
      evidence: crossChecks.underlying_named_not_supplied.join("; "),
    });
  }

  // Named insureds that do not match across policies.
  if (crossChecks.named_insureds.distinct_normalised_count > 1) {
    out.push({
      type: "NAMED_INSURED", severity: "MODERATE",
      finding: "The named insured is not identical across all policies.",
      evidence: crossChecks.named_insureds.per_policy.filter((i) => i.named_insured).map((i) => `${i.file_name}: ${i.named_insured}`).join("; "),
    });
  }

  return out;
}

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

  const umbrellas = rows.filter((r) => TOP_LAYER_TYPES.has(r.policy_type));
  const underlying = rows.filter((r) => !TOP_LAYER_TYPES.has(r.policy_type));

  // Underlying limits vs what a top layer requires. Reported as a comparison
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

  // Underlying coverage an umbrella names but which was never uploaded. Set
  // comparison, not judgement: a line the umbrella schedules and the audit does
  // not contain is a document we were not given.
  const suppliedTypes = new Set(underlying.map((r) => r.policy_type));
  const underlying_named_not_supplied = [];
  for (const u of umbrellas) {
    const scheduled = u.raw.underlying_required || u.raw.scheduled_underlying || null;
    if (!scheduled || typeof scheduled !== "object") continue;
    for (const key of Object.keys(scheduled)) {
      const k = key.toLowerCase();
      const guess = k.includes("auto") ? "auto_policy" : k.includes("general") || k === "gl" ? "gl" : k.includes("employ") ? "wc" : null;
      if (guess && !suppliedTypes.has(guess)) {
        underlying_named_not_supplied.push(`${u.file_name} names ${key} beneath it; no such policy was uploaded`);
      }
    }
  }

  // Each policy's own stated gaps, so the model can notice where one policy
  // reports a coverage missing that another policy in the audit provides.
  const gaps_per_policy = rows.map((r) => ({
    file_name: r.file_name,
    policy_type: r.policy_type,
    coverage_gaps: r.raw.coverage_gaps || [],
    lines_not_evidenced_here: r.raw.agent_opportunities?.lines_not_evidenced_here || r.raw.agent_opportunities?.new_lines_to_write || [],
  }));

  return {
    generated_at: new Date().toISOString(),
    policy_count: rows.length,
    lines_present: [...new Set(rows.map((r) => r.policy_type))],
    underlying_vs_umbrella,
    underlying_named_not_supplied,
    gaps_per_policy,
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

WRITING RULES:
- "AI" means artificial intelligence and nothing else. NEVER use "AI" as an abbreviation for "additional insured" -- write "additional insured" in full every time. In an insurance report the short form is genuinely ambiguous, and this tool's entire subject is artificial-intelligence coverage.
- Plain professional English. No marketing language.

The POLICY TABLE and the COMPUTED FINDINGS are built from the extracted data before you see them. Do not reproduce or recompute them. You are asked for four things only:

RESPOND ONLY with this JSON:
{
  "policy_limits": [{"file_name": "exact file name from the policy table", "key_limits": "the principal limits as the analysis recorded them, e.g. '$1M occurrence / $2M aggregate', or null if not extracted", "deductibles": "deductibles or retentions as recorded, or null"}],

  "program_synthesis": [{"finding": "a program-level point drawn from the per-policy analyses together", "evidence": "which policies and what in them", "severity": "HIGH|MODERATE|LOW"}],

  "coverage_position": [{"line": "line of business, e.g. Commercial Auto", "state": "present|absent|not_supplied|unread", "policy": "which file provides it, when present; the failed file name, when unread; otherwise null", "note": "for not_supplied, what to confirm with the client"}],

  "agent_notes": {"lead_hook": "one sentence opening a conversation about this PROGRAM", "primary_opportunity": "the single strongest angle across the whole account", "talking_points": ["3-5 points about the program, not one policy"], "urgency": ["what is time-sensitive, measured against TODAY'S DATE"]}
}

program_synthesis: 5-8 points. Program-level only -- if a point is true of one policy in isolation it belongs in that policy's own analysis, not here. Include where one policy reports a coverage missing that ANOTHER policy in this audit actually provides; that contradiction is invisible from either document alone and is exactly what this pass is for.

coverage_position: cover every line of business you can see evidence about, plus any a supplied policy refers to. Use "absent" only where a supplied document affirmatively shows the coverage is not carried -- not merely because no document mentioned it. When in doubt it is "not_supplied", which costs the agent a question; "absent" wrongly costs them the client's trust in the whole report.

agent_notes are INTERNAL and are stripped from anything the client sees.`;

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

    const todayStr = typeof today === "string" && /^\d{4}-\d{2}-\d{2}$/.test(today.slice(0, 10)) ? today.slice(0, 10) : new Date().toISOString().slice(0, 10);
    const todayDate = new Date(`${todayStr}T00:00:00Z`);

    const crossChecks = buildCrossChecks(policies);
    const policyTable = buildPolicyTable(policies, todayDate);
    const computed = computedFindings(policies, policyTable, crossChecks);
    const policiesIncluded = policies.map((p) => ({ policy_id: p.id, policy_type: p.policy_type, file_name: p.file_name, ai_status: p.ai_status }));

    const userContent = [
      `TODAY'S DATE: ${todayStr}`,
      ``,
      `POLICY TABLE (computed from the extracted data -- these are facts, do not restate or recompute them):`,
      JSON.stringify(policyTable.map(({ key_limits, deductibles, policy_id, ...rest }) => rest), null, 2),
      ``,
      `COMPUTED FINDINGS (already established; your synthesis must add to these, not repeat them):`,
      JSON.stringify(computed, null, 2),
      ``,
      `COMPUTED CROSS-CHECKS (supporting detail for the above):`,
      JSON.stringify(crossChecks, null, 2),
      ``,
      `PER-POLICY ANALYSIS OUTPUT:`,
      JSON.stringify(policies.map((p) => ({ file_name: p.file_name, policy_type: p.policy_type, ai_status: p.ai_status, analysis: p.ai_raw_output })), null, 2),
      ``,
      `Produce the four requested JSON keys. "absent" is permitted only because every policy here was read; anything you are unsure was supplied is not_supplied. Write "additional insured" in full.`,
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

    let model;
    try {
      model = JSON.parse(text.replace(/```json|```/g, "").trim());
    } catch {
      return res.status(502).json({ error: "Program report was not valid JSON", details: text.slice(0, 500) });
    }

    // Assemble Level 1. The computed halves win: the model supplies limits it
    // read and the judgement it was asked for, and nothing else reaches the
    // stored result. A fact the model restated is discarded in favour of the
    // computed one, so the report cannot drift from the extracted data.
    for (const row of policyTable) {
      const supplied = (model.policy_limits || []).find((l) => l.file_name === row.file_name);
      row.key_limits = supplied?.key_limits ?? null;
      row.deductibles = supplied?.deductibles ?? null;
    }

    const result = {
      level: 1,
      generated_for_date: todayStr,
      policy_table: policyTable,
      program_findings: {
        computed,
        synthesis: Array.isArray(model.program_synthesis) ? model.program_synthesis : [],
      },
      coverage_position: Array.isArray(model.coverage_position) ? model.coverage_position : [],
      // Internal only. Level 3 strips this; it must never reach a client document.
      agent_notes: model.agent_notes ?? null,
    };

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
