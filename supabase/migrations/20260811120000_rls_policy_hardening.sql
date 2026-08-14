-- LGU Donsol Project Monitoring System — RLS hardening
--
-- The initial migration already enabled RLS with role-scoped policies for
-- every table (offices, profiles, contractors, projects, submissions,
-- approvals, updates, images, documents, procurement, notifications,
-- messages, audit_logs). Reviewing it against the full security
-- requirements found three real gaps, all on the write path:
--
--   1. Engineering and MPDC could write `projects.status` directly through
--      their existing UPDATE policy, bypassing the
--      submit -> review -> decide -> procure workflow entirely (e.g. an
--      Engineering user could set their own DRAFT straight to APPROVED).
--   2. MPDC's "publish" window (UPDATE allowed while status = APPROVED)
--      let them edit ANY column of the project, not just the publication
--      fields — nothing stopped them from also rewriting the budget.
--   3. A handful of tables had no delete policy at all, which — because
--      RLS defaults to deny — silently blocked even ADMIN from deleting
--      those rows, and notifications/messages could only be updated by
--      their recipient, not moderated by ADMIN.
--
-- Nothing here changes who can SELECT what; it only tightens writes.

-- =========================================================================
-- 0. Admin-or-system escape hatch, reused by every guard trigger below.
--    auth.role() = 'service_role' covers backend/service-key automation,
--    which authenticates as a distinct Postgres role, not a JWT the
--    app_is_admin() profile lookup would recognize.
-- =========================================================================
create or replace function public.app_is_admin_or_system()
returns boolean
language sql stable security definer set search_path = public as $$
  select public.app_is_admin() or auth.role() = 'service_role';
$$;

-- =========================================================================
-- 1. projects.status may only change via:
--      (a) an admin/service-role UPDATE, or
--      (b) one of the workflow triggers below, recognizable because they
--          run from inside another trigger (pg_trigger_depth() > 1) after
--          a project_submissions / project_approvals / procurement insert
--          that RLS already role-checked.
--    Engineering's own-draft UPDATE access and MPDC's publish-window
--    UPDATE access to `projects` are otherwise untouched — this only
--    fences off the one column that drives the approval workflow.
-- =========================================================================
create or replace function public.guard_project_status_change()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status is distinct from old.status
     and not public.app_is_admin_or_system()
     and pg_trigger_depth() <= 1 then
    raise exception 'Project status can only change via submission, review decision, procurement start, or an administrator.';
  end if;
  return new;
end;
$$;

create trigger trg_projects_guard_status
before update on public.projects
for each row execute function public.guard_project_status_change();

-- =========================================================================
-- 2. Column-level fencing for the two non-admin roles that hold an UPDATE
--    policy on `projects`:
--      - MPDC (publish window, status = APPROVED): may touch only
--        visibility / published_at / published_by.
--      - Engineering (own draft/returned project): may edit their draft
--        freely, but not publication or ownership fields.
-- =========================================================================
create or replace function public.guard_project_field_updates()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if public.app_is_admin_or_system() then
    return new;
  end if;

  if public.app_current_role() = 'mpdc' then
    if new.title is distinct from old.title
      or new.description is distinct from old.description
      or new.project_category is distinct from old.project_category
      or new.barangay is distinct from old.barangay
      or new.location_text is distinct from old.location_text
      or new.latitude is distinct from old.latitude
      or new.longitude is distinct from old.longitude
      or new.estimated_cost is distinct from old.estimated_cost
      or new.approved_budget is distinct from old.approved_budget
      or new.funding_source is distinct from old.funding_source
      or new.start_date_planned is distinct from old.start_date_planned
      or new.end_date_planned is distinct from old.end_date_planned
      or new.start_date_actual is distinct from old.start_date_actual
      or new.end_date_actual is distinct from old.end_date_actual
      or new.office_id is distinct from old.office_id
      or new.created_by is distinct from old.created_by
    then
      raise exception 'MPDC may only update publication fields (visibility, published_at, published_by) on an approved project.';
    end if;
  end if;

  if public.app_current_role() = 'engineering' then
    if new.visibility is distinct from old.visibility
      or new.published_at is distinct from old.published_at
      or new.published_by is distinct from old.published_by
      or new.created_by is distinct from old.created_by
      or new.office_id is distinct from old.office_id
    then
      raise exception 'Engineering cannot change publication or ownership fields on a project.';
    end if;
  end if;

  return new;
end;
$$;

create trigger trg_projects_guard_fields
before update on public.projects
for each row execute function public.guard_project_field_updates();

-- =========================================================================
-- 3. Submitting to MPDC is its own auditable action (a project_submissions
--    row), not a free-form status edit. Restrict it to the project's own
--    Engineering author while it's actually in a submittable state, and
--    auto-advance status when a submission is recorded.
-- =========================================================================
drop policy if exists submissions_insert_engineering on public.project_submissions;
create policy submissions_insert_engineering on public.project_submissions
  for insert to authenticated
  with check (
    public.app_current_role() in ('engineering', 'admin')
    and submitted_by = auth.uid()
    and exists (
      select 1 from public.projects p
      where p.id = project_id
        and p.created_by = auth.uid()
        and p.status in ('DRAFT', 'RETURNED_FOR_REVISION')
    )
  );

create or replace function public.apply_project_submission()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update public.projects
  set status = 'SUBMITTED_FOR_REVIEW'
  where id = new.project_id;
  return new;
end;
$$;

create trigger trg_apply_submission_status
after insert on public.project_submissions
for each row execute function public.apply_project_submission();

-- =========================================================================
-- 4. MPDC may only record a decision on a project that's actually awaiting
--    review, so an approval/return/reject can never be recorded against a
--    project nobody submitted.
-- =========================================================================
drop policy if exists approvals_insert_mpdc on public.project_approvals;
create policy approvals_insert_mpdc on public.project_approvals
  for insert to authenticated
  with check (
    public.app_current_role() in ('mpdc', 'admin')
    and reviewed_by = auth.uid()
    and exists (
      select 1 from public.projects p
      where p.id = project_id
        and p.status = 'SUBMITTED_FOR_REVIEW'
    )
  );

-- =========================================================================
-- 5. BAC may only open a procurement cycle for a project that's approved
--    (first cycle) or already in procurement (a rebid after a failed one —
--    uq_procurement_current_per_project still caps it at one *current*
--    cycle). Opening one advances the project into FOR_PROCUREMENT.
-- =========================================================================
drop policy if exists procurement_insert_bac on public.procurement;
create policy procurement_insert_bac on public.procurement
  for insert to authenticated
  with check (
    public.app_current_role() in ('bac', 'admin')
    and created_by = auth.uid()
    and exists (
      select 1 from public.projects p
      where p.id = project_id
        and p.status in ('APPROVED', 'FOR_PROCUREMENT')
    )
  );

create or replace function public.apply_procurement_start()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update public.projects
  set status = 'FOR_PROCUREMENT'
  where id = new.project_id
    and status = 'APPROVED';
  return new;
end;
$$;

create trigger trg_apply_procurement_status
after insert on public.procurement
for each row execute function public.apply_procurement_start();

-- =========================================================================
-- 6. project_images.ai_analysis_* is reserved decision-support data that
--    must stay system/admin-populated — an uploader shouldn't be able to
--    rewrite their own image's AI analysis result. uploaded_by is likewise
--    fixed at insert time (project_id is already locked by the existing
--    trg_images_lock_project trigger).
-- =========================================================================
create or replace function public.guard_project_image_updates()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if public.app_is_admin_or_system() then
    return new;
  end if;

  if new.ai_analysis_status is distinct from old.ai_analysis_status
    or new.ai_analysis_result is distinct from old.ai_analysis_result
    or new.uploaded_by is distinct from old.uploaded_by
  then
    raise exception 'ai_analysis_* and uploaded_by can only be changed by an administrator.';
  end if;

  return new;
end;
$$;

create trigger trg_images_guard_fields
before update on public.project_images
for each row execute function public.guard_project_image_updates();

-- =========================================================================
-- 7. Same idea for project_updates: the reporter of a monitoring update
--    shouldn't be reassignable by editing your own row.
-- =========================================================================
create or replace function public.guard_project_update_reporter()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if not public.app_is_admin_or_system()
     and new.reported_by is distinct from old.reported_by then
    raise exception 'reported_by can only be changed by an administrator.';
  end if;
  return new;
end;
$$;

create trigger trg_updates_guard_reporter
before update on public.project_updates
for each row execute function public.guard_project_update_reporter();

-- =========================================================================
-- 8. ADMIN "full administration access" completeness: these tables had no
--    delete policy at all (RLS defaults to deny, which silently blocked
--    even admins), and notifications/messages could only be updated or
--    deleted by their recipient, not moderated/corrected by an admin.
-- =========================================================================
create policy contractors_delete_admin on public.contractors
  for delete to authenticated using (public.app_is_admin());

create policy projects_delete_admin on public.projects
  for delete to authenticated using (public.app_is_admin());

create policy updates_delete_admin on public.project_updates
  for delete to authenticated using (public.app_is_admin());

create policy procurement_delete_admin on public.procurement
  for delete to authenticated using (public.app_is_admin());

drop policy if exists notifications_update_own on public.notifications;
create policy notifications_update_own on public.notifications
  for update to authenticated using (recipient_id = auth.uid() or public.app_is_admin());

drop policy if exists notifications_delete_own on public.notifications;
create policy notifications_delete_own on public.notifications
  for delete to authenticated using (recipient_id = auth.uid() or public.app_is_admin());

drop policy if exists messages_update_recipient on public.messages;
create policy messages_update_recipient on public.messages
  for update to authenticated using (recipient_id = auth.uid() or public.app_is_admin());
