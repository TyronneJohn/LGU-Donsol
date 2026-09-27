-- MPDC owns the approval decision and the budget; Engineering owns the
-- technical review (Program of Works) and may only recommend.
--
-- Confirmed with the client (MPDC) during testing: MPDC approves or rejects
-- projects and declares the allocation and funding source from the AIP.
-- This matches RA 7160 — the planning and development coordinator prepares
-- the AIP and sits on the Local Finance Committee (Sec. 316, Sec. 476),
-- while the municipal engineer's deliverable is the POW and its detailed
-- cost estimate (Sec. 477), which GPPB treats as the basis of the ABC.
--
-- Supersedes 20260909100000_mpdc_budget_engineering_pow.sql.hold. That file
-- was never applied, and it predates 20260928100000_security_fixes.sql,
-- which redefines guard_project_field_updates() — unholding it in place
-- would have had its guard silently overwritten. Its content is carried
-- forward here on top of the security_fixes definition.
--
-- Workflow after this migration:
--   MPDC        drafts the project with approved_budget + funding_source,
--               submits it, then either endorses it to BAC (= approval,
--               project_endorsements) or rejects it (project_approvals).
--   Engineering submits the POW, or returns the project to MPDC for
--               revision with remarks. Engineering can no longer reject.

-- =========================================================================
-- 1. POW columns. Engineering-written, and the record that their technical
--    review actually happened — see part 4 for why that matters.
-- =========================================================================
alter table public.projects
  add column if not exists pow_amount numeric(14,2) check (pow_amount >= 0),
  add column if not exists pow_date date,
  add column if not exists pow_submitted_at timestamptz,
  add column if not exists pow_submitted_by uuid references public.profiles(id) on delete restrict;

comment on column public.projects.approved_budget is
  'MPDC allocation for the project, from the AIP. Written by MPDC while the project is a draft; acts as the ceiling the POW is measured against.';
comment on column public.projects.pow_amount is
  'Total cost in the Engineering Program of Works. Basis of the ABC at procurement (GPPB); written only by Engineering, only during review.';

-- =========================================================================
-- 2. Column-level fence. Body is 20260928100000's definition with the
--    ownership swap applied: Engineering loses approved_budget and
--    funding_source and gains the four pow_* columns; MPDC is fenced out of
--    pow_* in both branches the same way it is fenced out of dss_*.
-- =========================================================================
create or replace function public.guard_project_field_updates()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if coalesce(current_setting('app.dss_internal_write', true), '') = 'true' then
    return new;
  end if;

  if coalesce(current_setting('app.auto_publish_internal', true), '') = 'true' then
    return new;
  end if;

  if public.app_is_admin_or_system() then
    return new;
  end if;

  if public.app_current_role() = 'mpdc' then
    if old.status = 'APPROVED' then
      if new.title is distinct from old.title
        or new.description is distinct from old.description
        or new.project_category is distinct from old.project_category
        or new.sector is distinct from old.sector
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
        or new.dss_decision is distinct from old.dss_decision
        or new.dss_severity is distinct from old.dss_severity
        or new.dss_evaluated_at is distinct from old.dss_evaluated_at
        or new.pow_amount is distinct from old.pow_amount
        or new.pow_date is distinct from old.pow_date
        or new.pow_submitted_at is distinct from old.pow_submitted_at
        or new.pow_submitted_by is distinct from old.pow_submitted_by
      then
        raise exception 'MPDC may only update publication fields (visibility, published_at, published_by) on an approved project.';
      end if;
    else
      if new.visibility is distinct from old.visibility
        or new.published_at is distinct from old.published_at
        or new.published_by is distinct from old.published_by
        or new.created_by is distinct from old.created_by
        or new.office_id is distinct from old.office_id
        or new.dss_decision is distinct from old.dss_decision
        or new.dss_severity is distinct from old.dss_severity
        or new.dss_evaluated_at is distinct from old.dss_evaluated_at
        or new.pow_amount is distinct from old.pow_amount
        or new.pow_date is distinct from old.pow_date
        or new.pow_submitted_at is distinct from old.pow_submitted_at
        or new.pow_submitted_by is distinct from old.pow_submitted_by
      then
        raise exception 'MPDC cannot change publication, ownership, or Program of Works fields on a project.';
      end if;
    end if;
  end if;

  if public.app_current_role() = 'engineering' then
    if new.title is distinct from old.title
      or new.description is distinct from old.description
      or new.project_category is distinct from old.project_category
      or new.sector is distinct from old.sector
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
      or new.visibility is distinct from old.visibility
      or new.published_at is distinct from old.published_at
      or new.published_by is distinct from old.published_by
      or new.dss_decision is distinct from old.dss_decision
      or new.dss_severity is distinct from old.dss_severity
      or new.dss_evaluated_at is distinct from old.dss_evaluated_at
    then
      raise exception 'Engineering may only update the Program of Works fields while a project is under review.';
    end if;

    if new.pow_submitted_by is distinct from old.pow_submitted_by
      and new.pow_submitted_by is distinct from auth.uid()
    then
      raise exception 'A Program of Works must be recorded under the account of the engineer submitting it.';
    end if;
  end if;

  return new;
end;
$$;

-- =========================================================================
-- 3. MPDC must supply the allocation before the project can be submitted —
--    Engineering costs the work against it, so it has to be there first.
--    estimated_cost is no longer required: projects are encoded after the
--    Sanggunian has appropriated them, so the approved budget is the only
--    figure MPDC enters. The column stays for projects encoded before this.
-- =========================================================================
create or replace function public.guard_project_submission_completeness()
returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_project record;
begin
  select title, description, project_category, sector, barangay, location_text,
         approved_budget, funding_source,
         start_date_planned, end_date_planned, office_id
  into v_project
  from public.projects
  where id = new.project_id;

  if v_project.title is null or btrim(v_project.title) = ''
    or v_project.description is null or btrim(v_project.description) = ''
    or v_project.project_category is null or btrim(v_project.project_category) = ''
    or v_project.sector is null
    or v_project.barangay is null or btrim(v_project.barangay) = ''
    or v_project.location_text is null or btrim(v_project.location_text) = ''
    or v_project.approved_budget is null
    or v_project.funding_source is null or btrim(v_project.funding_source) = ''
    or v_project.start_date_planned is null
    or v_project.end_date_planned is null
    or v_project.office_id is null
  then
    raise exception 'Project is missing required fields (name, description, programs/project/activities, category, barangay, location, approved budget, funding source, schedule, or implementing office) and cannot be submitted for review.';
  end if;

  return new;
end;
$$;

-- =========================================================================
-- 4. The endorsement (approval) gate, repointed.
--
--    20260820100000 used "approved_budget is set and positive" as proof that
--    Engineering had reviewed the project, on the reasoning that it was the
--    one field only Engineering could write. approved_budget is MPDC's own
--    field now, so keeping that gate would let MPDC satisfy its own
--    precondition and approve without Engineering ever opening the project.
--    pow_amount — the actual deliverable of the technical review — takes
--    its place.
-- =========================================================================
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
        and p.pow_amount is not null
        and p.pow_amount > 0
        and (public.app_is_admin() or p.created_by = auth.uid())
    )
  );

-- =========================================================================
-- 5. Rejection moves from Engineering to MPDC.
--
--    Engineering keeps RETURNED_FOR_REVISION: sending the project back with
--    remarks is how it flags technical issues, and MPDC still decides what
--    happens next. REJECTED is MPDC's alone, on its own project, while it
--    is under review or after Engineering has returned it (so MPDC can drop
--    a project Engineering flagged instead of revising it). The submission
--    must belong to the same project, so a decision can't be filed against
--    another project's submission.
--
--    apply_project_approval() is unchanged — it already drives the status
--    from the decision and writes a role-neutral audit entry.
-- =========================================================================
drop policy if exists approvals_insert_engineering on public.project_approvals;
create policy approvals_insert_engineering on public.project_approvals
  for insert to authenticated
  with check (
    public.app_current_role() = 'engineering'
    and reviewed_by = auth.uid()
    and decision = 'RETURNED_FOR_REVISION'
    and exists (
      select 1 from public.projects p
      join public.profiles me on me.id = auth.uid()
      join public.project_submissions s on s.id = submission_id and s.project_id = p.id
      where p.id = project_id
        and p.status = 'SUBMITTED_FOR_REVIEW'
        and p.office_id = me.office_id
    )
  );

drop policy if exists approvals_insert_mpdc on public.project_approvals;
create policy approvals_insert_mpdc on public.project_approvals
  for insert to authenticated
  with check (
    public.app_current_role() = 'mpdc'
    and reviewed_by = auth.uid()
    and decision = 'REJECTED'
    and exists (
      select 1 from public.projects p
      join public.project_submissions s on s.id = submission_id and s.project_id = p.id
      where p.id = project_id
        and p.status in ('SUBMITTED_FOR_REVIEW', 'RETURNED_FOR_REVISION')
        and p.created_by = auth.uid()
    )
  );

-- =========================================================================
-- 6. Budget audit entry, reworded. 20260812140000 hardcoded "Engineering
--    updated project fields", which is wrong now that MPDC owns these two
--    columns. actor_id already records who made the change, so the
--    description stays role-neutral. A migration that backfills the budget
--    can set app.budget_backfill to label its entries as such.
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
      case
        when coalesce(current_setting('app.budget_backfill', true), '') = 'true'
          then 'Approved budget backfilled from estimated cost (data migration)'
        else 'Approved budget / funding source updated'
      end,
      jsonb_build_object(
        'old_approved_budget', old.approved_budget, 'new_approved_budget', new.approved_budget,
        'old_funding_source', old.funding_source, 'new_funding_source', new.funding_source
      )
    );
  end if;
  return new;
end;
$$;
