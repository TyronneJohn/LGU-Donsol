-- Copies estimated_cost into approved_budget for projects encoded before
-- MPDC's form dropped the Estimated Budget field
-- (20260929100000_mpdc_approval_authority.sql). Authorized by the project
-- owner on 2026-09-28.
--
-- Only fills blanks: a project that already has an approved_budget keeps it,
-- even when it differs from estimated_cost. estimated_cost itself is left
-- untouched as the record of the original figure. Status, funding source and
-- POW are not changed.
--
-- Each filled project gets an audit entry from audit_project_field_edit()
-- (trg_projects_audit_field_edit), labelled as a backfill via the flag below
-- so it can't be mistaken for a manual edit. The flag is transaction-local.
--
-- Runs as the migration role, so guard_project_field_updates() passes it
-- through (no mpdc/engineering role on the connection) and no status or
-- DSS trigger fires (neither watches approved_budget).

select set_config('app.budget_backfill', 'true', true);

update public.projects
set approved_budget = estimated_cost
where approved_budget is null
  and estimated_cost is not null;

select set_config('app.budget_backfill', '', true);
