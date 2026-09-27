-- Security review fixes (HIGH + MEDIUM findings).
--
--   1. Engineering could edit every column of a project under review.
--      20260818100000 rewrote guard_project_field_updates() from the
--      20260812120000 copy, which predates the Engineering branch added in
--      20260812140000 — so the branch silently disappeared, while
--      projects_update_scoped still grants Engineering UPDATE during
--      SUBMITTED_FOR_REVIEW. Result: Engineering could publish an unapproved
--      project, rewrite its cost/schedule, or take over created_by.
--   2. write_audit_log() was executable by anon and authenticated with no
--      caller check, so anyone holding the public anon key could insert
--      forged audit entries.
--   3. Any staff member could insert a notification for anyone, with any
--      category and any sender_id — i.e. impersonate another office.
--   4. Engineering could silently rewrite its own past monitoring updates
--      and swap the file behind an already-analyzed site photo.
--   5. A future report_date made the DSS read "days since last update" as
--      negative, so the project could never be flagged stale or critical.
--   6. procurement / procurement_bidders had no field fencing: BAC could
--      jump straight to CONTRACT_SIGNED, move a procurement onto another
--      project, or change amounts and bids with no audit trail.
--
-- Every function that legitimately calls write_audit_log() or inserts
-- notifications is SECURITY DEFINER owned by postgres, so it keeps working
-- after the grants and policies below — they only constrain direct client
-- (PostgREST) access.

-- =========================================================================
-- 0. Helper: which of the given keys differ between two row images.
--    Returns null when nothing in the list changed, so callers can skip
--    writing an empty audit entry.
-- =========================================================================
create or replace function public.jsonb_changed_fields(p_old jsonb, p_new jsonb, p_keys text[])
returns jsonb
language sql immutable set search_path = '' as $$
  select jsonb_object_agg(k, jsonb_build_object('old', p_old -> k, 'new', p_new -> k))
  from unnest(p_keys) as k
  where (p_old -> k) is distinct from (p_new -> k);
$$;

revoke execute on function public.jsonb_changed_fields(jsonb, jsonb, text[]) from public, anon, authenticated;

-- =========================================================================
-- 1. Restore the Engineering branch of the project field fence.
--    Body is 20260903100000's definition (DSS + auto-publish bypasses,
--    MPDC branches) plus the Engineering branch from 20260812140000,
--    extended with the dss_* and sector columns added since.
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
        or new.sector is distinct from old.sector
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

  if public.app_current_role() = 'engineering' then
    if new.title is distinct from old.title
      or new.description is distinct from old.description
      or new.project_category is distinct from old.project_category
      or new.sector is distinct from old.sector
      or new.barangay is distinct from old.barangay
      or new.location_text is distinct from old.location_text
      or new.latitude is distinct from old.latitude
      or new.longitude is distinct from old.longitude
      or new.estimated_cost is distinct from old.estimated_cost
      or new.start_date_planned is distinct from old.start_date_planned
      or new.end_date_planned is distinct from old.end_date_planned
      or new.start_date_actual is distinct from old.start_date_actual
      or new.end_date_actual is distinct from old.end_date_actual
      or new.office_id is distinct from old.office_id
      or new.created_by is distinct from old.created_by
      or new.visibility is distinct from old.visibility
      or new.published_at is distinct from old.published_at
      or new.published_by is distinct from old.published_by
      or new.dss_decision is distinct from old.dss_decision
      or new.dss_severity is distinct from old.dss_severity
      or new.dss_evaluated_at is distinct from old.dss_evaluated_at
    then
      raise exception 'Engineering may only update approved_budget and funding_source while a project is under review.';
    end if;
  end if;

  return new;
end;
$$;

-- =========================================================================
-- 2. write_audit_log() is internal-only. Clients lose EXECUTE; the
--    SECURITY DEFINER triggers/functions that call it run as the owner and
--    are unaffected. Messaging.jsx was the one direct RPC caller — message
--    sends are now audited by a trigger instead, so the browser no longer
--    decides what goes into the audit trail.
-- =========================================================================
revoke execute on function public.write_audit_log(text, text, uuid, text, jsonb) from public, anon, authenticated;

create or replace function public.audit_message_sent()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform public.write_audit_log(
    'MESSAGE_SENT', 'message', new.id,
    'Message sent to ' || case new.recipient_role::text
      when 'admin' then 'Administrator'
      when 'mpdc' then 'MPDC'
      when 'engineering' then 'Engineering Office'
      when 'bac' then 'BAC'
      else coalesce(new.recipient_role::text, 'recipient')
    end,
    jsonb_build_object(
      'recipient_role', new.recipient_role,
      'project_id', new.project_id,
      'attachment_name', new.attachment_name
    )
  );
  return new;
end;
$$;

create trigger trg_audit_message_sent
after insert on public.messages
for each row execute function public.audit_message_sent();

-- =========================================================================
-- 3. Client-inserted notifications must carry the caller as sender, use
--    only the categories the frontend actually sends, and may only point
--    at a message the caller sent. Trigger-generated notifications
--    (MONITORING_ALERT, PROCUREMENT_UPDATE, ...) are inserted by SECURITY
--    DEFINER functions and are not subject to this policy.
-- =========================================================================
drop policy if exists notifications_insert_staff on public.notifications;
create policy notifications_insert_staff on public.notifications
  for insert to authenticated
  with check (
    public.app_is_staff()
    and sender_id = auth.uid()
    and category in (
      'NEW_MESSAGE', 'PROJECT_SUBMITTED', 'PROJECT_RETURNED',
      'PROJECT_REJECTED', 'PROJECT_REVIEW_READY'
    )
    and (
      related_message_id is null
      or exists (
        select 1 from public.messages m
        where m.id = related_message_id and m.sender_id = auth.uid()
      )
    )
  );

-- =========================================================================
-- 4. Monitoring evidence is append-only for Engineering. A mistake is
--    corrected by filing a new update, not by rewriting an old one; only an
--    admin may edit or delete, and every such edit/delete is audited with
--    old and new values. The AI Edge Functions write through the service
--    role and bypass RLS, so photo analysis is unaffected.
-- =========================================================================
drop policy if exists updates_modify_own_or_admin on public.project_updates;
create policy updates_update_admin on public.project_updates
  for update to authenticated using (public.app_is_admin()) with check (public.app_is_admin());

drop policy if exists images_modify_own_or_admin on public.project_images;
create policy images_update_admin on public.project_images
  for update to authenticated using (public.app_is_admin()) with check (public.app_is_admin());

create or replace function public.audit_project_update_change()
returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_changes jsonb;
begin
  if TG_OP = 'DELETE' then
    perform public.write_audit_log(
      'PROJECT_UPDATE_DELETED', 'project_update', old.id,
      'Monitoring update deleted', to_jsonb(old)
    );
    return old;
  end if;

  v_changes := public.jsonb_changed_fields(to_jsonb(old), to_jsonb(new), array[
    'progress_percentage', 'narrative_report', 'issues_encountered',
    'weather_condition', 'latitude', 'longitude', 'report_date'
  ]);
  if v_changes is not null then
    perform public.write_audit_log(
      'PROJECT_UPDATE_EDITED', 'project_update', new.id,
      'Monitoring update edited',
      jsonb_build_object('project_id', new.project_id, 'changes', v_changes)
    );
  end if;
  return new;
end;
$$;

create trigger trg_audit_project_update_change
after update or delete on public.project_updates
for each row execute function public.audit_project_update_change();

-- Only evidence fields are audited — the AI columns are rewritten by the
-- analysis service on every run and are already fenced by
-- guard_project_image_updates().
create or replace function public.audit_project_image_change()
returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_changes jsonb;
begin
  if TG_OP = 'DELETE' then
    perform public.write_audit_log(
      'IMAGE_DELETED', 'project_image', old.id,
      'Site photo deleted',
      jsonb_build_object('project_id', old.project_id, 'storage_path', old.storage_path, 'file_name', old.file_name)
    );
    return old;
  end if;

  v_changes := public.jsonb_changed_fields(to_jsonb(old), to_jsonb(new), array[
    'storage_path', 'file_name', 'image_stage', 'captured_at',
    'latitude', 'longitude', 'project_update_id'
  ]);
  if v_changes is not null then
    perform public.write_audit_log(
      'IMAGE_EDITED', 'project_image', new.id,
      'Site photo record edited',
      jsonb_build_object('project_id', new.project_id, 'changes', v_changes)
    );
  end if;
  return new;
end;
$$;

create trigger trg_audit_project_image_change
after update or delete on public.project_images
for each row execute function public.audit_project_image_change();

-- =========================================================================
-- 5. No future-dated monitoring reports. Compared against the Philippine
--    calendar date, not the server's UTC date, or a report filed before
--    8 AM Manila time would be rejected as "tomorrow". Late (backdated)
--    entries are still allowed.
-- =========================================================================
create or replace function public.guard_report_date_not_future()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.report_date > (now() at time zone 'Asia/Manila')::date then
    raise exception 'Report date cannot be in the future.';
  end if;
  return new;
end;
$$;

create trigger trg_updates_report_date_not_future
before insert or update of report_date on public.project_updates
for each row execute function public.guard_report_date_not_future();

-- =========================================================================
-- 6a. Procurement workflow fence.
--     - project_id / created_by are fixed at creation (for everyone).
--     - A new cycle starts at NOT_STARTED with no contractor.
--     - Status only moves forward. Skipping BIDDING / BID_EVALUATION stays
--       allowed because the BAC screen records an award straight from
--       NOT_STARTED.
--     - AWARDED needs a contractor; CONTRACT_SIGNED also needs a signing
--       date; COMPLETED only follows CONTRACT_SIGNED.
--     - The contractor is locked once the contract is signed.
--     Admin keeps an override for corrections (everything except the ids).
-- =========================================================================
create or replace function public.guard_procurement_changes()
returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_order constant text[] := array[
    'NOT_STARTED', 'BIDDING', 'BID_EVALUATION', 'AWARDED', 'CONTRACT_SIGNED', 'COMPLETED'
  ];
begin
  if TG_OP = 'UPDATE' and (
    new.project_id is distinct from old.project_id
    or new.created_by is distinct from old.created_by
  ) then
    raise exception 'project_id and created_by cannot be changed on a procurement record.';
  end if;

  if public.app_is_admin_or_system() then
    return new;
  end if;

  if TG_OP = 'INSERT' then
    if new.status <> 'NOT_STARTED' or new.contractor_id is not null then
      raise exception 'A new procurement cycle must start at NOT_STARTED with no contractor.';
    end if;
    return new;
  end if;

  if new.status is distinct from old.status then
    if array_position(v_order, new.status::text) < array_position(v_order, old.status::text) then
      raise exception 'Procurement status cannot move backwards (% -> %).', old.status, new.status;
    end if;

    if new.status in ('AWARDED', 'CONTRACT_SIGNED', 'COMPLETED') and new.contractor_id is null then
      raise exception 'A contractor must be awarded before the procurement can move to %.', new.status;
    end if;

    if new.status in ('CONTRACT_SIGNED', 'COMPLETED') and new.contract_signed_date is null then
      raise exception 'A contract signing date is required before the procurement can move to %.', new.status;
    end if;

    if new.status = 'COMPLETED' and old.status <> 'CONTRACT_SIGNED' then
      raise exception 'Procurement can only be completed after the contract is signed.';
    end if;
  end if;

  if old.status in ('CONTRACT_SIGNED', 'COMPLETED')
    and new.contractor_id is distinct from old.contractor_id
  then
    raise exception 'The awarded contractor cannot be changed after the contract is signed.';
  end if;

  return new;
end;
$$;

create trigger trg_procurement_guard_changes
before insert or update on public.procurement
for each row execute function public.guard_procurement_changes();

-- Status and contractor changes were already audited
-- (audit_procurement_status_change, notify_procurement_award); this covers
-- the amounts, dates and contract details that weren't.
create or replace function public.audit_procurement_field_edit()
returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_changes jsonb;
begin
  v_changes := public.jsonb_changed_fields(to_jsonb(old), to_jsonb(new), array[
    'mode_of_procurement', 'abc_amount', 'bid_opening_date', 'contract_number',
    'contract_amount', 'contract_signed_date', 'notice_to_proceed_date',
    'contract_duration_days', 'expected_completion_date', 'is_current'
  ]);
  if v_changes is not null then
    perform public.write_audit_log(
      'PROCUREMENT_FIELD_UPDATED', 'procurement', new.id,
      'Procurement details updated',
      jsonb_build_object('project_id', new.project_id, 'changes', v_changes)
    );
  end if;
  return new;
end;
$$;

create trigger trg_audit_procurement_field_edit
after update on public.procurement
for each row execute function public.audit_procurement_field_edit();

-- =========================================================================
-- 6b. Bidders: the bidding contractor and record author are fixed, and a
--     bid amount is frozen once the bid has been evaluated. Every change to
--     amount/notes is audited (bid_status already is).
-- =========================================================================
create or replace function public.guard_bidder_changes()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.contractor_id is distinct from old.contractor_id
    or new.created_by is distinct from old.created_by
  then
    raise exception 'contractor_id and created_by cannot be changed on a bid record.';
  end if;

  if not public.app_is_admin_or_system()
    and old.bid_status <> 'SUBMITTED'
    and new.bid_amount is distinct from old.bid_amount
  then
    raise exception 'A bid amount cannot be changed after the bid has been evaluated.';
  end if;

  return new;
end;
$$;

create trigger trg_bidders_guard_changes
before update on public.procurement_bidders
for each row execute function public.guard_bidder_changes();

create or replace function public.audit_bidder_field_edit()
returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_changes jsonb;
begin
  v_changes := public.jsonb_changed_fields(to_jsonb(old), to_jsonb(new), array[
    'bid_amount', 'evaluation_notes'
  ]);
  if v_changes is not null then
    perform public.write_audit_log(
      'BID_UPDATED', 'procurement_bidder', new.id,
      'Bid record updated',
      jsonb_build_object('procurement_id', new.procurement_id, 'changes', v_changes)
    );
  end if;
  return new;
end;
$$;

create trigger trg_audit_bidder_field_edit
after update on public.procurement_bidders
for each row execute function public.audit_bidder_field_edit();
