-- Adds a fixed-choice "Category" (sector) field back to projects, separate
-- from project_category (now labeled "Programs/Project/Activities" in the
-- UI, free text). This mirrors the A/B/C sector grouping (Social
-- Development, Economic Development, Environmental Management) used in
-- MPDC's physical/financial accomplishment report format.

create type public.project_sector as enum (
  'SOCIAL_DEVELOPMENT',
  'ECONOMIC_DEVELOPMENT',
  'ENVIRONMENTAL_MANAGEMENT'
);

alter table public.projects
  add column sector public.project_sector;

-- Mirrors REQUIRED_FIELD_LABELS in apps/staff/src/pages/mpdc/ProjectForm.jsx:
-- enforced at Submit for Review, same point as every other required field.
create or replace function public.guard_project_submission_completeness()
returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_project record;
begin
  select title, description, project_category, sector, barangay, location_text,
         estimated_cost, start_date_planned, end_date_planned, office_id
  into v_project
  from public.projects
  where id = new.project_id;

  if v_project.title is null or btrim(v_project.title) = ''
    or v_project.description is null or btrim(v_project.description) = ''
    or v_project.project_category is null or btrim(v_project.project_category) = ''
    or v_project.sector is null
    or v_project.barangay is null or btrim(v_project.barangay) = ''
    or v_project.location_text is null or btrim(v_project.location_text) = ''
    or v_project.estimated_cost is null
    or v_project.start_date_planned is null
    or v_project.end_date_planned is null
    or v_project.office_id is null
  then
    raise exception 'Project is missing required fields (name, description, programs/project/activities, category, barangay, location, estimated budget, schedule, or implementing office) and cannot be submitted for review.';
  end if;

  return new;
end;
$$;
