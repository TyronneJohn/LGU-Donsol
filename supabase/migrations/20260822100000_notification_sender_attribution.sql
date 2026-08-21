-- Attribute workflow-triggered notifications (PROCUREMENT_UPDATE,
-- MONITORING_ALERT) to the staff member/office whose action produced them,
-- by populating the already-existing `notifications.sender_id` column
-- (added in 20260816100000_messaging_system.sql for NEW_MESSAGE, but left
-- null everywhere else). The frontend already joins
-- sender:profiles!notifications_sender_id_fkey(full_name, role) to render
-- this, so no new column and no query changes are needed — only these
-- trigger functions need to start setting it.
--
-- DSS automatic-evaluation alerts (evaluate_project_dss, in
-- 20260817100000/20260818100000) are intentionally left with sender_id
-- null: they're system-generated, not the action of a specific office, so
-- attributing them to whichever staff member happened to trigger the
-- recalculation would be misleading. The frontend shows these as "System".

create or replace function public.apply_project_endorsement()
returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_project_title text;
begin
  update public.projects
  set status = 'APPROVED'
  where id = new.project_id
    and status = 'SUBMITTED_FOR_REVIEW'
  returning title into v_project_title;

  if v_project_title is not null then
    perform public.write_audit_log(
      'PROJECT_ENDORSED_TO_BAC', 'project', new.project_id,
      'MPDC endorsed project to BAC for procurement',
      jsonb_build_object('endorsement_id', new.id)
    );

    insert into public.notifications (recipient_id, category, title, message, related_project_id, sender_id)
    select p.id, 'PROCUREMENT_UPDATE',
      'Project ready for procurement: ' || v_project_title,
      coalesce(new.notes, 'MPDC has endorsed this project for procurement.'),
      new.project_id,
      auth.uid()
    from public.profiles p
    where p.role in ('bac', 'admin') and p.is_active;
  end if;

  return new;
end;
$$;

create or replace function public.apply_procurement_completion()
returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_project_title text;
  v_project_owner uuid;
begin
  if new.status = 'CONTRACT_SIGNED' and (TG_OP = 'INSERT' or old.status is distinct from new.status) then
    update public.projects
    set status = 'FOR_IMPLEMENTATION'
    where id = new.project_id
      and status = 'FOR_PROCUREMENT'
    returning title, created_by into v_project_title, v_project_owner;

    if v_project_title is not null then
      perform public.write_audit_log(
        'PROJECT_READY_FOR_IMPLEMENTATION', 'project', new.project_id,
        'Contract signed; project moved to FOR_IMPLEMENTATION',
        jsonb_build_object('procurement_id', new.id)
      );

      insert into public.notifications (recipient_id, category, title, message, related_project_id, sender_id)
      select p.id, 'PROCUREMENT_UPDATE',
        'Ready for implementation: ' || v_project_title,
        'BAC has signed the contract. Engineering may now begin site monitoring.',
        new.project_id,
        auth.uid()
      from public.profiles p
      where (p.id = v_project_owner or p.role = 'admin') and p.is_active;
    end if;
  end if;

  return new;
end;
$$;

create or replace function public.notify_procurement_opened()
returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_project_title text;
  v_project_owner uuid;
begin
  select title, created_by into v_project_title, v_project_owner
  from public.projects where id = new.project_id;

  insert into public.notifications (recipient_id, category, title, message, related_project_id, sender_id)
  select p.id, 'PROCUREMENT_UPDATE',
    'Procurement opened: ' || v_project_title,
    'BAC has opened a procurement cycle for this project.',
    new.project_id,
    auth.uid()
  from public.profiles p
  where (p.id = v_project_owner or p.role = 'admin') and p.is_active;

  return new;
end;
$$;

create or replace function public.notify_procurement_award()
returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_project_title text;
  v_contractor_name text;
begin
  if new.contractor_id is not null and (TG_OP = 'INSERT' or old.contractor_id is distinct from new.contractor_id) then
    select title into v_project_title from public.projects where id = new.project_id;
    select name into v_contractor_name from public.contractors where id = new.contractor_id;

    perform public.write_audit_log(
      'PROCUREMENT_AWARDED', 'procurement', new.id,
      'Contract awarded to ' || coalesce(v_contractor_name, 'contractor'),
      jsonb_build_object('project_id', new.project_id, 'contractor_id', new.contractor_id)
    );

    insert into public.notifications (recipient_id, category, title, message, related_project_id, sender_id)
    select p.id, 'PROCUREMENT_UPDATE',
      'Award recorded: ' || v_project_title,
      'BAC recorded an award to ' || coalesce(v_contractor_name, 'a contractor') || '.',
      new.project_id,
      auth.uid()
    from public.profiles p
    where p.role in ('mpdc', 'admin') and p.is_active;
  end if;

  return new;
end;
$$;

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
    update public.projects
    set status = 'ONGOING',
        start_date_actual = coalesce(start_date_actual, new.report_date)
    where id = new.project_id;

    v_status := 'ONGOING';

    perform public.write_audit_log(
      'PROJECT_MONITORING_STARTED', 'project', new.project_id,
      'First monitoring update recorded; project moved to ONGOING',
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
    update public.projects
    set status = 'COMPLETED',
        end_date_actual = new.report_date
    where id = new.project_id
      and status = 'ONGOING';

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
