-- Progress billings ("Total Cost Incurred to Date") and contract time
-- extensions ("No. of Extensions") — the two columns of MPDC's physical
-- 20% Development Fund Utilization Transparency Board the system had no
-- data for.
--
-- WHO ENCODES
-- -----------
-- MPDC only, the same office that maintains the physical board today. MPDC
-- copies each record from documents other offices have already signed (the
-- paid Disbursement Voucher from Accounting / Treasury, the approved
-- extension or suspension order from the Mayor). The system records those
-- outcomes; it does not approve payments or extensions. Engineering and
-- every other office can read the records but not change them.
--
-- SAFEGUARDS (a single office both encodes and publishes, so:)
--   * every record must carry its supporting document, and the file must
--     actually exist in the project-documents bucket;
--   * a saved record is never edited. A mistake is corrected by VOIDING the
--     record (reason required, excluded from every total and from the
--     public site) and encoding a new one. Only an admin may edit or delete;
--   * every insert, void, admin edit and delete goes to the append-only
--     audit log;
--   * billings can only be recorded under a signed contract, can never sum
--     above the contract amount, and dates cannot be in the future.
--
-- contractor_accomplishments (initial schema) is left untouched: it is a
-- BAC-owned upload table with no amounts, and no screen uses it.

-- =========================================================================
-- 1. Types and tables
-- =========================================================================
create type public.time_extension_type as enum ('TIME_EXTENSION', 'SUSPENSION');

create table public.project_billings (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  procurement_id uuid references public.procurement(id) on delete set null,
  billing_number int not null check (billing_number > 0),
  billing_period_start date,
  billing_period_end date,
  -- Cumulative physical accomplishment as of this billing.
  accomplishment_percentage numeric(5,2) not null check (accomplishment_percentage between 0 and 100),
  -- Value of work accomplished for this billing, before retention,
  -- recoupment and taxes. "Cost Incurred to Date" is the sum of this.
  gross_amount numeric(14,2) not null check (gross_amount > 0),
  net_amount numeric(14,2) not null check (net_amount >= 0),
  dv_number text not null check (btrim(dv_number) <> ''),
  paid_date date not null,
  remarks text,
  storage_path text not null,
  file_name text,
  encoded_by uuid not null references public.profiles(id) on delete restrict,
  is_voided boolean not null default false,
  void_reason text,
  voided_by uuid references public.profiles(id) on delete restrict,
  voided_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint chk_billing_period check (
    billing_period_end is null or billing_period_start is null or billing_period_end >= billing_period_start
  ),
  constraint chk_billing_net_not_above_gross check (net_amount <= gross_amount)
);

-- A voided billing frees its number so the corrected entry can reuse it.
create unique index uq_billing_number_per_project
  on public.project_billings(project_id, billing_number) where not is_voided;
create index idx_billings_project on public.project_billings(project_id);

create trigger trg_billings_updated_at
before update on public.project_billings
for each row execute function public.set_updated_at();

create table public.project_time_extensions (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  procurement_id uuid references public.procurement(id) on delete set null,
  extension_type public.time_extension_type not null default 'TIME_EXTENSION',
  days int not null check (days > 0),
  -- Full explanation. Published on the public site.
  reason text not null check (btrim(reason) <> ''),
  reference_number text,
  approved_date date not null,
  storage_path text not null,
  file_name text,
  encoded_by uuid not null references public.profiles(id) on delete restrict,
  is_voided boolean not null default false,
  void_reason text,
  voided_by uuid references public.profiles(id) on delete restrict,
  voided_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_extensions_project on public.project_time_extensions(project_id);

create trigger trg_extensions_updated_at
before update on public.project_time_extensions
for each row execute function public.set_updated_at();

-- =========================================================================
-- 2. RLS. Row access only; what may change lives in the guard triggers.
-- =========================================================================
alter table public.project_billings enable row level security;
alter table public.project_time_extensions enable row level security;

create policy billings_select_staff on public.project_billings
  for select to authenticated using (public.app_is_staff());

create policy billings_insert_mpdc on public.project_billings
  for insert to authenticated
  with check (public.app_current_role() in ('mpdc', 'admin') and encoded_by = auth.uid());

create policy billings_update_mpdc on public.project_billings
  for update to authenticated
  using (public.app_current_role() in ('mpdc', 'admin'))
  with check (public.app_current_role() in ('mpdc', 'admin'));

create policy billings_delete_admin on public.project_billings
  for delete to authenticated using (public.app_is_admin());

create policy extensions_select_staff on public.project_time_extensions
  for select to authenticated using (public.app_is_staff());

create policy extensions_insert_mpdc on public.project_time_extensions
  for insert to authenticated
  with check (public.app_current_role() in ('mpdc', 'admin') and encoded_by = auth.uid());

create policy extensions_update_mpdc on public.project_time_extensions
  for update to authenticated
  using (public.app_current_role() in ('mpdc', 'admin'))
  with check (public.app_current_role() in ('mpdc', 'admin'));

create policy extensions_delete_admin on public.project_time_extensions
  for delete to authenticated using (public.app_is_admin());

-- =========================================================================
-- 3. Shared guard helpers
-- =========================================================================

-- The project must be in implementation and under a signed contract.
-- Returns the current procurement id.
create or replace function public.require_signed_contract(p_project_id uuid)
returns uuid
language plpgsql stable security definer set search_path = public as $$
declare
  v_status public.project_status;
  v_proc_id uuid;
  v_proc_status public.procurement_status;
begin
  select status into v_status from public.projects where id = p_project_id;
  if v_status is null or v_status not in ('FOR_IMPLEMENTATION', 'ONGOING', 'COMPLETED') then
    raise exception 'Billings and time extensions can only be recorded once the project is under implementation.';
  end if;

  select id, status into v_proc_id, v_proc_status
  from public.procurement
  where project_id = p_project_id and is_current;

  if v_proc_id is null or v_proc_status not in ('CONTRACT_SIGNED', 'COMPLETED') then
    raise exception 'This project has no signed contract on record.';
  end if;

  return v_proc_id;
end;
$$;

revoke all on function public.require_signed_contract(uuid) from public, anon, authenticated;

create or replace function public.require_supporting_document(p_path text)
returns void
language plpgsql stable security definer set search_path = public as $$
begin
  if p_path is null or not exists (
    select 1 from storage.objects
    where bucket_id = 'project-documents' and name = p_path
  ) then
    raise exception 'Attach the supporting document before saving.';
  end if;
end;
$$;

revoke all on function public.require_supporting_document(text) from public, anon, authenticated;

-- Non-admin updates may only void a live record, with a reason.
create or replace function public.apply_financial_record_void(p_old jsonb, p_new jsonb)
returns void
language plpgsql immutable set search_path = public as $$
begin
  if (p_old ->> 'is_voided')::boolean then
    raise exception 'This record is already voided.';
  end if;
  if not (p_new ->> 'is_voided')::boolean then
    raise exception 'Saved records cannot be edited. Void it and encode a corrected entry instead.';
  end if;
  if coalesce(btrim(p_new ->> 'void_reason'), '') = '' then
    raise exception 'Give the reason for voiding this record.';
  end if;
  if (p_old - array['is_voided', 'void_reason', 'voided_by', 'voided_at', 'updated_at'])
     is distinct from
     (p_new - array['is_voided', 'void_reason', 'voided_by', 'voided_at', 'updated_at']) then
    raise exception 'Saved records cannot be edited. Void it and encode a corrected entry instead.';
  end if;
end;
$$;

revoke all on function public.apply_financial_record_void(jsonb, jsonb) from public, anon, authenticated;

-- =========================================================================
-- 4. Billing guard
-- =========================================================================
create or replace function public.guard_project_billing()
returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_today date := (now() at time zone 'Asia/Manila')::date;
  v_contract_amount numeric(14,2);
  v_other_total numeric(14,2);
begin
  if TG_OP = 'INSERT' then
    new.procurement_id := public.require_signed_contract(new.project_id);
    perform public.require_supporting_document(new.storage_path);

    if new.billing_number is null then
      select coalesce(max(billing_number), 0) + 1 into new.billing_number
      from public.project_billings where project_id = new.project_id and not is_voided;
    end if;

    new.is_voided := false;
    new.void_reason := null;
    new.voided_by := null;
    new.voided_at := null;
  else
    if new.id is distinct from old.id
      or new.project_id is distinct from old.project_id
      or new.encoded_by is distinct from old.encoded_by
      or new.created_at is distinct from old.created_at then
      raise exception 'project and encoder cannot be changed on a billing.';
    end if;

    if not public.app_is_admin_or_system() then
      perform public.apply_financial_record_void(to_jsonb(old), to_jsonb(new));
      new.voided_by := auth.uid();
      new.voided_at := now();
      return new;
    end if;
  end if;

  if new.paid_date > v_today then
    raise exception 'The payment date cannot be in the future.';
  end if;

  if not new.is_voided then
    select contract_amount into v_contract_amount
    from public.procurement where id = new.procurement_id;

    select coalesce(sum(gross_amount), 0) into v_other_total
    from public.project_billings
    where project_id = new.project_id and not is_voided and id <> new.id;

    if v_contract_amount is not null and v_other_total + new.gross_amount > v_contract_amount then
      raise exception 'Total billed (%) would exceed the contract amount (%).',
        to_char(v_other_total + new.gross_amount, 'FM999,999,999,990.00'),
        to_char(v_contract_amount, 'FM999,999,999,990.00');
    end if;
  end if;

  return new;
end;
$$;

create trigger trg_guard_project_billing
before insert or update on public.project_billings
for each row execute function public.guard_project_billing();

-- =========================================================================
-- 5. Time extension guard
-- =========================================================================
create or replace function public.guard_project_time_extension()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if TG_OP = 'INSERT' then
    new.procurement_id := public.require_signed_contract(new.project_id);
    perform public.require_supporting_document(new.storage_path);
    new.is_voided := false;
    new.void_reason := null;
    new.voided_by := null;
    new.voided_at := null;
  else
    if new.id is distinct from old.id
      or new.project_id is distinct from old.project_id
      or new.encoded_by is distinct from old.encoded_by
      or new.created_at is distinct from old.created_at then
      raise exception 'project and encoder cannot be changed on a time extension.';
    end if;

    if not public.app_is_admin_or_system() then
      perform public.apply_financial_record_void(to_jsonb(old), to_jsonb(new));
      new.voided_by := auth.uid();
      new.voided_at := now();
      return new;
    end if;
  end if;

  if new.approved_date > (now() at time zone 'Asia/Manila')::date then
    raise exception 'The approval date cannot be in the future.';
  end if;

  return new;
end;
$$;

create trigger trg_guard_project_time_extension
before insert or update on public.project_time_extensions
for each row execute function public.guard_project_time_extension();

-- =========================================================================
-- 6. Audit log. TG_ARGV[0] = audit entity type, TG_ARGV[1] = label.
-- =========================================================================
create or replace function public.audit_financial_record()
returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_entity text := TG_ARGV[0];
  v_prefix text := upper(replace(TG_ARGV[0], 'project_', ''));
  v_label text := TG_ARGV[1];
begin
  if TG_OP = 'INSERT' then
    perform public.write_audit_log(v_prefix || '_RECORDED', v_entity, new.id, v_label || ' recorded', to_jsonb(new));
  elsif TG_OP = 'DELETE' then
    perform public.write_audit_log(v_prefix || '_DELETED', v_entity, old.id, v_label || ' deleted', to_jsonb(old));
    return old;
  elsif new.is_voided and not old.is_voided then
    perform public.write_audit_log(
      v_prefix || '_VOIDED', v_entity, new.id,
      v_label || ' voided: ' || coalesce(new.void_reason, ''),
      to_jsonb(new)
    );
  elsif to_jsonb(old) - 'updated_at' is distinct from to_jsonb(new) - 'updated_at' then
    perform public.write_audit_log(
      v_prefix || '_EDITED', v_entity, new.id, v_label || ' edited by admin',
      jsonb_build_object('project_id', new.project_id, 'old', to_jsonb(old), 'new', to_jsonb(new))
    );
  end if;
  return new;
end;
$$;

create trigger trg_audit_project_billing
after insert or update or delete on public.project_billings
for each row execute function public.audit_financial_record('project_billing', 'Billing');

create trigger trg_audit_project_time_extension
after insert or update or delete on public.project_time_extensions
for each row execute function public.audit_financial_record('project_time_extension', 'Time extension');

-- =========================================================================
-- 7. Public transparency document: adds cost incurred, billings, time
--    extensions and the revised completion date. Voided records, DV number,
--    net amount, encoder and documents stay internal. Everything else
--    verbatim from 20261003110000_remove_public_savings.sql.
-- =========================================================================
create or replace function public.get_public_project_transparency(p_project_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_project public.projects%rowtype;
  v_budget numeric(14,2);
  v_proc record;
  v_awarded boolean;
  v_contract jsonb := null;
  v_progress numeric(5,2);
  v_original_completion date;
  v_extension_days int;
  v_revised_completion date;
begin
  select * into v_project
  from public.projects
  where id = p_project_id and visibility = 'PUBLIC';

  if not found then
    return null;
  end if;

  v_budget := coalesce(v_project.approved_budget, v_project.estimated_cost);

  select pr.status, pr.mode_of_procurement, pr.abc_amount, pr.contract_number,
         pr.contract_amount, pr.contract_signed_date, pr.notice_to_proceed_date,
         pr.contract_duration_days, pr.expected_completion_date,
         c.name as contractor_name
    into v_proc
  from public.procurement pr
  left join public.contractors c on c.id = pr.contractor_id
  where pr.project_id = p_project_id and pr.is_current;

  if found then
    v_awarded := v_proc.status in ('AWARDED', 'CONTRACT_SIGNED', 'COMPLETED');
    v_contract := jsonb_build_object(
      'status', v_proc.status,
      'mode_of_procurement', v_proc.mode_of_procurement,
      'abc_amount', v_proc.abc_amount,
      'awarded', v_awarded,
      'contractor_name', case when v_awarded then v_proc.contractor_name end,
      'contract_number', case when v_awarded then v_proc.contract_number end,
      'contract_amount', case when v_awarded then v_proc.contract_amount end,
      'contract_signed_date', case when v_awarded then v_proc.contract_signed_date end,
      'notice_to_proceed_date', case when v_awarded then v_proc.notice_to_proceed_date end,
      'contract_duration_days', case when v_awarded then v_proc.contract_duration_days end,
      'expected_completion_date', case when v_awarded then v_proc.expected_completion_date end
    );
    if v_awarded then
      v_original_completion := v_proc.expected_completion_date;
    end if;
  end if;

  v_original_completion := coalesce(v_original_completion, v_project.end_date_planned);

  select u.progress_percentage into v_progress
  from public.project_updates u
  where u.project_id = p_project_id and u.progress_percentage is not null
  order by u.report_date desc, u.created_at desc
  limit 1;

  select coalesce(sum(days), 0)::int into v_extension_days
  from public.project_time_extensions
  where project_id = p_project_id and not is_voided;

  v_revised_completion := v_original_completion + v_extension_days;

  return jsonb_build_object(
    'project_id', v_project.id,
    'approved_budget', v_budget,
    'contract', v_contract,
    'progress_percentage',
      case when v_project.status = 'COMPLETED' then 100 else v_progress end,
    'cost_incurred', (
      select coalesce(sum(b.gross_amount), 0)
      from public.project_billings b
      where b.project_id = p_project_id and not b.is_voided
    ),
    'billings', coalesce((
      select jsonb_agg(
               jsonb_build_object(
                 'id', b.id,
                 'billing_number', b.billing_number,
                 'billing_period_start', b.billing_period_start,
                 'billing_period_end', b.billing_period_end,
                 'accomplishment_percentage', b.accomplishment_percentage,
                 'gross_amount', b.gross_amount,
                 'paid_date', b.paid_date
               )
               order by b.billing_number
             )
      from public.project_billings b
      where b.project_id = p_project_id and not b.is_voided
    ), '[]'::jsonb),
    'schedule', jsonb_build_object(
      'original_completion', v_original_completion,
      'extension_days', v_extension_days,
      'revised_completion', v_revised_completion,
      'is_delayed',
        v_project.status <> 'COMPLETED'
        and v_revised_completion is not null
        and v_revised_completion < (now() at time zone 'Asia/Manila')::date
    ),
    'extensions', coalesce((
      select jsonb_agg(
               jsonb_build_object(
                 'id', e.id,
                 'extension_type', e.extension_type,
                 'days', e.days,
                 'reason', e.reason,
                 'reference_number', e.reference_number,
                 'approved_date', e.approved_date
               )
               order by e.approved_date, e.created_at
             )
      from public.project_time_extensions e
      where e.project_id = p_project_id and not e.is_voided
    ), '[]'::jsonb),
    'updates', coalesce((
      select jsonb_agg(
               jsonb_build_object(
                 'id', u.id,
                 'report_date', u.report_date,
                 'progress_percentage', u.progress_percentage,
                 'narrative_report', u.narrative_report
               )
               order by u.report_date desc, u.created_at desc
             )
      from public.project_updates u
      where u.project_id = p_project_id
    ), '[]'::jsonb),
    'photos', coalesce((
      select jsonb_agg(
               jsonb_build_object(
                 'id', i.id,
                 'storage_path', i.storage_path,
                 'image_stage', i.image_stage,
                 'captured_at', coalesce(i.captured_at, i.created_at)
               )
               order by coalesce(i.captured_at, i.created_at)
             )
      from public.project_images i
      where i.project_id = p_project_id
        and i.image_stage in ('BEFORE', 'DURING', 'AFTER')
    ), '[]'::jsonb)
  );
end;
$$;

revoke all on function public.get_public_project_transparency(uuid) from public;
grant execute on function public.get_public_project_transparency(uuid) to anon, authenticated;
