-- Detailed Program of Works (panel revision): Engineering enters the full POW
-- — Bill of Quantities, cost summary, work schedule, materials, manpower and
-- equipment — instead of only a total amount and a file. It is shown to MPDC,
-- on the monitoring pages, and to the public (get_public_project_transparency),
-- so anyone can see where the budget goes.
--
-- Written once, through submit_program_of_works(), together with the
-- existing projects.pow_* fields. The function computes every total itself
-- (amounts, weights, overhead, profit, VAT, ABC) so the stored figures always
-- add up, whatever the client sent. Final once submitted, like the POW
-- amount (lock_program_of_works).

create table if not exists public.project_pow_details (
  project_id uuid primary key references public.projects(id) on delete cascade,
  scope_description text,
  mode_of_implementation text,
  duration_days integer check (duration_days is null or duration_days between 1 and 3650),
  -- [{item_no, description, quantity, unit, unit_cost, amount, weight, schedule: [number|null, ...]}]
  items jsonb not null,
  -- Labels of the work-schedule periods, e.g. ["Wk 1-2", "Wk 3-4"].
  schedule_periods jsonb not null default '[]'::jsonb,
  overhead_pct numeric(5,2) not null check (overhead_pct between 0 and 100),
  profit_pct numeric(5,2) not null check (profit_pct between 0 and 100),
  vat_pct numeric(5,2) not null check (vat_pct between 0 and 100),
  direct_cost numeric(14,2) not null,
  overhead_amount numeric(14,2) not null,
  profit_amount numeric(14,2) not null,
  vat_amount numeric(14,2) not null,
  total_cost numeric(14,2) not null,
  -- [{name, quantity, unit, remarks}]
  materials jsonb not null default '[]'::jsonb,
  -- [{role, count}]
  manpower jsonb not null default '[]'::jsonb,
  -- [{name, count}]
  equipment jsonb not null default '[]'::jsonb,
  notes text,
  created_by uuid not null default auth.uid() references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now()
);

comment on table public.project_pow_details is
  'Engineering''s detailed Program of Works. Totals are computed by submit_program_of_works(); total_cost equals projects.pow_amount. Public through get_public_project_transparency().';

alter table public.project_pow_details enable row level security;

drop policy if exists pow_details_select_staff on public.project_pow_details;
create policy pow_details_select_staff on public.project_pow_details
  for select to authenticated using (public.app_is_staff());

drop policy if exists pow_details_insert_engineering on public.project_pow_details;
create policy pow_details_insert_engineering on public.project_pow_details
  for insert to authenticated
  with check (
    public.app_current_role() in ('engineering', 'admin')
    and created_by = auth.uid()
    and (
      public.app_is_admin()
      or exists (
        select 1 from public.projects p
        join public.profiles me on me.id = auth.uid()
        where p.id = project_id
          and p.office_id = me.office_id
          and p.status = 'SUBMITTED_FOR_REVIEW'
          and p.pow_submitted_at is null
      )
    )
  );

-- ---------------------------------------------------------------------------
-- submit_program_of_works: validate, compute, save. SECURITY INVOKER, so the
-- caller's own RLS (insert above, projects_update_scoped) and the existing
-- guard / lock triggers on projects all still apply.
-- ---------------------------------------------------------------------------
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

-- ---------------------------------------------------------------------------
-- Public transparency: same as 20261004140000, plus 'program_of_works'.
-- ---------------------------------------------------------------------------
create or replace function public.get_public_project_transparency(p_project_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_project public.projects%rowtype;
  v_budget numeric(14,2);
  v_proc record;
  v_awarded boolean;
  v_contract jsonb := null;
  v_progress numeric(5,2);
  v_pow jsonb := null;
begin
  select * into v_project
  from public.projects
  where id = p_project_id and visibility = 'PUBLIC';

  if not found then
    return null;
  end if;

  v_budget := coalesce(v_project.approved_budget, v_project.estimated_cost);

  select pr.status, pr.mode_of_procurement, pr.abc_amount, pr.contract_number,
         pr.contract_amount, pr.contract_signed_date, pr.notice_to_proceed_date,
         pr.contract_duration_days, pr.expected_completion_date,
         c.name as contractor_name
    into v_proc
  from public.procurement pr
  left join public.contractors c on c.id = pr.contractor_id
  where pr.project_id = p_project_id and pr.is_current;

  if found then
    v_awarded := v_proc.status in ('AWARDED', 'CONTRACT_SIGNED', 'COMPLETED');
    v_contract := jsonb_build_object(
      'status', v_proc.status,
      'mode_of_procurement', v_proc.mode_of_procurement,
      'abc_amount', v_proc.abc_amount,
      'awarded', v_awarded,
      'contractor_name', case when v_awarded then v_proc.contractor_name end,
      'contract_number', case when v_awarded then v_proc.contract_number end,
      'contract_amount', case when v_awarded then v_proc.contract_amount end,
      'contract_signed_date', case when v_awarded then v_proc.contract_signed_date end,
      'notice_to_proceed_date', case when v_awarded then v_proc.notice_to_proceed_date end,
      'contract_duration_days', case when v_awarded then v_proc.contract_duration_days end,
      'expected_completion_date', case when v_awarded then v_proc.expected_completion_date end
    );
  end if;

  select u.progress_percentage into v_progress
  from public.project_updates u
  where u.project_id = p_project_id and u.progress_percentage is not null
  order by u.report_date desc, u.created_at desc
  limit 1;

  select jsonb_build_object(
           'pow_date', v_project.pow_date,
           'scope_description', d.scope_description,
           'mode_of_implementation', d.mode_of_implementation,
           'duration_days', d.duration_days,
           'items', d.items,
           'schedule_periods', d.schedule_periods,
           'overhead_pct', d.overhead_pct,
           'profit_pct', d.profit_pct,
           'vat_pct', d.vat_pct,
           'direct_cost', d.direct_cost,
           'overhead_amount', d.overhead_amount,
           'profit_amount', d.profit_amount,
           'vat_amount', d.vat_amount,
           'total_cost', d.total_cost,
           'materials', d.materials,
           'manpower', d.manpower,
           'equipment', d.equipment,
           'notes', d.notes
         )
    into v_pow
  from public.project_pow_details d
  where d.project_id = p_project_id;

  return jsonb_build_object(
    'project_id', v_project.id,
    'approved_budget', v_budget,
    'contract', v_contract,
    'program_of_works', v_pow,
    'progress_percentage',
      case when v_project.status = 'COMPLETED' then 100 else v_progress end,
    'updates', coalesce((
      select jsonb_agg(
               jsonb_build_object(
                 'id', u.id,
                 'report_date', u.report_date,
                 'progress_percentage', u.progress_percentage,
                 'narrative_report', u.narrative_report
               )
               order by u.report_date desc, u.created_at desc
             )
      from public.project_updates u
      where u.project_id = p_project_id
    ), '[]'::jsonb),
    'photos', coalesce((
      select jsonb_agg(
               jsonb_build_object(
                 'id', i.id,
                 'storage_path', i.storage_path,
                 'image_stage', i.image_stage,
                 'project_update_id', i.project_update_id,
                 'captured_at', coalesce(i.captured_at, i.created_at)
               )
               order by coalesce(i.captured_at, i.created_at)
             )
      from public.project_images i
      where i.project_id = p_project_id
        and i.image_stage in ('BEFORE', 'DURING', 'AFTER')
    ), '[]'::jsonb)
  );
end;
$$;

revoke all on function public.get_public_project_transparency(uuid) from public;
grant execute on function public.get_public_project_transparency(uuid) to anon, authenticated;
