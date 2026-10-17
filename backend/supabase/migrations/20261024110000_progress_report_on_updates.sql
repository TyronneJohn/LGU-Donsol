-- Monitoring updates carry a Progress Report, not a Program of Works. The POW
-- is submitted once during review and locked; what Engineering attaches to
-- each update is the report of the progress it claims.
--
-- 1. The monitoring-window insert policy (20261004150000) now allows only
--    PROGRESS_REPORT, so Engineering can no longer file a new POW while the
--    project is under implementation.
-- 2. Files already attached to an update (project_update_id set, from
--    20261004160000) were uploaded through that form, so they are
--    reclassified as PROGRESS_REPORT. POWs uploaded during review have no
--    project_update_id and are left alone.

drop policy if exists pdocs_insert_engineering_monitoring_pow on public.project_documents;
drop policy if exists pdocs_insert_engineering_progress_report on public.project_documents;
create policy pdocs_insert_engineering_progress_report on public.project_documents
  for insert to authenticated
  with check (
    public.app_current_role() in ('engineering', 'admin')
    and uploaded_by = auth.uid()
    and document_category = 'PROGRESS_REPORT'
    and exists (
      select 1 from public.projects p
      join public.profiles me on me.id = auth.uid()
      where p.id = project_id
        and p.status in ('FOR_IMPLEMENTATION', 'ONGOING')
        and (public.app_is_admin() or p.office_id = me.office_id)
    )
  );

update public.project_documents
   set document_category = 'PROGRESS_REPORT'
 where document_category = 'PROGRAM_OF_WORKS'
   and project_update_id is not null;
