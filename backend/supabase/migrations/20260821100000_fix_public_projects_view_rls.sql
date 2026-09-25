-- Bug fix: public_projects_view returned zero rows to anonymous visitors
-- for every project, even ones correctly marked visibility = 'PUBLIC'.
--
-- The view was created `with (security_invoker = true)`, which makes it
-- re-check row-level security against the underlying `projects` table
-- using the QUERYING role's own policies rather than running as the
-- view's owner. `projects_select_staff` (20260811100000_initial_schema.sql)
-- only grants SELECT on `projects` to the `authenticated` role — anon
-- holds no policy on `projects` at all, by design, since anon is meant to
-- reach public rows exclusively through this curated view. Under
-- security_invoker, that meant anon's query against `projects` was denied
-- by RLS before the view's own `where visibility = 'PUBLIC'` clause ever
-- got a chance to matter, so the view always returned 0 rows for anon
-- regardless of any project's actual visibility.
--
-- Recreating without security_invoker restores the intended behavior:
-- the view runs with its owner's privileges (bypassing RLS on the base
-- table, as Postgres views do by default), and the view's own
-- `where visibility = 'PUBLIC'` clause plus its curated column list
-- become the sole security boundary — exactly what the original
-- "PUBLIC VIEW (safe, curated column list for anonymous visitors)"
-- comment already described.
drop view if exists public.public_projects_view;

create view public.public_projects_view as
select
  id, project_code, title, description, project_category, barangay,
  location_text, latitude, longitude, estimated_cost, approved_budget,
  funding_source, start_date_planned, end_date_planned,
  start_date_actual, end_date_actual, status, published_at, created_at
from public.projects
where visibility = 'PUBLIC';

grant select on public.public_projects_view to anon, authenticated;
