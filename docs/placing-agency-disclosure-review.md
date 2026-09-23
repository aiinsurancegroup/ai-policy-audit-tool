# Placing-agency disclosure — decision list

**Status: awaiting the operator's wording. Nothing below has been changed.**

Business is currently placed through Alexander Capital on Sal Martorano's
personal producer licence. The AI Insurance Group's own appointments are
expected around early October 2026. Commit `1a22a2f` removed the only
disclosure that said so, on the mistaken belief it was stale.

"Alexander Capital" now appears **nowhere** in the codebase. Every identity
assertion names The AI Insurance Group.

Mark each row with what it should say. Do not apply one global replacement —
the right answer differs by row, and three of these are regulated text.

---

## 1. Code that offers to quote — reaches the client PDF, not model-generated

This is the only place a placement offer is emitted by **code**, so no prompt
edit fixes it.

| Where | Current text |
|---|---|
| `api/admin/program-report.js:303` | `` `${kept} — tell us whether you hold a standalone policy for this, or we can quote it.` `` |

Appended to every downgraded coverage line and rendered in the client PDF's
"Not provided for review" section (`src/App.jsx:597`). On the Shamrock report
that is five lines, each ending in an offer to quote.

**Decision:** does "we can quote it" stay, change to name the placing agency, or
become something that offers only the conversation?

---

## 2. Prompt text asserting we are the broker — highest leverage

I wrote both of these earlier in this session, and they are now factually wrong.

| Where | Current text (abridged) |
|---|---|
| `api/admin/program-report.js:592` | "this report is written BY the client's broker and agency … **we are the broker, the agent and the agency** … Write in the first person plural about what WE will do — 'We recommend…', **'We'll place…'**" |
| `api/admin/program-report.js:604` | "Written in OUR voice as their broker … because **we ARE their broker** and there is nobody else to ask." |
| `api/admin/program-report.js:623` | "…tell us whether you hold a standalone policy, **or we can quote it**." |

These drive `client_recommendations` and `coverage_position.note`, both of which
render in the client PDF. `"We'll place…"` is given to the model as a worked
example of desired output.

**Decision:** whose voice is the report written in, now that review and
placement may be different entities?

---

## 3. Agency name paired with a personal producer licence

| Where | Current text |
|---|---|
| `src/App.jsx:628` | `{BRAND.wordmark} · {BRAND.licence}` → "The AI Insurance Group · NJ Insurance Producer License No. 3004245927" |
| `api/client/portal.js:309` | Same pairing in the re-issue email |
| `src/App.jsx:355` | `licence: 'NJ Insurance Producer License No. 3004245927'` |

Repeats on **every printed page** of the client PDF by design — there is print
CSS specifically to make it do so.

**Decision:** a personal producer licence attributed beside an agency wordmark
is the core mismatch. Should the line name the producer, the agency, both, or
the placing agency?

---

## 4. Consent text — duplicated, must change in lockstep

| Where | Note |
|---|---|
| `api/client/portal.js:82` | `CONSENT_TEXT` — the authoritative copy, stored as the signed statement |
| `src/App.jsx:61` | **A second identical copy** used by the admin manual-entry path, written to `client_consents.consent_text` |

Current: *"I authorize The AI Insurance Group to review and analyze the
commercial insurance policy documents provided herein…"*

Two problems beyond the agency name:
- Changing one file and not the other makes stored consent diverge from
  displayed consent. `portal.js:78-81` documents an invariant that they are
  provably identical — that guarantee only holds for the portal path.
- The wording is scoped to *"AI-related coverage gaps"*, which no longer
  describes what the tool does. A full program review is broader than the
  authorisation the client actually signed.

**Decision:** who is authorised, to do what. This is the most regulated string
in the codebase.

---

## 5. The existing disclaimer contradicts itself

| Where | Current text |
|---|---|
| `api/send-email.js:143-145` | "© 2026 The AI Insurance Group. All rights reserved.<br>Insurance products placed through licensed insurance brokers.<br>The AI Insurance Group is a marketing and informational platform." |

Line 144 gestures at third-party placement without naming who. Line 145 then
characterises the entity as a marketing platform, which sits oddly beside a
producer licence printed on the client PDF.

This is the **only** entity-level disclaimer anywhere. It is absent from the
client PDF footer, both portal screens, and the re-issue email.

**Decision:** what the standing disclaimer says, and which surfaces carry it.

---

## 6. Service assertions in client-facing copy

| Where | Current text |
|---|---|
| `src/App.jsx:778` | "The AI Insurance Group will review your policies for AI-related coverage gaps and contact you with the results." |
| `src/App.jsx:2208` | "Questions about this report? Contact The AI Insurance Group — sal@… · 917-981-0245." |
| `api/send-email.js:130` | "A specialist from our team will also reach out within 24 hours…" |
| `api/send-email.js:121` | "Our AI will scan every page… with a validated report ready for your next renewal." |
| `src/App.jsx:771` | "This audit link is invalid or has expired. Please contact The AI Insurance Group." |

**Decision:** these assert the agency performs the review. If the *review* is
The AI Insurance Group's own service and only *placement* runs through
Alexander Capital, most may be fine as they stand — but that is your call, not
mine to assume.

---

## 7. Website plan — same decisions, not yet built

Nothing here exists yet; these are sections of the approved plan that will need
the wording before they are written.

| Plan section | What it asserts |
|---|---|
| Homepage §5, Trust and licensing | "licensed property and casualty insurance agency … writing in NJ, PA and FL" + licence number |
| How It Works, Licensing block | Licensed states, licence number, named producer |
| `/review/auto` and `/review/homeowners` footers | "Licensed in New Jersey, Pennsylvania and Florida · NJ Producer License No. 3004245927" |
| Homepage §2 | "We're a licensed independent agency" |
| Homepage §4 | "we don't move your coverage without your say-so" — implies placement |
| Business page | "or we can quote it" / "let us quote it" |
| `/licensing` page | Does not exist yet; may be where the full disclosure belongs |

**Decision:** the website is the surface where this matters most, because it is
the one strangers read before there is any relationship. Worth settling before
Phase 5 builds the landing pages.

---

## Also found, unrelated but adjacent

**There is no TCPA consent anywhere in the audit tool**, yet
`api/send-email.js:130` promises outbound contact within 24 hours, and the
portal collects no phone number at all. The website plan adds TCPA consent at
Step 1; the existing tool has none. Worth knowing before the first ad click,
since the website and the tool will share a database.
