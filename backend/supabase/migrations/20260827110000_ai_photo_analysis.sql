-- AI photo analysis for Engineering's site monitoring photos — a supporting/
-- advisory signal only, never a replacement for the Engineer's own reported
-- progress_percentage. A single photo carries no information about a
-- project's full scope of work or Bill of Quantities, so an AI reading it
-- cannot responsibly state a percentage of completion — it can only offer a
-- qualitative read of what construction stage/activity is visible, and flag
-- anything that looks like it needs a second look (visible defects, safety
-- hazards, work that looks incomplete/substandard). See
-- supabase/functions/analyze-site-photo, which populates these columns
-- after each upload; the existing ai_analysis_result/ai_analysis_status
-- columns are left untouched — despite the name, they hold real (non-AI)
-- client-side image metadata (see imageProcessing.js), not this.
alter table public.project_images
  add column ai_stage_observation text,
  add column ai_anomaly_detected boolean not null default false,
  add column ai_anomaly_notes text,
  add column ai_reviewed_at timestamptz;

-- Extends the existing guard_project_image_updates() (rls_policy_hardening.sql)
-- rather than adding a second trigger — same table, same "these fields are
-- system/admin-only" concern, already using app_is_admin_or_system() which
-- exempts the service role the edge function runs as. Everything above the
-- new `or` clause is unchanged.
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
    or new.ai_stage_observation is distinct from old.ai_stage_observation
    or new.ai_anomaly_detected is distinct from old.ai_anomaly_detected
    or new.ai_anomaly_notes is distinct from old.ai_anomaly_notes
    or new.ai_reviewed_at is distinct from old.ai_reviewed_at
  then
    raise exception 'ai_analysis_*, ai_stage_observation, ai_anomaly_*, ai_reviewed_at, and uploaded_by can only be changed by an administrator or the analysis service.';
  end if;

  return new;
end;
$$;
