-- Engineering Site Monitoring module.
--
-- Adds what's needed for Engineering to report implementation progress with
-- photo evidence on an approved project, and for the system to advance the
-- project's own status automatically as real progress is reported —
-- following the same "insert drives status" pattern already established by
-- apply_project_submission and apply_procurement_start
-- (20260811120000_rls_policy_hardening.sql).
--
-- BAC Procurement (which would normally carry a project from FOR_PROCUREMENT
-- to FOR_IMPLEMENTATION) doesn't exist yet, so monitoring is allowed to start
-- as soon as a project is APPROVED. This is intentionally forward-compatible:
-- when BAC Procurement is built and starts setting FOR_IMPLEMENTATION, this
-- trigger keeps working unchanged, since it only checks "is the project in
-- one of the pre-ONGOING states".

-- =========================================================================
-- 1. Storage bucket for site monitoring photos. Private bucket, same shape
--    as the project-documents bucket added in
--    20260811140000_engineering_project_module.sql.
-- =========================================================================
insert into storage.buckets (id, name, public)
values ('project-images', 'project-images', false)
on conflict (id) do nothing;

create policy "project_images_storage_select_staff" on storage.objects
  for select to authenticated
  using (bucket_id = 'project-images' and public.app_is_staff());

create policy "project_images_storage_insert_engineering" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'project-images' and public.app_current_role() in ('engineering', 'admin'));

create policy "project_images_storage_delete_admin" on storage.objects
  for delete to authenticated
  using (bucket_id = 'project-images' and public.app_is_admin());

-- =========================================================================
-- 2. Tighten project_updates / project_images INSERT policies to require
--    the reporting/uploading Engineering user to actually own the project
--    (matches the pattern submissions_insert_engineering already uses) and
--    for the project to be in a monitoring-eligible status. Previously these
--    only checked role, so any Engineering user could log against any
--    project regardless of who created it or what state it was in.
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
        where p.id = project_id
          and p.created_by = auth.uid()
          and p.status in ('APPROVED', 'FOR_PROCUREMENT', 'FOR_IMPLEMENTATION', 'ONGOING')
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
        where p.id = project_id
          and p.created_by = auth.uid()
          and p.status in ('APPROVED', 'FOR_PROCUREMENT', 'FOR_IMPLEMENTATION', 'ONGOING')
      )
    )
  );

-- =========================================================================
-- 3. A monitoring update reporting real progress drives the project's own
--    status: first eligible update moves it into ONGOING, and hitting 100%
--    closes it out as COMPLETED. Runs from inside the project_updates
--    insert trigger, so the projects UPDATE below passes
--    guard_project_status_change the same way the submission/procurement
--    triggers already do (pg_trigger_depth() > 1) — no change needed there.
--    project_status_history logs every status change unconditionally
--    already, so both transitions are auditable with no extra code; this
--    trigger additionally writes an explicit audit_logs entry and notifies
--    MPDC + admin, matching the density of audit logging used elsewhere.
-- =========================================================================
create or replace function public.apply_monitoring_progress()
returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_status public.project_status;
  v_project_title text;
begin
  select status, title into v_status, v_project_title
  from public.projects
  where id = new.project_id
  for update;

  if v_status in ('APPROVED', 'FOR_PROCUREMENT', 'FOR_IMPLEMENTATION') then
    update public.projects
    set status = 'ONGOING',
        start_date_actual = coalesce(start_date_actual, new.report_date)
    where id = new.project_id;

    v_status := 'ONGOING';

    perform public.write_audit_log(
      'PROJECT_MONITORING_STARTED', 'project', new.project_id,
      'First monitoring update recorded; project moved to ONGOING',
      jsonb_build_object('project_update_id', new.id)
    );

    insert into public.notifications (recipient_id, category, title, message, related_project_id)
    select p.id, 'MONITORING_ALERT',
      'Project implementation started: ' || v_project_title,
      'Engineering has begun reporting site monitoring updates.',
      new.project_id
    from public.profiles p
    where p.role in ('mpdc', 'admin') and p.is_active;
  end if;

  if v_status = 'ONGOING' and new.progress_percentage = 100 then
    update public.projects
    set status = 'COMPLETED',
        end_date_actual = new.report_date
    where id = new.project_id
      and status = 'ONGOING';

    perform public.write_audit_log(
      'PROJECT_MONITORING_COMPLETED', 'project', new.project_id,
      'Monitoring update reported 100% progress; project moved to COMPLETED',
      jsonb_build_object('project_update_id', new.id)
    );

    insert into public.notifications (recipient_id, category, title, message, related_project_id)
    select p.id, 'MONITORING_ALERT',
      'Project completed: ' || v_project_title,
      'Engineering has reported 100% progress.',
      new.project_id
    from public.profiles p
    where p.role in ('mpdc', 'admin') and p.is_active;
  end if;

  return new;
end;
$$;

create trigger trg_apply_monitoring_progress
after insert on public.project_updates
for each row execute function public.apply_monitoring_progress();
