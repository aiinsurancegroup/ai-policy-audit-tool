-- 11: split the questionnaires into what a cold click can bear and what only a
-- client should ever be asked.
--
-- Homeowners is 46 questions and is one of the two launch ad campaigns. Nobody
-- finishes 46 questions after clicking an ad, so today every abandonment is a
-- wasted click that was paid for. The full sets are not deleted -- they become
-- the underwriting questionnaire sent once someone is a client and the risk is
-- being marketed. They are simply not what a stranger is shown.
--
-- THREE STAGES
--   step1         Collected by the website lead form. Never re-asked -- asking
--                 for a name and email twice is the most obvious way to look
--                 broken.
--   declarations  Appears on a declarations page. This is the honest test: the
--                 same information we would have read off an uploaded document,
--                 so asking for it is asking someone to transcribe rather than
--                 to disclose something new.
--   underwriting  Everything else. Asked later, by an agent or on a form sent
--                 to an existing client.
--
-- Default is "underwriting" deliberately. An unclassified question stays out of
-- the short path, so the failure mode is a longer conversation rather than a
-- stranger being asked about their dog.

alter table public.questionnaire_questions
  add column if not exists stage text not null default 'underwriting'
  check (stage in ('step1', 'declarations', 'underwriting'));

comment on column public.questionnaire_questions.stage is
  'step1 = already collected by the website lead form; declarations = appears on a declarations page, safe to ask a prospect; underwriting = asked once someone is a client. Path B of the lead form shows declarations only.';

create index if not exists questionnaire_questions_stage_idx
  on public.questionnaire_questions (questionnaire_type_id, stage, sort_order);

-- ------------------------------------------------------------ renumber
-- Multiply the two launch questionnaires' sort_order by 10 so new questions can
-- be slotted between existing ones. Relative order is unchanged; only the gaps
-- are new. Done before the inserts so the new fields land beside the questions
-- they belong with rather than at the end of the form.
update public.questionnaire_questions q
set sort_order = q.sort_order * 10
from public.questionnaire_types t
where t.id = q.questionnaire_type_id and t.slug in ('auto-nj', 'homeowners');

-- ------------------------------------------------------- new: auto-nj
-- What they carry today. Without this the review cannot say whether their
-- coverage is thin, which is the entire point of offering a review.
insert into public.questionnaire_questions
  (questionnaire_type_id, section, sort_order, field_key, label, field_type, options, required, help_text, stage)
select t.id, 'Current Insurance', 175, 'current_liability_limits',
       'Current liability limits',
       'dropdown',
       '["15/30", "25/50", "50/100", "100/300", "250/500", "500/500", "Other", "Don''t know"]'::jsonb,
       false,
       'Per person / per accident, in thousands. It is on your declarations page under Bodily Injury Liability.',
       'declarations'
from public.questionnaire_types t where t.slug = 'auto-nj'
  and not exists (select 1 from public.questionnaire_questions x
                  where x.questionnaire_type_id = t.id and x.field_key = 'current_liability_limits');

-- Licence status rather than licence number. A licence number is the most
-- friction-heavy field on a mobile form and is sensitive; the status is what
-- actually affects eligibility. The number stays in the set at underwriting
-- stage, where it is asked once someone is a client.
insert into public.questionnaire_questions
  (questionnaire_type_id, section, sort_order, field_key, label, field_type, options, required, help_text, stage)
select t.id, 'Drivers', 215, 'driver_license_status',
       'Licence status',
       'dropdown',
       '["Valid", "Learner permit", "Suspended", "Expired", "Out-of-state", "International / foreign", "Not licensed"]'::jsonb,
       false,
       null,
       'declarations'
from public.questionnaire_types t where t.slug = 'auto-nj'
  and not exists (select 1 from public.questionnaire_questions x
                  where x.questionnaire_type_id = t.id and x.field_key = 'driver_license_status');

-- ---------------------------------------------------- new: homeowners
-- What they carry today, kept distinct from desired_deductible, which is a
-- preference and stays at underwriting stage. Conflating the two would make the
-- review unable to tell an under-insured home from a client who simply wants a
-- different deductible next term.
insert into public.questionnaire_questions
  (questionnaire_type_id, section, sort_order, field_key, label, field_type, options, required, help_text, stage)
select t.id, 'Current Insurance', 315, 'current_deductible',
       'Current deductible',
       'dropdown',
       '["$500", "$1,000", "$2,500", "$5,000", "$10,000", "Other", "Don''t know"]'::jsonb,
       false,
       'What you pay before the policy responds. On your declarations page, usually near the dwelling amount.',
       'declarations'
from public.questionnaire_types t where t.slug = 'homeowners'
  and not exists (select 1 from public.questionnaire_questions x
                  where x.questionnaire_type_id = t.id and x.field_key = 'current_deductible');

-- The first address asked on Path B, so it cannot be phrased as a difference
-- from a mailing address the form never collected.
update public.questionnaire_questions q
set label = 'Address of the home being insured'
from public.questionnaire_types t
where t.id = q.questionnaire_type_id
  and t.slug = 'homeowners' and q.field_key = 'property_address';

-- ---------------------------------------------------------------- step 1
update public.questionnaire_questions q
set stage = 'step1'
from public.questionnaire_types t
where t.id = q.questionnaire_type_id
  and q.field_key in ('applicant_name', 'applicant_email', 'cell_phone', 'zip', 'mailing_zip');

-- --------------------------------------------------------- declarations
-- Auto: address, vehicles, drivers with dates of birth and licence status,
-- current carrier, current limits, renewal date.
update public.questionnaire_questions q
set stage = 'declarations'
from public.questionnaire_types t
where t.id = q.questionnaire_type_id
  and t.slug = 'auto-nj'
  and q.field_key in (
    'address', 'city',
    'current_carrier', 'current_exp_date', 'current_liability_limits',
    'driver_name', 'driver_dob', 'driver_license_status',
    'vehicle_year', 'vehicle_make', 'vehicle_model'
  );

-- Homeowners: address, year built, square footage, construction, roof age,
-- current carrier, dwelling limit, deductible, renewal date.
-- desired_deductible is NOT here: it is a preference, not what they carry.
update public.questionnaire_questions q
set stage = 'declarations'
from public.questionnaire_types t
where t.id = q.questionnaire_type_id
  and t.slug = 'homeowners'
  and q.field_key in (
    'property_address',
    'year_built', 'square_footage', 'construction_type', 'roof_age',
    'current_carrier', 'current_exp_date',
    'current_dwelling_amount', 'current_deductible'
  );

-- ------------------------------------------------------------- rollback
--   alter table public.questionnaire_questions drop column if exists stage;
--   delete from public.questionnaire_questions
--     where field_key in ('current_liability_limits','driver_license_status','current_deductible');
--   update public.questionnaire_questions set sort_order = sort_order / 10
--     where questionnaire_type_id in (select id from public.questionnaire_types
--                                     where slug in ('auto-nj','homeowners'));
-- The renumber is reversible only while every sort_order is still a multiple of
-- ten, which stops being true as soon as anything else is inserted.
