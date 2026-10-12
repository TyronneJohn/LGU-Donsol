-- Lets every staff member see which offices currently have someone online,
-- for the Messenger-style green dot on Messaging conversations.
--
-- profile_sessions itself stays admin-read-only
-- (20260902110000_profile_session_presence.sql): its rows carry per-tab
-- session keys and per-person timestamps that non-admins have no need for.
-- This function exposes only the aggregate answer — the set of roles with
-- at least one recently heartbeating session — and nothing per person.
--
-- The 3-minute window mirrors ONLINE_THRESHOLD_MS in
-- apps/staff/src/pages/admin/StaffAccounts.jsx (3x the 60s heartbeat in
-- AuthContext.jsx), so a tab closed without signing out drops off within
-- a few minutes and Messaging agrees with Staff Accounts.

create or replace function public.online_roles()
returns setof public.app_role
language sql
stable
security definer
set search_path = public
as $$
  select distinct p.role
  from public.profile_sessions s
  join public.profiles p on p.id = s.profile_id
  where public.app_is_staff()
    and p.is_active
    and p.role is not null
    and s.last_seen_at >= now() - interval '3 minutes';
$$;

revoke execute on function public.online_roles() from public, anon;
grant execute on function public.online_roles() to authenticated;
