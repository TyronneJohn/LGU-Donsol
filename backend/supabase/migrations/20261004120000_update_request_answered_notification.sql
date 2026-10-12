-- MPDC's "Request Update" (MpdcProjectMonitoringDetail.jsx) notifies
-- Engineering, but nothing told MPDC when Engineering actually answered it —
-- MPDC had to keep re-opening the project to check. This notifies every
-- active MPDC user when a monitoring update is submitted while an MPDC
-- request is still open (sent after the project's previous update), i.e.
-- the same "pending request" rule Engineering's pages use
-- (frontend/apps/staff/src/utils/updateRequests.js).
--
-- Done as a trigger rather than from the client because the client
-- notification insert policy (20260928100000_security_fixes.sql) only
-- allows message/review categories; MONITORING_ALERT is trigger-generated,
-- and the NotificationBell routes it to MPDC's monitoring detail page.
create or replace function public.notify_update_request_answered()
returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_request_at timestamptz;
  v_previous_update_at timestamptz;
  v_project_title text;
  v_days_pending integer;
begin
  select m.created_at into v_request_at
  from public.messages m
  where m.project_id = new.project_id
    and m.sender_role = 'mpdc'
    and m.recipient_role = 'engineering'
    and m.body like 'Requesting a progress update for %'
  order by m.created_at desc
  limit 1;

  if v_request_at is null then
    return new;
  end if;

  select max(u.created_at) into v_previous_update_at
  from public.project_updates u
  where u.project_id = new.project_id
    and u.id <> new.id;

  if v_previous_update_at is not null and v_previous_update_at >= v_request_at then
    return new;
  end if;

  select title into v_project_title from public.projects where id = new.project_id;
  if v_project_title is null then
    return new;
  end if;

  v_days_pending := floor(extract(epoch from (new.created_at - v_request_at)) / 86400);

  insert into public.notifications (recipient_id, category, title, message, related_project_id, sender_id)
  select p.id, 'MONITORING_ALERT',
    'Update submitted: ' || v_project_title,
    'Engineering submitted the progress update you requested'
      || coalesce(' (' || trim_scale(new.progress_percentage)::text || '% as of '
        || to_char(new.report_date, 'Mon DD, YYYY') || ')', '')
      || case
           when v_days_pending >= 1 then ', ' || v_days_pending || ' day(s) after the request.'
           else '.'
         end,
    new.project_id,
    auth.uid()
  from public.profiles p
  where p.role = 'mpdc' and p.is_active;

  return new;
end;
$$;

create trigger trg_notify_update_request_answered
after insert on public.project_updates
for each row execute function public.notify_update_request_answered();
