-- Resolves the Supabase linter's CRITICAL "Security Definer View" finding on
-- public.public_projects_view, without reintroducing the bug that
-- 20260821100000_fix_public_projects_view_rls.sql was written to fix.
--
-- BACKGROUND
-- ----------
-- The view was originally created `with (security_invoker = true)`
-- (20260811100000_initial_schema.sql). That made it re-check RLS on
-- public.projects as the QUERYING role, and since `projects_select_staff` is
-- the only SELECT policy on that table and it is `to authenticated`, anon held
-- no policy at all -> every anonymous visitor got 0 rows and the public site
-- was empty. 20260821100000 fixed that by dropping security_invoker, so the
-- view runs as its owner (postgres, which has BYPASSRLS) and its own
-- `where visibility = 'PUBLIC'` clause plus its curated column list became the
-- sole security boundary.
--
-- That works, and no data is leaking today: only SELECT is granted on the
-- view, the column list excludes every internal field, and the visibility
-- predicate is AND-ed into whatever filter a client sends. But it leaves the
-- system one careless edit away from a breach — add a column, or join
-- profiles for a "published by" name, and it ships straight to the public
-- site (apps/public/src/pages/PublicProjects.jsx does `.select('*')`) with no
-- RLS backstop to catch the mistake.
--
-- WHAT THIS MIGRATION DOES
-- ------------------------
-- Restores security_invoker and gives anon a real RLS policy of its own, so
-- the row filter exists in TWO independent places (the table's RLS policy and
-- the view's where clause) instead of one:
--
--   1. A `projects_select_public` policy for anon + authenticated, exposing
--      only rows where visibility = 'PUBLIC'.
--   2. Column-level SELECT grants for anon, so that even hitting
--      /rest/v1/projects directly can never return an internal column. This
--      also strips anon's inherited INSERT/UPDATE/DELETE grants on the table
--      (Supabase's `alter default privileges ... grant all ... to anon`),
--      which until now were held back by RLS alone.
--   3. The view recreated with security_invoker = true (silences the linter)
--      and security_barrier = true (stops the planner from pushing a leaky
--      client-supplied qual below the visibility filter).
--
-- Behaviour is unchanged for every existing caller: anon sees the same public
-- rows, and staff still reach the view through `projects_select_staff`.
--
-- One deliberate trade-off is recorded here. The policy in step 1 covers
-- `authenticated` as well as `anon`, not just anon. `app_is_staff()` requires
-- `role is not null and is_active`, but handle_new_auth_user() inserts new
-- profiles with a NULL role, so a freshly created (not yet role-assigned) or
-- deactivated account is authenticated-but-not-staff. Both apps share one
-- Supabase client (packages/shared/src/lib/supabaseClient.js) and therefore
-- one session, so such an account browsing the public site would query as
-- `authenticated` and — with an anon-only policy — get a blank projects list.
-- Covering `authenticated` keeps the public page working for them. The cost is
-- that such an account can also read the non-curated columns of already-
-- PUBLIC rows (dss_decision, office_id, created_by, ...) straight from
-- /rest/v1/projects, since `authenticated` holds table-wide column privileges
-- that staff genuinely need. That is bounded to rows already published to the
-- entire internet. If you would rather have the blank page than that, change
-- `to anon, authenticated` below to `to anon`.

-- =========================================================================
-- 1. RLS policy: the row filter, now enforced by the table itself.
-- =========================================================================

drop policy if exists projects_select_public on public.projects;

create policy projects_select_public on public.projects
  for select to anon, authenticated
  using (visibility = 'PUBLIC');

-- =========================================================================
-- 2. Column privileges for anon.
--
-- Supabase's bootstrap runs `alter default privileges in schema public grant
-- all on tables to anon`, so anon already holds table-wide SELECT (plus
-- INSERT/UPDATE/DELETE) on public.projects — held back only by the absence of
-- an RLS policy. Now that step 1 gives anon a policy, that table-wide grant
-- would let anon read every column of a public row. Revoke it and hand back
-- only the columns the public view publishes.
--
-- `visibility` must be included: under security_invoker the view's own
-- `where visibility = 'PUBLIC'` is checked with the invoker's column
-- privileges, so anon needs SELECT on it or the view errors out. It leaks
-- nothing — every row anon can see has the same value by construction.
--
-- Columns deliberately withheld from anon: sector, dss_decision, dss_severity,
-- dss_evaluated_at, pow_amount, pow_date, pow_submitted_at, pow_submitted_by,
-- published_by, office_id, created_by, updated_at.
-- =========================================================================

revoke all on public.projects from anon;

grant select (
  id, project_code, title, description, project_category, barangay,
  location_text, latitude, longitude, estimated_cost, approved_budget,
  funding_source, start_date_planned, end_date_planned,
  start_date_actual, end_date_actual, status, published_at, created_at,
  visibility
) on public.projects to anon;

-- =========================================================================
-- 3. The view: same shape as 20260821100000, now invoker-checked and barriered.
--
-- The column list is intentionally identical to the previous definition —
-- sector, the DSS fields and the POW fields added by later migrations stay
-- out. Do not replace this with `select *`.
-- =========================================================================

drop view if exists public.public_projects_view;

create view public.public_projects_view
with (security_invoker = true, security_barrier = true) as
select
  id, project_code, title, description, project_category, barangay,
  location_text, latitude, longitude, estimated_cost, approved_budget,
  funding_source, start_date_planned, end_date_planned,
  start_date_actual, end_date_actual, status, published_at, created_at
from public.projects
where visibility = 'PUBLIC';

grant select on public.public_projects_view to anon, authenticated;

-- =========================================================================
-- Verification (run manually against staging before promoting):
--
--   set local role anon;
--   select count(*) from public.public_projects_view;   -- must match the
--       -- number of projects with visibility = 'PUBLIC'; 0 means the grants
--       -- or the policy above are wrong, NOT that the data is missing.
--   select count(*) from public.projects;               -- same public rows
--   select created_by from public.projects limit 1;     -- must ERROR:
--                                                       -- permission denied
--   reset role;
-- =========================================================================
