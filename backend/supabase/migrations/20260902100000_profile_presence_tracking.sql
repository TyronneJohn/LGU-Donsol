-- Adds session-presence tracking to profiles, separate from is_active.
--
-- is_active is a security-critical account-enable flag: app_is_staff() and
-- app_is_admin() (20260811100000_initial_schema.sql) both gate every RLS
-- policy in the system on it. Nothing in the app UI ever toggles it, so
-- every account shows it as permanently true — the Staff Accounts page was
-- reading it as an "is this person currently logged in" indicator, which it
-- was never designed to be, and which is unsafe to repurpose (RLS access
-- would flip on the same field).
--
-- last_seen_at is a lightweight heartbeat instead: the client stamps it on
-- sign-in and periodically thereafter while a session is open
-- (apps/staff/src/contexts/AuthContext.jsx), and clears it to null on
-- sign-out. Staff Accounts then derives "Active" (online now) from how
-- recent that timestamp is, rather than from is_active.

alter table public.profiles
  add column last_seen_at timestamptz;
