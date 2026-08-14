-- LGU Donsol Project Monitoring System — initial schema
-- Covers the full project lifecycle: Engineering creation -> MPDC review ->
-- BAC procurement -> Engineering implementation monitoring -> public publishing.
-- No real LGU Donsol data is inserted by this migration.

create extension if not exists pgcrypto;

-- =========================================================================
-- ENUM TYPES
-- =========================================================================

create type public.app_role as enum ('admin', 'mpdc', 'engineering', 'bac');

create type public.project_status as enum (
  'DRAFT',
  'SUBMITTED_FOR_REVIEW',
  'RETURNED_FOR_REVISION',
  'REJECTED',
  'APPROVED',
  'FOR_PROCUREMENT',
  'FOR_IMPLEMENTATION',
  'ONGOING',
  'COMPLETED',
  'ON_HOLD',
  'CANCELLED'
);

create type public.approval_decision as enum (
  'APPROVED',
  'RETURNED_FOR_REVISION',
  'REJECTED'
);

create type public.procurement_status as enum (
  'NOT_STARTED',
  'BIDDING',
  'BID_EVALUATION',
  'AWARDED',
  'CONTRACT_SIGNED',
  'COMPLETED'
);

create type public.visibility_status as enum ('PRIVATE', 'PUBLIC');

create type public.image_stage as enum ('BEFORE', 'DURING', 'AFTER', 'ISSUE', 'OTHER');

create type public.ai_analysis_status as enum ('PENDING', 'PROCESSED', 'FAILED', 'NOT_APPLICABLE');

create type public.doc_category as enum ('PROGRAM_OF_WORKS', 'PERMIT', 'DESIGN_PLAN', 'OTHER');

create type public.procurement_doc_category as enum (
  'INVITATION_TO_BID',
  'BID_BULLETIN',
  'ABSTRACT_OF_BIDS',
  'NOTICE_OF_AWARD',
  'CONTRACT',
  'NOTICE_TO_PROCEED',
  'PERFORMANCE_BOND',
  'OTHER'
);

create type public.notification_category as enum (
  'PROJECT_SUBMITTED',
  'PROJECT_APPROVED',
  'PROJECT_RETURNED',
  'PROJECT_REJECTED',
  'PROCUREMENT_UPDATE',
  'NEW_MESSAGE',
  'MONITORING_ALERT',
  'SYSTEM'
);

-- =========================================================================
-- UTILITY FUNCTIONS
-- =========================================================================

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- =========================================================================
-- OFFICES
-- =========================================================================

create table public.offices (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  description text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger trg_offices_updated_at
before update on public.offices
for each row execute function public.set_updated_at();

-- =========================================================================
-- PROFILES (1:1 with auth.users)
-- =========================================================================

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  office_id uuid references public.offices(id) on delete set null,
  role public.app_role,
  full_name text,
  position_title text,
  phone text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_profiles_office on public.profiles(office_id);
create index idx_profiles_role on public.profiles(role);

create trigger trg_profiles_updated_at
before update on public.profiles
for each row execute function public.set_updated_at();

-- RBAC helper functions. SECURITY DEFINER + fixed search_path so they can
-- read profiles without re-triggering RLS on profiles (avoids recursion).
create or replace function public.app_current_role()
returns public.app_role
language sql stable security definer set search_path = public as $$
  select role from public.profiles where id = auth.uid();
$$;

create or replace function public.app_is_staff()
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role is not null and is_active
  );
$$;

create or replace function public.app_is_admin()
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'admin' and is_active
  );
$$;

-- Only an admin may change role / office / active status on a profile.
create or replace function public.prevent_profile_privilege_escalation()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if not public.app_is_admin() then
    if new.role is distinct from old.role
       or new.office_id is distinct from old.office_id
       or new.is_active is distinct from old.is_active then
      raise exception 'Only administrators can change role, office, or active status.';
    end if;
  end if;
  return new;
end;
$$;

create trigger trg_profiles_privilege_guard
before update on public.profiles
for each row execute function public.prevent_profile_privilege_escalation();

-- Auto-create a (role-less) profile row whenever a new auth user signs up.
-- An admin assigns role/office afterwards.
create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, full_name)
  values (new.id, coalesce(new.raw_user_meta_data->>'full_name', new.email))
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_auth_user();

-- =========================================================================
-- CONTRACTORS (supporting table, normalizes procurement/accomplishments)
-- =========================================================================

create table public.contractors (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  business_address text,
  contact_person text,
  contact_number text,
  email text,
  license_number text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_contractors_name on public.contractors(name);

create trigger trg_contractors_updated_at
before update on public.contractors
for each row execute function public.set_updated_at();

-- =========================================================================
-- PROJECTS
-- =========================================================================

create sequence public.project_code_seq start 1;

create table public.projects (
  id uuid primary key default gen_random_uuid(),
  project_code text not null unique,
  title text not null,
  description text,
  project_category text,
  barangay text,
  location_text text,
  latitude numeric(9,6) check (latitude between -90 and 90),
  longitude numeric(9,6) check (longitude between -180 and 180),
  estimated_cost numeric(14,2) check (estimated_cost >= 0),
  approved_budget numeric(14,2) check (approved_budget >= 0),
  funding_source text,
  start_date_planned date,
  end_date_planned date,
  start_date_actual date,
  end_date_actual date,
  status public.project_status not null default 'DRAFT',
  visibility public.visibility_status not null default 'PRIVATE',
  published_at timestamptz,
  published_by uuid references public.profiles(id) on delete restrict,
  office_id uuid references public.offices(id) on delete restrict,
  created_by uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint chk_planned_dates check (
    end_date_planned is null or start_date_planned is null or end_date_planned >= start_date_planned
  ),
  constraint chk_actual_dates check (
    end_date_actual is null or start_date_actual is null or end_date_actual >= start_date_actual
  )
);

create index idx_projects_status on public.projects(status);
create index idx_projects_visibility on public.projects(visibility);
create index idx_projects_status_visibility on public.projects(status, visibility);
create index idx_projects_office on public.projects(office_id);
create index idx_projects_created_by on public.projects(created_by);
create index idx_projects_barangay on public.projects(barangay);

create trigger trg_projects_updated_at
before update on public.projects
for each row execute function public.set_updated_at();

-- Generates a permanent, human-readable project code e.g. PRJ-2026-00001.
create or replace function public.generate_project_code()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.project_code is null then
    new.project_code := 'PRJ-' || to_char(now(), 'YYYY') || '-' ||
      lpad(nextval('public.project_code_seq')::text, 5, '0');
  end if;
  return new;
end;
$$;

create trigger trg_projects_generate_code
before insert on public.projects
for each row execute function public.generate_project_code();

-- project_id is immutable on any child table that has it (defined once,
-- reused by project_updates / project_images below).
create or replace function public.prevent_project_id_change()
returns trigger
language plpgsql as $$
begin
  if new.project_id is distinct from old.project_id then
    raise exception 'project_id cannot be changed after creation.';
  end if;
  return new;
end;
$$;

-- =========================================================================
-- PROJECT_SUBMISSIONS
-- =========================================================================

create table public.project_submissions (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  submission_number int not null,
  submitted_by uuid not null references public.profiles(id) on delete restrict,
  notes text,
  submitted_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (project_id, submission_number)
);

create index idx_submissions_project on public.project_submissions(project_id);
create index idx_submissions_by on public.project_submissions(submitted_by);

-- =========================================================================
-- PROJECT_APPROVALS
-- =========================================================================

create table public.project_approvals (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  submission_id uuid not null references public.project_submissions(id) on delete restrict,
  reviewed_by uuid not null references public.profiles(id) on delete restrict,
  decision public.approval_decision not null,
  remarks text,
  reviewed_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index idx_approvals_project on public.project_approvals(project_id);
create index idx_approvals_submission on public.project_approvals(submission_id);
create index idx_approvals_reviewer on public.project_approvals(reviewed_by);

-- =========================================================================
-- PROJECT_STATUS_HISTORY
-- =========================================================================

create table public.project_status_history (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  old_status public.project_status,
  new_status public.project_status not null,
  changed_by uuid references public.profiles(id) on delete set null,
  reason text,
  changed_at timestamptz not null default now()
);

create index idx_status_history_project on public.project_status_history(project_id);
create index idx_status_history_changed_at on public.project_status_history(changed_at);

-- =========================================================================
-- PROJECT_UPDATES (Engineering implementation monitoring)
-- =========================================================================

create table public.project_updates (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  reported_by uuid not null references public.profiles(id) on delete restrict,
  progress_percentage numeric(5,2) check (progress_percentage between 0 and 100),
  narrative_report text,
  issues_encountered text,
  weather_condition text,
  latitude numeric(9,6) check (latitude between -90 and 90),
  longitude numeric(9,6) check (longitude between -180 and 180),
  report_date date not null default current_date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_updates_project on public.project_updates(project_id);
create index idx_updates_reporter on public.project_updates(reported_by);
create index idx_updates_report_date on public.project_updates(report_date);

create trigger trg_updates_updated_at
before update on public.project_updates
for each row execute function public.set_updated_at();

create trigger trg_updates_lock_project
before update on public.project_updates
for each row execute function public.prevent_project_id_change();

-- =========================================================================
-- PROJECT_IMAGES
-- =========================================================================

create table public.project_images (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  project_update_id uuid references public.project_updates(id) on delete set null,
  uploaded_by uuid not null references public.profiles(id) on delete restrict,
  storage_path text not null,
  file_name text,
  image_stage public.image_stage not null default 'OTHER',
  captured_at timestamptz,
  latitude numeric(9,6) check (latitude between -90 and 90),
  longitude numeric(9,6) check (longitude between -180 and 180),
  ai_analysis_status public.ai_analysis_status not null default 'NOT_APPLICABLE',
  ai_analysis_result jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on column public.project_images.ai_analysis_result is
  'Reserved for future decision-support image analysis. Advisory only — must never be presented as an automatic finding of fault against a contractor or office.';

create index idx_images_project on public.project_images(project_id);
create index idx_images_update on public.project_images(project_update_id);
create index idx_images_stage on public.project_images(image_stage);

create trigger trg_images_updated_at
before update on public.project_images
for each row execute function public.set_updated_at();

create trigger trg_images_lock_project
before update on public.project_images
for each row execute function public.prevent_project_id_change();

-- =========================================================================
-- PROJECT_DOCUMENTS
-- =========================================================================

create table public.project_documents (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  uploaded_by uuid not null references public.profiles(id) on delete restrict,
  document_category public.doc_category not null default 'OTHER',
  title text not null,
  storage_path text not null,
  file_name text,
  created_at timestamptz not null default now()
);

create index idx_pdocs_project on public.project_documents(project_id);

-- =========================================================================
-- PROCUREMENT (BAC)
-- =========================================================================

create table public.procurement (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  is_current boolean not null default true,
  mode_of_procurement text,
  status public.procurement_status not null default 'NOT_STARTED',
  abc_amount numeric(14,2) check (abc_amount >= 0),
  bid_opening_date date,
  contractor_id uuid references public.contractors(id) on delete restrict,
  contract_number text,
  contract_amount numeric(14,2) check (contract_amount >= 0),
  contract_signed_date date,
  notice_to_proceed_date date,
  contract_duration_days int check (contract_duration_days > 0),
  expected_completion_date date,
  created_by uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Only one active/current procurement cycle per project (rebids create a
-- new row instead of overwriting history).
create unique index uq_procurement_current_per_project
  on public.procurement(project_id) where is_current;

create index idx_procurement_project on public.procurement(project_id);
create index idx_procurement_status on public.procurement(status);
create index idx_procurement_contractor on public.procurement(contractor_id);

create trigger trg_procurement_updated_at
before update on public.procurement
for each row execute function public.set_updated_at();

-- =========================================================================
-- PROCUREMENT_DOCUMENTS
-- =========================================================================

create table public.procurement_documents (
  id uuid primary key default gen_random_uuid(),
  procurement_id uuid not null references public.procurement(id) on delete cascade,
  uploaded_by uuid not null references public.profiles(id) on delete restrict,
  document_category public.procurement_doc_category not null default 'OTHER',
  title text not null,
  storage_path text not null,
  file_name text,
  created_at timestamptz not null default now()
);

create index idx_procdocs_procurement on public.procurement_documents(procurement_id);

-- =========================================================================
-- CONTRACTOR_ACCOMPLISHMENTS
-- =========================================================================

create table public.contractor_accomplishments (
  id uuid primary key default gen_random_uuid(),
  procurement_id uuid not null references public.procurement(id) on delete cascade,
  project_id uuid references public.projects(id) on delete cascade,
  uploaded_by uuid not null references public.profiles(id) on delete restrict,
  accomplishment_percentage numeric(5,2) check (accomplishment_percentage between 0 and 100),
  billing_period_start date,
  billing_period_end date,
  remarks text,
  storage_path text,
  file_name text,
  submitted_date date not null default current_date,
  created_at timestamptz not null default now()
);

create index idx_accomplishments_procurement on public.contractor_accomplishments(procurement_id);
create index idx_accomplishments_project on public.contractor_accomplishments(project_id);

-- Fills project_id from the linked procurement record if not supplied.
create or replace function public.sync_accomplishment_project_id()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.project_id is null then
    select project_id into new.project_id
    from public.procurement where id = new.procurement_id;
  end if;
  return new;
end;
$$;

create trigger trg_accomplishment_sync_project
before insert on public.contractor_accomplishments
for each row execute function public.sync_accomplishment_project_id();

-- =========================================================================
-- NOTIFICATIONS
-- =========================================================================

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  recipient_id uuid not null references public.profiles(id) on delete cascade,
  category public.notification_category not null default 'SYSTEM',
  title text not null,
  message text,
  related_project_id uuid references public.projects(id) on delete set null,
  is_read boolean not null default false,
  read_at timestamptz,
  created_at timestamptz not null default now()
);

create index idx_notifications_recipient on public.notifications(recipient_id, is_read);
create index idx_notifications_project on public.notifications(related_project_id);

-- Recipients may only toggle is_read/read_at, not rewrite the notification.
create or replace function public.restrict_notification_update()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if not public.app_is_admin() then
    if new.title is distinct from old.title
       or new.message is distinct from old.message
       or new.category is distinct from old.category
       or new.recipient_id is distinct from old.recipient_id
       or new.related_project_id is distinct from old.related_project_id then
      raise exception 'Only is_read/read_at can be updated on an existing notification.';
    end if;
  end if;
  return new;
end;
$$;

create trigger trg_notifications_restrict_update
before update on public.notifications
for each row execute function public.restrict_notification_update();

-- =========================================================================
-- MESSAGES
-- =========================================================================

create table public.messages (
  id uuid primary key default gen_random_uuid(),
  project_id uuid references public.projects(id) on delete set null,
  sender_id uuid not null references public.profiles(id) on delete restrict,
  recipient_id uuid references public.profiles(id) on delete cascade,
  recipient_office_id uuid references public.offices(id) on delete set null,
  body text not null,
  is_read boolean not null default false,
  read_at timestamptz,
  created_at timestamptz not null default now(),
  constraint chk_message_recipient check (recipient_id is not null or recipient_office_id is not null)
);

create index idx_messages_project on public.messages(project_id);
create index idx_messages_sender on public.messages(sender_id);
create index idx_messages_recipient on public.messages(recipient_id);
create index idx_messages_recipient_office on public.messages(recipient_office_id);

-- Recipients may only toggle is_read/read_at, not rewrite message content.
create or replace function public.restrict_message_update()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if not public.app_is_admin() then
    if new.body is distinct from old.body
       or new.sender_id is distinct from old.sender_id
       or new.recipient_id is distinct from old.recipient_id
       or new.recipient_office_id is distinct from old.recipient_office_id
       or new.project_id is distinct from old.project_id then
      raise exception 'Only is_read/read_at can be updated on an existing message.';
    end if;
  end if;
  return new;
end;
$$;

create trigger trg_messages_restrict_update
before update on public.messages
for each row execute function public.restrict_message_update();

-- =========================================================================
-- AUDIT_LOGS (append-only)
-- =========================================================================

create table public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references public.profiles(id) on delete set null,
  action text not null,
  entity_type text not null,
  entity_id uuid,
  description text,
  metadata jsonb,
  created_at timestamptz not null default now()
);

create index idx_audit_actor on public.audit_logs(actor_id);
create index idx_audit_entity on public.audit_logs(entity_type, entity_id);
create index idx_audit_created_at on public.audit_logs(created_at);

create or replace function public.prevent_audit_log_mutation()
returns trigger
language plpgsql as $$
begin
  raise exception 'audit_logs is append-only and cannot be modified or deleted.';
end;
$$;

create trigger trg_audit_no_update
before update on public.audit_logs
for each row execute function public.prevent_audit_log_mutation();

create trigger trg_audit_no_delete
before delete on public.audit_logs
for each row execute function public.prevent_audit_log_mutation();

create or replace function public.write_audit_log(
  p_action text,
  p_entity_type text,
  p_entity_id uuid,
  p_description text,
  p_metadata jsonb default null
) returns void
language plpgsql security definer set search_path = public as $$
begin
  insert into public.audit_logs (actor_id, action, entity_type, entity_id, description, metadata)
  values (auth.uid(), p_action, p_entity_type, p_entity_id, p_description, p_metadata);
end;
$$;

-- =========================================================================
-- WORKFLOW AUTOMATION TRIGGERS
-- (kept together here since they touch multiple tables defined above)
-- =========================================================================

-- Every status change (including the initial DRAFT on insert) is logged.
create or replace function public.log_project_status_change()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if TG_OP = 'INSERT' or (TG_OP = 'UPDATE' and new.status is distinct from old.status) then
    insert into public.project_status_history (project_id, old_status, new_status, changed_by)
    values (new.id, case when TG_OP = 'INSERT' then null else old.status end, new.status, auth.uid());
  end if;
  return new;
end;
$$;

create trigger trg_projects_log_status
after insert or update of status on public.projects
for each row execute function public.log_project_status_change();

-- Publishing/unpublishing a project is audit-worthy on its own.
create or replace function public.audit_project_visibility_change()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.visibility is distinct from old.visibility then
    perform public.write_audit_log(
      case when new.visibility = 'PUBLIC' then 'PROJECT_PUBLISHED' else 'PROJECT_UNPUBLISHED' end,
      'project', new.id, 'Project visibility changed to ' || new.visibility, null
    );
  end if;
  return new;
end;
$$;

create trigger trg_projects_audit_visibility
after update of visibility on public.projects
for each row execute function public.audit_project_visibility_change();

create or replace function public.audit_project_submission()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform public.write_audit_log(
    'PROJECT_SUBMITTED', 'project', new.project_id,
    'Project submitted for MPDC review (submission #' || new.submission_number || ')',
    jsonb_build_object('submission_id', new.id)
  );
  return new;
end;
$$;

create trigger trg_audit_submission
after insert on public.project_submissions
for each row execute function public.audit_project_submission();

-- Recording an MPDC decision automatically drives the project's status —
-- the app never has to write to both tables and hope they stay in sync.
create or replace function public.apply_project_approval()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update public.projects
  set status = new.decision::text::public.project_status
  where id = new.project_id;

  perform public.write_audit_log(
    'PROJECT_REVIEW_DECISION', 'project', new.project_id,
    'MPDC recorded decision: ' || new.decision,
    jsonb_build_object('approval_id', new.id, 'submission_id', new.submission_id)
  );
  return new;
end;
$$;

create trigger trg_apply_approval
after insert on public.project_approvals
for each row execute function public.apply_project_approval();

create or replace function public.audit_procurement_status_change()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if TG_OP = 'INSERT' or (TG_OP = 'UPDATE' and new.status is distinct from old.status) then
    perform public.write_audit_log(
      'PROCUREMENT_STATUS_CHANGED', 'procurement', new.id,
      'Procurement status set to ' || new.status,
      jsonb_build_object(
        'project_id', new.project_id,
        'old_status', case when TG_OP = 'INSERT' then null else old.status end
      )
    );
  end if;
  return new;
end;
$$;

create trigger trg_audit_procurement_status
after insert or update of status on public.procurement
for each row execute function public.audit_procurement_status_change();

-- Generic "an important document/image/report was uploaded" audit logger,
-- reused across several tables via trigger arguments.
create or replace function public.audit_generic_insert()
returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_entity_type text := TG_ARGV[0];
  v_action text := TG_ARGV[1];
begin
  perform public.write_audit_log(v_action, v_entity_type, new.id, v_action || ' recorded', to_jsonb(new));
  return new;
end;
$$;

create trigger trg_audit_project_document
after insert on public.project_documents
for each row execute function public.audit_generic_insert('project_document', 'DOCUMENT_UPLOADED');

create trigger trg_audit_procurement_document
after insert on public.procurement_documents
for each row execute function public.audit_generic_insert('procurement_document', 'DOCUMENT_UPLOADED');

create trigger trg_audit_accomplishment
after insert on public.contractor_accomplishments
for each row execute function public.audit_generic_insert('contractor_accomplishment', 'ACCOMPLISHMENT_UPLOADED');

create trigger trg_audit_project_image
after insert on public.project_images
for each row execute function public.audit_generic_insert('project_image', 'IMAGE_UPLOADED');

-- =========================================================================
-- PUBLIC VIEW (safe, curated column list for anonymous visitors)
-- =========================================================================

create view public.public_projects_view
with (security_invoker = true) as
select
  id, project_code, title, description, project_category, barangay,
  location_text, latitude, longitude, estimated_cost, approved_budget,
  funding_source, start_date_planned, end_date_planned,
  start_date_actual, end_date_actual, status, published_at, created_at
from public.projects
where visibility = 'PUBLIC';

grant select on public.public_projects_view to anon, authenticated;

-- =========================================================================
-- ROW LEVEL SECURITY
-- =========================================================================

alter table public.offices enable row level security;
alter table public.profiles enable row level security;
alter table public.contractors enable row level security;
alter table public.projects enable row level security;
alter table public.project_submissions enable row level security;
alter table public.project_approvals enable row level security;
alter table public.project_status_history enable row level security;
alter table public.project_updates enable row level security;
alter table public.project_images enable row level security;
alter table public.project_documents enable row level security;
alter table public.procurement enable row level security;
alter table public.procurement_documents enable row level security;
alter table public.contractor_accomplishments enable row level security;
alter table public.notifications enable row level security;
alter table public.messages enable row level security;
alter table public.audit_logs enable row level security;

-- offices: reference data, readable by any staff member; admin-managed.
create policy offices_select_staff on public.offices
  for select to authenticated using (public.app_is_staff());
create policy offices_admin_write on public.offices
  for all to authenticated using (public.app_is_admin()) with check (public.app_is_admin());

-- profiles: everyone can read their own row; staff can read the directory
-- (needed to show "submitted by", "reviewed by" names). Role/office changes
-- are blocked for non-admins by the trigger above, not by this policy.
create policy profiles_select_self_or_staff on public.profiles
  for select to authenticated using (id = auth.uid() or public.app_is_staff());
create policy profiles_update_self_or_admin on public.profiles
  for update to authenticated using (id = auth.uid() or public.app_is_admin());
create policy profiles_admin_insert on public.profiles
  for insert to authenticated with check (public.app_is_admin());
create policy profiles_admin_delete on public.profiles
  for delete to authenticated using (public.app_is_admin());

-- contractors: staff can read; BAC/admin maintain the master list.
create policy contractors_select_staff on public.contractors
  for select to authenticated using (public.app_is_staff());
create policy contractors_insert_bac on public.contractors
  for insert to authenticated with check (public.app_current_role() in ('bac', 'admin'));
create policy contractors_update_bac on public.contractors
  for update to authenticated using (public.app_current_role() in ('bac', 'admin'));

-- projects: no direct anon access — anon must use public_projects_view.
-- Staff (any office) can read all projects for cross-office monitoring.
create policy projects_select_staff on public.projects
  for select to authenticated using (public.app_is_staff());
create policy projects_insert_engineering on public.projects
  for insert to authenticated
  with check (public.app_current_role() in ('engineering', 'admin') and created_by = auth.uid());
create policy projects_update_scoped on public.projects
  for update to authenticated
  using (
    public.app_is_admin()
    or (public.app_current_role() = 'engineering' and created_by = auth.uid() and status in ('DRAFT', 'RETURNED_FOR_REVISION'))
    or (public.app_current_role() = 'mpdc' and status = 'APPROVED')
  );

-- project_submissions / project_approvals / project_status_history:
-- staff can read; writes go through Engineering / MPDC respectively.
-- Status history rows are only ever written by the trigger above.
create policy submissions_select_staff on public.project_submissions
  for select to authenticated using (public.app_is_staff());
create policy submissions_insert_engineering on public.project_submissions
  for insert to authenticated
  with check (public.app_current_role() in ('engineering', 'admin') and submitted_by = auth.uid());

create policy approvals_select_staff on public.project_approvals
  for select to authenticated using (public.app_is_staff());
create policy approvals_insert_mpdc on public.project_approvals
  for insert to authenticated
  with check (public.app_current_role() in ('mpdc', 'admin') and reviewed_by = auth.uid());

create policy status_history_select_staff on public.project_status_history
  for select to authenticated using (public.app_is_staff());

-- project_updates / project_images: Engineering reports, staff reads.
create policy updates_select_staff on public.project_updates
  for select to authenticated using (public.app_is_staff());
create policy updates_insert_engineering on public.project_updates
  for insert to authenticated
  with check (public.app_current_role() in ('engineering', 'admin') and reported_by = auth.uid());
create policy updates_modify_own_or_admin on public.project_updates
  for update to authenticated using (public.app_is_admin() or reported_by = auth.uid());

create policy images_select_staff on public.project_images
  for select to authenticated using (public.app_is_staff());
create policy images_insert_engineering on public.project_images
  for insert to authenticated
  with check (public.app_current_role() in ('engineering', 'admin') and uploaded_by = auth.uid());
create policy images_modify_own_or_admin on public.project_images
  for update to authenticated using (public.app_is_admin() or uploaded_by = auth.uid());
create policy images_delete_admin on public.project_images
  for delete to authenticated using (public.app_is_admin());

-- project_documents: Engineering uploads, staff reads, admin deletes.
create policy pdocs_select_staff on public.project_documents
  for select to authenticated using (public.app_is_staff());
create policy pdocs_insert_engineering on public.project_documents
  for insert to authenticated
  with check (public.app_current_role() in ('engineering', 'admin') and uploaded_by = auth.uid());
create policy pdocs_delete_admin on public.project_documents
  for delete to authenticated using (public.app_is_admin());

-- procurement / procurement_documents / contractor_accomplishments: BAC owns.
create policy procurement_select_staff on public.procurement
  for select to authenticated using (public.app_is_staff());
create policy procurement_insert_bac on public.procurement
  for insert to authenticated
  with check (public.app_current_role() in ('bac', 'admin') and created_by = auth.uid());
create policy procurement_update_bac on public.procurement
  for update to authenticated using (public.app_current_role() in ('bac', 'admin'));

create policy procdocs_select_staff on public.procurement_documents
  for select to authenticated using (public.app_is_staff());
create policy procdocs_insert_bac on public.procurement_documents
  for insert to authenticated
  with check (public.app_current_role() in ('bac', 'admin') and uploaded_by = auth.uid());
create policy procdocs_delete_admin on public.procurement_documents
  for delete to authenticated using (public.app_is_admin());

create policy accomplishments_select_staff on public.contractor_accomplishments
  for select to authenticated using (public.app_is_staff());
create policy accomplishments_insert_bac on public.contractor_accomplishments
  for insert to authenticated
  with check (public.app_current_role() in ('bac', 'admin') and uploaded_by = auth.uid());
create policy accomplishments_delete_admin on public.contractor_accomplishments
  for delete to authenticated using (public.app_is_admin());

-- notifications: recipient-only read/toggle; any staff action can notify.
create policy notifications_select_own on public.notifications
  for select to authenticated using (recipient_id = auth.uid() or public.app_is_admin());
create policy notifications_insert_staff on public.notifications
  for insert to authenticated with check (public.app_is_staff());
create policy notifications_update_own on public.notifications
  for update to authenticated using (recipient_id = auth.uid());
create policy notifications_delete_own on public.notifications
  for delete to authenticated using (recipient_id = auth.uid());

-- messages: sender, direct recipient, or recipient's whole office can read.
create policy messages_select_participant on public.messages
  for select to authenticated
  using (
    sender_id = auth.uid()
    or recipient_id = auth.uid()
    or (
      recipient_office_id is not null
      and recipient_office_id = (select office_id from public.profiles where id = auth.uid())
    )
    or public.app_is_admin()
  );
create policy messages_insert_staff on public.messages
  for insert to authenticated with check (public.app_is_staff() and sender_id = auth.uid());
create policy messages_update_recipient on public.messages
  for update to authenticated using (recipient_id = auth.uid());

-- audit_logs: admin-only read; writes only via write_audit_log() (SECURITY
-- DEFINER), never directly by clients. Immutability enforced by trigger above.
create policy audit_select_admin on public.audit_logs
  for select to authenticated using (public.app_is_admin());
