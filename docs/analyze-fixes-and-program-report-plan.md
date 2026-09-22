# Plan — analysis integrity fixes, then the program-level report

Two branches, in order. Branch 1 makes a single-policy analysis honest about what
one document can support. Branch 2 adds the pass that reads a whole audit together.

Client names are deliberately absent from this file; it is committed. The test
fixture is referred to as "the five-policy client".

---

## Context

Each policy is analysed alone, one `/api/analyze` call per uploaded file. The prompt
nevertheless asks each call to reason about things a single document cannot answer:

- `src/App.jsx:109` — "Coverage lines **NOT currently in place** that this business clearly needs"
- `src/App.jsx:141` — `new_lines_to_write: "coverage lines ... that aren't currently in place"`
- `src/App.jsx:102` — "Coverage overlaps **between policies**"

One document cannot distinguish *absent* from *not supplied*, so a one-policy audit
reports the client has no auto and no umbrella when it simply never saw them. A report
that asserts a coverage line is missing when it exists is worse than no report.

The same failure mode was solved once already in the Phase 2 extraction work
(`scripts/extract/`): facts assembled deterministically in code, judgement confined to
one deliberate pass, and *never* collapsing "the document didn't say" into "it isn't
there". Branch 2 reuses that shape.

---

## Three blockers found while scoping — decide before building

### 1. `auto` and `auto_policy` are NOT duplicates. Do not merge them.

`src/App.jsx:25` — `{ id: 'auto', label: 'Auto-Detect (AI will identify)' }`
`src/App.jsx:33` — `{ id: 'auto_policy', label: 'Commercial Auto' }`

`auto` is the "let the AI identify this" sentinel. `auto_policy` is the line of business.
They share a prefix and nothing else. The production data proves it — for rows where the
analysis succeeded and recorded a detected type:

| Stored `policy_type` | AI detected | Rows |
|---|---|---|
| `auto` | **GL** | 2 |
| `auto` | **Cyber** | 1 |
| `auto` | (ERROR, none) | 10 |
| `auto` | (UNKNOWN, none) | 1 |
| `auto_policy` | Commercial Auto | 1 |
| `auto_policy` | (ERROR, none) | 2 |

Merging `auto` into `auto_policy` would relabel a GL policy and a Cyber policy as
Commercial Auto, and would assert a line of business for 11 rows that were never
successfully read.

**Proposed instead:** rename the sentinel `auto` → `detect`, leave `auto_policy` alone.
Same goal — no more confusable pair — without inventing facts. Optionally backfill the
three successfully-detected rows from `ai_raw_output->>'policy_type'` as a separate,
reviewable step.

### 2. No audit in the system holds more than one policy

Every audit has `file_count = 1` and exactly one `audit_policies` row. The five policies
for the five-policy client sit in **five separate audits**, not one audit with five files.

Branch 2 reads "every policy in an audit", so its test fixture does not exist yet. Options:

- **(a)** Re-upload the five policies as a single audit. Cleanest; matches the intended
  model; the multi-file path in `runAudit` already supports it but has never been exercised.
- **(b)** Make the program report span audits grouped by client. Rejected unless asked —
  `client_name` is free text and already inconsistent (one row differs from another by
  case and a trailing space), so grouping on it would silently split or merge households.

### 3. Most existing policies are ERROR and cannot seed anything

Of 26 policy rows, 14 are `ERROR` or `PENDING` — collateral from the revoked key and the
retired model. They must be re-run before either branch can be judged against real output.
That now works, post-merge.

---

## Branch 1 — `analyze-fixes`

### 1.1 Prompt: three-state wording

In `ANALYSIS_PROMPT` (`src/App.jsx`):

- Replace "coverage lines NOT currently in place" with wording scoped to the document:
  absence is recorded as **not evidenced in this document**, explicitly *not* evidence the
  client lacks the line.
- Rename `new_lines_to_write` → `lines_not_evidenced_here`.
- Remove the cross-policy overlap instruction (line 102) — it belongs to Branch 2 and is
  unanswerable from one file.
- State plainly: this analysis sees exactly one document and must never assert what the
  client does or does not own overall.

No schema change. `ai_raw_output` is `jsonb`, so the renamed key needs no migration; the
report UI reads the old key and must read both during transition.

### 1.2 A real `FAILED` status carrying the error

Today a failed analysis is written as `ai_status: 'ERROR'` with the message buried in
`ai_raw_output.error` (`src/App.jsx:522`, `:654`), and `UNKNOWN` is used for "not an
insurance policy" — a genuine verdict. Those are different things and must not share a bucket.

- Introduce `FAILED` for "the analysis did not complete", storing the reason
  (`upstream_status`, message) in a dedicated column or a stable `ai_raw_output.failure` key.
- Keep `UNKNOWN` for the real finding "this document is not an insurance policy".
- Migration: existing `ERROR` rows → `FAILED`. **Flag before running.**

### 1.3 Validate / Finalize gated on every policy succeeding

`validateAudit` (`src/App.jsx:558`) currently only requires every *finding* to be reviewed.
A `FAILED` policy can be validated into a delivered report, and `calcRisk`
(`src/App.jsx`) already folds failures into the audit's overall risk — so a report can
assert a coverage position derived from a policy nobody analysed. This is the most
serious item in Branch 1.

- Disable Validate/Finalize unless every policy in the audit is a success state.
- Exclude non-success policies from `calcRisk` rather than letting them read as LOW.
- Show which policies block finalisation and offer a re-run.

### 1.4 The UI must never show "Not a Commercial Policy" for a failed run

Every failure — 401, 403, 413, 502, 504, unparseable JSON — currently renders the same
verdict-shaped message. That single string concealed a revoked API key, a retired model
and two function timeouts across four debugging rounds.

A failed analysis reads as **"Analysis failed: <reason>"** with a re-run action, visually
distinct from any verdict about the document.

### 1.5 `policy_type` normalisation

Per blocker 1 — pending decision. Whatever is chosen, `POLICY_TYPE_IDS` in
`api/client/portal.js:47` must be updated in the same change or client uploads break.

### Verification

Re-run the five-policy client's GL policy on preview. Confirm: no "not in place" claims,
`lines_not_evidenced_here` present, a forced failure shows "Analysis failed" and blocks
Finalize.

---

## Branch 2 — `program-report`

### 2.1 Shape

A second pass, after the per-policy loop, reading the **extracted JSON** of every policy in
the audit — not the PDFs. Small input, fast, no timeout exposure, works for commercial and
personal lines alike.

### 2.2 Four states, not three

Per policy line, the report distinguishes:

| State | Meaning |
|---|---|
| `present` | a policy in this audit covers the line |
| `absent` | no policy covers it, and every policy was read successfully |
| `not_supplied` | no document for this line was uploaded |
| `failed_unread` | a document exists but its analysis failed |

`absent` may only be asserted when every policy in the audit succeeded. If any policy is
`failed_unread`, the pass refuses to run and names the unread policies. This is the same
rule as the extraction work's document-class guard, and the reason it exists: a gap report
that names a coverage the client actually holds destroys trust in the whole report.

### 2.3 Cross-checks supplied by the server, not invented by the model

Assembled in code from the per-policy JSON, then handed to the pass:

- umbrella/excess underlying requirements vs the actual underlying limits
- named insureds consistent across policies
- policy terms consistent (effective/expiration alignment)
- scheduled vehicles and locations appear on an underlying policy

The model reasons about these; it does not decide what to compare. **No premium figures and
no savings estimates** — the existing prompt's `estimated_premium_impact` is not carried into
this pass.

### 2.4 Storage and trigger

New table `audit_program_analysis`, keyed by `audit_id`, so the pass re-runs without
touching per-policy rows. **Flag migration before running.** Admin button "Generate program
report", enabled only when every policy in the audit is a success state.

### 2.5 Output shape — three levels

The per-policy analyses are **inputs, not the product**. The product is one layered
document per audit.

**Level 1 — Program Summary.** Top of the audit page, always visible. Stored in
`audit_program_analysis.result`.

- **Policy table** — one row per policy: line, carrier, policy number, key limits and
  deductibles, term status (in force / expired on date / renews on date), AI verdict,
  premium as shown on the document. *Facts from extraction only.* Everything except
  limits and deductibles is computed in code from stored fields, not asked of the model.
- **Program findings** — what no single policy can show. **Computed cross-checks first**
  (assembled in code): expired layers sitting under in-force ones; excess/umbrella
  underlying requirements against the actual limits on uploaded policies; underlying
  policies named on an umbrella but not supplied; coverage one policy says is missing
  that another provides; named-insured and address mismatches. **Then** the model's
  synthesis of the per-policy findings into 5–8 program-level points.
- **Coverage position** — every line of business in one of four states: `present`
  (naming the policy), `absent` (only when a supplied document affirmatively shows it is
  not carried), `not_supplied` ("confirm with client"), `unread` (failed analysis —
  blocks the report, listed by file name).
- **Agent notes** — one lead hook, one primary opportunity, talking points, urgency,
  written on the whole program rather than per policy. **Internal only.**

**Level 2 — Per-policy detail.** Collapsed by default. Content unchanged from today's
per-policy view, one expandable section per policy.

**Level 3 — Client PDF.** Generated only from a validated/finalized audit, rendered from
Level 1 with agent notes stripped. **No AI call** — it is a rendering, not a new
analysis, which is what makes the last rule below enforceable. Sections: cover with
client name and date; coverage summary table; what is in place; coverage gaps and items
not provided; recommendations in plain language; a note that findings are based on the
documents provided. Agency branding. Never premium estimates, never internal notes.

### 2.6 Rules

- The analysis never states a saving or a premium estimate. Only the premium printed on a
  document.
- **"AI" means artificial intelligence only.** Write **"additional insured"** in full
  everywhere — in an insurance report the abbreviation is genuinely ambiguous, and this
  tool's whole subject is artificial-intelligence coverage.
- Every gap carries one of the four states. None may be stated without one.
- The client PDF cannot contain anything not visible in Level 1.

### Build order

(a) Program report generating on the five-policy audit, Level 1 shown.
(b) Collapse per-policy detail into Level 2.
(c) Client PDF.

### Verification

All five policies of the five-policy client, as one audit (per blocker 2). Confirm the
report names real cross-policy gaps, and that forcing one policy to fail makes the pass
refuse and name it rather than reporting that line absent.

---

---

## Branch 3 — server-side PDF reads, after the program report ships

### Why

A 9.89MB Auto Physical Damage policy failed with "Document too large to
analyse". The limit it hit is **bytes**, not pages or tokens, and it is not ours
to raise:

| Limit | Value | Effect |
|---|---|---|
| `MAX_BODY_BYTES` in `api/analyze.js` | 4MB | would reject it |
| **Vercel request body** | **4.5MB** | **platform cap, rejects before our function runs** |
| Anthropic request | 32MB | would have accepted the file |

The PDF is base64-encoded into the request body, which adds ~33%, so the
practical ceiling today is about a **3MB PDF** — against an Anthropic limit of
32MB. The document is not too large to analyse; it is too large to *post*.

### What changes

1. **The server reads the PDF from Supabase storage** rather than receiving it
   in the request body. `api/analyze.js` takes a `storage_path`, fetches the
   object with the service role key, and forwards it to Anthropic. The file
   never crosses the request boundary, so the 4.5MB cap stops applying and the
   real ceiling becomes Anthropic's 32MB.

2. **Admin uploads must save to storage first.** This is the part that is
   larger than it sounds: `storage_path` is null on every admin-uploaded row,
   because `runAudit` streams the file straight to the API and never stores it.
   Only client-portal uploads persist. Until that changes, a failed admin upload
   cannot be re-run at all — the document is simply gone, which is why ten of
   the twelve FAILED rows found earlier were unrecoverable.

Both halves are needed for either to be worth much: server-side reads without
stored files only helps portal uploads, and stored files without server-side
reads still hit the 4.5MB cap.

### Watch for

- `api/client/portal.js` already accepts 25MB uploads, so storage already holds
  files this path cannot currently analyse. That mismatch closes here.
- Deleting an `audit_policies` row will start orphaning a storage object; today
  it cannot, because nothing is stored.
- The 120s → 300s function duration matters more once larger documents actually
  reach the model.

---

## Migrations requiring sign-off

1. `ERROR` → `FAILED` on `audit_policies.ai_status` (Branch 1)
2. `policy_type` sentinel rename, pending blocker 1 (Branch 1)
3. `create table audit_program_analysis` (Branch 2)

None will be run without being shown first.
