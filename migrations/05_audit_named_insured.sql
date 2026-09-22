-- 05: the named insured and mailing address, for the client document cover.
--
-- Neither is captured anywhere in the pipeline today. The per-policy analysis
-- records the carrier, policy number and dates but never the insured or the
-- address, and the program-report pass reads only those analyses -- so asking
-- a model for them would produce an invented address on the cover of a client
-- deliverable. They are operator-entered instead.
--
-- Stage 2 adds both fields to the per-policy extraction so new audits fill
-- themselves in; these columns stay the override and continue to win when set.
-- That is not a convenience: a declarations page reads "Thomas F. Corbett
-- Associates, LLC DBA Shamrock Materials LLC", which is correct on paper and
-- wrong on a cover addressed to the client.
--
-- Additive only. Both columns are nullable with no default, so every existing
-- row stays valid and the cover block simply does not render without them.

alter table public.audits
  add column if not exists named_insured   text,
  add column if not exists mailing_address text;

comment on column public.audits.named_insured is
  'Legal named insured as it should appear to the client. Operator-entered; overrides anything extracted.';
comment on column public.audits.mailing_address is
  'Mailing address for the cover block. Operator-entered; overrides anything extracted.';
