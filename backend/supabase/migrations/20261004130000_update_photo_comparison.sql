-- One AI analysis per monitoring update instead of one per photo.
--
-- analyze-project-update (Edge Function) sends every photo of an update,
-- plus a selection of photos from all earlier updates of the same project,
-- to Gemini in a single call and stores one combined result here: what the
-- new photos show, and how they compare with the earlier ones (same site?
-- visible changes? consistent with the reported progress?).
--
-- Written only by the Edge Function through the service role, which bypasses
-- RLS; clients cannot update project_updates (updates_update_admin,
-- 20260928100000_security_fixes.sql). Not exposed publicly:
-- get_public_project_transparency() spells out its own field list.
--
-- project_images.ai_analysis_* stays as-is for photos analyzed one by one
-- before this change; new photos are inserted as NOT_APPLICABLE.

alter table public.project_updates
  add column if not exists ai_analysis_status public.ai_analysis_status not null default 'NOT_APPLICABLE',
  add column if not exists ai_analysis_result jsonb;

comment on column public.project_updates.ai_analysis_result is
  'AI-assisted comparison of this update''s photos against earlier updates'' photos (analyze-project-update). Advisory only — must never be presented as an automatic finding of fault against a contractor or office.';
