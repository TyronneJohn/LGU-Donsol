-- Removes progress billings and contract time extensions
-- (20261004100000_billings_and_time_extensions.sql) for now — the feature
-- is being shelved until the workflow is settled. Dropping the tables also
-- deletes any records encoded so far; their audit_logs entries stay
-- (append-only). Uploaded supporting documents under
-- <project>/billings/ and <project>/time-extensions/ in the
-- project-documents bucket are not touched.
--
-- get_public_project_transparency() goes back to its
-- 20261003110000_remove_public_savings.sql definition (verbatim below).

drop table if exists public.project_billings cascade;
drop table if exists public.project_time_extensions cascade;

drop function if exists public.guard_project_billing();
drop function if exists public.guard_project_time_extension();
drop function if exists public.audit_financial_record();
drop function if exists public.require_signed_contract(uuid);
drop function if exists public.require_supporting_document(text);
drop function if exists public.apply_financial_record_void(jsonb, jsonb);

drop type if exists public.time_extension_type;

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

  return jsonb_build_object(
    'project_id', v_project.id,
    'approved_budget', v_budget,
    'contract', v_contract,
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
