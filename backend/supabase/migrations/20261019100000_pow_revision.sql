-- Program of Works revision loop; Engineering's "Return for Revision" removed.
--
-- A project submitted for review is already in the AIP / appropriation
-- ordinance approved by the Sangguniang Bayan and the Mayor, so its title,
-- location and allocation are fixed — there is nothing for MPDC to revise in
-- the system. During review only the Program of Works can change:
--
--   Engineering  submits the POW, which must fit within the allocation
--                (approved_budget).
--   MPDC         returns the POW to Engineering for revision with remarks,
--                endorses the project to BAC (only while POW <= allocation),
--                or rejects it.
--
-- Typos in SB-approved project data are corrected by Admin
-- (EditProjectModal); the field audit below now logs every such change.

-- =========================================================================
-- 1. Engineering can no longer return projects for revision. Old
--    RETURNED_FOR_REVISION rows stay as history; MPDC can still resubmit or
--    reject projects already in that status (unchanged policies).
-- =========================================================================
drop policy if exists approvals_insert_engineering on public.project_approvals;

-- =========================================================================
-- 2. POW revision history. One row per POW MPDC returned; the current POW
--    stays in projects.pow_* + project_pow_details. Staff-only (the public
--    sees only the current POW). Written only by return_program_of_works().
-- =========================================================================
create table if not exists public.project_pow_revisions (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  revision_no integer not null,
  pow_amount numeric(14,2),
  pow_date date,
  pow_submitted_at timestamptz,
  pow_submitted_by uuid references public.profiles(id) on delete restrict,
  -- Snapshot of the project_pow_details row; null for a POW submitted
  -- before the detailed breakdown existed.
  details jsonb,
  return_remarks text not null,
  returned_by uuid not null references public.profiles(id) on delete restrict,
  returned_at timestamptz not null default now(),
  unique (project_id, revision_no)
);

comment on table public.project_pow_revisions is
  'Programs of Works MPDC returned to Engineering for revision, with MPDC''s remarks. Written only by return_program_of_works().';

alter table public.project_pow_revisions enable row level security;

drop policy if exists pow_revisions_select_staff on public.project_pow_revisions;
create policy pow_revisions_select_staff on public.project_pow_revisions
  for select to authenticated using (public.app_is_staff());

-- =========================================================================
-- 3. The two POW guards gain an internal flag so return_program_of_works()
--    can clear the submitted POW. Bodies are otherwise unchanged
--    (guard_project_field_updates from 20260929100000, lock_program_of_works
--    from 20261011110000).
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

  if coalesce(current_setting('app.pow_return_internal', true), '') = 'true' then
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

create or replace function public.lock_program_of_works()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if public.app_is_admin_or_system() then
    return new;
  end if;

  if coalesce(current_setting('app.pow_return_internal', true), '') = 'true' then
    return new;
  end if;

  if old.pow_submitted_at is not null
    and (
      new.pow_amount is distinct from old.pow_amount
      or new.pow_date is distinct from old.pow_date
      or new.pow_submitted_at is distinct from old.pow_submitted_at
      or new.pow_submitted_by is distinct from old.pow_submitted_by
    )
  then
    raise exception 'The Program of Works has already been submitted and can no longer be edited.';
  end if;

  return new;
end;
$$;

-- =========================================================================
-- 4. return_program_of_works: MPDC (project owner) or Admin sends the
--    submitted POW back to Engineering while the project is under review.
--    Archives it, clears it so Engineering can submit a revised one, logs
--    and notifies Engineering. The project stays SUBMITTED_FOR_REVIEW.
-- =========================================================================
create or replace function public.return_program_of_works(
  p_project_id uuid,
  p_remarks text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_project public.projects%rowtype;
  v_details jsonb;
  v_revision integer;
  v_remarks text := btrim(coalesce(p_remarks, ''));
begin
  if public.app_current_role() not in ('mpdc', 'admin') then
    raise exception 'Only MPDC can return the Program of Works to Engineering.';
  end if;
  if v_remarks = '' then
    raise exception 'Enter the reason for returning the Program of Works.';
  end if;

  select * into v_project from public.projects where id = p_project_id for update;
  if not found or (not public.app_is_admin() and v_project.created_by is distinct from auth.uid()) then
    raise exception 'You cannot return the Program of Works for this project.';
  end if;
  if v_project.status <> 'SUBMITTED_FOR_REVIEW' then
    raise exception 'The Program of Works can only be returned while the project is under review.';
  end if;
  if v_project.pow_submitted_at is null then
    raise exception 'Engineering has not submitted a Program of Works for this project yet.';
  end if;

  select to_jsonb(d) - 'project_id' into v_details
  from public.project_pow_details d
  where d.project_id = p_project_id;

  select coalesce(max(revision_no), 0) + 1 into v_revision
  from public.project_pow_revisions
  where project_id = p_project_id;

  insert into public.project_pow_revisions (
    project_id, revision_no, pow_amount, pow_date, pow_submitted_at, pow_submitted_by,
    details, return_remarks, returned_by
  ) values (
    p_project_id, v_revision, v_project.pow_amount, v_project.pow_date,
    v_project.pow_submitted_at, v_project.pow_submitted_by,
    v_details, v_remarks, auth.uid()
  );

  delete from public.project_pow_details where project_id = p_project_id;

  perform set_config('app.pow_return_internal', 'true', true);
  update public.projects
     set pow_amount = null,
         pow_date = null,
         pow_submitted_at = null,
         pow_submitted_by = null
   where id = p_project_id;
  perform set_config('app.pow_return_internal', '', true);

  perform public.write_audit_log(
    'PROGRAM_OF_WORKS_RETURNED', 'project', p_project_id,
    'Program of Works returned to Engineering for revision',
    jsonb_build_object('revision_no', v_revision, 'pow_amount', v_project.pow_amount, 'remarks', v_remarks)
  );

  insert into public.notifications (recipient_id, sender_id, category, title, message, related_project_id)
  select pr.id, auth.uid(), 'PROJECT_RETURNED',
         'Program of Works returned for revision: ' || v_project.title,
         v_remarks, p_project_id
  from public.profiles pr
  where pr.role = 'engineering'
    and pr.is_active
    and pr.office_id = v_project.office_id;
end;
$$;

revoke all on function public.return_program_of_works(uuid, text) from public;
grant execute on function public.return_program_of_works(uuid, text) to authenticated;

-- =========================================================================
-- 5. submit_program_of_works: same as 20261017100000, plus the POW total
--    must fit within the allocation. Engineering revises the POW (quantities
--    / items) until it does; the allocation itself can only change through
--    the SB (supplemental budget or augmentation), never here.
-- =========================================================================
create or replace function public.submit_program_of_works(
  p_project_id uuid,
  p_pow_date date,
  p_details jsonb
)
returns numeric
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_item jsonb;
  v_items jsonb := '[]'::jsonb;
  v_qty numeric;
  v_cost numeric;
  v_amount numeric;
  v_direct numeric := 0;
  v_overhead_pct numeric := coalesce((p_details->>'overhead_pct')::numeric, 0);
  v_profit_pct numeric := coalesce((p_details->>'profit_pct')::numeric, 0);
  v_vat_pct numeric := coalesce((p_details->>'vat_pct')::numeric, 0);
  v_overhead numeric;
  v_profit numeric;
  v_vat numeric;
  v_total numeric;
  v_periods jsonb := coalesce(p_details->'schedule_periods', '[]'::jsonb);
  v_rows integer;
  v_allocation numeric;
begin
  if public.app_current_role() not in ('engineering', 'admin') then
    raise exception 'Only Engineering can submit the Program of Works.';
  end if;
  if p_pow_date is null then
    raise exception 'The Program of Works date is required.';
  end if;
  if jsonb_typeof(p_details->'items') is distinct from 'array' or jsonb_array_length(p_details->'items') = 0 then
    raise exception 'Add at least one item to the Bill of Quantities.';
  end if;
  if jsonb_typeof(v_periods) is distinct from 'array' then
    raise exception 'Invalid work schedule periods.';
  end if;
  if jsonb_typeof(p_details->'materials') is distinct from 'array' or jsonb_array_length(p_details->'materials') = 0 then
    raise exception 'List the major materials.';
  end if;
  if jsonb_typeof(p_details->'manpower') is distinct from 'array' or jsonb_array_length(p_details->'manpower') = 0 then
    raise exception 'List the manpower requirements.';
  end if;
  if v_overhead_pct not between 0 and 100 or v_profit_pct not between 0 and 100 or v_vat_pct not between 0 and 100 then
    raise exception 'Overhead, profit and VAT must be between 0 and 100 percent.';
  end if;

  for v_item in select * from jsonb_array_elements(p_details->'items') loop
    if coalesce(btrim(v_item->>'description'), '') = '' or coalesce(btrim(v_item->>'unit'), '') = '' then
      raise exception 'Every Bill of Quantities item needs a description and a unit.';
    end if;
    v_qty := (v_item->>'quantity')::numeric;
    v_cost := (v_item->>'unit_cost')::numeric;
    if v_qty is null or v_qty <= 0 or v_cost is null or v_cost < 0 then
      raise exception 'Item "%" needs a quantity above 0 and a unit cost of 0 or more.', v_item->>'description';
    end if;
    v_amount := round(v_qty * v_cost, 2);
    v_direct := v_direct + v_amount;
    v_items := v_items || jsonb_build_array(jsonb_build_object(
      'item_no', nullif(btrim(coalesce(v_item->>'item_no', '')), ''),
      'description', btrim(v_item->>'description'),
      'quantity', v_qty,
      'unit', btrim(v_item->>'unit'),
      'unit_cost', v_cost,
      'amount', v_amount,
      'schedule', case when jsonb_typeof(v_item->'schedule') = 'array' then v_item->'schedule' else '[]'::jsonb end
    ));
  end loop;

  if v_direct <= 0 then
    raise exception 'The total direct cost must be above 0.';
  end if;

  -- Weight of each item = its share of the direct cost (basis of progress).
  select jsonb_agg(e || jsonb_build_object('weight', round((e->>'amount')::numeric / v_direct * 100, 2)) order by ord)
    into v_items
  from jsonb_array_elements(v_items) with ordinality as t(e, ord);

  v_overhead := round(v_direct * v_overhead_pct / 100, 2);
  v_profit := round(v_direct * v_profit_pct / 100, 2);
  v_vat := round((v_direct + v_overhead + v_profit) * v_vat_pct / 100, 2);
  v_total := v_direct + v_overhead + v_profit + v_vat;

  select approved_budget into v_allocation from public.projects where id = p_project_id;
  if v_allocation is not null and v_total > v_allocation then
    raise exception 'The Program of Works total (%) exceeds the allocation (%). Revise the POW to fit within the allocation.',
      to_char(v_total, 'FM999,999,999,990.00'), to_char(v_allocation, 'FM999,999,999,990.00');
  end if;

  insert into public.project_pow_details (
    project_id, scope_description, mode_of_implementation, duration_days,
    items, schedule_periods, overhead_pct, profit_pct, vat_pct,
    direct_cost, overhead_amount, profit_amount, vat_amount, total_cost,
    materials, manpower, equipment, notes, created_by
  ) values (
    p_project_id,
    nullif(btrim(coalesce(p_details->>'scope_description', '')), ''),
    nullif(btrim(coalesce(p_details->>'mode_of_implementation', '')), ''),
    nullif(p_details->>'duration_days', '')::integer,
    v_items, v_periods, v_overhead_pct, v_profit_pct, v_vat_pct,
    v_direct, v_overhead, v_profit, v_vat, v_total,
    p_details->'materials', p_details->'manpower', coalesce(p_details->'equipment', '[]'::jsonb),
    nullif(btrim(coalesce(p_details->>'notes', '')), ''),
    auth.uid()
  );

  update public.projects
     set pow_amount = v_total,
         pow_date = p_pow_date,
         pow_submitted_at = now(),
         pow_submitted_by = auth.uid()
   where id = p_project_id;
  get diagnostics v_rows = row_count;
  if v_rows = 0 then
    raise exception 'You cannot submit the Program of Works for this project.';
  end if;

  return v_total;
end;
$$;

revoke all on function public.submit_program_of_works(uuid, date, jsonb) from public;
grant execute on function public.submit_program_of_works(uuid, date, jsonb) to authenticated;

-- =========================================================================
-- 6. Endorsement gate: same as 20260929100000, plus the POW must be within
--    the allocation, so no ABC above the appropriation ever reaches BAC.
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
        and p.pow_amount <= p.approved_budget
        and (public.app_is_admin() or p.created_by = auth.uid())
    )
  );

-- =========================================================================
-- 7. Field audit covers every project field Admin can correct, not just the
--    budget, so each typo fix leaves a trail (old and new values). Metadata
--    is now {field: {old, new}} for the changed fields only.
-- =========================================================================
create or replace function public.audit_project_field_edit()
returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_changes jsonb := '{}'::jsonb;
  v_field text;
  v_old jsonb := to_jsonb(old);
  v_new jsonb := to_jsonb(new);
begin
  foreach v_field in array array[
    'title', 'description', 'project_category', 'sector', 'barangay', 'location_text',
    'latitude', 'longitude', 'approved_budget', 'funding_source',
    'start_date_planned', 'end_date_planned', 'start_date_actual', 'end_date_actual'
  ] loop
    -- MPDC typing in its own draft isn't a correction; only budget changes
    -- are logged there, as before.
    if v_old->v_field is distinct from v_new->v_field
      and (old.status <> 'DRAFT' or public.app_is_admin() or v_field in ('approved_budget', 'funding_source'))
    then
      v_changes := v_changes || jsonb_build_object(
        v_field, jsonb_build_object('old', v_old->v_field, 'new', v_new->v_field)
      );
    end if;
  end loop;

  if v_changes <> '{}'::jsonb then
    perform public.write_audit_log(
      'PROJECT_FIELD_UPDATED', 'project', new.id,
      case
        when coalesce(current_setting('app.budget_backfill', true), '') = 'true'
          then 'Approved budget backfilled from estimated cost (data migration)'
        when public.app_is_admin()
          then 'Admin corrected project fields: ' || (select string_agg(k, ', ') from jsonb_object_keys(v_changes) k)
        else 'Project fields updated: ' || (select string_agg(k, ', ') from jsonb_object_keys(v_changes) k)
      end,
      v_changes
    );
  end if;
  return new;
end;
$$;

drop trigger if exists trg_projects_audit_field_edit on public.projects;
create trigger trg_projects_audit_field_edit
after update of title, description, project_category, sector, barangay, location_text,
  latitude, longitude, approved_budget, funding_source,
  start_date_planned, end_date_planned, start_date_actual, end_date_actual
on public.projects
for each row execute function public.audit_project_field_edit();
