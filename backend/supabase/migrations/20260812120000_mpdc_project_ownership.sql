-- Corrects the office-responsibility model: MPDC plans/creates/submits
-- projects, Engineering implements/monitors, BAC procures. The original
-- schema made Engineering the only project creator and then used
-- projects.created_by as a stand-in for "who may monitor this project" —
-- conflating "who typed the row in" with "which office implements it."
-- office_id (already present, already labeled "Implementing Office" in the
-- UI) is the correct field for the latter and was already unused for any
-- access-control decision, so no new column is introduced here.
--
-- Verified before writing this migration: exactly one real project exists
-- in the linked database (PRJ-2026-0001, status ONGOING, office_id already
-- = Engineering Office). It is unaffected by every change below — it's past
-- the draft stage (so the tightened draft-edit policy never applied to it
-- anyway) and its office_id already matches Engineering's office (so the
-- new office-scoped monitoring policy keeps it fully accessible).
--
-- The submission -> approval two-step (project_submissions -> insert
-- triggers apply_project_submission -> project_approvals -> insert triggers
-- apply_project_approval) is preserved exactly as-is and is NOT collapsed:
-- approvals_insert_mpdc already only required role = 'mpdc' and the project
-- to be SUBMITTED_FOR_REVIEW — it never required the reviewer to be a
-- different office, so MPDC submitting and MPDC later approving was already
-- representable without any schema change, and still goes through two
-- separate audited inserts (trg_audit_submission, apply_project_approval's
-- write_audit_log call) — there is no path that skips project_submissions
-- and reaches project_approvals directly, since the SUBMITTED_FOR_REVIEW
-- status can only be reached via a submission.

-- =========================================================================
-- 1. Project creation moves from Engineering to MPDC.
-- =========================================================================
drop policy if exists projects_insert_engineering on public.projects;
create policy projects_insert_mpdc on public.projects
  for insert to authenticated
  with check (public.app_current_role() in ('mpdc', 'admin') and created_by = auth.uid());

-- =========================================================================
-- 2. Own-draft editing moves from Engineering to MPDC. The MPDC publish
--    window (status = APPROVED) is unchanged and untouched.
-- =========================================================================
drop policy if exists projects_update_scoped on public.projects;
create policy projects_update_scoped on public.projects
  for update to authenticated
  using (
    public.app_is_admin()
    or (public.app_current_role() = 'mpdc' and created_by = auth.uid() and status in ('DRAFT', 'RETURNED_FOR_REVISION'))
    or (public.app_current_role() = 'mpdc' and status = 'APPROVED')
  );

-- Column-level fencing rewritten to be status-conditional for MPDC (own
-- draft vs. publish window are different permission sets on the same role)
-- and drops the Engineering branch entirely, since Engineering no longer
-- holds any row-level UPDATE access to `projects` at all (the USING clause
-- above never matches an Engineering user).
create or replace function public.guard_project_field_updates()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if public.app_is_admin_or_system() then
    return new;
  end if;

  if public.app_current_role() = 'mpdc' then
    if old.status = 'APPROVED' then
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
    else
      if new.visibility is distinct from old.visibility
        or new.published_at is distinct from old.published_at
        or new.published_by is distinct from old.published_by
        or new.created_by is distinct from old.created_by
        or new.office_id is distinct from old.office_id
      then
        raise exception 'MPDC cannot change publication or ownership fields on a project.';
      end if;
    end if;
  end if;

  return new;
end;
$$;

-- =========================================================================
-- 3. Submitting for review moves from Engineering to MPDC. Still a
--    dedicated, audited insert — not a status edit — same as before.
-- =========================================================================
drop policy if exists submissions_insert_engineering on public.project_submissions;
create policy submissions_insert_mpdc on public.project_submissions
  for insert to authenticated
  with check (
    public.app_current_role() in ('mpdc', 'admin')
    and submitted_by = auth.uid()
    and exists (
      select 1 from public.projects p
      where p.id = project_id
        and p.created_by = auth.uid()
        and p.status in ('DRAFT', 'RETURNED_FOR_REVISION')
    )
  );

-- approvals_insert_mpdc is intentionally left untouched (see header note).

-- =========================================================================
-- 4. Engineering site monitoring: the actual bug fix. Eligibility to log a
--    monitoring update/photo now depends on the project's implementing
--    office (projects.office_id) matching the reporting user's own office,
--    not on who happened to create the project row. This lets any
--    Engineering staffer monitor any project assigned to the Engineering
--    office — matching how BAC already works — instead of only the one
--    individual user who created it.
-- =========================================================================
drop policy if exists updates_insert_engineering on public.project_updates;
create policy updates_insert_engineering on public.project_updates
  for insert to authenticated
  with check (
    public.app_current_role() in ('engineering', 'admin')
    and reported_by = auth.uid()
    and (
      public.app_is_admin()
      or exists (
        select 1 from public.projects p
        join public.profiles me on me.id = auth.uid()
        where p.id = project_id
          and p.office_id = me.office_id
          and p.status in ('FOR_IMPLEMENTATION', 'ONGOING')
      )
    )
  );

drop policy if exists images_insert_engineering on public.project_images;
create policy images_insert_engineering on public.project_images
  for insert to authenticated
  with check (
    public.app_current_role() in ('engineering', 'admin')
    and uploaded_by = auth.uid()
    and (
      public.app_is_admin()
      or exists (
        select 1 from public.projects p
        join public.profiles me on me.id = auth.uid()
        where p.id = project_id
          and p.office_id = me.office_id
          and p.status in ('FOR_IMPLEMENTATION', 'ONGOING')
      )
    )
  );

-- =========================================================================
-- 5. Initial project documents (program of works, permits, design plans)
--    are planning-stage attachments and move with project creation to MPDC.
--    Engineering's own implementation-stage evidence continues to go
--    through project_images / the project-images bucket, untouched.
-- =========================================================================
drop policy if exists pdocs_insert_engineering on public.project_documents;
create policy pdocs_insert_mpdc on public.project_documents
  for insert to authenticated
  with check (public.app_current_role() in ('mpdc', 'admin') and uploaded_by = auth.uid());

drop policy if exists "project_documents_storage_insert_engineering" on storage.objects;
create policy "project_documents_storage_insert_mpdc" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'project-documents' and public.app_current_role() in ('mpdc', 'admin'));

-- =========================================================================
-- 6. Project creation itself becomes an explicitly audited action, reusing
--    the existing generic insert-audit helper already used for documents/
--    images/accomplishments/bidders — not a new audit system.
--    project_status_history already records the DRAFT row via
--    trg_projects_log_status; this adds the equivalent audit_logs entry.
-- =========================================================================
create trigger trg_audit_project_created
after insert on public.projects
for each row execute function public.audit_generic_insert('project', 'PROJECT_CREATED');
