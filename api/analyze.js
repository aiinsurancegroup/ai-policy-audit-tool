// Vercel serverless function: the only path from the browser to the Anthropic API.
//
// Every call here spends real API credits, so three checks run before a single
// token is billed:
//   1. the same admin password that gates api/admin/audit.js (x-admin-password)
//   2. an origin check, so another site cannot drive a logged-in operator's
//      browser into spending credits, and cannot read this endpoint's responses
//   3. a request size cap, so one call cannot bill an unbounded prompt
//
// The password is the control that stops a stranger with curl. The origin check
// is defence in depth against a browser being used as the attacker's proxy: a
// caller who is not a browser can set any Origin it likes.
//
// Required Vercel environment variables:
//   ANTHROPIC_API_KEY     - secret; never reaches the browser
//   AUDIT_ADMIN_PASSWORD  - the same password api/admin/audit.js checks
//   ALLOWED_ORIGINS       - optional, comma-separated extra origins
//
// Only the admin screen calls this (runAudit and runAuditFromStorage in
// src/App.jsx), and both already hold the admin password. The public client
// portal never calls it: clients upload documents through api/client/portal.js
// and the operator analyses them afterwards.
//
// The PDF does not travel in the request body. The caller sends a storage_path
// and this function reads the bytes from Supabase storage with the service key,
// which is what removed the old ~3MB ceiling: the body used to carry the
// document base64-encoded, and Vercel rejected it at 4.5MB before this handler
// ever ran.
//
// Two routes out to Anthropic, chosen by size:
//   <= INLINE_MAX_BYTES  base64 inside the request, as before
//   >  INLINE_MAX_BYTES  uploaded to the Files API and referenced by file_id
// The second exists because a request caps at 32MB and base64 costs 4/3, while
// the Files API takes raw multipart and caps at 500MB. An uploaded file is
// deleted in a finally block and also carries an expiry, so a client's policy
// document does not outlive the request that needed it.
//
// MODEL COMPARISON IN PROGRESS: currently pointed at claude-opus-5. The next
// step is to run the same policy against claude-sonnet-5 and compare findings
// before production settles on one. See max_tokens below before changing it.
//
// What each failure means, because two of them used to be the same number:
//   401  the CALLER's admin password is missing or wrong
//   403  the request did not come from this deployment's own origin
//   413  the request body is too large
//   502  OUR upstream call failed -- Anthropic, or the storage read that
//        fetches the document; upstream_status says which and how

// Vercel rejects bodies over 4.5MB before this handler runs, so this cap sits
// under that and is the number we can actually explain to a caller. The PDF no
// longer travels in the body -- the caller sends a storage_path and this
// function fetches the bytes itself -- so what remains here is prompt text.
const MAX_BODY_BYTES = 4 * 1024 * 1024;
const MAX_MESSAGES = 20;

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || 'https://dtgsegabaivtgyccrcxi.supabase.co';
const BUCKET = 'policies';

// Anthropic caps a whole request at 32MB, and base64 inflates bytes by 4/3, so
// an inlined PDF may be about 23MB before the encoding alone breaches it. This
// sits below that with room for the prompt. Anything larger goes via the Files
// API, which takes raw multipart and caps at 500MB -- twenty times more than
// storage will even accept, so size stops being a failure mode above this line.
const INLINE_MAX_BYTES = 20 * 1024 * 1024;

// A backstop, not the mechanism. The delete in the finally block is what
// removes an uploaded file; this is what removes it anyway if that delete never
// runs -- the function is killed, the deploy dies mid-request, the API is down.
// One hour is the shortest the Files API accepts.
const FILE_EXPIRY_SECONDS = 3600;

// A stored object is addressed by a path this function interpolates into a URL,
// so it has to be confined to the audit's own folder. portal.js validates the
// same shape on the way in; this is the read side of that check and does not
// trust it to have happened.
function safeStoragePath(path) {
  if (typeof path !== 'string' || !path) return null;
  if (path.length > 400) return null;
  // No traversal, no absolute paths, no encoded separators, and exactly the
  // two segments the writer creates: <audit_id>/<random>_<file name>.
  if (path.includes('..') || path.startsWith('/') || /%2e|%2f|\\/i.test(path)) return null;
  if (!/^[0-9a-f-]{36}\/[A-Za-z0-9._-]{1,200}$/.test(path)) return null;
  return path;
}

async function fetchStoredPdf(storagePath, serviceKey) {
  const url = `${SUPABASE_URL}/storage/v1/object/${BUCKET}/${storagePath}`;
  const r = await fetch(url, {
    headers: { apikey: serviceKey, Authorization: 'Bearer ' + serviceKey },
  });
  if (!r.ok) {
    const detail = await r.text();
    return { ok: false, status: r.status, detail: detail.slice(0, 200) };
  }
  return { ok: true, buffer: Buffer.from(await r.arrayBuffer()) };
}

// Upload to the Files API and return its id. Raw multipart, so the bytes are
// not base64-inflated and the 32MB request cap does not apply.
async function uploadToFilesApi(buffer, fileName, apiKey) {
  const form = new FormData();
  form.append('file', new Blob([buffer], { type: 'application/pdf' }), fileName || 'policy.pdf');
  form.append('expires_in_seconds', String(FILE_EXPIRY_SECONDS));
  const r = await fetch('https://api.anthropic.com/v1/files', {
    method: 'POST',
    // Content-Type is deliberately unset: fetch derives it from the FormData
    // along with the multipart boundary, and setting it by hand loses that.
    headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
    body: form,
  });
  const text = await r.text();
  if (!r.ok) return { ok: false, status: r.status, detail: text.slice(0, 300) };
  let parsed = null;
  try { parsed = JSON.parse(text); } catch { parsed = null; }
  if (!parsed?.id) return { ok: false, status: r.status, detail: 'upload returned no file id' };
  return { ok: true, id: parsed.id, bytes: buffer.length };
}

async function deleteFromFilesApi(fileId, apiKey) {
  try {
    const r = await fetch(`https://api.anthropic.com/v1/files/${encodeURIComponent(fileId)}`, {
      method: 'DELETE',
      headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
    });
    // Logged at both ends: an upload with no matching delete is the thing worth
    // finding in the log, and it can only be found if both lines exist.
    console.log(`[analyze] files-api delete ${fileId}: ${r.ok ? 'ok' : 'FAILED ' + r.status}`);
    return r.ok;
  } catch (e) {
    console.error(`[analyze] files-api delete ${fileId} threw: ${e.message}. Expiry in ${FILE_EXPIRY_SECONDS}s is the backstop.`);
    return false;
  }
}

// This deployment's own host, which covers production, preview deployments and
// local dev without hardcoding any of them.
function requestHost(req) {
  const forwarded = req.headers['x-forwarded-host'];
  const host = (Array.isArray(forwarded) ? forwarded[0] : forwarded) || req.headers.host || '';
  return host.split(',')[0].trim().toLowerCase();
}

function isAllowedOrigin(origin, req) {
  if (!origin) return false;
  let originHost;
  try {
    originHost = new URL(origin).host.toLowerCase();
  } catch {
    return false;
  }
  const host = requestHost(req);
  if (host && originHost === host) return true;
  const extra = (process.env.ALLOWED_ORIGINS || '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  return extra.includes(origin.toLowerCase());
}

export default async function handler(req, res) {
  const origin = req.headers.origin;
  const originOk = isAllowedOrigin(origin, req);

  // Only ever echo an origin we allow. The previous "*" let any site on the
  // internet read what this endpoint returned.
  if (originOk) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-admin-password');
  }

  if (req.method === 'OPTIONS') return res.status(originOk ? 200 : 403).end();
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Browsers attach Origin to every POST, so a missing or foreign one is not
  // this app's admin screen.
  if (!originOk) return res.status(403).json({ error: 'Forbidden' });

  const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
  const adminPassword = process.env.AUDIT_ADMIN_PASSWORD;
  if (!ANTHROPIC_API_KEY || !adminPassword) {
    return res.status(500).json({ error: 'Server not configured' });
  }

  const providedPassword = req.headers['x-admin-password'];
  if (!providedPassword || providedPassword !== adminPassword) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const declaredSize = Number(req.headers['content-length'] || 0);
  if (declaredSize > MAX_BODY_BYTES) {
    return res.status(413).json({ error: 'Request too large', limit_bytes: MAX_BODY_BYTES });
  }

  // Set only when the Files API was used, and read by the finally block. It has
  // to be declared out here so that a throw anywhere below still finds it.
  let uploadedFileId = null;

  try {
    const { messages, system, storage_path: storagePath, file_name: fileName } = req.body || {};

    if (!Array.isArray(messages) || messages.length === 0 || messages.length > MAX_MESSAGES) {
      return res.status(400).json({ error: 'Invalid messages' });
    }
    if (system !== undefined && system !== null && typeof system !== 'string') {
      return res.status(400).json({ error: 'Invalid system prompt' });
    }
    // Content-length can be absent or wrong; this is the size we actually send.
    if (Buffer.byteLength(JSON.stringify({ messages, system }), 'utf8') > MAX_BODY_BYTES) {
      return res.status(413).json({ error: 'Request too large', limit_bytes: MAX_BODY_BYTES });
    }

    // The document is fetched here rather than carried in the body. The caller
    // sends a path; this function reads the bytes with the service key and
    // decides how to hand them to Anthropic.
    let outboundMessages = messages;
    if (storagePath !== undefined) {
      const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
      if (!serviceKey) return res.status(500).json({ error: 'Server not configured' });

      const safePath = safeStoragePath(storagePath);
      if (!safePath) return res.status(400).json({ error: 'Invalid storage path' });

      const fetched = await fetchStoredPdf(safePath, serviceKey);
      if (!fetched.ok) {
        console.error(`[analyze] storage fetch failed for ${safePath}: ${fetched.status} ${fetched.detail}`);
        return res.status(502).json({ error: 'The stored document could not be retrieved', upstream_status: fetched.status });
      }

      const buf = fetched.buffer;
      let documentBlock;
      if (buf.length <= INLINE_MAX_BYTES) {
        documentBlock = {
          type: 'document',
          source: { type: 'base64', media_type: 'application/pdf', data: buf.toString('base64') },
        };
      } else {
        const up = await uploadToFilesApi(buf, fileName, ANTHROPIC_API_KEY);
        if (!up.ok) {
          console.error(`[analyze] files-api upload failed: ${up.status} ${up.detail}`);
          return res.status(502).json({ error: 'Upstream API request failed', upstream_status: up.status, details: up.detail });
        }
        uploadedFileId = up.id;
        console.log(`[analyze] files-api upload ${up.id}: ${up.bytes} bytes from ${safePath}, expires in ${FILE_EXPIRY_SECONDS}s`);
        documentBlock = { type: 'document', source: { type: 'file', file_id: up.id } };
      }

      // The caller sends the prompt with a placeholder where the document goes,
      // so the document block is prepended rather than substituted -- the
      // caller never has to know which of the two routes was taken.
      outboundMessages = messages.map((m, i) =>
        i === 0 && m?.role === 'user' && Array.isArray(m.content)
          ? { ...m, content: [documentBlock, ...m.content] }
          : m
      );
    }

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-opus-5',
        // A 44-page policy at the default effort ran past the 120s function
        // limit twice and was killed mid-answer. Reasoning time, not token
        // budget, is the binding constraint here, so cap the reasoning rather
        // than only widening the clock. Low is aimed at a structured extraction
        // working from an already detailed prompt; raise it if findings thin
        // out. Whatever this is set to, both models in the comparison must use
        // the same value or the comparison measures the setting, not the model.
        output_config: { effort: 'low' },
        // Raised from 4000 with the model change, and the two are linked. The
        // retired claude-sonnet-4 did not think before answering, so 4000 was
        // all answer. Current models reason first by default and that reasoning
        // counts against max_tokens, so 4000 could be spent thinking and return
        // a truncated fragment -- or nothing -- with no error to show for it.
        // 16000 leaves room for the reasoning and the JSON, inside the 300s
        // maxDuration this function is given in vercel.json -- which now also
        // has to cover fetching the document from storage and, for a large one,
        // uploading it to the Files API before the model call even starts.
        max_tokens: 16000,
        system: system || '',
        messages: outboundMessages,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      // Never forward the upstream status verbatim. Doing so made OUR credential
      // failing (Anthropic 401) indistinguishable from the CALLER's password
      // failing (our own 401) -- the two are answered by the same endpoint with
      // the same code, and a week of production failures read as a login problem.
      // A failure on the far side of this endpoint is a bad gateway, whatever
      // the far side called it. The upstream status stays in the body.
      console.error(`[analyze] upstream Anthropic call failed with ${response.status}: ${errorText.slice(0, 300)}`);
      return res.status(502).json({
        error: 'Upstream API request failed',
        upstream_status: response.status,
        details: errorText.slice(0, 500),
      });
    }

    const data = await response.json();
    // A truncated answer is not valid JSON, so the browser's JSON.parse throws
    // and the UI shows the same generic failure it shows for everything else.
    // Say so in the log, where it can be seen, rather than letting it hide.
    if (data.stop_reason === 'max_tokens') {
      console.error('[analyze] response hit max_tokens and is truncated; raise max_tokens or lower effort');
    }
    return res.status(200).json(data);
  } catch (error) {
    console.error(`[analyze] ${error.message}`);
    return res.status(500).json({ error: 'Server error', message: error.message });
  } finally {
    // In finally, not after the call: every path out of the try block above
    // returns rather than falling through, and a 502, a throw or a timeout are
    // exactly the cases where a client's policy document would otherwise be
    // left sitting in Anthropic's storage. The expiry set at upload covers the
    // one case this cannot -- the function dying before it gets here.
    if (uploadedFileId) await deleteFromFilesApi(uploadedFileId, ANTHROPIC_API_KEY);
  }
}
