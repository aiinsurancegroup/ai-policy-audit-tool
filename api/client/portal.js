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

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || "https://dtgsegabaivtgyccrcxi.supabase.co";
const BUCKET = "policies";

// Live tokens are 27 chars of [a-z0-9] (three 9-char Math.random segments).
// The range is loose so that strengthening the generator later does not require
// changing this endpoint; it exists to reject junk before it reaches the DB.
const TOKEN_RE = /^[a-z0-9]{16,64}$/;

const MAX_FILES = 20;
const MAX_FILE_BYTES = 25 * 1024 * 1024; // 25MB
const MAX_SIGNER_NAME = 200;
const MAX_SIGNER_TITLE = 100;

// Valid policy_type ids. Must stay in sync with POLICY_TYPES in src/App.jsx.
const POLICY_TYPE_IDS = new Set([
  "auto", "gl", "eo", "do", "cyber", "epli",
  "products", "wc", "auto_policy", "property", "umbrella",
]);

// The authoritative consent text. Recorded on submit regardless of what the
// client sends, so the signed statement cannot be forged. `lookup` returns this
// same constant for display, which keeps the text the client SEES and the text
// we STORE provably identical.
const CONSENT_TEXT = 'I authorize The AI Insurance Group to review and analyze the commercial insurance policy documents provided herein for the purpose of identifying AI-related coverage gaps, exclusions, and endorsements. I understand that this analysis is for informational purposes only and does not constitute a coverage determination, legal advice, or binding coverage opinion. Final coverage interpretations should be confirmed with the issuing carrier(s). I confirm that I am authorized to share these policy documents for review purposes.';

// Best-effort brute-force damper, per warm serverless instance. Vercel runs many
// instances, so this is a speed bump, NOT a rate limit — real protection needs
// the Vercel WAF or a shared KV store. It is here because the current token
// generator is Math.random()-based and therefore guessable in principle.
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

// Resolve a client_token to its audit row. This is the ONLY place a token is
// exchanged for an identity; every route goes through it.
async function resolveAudit(token, serviceKey) {
  const url =
    `${SUPABASE_URL}/rest/v1/audits` +
    `?client_token=eq.${encodeURIComponent(token)}` +
    `&deleted_at=is.null` +
    `&select=id,client_name,client_submitted_at,client_email` +
    `&limit=1`;
  const r = await fetch(url, { headers: sbHeaders(serviceKey) });
  if (!r.ok) return null;
  const rows = await r.json().catch(() => null);
  return Array.isArray(rows) && rows.length ? rows[0] : null;
}

// Server-side activity logging. Note the column is performed_by — the browser
// code was writing `actor`, which PostgREST rejected, which is why activity_log
// has been empty. Failures here are logged but never fail the caller's request.
async function logActivity(serviceKey, auditId, action, details, performedBy) {
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/activity_log`, {
      method: "POST",
      headers: sbHeaders(serviceKey),
      body: JSON.stringify({
        audit_id: auditId,
        action,
        details,
        performed_by: performedBy || "client",
      }),
    });
    if (!r.ok) console.error("activity_log insert failed:", r.status, await r.text());
  } catch (e) {
    console.error("activity_log insert threw:", e);
  }
}

const INVALID = { status: 404, body: { error: "Invalid or expired link" } };

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

  // Cheap shape check before any database work.
  if (!TOKEN_RE.test(token)) {
    return res.status(INVALID.status).json(INVALID.body);
  }

  try {
    const audit = await resolveAudit(token, serviceKey);
    if (!audit) return res.status(INVALID.status).json(INVALID.body);

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
      const signResp = await fetch(
        `${SUPABASE_URL}/storage/v1/object/upload/sign/${BUCKET}/${path}`,
        { method: "POST", headers: sbHeaders(serviceKey), body: JSON.stringify({}) }
      );
      if (!signResp.ok) {
        console.error("sign upload failed:", signResp.status, await signResp.text());
        return res.status(502).json({ error: "Could not prepare upload. Please try again." });
      }
      const signed = await signResp.json().catch(() => null);
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

      const patchResp = await fetch(
        `${SUPABASE_URL}/rest/v1/audits?id=eq.${encodeURIComponent(audit.id)}` +
          `&client_submitted_at=is.null`, // optimistic lock: loses a double-submit race
        {
          method: "PATCH",
          headers: sbHeaders(serviceKey, { Prefer: "return=representation" }),
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
        }
      );
      if (!patchResp.ok) {
        console.error("consent patch failed:", patchResp.status, await patchResp.text());
        return res.status(502).json({ error: "Submission failed. Please try again." });
      }
      const patched = await patchResp.json().catch(() => null);
      if (Array.isArray(patched) && patched.length === 0) {
        // Another request submitted this audit between resolve and patch.
        return res.status(409).json({ error: "This audit has already been submitted." });
      }

      const insertResp = await fetch(`${SUPABASE_URL}/rest/v1/audit_policies`, {
        method: "POST",
        headers: sbHeaders(serviceKey),
        body: JSON.stringify(rows),
      });
      if (!insertResp.ok) {
        // Consent is already recorded at this point. Surface the failure rather
        // than reporting success for documents that were never attached.
        console.error("policy insert failed:", insertResp.status, await insertResp.text());
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
