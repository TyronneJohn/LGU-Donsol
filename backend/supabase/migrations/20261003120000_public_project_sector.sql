-- Publishes projects.sector (Social Development / Economic Development /
-- Environmental Management) on the public site, so the public project list
-- can be grouped and subtotaled by sector the same way MPDC's physical
-- 20% Development Fund Utilization Transparency Board already is.
--
-- 20260909110000_harden_public_projects_view.sql deliberately withheld
-- sector only because nothing on the public site used it; it is not
-- sensitive — the same A/B/C grouping is posted on the board outside the
-- MPDC office. Every other withheld column stays withheld.

grant select (sector) on public.projects to anon;

-- Same definition as 20260909110000 plus `sector`. Do not replace this with
-- `select *`.
drop view if exists public.public_projects_view;

create view public.public_projects_view
with (security_invoker = true, security_barrier = true) as
select
  id, project_code, title, description, project_category, sector, barangay,
  location_text, latitude, longitude, estimated_cost, approved_budget,
  funding_source, start_date_planned, end_date_planned,
  start_date_actual, end_date_actual, status, published_at, created_at
from public.projects
where visibility = 'PUBLIC';

grant select on public.public_projects_view to anon, authenticated;
