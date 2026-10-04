-- Links a Program of Works to the monitoring update it was submitted with,
-- so Monitoring History (Engineering and MPDC) can show each update's own
-- POW instead of matching them up by date. Null for POWs uploaded during
-- project review (ProjectReviewDetail.jsx), which belong to no update.
-- `on delete set null`: deleting an update keeps the document on file as a
-- project-level POW rather than silently dropping it.

alter table public.project_documents
  add column project_update_id uuid references public.project_updates(id) on delete set null;

create index idx_pdocs_project_update on public.project_documents(project_update_id);
