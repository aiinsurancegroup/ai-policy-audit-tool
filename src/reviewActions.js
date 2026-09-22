// Pure helpers for finding review, kept out of App.jsx so the rule that
// matters can actually be tested: a bulk confirm must never overwrite a
// finding the operator has already judged.

const findingsOf = (policy) => policy?.ai_raw_output?.findings || [];
const inScope = (pi, policyIndex) => policyIndex === undefined || pi === policyIndex;

// How many findings are still unreviewed, for one policy or the whole audit.
export function unreviewedCount(policies, actions, policyIndex) {
  let n = 0;
  (policies || []).forEach((p, pi) => {
    if (!inScope(pi, policyIndex)) return;
    findingsOf(p).forEach((_, fi) => { if (!actions[`${pi}-${fi}`]) n++; });
  });
  return n;
}

// The actions a bulk confirm would add. Only ever fills in keys that are
// currently empty: a finding already marked REJECTED or MODIFIED is left
// exactly as it is, so clicking "confirm remaining" cannot quietly turn a
// rejection into an acceptance. Returns a patch rather than a merged object so
// the caller can see precisely what changed, and what to log.
export function bulkConfirmPatch(policies, actions, policyIndex) {
  const patch = {};
  const perFile = [];
  (policies || []).forEach((p, pi) => {
    if (!inScope(pi, policyIndex)) return;
    let n = 0;
    findingsOf(p).forEach((_, fi) => {
      const k = `${pi}-${fi}`;
      if (!actions[k]) { patch[k] = 'CONFIRMED'; n++; }
    });
    if (n) perFile.push(`${p.file_name} (${n})`);
  });
  return { patch, count: Object.keys(patch).length, perFile };
}
