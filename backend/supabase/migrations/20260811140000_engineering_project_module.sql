-- Engineering project creation module.
--
-- The submit-to-MPDC path (project_submissions insert -> auto status change
-- -> audit log -> status history) was already fully wired by the RLS
-- hardening migration (submissions_insert_engineering / apply_project_submission
-- / trg_projects_log_status / trg_audit_submission). This migration adds
-- what was still missing to support the Engineering-side module:
--
--   1. project_code format requested by the product spec (PRJ-YYYY-0001,
--      4-digit sequence) — the original trigger padded to 5 digits.
--   2. A storage bucket + policies for initial project documents, which
--      didn't exist yet at all.
--   3. A completeness guard so an incomplete DRAFT can't be submitted for
--      review even via a direct API call, not just a client-side check.

-- =========================================================================
-- 1. project_code: PRJ-2026-0001 (4-digit sequence, not 5).
-- =========================================================================
create or replace function public.generate_project_code()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.project_code is null then
    new.project_code := 'PRJ-' || to_char(now(), 'YYYY') || '-' ||
      lpad(nextval('public.project_code_seq')::text, 4, '0');
  end if;
  return new;
end;
$$;

-- =========================================================================
-- 2. Storage bucket for initial project documents. Private bucket — read
--    access is staff-only, matching project_documents table RLS. Upload is
--    scoped to Engineering/admin at the bucket level; the app additionally
--    records uploaded_by / project_id in project_documents itself.
-- =========================================================================
insert into storage.buckets (id, name, public)
values ('project-documents', 'project-documents', false)
on conflict (id) do nothing;

create policy "project_documents_storage_select_staff" on storage.objects
  for select to authenticated
  using (bucket_id = 'project-documents' and public.app_is_staff());

create policy "project_documents_storage_insert_engineering" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'project-documents' and public.app_current_role() in ('engineering', 'admin'));

create policy "project_documents_storage_delete_admin" on storage.objects
  for delete to authenticated
  using (bucket_id = 'project-documents' and public.app_is_admin());

-- =========================================================================
-- 3. A project missing its required fields cannot be submitted for review,
--    even by a direct insert into project_submissions bypassing the client
--    form. Mirrors the fields the Engineering project form marks required.
-- =========================================================================
create or replace function public.guard_project_submission_completeness()
returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_project record;
begin
  select title, description, project_category, barangay, location_text,
         estimated_cost, start_date_planned, end_date_planned, office_id
  into v_project
  from public.projects
  where id = new.project_id;

  if v_project.title is null or btrim(v_project.title) = ''
    or v_project.description is null or btrim(v_project.description) = ''
    or v_project.project_category is null or btrim(v_project.project_category) = ''
    or v_project.barangay is null or btrim(v_project.barangay) = ''
    or v_project.location_text is null or btrim(v_project.location_text) = ''
    or v_project.estimated_cost is null
    or v_project.start_date_planned is null
    or v_project.end_date_planned is null
    or v_project.office_id is null
  then
    raise exception 'Project is missing required fields (name, description, category, barangay, location, estimated budget, schedule, or implementing office) and cannot be submitted for review.';
  end if;

  return new;
end;
$$;

create trigger trg_submissions_guard_completeness
before insert on public.project_submissions
for each row execute function public.guard_project_submission_completeness();
