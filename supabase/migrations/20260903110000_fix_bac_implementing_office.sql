-- Repairs projects whose implementing office was recorded as the Bids and
-- Awards Committee.
--
-- BAC is never an implementing office here: it runs procurement, which it
-- reaches through project status (APPROVED / FOR_PROCUREMENT — see
-- PROCUREMENT_ELIGIBLE_STATUSES and BacDashboard's queue), never through
-- projects.office_id. office_id names the office that actually builds and
-- monitors the project, which is always Engineering.
--
-- These rows came from the MPDC new-project form, which used to fall back to
-- the first office by name — alphabetically the BAC — whenever it could not
-- find Engineering by code. A project stamped that way is invisible to
-- Engineering (their pages and the review policies all filter on office_id),
-- so it can never be reviewed, never gets an approved_budget, and can never
-- be endorsed: permanently stuck, since guard_project_field_updates locks
-- office_id against MPDC after creation. The form no longer has that
-- fallback; this repairs the rows it already wrote.
--
-- Running as a migration is what makes the update possible at all — the
-- guard returns early for admin/system, which no MPDC session ever is.
-- No-op on a database where either office is missing or nothing was
-- mis-stamped.

update public.projects p
set office_id = engg.id
from public.offices engg, public.offices bac
where engg.code = 'ENGG'
  and bac.code = 'BAC'
  and p.office_id = bac.id;
