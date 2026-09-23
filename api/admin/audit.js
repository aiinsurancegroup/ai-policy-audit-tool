// Vercel serverless function for the audit tool's admin side.
//
// All admin writes and reads go through here. The client never talks to Supabase
// directly for admin operations. This lets us:
//   1. Keep the service role key on the server (out of the browser bundle).
//   2. Gate every admin operation behind a password stored in a Vercel env var.
//
// Required Vercel environment variables (set on this project in Vercel):
//   AUDIT_ADMIN_PASSWORD        - the admin login password (anything you choose)
//   SUPABASE_SERVICE_ROLE_KEY   - secret key from Supabase (we set this up earlier)
//   VITE_SUPABASE_URL           - already set; we reuse it here
//
// Actions (all require x-admin-password header):
//   { action: "verify" }
//       -> { ok: true } on valid password
//   { action: "select", table, filter?, single?, order?, limit? }
//       -> returns rows
//   { action: "insert", table, payload, returnRow? }
//       -> inserts row(s); returns inserted row if returnRow=true
//   { action: "update", table, filter, payload }
//       -> patches matching rows
//   { action: "delete", table, filter }
//       -> deletes matching rows (rarely needed; we mostly soft-delete)
//   { action: "soft_delete_audit", id }
//       -> sets audits.deleted_at = now() for the given audit id
//   { action: "download_policy", storage_path }
//       -> returns { base64, contentType } for a stored PDF
//
// "filter" is a simple object like { id: "abc" } or { audit_id: "abc", status: "PENDING" }.
// All columns in the filter are combined with AND. Special values:
//   { deleted_at: null }   -> IS NULL check
//   { deleted_at: "__not_null" } -> IS NOT NULL
//
// The list of allowed tables is hardcoded below as a safety net so that even if
// the frontend is compromised, an attacker can't use this endpoint to touch
// tables they shouldn't.

const ALLOWED_TABLES = new Set([
  "audits",
  "audit_policies",
  "client_consents",
  "finding_validations",
  "activity_log",
  // Read back a previously generated program report. Writes go through
  // api/admin/program-report.js, which is the only thing that may create one --
  // it enforces the "every policy must have been read" guard first. Listing the
  // table here does mean a compromised frontend could insert a row directly;
  // that would be a report with no guarantee behind it, which is why the guard
  // lives on the server rather than in the button.
  "audit_program_analysis",
]);

import crypto from "node:crypto";

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || "https://dtgsegabaivtgyccrcxi.supabase.co";

// Kept in step with api/client/portal.js, which writes objects into the same
// bucket under the same convention. Both sides validate: the writer so it only
// creates paths of this shape, the reader so it only accepts them.
const MAX_FILE_BYTES = 25 * 1024 * 1024;
const UUID_RE = /^[0-9a-f-]{36}$/i;

// A portal token is a bearer credential sitting in a URL in someone's inbox.
// 32 bytes from the crypto RNG, hex-encoded: 64 characters, which the portal's
// existing TOKEN_RE (16-64) already accepts, so old and new coexist.
//
// Not Math.random(). V8 implements it as xorshift128+, whose internal state is
// recoverable from a handful of consecutive outputs -- so an attacker able to
// mint a few tokens can predict the next one issued to a real client.
const TOKEN_TTL_DAYS = 90;
function randomToken() {
  return crypto.randomBytes(32).toString("hex");
}

function safeFileName(name) {
  const base = String(name || "").split(/[\\/]/).pop() || "document.pdf";
  return base.replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 120) || "document.pdf";
}

function randomSegment() {
  return Math.random().toString(36).slice(2, 11);
}

// <audit_id>/<random>_<file name>, and nothing else. Rejects traversal,
// absolute paths, backslashes and percent-encoded separators.
function safeStoragePath(path) {
  if (typeof path !== "string" || !path || path.length > 400) return null;
  if (path.includes("..") || path.startsWith("/") || /%2e|%2f|\\/i.test(path)) return null;
  if (!/^[0-9a-f-]{36}\/[A-Za-z0-9._-]{1,200}$/.test(path)) return null;
  return path;
}

function buildQueryString(filter, order, limit) {
  const parts = [];
  if (filter && typeof filter === "object") {
    for (const [k, v] of Object.entries(filter)) {
      if (v === null) parts.push(`${encodeURIComponent(k)}=is.null`);
      else if (v === "__not_null") parts.push(`${encodeURIComponent(k)}=not.is.null`);
      else parts.push(`${encodeURIComponent(k)}=eq.${encodeURIComponent(String(v))}`);
    }
  }
  if (order) {
    // order is e.g. "created_at.desc" or "created_at"
    parts.push(`order=${encodeURIComponent(order)}`);
  }
  if (typeof limit === "number" && limit > 0) {
    parts.push(`limit=${limit}`);
  }
  return parts.length ? "?" + parts.join("&") : "";
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const providedPassword = req.headers["x-admin-password"];
  const adminPassword = process.env.AUDIT_ADMIN_PASSWORD;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!adminPassword || !serviceKey) {
    return res.status(500).json({ error: "Server not configured" });
  }
  if (!providedPassword || providedPassword !== adminPassword) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const body = req.body || {};
  const action = body.action;

  if (action === "verify") {
    return res.status(200).json({ ok: true });
  }

  const sbHeaders = {
    apikey: serviceKey,
    Authorization: "Bearer " + serviceKey,
    "Content-Type": "application/json",
  };

  try {
    if (action === "select") {
      if (!body.table || !ALLOWED_TABLES.has(body.table)) {
        return res.status(400).json({ error: "Invalid table" });
      }
      const qs = buildQueryString(body.filter, body.order, body.limit);
      const url = `${SUPABASE_URL}/rest/v1/${body.table}${qs}`;
      const r = await fetch(url, { headers: { ...sbHeaders, ...(body.single ? { Accept: "application/vnd.pgrst.object+json" } : {}) } });
      const text = await r.text();
      return res.status(r.status).setHeader("Content-Type", "application/json").send(text || "[]");
    }

    if (action === "insert") {
      if (!body.table || !ALLOWED_TABLES.has(body.table)) {
        return res.status(400).json({ error: "Invalid table" });
      }
      if (!body.payload) return res.status(400).json({ error: "Missing payload" });
      const headers = { ...sbHeaders, ...(body.returnRow ? { Prefer: "return=representation" } : {}) };
      const r = await fetch(`${SUPABASE_URL}/rest/v1/${body.table}`, {
        method: "POST",
        headers,
        body: JSON.stringify(body.payload),
      });
      const text = await r.text();
      return res.status(r.status).setHeader("Content-Type", "application/json").send(text || "{}");
    }

    if (action === "update") {
      if (!body.table || !ALLOWED_TABLES.has(body.table)) {
        return res.status(400).json({ error: "Invalid table" });
      }
      if (!body.filter || !body.payload) return res.status(400).json({ error: "Missing filter or payload" });
      const qs = buildQueryString(body.filter);
      const r = await fetch(`${SUPABASE_URL}/rest/v1/${body.table}${qs}`, {
        method: "PATCH",
        headers: sbHeaders,
        body: JSON.stringify(body.payload),
      });
      const text = await r.text();
      return res.status(r.status).setHeader("Content-Type", "application/json").send(text || "{}");
    }

    if (action === "delete") {
      if (!body.table || !ALLOWED_TABLES.has(body.table)) {
        return res.status(400).json({ error: "Invalid table" });
      }
      if (!body.filter) return res.status(400).json({ error: "Missing filter" });
      const qs = buildQueryString(body.filter);
      const r = await fetch(`${SUPABASE_URL}/rest/v1/${body.table}${qs}`, {
        method: "DELETE",
        headers: sbHeaders,
      });
      const text = await r.text();
      return res.status(r.status).setHeader("Content-Type", "application/json").send(text || "{}");
    }

    if (action === "soft_delete_audit") {
      if (!body.id) return res.status(400).json({ error: "Missing id" });
      const r = await fetch(`${SUPABASE_URL}/rest/v1/audits?id=eq.${encodeURIComponent(body.id)}`, {
        method: "PATCH",
        headers: sbHeaders,
        body: JSON.stringify({ deleted_at: new Date().toISOString() }),
      });
      const text = await r.text();
      return res.status(r.status).setHeader("Content-Type", "application/json").send(text || "{}");
    }

    // Create an audit with a client portal link. The token is minted HERE and
    // never in the browser: a token generated browser-side is generated by
    // Math.random, which is xorshift128+ and recoverable from a few outputs, in
    // an environment the recipient controls. 32 bytes from the crypto RNG, and
    // a 90-day expiry so a link in an inbox does not stay live forever.
    if (action === "create_client_link") {
      const payload = body.payload && typeof body.payload === "object" ? body.payload : {};
      if (!payload.client_name) return res.status(400).json({ error: "Missing client_name" });

      const token = randomToken();
      const now = new Date();
      const expires = new Date(now.getTime() + TOKEN_TTL_DAYS * 86400000);

      const r = await fetch(`${SUPABASE_URL}/rest/v1/audits`, {
        method: "POST",
        headers: { ...sbHeaders(serviceKey), Prefer: "return=representation" },
        body: JSON.stringify({
          ...payload,
          status: "DRAFT",
          client_token: token,
          client_token_issued_at: now.toISOString(),
          client_token_expires_at: expires.toISOString(),
        }),
      });
      const text = await r.text();
      if (!r.ok) return res.status(502).json({ error: "Could not create the audit.", detail: text.slice(0, 200) });
      let rows = null;
      try { rows = JSON.parse(text); } catch { rows = null; }
      const audit = Array.isArray(rows) ? rows[0] : rows;
      if (!audit?.id) return res.status(502).json({ error: "Could not create the audit." });

      // The token goes back exactly once, to the operator who just made it.
      return res.status(200).json({ audit_id: audit.id, token, expires_at: expires.toISOString() });
    }

    // Mint a signed upload URL so an operator's file goes browser -> storage
    // directly, the same route the client portal uses. The bytes never pass
    // through this function, and the server owns the path: an admin upload is
    // now stored like a client one, which is what makes every row re-runnable.
    if (action === "upload_url") {
      const fileName = safeFileName(body.file_name);
      if (!/\.pdf$/i.test(fileName)) return res.status(400).json({ error: "Only PDF files are accepted." });
      if (!UUID_RE.test(String(body.audit_id || ""))) return res.status(400).json({ error: "Invalid audit id" });
      const size = Number(body.file_size_bytes);
      if (!Number.isFinite(size) || size <= 0 || size > MAX_FILE_BYTES) {
        return res.status(400).json({ error: `File must be between 1 byte and ${Math.round(MAX_FILE_BYTES / 1048576)}MB.` });
      }

      const path = `${body.audit_id}/${randomSegment()}_${fileName}`;
      const signRes = await fetch(`${SUPABASE_URL}/storage/v1/object/upload/sign/policies/${path}`, {
        method: "POST",
        headers: { apikey: serviceKey, Authorization: "Bearer " + serviceKey, "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      if (!signRes.ok) {
        const detail = await signRes.text();
        return res.status(502).json({ error: "Could not prepare upload.", detail: detail.slice(0, 200) });
      }
      let signed = null;
      try { signed = JSON.parse(await signRes.text()); } catch { signed = null; }
      if (!signed?.url) return res.status(502).json({ error: "Could not prepare upload." });
      const uploadToken = new URLSearchParams(signed.url.split("?")[1] || "").get("token");
      return res.status(200).json({ path, upload_token: uploadToken });
    }

    if (action === "download_policy") {
      if (!body.storage_path) return res.status(400).json({ error: "Missing storage_path" });
      // This path is interpolated into a URL. Without this check a caller could
      // walk out of the bucket with "..", and being admin-gated is not a reason
      // to accept a path we did not issue.
      if (!safeStoragePath(body.storage_path)) return res.status(400).json({ error: "Invalid storage path" });
      const url = `${SUPABASE_URL}/storage/v1/object/policies/${body.storage_path}`;
      const r = await fetch(url, { headers: { apikey: serviceKey, Authorization: "Bearer " + serviceKey } });
      if (!r.ok) {
        const errText = await r.text();
        return res.status(r.status).json({ error: "Storage fetch failed", detail: errText.slice(0, 200) });
      }
      const buf = Buffer.from(await r.arrayBuffer());
      const contentType = r.headers.get("content-type") || "application/pdf";
      return res.status(200).json({ base64: buf.toString("base64"), contentType });
    }

    return res.status(400).json({ error: "Unknown action" });
  } catch (e) {
    return res.status(500).json({ error: "Upstream request failed", detail: String(e) });
  }
}
