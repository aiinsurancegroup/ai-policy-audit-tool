// The absent/not_supplied constraint, run for real against the lines two live
// Shamrock reports actually produced.
//
// The rule: a line may only be called absent if the audit was given the kind of
// policy that would carry it. A general liability policy declining its cyber
// coverage part says the line is not on THAT policy -- it is silent on whether
// the client buys cyber from someone else.
import fs from 'node:fs';
const src = fs.readFileSync('api/admin/program-report.js', 'utf8');

const grab = (name) => {
  const i = src.indexOf(`function ${name}(`);
  let depth = 0, started = false, out = '';
  for (let j = i; j < src.length; j++) {
    out += src[j];
    if (src[j] === '{') { depth++; started = true; }
    else if (src[j] === '}') { depth--; if (started && depth === 0) break; }
  }
  return out;
};
const table = src.slice(src.indexOf('const LINE_HOST_TYPES'), src.indexOf('// Downgrade "absent"'));
const { constrainAbsent } = await import('data:text/javascript,' + encodeURIComponent(
  table + grab('constrainAbsent') + '\nexport { constrainAbsent };'
));

let pass = 0, fail = 0;
const expect = (label, actual, want) => {
  const ok = String(actual) === String(want);
  ok ? pass++ : fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}: ${actual}${ok ? '' : `  (want ${want})`}`);
};

const abs = (line, note) => ({ line, state: 'absent', note });

// --- the single-GL audit: the report that over-asserted -------------------
const glOnly = [{ policy_type: 'gl', file_name: 'gl.pdf' }];

console.log('--- one GL policy cannot rule these out program-wide');
// Every one of these was marked absent on the strength of the GL policy
// showing the coverage part as not purchased.
for (const line of [
  'Cyber Liability / Data Breach',
  'Employment Practices Liability',
  'Site Pollution / Environmental Legal Liability',
  'Contractors Professional / Design-Build E&O',
  'Umbrella / Excess over General Liability',
]) {
  const { position } = constrainAbsent([abs(line, 'The coverage part was not purchased.')], glOnly);
  expect(`  ${line}`, position[0].state, 'not_supplied');
}

console.log('\n--- and the downgraded note asks rather than asserts');
const one = constrainAbsent([abs('Cyber Liability / Data Breach', 'Coverage Part V was not purchased.')], glOnly).position[0];
expect('keeps what the document showed', one.note.includes('Coverage Part V was not purchased'), true);
expect('  and asks the question', one.note.includes('standalone policy'), true);
expect('  with no doubled full stop', /\.\s*—/.test(one.note), false);
const bare = constrainAbsent([abs('Cyber Liability', '')], glOnly).position[0];
expect('an empty note still asks', bare.note.includes('tell us whether you hold one'), true);

console.log('\n--- the full program: what it CAN still rule out');
// The five-policy audit held the excess auto policy, so a line struck by
// endorsement at that layer is genuinely ruled out program-wide.
const fullProgram = [
  { policy_type: 'gl' }, { policy_type: 'auto_policy' }, { policy_type: 'excess_auto' },
  { policy_type: 'auto_physical_damage' }, { policy_type: 'property' },
];
for (const [line, want] of [
  ['Hired and Non-Owned Auto (excess layer)', 'absent'],
  ['Umbrella / Excess over General Liability', 'absent'],
  // Still standalone lines, still not ruled out by any of the five.
  ['Cyber Liability / Data Breach', 'not_supplied'],
  ['Employment Practices Liability', 'not_supplied'],
  ['Commercial Crime / Employee Dishonesty', 'not_supplied'],
  ['Motor Truck Cargo', 'not_supplied'],
  ['Workers Compensation & Employers Liability', 'not_supplied'],
]) {
  const { position } = constrainAbsent([abs(line, 'note')], fullProgram);
  expect(`  ${line}`, position[0].state, want);
}

console.log('\n--- the guard only ever claims less, never more');
for (const state of ['present', 'not_supplied', 'unread']) {
  const { position } = constrainAbsent([{ line: 'Cyber Liability', state, note: 'x' }], glOnly);
  expect(`  ${state} is left alone`, position[0].state, state);
}
const unmapped = constrainAbsent([abs('Kidnap and Ransom', 'n')], glOnly).position[0];
expect('an unrecognised line is left to the prompt', unmapped.state, 'absent');
expect('nothing is ever upgraded to absent', constrainAbsent(
  [{ line: 'Cyber Liability', state: 'not_supplied', note: 'x' }], fullProgram
).position[0].state, 'not_supplied');

console.log('\n--- what was downgraded is reported, not silent');
const many = constrainAbsent(
  [abs('Cyber Liability', 'a'), abs('Employment Practices Liability', 'b'), abs('General Liability', 'c')],
  glOnly
);
expect('two downgraded', many.downgraded.length, 2);
expect('  GL itself untouched, it was supplied', many.position[2].state, 'absent');
expect('the server logs them', src.includes('downgraded absent -> not_supplied'), true);

console.log('\n--- the prompt states the rule too');
expect('program-wide is the test', src.includes('RULE THE LINE OUT ACROSS THE WHOLE PROGRAM'), true);
expect('the not-purchased case is named explicitly', src.includes('A COVERAGE PART NOT PURCHASED ON A SUPPLIED POLICY IS "not_supplied"'), true);
expect('  with the reason it matters', src.includes('no cyber cover when the policy naming that gap'), true);
expect('audit scope is weighed', src.includes('single-policy audit can almost never support'), true);
expect('no quota is implied', src.includes('a quota'), true);
// The old exemplar that caused this.
expect('the wrong exemplar is gone', src.includes('a coverage part marked not purchased or not offered, an exclusion'), false);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
