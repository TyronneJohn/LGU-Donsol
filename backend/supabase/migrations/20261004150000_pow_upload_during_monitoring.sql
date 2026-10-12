-- Every monitoring update carries its Program of Works (required by the
-- Engineering update form).
-- pdocs_insert_engineering (20260812140000) only opens during the review
-- window (SUBMITTED_FOR_REVIEW); this adds a second, narrower insert policy
-- for the monitoring window — same statuses as updates_insert_engineering
-- (FOR_IMPLEMENTATION / ONGOING), own office, PROGRAM_OF_WORKS only. The
-- storage policy "project_documents_storage_insert_engineering" is not
-- status-scoped, so the bucket upload itself already works.

create policy pdocs_insert_engineering_monitoring_pow on public.project_documents
  for insert to authenticated
  with check (
    public.app_current_role() in ('engineering', 'admin')
    and uploaded_by = auth.uid()
    and document_category = 'PROGRAM_OF_WORKS'
    and exists (
      select 1 from public.projects p
      join public.profiles me on me.id = auth.uid()
      where p.id = project_id
        and p.status in ('FOR_IMPLEMENTATION', 'ONGOING')
        and (public.app_is_admin() or p.office_id = me.office_id)
    )
  );
