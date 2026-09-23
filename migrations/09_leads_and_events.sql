-- 09: leads and the funnel event log.
--
-- Lives in this repo rather than the website's because there is one database,
-- and migrations for one database split across two repositories is how two
-- migrations end up numbered 09.
--
-- ACCESS POSTURE, PER THE SECURITY REVIEW
-- anon gets nothing: no grants, no policies. Every write goes through a
-- serverless route holding the service key, the same pattern the client portal
-- already uses. An anon insert-only policy was considered and rejected -- it
-- still puts a public key in the browser, and while it would stop reading, it
-- would not stop anyone posting fabricated leads carrying whatever UTM values
-- they choose, which poisons the one thing this table exists to measure.
--
-- A readable leads table is a competitor's prospect list and a notifiable
-- privacy incident. With no grant at all, a future policy mistake has nothing
-- to act on.

-- ------------------------------------------------------------------- leads
create table if not exists public.leads (
  id uuid primary key default gen_random_uuid(),

  -- Step 1 identity. first/last are separate because the lead record and the
  -- follow-up need them apart; the questionnaires ask for a single
  -- applicant_name, which is mapped on the way in rather than asked twice.
  first_name   text not null,
  last_name    text not null,
  email        text not null,
  mobile_phone text not null,
  zip          text not null,

  -- Derived from zip on the server, never sent by the browser.
  state text,

  -- Whether the state is one we are licensed in (NJ, PA, FL) and can therefore
  -- route into a questionnaire automatically. NOT a gate: every lead is
  -- captured regardless. A false here means the lead is flagged for the
  -- operator to decide case by case -- a referral, a carrier who writes there,
  -- a licence worth adding -- and none of those decisions can be made if the
  -- visitor was turned away before we learned who they were.
  in_licensed_state boolean not null default false,

  -- What they asked about, and which questionnaire that resolved to.
  -- questionnaire_slug is null for a lead outside the licensed states: there is
  -- nothing to route them into yet, which is the whole reason they are flagged.
  product            text,
  questionnaire_slug text,

  -- Operator-owned. The last three exist because a funnel that stops at
  -- "form submitted" measures form fills, not customers.
  status text not null default 'new'
    check (status in ('new','contacted','quoted','bound','closed_lost')),

  audit_id      uuid references public.audits(id) on delete set null,
  submission_id uuid references public.questionnaire_submissions(id) on delete set null,

  -- Attribution, captured on first touch and never rewritten. gclid is the only
  -- reliable join back to Google Ads; the utm_* fields are what the campaign
  -- itself declares.
  utm_source   text,
  utm_medium   text,
  utm_campaign text,
  utm_term     text,
  utm_content  text,
  gclid        text,
  landing_path text,
  referrer     text,
  device_type  text,

  -- Consent, on the client_consents pattern: the verbatim text that was on the
  -- screen, not a boolean. A boolean records that somebody agreed to something;
  -- only the text records what. Two separate permissions, never merged -- a
  -- regulator reads "you may text me" and "you may read my policy" apart.
  tcpa_consent_text       text,
  tcpa_consent_at         timestamptz,
  tcpa_consent_ip         text,
  tcpa_consent_user_agent text,

  docs_consent_text text,
  docs_consent_at   timestamptz,
  docs_consent_ip   text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists leads_created_idx   on public.leads (created_at desc);
create index if not exists leads_email_idx     on public.leads (lower(email));
create index if not exists leads_status_idx    on public.leads (status);
-- The operator's working queue: leads outside the licensed states, newest
-- first. Partial, because it is a small slice of the table and the whole point
-- is that someone looks at it rather than it sitting unnoticed.
create index if not exists leads_manual_idx    on public.leads (created_at desc)
  where in_licensed_state = false;
create index if not exists leads_campaign_idx  on public.leads (utm_campaign, created_at desc);

alter table public.leads enable row level security;
revoke all on public.leads from anon, authenticated;

comment on table public.leads is
  'One row per completed Step 1. Written only by the server with the service key; anon and authenticated hold no grant.';
comment on column public.leads.tcpa_consent_text is
  'The exact wording displayed when consent was given. Stored verbatim so a later copy edit cannot rewrite what someone agreed to.';
comment on column public.leads.in_licensed_state is
  'True for NJ, PA and FL, which route into a questionnaire automatically. False flags the lead for manual follow-up; it is never a reason to refuse the lead.';

-- ------------------------------------------------------------- lead_events
-- Append-only in the strong sense. A funnel you can retroactively edit cannot
-- be used to judge ad spend, so UPDATE and DELETE are blocked by trigger rather
-- than by convention -- including for the service role, which is the only thing
-- that can reach this table at all.
create table if not exists public.lead_events (
  id          bigint generated always as identity primary key,
  lead_id     uuid not null references public.leads(id) on delete cascade,
  event       text not null,
  occurred_at timestamptz not null default now(),
  meta        jsonb
);

create index if not exists lead_events_lead_idx  on public.lead_events (lead_id, occurred_at);
create index if not exists lead_events_event_idx on public.lead_events (event, occurred_at desc);

alter table public.lead_events enable row level security;
revoke all on public.lead_events from anon, authenticated;

create or replace function public.lead_events_append_only() returns trigger
  language plpgsql as $$
begin
  raise exception 'lead_events is append-only: % is not permitted', tg_op;
end;
$$;

drop trigger if exists lead_events_no_update on public.lead_events;
create trigger lead_events_no_update
  before update or delete on public.lead_events
  for each row execute function public.lead_events_append_only();

comment on table public.lead_events is
  'Append-only funnel log. UPDATE and DELETE raise; correcting a mistake means appending a correcting event, which is what an audit trail is for.';

-- ---------------------------------------------------------------- rollback
--   drop trigger if exists lead_events_no_update on public.lead_events;
--   drop function if exists public.lead_events_append_only();
--   drop table if exists public.lead_events;
--   drop table if exists public.leads;
-- Safe only before the table holds real leads. After that, dropping it destroys
-- personal data that people submitted to us, and the rollback is a restore from
-- backup rather than a drop.
