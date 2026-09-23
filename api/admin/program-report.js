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

// Carrier short names for the table; the full legal name stays on the row for
// Level 2. There is no mechanical rule -- "National Union Fire Insurance
// Company of Pittsburgh, Pa. (AIG)" shortens to its parenthetical, while
// "Ironshore Specialty Insurance Company (Liberty Mutual)" shortens to its
// prefix and the parenthetical must be ignored. So: a known-carrier list
// first, then a heuristic, and the full name if neither fits.
const CARRIER_SHORT = [
  [/lloyd/i, "Lloyd's"], [/national union fire|\bAIG\b/i, "AIG"],
  [/hanover/i, "Hanover"], [/ironshore/i, "Ironshore"],
  [/general star/i, "General Star"], [/travelers/i, "Travelers"],
  [/chubb|federal insurance/i, "Chubb"], [/hartford/i, "The Hartford"],
  [/zurich/i, "Zurich"], [/\bCNA\b|continental casualty/i, "CNA"],
  [/liberty mutual/i, "Liberty Mutual"], [/berkley/i, "W.R. Berkley"],
  [/markel/i, "Markel"], [/state farm/i, "State Farm"],
  [/philadelphia/i, "Philadelphia"], [/cincinnati/i, "Cincinnati"],
  [/nationwide/i, "Nationwide"], [/selective/i, "Selective"],
];
const FILLER = /\b(the|insurance|indemnity|specialty|surplus|fire|marine|casualty|mutual|company|companies|corporation|corp|co|group|underwriters|at|of|and|America|American)\b/gi;

function shortCarrier(full) {
  if (!full || typeof full !== "string") return null;
  for (const [re, name] of CARRIER_SHORT) if (re.test(full)) return name;
  const paren = full.match(/\(([^)]+)\)/);
  if (paren && paren[1].length <= 6 && paren[1] === paren[1].toUpperCase()) return paren[1];
  const base = full.replace(/\([^)]*\)/g, " ").replace(FILLER, " ").replace(/[,.]/g, " ").replace(/\s+/g, " ").trim();
  const words = base.split(" ").filter(Boolean).slice(0, 2).join(" ");
  return words || full;
}

// The premium total as printed: no fees, no parentheticals. A labelled total
// wins; otherwise the largest figure, which excludes a surcharge listed
// alongside the premium rather than adding it in.
// Amounts are written more ways than one: "$13,313.00", "USD 13,313.00",
// "US$13,313". Matching only the dollar sign left a real premium blank on the
// auto physical damage policy, which reads as "no premium" rather than "we did
// not parse it". Output is normalised to a dollar figure for the table.
function premiumTotal(s) {
  if (!s || typeof s !== "string") return null;
  // Built per call rather than shared at module scope: a /g regex carries
  // lastIndex, and one shared across calls is a bug waiting to happen.
  const amount = /(?:US\$|USD\s*|\$)\s?([\d,]+(?:\.\d{1,2})?)/gi;
  const stripped = s.replace(/\([^)]*\)/g, " ");
  const labelled = stripped.match(/total[^\d$]{0,30}(?:US\$|USD\s*|\$)?\s?([\d,]+(?:\.\d{1,2})?)/i);
  if (labelled) return "$" + labelled[1];
  const amounts = [...stripped.matchAll(amount)].map((m) => m[1]);
  if (!amounts.length) return null;
  const biggest = amounts.reduce((a, b) => (parseFloat(b.replace(/,/g, "")) > parseFloat(a.replace(/,/g, "")) ? b : a));
  return "$" + biggest;
}

// Short enough for a cell. The full phrase stays in ai_verdict.label.
const VERDICT_SHORT = {
  EXCLUDED: "Excluded", SILENT: "Silent", PARTIAL: "Partial",
  AFFIRMATIVE: "Affirmative", UNKNOWN: "Not a policy",
};

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
      carrier: p.carrier || raw.carrier || null,                    // full, for Level 2
      carrier_short: shortCarrier(p.carrier || raw.carrier),        // for the table
      policy_number: p.policy_number || raw.policy_number || null,
      effective_date: p.effective_date || raw.effective_date || null,
      expiration_date: p.expiration_date || raw.expiration_date || null,
      term_status: termStatus(p.effective_date || raw.effective_date, p.expiration_date || raw.expiration_date, today),
      ai_verdict: { status: p.ai_status, label: VERDICT_LABELS[p.ai_status] || p.ai_status, short: VERDICT_SHORT[p.ai_status] || p.ai_status },
      premium_as_shown: raw.agent_opportunities?.premium_as_shown ?? null,   // verbatim, for Level 2
      premium_total: premiumTotal(raw.agent_opportunities?.premium_as_shown), // the figure alone
      // Filled from the model's reading of its own per-policy analysis, merged
      // in after the call. Null until then.
      key_limits: null,
      deductibles: null,
    };
  });
}

// The limit adequacy section. Separate from program findings because "is this
// tower deep enough" is the question an agent actually opens the report to
// answer, and it was previously reduced to one line inside a findings list --
// and on an audit where the requirements could not be read, that line said only
// that nothing could be determined, which is true but useless on its own.
//
// Entirely computed. Where a figure is missing the state says so; nothing here
// infers adequacy from silence.
// Which policy types could carry a given line, keyed by a word in the line
// name. An empty array means no policy type in this system carries that line --
// it is only ever written standalone, so unless that standalone policy was
// supplied, its absence cannot be established from anything else.
//
// The point of the table is one rule: a line can only be called absent if we
// were actually given the kind of policy that would carry it. A general
// liability policy declining its cyber coverage part says the line is not on
// THAT policy; it is silent on whether the client buys cyber from someone else.
// Lines that exist ONLY as an election or endorsement on a host policy, never
// as a standalone policy bought from another carrier. The host-type table below
// asks "could another policy carry this line", which is the wrong question for
// these: nobody sells terrorism cover separately, the insurer writing the
// policy must offer it and the insured takes it or does not, right there.
//
// So if the host policy is in the audit, we can see the answer, and the line is
// eligible to be absent. A null host list means any policy can host it --
// terrorism is elected on liability, property and package policies alike.
const ELECTION_LINES = [
  [/terror|\btria\b|tripra/i, null],
];

// null       not an election line; the host-type table decides
// "has_host"  an election whose host policy is in the audit, so we can see it
// "no_host"   a known election whose host is NOT here, so we cannot know
function electionStatus(line, suppliedTypes, policyCount) {
  if (typeof line !== "string") return null;
  const entry = ELECTION_LINES.find(([re]) => re.test(line));
  if (!entry) return null;
  const hosts = entry[1];
  const present = hosts === null ? policyCount > 0 : hosts.some((t) => suppliedTypes.has(t));
  return present ? "has_host" : "no_host";
}

const LINE_HOST_TYPES = [
  [/\bcyber|data breach|privacy\b/i, ["cyber"]],
  [/employment practices|\bepli\b/i, ["epli"]],
  [/professional|errors? (and|&) omissions|\be ?& ?o\b|design.?build/i, ["eo"]],
  [/directors|\bd ?& ?o\b/i, ["do"]],
  [/workers.? comp|employers liability/i, ["wc"]],
  [/pollution|environmental/i, []],
  [/crime|employee dishonesty|fidelity/i, []],
  [/cargo/i, []],
  [/umbrella|excess/i, ["umbrella", "excess_auto"]],
  [/\bauto|vehicle|fleet/i, ["auto_policy", "excess_auto", "auto_physical_damage"]],
  [/property|building|business income|inland marine|equipment/i, ["property"]],
  [/general liability|premises|products/i, ["gl", "products"]],
];

// A note describing the client NOT having something cannot support a state of
// "present". The clearest case is a declined election: terrorism under TRIA is
// offered on a policy and taken or not on that same policy, so a declined offer
// means no terrorism cover -- and recording it as present because the
// underlying policy exists tells the client they hold something they do not.
// That direction is the more dangerous of the two, because a client acts on it.
//
// Only strong decline language counts, and only where the note carries no sign
// of the coverage actually being in force. A note reading "In force with
// Ironshore; the insured declined the higher limit option" describes a real
// coverage and must survive untouched.
const DECLINED = /\b(declined|not elected|did not elect|rejected|not purchased|not bought|waived|opted out|not taken)\b/i;
const IN_FORCE = /\$[\d,]|\bin force\b|\bwritten with\b|\bcarried\b|\bcovered (at|by|under|for)\b|\blimits? of\b|\bbound\b/i;

function resolveDeclinedElections(position) {
  const flipped = [];
  const resolved = position.map((p) => {
    if (p?.state !== "present" || typeof p.note !== "string") return p;
    if (!DECLINED.test(p.note) || IN_FORCE.test(p.note)) return p;
    flipped.push(p.line);
    // Marked absent here and then passed through constrainAbsent, which decides
    // whether the documents can support that: an election on a policy we hold
    // stays absent, while a standalone line falls on to not_supplied. The two
    // guards compose, so neither has to know about the other's cases.
    return { ...p, state: "absent" };
  });
  return { position: resolved, flipped };
}

// Downgrade "absent" to "not_supplied" wherever the documents cannot support
// it. Downgrade only, never the reverse: this can make the report claim less
// than the model wanted, never more, so a misfire costs a question rather than
// a false statement to a client.
//
// This exists because the prompt alone has been wrong here twice. Telling a
// client they have no cyber cover, on the strength of a liability policy that
// was never going to carry cyber, is the most damaging thing this field can do.
// A downgraded line keeps what the document showed and gains the question. The
// client has to be able to see both: what we read, and what we still need.
function declineNote(note) {
  const kept = typeof note === "string" && note.trim() ? note.trim().replace(/[.\s]+$/, "") : "";
  return kept
    ? `${kept} — tell us whether you hold a standalone policy for this, or we can quote it.`
    : "We were not given a policy that would carry this line — tell us whether you hold one.";
}

function constrainAbsent(position, policyTable) {
  const suppliedTypes = new Set(policyTable.map((r) => r.policy_type).filter(Boolean));
  const downgraded = [], upgraded = [];
  const constrained = position.map((p) => {
    const election = electionStatus(p?.line, suppliedTypes, policyTable.length);

    // "not_supplied" means we cannot know. For an election declined on a host
    // policy we are holding, we do know: the document says so.
    //
    // THIS IS THE ONLY PLACE IN THIS FILE THAT RAISES A CLAIM, AND IT IS AN
    // EXCEPTION, NOT A PRECEDENT. Every other guard here may only ever claim
    // less than the model did -- a wrong downgrade costs a question, a wrong
    // upgrade puts a false statement in front of a client. This one is allowed
    // because all three conditions together leave nothing unknown: the line can
    // exist ONLY as an election on a host policy, that host policy is in this
    // audit, and the note states the decline outright. Any one of them missing
    // and the answer is not established.
    //
    // Do not copy this shape to another guard. A future upgrade needs the same
    // three-part conjunction -- a line whose only possible home we hold, plus
    // document evidence of the answer -- and the owner's explicit approval
    // before it ships. Loosening any leg of it is how a report starts telling
    // clients they lack cover they hold.
    if (p?.state === "not_supplied" && election === "has_host" && DECLINED.test(p.note || "")) {
      upgraded.push(p.line);
      return { ...p, state: "absent" };
    }

    if (p?.state !== "absent" || typeof p.line !== "string") return p;

    // The host policy is in the audit, so the election is visible to us and the
    // line is eligible to be absent. Without this the host-type table below
    // finds no policy type that "carries terrorism" -- because none does -- and
    // knocks a correct absent down to not_supplied.
    if (election === "has_host") return p;
    // A known election whose host policy is NOT in the audit: we never saw the
    // document the election lives on, so nothing about it is established.
    if (election === "no_host") {
      downgraded.push(p.line);
      return { ...p, state: "not_supplied", note: declineNote(p.note) };
    }

    const entry = LINE_HOST_TYPES.find(([re]) => re.test(p.line));
    // A line this table does not recognise is left alone: the prompt governs
    // it, and guessing at an unmapped line would be its own kind of error.
    if (!entry) return p;
    const hostTypes = entry[1];
    if (hostTypes.some((t) => suppliedTypes.has(t))) return p;
    downgraded.push(p.line);
    return { ...p, state: "not_supplied", note: declineNote(p.note) };
  });
  return { position: constrained, downgraded, upgraded };
}

function limitAdequacy(policyTable, crossChecks) {
  const layers = crossChecks.underlying_vs_umbrella.map((u) => {
    const top = policyTable.find((r) => r.file_name === u.umbrella_file);
    return {
      top_layer_line: top ? top.line : "Top layer",
      top_layer_file: u.umbrella_file,
      policy_number: u.umbrella_policy_number,
      requirements_extracted: u.requirements_extracted,
      requirements: u.requirements,
      note: u.note,
      rows: u.comparisons.map((c) => ({
        line: lineLabel(c.policy_type),
        file_name: c.file_name,
        required: c.required,
        actual: c.actual,
        state: c.comparison,
      })),
    };
  });

  // Every policy's limits as carried, so the tower is legible even when no
  // comparison is possible. Top layers last, which is how a tower is read.
  const carried = [...policyTable]
    .sort((a, b) => Number(TOP_LAYER_TYPES.has(a.policy_type)) - Number(TOP_LAYER_TYPES.has(b.policy_type)))
    .map((r) => ({
      line: r.line,
      file_name: r.file_name,
      is_top_layer: TOP_LAYER_TYPES.has(r.policy_type),
      key_limits: r.key_limits,
      deductibles: r.deductibles,
    }));

  const determinable = layers.some((l) => l.rows.some((r) => r.state === "below_requirement" || r.state === "meets_or_exceeds"));

  return {
    layers,
    carried,
    determinable,
    summary: !layers.length
      ? "No excess or umbrella layer was supplied, so there is no underlying requirement to test the primary limits against."
      : determinable
        ? null
        : "An excess or umbrella layer was supplied but its underlying requirements could not be read, so no primary policy can be confirmed to satisfy them. This is not a finding that the limits are adequate.",
  };
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
- WHOSE VOICE THIS IS: this report is written BY the client's broker and agency, to the client. There is no third party to refer them to -- we are the broker, the agent and the agency. NEVER write "ask your broker", "your agent", "your agency", "an insurance professional", "speak to your carrier" or any equivalent: it refers the reader to us, which reads as though we did not do the work, and to the client it reads as though someone else is handling their account. Write in the first person plural about what WE will do -- "We recommend...", "We'll place...", "We'll confirm with the carrier...", "We suggest reviewing..." -- and in the second person about what the client should decide or send us. The only outside parties that may be addressed as such are the issuing carrier and the client's own counsel or accountant.

The POLICY TABLE and the COMPUTED FINDINGS are built from the extracted data before you see them. Do not reproduce or recompute them. You are asked for four things only:

RESPOND ONLY with this JSON:
{
  "policy_limits": [{"file_name": "exact file name from the policy table", "key_limits": ["AT MOST 3 headline figures, each a SHORT token, no prose and no sentences: '$1M CSL', '$500K SUM', '$2M xs $1M', '$1M / $2M agg'. Omit anything that will not fit a narrow table cell. Empty array if none were extracted."], "deductibles": "a short token such as '$10K' or '$25K comp/coll', not a sentence. null if none."}],

  "program_synthesis": [{"finding": "a program-level point drawn from the per-policy analyses together", "evidence": "which policies and what in them", "severity": "HIGH|MODERATE|LOW"}],

  "coverage_position": [{"line": "line of business, e.g. Commercial Auto", "state": "present|absent|not_supplied|unread", "policy": "the EXACT file name from the policy table, or null. This is an internal key used to look the policy up; it is never shown to anyone.", "note": "one short clause of plain English. THE CLIENT READS THIS, so address them, not a colleague -- never 'confirm with the client'. Write the note the STATE calls for, and do not let one state's phrasing bleed into another: for absent, say what the documents rule out program-wide ('Your excess policy excludes hired and non-owned autos by endorsement, so nothing sits above them'); for not_supplied where a coverage part was declined on a policy we hold, say BOTH -- what the document shows and what we still need ('Site pollution was not purchased on your liability policy; tell us whether you hold a standalone environmental policy'); for not_supplied where nothing speaks to the line at all, just ask ('We don't have this on file -- send us the current declarations'); for present, one clause on what it is and any term or carve-out worth knowing -- and if what you are about to write is that the coverage was declined or not elected, stop: the state is absent, not present. A note ending in 'send us...' on a line you marked absent means you picked the wrong state. NEVER name an upload file here -- a client has never seen those file names and they mean nothing to them."}],

  "client_recommendations": ["4-8 recommendations in plain language, written to be read BY THE CLIENT. No jargon, no internal sales angles, no figures the documents do not show, and never a premium saving or estimate. Each should say what to do and why it matters in one or two sentences. Refer to a policy by its carrier and line -- 'the General Star excess auto policy' -- NEVER by an upload file name, which the client has never seen. These appear in the client-facing document, so write them as advice to the client, not as notes to the agent. Written in OUR voice as their broker -- 'We recommend raising...', 'We'll confirm the underlying limits with General Star...' -- never 'ask your broker' or 'your agent', because we ARE their broker and there is nobody else to ask."],

  "agent_notes": {"lead_hook": "one sentence opening a conversation about this PROGRAM", "primary_opportunity": "the single strongest angle across the whole account", "talking_points": ["3-5 points about the program, not one policy"], "urgency": ["what is time-sensitive, measured against TODAY'S DATE"]}
}

program_synthesis: 5-8 points. Program-level only -- if a point is true of one policy in isolation it belongs in that policy's own analysis, not here. Include where one policy reports a coverage missing that ANOTHER policy in this audit actually provides; that contradiction is invisible from either document alone and is exactly what this pass is for.

coverage_position: cover every line of business you can see evidence about, plus any a supplied policy refers to.

- "present" means the coverage IS CARRIED. Nothing else. If your own note says the coverage was declined, not elected, not purchased, rejected or excluded, then it is not present and you have contradicted yourself inside one line. Read the note you are about to write before choosing the state: if it describes the client NOT having something, the state is not "present".

A DECLINED ELECTION IS "absent", NOT "present". Where a coverage is offered ON a policy and the insured declines it -- terrorism under TRIA is the standard case -- the election belongs to that policy and nowhere else. Nobody buys TRIA cover from a different carrier: the insurer writing the policy must offer it, and the insured takes it or does not, on that policy. A declined terrorism offer therefore means that policy carries no terrorism cover, and where the policy also excludes terrorism losses that is a real gap the client needs to see. Do not record it as present because the underlying policy exists.

That is different from a coverage part declined on a policy that was never going to carry the line anyway. The test: could the client hold this coverage on a SEPARATE policy from another carrier? Terrorism under TRIA -- no, it is an election on this policy, so declined means absent. Cyber, EPLI, pollution, professional liability -- yes, routinely standalone, so declined here means not_supplied and the rule below applies.

The absent/not_supplied split is the whole point of this pass, and BOTH directions of error are real:

- "absent" means the SUPPLIED DOCUMENTS RULE THE LINE OUT ACROSS THE WHOLE PROGRAM -- not merely off one policy. The test: is there any policy the client could plausibly hold, which we were not shown, that would carry this line? If yes, it is NOT absent. Absent is for a line that could only live at a layer we were actually given and is excluded there -- excess hired and non-owned auto struck by endorsement on the only excess policy in the program, for instance. That is a genuine gap, the client is reading this report to find it, and burying it as not_supplied makes us look like we did not read what we were sent.

- "not_supplied" means the documents we hold do not settle it. This INCLUDES the most common case by far: a coverage part shown as not purchased or not offered on a policy we were given. That tells us the line is not on THAT policy. It tells us nothing about whether the client buys it standalone from another carrier -- cyber, EPLI, pollution and professional liability are overwhelmingly written standalone, so a liability policy declining those parts is not evidence the client has no such cover. Say what the document shows and ask the question: "Your liability policy does not include this coverage part -- tell us whether you hold a standalone policy, or we can quote it."

A COVERAGE PART NOT PURCHASED ON A SUPPLIED POLICY IS "not_supplied", NOT "absent" -- UNLESS it is an election that can only live on a policy we hold, in which case the declined-election rule above governs and the answer is "absent". Terrorism under TRIA is that exception: "terrorism was not purchased on the liability policy" and "terrorism was offered and declined" are THE SAME FACT worded two ways, and both mean absent. Do not let the wording you happen to choose decide the state.

For every other line, marking a declined coverage part absent tells a client to their face that they have no cyber cover when the policy naming that gap was never the policy that would carry it. That is the single most damaging error this field can make, and it is the one to watch for.

Weigh how much of the program you were actually given. A single-policy audit can almost never support "absent" for a standalone line: one document cannot rule out a policy it would never have mentioned. A full program submission supports it far more often, because the absence of a layer across every policy in a complete set is itself evidence.

The test is what the documents show, NOT how cautious you feel, and not a quota: some audits genuinely produce no "absent" at all, and a report of five not_supplied lines and no absent is a correct report if that is what the evidence supports.

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
      // Capped at three and joined here rather than trusting the instruction:
      // the table has to fit on one screen, and a model returning a fourth
      // figure or a sentence would quietly break that.
      const limits = Array.isArray(supplied?.key_limits)
        ? supplied.key_limits.filter((x) => typeof x === "string" && x.trim()).slice(0, 3).map((x) => x.trim())
        : typeof supplied?.key_limits === "string" && supplied.key_limits.trim() ? [supplied.key_limits.trim()] : [];
      row.key_limits = limits.length ? limits.join(" · ") : null;
      // Every figure the analysis gave, uncapped. The table shows the first
      // three; Level 2 shows them all when a policy is expanded.
      row.key_limits_all = Array.isArray(supplied?.key_limits)
        ? supplied.key_limits.filter((x) => typeof x === "string" && x.trim()).map((x) => x.trim())
        : limits;
      const ded = typeof supplied?.deductibles === "string" ? supplied.deductibles.trim() : null;
      row.deductibles = ded && ded.length <= 40 ? ded : (ded ? ded.slice(0, 40) + "…" : null);
    }

    // Order matters: resolve contradicted "present" states first, then let the
    // absent constraint judge the result along with everything else.
    const declined = resolveDeclinedElections(
      Array.isArray(model.coverage_position) ? model.coverage_position : []
    );
    if (declined.flipped.length) {
      console.log(`[program-report] present -> absent, note showed a declined election, for ${declined.flipped.length} line(s): ${declined.flipped.join("; ")}`);
    }
    const constrained = constrainAbsent(declined.position, policyTable);
    if (constrained.upgraded.length) {
      console.log(`[program-report] not_supplied -> absent, declined election on a host policy in this audit, for ${constrained.upgraded.length} line(s): ${constrained.upgraded.join("; ")}`);
    }
    if (constrained.downgraded.length) {
      console.log(`[program-report] downgraded absent -> not_supplied for ${constrained.downgraded.length} line(s): ${constrained.downgraded.join("; ")}`);
    }

    const result = {
      level: 1,
      generated_for_date: todayStr,
      policy_table: policyTable,
      // Built after the limits are merged in, so the tower shows what each
      // layer actually carries.
      limit_adequacy: limitAdequacy(policyTable, crossChecks),
      program_findings: {
        computed,
        synthesis: Array.isArray(model.program_synthesis) ? model.program_synthesis : [],
      },
      // Constrained in code, not only asked for in the prompt: an "absent" a
      // single supplied policy cannot support is downgraded before it is
      // stored, so it can never reach the client document.
      coverage_position: constrained.position,
      // Client-facing, and the only recommendations the client document may
      // show. Kept in Level 1 because the client PDF renders from this row and
      // makes no call of its own -- so anything it prints has to originate here.
      client_recommendations: Array.isArray(model.client_recommendations) ? model.client_recommendations.filter((r) => typeof r === "string" && r.trim()) : [],
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
