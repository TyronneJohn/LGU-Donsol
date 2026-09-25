-- prevent_profile_privilege_escalation (from the initial schema) only
-- recognized an authenticated admin — via app_is_admin(), which reads
-- auth.uid() — as allowed to change role/office_id/is_active. A
-- service-role connection (e.g. the create-staff-account Edge Function,
-- which must set role + office_id right after creating the auth user) has
-- no auth.uid(), so this trigger was blocking it even though service-role
-- already bypasses RLS entirely everywhere else.
--
-- Bring it in line with app_is_admin_or_system(), the helper the RLS
-- hardening migration already uses for the equivalent guards on `projects`.
create or replace function public.prevent_profile_privilege_escalation()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if not public.app_is_admin_or_system() then
    if new.role is distinct from old.role
       or new.office_id is distinct from old.office_id
       or new.is_active is distinct from old.is_active then
      raise exception 'Only administrators can change role, office, or active status.';
    end if;
  end if;
  return new;
end;
$$;
