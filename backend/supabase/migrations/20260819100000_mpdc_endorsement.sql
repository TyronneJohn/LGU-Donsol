-- Moves the "Endorse to BAC" action from Engineering to MPDC.
--
-- Engineering's role narrows to the technical review itself: negative
-- decisions on project_approvals (RETURNED_FOR_REVISION / REJECTED),
-- approved_budget / funding_source, and technical documents — all untouched
-- by this migration. The forward handoff to BAC is now something the
-- project's own MPDC creator does once that review has happened, not
-- something Engineering does on their behalf.
--
-- Same table (project_endorsements), same trigger (apply_project_endorsement),
-- same downstream effects (status -> APPROVED, audit log, BAC notification).
-- Only who may insert the row changes — no new column, no workflow change.

drop policy if exists endorsements_insert_engineering on public.project_endorsements;
create policy endorsements_insert_mpdc on public.project_endorsements
  for insert to authenticated
  with check (
    public.app_current_role() in ('mpdc', 'admin')
    and endorsed_by = auth.uid()
    and exists (
      select 1 from public.projects p
      where p.id = project_id
        and p.status = 'SUBMITTED_FOR_REVIEW'
        and (public.app_is_admin() or p.created_by = auth.uid())
    )
  );

-- Trigger logic (status transition, audit log, BAC notification) is
-- unchanged — only the hardcoded actor references in the audit description
-- and default notification message are updated to match the new actor.
create or replace function public.apply_project_endorsement()
returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_project_title text;
begin
  update public.projects
  set status = 'APPROVED'
  where id = new.project_id
    and status = 'SUBMITTED_FOR_REVIEW'
  returning title into v_project_title;

  if v_project_title is not null then
    perform public.write_audit_log(
      'PROJECT_ENDORSED_TO_BAC', 'project', new.project_id,
      'MPDC endorsed project to BAC for procurement',
      jsonb_build_object('endorsement_id', new.id)
    );

    insert into public.notifications (recipient_id, category, title, message, related_project_id)
    select p.id, 'PROCUREMENT_UPDATE',
      'Project ready for procurement: ' || v_project_title,
      coalesce(new.notes, 'MPDC has endorsed this project for procurement.'),
      new.project_id
    from public.profiles p
    where p.role in ('bac', 'admin') and p.is_active;
  end if;

  return new;
end;
$$;
