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
// Navy and gold come from the logo artwork itself rather than being retyped,
// so the document cannot drift out of register with the mark.
const logo = fs.readFileSync('src/BrandLogo.jsx', 'utf8');
expect('brand navy is the logo navy', logo.includes("BRAND_NAVY = '#121E2D'"), true);
expect('brand gold is the logo gold', logo.includes("BRAND_GOLD = '#B8972A'"), true);
expect('  the document imports them, not copies', src.includes('navy: BRAND_NAVY') && src.includes('gold: BRAND_GOLD'), true);
expect('  the old navy is gone', src.includes('#0F2847'), false);

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

console.log('\n--- no upload file name can reach the client');
// coverage_position.policy holds the file name as an internal key. The client
// must see the carrier and policy number instead, so the raw value may never
// be rendered and every piece of model prose must go through the scrubber.
expect('policy key is never rendered raw', /\{p\.policy\}|\{p\.policy \}/.test(body), false);
expect('it is resolved to carrier and number', body.includes('describePolicy(p.policy)'), true);
expect('describePolicy reads the computed table', body.includes("table.find(r => r.file_name === fileName)"), true);
expect('  and names carrier, line and number', /carrier_short \|\| row\.carrier/.test(body) && body.includes('row.policy_number'), true);
expect('gap notes are scrubbed', body.includes('detail={scrub(p.note)}'), true);
expect('recommendations are scrubbed', body.includes('{scrub(r)}'), true);
expect('the scrubber strips the extension too', body.includes("replace(/\\.pdf$/i, '')"), true);
expect('prompt tells the model not to name a file', server.includes('NEVER name an upload file here'), true);

console.log('\n--- the design is print, not web UI');
expect('status marks are dots, not glyphs', /borderRadius: '50%'/.test(body), true);
expect('  no tick glyph', body.includes('✓'), false);
expect('  no bang glyph', /'!'|>!</.test(body), false);
expect('cover carries the logo, not a text wordmark', /<BrandLogo tone="light" width=\{180\}/.test(body), true);
expect('footer carries a small logo', /<BrandLogo tone="light" width=\{86\}/.test(body), true);
expect('section rules are gold', body.includes("borderBottom: '1px solid ' + BRAND.gold"), true);
expect('section headings are gold', /section: \{[^}]*color: BRAND\.gold/.test(body), true);
expect('expired terms are muted red', body.includes('TERM_EXPIRED'), true);
expect('  in-force muted green', body.includes('TERM_INFORCE'), true);
expect('  neither is the app UI signal colour', /TERM_EXPIRED = '#9B2C2C'/.test(src) && /TERM_INFORCE = '#2F6B4F'/.test(src), true);
expect('table rows are banded', body.includes("i % 2 ? '#F8FAFC'"), true);
expect('figures are right-aligned', body.includes("textAlign: 'right'"), true);
expect('sections cannot split across a page', body.includes('className={`pdf-keep${breakBefore'), true);
expect('the cover stands alone', body.includes('title="Coverage Summary" breakBefore'), true);
expect('print keeps background colours', fs.readFileSync('index.html', 'utf8').includes('print-color-adjust: exact'), true);
expect('policy numbers never break mid-number', body.includes("wordBreak: 'break-all'"), false);
expect('  they stay on one line', /policy_number[\s\S]{0,40}$|whiteSpace: 'nowrap'/.test(body), true);
// Tracking wide enough to space small caps, not so wide the word comes apart.
// The cover lockup carries the most of any element and still sits under 2.
const tracking = [...body.matchAll(/letterSpacing: ([\d.]+)/g)].map(m => parseFloat(m[1]));
expect('heading tracking stays readable', tracking.every(t => t <= 2), true);
expect('  section headings tightest of all', /section: \{[^}]*letterSpacing: 0\.9/.test(body), true);

console.log('\n--- the logo is inlined, not linked');
// A linked asset is a network fetch, and a browser printing to PDF will
// produce the page without it -- silently dropping the logo from a client
// deliverable. Inlined artwork cannot fail that way.
expect('no <img> in the document', /<img\b/.test(body), false);
expect('no url() reference', /url\(/.test(body), false);
expect('artwork is real SVG paths', (logo.match(/<path /g) || []).length >= 5, true);
expect('  with no embedded raster', /base64|<image/.test(logo), false);
expect('  and no live text', /<text/.test(logo), false);
// One copy of the artwork, one variable fill. Two copies could drift apart.
expect('one copy of the artwork', (logo.match(/viewBox="0 0 280 52"/g) || []).length, 1);
expect('  ink is the only variable', logo.includes("const ink = tone === 'dark' ? '#FFFFFF' : BRAND_NAVY"), true);

console.log('\n--- the cover block and summary lines');
expect('prepared for renders only when supplied', body.includes('(audit.named_insured || audit.mailing_address)'), true);
expect('  named insured', body.includes('{audit.named_insured}'), true);
expect('  address keeps its line breaks', body.includes("whiteSpace: 'pre-line'"), true);
for (const line of ['Policies reviewed', 'Gaps identified', 'Next renewal']) {
  expect(`  summary line: ${line}`, body.includes(line), true);
}
expect('counts are computed, not stated', body.includes('String(table.length)') && body.includes('String(gaps.length)'), true);
// An expired date is not a renewal to plan for; showing one would be worse
// than showing nothing.
expect('next renewal excludes expired terms', body.includes("r.term_status?.state !== 'expired'"), true);
expect('  and takes the soonest', body.includes('upcoming[0]'), true);

console.log('\n--- absent and not_supplied stay distinct');
// A one-sided exemplar collapsed this once already: the note field demonstrated
// an output shape for not_supplied and for no other state, and the model
// pattern-matched an entire program into it -- burying a real gap the earlier
// run had found. Every state that appears in a client section gets an exemplar,
// or none does.
const noteField = server.slice(server.indexOf('"note": "one short clause'), server.indexOf('"client_recommendations"'));
expect('absent has a worked exemplar', noteField.includes('for absent, say what the documents show is not carried'), true);
expect('not_supplied has one too', noteField.includes('for not_supplied, say what we need from them'), true);
expect('  and present', noteField.includes('for present, one clause'), true);
expect('the tell-tale is named', noteField.includes("A note ending in 'send us...' on a line you marked absent"), true);
// The standing rule pushed only one way: it warned what a wrong "absent" costs
// and never what a wrong "not_supplied" costs.
expect('both directions of error are stated', server.includes('BOTH directions of error are real'), true);
expect('  burying a real gap is named a failure', server.includes('buries the finding they came for'), true);
expect('  claiming unknown absence still is too', server.includes('claims knowledge we do not have'), true);
expect('evidence decides, not caution', server.includes('The test is what the documents show, NOT how cautious you feel'), true);
expect('  and a whole list may not default to one state', server.includes('Do not default a whole list to one state'), true);

console.log('\n--- the render keeps the two apart');
expect('gaps read the absent state', body.includes("position.filter(p => p.state === 'absent')"), true);
expect('not-provided reads its own', body.includes("position.filter(p => p.state === 'not_supplied')"), true);
expect('  they are separate sections', body.includes('title="Coverage Gaps"') && body.includes('title="Not provided for review"'), true);

console.log('\n--- the report speaks in our own voice');
// We are the broker. A recommendation telling the client to ask their broker
// refers them to us, and reads as though someone else handles their account.
const forbids = server.slice(server.indexOf('NEVER write "ask your broker"'), server.indexOf('WHOSE VOICE THIS IS') + 1200);
for (const phrase of ['ask your broker', 'your agent', 'your agency', 'an insurance professional', 'speak to your carrier']) {
  expect(`  prompt names "${phrase}" as forbidden`, forbids.includes(phrase), true);
}
expect('prompt states who is writing', server.includes("written BY the client's broker"), true);
expect('  and asks for first person plural', server.includes('We recommend'), true);
expect('client-read notes are addressed to the client', server.includes('THE CLIENT READS THIS'), true);
expect('  not written about them', server.includes("never 'confirm with the client'"), true);

console.log('\n--- recommendations originate in Level 1');
expect('client_recommendations produced by the server', server.includes('client_recommendations'), true);
expect('  and read by the document', body.includes('client_recommendations'), true);
expect('  prompt forbids premium estimates in them', server.includes('never a premium saving or estimate'), true);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
