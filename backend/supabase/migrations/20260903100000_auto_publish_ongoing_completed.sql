-- Auto-publish a project the moment it reaches ONGOING, so MPDC no longer
-- has to remember to hit "Publish" while the project is still APPROVED.
--
-- Bug this fixes: MPDC's publish toggle is only reachable while
-- status = 'APPROVED' (projects_update_scoped / guard_project_field_updates,
-- 20260812140000_engineering_edit_and_endorsement.sql and later). Once a
-- project moves past APPROVED (FOR_PROCUREMENT -> FOR_IMPLEMENTATION ->
-- ONGOING -> COMPLETED) without ever being published, visibility is stuck
-- PRIVATE forever — there is no UI path (not even Admin, whose project
-- detail page is read-only) to publish it after the fact. That's why a
-- COMPLETED project can exist today and never show up on the public site.
--
-- Fix: apply_monitoring_progress() (20260812100000_engineering_site_monitoring.sql,
-- last redefined in 20260822100000_notification_sender_attribution.sql) is
-- the SECURITY DEFINER trigger that already auto-drives status ->
-- ONGOING / COMPLETED off Engineering's monitoring updates. It now also
-- flips visibility to PUBLIC in the same UPDATE, using a transaction-local
-- flag (app.auto_publish_internal) the same way evaluate_project_dss()
-- already uses app.dss_internal_write to let its own internal writes past
-- guard_project_field_updates() without being mistaken for a client edit.
-- published_at is only set if not already set, so a project MPDC published
-- earlier (while APPROVED) keeps its original publish timestamp.
--
-- No manual publish window is widened — MPDC still cannot toggle visibility
-- during FOR_PROCUREMENT/FOR_IMPLEMENTATION, matching what was asked for.

-- =========================================================================
-- 1. guard_project_field_updates(): recognize the auto-publish flag, same
--    pattern as the existing app.dss_internal_write bypass immediately
--    above it. Everything else verbatim from 20260818100000_dss_persist_decision.sql.
-- =========================================================================
create or replace function public.guard_project_field_updates()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if coalesce(current_setting('app.dss_internal_write', true), '') = 'true' then
    return new;
  end if;

  if coalesce(current_setting('app.auto_publish_internal', true), '') = 'true' then
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

-- =========================================================================
-- 2. apply_monitoring_progress(): both status transitions now also publish
--    the project. Status-history logging, notifications, and every other
--    behavior are unchanged.
-- =========================================================================
create or replace function public.apply_monitoring_progress()
returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_status public.project_status;
  v_project_title text;
begin
  select status, title into v_status, v_project_title
  from public.projects
  where id = new.project_id
  for update;

  if v_status = 'FOR_IMPLEMENTATION' then
    perform set_config('app.auto_publish_internal', 'true', true);
    update public.projects
    set status = 'ONGOING',
        start_date_actual = coalesce(start_date_actual, new.report_date),
        visibility = 'PUBLIC',
        published_at = coalesce(published_at, now())
    where id = new.project_id;
    perform set_config('app.auto_publish_internal', 'false', true);

    v_status := 'ONGOING';

    perform public.write_audit_log(
      'PROJECT_MONITORING_STARTED', 'project', new.project_id,
      'First monitoring update recorded; project moved to ONGOING and published to the public site',
      jsonb_build_object('project_update_id', new.id)
    );

    insert into public.notifications (recipient_id, category, title, message, related_project_id, sender_id)
    select p.id, 'MONITORING_ALERT',
      'Project implementation started: ' || v_project_title,
      'Engineering has begun reporting site monitoring updates.',
      new.project_id,
      auth.uid()
    from public.profiles p
    where p.role in ('mpdc', 'admin') and p.is_active;
  end if;

  if v_status = 'ONGOING' and new.progress_percentage = 100 then
    perform set_config('app.auto_publish_internal', 'true', true);
    update public.projects
    set status = 'COMPLETED',
        end_date_actual = new.report_date,
        visibility = 'PUBLIC',
        published_at = coalesce(published_at, now())
    where id = new.project_id
      and status = 'ONGOING';
    perform set_config('app.auto_publish_internal', 'false', true);

    perform public.write_audit_log(
      'PROJECT_MONITORING_COMPLETED', 'project', new.project_id,
      'Monitoring update reported 100% progress; project moved to COMPLETED',
      jsonb_build_object('project_update_id', new.id)
    );

    insert into public.notifications (recipient_id, category, title, message, related_project_id, sender_id)
    select p.id, 'MONITORING_ALERT',
      'Project completed: ' || v_project_title,
      'Engineering has reported 100% progress.',
      new.project_id,
      auth.uid()
    from public.profiles p
    where p.role in ('mpdc', 'admin') and p.is_active;
  end if;

  return new;
end;
$$;

-- =========================================================================
-- 3. One-time backfill: any project that already reached ONGOING/COMPLETED
--    under the old trigger (before this migration existed) never got
--    published. Bring it in line with the new rule instead of leaving it
--    stuck PRIVATE forever.
-- =========================================================================
update public.projects
set visibility = 'PUBLIC',
    published_at = coalesce(published_at, now())
where status in ('ONGOING', 'COMPLETED')
  and visibility <> 'PUBLIC';
