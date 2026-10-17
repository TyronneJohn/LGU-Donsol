-- Before / After image processing (panel revision, defense of 2026-10-04).
--
-- 1. A BEFORE photo of the site must be on file before Engineering can submit
--    the first monitoring update — the baseline every later photo is judged
--    against. Taken from the "Before & After" section of the Engineering
--    monitoring page (BeforeAfterSection.jsx), not from an update.
-- 2. Once the project is finished, Engineering captures the finished site
--    with the in-app camera. Each capture is saved immediately as an AFTER
--    photo — including after the 100% update has already moved the project to
--    COMPLETED, which the old insert policy blocked (so photos attached to a
--    100% update were silently rejected).
-- 3. "Generate" compares one BEFORE photo with one AFTER photo and stores the
--    match accuracy here. The accuracy is computed by image processing in the
--    browser (OpenCV ORB keypoints + RANSAC homography, beforeAfterMatching.js);
--    the compare-before-after Edge Function validates it, adds Gemini's
--    written explanation, and is the only writer (service role).

-- ---------------------------------------------------------------------------
-- 1 + 2. Image insert policy: monitoring statuses as before, plus AFTER
-- photos of a COMPLETED project.
-- ---------------------------------------------------------------------------
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
        join public.profiles me on me.id = auth.uid()
        where p.id = project_id
          and p.office_id = me.office_id
          and (
            p.status in ('FOR_IMPLEMENTATION', 'ONGOING')
            or (p.status = 'COMPLETED' and image_stage = 'AFTER')
          )
      )
    )
  );

create or replace function public.require_before_photo()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if not exists (
    select 1 from public.project_images
    where project_id = new.project_id and image_stage = 'BEFORE'
  ) then
    raise exception 'Upload a BEFORE photo of the site first (Before & After section) before submitting a monitoring update.'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_require_before_photo on public.project_updates;
create trigger trg_require_before_photo
before insert on public.project_updates
for each row execute function public.require_before_photo();

-- ---------------------------------------------------------------------------
-- 3. Saved comparisons. Append-only: every Generate adds a row, the page
-- shows the newest. No client insert/update/delete policies.
-- ---------------------------------------------------------------------------
create table if not exists public.project_before_after_comparisons (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  before_image_id uuid not null references public.project_images(id) on delete cascade,
  after_image_id uuid not null references public.project_images(id) on delete cascade,
  accuracy numeric(5,2) not null check (accuracy between 0 and 100),
  method text not null default 'ORB_RANSAC',
  metrics jsonb not null,
  ai_analysis_status public.ai_analysis_status not null default 'PENDING',
  ai_analysis_result jsonb,
  generated_by uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now()
);

create index if not exists idx_before_after_project
  on public.project_before_after_comparisons(project_id, created_at desc);

comment on table public.project_before_after_comparisons is
  'Before vs After match accuracy (image processing) plus an advisory AI explanation. Written only by the compare-before-after Edge Function. Advisory only — never an automatic finding of fault against a contractor or office.';

alter table public.project_before_after_comparisons enable row level security;

drop policy if exists before_after_select_staff on public.project_before_after_comparisons;
create policy before_after_select_staff on public.project_before_after_comparisons
  for select to authenticated using (public.app_is_staff());
