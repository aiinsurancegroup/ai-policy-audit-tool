// Bulk confirm. The rule with consequences: it must never overwrite a finding
// the operator has already judged, because turning a Reject into a Confirm
// silently would put a rejected finding into a delivered report.
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const { unreviewedCount, bulkConfirmPatch } =
  await import(pathToFileURL(path.resolve('src/reviewActions.js')).href);

let pass = 0, fail = 0;
const expect = (label, actual, want) => {
  const ok = String(actual) === String(want);
  ok ? pass++ : fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}: ${actual}${ok ? '' : `  (want ${want})`}`);
};

const pol = (file, n) => ({ file_name: file, ai_raw_output: { findings: Array.from({ length: n }, (_, i) => ({ description: `f${i}` })) } });
const policies = [pol('gl.pdf', 3), pol('auto.pdf', 2), pol('umb.pdf', 0)];

console.log('--- counting');
expect('all unreviewed at the start', unreviewedCount(policies, {}), 5);
expect('scoped to one policy', unreviewedCount(policies, {}, 0), 3);
expect('a policy with no findings counts zero', unreviewedCount(policies, {}, 2), 0);
expect('already-reviewed are not counted', unreviewedCount(policies, { '0-0': 'CONFIRMED', '1-1': 'REJECTED' }), 3);

console.log('\n--- bulk confirm never overwrites a judgement already made');
const existing = { '0-0': 'REJECTED', '0-1': 'MODIFIED', '1-0': 'CONFIRMED' };
const { patch, count, perFile } = bulkConfirmPatch(policies, existing);
expect('only the two untouched findings are filled', count, 2);
expect('  a REJECTED finding is left alone', patch['0-0'] === undefined, true);
expect('  a MODIFIED finding is left alone', patch['0-1'] === undefined, true);
expect('  an already CONFIRMED one is not re-set', patch['1-0'] === undefined, true);
expect('  the unreviewed ones become CONFIRMED', `${patch['0-2']},${patch['1-1']}`, 'CONFIRMED,CONFIRMED');
expect('the patch never contains anything but CONFIRMED', Object.values(patch).every(v => v === 'CONFIRMED'), true);

console.log('\n--- what gets logged');
expect('per-file counts for the log entry', perFile.join(' '), 'gl.pdf (1) auto.pdf (1)');
expect('a policy with nothing to confirm is not listed', perFile.some(f => f.startsWith('umb.pdf')), false);

console.log('\n--- scoping to a single policy');
const one = bulkConfirmPatch(policies, {}, 1);
expect('only that policy is touched', one.count, 2);
expect('  and only its keys', Object.keys(one.patch).every(k => k.startsWith('1-')), true);
expect('  logged against that file alone', one.perFile.join(), 'auto.pdf (2)');

console.log('\n--- nothing to do');
const allDone = { '0-0': 'CONFIRMED', '0-1': 'CONFIRMED', '0-2': 'CONFIRMED', '1-0': 'CONFIRMED', '1-1': 'CONFIRMED' };
expect('no findings left -> empty patch', bulkConfirmPatch(policies, allDone).count, 0);
expect('  so the caller logs nothing', unreviewedCount(policies, allDone), 0);

console.log('\n--- degenerate input');
expect('no policies', bulkConfirmPatch([], {}).count, 0);
expect('undefined policies', bulkConfirmPatch(undefined, {}).count, 0);
expect('policy with no analysis output', bulkConfirmPatch([{ file_name: 'x.pdf' }], {}).count, 0);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
