-- BAC marking a procurement cycle COMPLETED (its own paperwork closeout,
-- distinct from project.status) previously triggered nothing at all — no
-- audit log entry, no notification — unlike every other procurement
-- lifecycle transition (opened, awarded, contract signed), which already
-- notify the relevant office. This closes that gap by extending
-- apply_procurement_completion() with a COMPLETED branch, mirroring the
-- CONTRACT_SIGNED branch's shape but without touching project.status
-- (still BAC's own bookkeeping only, per the comment above this function
-- in 20260812110000_bac_procurement_module.sql).
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

  if new.status = 'COMPLETED' and (TG_OP = 'INSERT' or old.status is distinct from new.status) then
    select title, created_by into v_project_title, v_project_owner
    from public.projects
    where id = new.project_id;

    if v_project_title is not null then
      perform public.write_audit_log(
        'PROCUREMENT_COMPLETED', 'procurement', new.id,
        'BAC closed out procurement paperwork for this cycle',
        jsonb_build_object('project_id', new.project_id)
      );

      insert into public.notifications (recipient_id, category, title, message, related_project_id, sender_id)
      select p.id, 'PROCUREMENT_UPDATE',
        'Procurement completed: ' || v_project_title,
        'BAC has closed out procurement paperwork for this project.',
        new.project_id,
        auth.uid()
      from public.profiles p
      where (p.id = v_project_owner or p.role = 'admin') and p.is_active;
    end if;
  end if;

  return new;
end;
$$;
