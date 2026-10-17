-- An award must rest on its papers. Under RA 12009 the BAC recommends award
-- through a BAC Resolution and the Head of the Procuring Entity issues the
-- Notice of Award, both before BAC records the winning bidder here. Until now
-- AWARDED only needed a contractor_id, so an award could be recorded with
-- nothing on file to back it.
--
-- guard_procurement_changes (20260928100000_security_fixes.sql) gains one rule:
-- moving a procurement into AWARDED or beyond from an earlier status needs a
-- BAC_RESOLUTION and a NOTICE_OF_AWARD document on that procurement. Everything
-- else in the function is unchanged, including the admin override.

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

    if new.status in ('AWARDED', 'CONTRACT_SIGNED', 'COMPLETED')
      and old.status in ('NOT_STARTED', 'BIDDING', 'BID_EVALUATION')
    then
      if not exists (
        select 1 from public.procurement_documents d
        where d.procurement_id = new.id and d.document_category::text = 'BAC_RESOLUTION'
      ) then
        raise exception 'Upload the BAC Resolution recommending award before recording the award.';
      end if;
      if not exists (
        select 1 from public.procurement_documents d
        where d.procurement_id = new.id and d.document_category::text = 'NOTICE_OF_AWARD'
      ) then
        raise exception 'Upload the Notice of Award before recording the award.';
      end if;
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
