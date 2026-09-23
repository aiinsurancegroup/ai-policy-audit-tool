// The two emails the portal sends to a client: the submission receipt and the
// re-issued link. Both go to a real person unprompted, so what they may not say
// matters more than what they do.
import fs from 'node:fs';
const portal = fs.readFileSync('api/client/portal.js', 'utf8');

let pass = 0, fail = 0;
const expect = (label, actual, want) => {
  const ok = String(actual) === String(want);
  ok ? pass++ : fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}: ${actual}${ok ? '' : `  (want ${want})`}`);
};

// Isolate each function, then the HTML actually sent. Scoping the word checks
// to the body matters: the first version of this test read whole functions, so
// a doc comment explaining why the email must not mention risk counted as the
// email mentioning risk.
const fnBody = (name) => {
  const i = portal.indexOf(`async function ${name}`);
  let depth = 0, started = false, out = '';
  for (let j = i; j < portal.length; j++) {
    out += portal[j];
    if (portal[j] === '{') { depth++; started = true; }
    else if (portal[j] === '}') { depth--; if (started && depth === 0) break; }
  }
  return out;
};
// Everything between `html:` and the closing of the JSON body.
const htmlOf = (fn) => fn.slice(fn.indexOf('html:'), fn.lastIndexOf('}),'));

const receiptFn = fnBody('sendReceiptEmail');
const reissueFn = fnBody('sendLinkEmail');
const receipt = htmlOf(receiptFn);
const reissue = htmlOf(reissueFn);

console.log('--- the receipt confirms arrival and nothing else');
expect('thanks and confirms receipt', receipt.includes("we've received your documents"), true);
expect('says a person will review', receipt.includes('A licensed agent will review them'), true);
expect('  and be in touch shortly', receipt.includes('be in touch shortly'), true);

// It is sent BEFORE anything has been read, so there is nothing to report and
// nothing that could honestly be said about the documents.
console.log('\n--- it cannot leak a finding, because none exists yet');
for (const word of [
  'risk', 'RISK', 'gap', 'Gap', 'exclusion', 'finding', 'Finding',
  'result', 'Result', 'coverage gap', 'HIGH', 'MODERATE', 'score',
  'excluded', 'silent', 'verdict', 'report',
]) {
  expect(`  no "${word}"`, receipt.includes(word), false);
}

console.log('\n--- it promises no timeframe it cannot keep');
for (const t of ['24 hours', '48 hours', 'business day', 'within a day', 'tomorrow', 'immediately']) {
  expect(`  no "${t}"`, receipt.includes(t), false);
}
expect('"shortly" is the only commitment', receipt.includes('shortly'), true);

console.log('\n--- signed by the agency, not a person');
expect('signs off as the agency', receipt.includes('&mdash; The AI Insurance Group'), true);
expect('  no personal name in the body', /Sal|Martorano/.test(receipt.replace(/sal@theaiinsurancegroup\.com/g, '')), false);
expect('  from name is the agency', receiptFn.includes('from: "The AI Insurance Group'), true);

console.log('\n--- it cannot cost a submission');
expect('sent after the documents are recorded', portal.indexOf('CLIENT_SUBMITTED') < portal.indexOf('await sendReceiptEmail(audit);'), true);
expect('a failure is caught, not propagated', /try \{\s*await sendReceiptEmail\(audit\);\s*\} catch/.test(portal), true);
expect('  and logged', portal.includes('[portal] receipt email failed'), true);
expect('a missing API key is survivable', receiptFn.includes('RESEND_API_KEY not set'), true);
expect('no email without an address', receiptFn.includes('if (!audit?.client_email) return'), true);

console.log('\n--- both emails escape what they interpolate');
expect('receipt escapes the client name', receiptFn.includes('escapeHtml(audit.client_name)'), true);
expect('reissue escapes the client name', reissueFn.includes('escapeHtml(name)'), true);

console.log('\n--- the re-issue email stays a link, not a pitch');
expect('says what it is', reissue.includes('new link to send us your policy documents'), true);
for (const word of ['risk', 'gap', 'quote', 'save', 'premium']) {
  expect(`  no "${word}"`, reissue.includes(word), false);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
