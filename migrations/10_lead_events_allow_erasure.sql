-- 10: let a lead be erased, without letting the funnel be rewritten.
--
-- Migration 09 blocked UPDATE and DELETE on lead_events with a trigger, so the
-- funnel could not be retroactively edited. It worked -- and it also blocked
-- the ON DELETE CASCADE from leads, which meant a lead could not be deleted at
-- all once it had a single event.
--
-- That is not a tidiness problem. A privacy erasure request is a legal
-- obligation, and these rows hold a real person's name, email, mobile number
-- and postcode. A table that cannot be deleted from cannot honour one.
--
-- The two are different acts and deserve different answers:
--
--   Rewriting history  -- changing what an event said, or dropping one event to
--                         make a campaign look better. Never permitted. This is
--                         what the append-only rule exists to stop.
--
--   Erasing a person   -- removing a lead and everything recorded about them,
--                         on request. Permitted, deliberately, and audibly.
--
-- So UPDATE stays blocked unconditionally, and DELETE is blocked unless the
-- caller has explicitly announced that it is erasing. Announcing it is one line
-- and cannot happen by accident:
--
--   begin;
--     set local app.erasing_lead = 'on';
--     delete from public.leads where id = '<uuid>';
--   commit;
--
-- A stray DELETE without that setting still raises, which is the case worth
-- protecting against: a careless query, a buggy admin screen, an ORM cascade
-- nobody intended.

create or replace function public.lead_events_append_only() returns trigger
  language plpgsql as $$
begin
  -- The second argument to current_setting makes a missing setting return NULL
  -- rather than raise, so the common path -- no setting at all -- is a plain
  -- comparison rather than an exception.
  if tg_op = 'DELETE' and current_setting('app.erasing_lead', true) = 'on' then
    return old;
  end if;

  raise exception
    'lead_events is append-only: % is not permitted. To erase a lead on request, set app.erasing_lead and delete from leads.',
    tg_op;
end;
$$;

comment on function public.lead_events_append_only() is
  'Blocks UPDATE always. Blocks DELETE unless app.erasing_lead is set, which distinguishes a privacy erasure from an attempt to rewrite the funnel.';

-- ------------------------------------------------------------------ rollback
-- Restoring migration 09's version re-blocks erasure and leaves leads
-- undeletable. Only do it if the trigger below is found to permit something it
-- should not.
