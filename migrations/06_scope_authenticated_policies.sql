-- 06: replace "any authenticated user can do anything" with explicit roles.
--
-- Nine policies granted the authenticated role unrestricted access -- eight of
-- them ALL ... USING (true), plus a SELECT on submission_carrier_market. While
-- public signup was enabled, that meant anyone who registered an email address
-- could read, alter and delete client personal data: submission_client_profile
-- (30 columns), and questionnaire_submissions, whose answers jsonb holds names,
-- emails, phone numbers and addresses. Signup is now off and both existing
-- accounts belong to the operator, so the window was never walked through --
-- but "authenticated" must stop meaning "unrestricted" regardless, or
-- re-enabling signup once silently re-opens it.
--
-- WHY ROLES AND NOT PER-ROW OWNERSHIP
-- None of these tables has an ownership column -- no user_id, no created_by --
-- so "read only what belongs to you" cannot be expressed as a row predicate.
-- Adding one would also be the wrong model: these rows belong to the agency,
-- not to whichever staff member happened to type them. So access is by role,
-- and app_roles is a table rather than a hardcoded email list so that adding a
-- staff member later is one row, not another migration.
--
-- Read/write goes to staff; DELETE is admin-only, as specified.

-- ---------------------------------------------------------------- roles table
create table if not exists public.app_roles (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  role       text not null check (role in ('admin', 'staff')),
  granted_at timestamptz not null default now(),
  granted_by text
);

alter table public.app_roles enable row level security;

-- Deliberately no policies and no grants: only the service role and the
-- SECURITY DEFINER helpers below may read this table. A roles table that the
-- authenticated role can write is not an access control.
revoke all on public.app_roles from anon, authenticated;

-- ------------------------------------------------------------------- helpers
-- SECURITY DEFINER so the check can read app_roles while the caller cannot.
-- search_path is pinned: without it, a caller controlling the search path could
-- point "app_roles" at a table of their own.
create or replace function public.is_staff() returns boolean
  language sql stable security definer set search_path = public, pg_temp as $$
  select exists (
    select 1 from public.app_roles
    where user_id = auth.uid() and role in ('admin', 'staff')
  );
$$;

create or replace function public.is_admin() returns boolean
  language sql stable security definer set search_path = public, pg_temp as $$
  select exists (
    select 1 from public.app_roles
    where user_id = auth.uid() and role = 'admin'
  );
$$;

revoke all on function public.is_staff() from public;
revoke all on function public.is_admin() from public;
grant execute on function public.is_staff() to authenticated;
grant execute on function public.is_admin() to authenticated;

-- --------------------------------------------------------------------- seed
-- The two accounts that exist today, both the operator's. Seeded by email
-- rather than by uuid so this migration is readable and re-runnable.
insert into public.app_roles (user_id, role, granted_by)
select id, 'admin', 'migration 06'
from auth.users
where email in ('martorano6621@gmail.com', 'sal@theaiinsurancegroup.com')
on conflict (user_id) do nothing;

-- ------------------------------------------------------- replace the policies
-- Client data: staff read and write, admin delete.
do $$
declare t text;
begin
  foreach t in array array[
    'questionnaire_submissions',
    'submission_client_profile',
    'submission_coverage',
    'submission_loss_history',
    'submission_carrier_app',
    'submission_match_result'
  ] loop
    execute format('drop policy if exists "authenticated full access" on public.%I', t);
    execute format('drop policy if exists "submissions: authenticated all" on public.%I', t);
    execute format('drop policy if exists "match_result: authenticated all" on public.%I', t);

    execute format($f$create policy "staff read" on public.%I
      for select to authenticated using (public.is_staff())$f$, t);
    execute format($f$create policy "staff insert" on public.%I
      for insert to authenticated with check (public.is_staff())$f$, t);
    execute format($f$create policy "staff update" on public.%I
      for update to authenticated using (public.is_staff()) with check (public.is_staff())$f$, t);
    execute format($f$create policy "admin delete" on public.%I
      for delete to authenticated using (public.is_admin())$f$, t);
  end loop;
end $$;

-- Reference data the carrier matcher reads. Was SELECT-only already; keep it
-- SELECT-only, now scoped.
drop policy if exists "carrier_market_read_authenticated" on public.submission_carrier_market;
create policy "staff read" on public.submission_carrier_market
  for select to authenticated using (public.is_staff());

-- Form definitions. The anon SELECT policies on these two are load-bearing --
-- the public questionnaire reads them to render itself -- and are left exactly
-- as they are. Only the authenticated write side is scoped, to admin: these are
-- configuration, and a staff account should not be able to rewrite a form.
do $$
declare t text;
begin
  foreach t in array array['questionnaire_types', 'questionnaire_questions'] loop
    execute format('drop policy if exists "types: authenticated all" on public.%I', t);
    execute format('drop policy if exists "questions: authenticated all" on public.%I', t);

    execute format($f$create policy "staff read" on public.%I
      for select to authenticated using (public.is_staff())$f$, t);
    execute format($f$create policy "admin insert" on public.%I
      for insert to authenticated with check (public.is_admin())$f$, t);
    execute format($f$create policy "admin update" on public.%I
      for update to authenticated using (public.is_admin()) with check (public.is_admin())$f$, t);
    execute format($f$create policy "admin delete" on public.%I
      for delete to authenticated using (public.is_admin())$f$, t);
  end loop;
end $$;

-- blog_posts keeps its anon "published = true" read policy untouched. It had no
-- authenticated policy to replace.

-- ------------------------------------------------------------------ rollback
-- Restoring the previous state means recreating the unrestricted policies, so
-- it is written out rather than left as "revert the migration":
--
--   create policy "authenticated full access" on public.<table>
--     for all to authenticated using (true) with check (true);
--
-- Do not run that except to recover a genuine outage. It is the exposure this
-- migration exists to close.
