-- Requires Engineering's technical review to actually have happened before
-- MPDC can endorse a project to BAC.
--
-- Audit finding: endorsements_insert_mpdc (20260819100000_mpdc_endorsement.sql)
-- only checked project_id/status/ownership — it never checked that
-- Engineering had done anything. That let MPDC endorse a project the instant
-- it became SUBMITTED_FOR_REVIEW, before Engineering ever opened it.
--
-- Existing-architecture signal used instead of a new column: approved_budget.
-- It is already the one field Engineering (and only Engineering, per
-- guard_project_field_updates) is expected to fill in during review
-- (ProjectReviewDetail.jsx: "Only these two fields are Engineering-editable,
-- and only while the project is under review"), and it's already load-bearing
-- downstream as BAC's ABC amount (BacProcurement.jsx reads it as
-- `abc_amount: p.approved_budget`). A project_approvals row can't serve this
-- purpose — Engineering may only record a *negative* decision there
-- (RETURNED_FOR_REVISION / REJECTED, per 20260812130000); there is no
-- positive "reviewed" row to check for a project Engineering didn't return
-- or reject. approved_budget being set and positive is therefore the most
-- reliable existing signal that Engineering's technical review actually
-- happened, with no new column/table/migration beyond this policy change.
--
-- Same table, same trigger (apply_project_endorsement, untouched), same
-- downstream effects. Only the insert policy gains one more condition.

drop policy if exists endorsements_insert_mpdc on public.project_endorsements;
create policy endorsements_insert_mpdc on public.project_endorsements
  for insert to authenticated
  with check (
    public.app_current_role() in ('mpdc', 'admin')
    and endorsed_by = auth.uid()
    and exists (
      select 1 from public.projects p
      where p.id = project_id
        and p.status = 'SUBMITTED_FOR_REVIEW'
        and p.approved_budget is not null
        and p.approved_budget > 0
        and (public.app_is_admin() or p.created_by = auth.uid())
    )
  );
