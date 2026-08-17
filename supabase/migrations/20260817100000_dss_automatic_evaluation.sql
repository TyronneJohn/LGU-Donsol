-- LGU Donsol Project Monitoring System — DSS automatic decision engine
--
-- Turns the DSS from a display-only flag calculator into a decision engine:
-- given the same project + monitoring data the client already reads, this
-- computes ONE deterministic decision (condition + severity + reason +
-- required/recommended action + responsible office), and — only when that
-- decision differs from what was last recorded for the project — records it
-- via the EXISTING write_audit_log() (no new table; audit_logs already
-- fits every field a DSS decision needs: entity_id=project, action=
-- 'DSS_DECISION_RECORDED', description=reason, metadata=decision/severity/
-- action/inputs, created_at=evaluated_at) and notifies the responsible
-- office(s) via the EXISTING notifications table using the already-seeded
-- MONITORING_ALERT category — no schema change to either table, no new
-- table, no enum change.
--
-- Mirrors src/utils/decisionSupport.js's evaluateProjectDss() rule-for-rule;
-- the two must be kept in sync by inspection since they intentionally serve
-- different purposes: this copy is what actually fires the notification/
-- audit trail, invoked by triggers whenever the underlying data changes; the
-- JS copy is what renders instantly on page load, including the one case no
-- trigger can ever catch — a project doing nothing while the calendar alone
-- crosses its planned end date (closed by a client-side fallback RPC call to
-- this same function on page load).
--
-- Never performs a legally/administratively irreversible action itself
-- (reject, cancel procurement, terminate a contract, change project_status)
-- — it only ever records a decision and requests monitoring, escalation, or
-- verification. Those stay inside their existing authorized workflows.

-- =========================================================================
-- 1. The decision engine itself.
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

  select p.id, p.title, p.status, p.start_date_planned, p.end_date_planned, p.office_id
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
  if v_project.status not in ('FOR_IMPLEMENTATION', 'ONGOING', 'COMPLETED') then
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

  -- Idempotency: only act if the decision actually changed since the last
  -- time this project was evaluated. Prevents a duplicate audit entry/
  -- notification every time a dashboard refresh or repeated fallback call
  -- re-evaluates a project whose condition hasn't changed.
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
-- 2. Triggers: evaluate whenever the data DSS depends on changes.
-- =========================================================================

-- Trigger name is alphabetically AFTER trg_apply_monitoring_progress
-- (20260812100000_engineering_site_monitoring.sql) so it fires second on
-- the same project_updates INSERT event and sees the post-status-flip
-- project row (e.g. ONGOING -> COMPLETED already applied), not a stale one.
create or replace function public.trg_evaluate_dss_on_update_fn()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform public.evaluate_project_dss(new.project_id);
  return new;
end;
$$;

create trigger trg_evaluate_dss_on_project_update
after insert on public.project_updates
for each row execute function public.trg_evaluate_dss_on_update_fn();

create or replace function public.trg_evaluate_dss_on_project_change_fn()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform public.evaluate_project_dss(new.id);
  return new;
end;
$$;

create trigger trg_evaluate_dss_on_project_change
after update of status, end_date_planned, start_date_planned on public.projects
for each row execute function public.trg_evaluate_dss_on_project_change_fn();

-- =========================================================================
-- 3. Page-load fallback grant. This is the one case no INSERT/UPDATE
--    trigger can ever catch — a project sitting still while the calendar
--    alone crosses its planned end date, with nobody writing a new row.
--    The client calls evaluate_project_dss() directly from the monitoring
--    detail pages as a low-cost catch-up check; the app_is_staff() guard at
--    the top of the function keeps this to authenticated staff only, and
--    the idempotency check above means repeated calls are always safe.
-- =========================================================================
grant execute on function public.evaluate_project_dss(uuid) to authenticated;
