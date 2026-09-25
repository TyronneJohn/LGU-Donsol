-- LGU Donsol Project Monitoring System — persist the current DSS decision
--
-- The DSS engine (20260817100000_dss_automatic_evaluation.sql) already
-- determines a decision and fires a notification/audit entry on change, but
-- the decision itself only ever lived in a transient audit_logs row and the
-- notification text — nothing on `projects` reflected it, so every list,
-- dashboard, and map page that shows a project had no way to display the
-- current decision without either opening that one project's detail page or
-- re-fetching project_updates and recomputing client-side. This migration
-- caches the current decision directly on `projects` so every existing
-- staff-facing read of that table sees it for free.
--
-- Purely additive to the table (3 new nullable columns, 2 new enum types,
-- 1 new index) plus two CREATE OR REPLACE function bodies (same functions,
-- same signatures, from 20260817100000 and 20260812120000/20260811120000
-- respectively) — no table is dropped, no already-applied migration file is
-- edited, no RLS policy changes, no change to project_status or any
-- workflow table. The DSS still never sets projects.status to anything —
-- ON_HOLD, APPROVED, REJECTED, or otherwise — that remains exclusively the
-- job of the existing submission/approval/procurement/monitoring-progress
-- workflow triggers, entirely untouched by this file.

-- =========================================================================
-- 1. Typed vocabulary for the persisted decision, matching this schema's
--    existing convention (project_status, notification_category, etc. are
--    all enums, not free text).
-- =========================================================================

create type public.dss_decision_code as enum (
  'ON_TRACK', 'MONITORING_REQUIRED', 'BEHIND_SCHEDULE', 'OVERDUE',
  'CRITICAL_DELAY', 'COMPLETION_READY', 'COMPLETED'
);

create type public.dss_severity_level as enum ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');

-- =========================================================================
-- 2. The cache columns themselves. Null for every project the DSS has
--    never evaluated (pre-implementation-stage projects) — matching
--    evaluate_project_dss()'s existing "do nothing" behavior for those.
-- =========================================================================

alter table public.projects
  add column dss_decision public.dss_decision_code,
  add column dss_severity public.dss_severity_level,
  add column dss_evaluated_at timestamptz;

create index idx_projects_dss_decision on public.projects(dss_decision) where dss_decision is not null;

-- =========================================================================
-- 3. evaluate_project_dss(): same decision rules as before, now also
--    writes the result onto `projects` on every evaluation (not just ones
--    that produce a new notification — that idempotency check below is
--    unchanged and still governs only the audit_logs/notifications writes).
--
--    The two internal `update projects` statements below are wrapped with
--    a transaction-local session flag (app.dss_internal_write) that
--    guard_project_field_updates() (see part 4) recognizes and lets
--    through unconditionally. This is necessary — and was verified by
--    tracing the trigger cascade before writing this — because these are
--    genuine trigger-fired UPDATEs on `projects` that run under whatever
--    role actually caused the cascade (e.g. an Engineering user submitting
--    a monitoring update, or an MPDC/Admin user editing project dates),
--    not under an admin-equivalent context. Without this flag, the very
--    guard trigger this migration also extends (to stop a client from
--    directly forging dss_decision) would just as easily block the DSS
--    engine's own legitimate write to the same columns, and — because that
--    guard raises an exception — silently abort the entire enclosing
--    statement, including whatever legitimate change (a monitoring update,
--    a status change) triggered the DSS evaluation in the first place.
--    A plain admin_or_system check does not solve this: the calling
--    session is genuinely Engineering/MPDC, not admin, in the common case.
--    The flag is set immediately before each internal write and cleared
--    immediately after, so it never applies to any other statement.
-- =========================================================================

create or replace function public.evaluate_project_dss(p_project_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_project record;
  v_latest record;
  v_today date := current_date;
  v_actual_progress numeric;
  v_days_since_update int;
  v_total_days int;
  v_elapsed_days int;
  v_expected_progress numeric;
  v_days_past_deadline int;
  v_is_overdue boolean;
  v_variance numeric;
  v_is_behind boolean;
  v_is_stale boolean;
  v_reasons text[];

  v_decision text;
  v_label text;
  v_severity text;
  v_reason text;
  v_action text;
  v_office text;
  v_notify text[];
  v_inputs jsonb;

  v_last_decision text;
begin
  if not public.app_is_staff() then
    raise exception 'Only authenticated staff may request a DSS evaluation.';
  end if;

  select p.id, p.title, p.status, p.start_date_planned, p.end_date_planned, p.office_id,
         p.dss_decision, p.dss_severity, p.dss_evaluated_at
  into v_project
  from public.projects p
  where p.id = p_project_id;

  if not found then
    return;
  end if;

  -- Same status gate as the JS copy: only implementation-stage projects get
  -- a schedule-based decision, plus COMPLETED as its own terminal case.
  -- Every other status (DRAFT..FOR_PROCUREMENT) is left alone entirely — no
  -- decision recorded, nothing notified — so a project awaiting approval or
  -- procurement never gets a false OVERDUE just because its planned end
  -- date happens to have already passed before implementation even started.
  -- Any previously-cached decision is cleared here too, so a project that
  -- regresses backward (e.g. an admin correction back to APPROVED) never
  -- keeps showing a stale decision on a list page.
  if v_project.status not in ('FOR_IMPLEMENTATION', 'ONGOING', 'COMPLETED') then
    if v_project.dss_decision is not null or v_project.dss_severity is not null or v_project.dss_evaluated_at is not null then
      perform set_config('app.dss_internal_write', 'true', true);
      update public.projects
      set dss_decision = null, dss_severity = null, dss_evaluated_at = null
      where id = p_project_id;
      perform set_config('app.dss_internal_write', 'false', true);
    end if;
    return;
  end if;

  select u.progress_percentage, u.report_date
  into v_latest
  from public.project_updates u
  where u.project_id = p_project_id
  order by u.report_date desc, u.created_at desc
  limit 1;

  if v_project.status = 'COMPLETED' then
    v_decision := 'COMPLETED';
    v_label := 'Completed';
    v_severity := 'LOW';
    v_reason := 'Project implementation has been marked complete.';
    v_action := 'No further monitoring action required.';
    v_office := 'Engineering';
    -- Deliberately empty: apply_monitoring_progress() (see
    -- 20260812100000_engineering_site_monitoring.sql) already sends a
    -- "Project completed" MONITORING_ALERT the moment status flips to
    -- COMPLETED. Notifying again here would duplicate that alert.
    v_notify := '{}';
    v_inputs := '{}'::jsonb;
  else
    v_actual_progress := coalesce(v_latest.progress_percentage, 0);
    v_days_since_update := case when v_latest.report_date is not null then (v_today - v_latest.report_date) else null end;

    -- Expected progress: linear interpolation across the planned schedule,
    -- clamped so a project not yet started or already past its end date
    -- never produces a negative or >100% expected value. Stays null (not 0)
    -- when either planned date is missing.
    v_expected_progress := null;
    if v_project.start_date_planned is not null and v_project.end_date_planned is not null then
      v_total_days := v_project.end_date_planned - v_project.start_date_planned;
      if v_total_days > 0 then
        v_elapsed_days := least(greatest(v_today - v_project.start_date_planned, 0), v_total_days);
        v_expected_progress := (v_elapsed_days::numeric / v_total_days) * 100;
      end if;
    end if;

    v_days_past_deadline := case when v_project.end_date_planned is not null then (v_today - v_project.end_date_planned) else null end;
    v_is_overdue := v_days_past_deadline is not null and v_days_past_deadline > 0 and v_actual_progress < 100;
    v_variance := case when v_expected_progress is not null then v_expected_progress - v_actual_progress else null end;
    -- 15pt / 14-day thresholds below are the EXISTING SCHEDULE_VARIANCE_PCT
    -- and STALE_AFTER_DAYS from src/utils/decisionSupport.js, reused as-is.
    -- The "critical" thresholds (30 / 30 / 30) are exactly double those —
    -- documented here, not arbitrary — so CRITICAL_DELAY reads as "twice as
    -- bad as what would already have been flagged."
    v_is_behind := v_variance is not null and v_variance > 15;
    v_is_stale := v_days_since_update is not null and v_days_since_update > 14;

    v_inputs := jsonb_build_object(
      'actual_progress', v_actual_progress,
      'expected_progress', v_expected_progress,
      'variance', v_variance,
      'days_past_deadline', v_days_past_deadline,
      'days_since_last_update', v_days_since_update,
      'planned_end_date', v_project.end_date_planned
    );

    -- 1. COMPLETION_READY takes precedence over everything else — 100%
    --    reported progress is a positive signal even on an overdue project.
    if v_actual_progress >= 100 and v_project.status = 'ONGOING' then
      v_decision := 'COMPLETION_READY';
      v_label := 'Completion Ready';
      v_severity := 'MEDIUM';
      v_reason := format('Latest monitoring update reports 100%% physical progress as of %s.', v_latest.report_date);
      v_action := 'Perform completion verification and update the project record to Completed once confirmed.';
      v_office := 'Engineering & MPDC';
      v_notify := array['engineering', 'mpdc'];

    -- 2. OVERDUE, escalating to CRITICAL_DELAY when it's badly overdue,
    --    badly behind on progress, or monitoring has also gone stale for a
    --    long time — any one of those three on top of already being
    --    overdue is "critical" rather than routine.
    elsif v_is_overdue and (
      v_days_past_deadline >= 30
      or (v_variance is not null and v_variance >= 30)
      or (v_days_since_update is not null and v_days_since_update >= 30)
    ) then
      v_reasons := '{}';
      if v_days_past_deadline >= 30 then
        v_reasons := array_append(v_reasons, format('%s days past the planned completion date', v_days_past_deadline));
      end if;
      if v_variance is not null and v_variance >= 30 then
        v_reasons := array_append(v_reasons, format('progress is %s points behind the expected schedule', round(v_variance)));
      end if;
      if v_days_since_update is not null and v_days_since_update >= 30 then
        v_reasons := array_append(v_reasons, format('no monitoring update in %s days', v_days_since_update));
      end if;

      v_decision := 'CRITICAL_DELAY';
      v_label := 'Critical Delay';
      v_severity := 'CRITICAL';
      v_reason := format(
        'Project is significantly behind expected progress and has exceeded its planned completion date (%s).',
        array_to_string(v_reasons, '; ')
      );
      v_action := 'Immediate Engineering assessment required. Escalate to MPDC and Admin for corrective action planning.';
      v_office := 'Engineering, MPDC & Admin';
      v_notify := array['engineering', 'mpdc', 'admin'];

    elsif v_is_overdue then
      v_decision := 'OVERDUE';
      v_label := 'Overdue';
      v_severity := 'HIGH';
      v_reason := format(
        'The planned completion date (%s) has passed while progress remains at %s%%.',
        v_project.end_date_planned, v_actual_progress
      );
      v_action := 'Require immediate Engineering monitoring and a corrective action/completion schedule assessment.';
      v_office := 'Engineering & MPDC';
      v_notify := array['engineering', 'mpdc'];

    -- 3. Not yet overdue, but tracking behind the expected schedule.
    elsif v_is_behind then
      v_decision := 'BEHIND_SCHEDULE';
      v_label := 'Behind Schedule';
      v_severity := case when v_variance >= 22.5 then 'HIGH' else 'MEDIUM' end;
      v_reason := format(
        'Actual progress (%s%%) is %s percentage points below the expected progress (%s%%) for this point in the schedule.',
        v_actual_progress, round(v_variance), round(v_expected_progress)
      );
      v_action := 'Increase monitoring frequency and report the cause of the delay.';
      v_office := 'Engineering';
      v_notify := array['engineering'];

    -- 4. On schedule, but nobody has reported in a while.
    elsif v_is_stale then
      v_decision := 'MONITORING_REQUIRED';
      v_label := 'Monitoring Required';
      v_severity := 'MEDIUM';
      v_reason := format('No monitoring update has been submitted in %s days (threshold: 14 days).', v_days_since_update);
      v_action := 'Engineering site monitoring update required.';
      v_office := 'Engineering';
      v_notify := array['engineering'];

    -- 5. None of the above — the explicit "healthy" state, not silence.
    else
      v_decision := 'ON_TRACK';
      v_label := 'On Track';
      v_severity := 'LOW';
      v_reason := 'Progress is within the expected range for the current schedule, and monitoring is current.';
      v_action := 'Continue implementation and routine monitoring.';
      v_office := 'Engineering';
      v_notify := '{}'; -- routine/healthy — nothing to notify
    end if;
  end if;

  -- Persist the freshly computed decision on the project itself, always —
  -- independent of whether it changed. This is what list/dashboard pages
  -- read; it must never lag behind what this function just determined.
  perform set_config('app.dss_internal_write', 'true', true);
  update public.projects
  set dss_decision = v_decision::public.dss_decision_code,
      dss_severity = v_severity::public.dss_severity_level,
      dss_evaluated_at = now()
  where id = p_project_id;
  perform set_config('app.dss_internal_write', 'false', true);

  -- Idempotency: only notify/audit if the decision actually changed since
  -- the last time this project was evaluated. Prevents a duplicate audit
  -- entry/notification every time a dashboard refresh or repeated fallback
  -- call re-evaluates a project whose condition hasn't changed. Unchanged
  -- from the original DSS migration — still keyed off audit_logs, not the
  -- projects cache columns just written above, so this behavior is
  -- identical to before this migration.
  select a.metadata->>'decision'
  into v_last_decision
  from public.audit_logs a
  where a.entity_type = 'project'
    and a.entity_id = p_project_id
    and a.action = 'DSS_DECISION_RECORDED'
  order by a.created_at desc
  limit 1;

  if v_last_decision is not distinct from v_decision then
    return;
  end if;

  perform public.write_audit_log(
    'DSS_DECISION_RECORDED',
    'project',
    p_project_id,
    v_reason,
    v_inputs || jsonb_build_object(
      'decision', v_decision,
      'label', v_label,
      'severity', v_severity,
      'action', v_action,
      'responsible_office', v_office,
      'notify', v_notify
    )
  );

  if array_length(v_notify, 1) > 0 then
    insert into public.notifications (recipient_id, category, title, message, related_project_id)
    select p.id, 'MONITORING_ALERT',
      format('[%s] %s: %s', v_severity, v_label, v_project.title),
      v_reason,
      p_project_id
    from public.profiles p
    where p.is_active
      and (
        (p.role = 'engineering' and p.office_id = v_project.office_id and 'engineering' = any(v_notify))
        or (p.role = 'mpdc' and 'mpdc' = any(v_notify))
        or (p.role = 'admin' and 'admin' = any(v_notify))
      );
  end if;
end;
$$;

-- =========================================================================
-- 4. guard_project_field_updates(): unchanged for every existing column and
--    role branch (verbatim from 20260812120000_mpdc_project_ownership.sql)
--    except for two additions: (a) a new bypass at the top for the
--    transaction-local flag evaluate_project_dss() sets around its own
--    internal writes (part 3), so the DSS engine's legitimate write to
--    these three columns is never mistaken for — and blocked as — a
--    client trying to edit them directly; (b) the three new columns added
--    to both MPDC branches' forbidden-field lists, so a direct
--    supabase.from('projects').update({ dss_decision: 'ON_TRACK' }) call
--    from MPDC's own already-RLS-permitted draft/publish-window edit is
--    rejected — the same "system-only column" protection already applied
--    to project_images.ai_analysis_status/ai_analysis_result.
-- =========================================================================

create or replace function public.guard_project_field_updates()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if coalesce(current_setting('app.dss_internal_write', true), '') = 'true' then
    return new;
  end if;

  if public.app_is_admin_or_system() then
    return new;
  end if;

  if public.app_current_role() = 'mpdc' then
    if old.status = 'APPROVED' then
      if new.title is distinct from old.title
        or new.description is distinct from old.description
        or new.project_category is distinct from old.project_category
        or new.barangay is distinct from old.barangay
        or new.location_text is distinct from old.location_text
        or new.latitude is distinct from old.latitude
        or new.longitude is distinct from old.longitude
        or new.estimated_cost is distinct from old.estimated_cost
        or new.approved_budget is distinct from old.approved_budget
        or new.funding_source is distinct from old.funding_source
        or new.start_date_planned is distinct from old.start_date_planned
        or new.end_date_planned is distinct from old.end_date_planned
        or new.start_date_actual is distinct from old.start_date_actual
        or new.end_date_actual is distinct from old.end_date_actual
        or new.office_id is distinct from old.office_id
        or new.created_by is distinct from old.created_by
        or new.dss_decision is distinct from old.dss_decision
        or new.dss_severity is distinct from old.dss_severity
        or new.dss_evaluated_at is distinct from old.dss_evaluated_at
      then
        raise exception 'MPDC may only update publication fields (visibility, published_at, published_by) on an approved project.';
      end if;
    else
      if new.visibility is distinct from old.visibility
        or new.published_at is distinct from old.published_at
        or new.published_by is distinct from old.published_by
        or new.created_by is distinct from old.created_by
        or new.office_id is distinct from old.office_id
        or new.dss_decision is distinct from old.dss_decision
        or new.dss_severity is distinct from old.dss_severity
        or new.dss_evaluated_at is distinct from old.dss_evaluated_at
      then
        raise exception 'MPDC cannot change publication or ownership fields on a project.';
      end if;
    end if;
  end if;

  return new;
end;
$$;
