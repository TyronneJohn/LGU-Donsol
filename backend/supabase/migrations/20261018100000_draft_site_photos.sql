-- Draft site photos: Engineering's image processing stays private until the
-- monitoring update MPDC requested is submitted.
--
-- Flow (ProjectMonitoringDetail.jsx / BeforeAfterSection.jsx):
--   1. MPDC requests an update; Engineering opens the project.
--   2. Engineering takes AFTER photos ("Taken by" asked first) and generates
--      the Before & After comparison. Both are DRAFTS (released_at is null):
--      only Engineering of the implementing office and admins can see them.
--   3. Submitting the monitoring update needs at least one draft comparison.
--      The insert links every draft photo / comparison of the project to the
--      new update and releases them, so MPDC, BAC and the public see them
--      only from then on.
--   4. A COMPLETED project has no more update requests, so its later AFTER
--      photos are released with release_completed_project_photos() ("Submit
--      AFTER photos to MPDC").
-- BEFORE photos are the baseline and are released immediately.

-- ---------------------------------------------------------------------------
-- 1. Columns. Everything already on file was visible before this migration,
--    so it is backfilled as released.
-- ---------------------------------------------------------------------------
alter table public.project_images
  add column if not exists released_at timestamptz;

update public.project_images
set released_at = coalesce(created_at, now())
where released_at is null;

alter table public.project_before_after_comparisons
  add column if not exists released_at timestamptz,
  add column if not exists project_update_id uuid references public.project_updates(id) on delete set null;

update public.project_before_after_comparisons
set released_at = created_at
where released_at is null;

comment on column public.project_images.released_at is
  'Null while the photo is an Engineering draft (visible to Engineering of the implementing office and admins only). Set when the monitoring update it belongs to is submitted, or by release_completed_project_photos().';
comment on column public.project_before_after_comparisons.released_at is
  'Null while the comparison is an Engineering draft. Set together with its photos.';

-- ---------------------------------------------------------------------------
-- 2. Who may see drafts of a project: admins, and Engineering of the
--    project's implementing office.
-- ---------------------------------------------------------------------------
create or replace function public.app_can_see_draft_photos(p_project_id uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  select public.app_is_admin()
    or exists (
      select 1
      from public.projects p
      join public.profiles me on me.id = auth.uid()
      where p.id = p_project_id
        and me.role = 'engineering'
        and me.is_active
        and p.office_id = me.office_id
    );
$$;

revoke all on function public.app_can_see_draft_photos(uuid) from public;
grant execute on function public.app_can_see_draft_photos(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. released_at is decided by the database, never by the client: BEFORE
--    photos and photos attached to an update are released on insert, every
--    other photo starts as a draft. (Only admins can UPDATE project_images —
--    images_update_admin — so a draft can't be self-released either.)
-- ---------------------------------------------------------------------------
create or replace function public.set_project_image_release()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  new.released_at := case
    when new.image_stage = 'BEFORE' or new.project_update_id is not null then now()
    else null
  end;
  return new;
end;
$$;

drop trigger if exists trg_images_set_release on public.project_images;
create trigger trg_images_set_release
before insert on public.project_images
for each row execute function public.set_project_image_release();

-- ---------------------------------------------------------------------------
-- 4. Read access: released rows for every staff role, drafts only for those
--    allowed above. Same rule for the photo files themselves.
-- ---------------------------------------------------------------------------
drop policy if exists images_select_staff on public.project_images;
create policy images_select_staff on public.project_images
  for select to authenticated
  using (
    public.app_is_staff()
    and (released_at is not null or public.app_can_see_draft_photos(project_id))
  );

drop policy if exists before_after_select_staff on public.project_before_after_comparisons;
create policy before_after_select_staff on public.project_before_after_comparisons
  for select to authenticated
  using (
    public.app_is_staff()
    and (released_at is not null or public.app_can_see_draft_photos(project_id))
  );

-- True unless the path belongs to a draft photo the caller may not see.
create or replace function public.is_visible_staff_project_image(p_path text)
returns boolean
language sql stable security definer set search_path = public as $$
  select not exists (
    select 1
    from public.project_images i
    where i.storage_path = p_path
      and i.released_at is null
      and not public.app_can_see_draft_photos(i.project_id)
  );
$$;

revoke all on function public.is_visible_staff_project_image(text) from public;
grant execute on function public.is_visible_staff_project_image(text) to authenticated;

drop policy if exists "project_images_storage_select_staff" on storage.objects;
create policy "project_images_storage_select_staff" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'project-images'
    and public.app_is_staff()
    and public.is_visible_staff_project_image(name)
  );

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
      and i.released_at is not null
  );
$$;

-- ---------------------------------------------------------------------------
-- 5. Submitting a monitoring update: needs a Before & After comparison
--    generated for it (a draft one), then releases the drafts into it.
-- ---------------------------------------------------------------------------
create or replace function public.require_draft_comparison()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if public.app_is_admin_or_system() then
    return new;
  end if;

  -- A draft comparison of a draft AFTER photo: re-generating an old,
  -- already-submitted photo doesn't count as this update's site visit.
  if not exists (
    select 1
    from public.project_before_after_comparisons c
    join public.project_images i on i.id = c.after_image_id
    where c.project_id = new.project_id
      and c.released_at is null
      and i.released_at is null
  ) then
    raise exception 'Take an AFTER photo and Generate the Before & After comparison before submitting the monitoring update.'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_require_draft_comparison on public.project_updates;
create trigger trg_require_draft_comparison
before insert on public.project_updates
for each row execute function public.require_draft_comparison();

create or replace function public.release_draft_photos_into_update()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update public.project_images
  set released_at = now(),
      project_update_id = coalesce(project_update_id, new.id)
  where project_id = new.project_id and released_at is null;

  update public.project_before_after_comparisons
  set released_at = now(),
      project_update_id = new.id
  where project_id = new.project_id and released_at is null;

  return new;
end;
$$;

drop trigger if exists trg_release_draft_photos on public.project_updates;
create trigger trg_release_draft_photos
after insert on public.project_updates
for each row execute function public.release_draft_photos_into_update();

-- ---------------------------------------------------------------------------
-- 6. COMPLETED projects: no more update requests, so AFTER photos taken
--    after the last update are released explicitly. Returns how many photos
--    were released.
-- ---------------------------------------------------------------------------
create or replace function public.release_completed_project_photos(p_project_id uuid)
returns integer
language plpgsql security definer set search_path = public as $$
declare
  v_status public.project_status;
  v_count integer;
begin
  if not public.app_can_see_draft_photos(p_project_id) then
    raise exception 'Only Engineering of the implementing office or an administrator can submit these photos.'
      using errcode = 'insufficient_privilege';
  end if;

  select status into v_status from public.projects where id = p_project_id;
  if v_status is distinct from 'COMPLETED' then
    raise exception 'Photos are submitted with the monitoring update until the project is completed.'
      using errcode = 'check_violation';
  end if;

  update public.project_images
  set released_at = now()
  where project_id = p_project_id and released_at is null;
  get diagnostics v_count = row_count;

  update public.project_before_after_comparisons
  set released_at = now()
  where project_id = p_project_id and released_at is null;

  return v_count;
end;
$$;

revoke all on function public.release_completed_project_photos(uuid) from public;
grant execute on function public.release_completed_project_photos(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 7. Public transparency: same as 20261017100000, but released photos only.
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
        and i.released_at is not null
    ), '[]'::jsonb)
  );
end;
$$;

revoke all on function public.get_public_project_transparency(uuid) from public;
grant execute on function public.get_public_project_transparency(uuid) to anon, authenticated;
