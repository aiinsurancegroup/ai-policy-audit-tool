# Backlog

Things deliberately deferred, with enough context to pick them up cold. Dated
when added. Delete an entry when it ships — this file is only useful if it is
true.

---

## Expired-token portal UI
**Added 2026-09-23 · Not urgent until 22 Dec 2026**

`api/client/portal.js` now returns `410 { error, expired: true, message }` for a
token past `client_token_expires_at`, and accepts `{ action: "request_new_link",
email }` which always answers with the same uniform message.

The client-facing portal page does not yet render either. Today an expired link
shows whatever the page does with an unrecognised error.

Needed:
- An expired state on the portal screen that shows the 410 `message` rather than
  a generic failure.
- An email field posting `request_new_link`, displaying the uniform response
  verbatim whatever comes back. It must not distinguish success from "no such
  address" in wording, timing or layout — that is the whole point of the uniform
  response and it is easy to undo accidentally in the UI.

**Deadline is real:** nothing expires until 2026-12-22, because migration 08
backfilled every existing token to 90 days from the day it ran. On that date
fifteen links expire at once, six of them still open.

**Depends on:** `RESEND_API_KEY` being set on the audit tool's Vercel project.
`sendLinkEmail` in `portal.js` logs and returns silently when it is missing —
deliberately, so a missing key cannot change the response shape and give the
oracle away. That means a misconfiguration here is invisible from the outside.
Check it before relying on re-issue.

---

## Supabase project-wide upload limit
**Added 2026-09-23 · Operator to check**

The `policies` bucket sets no `file_size_limit` of its own, so it inherits the
project-wide upload limit, which is a dashboard setting. `MAX_FILE_BYTES` is
25 MB in both `api/client/portal.js` and `api/admin/audit.js`, and
`MAX_PDF_BYTES` matches in `src/App.jsx`.

Raising the client-facing limit means raising the project setting first, then
all three constants together. The Files API path in `api/analyze.js` already
handles anything up to 500 MB, so the pipeline is not the constraint.

---

## Files API path is unexercised
**Added 2026-09-23 · No action, just unproven**

`api/analyze.js` sends documents over 20 MB to Anthropic's Files API rather than
inlining them as base64, deletes the uploaded file in a `finally` block, and
sets a one-hour expiry as a backstop. Every test covers it, but no real document
has ever taken that branch — everything analysed so far is under 20 MB.

The first genuinely large policy is also the first live test of that code.
Watch the logs for `[analyze] files-api upload` and a matching delete.

---

## `idx_audits_token` is redundant
**Added 2026-09-23 · Trivial**

`audits` carries both `audits_client_token_key` (UNIQUE) and `idx_audits_token`
(plain) on the same column. The plain one is redundant. Not bundled into a
security migration; drop it whenever something else touches that table.
