// Offline tests for api/admin/program-report.js.
// Supabase and Anthropic are both stubbed: nothing is billed, no network, no
// credentials. Synthetic policies only.
//
// The rule under test is the one with consequences: a program report may assert
// that a coverage is ABSENT only when every policy in the audit was actually
// read. If any policy failed, the report must refuse rather than report that
// policy's lines as missing.

process.env.ANTHROPIC_API_KEY = 'test-key';
process.env.AUDIT_ADMIN_PASSWORD = 'correct-horse';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-key';
process.env.VITE_SUPABASE_URL = 'https://db.example.supabase.co';

import path from 'node:path';
import { pathToFileURL } from 'node:url';

const HOST = 'audit.example.com';
let policyRows = [];
let anthropicCalled = false;
let inserted = null;
let anthropicResponse = null;

globalThis.fetch = async (url, init) => {
  const u = String(url);
  if (u.includes('/rest/v1/audit_policies')) {
    return { ok: true, status: 200, json: async () => policyRows };
  }
  if (u.includes('/rest/v1/audit_program_analysis')) {
    inserted = JSON.parse(init.body);
    return { ok: true, status: 201, json: async () => [{ id: 'row-1', ...inserted }], text: async () => '' };
  }
  if (u.includes('api.anthropic.com')) {
    anthropicCalled = true;
    return anthropicResponse ?? {
      ok: true, status: 200,
      json: async () => ({ model: 'claude-opus-5', stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify({ program_summary: 'ok', lines: [], cross_policy_findings: [], questions_for_client: [], expired_or_expiring: [] }) }] }),
      text: async () => '',
    };
  }
  throw new Error('unexpected fetch: ' + u);
};

const handler = (await import(pathToFileURL(path.resolve('api/admin/program-report.js')).href)).default;

const res = () => {
  const r = { statusCode: null, body: undefined, headers: {} };
  r.setHeader = (k, v) => { r.headers[k.toLowerCase()] = v; return r; };
  r.status = (c) => { r.statusCode = c; return r; };
  r.json = (b) => { r.body = b; return r; };
  r.end = () => r;
  return r;
};

const call = async ({ password = 'correct-horse', origin = `https://${HOST}`, body = { audit_id: 'a1' }, method = 'POST' } = {}) => {
  anthropicCalled = false; inserted = null;
  const r = res();
  const headers = { host: HOST };
  if (origin) headers.origin = origin;
  if (password !== null) headers['x-admin-password'] = password;
  await handler({ method, headers, body }, r);
  return r;
};

let pass = 0, fail = 0;
const expect = (label, actual, want) => {
  const ok = String(actual) === String(want);
  ok ? pass++ : fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}: ${actual}${ok ? '' : `  (want ${want})`}`);
};

const policy = (over) => ({
  id: 'p' + Math.random().toString(36).slice(2, 6),
  policy_type: 'gl', file_name: 'gl.pdf', ai_status: 'SILENT',
  carrier: 'Acme', policy_number: 'X1', effective_date: '2026-01-01', expiration_date: '2027-01-01',
  ai_raw_output: { policy_type: 'gl', summary: 's' },
  ...over,
});

// --- the guard --------------------------------------------------------------
policyRows = [policy(), policy({ file_name: 'auto.pdf', policy_type: 'auto_policy', ai_status: 'FAILED' })];
const blocked = await call();
expect('one FAILED policy -> refuses with 409', blocked.statusCode, 409);
expect('refusal names the unread file', blocked.body.unread_policies[0].file_name, 'auto.pdf');
expect('refusal did NOT call Anthropic', anthropicCalled, false);
expect('refusal stored nothing', inserted, null);

policyRows = [policy(), policy({ file_name: 'p.pdf', ai_status: 'PENDING' })];
expect('one PENDING policy -> also refuses', (await call()).statusCode, 409);

// UNKNOWN means "read, and not an insurance policy" -- a completed analysis.
policyRows = [policy(), policy({ file_name: 'notapolicy.pdf', ai_status: 'UNKNOWN' })];
const withUnknown = await call();
expect('UNKNOWN counts as read -> proceeds', withUnknown.statusCode, 200);
expect('UNKNOWN run reached Anthropic', anthropicCalled, true);

// --- the happy path ---------------------------------------------------------
policyRows = [policy(), policy({ file_name: 'auto.pdf', policy_type: 'auto_policy', ai_status: 'PARTIAL' })];
const ok = await call();
expect('all read -> 200', ok.statusCode, 200);
expect('stored with empty unread_policies', JSON.stringify(inserted.unread_policies), '[]');
expect('stored the policies it read', inserted.policies_included.length, 2);
expect('stored the computed cross-checks', typeof inserted.cross_checks.underlying_vs_umbrella, 'object');
expect('cross-checks list the lines present', inserted.cross_checks.lines_present.join(), 'gl,auto_policy');

// --- cross-checks: never claim adequacy from missing data --------------------
policyRows = [
  policy({ file_name: 'umb.pdf', policy_type: 'umbrella', ai_raw_output: { policy_type: 'umbrella' } }),
  policy({ file_name: 'auto.pdf', policy_type: 'auto_policy' }),
];
await call();
const uvu = inserted.cross_checks.underlying_vs_umbrella[0];
expect('umbrella with no extracted requirements is flagged', uvu.requirements_extracted, false);
expect('and says so rather than implying adequacy', uvu.note.includes('do not assume'), true);

policyRows = [
  policy({ file_name: 'umb.pdf', policy_type: 'umbrella', ai_raw_output: { policy_type: 'umbrella', underlying_required: { auto_policy: '$1,000,000' } } }),
  policy({ file_name: 'auto.pdf', policy_type: 'auto_policy', ai_raw_output: { policy_type: 'auto_policy', general_review: { occurrence_limit: '$500,000' } } }),
];
await call();
const cmp = inserted.cross_checks.underlying_vs_umbrella[0].comparisons[0];
expect('underlying below requirement is detected', cmp.comparison, 'below_requirement');
expect('  required parsed from "$1,000,000"', cmp.required, 1000000);
expect('  actual parsed from "$500,000"', cmp.actual, 500000);

policyRows = [
  policy({ file_name: 'umb.pdf', policy_type: 'umbrella', ai_raw_output: { policy_type: 'umbrella', underlying_required: { auto_policy: '1M' } } }),
  policy({ file_name: 'auto.pdf', policy_type: 'auto_policy', ai_raw_output: { policy_type: 'auto_policy' } }),
];
await call();
expect('missing actual limit -> not_extracted, NOT a pass', inserted.cross_checks.underlying_vs_umbrella[0].comparisons[0].comparison, 'not_extracted');

// --- auth and origin --------------------------------------------------------
policyRows = [policy()];
expect('no password -> 401', (await call({ password: null })).statusCode, 401);
expect('wrong password -> 401', (await call({ password: 'nope' })).statusCode, 401);
expect('foreign origin -> 403', (await call({ origin: 'https://evil.example' })).statusCode, 403);
expect('no origin -> 403', (await call({ origin: null })).statusCode, 403);
expect('missing audit_id -> 400', (await call({ body: {} })).statusCode, 400);
policyRows = [];
expect('audit with no policies -> 400', (await call()).statusCode, 400);

// --- upstream failures are not masqueraded ----------------------------------
policyRows = [policy()];
anthropicResponse = { ok: false, status: 401, text: async () => 'auth error' };
const up = await call();
expect('upstream 401 -> 502, never our 401', up.statusCode, 502);
expect('  upstream status preserved', up.body.upstream_status, 401);
anthropicResponse = null;

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
