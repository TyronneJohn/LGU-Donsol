-- Public budget-utilization transparency: lets a citizen see not just the
-- approved allocation of a published project, but how it is being spent —
-- the awarded contract (contractor, amount, dates), the savings against the
-- approved budget, Engineering's progress reports, and before/during/after
-- site photos.
--
-- DESIGN
-- ------
-- None of procurement / contractors / project_updates / project_images is
-- opened to anon. Each holds internal fields (created_by, contractor contact
-- details, issues_encountered, reporter identity, AI analysis output) that
-- must never reach the public site, and a table-level grant is one careless
-- `select *` away from leaking them — the same concern
-- 20260909110000_harden_public_projects_view.sql addressed for projects.
--
-- Instead, a single SECURITY DEFINER function returns a hand-curated JSON
-- document for ONE project, and only if that project is visibility = 'PUBLIC'.
-- The function is the whole security boundary for this data:
--   * the visibility check is inside it, so a client cannot widen it;
--   * the field list is spelled out, so adding a column to any source table
--     never publishes it by accident;
--   * it is read-only (stable, no DML).
--
-- Fields deliberately withheld: procurement.created_by, contract_number
-- before award, contractor contact person / phone / email / address /
-- license, project_updates.issues_encountered / weather_condition /
-- reported_by / GPS, project_images.uploaded_by / file_name / GPS /
-- ai_analysis_*, and ISSUE / OTHER stage photos (an ISSUE photo is an
-- internal monitoring flag, not a public finding against a contractor —
-- see the comment on project_images.ai_analysis_result).
--
-- Contract details are only released once BAC has reached AWARDED or later.
-- RA 9184 already requires the Notice of Award and contract amount to be
-- posted publicly (PhilGEPS), so this mirrors existing disclosure rules
-- rather than inventing new ones; before award, only the ABC and the
-- procurement stage are shown.
--
-- Photos are served from the private project-images bucket through a new
-- storage policy that lets anyone create a signed URL for an object ONLY
-- when it belongs to a BEFORE/DURING/AFTER image of a PUBLIC project.

-- =========================================================================
-- 1. Curated transparency document for one public project.
-- =========================================================================

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
    'savings',
      case
        when v_awarded and v_proc.contract_amount is not null and v_budget is not null
        then v_budget - v_proc.contract_amount
      end,
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

-- =========================================================================
-- 2. Storage: public read of published site photos only.
-- =========================================================================

create or replace function public.is_public_project_image(p_path text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.project_images i
    join public.projects p on p.id = i.project_id
    where i.storage_path = p_path
      and p.visibility = 'PUBLIC'
      and i.image_stage in ('BEFORE', 'DURING', 'AFTER')
  );
$$;

revoke all on function public.is_public_project_image(text) from public;
grant execute on function public.is_public_project_image(text) to anon, authenticated;

drop policy if exists "project_images_storage_select_public" on storage.objects;
create policy "project_images_storage_select_public" on storage.objects
  for select to anon, authenticated
  using (bucket_id = 'project-images' and public.is_public_project_image(name));

-- =========================================================================
-- Verification (run manually against staging before promoting):
--
--   set local role anon;
--   select public.get_public_project_transparency('<public project id>');
--       -- returns the document
--   select public.get_public_project_transparency('<private project id>');
--       -- returns NULL
--   select count(*) from public.procurement;       -- 0 rows / denied
--   select count(*) from public.project_updates;   -- 0 rows / denied
--   reset role;
-- =========================================================================
