-- 13: the blog byline says what the agency is.
--
-- The default it replaces was wrong twice over. It carried the positioning from
-- two rewrites ago -- "a marketing and informational platform focused on AI
-- liability coverage and risk advisory" -- and it said "licensed for Property &
-- Casualty insurance in New Jersey and Florida", OMITTING PENNSYLVANIA. That is
-- a factual error about licensing sitting in a column default, which would have
-- been stamped onto the byline of the next blog post written. Nobody would have
-- noticed, because a default is only read when a row is inserted.
--
-- The marketing site keeps a matching copy in src/contact.js as the fallback for
-- a row whose author_bio is null. Different repositories, so nothing enforces
-- the match at build; a test in theaiinsurancegroup pins it byte for byte.

alter table public.blog_posts
  alter column author_bio set default
    'Sal Martorano is the founder of The AI Insurance Group, a licensed independent insurance agency in New Jersey, Pennsylvania and Florida. NJ Producer License No. 3004245927.';

-- Backfill, run as a check rather than a change: all 7 rows were updated from
-- the chat side before this ran, and the read-only pass confirmed 0 null, 0 old
-- wording, 0 Alexander, and one distinct value matching the new default exactly.
-- It reported 0, as expected.
update public.blog_posts
   set author_bio = 'Sal Martorano is the founder of The AI Insurance Group, a licensed independent insurance agency in New Jersey, Pennsylvania and Florida. NJ Producer License No. 3004245927.'
 where author_bio is null
    or author_bio ilike '%informational platform%'
    or author_bio ilike '%Alexander%';

-- ------------------------------------------------------------------ rollback
--   alter table public.blog_posts alter column author_bio drop default;
-- The backfill is not reversible -- previous per-row values are recorded
-- nowhere -- which is only acceptable because it was expected to change nothing,
-- and did.
