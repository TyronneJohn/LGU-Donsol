-- A Program of Works is final once Engineering submits it.
--
-- Until now Engineering could reopen and change pow_amount / pow_date after
-- sending them to MPDC (the "Edit" button on ProjectReviewDetail.jsx, now
-- removed). guard_project_field_updates() (last redefined in
-- 20260929100000_mpdc_approval_authority.sql) already stops MPDC from
-- touching these fields; this separate trigger closes the remaining gap for
-- Engineering without redefining that large function again.
--
-- Admins (and system/migration contexts) can still correct a POW, matching
-- how every other locked field in this schema is handled.

create or replace function public.lock_program_of_works()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if public.app_is_admin_or_system() then
    return new;
  end if;

  if old.pow_submitted_at is not null
    and (
      new.pow_amount is distinct from old.pow_amount
      or new.pow_date is distinct from old.pow_date
      or new.pow_submitted_at is distinct from old.pow_submitted_at
      or new.pow_submitted_by is distinct from old.pow_submitted_by
    )
  then
    raise exception 'The Program of Works has already been submitted and can no longer be edited.';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_lock_program_of_works on public.projects;
create trigger trg_lock_program_of_works
before update on public.projects
for each row execute function public.lock_program_of_works();
