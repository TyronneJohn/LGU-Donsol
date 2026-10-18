-- Realtime online status for Staff Accounts and Messaging, replacing the
-- polled profile_sessions heartbeat (20260902110000_profile_session_presence.sql)
-- in the staff app.
--
-- The heartbeat could only notice a closed tab once its last_seen_at went
-- stale (3 minutes), and pages re-checked every 30s. The staff app now uses
-- Supabase Realtime Presence on the private 'staff-presence' channel
-- (apps/staff/src/contexts/PresenceContext.jsx): joins and leaves —
-- including a tab closed without signing out — are pushed to everyone on
-- the channel within seconds.
--
-- These policies gate the channel to active staff only (app_is_staff()
-- requires a role and is_active), so a disabled account or the public anon
-- key can neither see who's online nor appear online. Each member's
-- presence payload is just their role, keyed by profile id — no more than
-- the staff directory (profiles_select_self_or_staff) already exposes.
--
-- profile_sessions and online_roles() are left in place, now unused by the
-- app, so this migration is non-destructive.

create policy staff_presence_select on realtime.messages
  for select to authenticated
  using (
    realtime.topic() = 'staff-presence'
    and realtime.messages.extension = 'presence'
    and public.app_is_staff()
  );

create policy staff_presence_insert on realtime.messages
  for insert to authenticated
  with check (
    realtime.topic() = 'staff-presence'
    and realtime.messages.extension = 'presence'
    and public.app_is_staff()
  );
