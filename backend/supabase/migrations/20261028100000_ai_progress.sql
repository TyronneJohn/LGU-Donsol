-- AI Progress (Phase 1): the progress of a monitoring update comes from the
-- Before & After comparison, not from a number Engineering types.
--
-- 1. compare-before-after asks Gemini, per Program of Works item, how far the
--    work visible in the AFTER photo has gone, and computes
--      ai_progress = Σ(item % × POW weight) ÷ Σ(weight)
--    itself (weights = each item's share of the direct cost). Progress never
--    goes down: an item keeps the % it had in the previous submitted
--    comparison when the AI sees less (or can't see it), and the total is
--    never below the latest update's progress. The breakdown is stored in
--    ai_analysis_result.progress. Null when there is no AI Progress (Gemini
--    failed, or the project has no detailed POW).
-- 2. Submitting a monitoring update takes progress_percentage from the newest
--    draft comparison — whatever the client sent. No AI Progress, no update:
--    Generate again.

alter table public.project_before_after_comparisons
  add column if not exists ai_progress numeric(5,2) check (ai_progress between 0 and 100);

comment on column public.project_before_after_comparisons.ai_progress is
  'AI Progress: POW-weighted completion computed by compare-before-after from Gemini''s per-item judgments. Becomes the progress_percentage of the monitoring update it is submitted with (require_draft_comparison).';

create or replace function public.require_draft_comparison()
returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_comparison record;
  v_previous numeric(5,2);
begin
  if public.app_is_admin_or_system() then
    return new;
  end if;

  -- The newest draft comparison of a draft AFTER photo: re-generating an
  -- old, already-submitted photo doesn't count as this update's site visit.
  select c.id, c.ai_progress into v_comparison
  from public.project_before_after_comparisons c
  join public.project_images i on i.id = c.after_image_id
  where c.project_id = new.project_id
    and c.released_at is null
    and i.released_at is null
  order by c.created_at desc
  limit 1;

  if not found then
    raise exception 'Take an AFTER photo and Generate the Before & After comparison before submitting the monitoring update.'
      using errcode = 'check_violation';
  end if;
  if v_comparison.ai_progress is null then
    raise exception 'The latest comparison has no AI Progress. Press Generate again before submitting the monitoring update.'
      using errcode = 'check_violation';
  end if;

  select u.progress_percentage into v_previous
  from public.project_updates u
  where u.project_id = new.project_id and u.progress_percentage is not null
  order by u.report_date desc, u.created_at desc
  limit 1;

  -- Not editable: the update's progress is the AI Progress (never below
  -- the latest update's).
  new.progress_percentage := greatest(v_comparison.ai_progress, coalesce(v_previous, 0));
  return new;
end;
$$;
