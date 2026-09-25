-- Admin-only Delete Project feature.
--
-- projects_delete_admin (20260811120000_rls_policy_hardening.sql) already
-- gates the top-level DELETE on public.projects to admins. What's missing:
-- four tables that reference projects.id with ON DELETE CASCADE have RLS
-- enabled but no DELETE policy at all (project_submissions,
-- project_approvals, project_status_history, project_endorsements) — RLS
-- defaults to deny with zero matching policies, so the FK-triggered cascade
-- delete on these tables would be blocked even for an admin, and the whole
-- project deletion would roll back. Every other cascade-affected table
-- (project_updates, project_images, project_documents, procurement,
-- procurement_documents, procurement_bidders, contractor_accomplishments)
-- already has an admin delete policy from earlier migrations;
-- notifications/messages use ON DELETE SET NULL, already covered by their
-- existing admin-inclusive UPDATE policies. This migration closes the
-- remaining four gaps, matching the exact pattern already established in
-- 20260811120000_rls_policy_hardening.sql section 8.

create policy submissions_delete_admin on public.project_submissions
  for delete to authenticated using (public.app_is_admin());

create policy approvals_delete_admin on public.project_approvals
  for delete to authenticated using (public.app_is_admin());

create policy status_history_delete_admin on public.project_status_history
  for delete to authenticated using (public.app_is_admin());

create policy endorsements_delete_admin on public.project_endorsements
  for delete to authenticated using (public.app_is_admin());

-- =========================================================================
-- Preserve auditability: audit_logs has no FK to projects (entity_id is a
-- generic uuid, entity_type a free-text tag), so existing audit history
-- referencing this project survives deletion untouched. This adds one more
-- entry recording the deletion itself, reusing write_audit_log() — not a
-- new audit system. Captured BEFORE DELETE since old.* has no row to read
-- from once the row is actually gone.
-- =========================================================================
create or replace function public.audit_project_deletion()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform public.write_audit_log(
    'PROJECT_DELETED', 'project', old.id,
    'Project deleted by administrator: ' || old.project_code || ' — ' || old.title,
    jsonb_build_object(
      'project_code', old.project_code, 'title', old.title, 'status', old.status,
      'office_id', old.office_id, 'created_by', old.created_by
    )
  );
  return old;
end;
$$;

create trigger trg_projects_audit_deletion
before delete on public.projects
for each row execute function public.audit_project_deletion();
