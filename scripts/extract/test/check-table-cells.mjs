// The cell formatters, against the real carrier and premium strings from the
// Shamrock audit and the umbrella. Pure functions, no network.
import fs from 'node:fs';
const src = fs.readFileSync('api/admin/program-report.js', 'utf8');

// Pull the two functions out of the module so they can be exercised directly
// without importing the handler (which expects env vars and fetch).
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
const consts = src.slice(src.indexOf('const CARRIER_SHORT'), src.indexOf('function shortCarrier'));
const mod = await import('data:text/javascript,' + encodeURIComponent(
  consts + grab('shortCarrier') + grab('premiumTotal') + '\nexport { shortCarrier, premiumTotal };'
));

let pass = 0, fail = 0;
const expect = (label, actual, want) => {
  const ok = String(actual) === String(want);
  ok ? pass++ : fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}: ${actual}${ok ? '' : `  (want ${want})`}`);
};

console.log('--- carrier short names (real values from the audit)');
expect('Hanover',      mod.shortCarrier('The Hanover Insurance Company (Hanover Insurance Group)'), 'Hanover');
expect('AIG from parenthetical', mod.shortCarrier('National Union Fire Insurance Company of Pittsburgh, Pa. (AIG)'), 'AIG');
expect('General Star', mod.shortCarrier('General Star Indemnity Company'), 'General Star');
expect('Ironshore, NOT Liberty Mutual', mod.shortCarrier('Ironshore Specialty Insurance Company (Liberty Mutual)'), 'Ironshore');
expect('Markel',       mod.shortCarrier('Markel Insurance Company'), 'Markel');
expect("Lloyd's",      mod.shortCarrier("Certain Underwriters at Lloyd's, London"), "Lloyd's");
expect('unknown carrier falls back to two words', mod.shortCarrier('Acme Widget Insurance Company'), 'Acme Widget');
expect('null carrier stays null', mod.shortCarrier(null), 'null');

console.log('\n--- premium: total only, no fees or parentheticals');
expect('labelled total wins', mod.premiumTotal('Total Policy Premium: $4,976'), '$4,976');
expect('fee alongside is excluded', mod.premiumTotal('$4,961 plus NJPLIGA $15'), '$4,961');
expect('parenthetical stripped', mod.premiumTotal('$12,500 (includes $300 terrorism)'), '$12,500');
expect('bare figure passes through', mod.premiumTotal('$8,200.00'), '$8,200.00');
expect('USD prefix (the APD case)', mod.premiumTotal('USD 13,313.00'), '$13,313.00');
expect('US$ prefix', mod.premiumTotal('US$9,500'), '$9,500');
expect('USD with a labelled total', mod.premiumTotal('Total Premium USD 13,313.00'), '$13,313.00');
expect('labelled total with no symbol at all', mod.premiumTotal('Total Policy Premium 7,412.50'), '$7,412.50');
expect('no figure -> null', mod.premiumTotal('not shown on the declarations'), 'null');
expect('null in, null out', mod.premiumTotal(null), 'null');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
