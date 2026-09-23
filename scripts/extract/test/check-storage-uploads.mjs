// Storage-based document reads. Structural checks against the source, plus
// live exercises of the two path validators, which are the only pure functions
// here and the ones a traversal would come through.
import fs from 'node:fs';

const analyze = fs.readFileSync('api/analyze.js', 'utf8');
const audit = fs.readFileSync('api/admin/audit.js', 'utf8');
const portal = fs.readFileSync('api/client/portal.js', 'utf8');
const app = fs.readFileSync('src/App.jsx', 'utf8');

let pass = 0, fail = 0;
const expect = (label, actual, want) => {
  const ok = String(actual) === String(want);
  ok ? pass++ : fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}: ${actual}${ok ? '' : `  (want ${want})`}`);
};

// Lift safeStoragePath out of each file and run it for real. Both copies must
// behave identically -- they guard the same bucket from opposite ends.
const grab = (src, name) => {
  const i = src.indexOf(`function ${name}(`);
  let depth = 0, started = false, out = '';
  for (let j = i; j < src.length; j++) {
    out += src[j];
    if (src[j] === '{') { depth++; started = true; }
    else if (src[j] === '}') { depth--; if (started && depth === 0) break; }
  }
  return out;
};
const load = async (src) => (await import('data:text/javascript,' + encodeURIComponent(
  grab(src, 'safeStoragePath') + '\nexport { safeStoragePath };'
))).safeStoragePath;

const okPath = '042a6529-8f3f-4710-b3ab-634c5f98cfd4/abc123xyz_policy.pdf';

for (const [where, src] of [['analyze.js', analyze], ['admin/audit.js', audit]]) {
  const safe = await load(src);
  console.log(`\n--- ${where}: storage path validation`);
  expect('  a real path passes', safe(okPath), okPath);
  // Each of these reached the storage URL unchecked before this work.
  for (const bad of [
    '../../../etc/passwd',
    '042a6529-8f3f-4710-b3ab-634c5f98cfd4/../../other/secret.pdf',
    '/042a6529-8f3f-4710-b3ab-634c5f98cfd4/x.pdf',
    '042a6529-8f3f-4710-b3ab-634c5f98cfd4/%2e%2e/x.pdf',
    '042a6529-8f3f-4710-b3ab-634c5f98cfd4/%2Fetc/x.pdf',
    '042a6529-8f3f-4710-b3ab-634c5f98cfd4\\..\\x.pdf',
    'not-a-uuid/x.pdf',
    '042a6529-8f3f-4710-b3ab-634c5f98cfd4/a/b.pdf',
    '', null, undefined, 42, {},
  ]) {
    expect(`  rejects ${JSON.stringify(bad)}`, safe(bad), 'null');
  }
}

console.log('\n--- the document is read server-side, not carried in the body');
expect('analyze takes a storage path', analyze.includes('storage_path: storagePath'), true);
expect('  and fetches the bytes itself', analyze.includes('fetchStoredPdf'), true);
expect('the browser sends no base64', /data: buf\.toString\('base64'\)/.test(app), false);
expect('  fileToBase64 is gone entirely', app.includes('fileToBase64'), false);
expect('client submissions stop round-tripping', /download_policy[\s\S]{0,400}analyzePdf/.test(app), false);

console.log('\n--- large files go by file_id, and do not linger');
expect('inline ceiling sits under the 32MB request cap', analyze.includes('INLINE_MAX_BYTES = 20 * 1024 * 1024'), true);
expect('larger uploads to the Files API', analyze.includes('uploadToFilesApi'), true);
expect('  as raw multipart, not base64', analyze.includes('new FormData()') && analyze.includes("append('file'"), true);
expect('  Content-Type left to fetch for the boundary', /headers: \{ 'x-api-key': apiKey, 'anthropic-version'/.test(analyze), true);
// The delete has to survive a throw, a 502 and a timeout. Every exit from the
// try block above it is a return, so anywhere else would be skipped.
expect('the delete runs in a finally', /\} finally \{[\s\S]{0,800}deleteFromFilesApi/.test(analyze), true);
expect('  on an id captured outside the try', /let uploadedFileId = null;[\s\S]{0,200}try \{/.test(analyze), true);
expect('an expiry backs the delete up', analyze.includes('expires_in_seconds'), true);
expect('  set to the one-hour minimum', analyze.includes('FILE_EXPIRY_SECONDS = 3600'), true);
expect('every upload is logged', /console\.log\(`\[analyze\] files-api upload/.test(analyze), true);
expect('every delete is logged', /console\.log\(`\[analyze\] files-api delete/.test(analyze), true);
expect('  including when it fails', /files-api delete \$\{fileId\} threw/.test(analyze), true);

console.log('\n--- admin uploads are stored, like the portal"s');
expect('admin can mint a signed upload url', audit.includes('action === "upload_url"'), true);
expect('  the server owns the path', audit.includes('`${body.audit_id}/${randomSegment()}_${fileName}`'), true);
expect('  and checks the audit id is a uuid', audit.includes('UUID_RE.test'), true);
expect('the browser uploads straight to storage', app.includes("supabase.storage.from('policies').uploadToSignedUrl"), true);
for (const [label, re] of [
  ['new audit', /policy_type:[\s\S]{0,200}storage_path: storagePath,/],
  ['add policy', /file_size_bytes: file\.size, storage_path: storagePath/],
]) {
  expect(`  ${label} records the path`, re.test(app), true);
}
expect('replace moves the path with the file', app.includes('storage_path: storagePath }'), true);
expect('re-run needs no download', /rerunPolicy[\s\S]{0,400}download_policy/.test(app), false);

console.log('\n--- re-run is offered on every stored row, not only failed ones');
// A prompt change is a reason to re-run a policy that succeeded, so the action
// row is no longer gated on the row having failed.
expect('actions are not gated on failure', app.includes('{failed2 && (\n                    <div style={{ display'), false);
expect('  they are gated on the audit being a draft', /\{isDraft && \(\s*<div style=\{\{ display: 'flex', gap: 6, justifyContent: 'flex-end'/.test(app), true);
expect('re-run still requires a stored document', /\{pol\.storage_path \? \([\s\S]{0,300}rerunPolicy/.test(app), true);
expect('  and says so plainly when there is none', app.includes('not stored — cannot re-run'), true);
// A re-run replaces the findings, and review state is keyed by position.
expect('a re-run clears that row"s review state', app.includes('const stale = new RegExp(`^${idx}-`)'), true);
expect('  both actions and notes', /setFActions\(prev[\s\S]{0,200}setFNotes\(prev/.test(app), true);
expect('  found by id, not by stale index', app.includes('pols.findIndex(p => p.id === pol.id)'), true);

console.log('\n--- size limits agree across the three places that enforce them');
expect('portal', portal.includes('MAX_FILE_BYTES = 25 * 1024 * 1024'), true);
expect('admin endpoint', audit.includes('MAX_FILE_BYTES = 25 * 1024 * 1024'), true);
expect('browser', app.includes('MAX_PDF_BYTES = 25 * 1024 * 1024'), true);
// The bulk path was the one route with no check at all.
expect('the bulk upload path checks size', app.includes('files.filter(f => f.size > MAX_PDF_BYTES)'), true);
expect('  and names every offending file', app.includes('tooBig.map'), true);
expect('page limit is stated, not predicted', app.includes('PAGE_LIMIT_HINT'), true);
expect('  and says what to do about it', app.includes('split it and upload each part'), true);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
