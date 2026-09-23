-- 12: let a questionnaire be saved before it is finished.
--
-- questionnaire_submissions.status allowed only submitted, reviewed and quoted,
-- so every autosave was rejected while the final "Finish" save succeeded. The
-- failure was invisible from the browser because the autosave catch swallows
-- errors deliberately -- a failed save must not stop someone answering the next
-- question -- so it showed up only as a missing row in the database.
--
-- That defeats the point of saving on every section advance: someone who
-- abandons halfway is exactly who it is for, and they were leaving nothing.
-- Found by submitting a real partial save against the preview and then looking
-- at the table rather than at the 200 the browser got.
--
-- 'partial' is listed first because it comes first in life:
-- partial -> submitted -> reviewed -> quoted.

alter table public.questionnaire_submissions
  drop constraint if exists questionnaire_submissions_status_check;

alter table public.questionnaire_submissions
  add constraint questionnaire_submissions_status_check
  check (status in ('partial', 'submitted', 'reviewed', 'quoted'));

comment on column public.questionnaire_submissions.status is
  'partial = saved mid-questionnaire and still being answered; submitted = the respondent finished; reviewed and quoted are set by the operator afterwards.';

-- ------------------------------------------------------------------ rollback
--   alter table public.questionnaire_submissions
--     drop constraint questionnaire_submissions_status_check;
--   alter table public.questionnaire_submissions
--     add constraint questionnaire_submissions_status_check
--     check (status in ('submitted', 'reviewed', 'quoted'));
-- Only safe once no partial rows exist, or the constraint will not validate.
