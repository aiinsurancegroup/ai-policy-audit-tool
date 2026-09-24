# ai-policy-audit-tool

The coverage-review tool. Reads a client's actual policy documents, produces a
Level 1 internal report and a Level 3 **client-facing PDF**, and serves the
client portal. React + Vite on Vercel, Supabase behind it, shared project
`dtgsegabaivtgyccrcxi` with the marketing site.

Two things here reach a client under a producer licence — the printed report and
the portal — so a lot of the copy is **regulated**. A sentence that overstates
what a policy does, or a licence number in the wrong place, is a compliance
problem rather than a typo. The rule below exists for that copy.

---

## Mutation-check every test that pins regulated copy

**Before committing a test that guards regulated copy: change the guarded text,
run the test, confirm it fails, then restore it.** A test that cannot fail is
worse than no test, because it reads as protection.

```
1. Edit the source string so the guard should trip
2. node scripts/extract/test/check-client-document.mjs   -> the assertion MUST fail
3. Restore the string (git checkout, or a saved copy)
4. Re-run                                                -> back to green
5. git status                                            -> nothing left mutated
```

Note in the commit message that the check was done and what was mutated.

### Read the failure, not just the count

A mutation that produces *a* failure has not necessarily been caught by the
guard you were testing. Both of these happened on the day this rule was written:

- A mutation meant to test the solicitation guard was applied **outside** the
  slice that guard reads, and tripped an unrelated exact-match assertion
  instead. It looked caught. The guard had not run at all.
- A mutation dropping the licence number from the report footer was **missed**:
  the assertion was `src.includes(number)` against the whole file, and the number
  is in `BRAND` twice — once as `licence`, once inside `footer`. Stripping the
  footer left the other copy, and the test stayed green.

So: check that the assertion which failed is the one you meant to exercise, and
pin the **whole line** rather than a substring that appears in several places.

### Guard the slice you mean

`check-client-document.mjs` reads `src` (all of `src/App.jsx`) and derives
`body` (the `ClientDocument` component only). Anything in `body` is necessarily
in `src`, so `src.includes(x) && body.includes(x)` is not two checks — it is
`body.includes(x)` with a decoration that hides the fact. Assert against the
narrowest slice that expresses the rule.

---

## What counts as regulated copy

| What | Where | Guard |
| --- | --- | --- |
| Report footer, licence number, contact line | `BRAND` in `src/App.jsx` (`licence`, `contact`, `footer`) | footer pinned as a whole line |
| Agency phone **732-314-1093** | `BRAND.contact`, `BRAND.footer`, the "questions about this report" block | pinned, and the old personal mobile 917-981-0245 pinned absent |
| No solicitation in the client document | `ClientDocument` in `src/App.jsx` | `Alexander`, `Munich Re`, `Lloyd's`, `Ready to Close` all absent |
| No solicitation in the generator | `api/admin/program-report.js` | same list, **`CARRIER_SHORT` exempted** — see below |
| Nothing internal reaches the client | `ClientDocument` | `agent_notes`, `lead_hook`, `primary_opportunity`, `talking_points`, `urgency`, `estimated_premium_impact`, `program_findings`, `synthesis`, `ai_raw_output` all absent |
| No upload file name reaches the client | `ClientDocument` | `p.policy` never rendered raw; resolved via `describePolicy`, prose through `scrub` |
| Portal consent text | `CONSENT_TEXT` in `api/client/portal.js` **and** `src/App.jsx` | pinned byte-identical across both copies |
| Coverage-position honesty | `api/admin/program-report.js` | `present` / `absent` / `not_supplied` / `unread` and the guards that constrain them |

### The one Lloyd's exemption, and why

`CARRIER_SHORT` in `api/admin/program-report.js` maps
`/lloyd/i` → `"Lloyd's"`, turning "Certain Underwriters at Lloyd's, London" — as
printed on a client's own declarations page — into a short name for the policy
table. That is **naming a carrier the client already bought from**, the opposite
of a solicitation, and deleting it would break reading real Lloyd's-placed
policies.

The exemption is scoped to the `CARRIER_SHORT` block, not the file. Write
"placed at Lloyd's" into a prompt anywhere else in that file and the guard fails.

---

## Other standing rules

- **No guessing on regulated language.** If a sentence asserts something about
  insurance and you cannot source it, raise it instead of writing it.
- **Only one guard in this repo may ever raise a claim** — the declined-election
  upgrade in `api/admin/program-report.js`, which carries a comment saying so.
  Every other guard downgrades only. Do not treat it as a precedent.
- **Facts are computed in code; the model's `policy_table` is discarded** for the
  computed one. Keep that split.
- **Strings duplicated across repositories** — the portal consent text, the blog
  author byline (`blog_posts.author_bio` default, migration 13, matching
  `src/contact.js` in the marketing repo) — have no build-time link. A test pins
  each; change one copy, change the other and the test.
- **Show every migration before running it**, and keep the numbered file in
  `migrations/` even when the change was applied from elsewhere. The sequence is
  complete through 13 and should stay that way.
- **`fixtures/private/` holds a real client's policies** with VINs, dates of
  birth, loan numbers and addresses. Nothing about them gets committed.
- **Run this repo's tests after changing anything it prints.** The phone number
  was changed across both repos on 2026-09-24 and only the marketing suite was
  run; the pin here sat failing until the next time someone looked.
