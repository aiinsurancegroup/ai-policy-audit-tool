// Level 3 guards, checked against the source rather than a rendered DOM.
//
// The rule being enforced is that the client document can contain nothing the
// operator did not already see in Level 1, and nothing internal. It renders
// from the stored row and makes no API call, so the check is structural: the
// component must not reference the internal fields at all, and must not be
// reachable except from a validated audit that has a report.
import fs from 'node:fs';

const src = fs.readFileSync('src/App.jsx', 'utf8');
const server = fs.readFileSync('api/admin/program-report.js', 'utf8');

const start = src.indexOf('function ClientDocument');
const body = src.slice(start, src.indexOf('const genId =', start));

let pass = 0, fail = 0;
const expect = (label, actual, want) => {
  const ok = String(actual) === String(want);
  ok ? pass++ : fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}: ${actual}${ok ? '' : `  (want ${want})`}`);
};

console.log('--- nothing internal can reach the client document');
for (const field of ['agent_notes', 'lead_hook', 'primary_opportunity', 'talking_points', 'urgency', 'estimated_premium_impact', 'program_findings', 'synthesis', 'ai_raw_output']) {
  expect(`  never references ${field}`, body.includes(field), false);
}

console.log('\n--- it renders, it does not analyse');
expect('makes no fetch call', /fetch\s*\(/.test(body), false);
expect('never calls the analysis endpoint', body.includes('/api/analyze'), false);
expect('never calls the program report endpoint', body.includes('program-report'), false);

console.log('\n--- reachable only from a finalized audit with a report');
const guard = src.slice(src.indexOf("if (screen === 'client-doc')"), src.indexOf("if (screen === 'activity-log')"));
expect('guard requires VALIDATED status', guard.includes("curAudit.status !== 'VALIDATED'"), true);
expect('guard requires a stored report', guard.includes('!progReport'), true);
expect('guard sends you back rather than rendering', guard.includes("setScreen('report')"), true);
expect('button only offered when not a draft', /\{!isDraft && \(\s*progReport/.test(src), true);
expect('  and only when a report exists', /progReport\s*\?\s*<button[^>]*Client Document|Client Document/.test(src), true);

// The branding constants sit above the component, so check the whole file.
console.log('\n--- branding, exactly as specified');
expect('wordmark', src.includes("wordmark: 'The AI Insurance Group'"), true);
expect('subtitle', src.includes("subtitle: 'Coverage Review Report'"), true);
expect('prepared by', src.includes("preparedBy: 'Prepared by Sal Martorano'"), true);
expect('licence number in footer', src.includes('NJ Insurance Producer License No. 3004245927'), true);
expect('contact email', src.includes('sal@theaiinsurancegroup.com'), true);
expect('phone', src.includes('917-981-0245'), true);
expect('brand navy', src.includes("navy: '#0F2847'"), true);

console.log('\n--- the required sections');
for (const section of ['Coverage Summary', 'Coverage In Place', 'Coverage Gaps', 'Recommendations', 'Basis of this review']) {
  expect(`  ${section}`, body.includes(section), true);
}
expect('gaps and not-provided are separated', body.includes('Not provided for review'), true);
expect('not-provided says it may be in force', src.includes('may well be in force'), true);

console.log('\n--- file name and document title');
expect('title is client name, purpose, date', body.includes('`${audit.client_name} — Coverage Review — ${isoDate}`'), true);
expect('document.title is set from it', body.includes('document.title = docTitle'), true);
expect('  and restored on unmount', body.includes('document.title = previous'), true);
expect('dated by validated_at first', body.includes('audit.validated_at'), true);
expect('  then the report date', body.includes('report?.generated_for_date'), true);
expect('cover shows the same date, not today', body.includes('{longDate}') && !body.includes('{today}'), true);

console.log('\n--- no solicitation reaches the client document');
for (const phrase of ['Alexander', 'Munich Re', "Lloyd's", 'Ready to Close']) {
  expect(`  no "${phrase}"`, src.includes(phrase) && body.includes(phrase), false);
}

console.log('\n--- recommendations originate in Level 1');
expect('client_recommendations produced by the server', server.includes('client_recommendations'), true);
expect('  and read by the document', body.includes('client_recommendations'), true);
expect('  prompt forbids premium estimates in them', server.includes('never a premium saving or estimate'), true);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
