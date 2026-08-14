-- Engineering edit access on the shared projects row (field-scoped), a
-- project-field audit trail (didn't exist before), Engineering's own
-- project_documents upload window, and the Engineering -> BAC forward
-- handoff via a new project_endorsements table.
--
-- There remains exactly one projects row for the whole lifecycle — MPDC,
-- Engineering, and BAC all read/write the same project_id. This migration
-- only widens who may touch which columns of that single row; it never
-- introduces a per-office copy of project data.

-- =========================================================================
-- 1. Engineering row-level UPDATE access: own office's project, only while
--    it's actually in their review window.
-- =========================================================================
drop policy if exists projects_update_scoped on public.projects;
create policy projects_update_scoped on public.projects
  for update to authenticated
  using (
    public.app_is_admin()
    or (public.app_current_role() = 'mpdc' and created_by = auth.uid() and status in ('DRAFT', 'RETURNED_FOR_REVISION'))
    or (public.app_current_role() = 'mpdc' and status = 'APPROVED')
    or (
      public.app_current_role() = 'engineering'
      and status = 'SUBMITTED_FOR_REVIEW'
      and office_id = (select office_id from public.profiles where id = auth.uid())
    )
  );

-- =========================================================================
-- 2. Column-level fence: Engineering may change ONLY approved_budget and
--    funding_source. Every other column raises, including status (already
--    separately fenced by guard_project_status_change, untouched here).
-- =========================================================================
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

  if public.app_current_role() = 'engineering' then
    if new.title is distinct from old.title
      or new.description is distinct from old.description
      or new.project_category is distinct from old.project_category
      or new.barangay is distinct from old.barangay
      or new.location_text is distinct from old.location_text
      or new.latitude is distinct from old.latitude
      or new.longitude is distinct from old.longitude
      or new.estimated_cost is distinct from old.estimated_cost
      or new.start_date_planned is distinct from old.start_date_planned
      or new.end_date_planned is distinct from old.end_date_planned
      or new.start_date_actual is distinct from old.start_date_actual
      or new.end_date_actual is distinct from old.end_date_actual
      or new.office_id is distinct from old.office_id
      or new.created_by is distinct from old.created_by
      or new.visibility is distinct from old.visibility
      or new.published_at is distinct from old.published_at
      or new.published_by is distinct from old.published_by
    then
      raise exception 'Engineering may only update approved_budget and funding_source while a project is under review.';
    end if;
  end if;

  return new;
end;
$$;

-- =========================================================================
-- 3. Project-field audit trail — no trigger previously logged field-level
--    edits on `projects` (only status and visibility changes were audited).
--    Reuses write_audit_log(), not a new audit mechanism.
-- =========================================================================
create or replace function public.audit_project_field_edit()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.approved_budget is distinct from old.approved_budget
    or new.funding_source is distinct from old.funding_source
  then
    perform public.write_audit_log(
      'PROJECT_FIELD_UPDATED', 'project', new.id,
      'Engineering updated project fields',
      jsonb_build_object(
        'old_approved_budget', old.approved_budget, 'new_approved_budget', new.approved_budget,
        'old_funding_source', old.funding_source, 'new_funding_source', new.funding_source
      )
    );
  end if;
  return new;
end;
$$;

create trigger trg_projects_audit_field_edit
after update of approved_budget, funding_source on public.projects
for each row execute function public.audit_project_field_edit();

-- =========================================================================
-- 4. Engineering may also upload project_documents (technical documents /
--    photos required before endorsement), alongside MPDC's existing policy
--    — not replacing it. Same table, same bucket, no duplicate storage
--    system. Own office, review window only.
-- =========================================================================
create policy pdocs_insert_engineering on public.project_documents
  for insert to authenticated
  with check (
    public.app_current_role() in ('engineering', 'admin')
    and uploaded_by = auth.uid()
    and exists (
      select 1 from public.projects p
      join public.profiles me on me.id = auth.uid()
      where p.id = project_id
        and p.status = 'SUBMITTED_FOR_REVIEW'
        and (public.app_is_admin() or p.office_id = me.office_id)
    )
  );

create policy "project_documents_storage_insert_engineering" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'project-documents' and public.app_current_role() in ('engineering', 'admin'));

-- =========================================================================
-- 5. PROJECT_ENDORSEMENTS — Engineering -> BAC forward handoff.
--
--    Deliberately NOT project_approvals: an endorsement carries no
--    decision/verdict semantics (there is no "endorsed but rejected"
--    outcome), it is only ever a forward record — structurally the same
--    shape and role as project_submissions (MPDC -> Engineering), just one
--    step later in the pipeline. Inserting one is the only way
--    projects.status moves to APPROVED going forward; project_approvals
--    can no longer produce that transition for Engineering (see the
--    revised 20260812130000).
--
--    projects.status keeps the existing APPROVED value — no enum rename.
--    It's already read purely operationally elsewhere (procurement
--    eligibility, monitoring visibility), never as a decision record, so
--    reusing it here doesn't misrepresent the workflow. Only the
--    frontend label changes (src/utils/projectStatus.js), separately.
-- =========================================================================
create table public.project_endorsements (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  endorsed_by uuid not null references public.profiles(id) on delete restrict,
  notes text,
  endorsed_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index idx_endorsements_project on public.project_endorsements(project_id);
create index idx_endorsements_by on public.project_endorsements(endorsed_by);

alter table public.project_endorsements enable row level security;

create policy endorsements_select_staff on public.project_endorsements
  for select to authenticated using (public.app_is_staff());

create policy endorsements_insert_engineering on public.project_endorsements
  for insert to authenticated
  with check (
    public.app_current_role() in ('engineering', 'admin')
    and endorsed_by = auth.uid()
    and exists (
      select 1 from public.projects p
      join public.profiles me on me.id = auth.uid()
      where p.id = project_id
        and p.status = 'SUBMITTED_FOR_REVIEW'
        and (public.app_is_admin() or p.office_id = me.office_id)
    )
  );

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
      'Engineering endorsed project to BAC for procurement',
      jsonb_build_object('endorsement_id', new.id)
    );

    insert into public.notifications (recipient_id, category, title, message, related_project_id)
    select p.id, 'PROCUREMENT_UPDATE',
      'Project ready for procurement: ' || v_project_title,
      coalesce(new.notes, 'Engineering has endorsed this project for procurement.'),
      new.project_id
    from public.profiles p
    where p.role in ('bac', 'admin') and p.is_active;
  end if;

  return new;
end;
$$;

create trigger trg_apply_endorsement
after insert on public.project_endorsements
for each row execute function public.apply_project_endorsement();
