// Portal token generation and expiry. Structural checks against the source,
// plus a live exercise of the generator itself.
//
// The property being defended: a portal token is a bearer credential sitting in
// a URL in someone's inbox. It must be unguessable, it must not live forever,
// and the endpoint that replaces an expired one must not become an oracle for
// testing whether a given person is a client.
import crypto from 'node:crypto';
import fs from 'node:fs';

const portal = fs.readFileSync('api/client/portal.js', 'utf8');
const admin = fs.readFileSync('api/admin/audit.js', 'utf8');
const email = fs.readFileSync('api/send-email.js', 'utf8');
const app = fs.readFileSync('src/App.jsx', 'utf8');

let pass = 0, fail = 0;
const expect = (label, actual, want) => {
  const ok = String(actual) === String(want);
  ok ? pass++ : fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}: ${actual}${ok ? '' : `  (want ${want})`}`);
};

console.log('--- the generator itself');
// Exactly what the servers now call.
const tok = () => crypto.randomBytes(32).toString('hex');
const N = 50000;
const seen = new Set();
let wrongLen = 0, nonHex = 0;
for (let i = 0; i < N; i++) {
  const t = tok();
  if (t.length !== 64) wrongLen++;
  if (!/^[0-9a-f]{64}$/.test(t)) nonHex++;
  seen.add(t);
}
expect('every token is 64 hex chars', wrongLen + nonHex, 0);
expect(`no collisions in ${N}`, seen.size, N);
// The old generator produced short tokens 0.06% of the time; this one cannot.
expect('length is fixed, not incidental', tok().length, 64);
// And the portal's existing shape check accepts it without being widened.
const TOKEN_RE = /^[a-z0-9]{16,64}$/;
expect('accepted by the portal shape check', TOKEN_RE.test(tok()), true);
expect('  which still accepts a legacy 27-char token', TOKEN_RE.test('89ah9g60e7lawul9umid7b896kh'), true);

console.log('\n--- no security-bearing Math.random survives');
expect('admin mints with crypto', admin.includes("crypto.randomBytes(32).toString(\"hex\")"), true);
expect('send-email mints with crypto', email.includes("crypto.randomBytes(32).toString('hex')"), true);
expect('portal re-issue mints with crypto', portal.includes('crypto.randomBytes(32).toString("hex")'), true);
// The browser must not mint a bearer credential at all.
expect('browser no longer builds a token', /const token = genId\(\) \+ genId\(\)/.test(app), false);
expect('  it asks the server instead', app.includes("action: 'create_client_link'"), true);
expect('  and uses what the server returned', app.includes("'?token=' + created.token"), true);

console.log('\n--- expiry is enforced, and fails safe');
expect('every mint sets an expiry', admin.includes('client_token_expires_at: expires.toISOString()'), true);
expect('  send-email too', email.includes('client_token_expires_at: expiresAt.toISOString()'), true);
expect('  90 days', admin.includes('TOKEN_TTL_DAYS = 90') && portal.includes('TOKEN_TTL_DAYS = 90'), true);
expect('portal reads the expiry', portal.includes('client_token_expires_at'), true);
expect('checked before any action, not just lookup', portal.indexOf('expiresAt <= Date.now()') < portal.indexOf('if (action === "lookup")'), true);
// A missing expiry must read as expired, not as unlimited.
expect('null expiry treated as expired', portal.includes('audit.client_token_expires_at ? Date.parse(audit.client_token_expires_at) : 0'), true);
expect('  and a non-finite date too', portal.includes('!Number.isFinite(expiresAt)'), true);

console.log('\n--- the re-issue path cannot be used as an oracle');
expect('one response, always', portal.includes("If we have a review open for that address"), true);
expect('  returned before any lookup happens', portal.indexOf('request_new_link') < portal.indexOf('TOKEN_RE.test(token)'), true);
expect('  a malformed address gets it too', /\/\^\[\^@\\s\]\+@.*\{[\s\S]{0,400}return res\.status\(200\)/.test(portal), true);
expect('  a database failure gets it too', portal.includes('[portal] request_new_link failed'), true);
expect('the reason is written down', portal.includes('THE RESPONSE IS IDENTICAL EVERY TIME'), true);
// Re-issuing must not reopen a finished audit.
expect('only an unsubmitted audit is re-issued', portal.includes('client_submitted_at=is.null'), true);
expect('  and the old token is replaced, not kept', /client_token: token,[\s\S]{0,200}client_token_expires_at/.test(portal), true);
expect('re-issues are logged', portal.includes('CLIENT_LINK_REISSUED'), true);

console.log('\n--- the expired response is the one deliberate exception');
expect('expired is distinguishable', portal.includes('expired: true'), true);
expect('  with a 410, not the uniform 404', portal.includes('status: 410'), true);
expect('  and says what to do next', portal.includes("Request a new one"), true);
// The property, not a count: both the malformed-token path and the genuine
// no-match path must answer with the same constant, so neither can be used to
// tell a wrong token from a token that simply is not ours.
const invalidSites = (portal.match(/return res\.status\(INVALID\.status\)\.json\(INVALID\.body\);/g) || []).length;
expect('malformed and not-found both answer INVALID', invalidSites, 2);
expect('  and nothing else invents its own 404', /status\(404\)\.json\(\{/.test(portal), false);
expect('the exception is justified in place', portal.includes('the uniform-failure rule is deliberately relaxed'), true);

console.log('\n--- the re-issue link cannot be redirected');
expect('origin is a constant, not from the request', portal.includes('const PORTAL_ORIGIN = "https://audit.theaiinsurancegroup.com"'), true);
expect('  not derived from a Host header', /PORTAL_ORIGIN[\s\S]{0,200}req\.headers/.test(portal), false);
expect('client name is escaped into the email', portal.includes('escapeHtml(name)'), true);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
