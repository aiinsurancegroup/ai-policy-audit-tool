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
]);

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || "https://dtgsegabaivtgyccrcxi.supabase.co";

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

    if (action === "download_policy") {
      if (!body.storage_path) return res.status(400).json({ error: "Missing storage_path" });
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
