-- Engineering review authority over MPDC's submissions — REVISED.
--
-- This migration was never applied (not part of deployed history), so this
-- revision is correcting a draft before its first use, not rewriting an
-- applied migration.
--
-- Engineering may record only a negative review decision here: send the
-- project back to MPDC for revision, or reject it outright. The forward
-- path to BAC is never a project_approvals row — Engineering endorses via
-- the separate project_endorsements table (companion migration
-- 20260812140000_engineering_edit_and_endorsement.sql), which is
-- structurally distinct from a review decision. 'APPROVED' is therefore not
-- a legal decision value for Engineering at the database layer.
--
-- Split into two insert policies so admin keeps full override capability
-- (including APPROVED, for exceptional manual correction) without granting
-- that same latitude to Engineering.

drop policy if exists approvals_insert_mpdc on public.project_approvals;
drop policy if exists approvals_insert_engineering on public.project_approvals;

create policy approvals_insert_engineering on public.project_approvals
  for insert to authenticated
  with check (
    public.app_current_role() = 'engineering'
    and reviewed_by = auth.uid()
    and decision in ('RETURNED_FOR_REVISION', 'REJECTED')
    and exists (
      select 1 from public.projects p
      join public.profiles me on me.id = auth.uid()
      where p.id = project_id
        and p.status = 'SUBMITTED_FOR_REVIEW'
        and p.office_id = me.office_id
    )
  );

create policy approvals_insert_admin on public.project_approvals
  for insert to authenticated
  with check (public.app_is_admin() and reviewed_by = auth.uid());

-- apply_project_approval's audit description hardcoded "MPDC recorded
-- decision" — no longer accurate now that Engineering is the actor.
-- Status-driving logic is unchanged.
create or replace function public.apply_project_approval()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update public.projects
  set status = new.decision::text::public.project_status
  where id = new.project_id;

  perform public.write_audit_log(
    'PROJECT_REVIEW_DECISION', 'project', new.project_id,
    'Review decision recorded: ' || new.decision,
    jsonb_build_object('approval_id', new.id, 'submission_id', new.submission_id)
  );
  return new;
end;
$$;
