-- 08: give client portal tokens a lifetime.
--
-- A portal token is a bearer credential that lives in a URL, in somebody's
-- inbox, forever. The oldest live one was issued on 23 April and still worked
-- five months later. Nothing expires them, and nothing ever did.
--
-- This migration only adds the dates. Two things have to land with it in code,
-- and neither belongs in SQL:
--
--   1. Generation moves to crypto.randomBytes(32).toString('hex'), server-side
--      only. Both current generators -- src/App.jsx and api/send-email.js --
--      use Math.random(), which is xorshift128+ and state-recoverable from a
--      handful of outputs. The browser generator is deleted outright: a token
--      minted in the browser is a token the browser can predict.
--
--   2. api/client/portal.js refuses an expired token with a distinct response,
--      so the portal can offer a new link instead of failing blank. That is the
--      one place the uniform-failure rule is relaxed, and deliberately: an
--      expired link is not a secret, and a client staring at a dead page is a
--      lost client. An invalid token and a valid-but-unknown one stay
--      indistinguishable, as now.
--
-- WHY 90 DAYS
-- Clients gathering declarations pages from three or four carriers routinely
-- take weeks. Thirty days would expire links that are still being worked on,
-- and every premature expiry costs a phone call.

alter table public.audits
  add column if not exists client_token_issued_at  timestamptz,
  add column if not exists client_token_expires_at timestamptz;

comment on column public.audits.client_token_issued_at is
  'When the current client_token was minted. Reset whenever a new link is issued.';
comment on column public.audits.client_token_expires_at is
  'Hard expiry for the current client_token. NULL means no token has been issued; a token whose expiry has passed is refused with an offer of a new link.';

-- ------------------------------------------------------------------ backfill
-- The 15 existing tokens keep working. Invalidating them would mean six clients
-- clicking a link that fails with no explanation, which is a worse outcome than
-- a weak-but-finite token scoped to one audit -- a stolen one can upload to
-- that audit and sign its consent, and cannot read any stored document.
--
-- issued_at is set from created_at, which is the closest thing to the truth we
-- have for tokens minted before this column existed.
--
-- Applied to all 15 rather than only the 6 still open. The other 9 are already
-- inert -- client_submitted_at closes them to writes -- but leaving their
-- expiry NULL would mean NULL carries two meanings at once: "no token" and
-- "token that never expires". One meaning per value.
update public.audits
set client_token_issued_at  = coalesce(client_token_issued_at, created_at),
    client_token_expires_at = now() + interval '90 days'
where client_token is not null
  and client_token_expires_at is null;

-- ------------------------------------------------------------------ rollback
--   alter table public.audits
--     drop column if exists client_token_issued_at,
--     drop column if exists client_token_expires_at;
-- Safe: the columns are additive and nothing reads them until the portal change
-- ships. Dropping them restores tokens that never expire, which is the state
-- this migration exists to end.
