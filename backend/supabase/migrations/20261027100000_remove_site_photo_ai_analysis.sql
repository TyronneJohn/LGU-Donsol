-- Removes the per-photo AI analysis of site monitoring photos
-- (20260827110000_ai_photo_analysis.sql). Its edge function, analyze-site-photo,
-- was no longer called by the app and its output was never shown, so the
-- function is deleted and its columns are dropped here. The Before & After
-- comparison (compare-before-after) is unaffected.
--
-- guard_project_image_updates() goes back to its original fields
-- (20260811120000_rls_policy_hardening.sql) first, so it no longer references
-- the dropped columns.
create or replace function public.guard_project_image_updates()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if public.app_is_admin_or_system() then
    return new;
  end if;

  if new.ai_analysis_status is distinct from old.ai_analysis_status
    or new.ai_analysis_result is distinct from old.ai_analysis_result
    or new.uploaded_by is distinct from old.uploaded_by
  then
    raise exception 'ai_analysis_* and uploaded_by can only be changed by an administrator or the analysis service.';
  end if;

  return new;
end;
$$;

alter table public.project_images
  drop column if exists ai_stage_observation,
  drop column if exists ai_anomaly_detected,
  drop column if exists ai_anomaly_notes,
  drop column if exists ai_reviewed_at;
