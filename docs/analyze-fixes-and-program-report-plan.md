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

### Verification

All five policies of the five-policy client, as one audit (per blocker 2). Confirm the
report names real cross-policy gaps, and that forcing one policy to fail makes the pass
refuse and name it rather than reporting that line absent.

---

## Migrations requiring sign-off

1. `ERROR` → `FAILED` on `audit_policies.ai_status` (Branch 1)
2. `policy_type` sentinel rename, pending blocker 1 (Branch 1)
3. `create table audit_program_analysis` (Branch 2)

None will be run without being shown first.
