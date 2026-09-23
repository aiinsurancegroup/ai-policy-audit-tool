// Generates src/BrandLogo.jsx from the supplied logo SVGs.
//
// Kept in the repo so the artwork can be regenerated if the logo changes:
// point SRC and DARK at the new files and run `node scripts/gen-logo.mjs`.
// The path data is never transcribed by hand.
//
// The light-background and dark-background files are byte-identical except for
// one fill -- the wordmark ink -- so only one copy of the artwork is embedded
// and that fill is the single prop. Two copies could drift; one cannot.
import fs from 'node:fs';

const SRC = 'C:/Users/gathe/Downloads/AI_Insurance_Group_Logo_Light_Background (1).svg';
const DARK = 'C:/Users/gathe/Downloads/AI_Insurance_Group_Logo_White_Text_FIXED.svg';

const light = fs.readFileSync(SRC, 'utf8');
const dark = fs.readFileSync(DARK, 'utf8');

const fills = (s) => [...s.matchAll(/fill="([^"]+)"/g)].map((m) => m[1]);
const fl = fills(light), fd = fills(dark);
const varyIdx = fl.map((f, i) => (f !== fd[i] ? i : -1)).filter((i) => i >= 0);
if (varyIdx.length !== 1) throw new Error(`expected exactly one differing fill, got ${varyIdx.length}`);
if (fl[varyIdx[0]] !== '#121E2D' || fd[varyIdx[0]] !== '#FFFFFF') {
  throw new Error(`unexpected ink pair: ${fl[varyIdx[0]]} / ${fd[varyIdx[0]]}`);
}

const els = [...light.matchAll(/<(rect|path)\b([^>]*?)\/?>/g)].map((m) => ({ tag: m[1], attrs: m[2] }));
if (els.length !== 6) throw new Error(`expected 6 elements, got ${els.length}`);

const attrPairs = (s) => [...s.matchAll(/([a-zA-Z-]+)="([^"]*)"/g)].map((m) => [m[1], m[2]]);

let fillSeen = -1;
const body = els.map(({ tag, attrs }) => {
  const parts = attrPairs(attrs).map(([k, v]) => {
    if (k === 'fill') {
      fillSeen++;
      if (fillSeen === varyIdx[0]) return `fill={ink}`;
    }
    return `${k}="${v}"`;
  });
  return `      <${tag} ${parts.join(' ')} />`;
}).join('\n');

const out = `// GENERATED from the supplied logo SVGs -- do not hand-edit the path data.
// Regenerate with scripts/gen-logo.mjs if the artwork changes.
//
// The artwork is inlined rather than linked. A linked file is a network fetch,
// and a browser printing to PDF will happily produce the page without it --
// which would drop the logo from a client deliverable silently.
//
// The light- and dark-background versions supplied were identical but for the
// wordmark ink, so the artwork appears once here and the ink is the only prop.
import React from 'react';

export const BRAND_NAVY = '#121E2D';
export const BRAND_GOLD = '#B8972A';

export default function BrandLogo({ tone = 'light', width = 180, style }) {
  const ink = tone === 'dark' ? '#FFFFFF' : BRAND_NAVY;
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 280 52"
      width={width}
      height={(width * 52) / 280}
      role="img"
      aria-label="The AI Insurance Group"
      style={style}
    >
    <g transform="translate(0,-19)">
${body}
    </g>
    </svg>
  );
}
`;

fs.writeFileSync('src/BrandLogo.jsx', out);
console.log(`wrote src/BrandLogo.jsx (${out.length} bytes), variable fill at index ${varyIdx[0]}`);
