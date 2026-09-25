-- BAC Procurement module.
--
-- The initial schema already carries the core procurement data model
-- (procurement, procurement_documents, contractors, contractor_accomplishments)
-- with full RLS and audit triggers, and 20260811120000_rls_policy_hardening.sql
-- already wires "opening a procurement cycle moves the project to
-- FOR_PROCUREMENT" (apply_procurement_start). This migration fills the
-- remaining gaps found on inspection:
--
--   1. There was no table to record *multiple competing bidders* on a
--      procurement cycle — `procurement` only ever carries the single
--      eventual `contractor_id`. procurement_bidders adds that.
--   2. `procurement_documents.storage_path` had nowhere to actually point:
--      no storage bucket existed for procurement/bid documents.
--   3. Nothing ever advanced a project past FOR_PROCUREMENT — FOR_IMPLEMENTATION
--      was dead status. Signing the contract is the concrete handoff point.
--   4. Procurement lifecycle events (opened, awarded) never notified anyone,
--      unlike the equivalent submission/approval/monitoring flows.
--   5. Engineering's monitoring-eligible statuses included APPROVED and
--      FOR_PROCUREMENT only as a documented placeholder ("BAC Procurement...
--      doesn't exist yet") in 20260812100000_engineering_site_monitoring.sql.
--      Now that BAC properly drives FOR_IMPLEMENTATION, that placeholder is
--      narrowed to FOR_IMPLEMENTATION/ONGOING.

-- =========================================================================
-- 1. PROCUREMENT_BIDDERS — competing bids within one procurement cycle.
-- =========================================================================

create type public.bid_status as enum ('SUBMITTED', 'QUALIFIED', 'DISQUALIFIED', 'WITHDRAWN');

create table public.procurement_bidders (
  id uuid primary key default gen_random_uuid(),
  procurement_id uuid not null references public.procurement(id) on delete cascade,
  contractor_id uuid not null references public.contractors(id) on delete restrict,
  bid_amount numeric(14,2) check (bid_amount >= 0),
  bid_status public.bid_status not null default 'SUBMITTED',
  evaluation_notes text,
  submitted_at timestamptz not null default now(),
  evaluated_by uuid references public.profiles(id) on delete set null,
  evaluated_at timestamptz,
  created_by uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (procurement_id, contractor_id)
);

create index idx_bidders_procurement on public.procurement_bidders(procurement_id);
create index idx_bidders_contractor on public.procurement_bidders(contractor_id);

create trigger trg_bidders_updated_at
before update on public.procurement_bidders
for each row execute function public.set_updated_at();

-- procurement_id is immutable once set, matching the prevent_project_id_change
-- pattern already used for project_updates / project_images.
create or replace function public.prevent_procurement_id_change()
returns trigger
language plpgsql as $$
begin
  if new.procurement_id is distinct from old.procurement_id then
    raise exception 'procurement_id cannot be changed after creation.';
  end if;
  return new;
end;
$$;

create trigger trg_bidders_lock_procurement
before update on public.procurement_bidders
for each row execute function public.prevent_procurement_id_change();

alter table public.procurement_bidders enable row level security;

create policy bidders_select_staff on public.procurement_bidders
  for select to authenticated using (public.app_is_staff());

-- A bidder can only be recorded against the *current* cycle of a procurement
-- — matches how procurement_insert_bac scopes writes to live workflow state.
create policy bidders_insert_bac on public.procurement_bidders
  for insert to authenticated
  with check (
    public.app_current_role() in ('bac', 'admin')
    and created_by = auth.uid()
    and exists (
      select 1 from public.procurement pr
      where pr.id = procurement_id and pr.is_current
    )
  );

create policy bidders_update_bac on public.procurement_bidders
  for update to authenticated using (public.app_current_role() in ('bac', 'admin'));

create policy bidders_delete_admin on public.procurement_bidders
  for delete to authenticated using (public.app_is_admin());

create trigger trg_audit_bidder
after insert on public.procurement_bidders
for each row execute function public.audit_generic_insert('procurement_bidder', 'BIDDER_RECORDED');

create or replace function public.audit_bidder_status_change()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.bid_status is distinct from old.bid_status then
    perform public.write_audit_log(
      'BID_EVALUATION_RECORDED', 'procurement_bidder', new.id,
      'Bid status set to ' || new.bid_status,
      jsonb_build_object(
        'procurement_id', new.procurement_id,
        'contractor_id', new.contractor_id,
        'old_status', old.bid_status
      )
    );
  end if;
  return new;
end;
$$;

create trigger trg_audit_bidder_status
after update of bid_status on public.procurement_bidders
for each row execute function public.audit_bidder_status_change();

-- =========================================================================
-- 2. Storage bucket for procurement/bid documents. Private, same shape as
--    the project-documents / project-images buckets.
-- =========================================================================
insert into storage.buckets (id, name, public)
values ('procurement-documents', 'procurement-documents', false)
on conflict (id) do nothing;

create policy "procurement_documents_storage_select_staff" on storage.objects
  for select to authenticated
  using (bucket_id = 'procurement-documents' and public.app_is_staff());

create policy "procurement_documents_storage_insert_bac" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'procurement-documents' and public.app_current_role() in ('bac', 'admin'));

create policy "procurement_documents_storage_delete_admin" on storage.objects
  for delete to authenticated
  using (bucket_id = 'procurement-documents' and public.app_is_admin());

-- =========================================================================
-- 3. Procurement -> Implementation handoff. Signing the contract is the
--    concrete point a contractor is bound and Engineering can take over;
--    COMPLETED afterwards is BAC's own paperwork closeout and does not
--    re-touch project status. Runs from inside the procurement UPDATE
--    trigger, so the projects UPDATE below passes guard_project_status_change
--    the same way apply_procurement_start / apply_monitoring_progress do
--    (pg_trigger_depth() > 1).
-- =========================================================================
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

      insert into public.notifications (recipient_id, category, title, message, related_project_id)
      select p.id, 'PROCUREMENT_UPDATE',
        'Ready for implementation: ' || v_project_title,
        'BAC has signed the contract. Engineering may now begin site monitoring.',
        new.project_id
      from public.profiles p
      where (p.id = v_project_owner or p.role = 'admin') and p.is_active;
    end if;
  end if;

  return new;
end;
$$;

create trigger trg_apply_procurement_completion
after insert or update of status on public.procurement
for each row execute function public.apply_procurement_completion();

-- =========================================================================
-- 4. Procurement lifecycle notifications — "opened" and "award recorded",
--    matching the density apply_monitoring_progress already uses.
-- =========================================================================
create or replace function public.notify_procurement_opened()
returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_project_title text;
  v_project_owner uuid;
begin
  select title, created_by into v_project_title, v_project_owner
  from public.projects where id = new.project_id;

  insert into public.notifications (recipient_id, category, title, message, related_project_id)
  select p.id, 'PROCUREMENT_UPDATE',
    'Procurement opened: ' || v_project_title,
    'BAC has opened a procurement cycle for this project.',
    new.project_id
  from public.profiles p
  where (p.id = v_project_owner or p.role = 'admin') and p.is_active;

  return new;
end;
$$;

create trigger trg_notify_procurement_opened
after insert on public.procurement
for each row execute function public.notify_procurement_opened();

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

    insert into public.notifications (recipient_id, category, title, message, related_project_id)
    select p.id, 'PROCUREMENT_UPDATE',
      'Award recorded: ' || v_project_title,
      'BAC recorded an award to ' || coalesce(v_contractor_name, 'a contractor') || '.',
      new.project_id
    from public.profiles p
    where p.role in ('mpdc', 'admin') and p.is_active;
  end if;

  return new;
end;
$$;

create trigger trg_notify_procurement_award
after insert or update of contractor_id on public.procurement
for each row execute function public.notify_procurement_award();

-- =========================================================================
-- 5. Narrow Engineering's monitoring-eligible statuses now that BAC exists
--    and properly drives FOR_IMPLEMENTATION. Previously APPROVED and
--    FOR_PROCUREMENT were included as a documented forward-compatible
--    placeholder; that placeholder is retired in favor of the real handoff.
--    Any project already sitting in APPROVED/FOR_PROCUREMENT simply waits
--    for BAC to carry it to FOR_IMPLEMENTATION before Engineering can log
--    monitoring against it — it is not left stranded, since BAC can open
--    procurement on it at any time via the existing procurement_insert_bac
--    policy (APPROVED or FOR_PROCUREMENT).
-- =========================================================================
drop policy if exists updates_insert_engineering on public.project_updates;
create policy updates_insert_engineering on public.project_updates
  for insert to authenticated
  with check (
    public.app_current_role() in ('engineering', 'admin')
    and reported_by = auth.uid()
    and (
      public.app_is_admin()
      or exists (
        select 1 from public.projects p
        where p.id = project_id
          and p.created_by = auth.uid()
          and p.status in ('FOR_IMPLEMENTATION', 'ONGOING')
      )
    )
  );

drop policy if exists images_insert_engineering on public.project_images;
create policy images_insert_engineering on public.project_images
  for insert to authenticated
  with check (
    public.app_current_role() in ('engineering', 'admin')
    and uploaded_by = auth.uid()
    and (
      public.app_is_admin()
      or exists (
        select 1 from public.projects p
        where p.id = project_id
          and p.created_by = auth.uid()
          and p.status in ('FOR_IMPLEMENTATION', 'ONGOING')
      )
    )
  );

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

    insert into public.notifications (recipient_id, category, title, message, related_project_id)
    select p.id, 'MONITORING_ALERT',
      'Project implementation started: ' || v_project_title,
      'Engineering has begun reporting site monitoring updates.',
      new.project_id
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

    insert into public.notifications (recipient_id, category, title, message, related_project_id)
    select p.id, 'MONITORING_ALERT',
      'Project completed: ' || v_project_title,
      'Engineering has reported 100% progress.',
      new.project_id
    from public.profiles p
    where p.role in ('mpdc', 'admin') and p.is_active;
  end if;

  return new;
end;
$$;
