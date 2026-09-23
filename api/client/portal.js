// Vercel serverless function for the audit tool's PUBLIC client portal.
//
// Mirrors api/admin/audit.js — service role key on the server, never in the
// browser bundle — with one critical difference: this endpoint is reachable by
// anyone, so it is NOT gated by a shared password. Authorization is per-request
// and derived entirely from the client_token in the body. Every route resolves
// that token to exactly one audits row and operates only on that row. The
// caller never names a table, a column, an id, or a storage path.
//
// Why this exists: the portal previously talked to Supabase straight from the
// browser with the anon key (src/App.jsx ClientPortal). That gave the client
// write access to every column of its own audit row (status, overall_risk,
// validated_by, deleted_at, ...), let it stamp its own consent_timestamp from
// the browser clock, let it choose its own storage path, and let it insert
// arbitrary activity_log rows. All of that is now decided server-side.
//
// Required Vercel environment variables (both already set for api/admin/audit.js):
//   SUPABASE_SERVICE_ROLE_KEY   - secret; never reaches the browser
//   VITE_SUPABASE_URL           - reused
//
// Routes (all POST, body { action, token, ... }):
//   { action: "lookup", token }
//       -> { client_name, client_submitted_at, consent_statement }
//   { action: "upload_url", token, file_name, file_size_bytes }
//       -> { path, upload_token, signed_url } for one PDF
//   { action: "submit", token, signer_name, signer_title?, files: [...] }
//       -> { ok: true, submitted_at }
//
// The token is a bearer credential that lives in a URL, so failure responses are
// deliberately uniform: an invalid token and a valid token on an already-
// submitted audit are not distinguishable from the outside.

import crypto from "node:crypto";

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || "https://dtgsegabaivtgyccrcxi.supabase.co";
const BUCKET = "policies";

// Two generations of token are live at once. New ones are 64 hex characters
// from crypto.randomBytes(32); the 15 issued before migration 08 are 27 chars
// of [a-z0-9] from Math.random, kept working because invalidating them would
// mean a client clicking a dead link with no explanation. They now carry a
// 90-day expiry and age out on their own. The loose range accepts both, and
// exists to reject junk before it reaches the database.
const TOKEN_RE = /^[a-z0-9]{16,64}$/;

// Where a re-issued link points. Matches api/send-email.js rather than being
// derived from the request, so a forged Host header cannot redirect a client's
// upload link to somewhere else.
const PORTAL_ORIGIN = "https://audit.theaiinsurancegroup.com";
const TOKEN_TTL_DAYS = 90;

const MAX_FILES = 20;
// 25MB. This was the ceiling back when a document had to be base64-encoded into
// an analysis request, and it was generous then only because nothing near it
// could actually be analysed -- anything over ~3MB failed later, after the
// client had been told the upload succeeded. The server now reads documents
// from storage and sends anything large via the Files API, whose limit is
// 500MB, so this number is no longer a promise the pipeline cannot keep.
//
// It stays at 25MB because the bucket has no file_size_limit of its own and so
// inherits the project-wide upload limit, which is a Supabase dashboard setting
// and not ours to raise from here. Raising it means raising that first, then
// this and MAX_FILE_BYTES in api/admin/audit.js together.
const MAX_FILE_BYTES = 25 * 1024 * 1024; // 25MB
const MAX_SIGNER_NAME = 200;
const MAX_SIGNER_TITLE = 100;

// Valid policy_type ids. Must stay in sync with POLICY_TYPES in src/App.jsx.
// "detect" is the auto-identify sentinel; "auto_policy" is Commercial Auto.
// "auto" was the sentinel's old id and stays accepted so links already in a
// client's inbox keep working -- it is NOT an automobile policy.
const POLICY_TYPE_IDS = new Set([
  "detect", "auto", "gl", "eo", "do", "cyber", "epli",
  "products", "wc", "auto_policy", "excess_auto", "auto_physical_damage",
  "property", "umbrella",
]);

// The authoritative consent text. Recorded on submit regardless of what the
// client sends, so the signed statement cannot be forged. `lookup` returns this
// same constant for display, which keeps the text the client SEES and the text
// we STORE provably identical.
const CONSENT_TEXT = 'I authorize The AI Insurance Group to review and analyze the commercial insurance policy documents provided herein for the purpose of identifying AI-related coverage gaps, exclusions, and endorsements. I understand that this analysis is for informational purposes only and does not constitute a coverage determination, legal advice, or binding coverage opinion. Final coverage interpretations should be confirmed with the issuing carrier(s). I confirm that I am authorized to share these policy documents for review purposes.';

// Best-effort brute-force damper, per warm serverless instance. Vercel runs many
// instances, so this is a speed bump, NOT a rate limit — real protection needs
// the Vercel WAF or a shared KV store. It mattered most while tokens came from
// Math.random and were guessable in principle; new tokens are 32 crypto bytes,
// so it now guards the legacy tokens still in circulation and the re-issue
// endpoint below, which sends email and would otherwise be a spam relay.
const RATE_WINDOW_MS = 60_000;
const RATE_MAX = 30;
const rateBuckets = new Map();

function rateLimited(ip) {
  const now = Date.now();
  const hits = (rateBuckets.get(ip) || []).filter((t) => now - t < RATE_WINDOW_MS);
  hits.push(now);
  rateBuckets.set(ip, hits);
  if (rateBuckets.size > 5000) rateBuckets.clear(); // crude memory bound
  return hits.length > RATE_MAX;
}

function clientIp(req) {
  const fwd = req.headers["x-forwarded-for"];
  if (typeof fwd === "string" && fwd.length) return fwd.split(",")[0].trim();
  return req.socket?.remoteAddress || "unknown";
}

// Collapse whitespace and cap length. Applied to every free-text field the
// client supplies before it is stored.
function cleanText(v, max) {
  if (typeof v !== "string") return "";
  return v.replace(/\s+/g, " ").trim().slice(0, max);
}

// Strip anything that could escape the audit-id folder or confuse storage.
// The server builds the final path; this only sanitizes the display filename.
function safeFileName(name) {
  const base = String(name || "").split(/[\\/]/).pop() || "policy.pdf";
  const cleaned = base.replace(/[^A-Za-z0-9._-]/g, "_").replace(/^\.+/, "").slice(0, 120);
  return cleaned || "policy.pdf";
}

function randomSegment() {
  // Not security-sensitive: only needs to avoid collisions within one folder.
  return Math.random().toString(36).slice(2, 11);
}

function sbHeaders(serviceKey, extra) {
  return {
    apikey: serviceKey,
    Authorization: "Bearer " + serviceKey,
    "Content-Type": "application/json",
    ...(extra || {}),
  };
}

// --- Upstream request handling -------------------------------------------
//
// Supabase's REST gateway fails transiently: observed 500, 502, and 401 with
// sb-error-code INTERNAL_ERROR on identical requests seconds apart, with
// PostgREST logging "Warp server error: Thread killed by timeout manager".
// Treating those as "no such token" would tell a client with a perfectly good
// link that it is invalid, so transient failures are separated from a genuine
// no-match and surfaced as "temporarily unavailable" instead.
//
// Per-attempt timeouts and the total budget keep the worst case (~19s) inside
// the function's execution limit; a healthy lookup returns on the first try.

const SB_ATTEMPT_TIMEOUT_MS = 6000;
const SB_TOTAL_BUDGET_MS = 20000;
const SB_BACKOFF_MS = [250, 600];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// A failure we expect to succeed on a retry, as opposed to one that says
// something real about the request.
function isTransient(status, headers, text) {
  if (status >= 500) return true;
  if (status === 429) return true;
  // The gateway reports its own internal faults as 401. A genuine credential
  // problem is also a 401, so the error code is what separates them: without
  // it, a bad service key would be retried pointlessly and then reported as a
  // temporary outage.
  if (status === 401) {
    const code = headers?.get?.("sb-error-code") || "";
    return code === "INTERNAL_ERROR" || text.includes("INTERNAL_ERROR");
  }
  return false;
}

// Returns { ok: true, text } | { ok: false, transient, status }.
//
// `retries` defaults to 0. Only idempotent calls opt in: retrying a write
// whose response was merely lost would double-insert, and retrying the
// guarded consent PATCH would report a successful submission as a conflict.
async function sbRequest(url, init, serviceKey, retries = 0) {
  const started = Date.now();
  const method = init?.method || "GET";

  // Without this, a caller that forgets the serviceKey argument stringifies it
  // into the header as the literal "undefined", and Supabase answers 401
  // "Invalid API key" -- which reads as a credential problem rather than the
  // caller-side mistake it actually is. Fail loudly and locally instead.
  if (!serviceKey) {
    console.error(`sbRequest: no service key supplied for ${method} ${url}`);
    return { ok: false, transient: false, status: 0 };
  }

  let last = { ok: false, transient: true, status: 0 };

  for (let attempt = 0; attempt <= retries; attempt++) {
    if (attempt > 0) {
      const delay = SB_BACKOFF_MS[attempt - 1] ?? SB_BACKOFF_MS[SB_BACKOFF_MS.length - 1];
      // Don't start an attempt that cannot finish inside the budget.
      if (Date.now() - started + delay + SB_ATTEMPT_TIMEOUT_MS > SB_TOTAL_BUDGET_MS) break;
      await sleep(delay);
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), SB_ATTEMPT_TIMEOUT_MS);
    try {
      const r = await fetch(url, {
        ...init,
        headers: sbHeaders(serviceKey, init?.headers),
        signal: controller.signal,
      });
      const text = await r.text();
      if (r.ok) return { ok: true, status: r.status, text };

      const transient = isTransient(r.status, r.headers, text);
      last = { ok: false, transient, status: r.status };
      console.error(
        `supabase ${method} ${r.status}${transient ? " (transient)" : ""}: ${text.slice(0, 200)}`
      );
      if (!transient) return last; // a real error: retrying will not help
    } catch (e) {
      // Aborted attempt or network-level failure: always worth another try.
      last = { ok: false, transient: true, status: 0 };
      console.error(
        `supabase ${method} failed:`,
        e?.name === "AbortError" ? `timeout after ${SB_ATTEMPT_TIMEOUT_MS}ms` : String(e)
      );
    } finally {
      clearTimeout(timer);
    }
  }
  return last;
}

// Resolve a client_token to its audit row. This is the ONLY place a token is
// exchanged for an identity; every route goes through it.
//
// Returns { audit } | { error: "not_found" | "unavailable" | "upstream" }.
// The caller must keep "not_found" indistinguishable from a malformed token,
// but "unavailable" is a different thing entirely and must not be reported as
// a bad link.
// Mint a fresh token for an open audit belonging to this address and email it.
// Returns nothing the caller can observe -- see the uniform response at the
// call site. Only ever touches an audit that has not been submitted: once a
// client has sent their documents, the portal is closed and a new link would
// reopen a signed consent record.
async function reissueLink(email, serviceKey) {
  const url =
    `${SUPABASE_URL}/rest/v1/audits` +
    `?client_email=eq.${encodeURIComponent(email)}` +
    `&deleted_at=is.null` +
    `&client_submitted_at=is.null` +
    `&client_token=not.is.null` +
    `&select=id,client_name,client_email` +
    `&order=created_at.desc&limit=1`;

  const found = await sbRequest(url, { method: "GET" }, serviceKey, 2);
  if (!found.ok) return;
  let rows = null;
  try { rows = JSON.parse(found.text); } catch { return; }
  const audit = Array.isArray(rows) ? rows[0] : null;
  if (!audit?.id) return;

  const token = crypto.randomBytes(32).toString("hex");
  const now = new Date();
  const expires = new Date(now.getTime() + TOKEN_TTL_DAYS * 86400000);

  // Replacing the token invalidates the old link, which is the point: if the
  // first one leaked, re-issuing closes it.
  const upd = await sbRequest(
    `${SUPABASE_URL}/rest/v1/audits?id=eq.${audit.id}`,
    {
      method: "PATCH",
      body: JSON.stringify({
        client_token: token,
        client_token_issued_at: now.toISOString(),
        client_token_expires_at: expires.toISOString(),
      }),
    },
    serviceKey,
    2
  );
  if (!upd.ok) return;

  await logActivity(serviceKey, audit.id, "CLIENT_LINK_REISSUED", { to: audit.client_email }, "client");
  await sendLinkEmail(audit, token);
}

// Minimal Resend send. Deliberately not a call to api/send-email.js: that
// endpoint creates an audit and mints its own token, which is the opposite of
// what is wanted here, and it allows any origin.
async function sendLinkEmail(audit, token) {
  const key = process.env.RESEND_API_KEY;
  if (!key) {
    console.error("[portal] reissue: RESEND_API_KEY not set, link not sent");
    return;
  }
  const link = `${PORTAL_ORIGIN}?token=${token}`;
  const name = audit.client_name || "there";
  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      from: "The AI Insurance Group <sal@theaiinsurancegroup.com>",
      to: [audit.client_email],
      reply_to: "sal@theaiinsurancegroup.com",
      subject: "Your new secure upload link",
      html:
        `<p>Hi ${escapeHtml(name)},</p>` +
        `<p>Here is a new link to send us your policy documents. It replaces the previous one, which has expired.</p>` +
        `<p><a href="${link}">Open your secure upload page</a></p>` +
        `<p>This link is active for ${TOKEN_TTL_DAYS} days and is specific to you &mdash; please don't forward it.</p>` +
        `<p>&mdash; The AI Insurance Group<br>NJ Insurance Producer License No. 3004245927</p>`,
    }),
  });
  if (!r.ok) console.error(`[portal] reissue email failed: ${r.status}`);
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

async function resolveAudit(token, serviceKey) {
  const url =
    `${SUPABASE_URL}/rest/v1/audits` +
    `?client_token=eq.${encodeURIComponent(token)}` +
    `&deleted_at=is.null` +
    `&select=id,client_name,client_submitted_at,client_email,client_token_expires_at` +
    `&limit=1`;

  const res = await sbRequest(url, { method: "GET" }, serviceKey, 2);
  if (!res.ok) return { error: res.transient ? "unavailable" : "upstream" };

  let rows = null;
  try {
    rows = JSON.parse(res.text);
  } catch {
    console.error("audits lookup returned unparseable body");
    return { error: "unavailable" };
  }
  if (!Array.isArray(rows) || rows.length === 0) return { error: "not_found" };
  return { audit: rows[0] };
}

// Server-side activity logging. Note the column is performed_by — the browser
// code was writing `actor`, which PostgREST rejected, which is why activity_log
// has been empty. Failures here are logged but never fail the caller's request.
async function logActivity(serviceKey, auditId, action, details, performedBy) {
  const res = await sbRequest(
    `${SUPABASE_URL}/rest/v1/activity_log`,
    {
      method: "POST",
      body: JSON.stringify({
        audit_id: auditId,
        action,
        details,
        performed_by: performedBy || "client",
      }),
    },
    serviceKey
  );
  if (!res.ok) console.error("activity_log insert failed:", res.status);
}

const INVALID = { status: 404, body: { error: "Invalid or expired link" } };

// The one place the uniform-failure rule is deliberately relaxed. Everywhere
// else an invalid token and a valid-but-unusable one look identical, so this
// endpoint cannot be used to test whether a token exists. An EXPIRED token is
// different: it was ours, it was valid, and the person holding it is almost
// certainly the client we sent it to. Telling them "this link has expired,
// here is how to get another" costs nothing an attacker can use -- they already
// hold the token -- and saying "invalid link" instead sends a real client away
// with no idea what to do. The distinguishing signal is the expiry date, which
// an attacker who holds the token could observe from its behaviour anyway.
const EXPIRED = {
  status: 410,
  body: {
    error: "This link has expired",
    expired: true,
    message: "Links stay active for 90 days. Request a new one and we'll email it to you.",
  },
};
const UNAVAILABLE = {
  status: 503,
  body: { error: "Service temporarily unavailable. Please try again in a moment." },
};

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceKey) {
    console.error("SUPABASE_SERVICE_ROLE_KEY is not set");
    return res.status(500).json({ error: "Server not configured" });
  }

  const ip = clientIp(req);
  if (rateLimited(ip)) {
    return res.status(429).json({ error: "Too many requests. Please wait and try again." });
  }

  const body = req.body || {};
  const action = body.action;
  const token = typeof body.token === "string" ? body.token.trim() : "";

  // ---- request_new_link ---------------------------------------------------
  // Handled before the token check, because the caller reaching this has an
  // expired token or none at all. Keyed on email rather than token.
  //
  // THE RESPONSE IS IDENTICAL EVERY TIME. Not for tidiness: an endpoint that
  // answers "yes we have a review for that address" differently from "no we
  // don't" is an oracle for testing whether a given person is a client of this
  // agency, and it answers to anyone, at any volume. So the reply below is
  // returned whether the address matched nothing, matched an open audit, or
  // matched one already submitted -- and nothing about the timing, status code
  // or body distinguishes them.
  if (action === "request_new_link") {
    const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
    // Shape-check only. An invalid address gets the same answer as a valid one.
    if (/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) && email.length <= 254) {
      // Failures are swallowed on purpose: a database fault must not turn into
      // a different response and give the oracle away.
      try {
        await reissueLink(email, serviceKey);
      } catch (e) {
        console.error(`[portal] request_new_link failed: ${e.message}`);
      }
    }
    return res.status(200).json({
      ok: true,
      message: "If we have a review open for that address, we've emailed a new link to it.",
    });
  }

  // Cheap shape check before any database work.
  if (!TOKEN_RE.test(token)) {
    return res.status(INVALID.status).json(INVALID.body);
  }

  try {
    const resolved = await resolveAudit(token, serviceKey);
    if (resolved.error === "unavailable") {
      // The link may well be fine -- we could not reach the database to find
      // out. Saying "invalid link" here would send a real client away.
      return res.status(UNAVAILABLE.status).json(UNAVAILABLE.body);
    }
    if (resolved.error === "upstream") {
      return res.status(500).json({ error: "Server error. Please try again." });
    }
    // Genuine no-match: same response as a malformed token, so this endpoint
    // still cannot be used to test whether a given token exists.
    if (resolved.error === "not_found") {
      return res.status(INVALID.status).json(INVALID.body);
    }
    const audit = resolved.audit;

    // Checked before any action, so an expired link cannot upload or submit --
    // not only that it cannot be viewed. A null expiry means the token predates
    // migration 08 and was never backfilled, which should not happen; treated
    // as expired rather than as unlimited, because the failure that leaves a
    // token live forever is the one worth failing safe on.
    const expiresAt = audit.client_token_expires_at ? Date.parse(audit.client_token_expires_at) : 0;
    if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) {
      return res.status(EXPIRED.status).json(EXPIRED.body);
    }

    // ---- lookup -----------------------------------------------------------
    // Returns only what the portal renders, plus the consent text it must
    // display. Deliberately omits id, client_token, client_email, status,
    // overall_risk, notes, validated_by and everything else on the row.
    if (action === "lookup") {
      return res.status(200).json({
        client_name: audit.client_name,
        client_submitted_at: audit.client_submitted_at,
        consent_statement: CONSENT_TEXT,
      });
    }

    // Both remaining routes write. An audit that has already been submitted is
    // closed to further writes; re-submission would overwrite a signed consent
    // record and is refused.
    if (audit.client_submitted_at) {
      return res.status(409).json({ error: "This audit has already been submitted." });
    }

    // ---- upload_url -------------------------------------------------------
    // Issues a short-lived signed URL so the browser uploads straight to
    // storage. The file bytes never pass through this function, which keeps the
    // upload clear of Vercel's ~4.5MB request body limit while leaving the
    // authorization decision here. The server picks the path; the client cannot
    // influence the folder, which is always the audit's own id.
    if (action === "upload_url") {
      const fileName = safeFileName(body.file_name);
      if (!/\.pdf$/i.test(fileName)) {
        return res.status(400).json({ error: "Only PDF files are accepted." });
      }
      const size = Number(body.file_size_bytes);
      if (!Number.isFinite(size) || size <= 0 || size > MAX_FILE_BYTES) {
        return res.status(400).json({ error: "File must be between 1 byte and 25MB." });
      }

      const path = `${audit.id}/${randomSegment()}_${fileName}`;
      // Retried: minting a signed URL creates no persistent state, so a second
      // attempt is harmless if the first is lost to a gateway fault.
      const signRes = await sbRequest(
        `${SUPABASE_URL}/storage/v1/object/upload/sign/${BUCKET}/${path}`,
        { method: "POST", body: JSON.stringify({}) },
        serviceKey,
        2
      );
      if (!signRes.ok) {
        if (signRes.transient) return res.status(UNAVAILABLE.status).json(UNAVAILABLE.body);
        return res.status(502).json({ error: "Could not prepare upload. Please try again." });
      }
      let signed = null;
      try {
        signed = JSON.parse(signRes.text);
      } catch {
        signed = null;
      }
      // Supabase returns { url: "/object/upload/sign/<bucket>/<path>?token=<jwt>" }
      if (!signed?.url) {
        console.error("sign upload returned no url");
        return res.status(502).json({ error: "Could not prepare upload. Please try again." });
      }
      const uploadToken = new URLSearchParams(signed.url.split("?")[1] || "").get("token");

      return res.status(200).json({
        path,
        upload_token: uploadToken,
        signed_url: `${SUPABASE_URL}/storage/v1${signed.url}`,
      });
    }

    // ---- submit -----------------------------------------------------------
    // Records consent on audits (authoritative) and creates the audit_policies
    // rows. Every trust-bearing value is set here, not accepted from the client:
    // both timestamps, the consent statement, the company name, and the two
    // status columns.
    if (action === "submit") {
      const signerName = cleanText(body.signer_name, MAX_SIGNER_NAME);
      if (!signerName) {
        return res.status(400).json({ error: "Signature name is required." });
      }
      const signerTitle = cleanText(body.signer_title, MAX_SIGNER_TITLE);

      const files = Array.isArray(body.files) ? body.files : [];
      if (!files.length) {
        return res.status(400).json({ error: "At least one policy document is required." });
      }
      if (files.length > MAX_FILES) {
        return res.status(400).json({ error: `At most ${MAX_FILES} files per submission.` });
      }

      const prefix = `${audit.id}/`;
      const rows = [];
      for (const f of files) {
        const policyType = typeof f?.policy_type === "string" ? f.policy_type : "";
        if (!POLICY_TYPE_IDS.has(policyType)) {
          return res.status(400).json({ error: "Unrecognized policy type." });
        }
        const storagePath = typeof f?.storage_path === "string" ? f.storage_path : "";
        // The path must be one we issued for THIS audit. Without this check a
        // caller could attach another client's uploaded file to its own audit.
        if (!storagePath.startsWith(prefix) || storagePath.includes("..")) {
          return res.status(400).json({ error: "Invalid file reference." });
        }
        const size = Number(f?.file_size_bytes);
        rows.push({
          audit_id: audit.id,
          policy_type: policyType,
          file_name: safeFileName(f?.file_name),
          file_size_bytes: Number.isFinite(size) && size > 0 ? Math.min(size, MAX_FILE_BYTES) : null,
          storage_path: storagePath,
          // Forced server-side. audit_policies.ai_status has no CHECK constraint
          // in the live database, so the column itself will not reject a forged
          // value — this is the only thing standing in the way.
          ai_status: "PENDING",
          validation_status: "PENDING",
          ai_raw_output: {},
        });
      }

      const now = new Date().toISOString();

      // Not retried: the is.null guard means a retry after a lost-but-applied
      // PATCH would match zero rows and report a successful submission as a
      // conflict. A transient failure here is surfaced as "try again" instead,
      // which is safe because nothing has been written yet.
      const patchRes = await sbRequest(
        `${SUPABASE_URL}/rest/v1/audits?id=eq.${encodeURIComponent(audit.id)}` +
          `&client_submitted_at=is.null`, // optimistic lock: loses a double-submit race
        {
          method: "PATCH",
          headers: { Prefer: "return=representation" },
          body: JSON.stringify({
            consent_name: signerName,
            consent_company: audit.client_name, // from the row, not the client
            consent_statement: CONSENT_TEXT,
            consent_timestamp: now,
            client_submitted_at: now,
            file_count: rows.length,
            // Deliberately does NOT write `notes`: that column is shared with
            // the admin UI, and the portal has no business writing into it. The
            // signer's title is recorded in the CLIENT_SUBMITTED activity_log
            // entry below instead.
          }),
        },
        serviceKey
      );
      if (!patchRes.ok) {
        if (patchRes.transient) return res.status(UNAVAILABLE.status).json(UNAVAILABLE.body);
        return res.status(502).json({ error: "Submission failed. Please try again." });
      }
      let patched = null;
      try {
        patched = JSON.parse(patchRes.text);
      } catch {
        patched = null;
      }
      if (Array.isArray(patched) && patched.length === 0) {
        // Another request submitted this audit between resolve and patch.
        return res.status(409).json({ error: "This audit has already been submitted." });
      }

      // Not retried: a lost-but-applied insert would duplicate policy rows.
      const insertRes = await sbRequest(
        `${SUPABASE_URL}/rest/v1/audit_policies`,
        { method: "POST", body: JSON.stringify(rows) },
        serviceKey
      );
      if (!insertRes.ok) {
        // Consent is already recorded at this point. Surface the failure rather
        // than reporting success for documents that were never attached. This
        // stays a hard error even when transient: the audit is now marked
        // submitted, so "try again" would hit the already-submitted guard.
        await logActivity(
          serviceKey, audit.id, "CLIENT_SUBMIT_PARTIAL",
          { signer: signerName, files: rows.length, stage: "audit_policies_insert" },
          signerName
        );
        return res.status(502).json({ error: "Documents could not be attached. Please contact us." });
      }

      await logActivity(
        serviceKey, audit.id, "CLIENT_SUBMITTED",
        {
          signer: signerName,
          signer_title: signerTitle || null,
          files: rows.length,
          ip, // captured server-side; the browser never supplies this
        },
        signerName
      );

      return res.status(200).json({ ok: true, submitted_at: now });
    }

    return res.status(400).json({ error: "Unknown action" });
  } catch (e) {
    console.error("client portal error:", e);
    return res.status(500).json({ error: "Request failed. Please try again." });
  }
}
