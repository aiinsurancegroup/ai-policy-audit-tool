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
// Open item, deliberately not fixed here: api/client/portal.js accepts uploads
// up to 25MB, and runAuditFromStorage sends those documents base64-encoded
// (~33% larger) through this endpoint's body. Anything over roughly 3MB has
// always failed -- Vercel rejects the body before this handler runs. The cap
// below only makes that failure legible. The fix is for extraction to read the
// PDF from storage server-side instead of through a request body, which removes
// the body-size ceiling entirely; that is the next piece of work.
//
// Open item: the model string below is a generation behind. Left alone so this
// change stays a security fix.

// Vercel rejects bodies over 4.5MB before this handler runs, so this cap sits
// under that and is the number we can actually explain to a caller. A PDF is
// ~33% larger once base64-encoded, so this allows roughly a 3MB PDF.
const MAX_BODY_BYTES = 4 * 1024 * 1024;
const MAX_MESSAGES = 20;

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
  // ---------------------------------------------------------------------
  // TEMPORARY DIAGNOSTIC -- remove before merging to main.
  //
  // A preview run returned 401 from this endpoint while /api/admin/audit
  // succeeded milliseconds either side with the same password and the same
  // header, which can only happen if the header did not arrive. This records
  // whether it arrived and how long it was. It never records the password
  // itself, and never the env var's length -- only whether the two lengths
  // agree. Header NAMES are listed (values are not) to show what the request
  // actually carried.
  {
    const sent = req.headers['x-admin-password'];
    const expected = process.env.AUDIT_ADMIN_PASSWORD;
    console.log('[analyze-diag] ' + JSON.stringify({
      method: req.method,
      headerArrived: typeof sent === 'string',
      headerLength: typeof sent === 'string' ? sent.length : null,
      envConfigured: typeof expected === 'string' && expected.length > 0,
      lengthsMatch: typeof sent === 'string' && typeof expected === 'string'
        ? sent.length === expected.length
        : null,
      valuesMatch: typeof sent === 'string' && typeof expected === 'string'
        ? sent === expected
        : null,
      origin: req.headers.origin ?? null,
      host: req.headers.host ?? null,
      xForwardedHost: req.headers['x-forwarded-host'] ?? null,
      referer: req.headers.referer ?? null,
      contentLength: req.headers['content-length'] ?? null,
      headerNames: Object.keys(req.headers).sort().join(' '),
    }));
  }
  // ---------------------------------------------------------------------

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

  try {
    const { messages, system } = req.body || {};

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

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 4000,
        system: system || '',
        messages,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      return res.status(response.status).json({ error: `API error: ${response.status}`, details: errorText });
    }

    const data = await response.json();
    return res.status(200).json(data);
  } catch (error) {
    return res.status(500).json({ error: 'Server error', message: error.message });
  }
}
