-- "Active 4 minutes ago" on Messaging conversations, per office.
--
-- Realtime Presence (20261025100000_staff_realtime_presence.sql) only knows
-- who is online right now; it keeps no history of when someone left. This
-- table keeps one last-seen timestamp per profile, stamped by the staff
-- app every 60s while signed in and once more on sign-out
-- (apps/staff/src/contexts/AuthContext.jsx), so a tab closed without
-- signing out is still accurate to within about a minute.
--
-- Timestamps come from the database's now(), not the browser, so a PC
-- with a wrong clock can't skew the label. Nobody reads the table
-- directly: office_last_seen() exposes only the aggregate per office role
-- — never when a particular person logged out.

create table public.profile_last_seen (
  profile_id uuid primary key references public.profiles(id) on delete cascade,
  last_seen_at timestamptz not null default now()
);

-- No policies: reads and writes go only through the security definer
-- functions below.
alter table public.profile_last_seen enable row level security;

-- Carry over what the old heartbeat already recorded, so offices show a
-- last-seen time right away instead of "Offline" until each signs in again.
insert into public.profile_last_seen (profile_id, last_seen_at)
select profile_id, max(last_seen_at)
from public.profile_sessions
group by profile_id;

create or replace function public.touch_last_seen()
returns void
language sql
volatile
security definer
set search_path = public
as $$
  insert into public.profile_last_seen (profile_id, last_seen_at)
  select auth.uid(), now()
  where public.app_is_staff()
  on conflict (profile_id) do update set last_seen_at = excluded.last_seen_at;
$$;

create or replace function public.office_last_seen()
returns table (role public.app_role, last_seen_at timestamptz)
language sql
stable
security definer
set search_path = public
as $$
  select p.role, max(l.last_seen_at)
  from public.profile_last_seen l
  join public.profiles p on p.id = l.profile_id
  where public.app_is_staff()
    and p.is_active
    and p.role is not null
  group by p.role;
$$;

revoke execute on function public.touch_last_seen() from public, anon;
grant execute on function public.touch_last_seen() to authenticated;
revoke execute on function public.office_last_seen() from public, anon;
grant execute on function public.office_last_seen() to authenticated;
