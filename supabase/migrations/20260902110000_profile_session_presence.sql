-- Replaces the single-timestamp presence tracking added in
-- 20260902100000_profile_presence_tracking.sql with a proper per-session
-- table.
--
-- The single-column approach broke under multiple simultaneous sessions for
-- the same account (two browsers/devices signed in at once): signing out of
-- *one* session cleared the single last_seen_at on the profile row, which
-- briefly showed Staff Accounts "Inactive" even though another session was
-- still live. It self-corrected on that other session's next heartbeat
-- (<=60s later), but that window was wrong — logging out on one device
-- must not affect whether the account still shows Active from another.
--
-- profile_sessions tracks presence per session instead: each browser tab
-- gets its own random session_key (generated once per tab, in
-- AuthContext.jsx), heartbeats upsert only its own row, and sign-out
-- deletes only that row. "Online" becomes "does this profile have any
-- session row with a recent last_seen_at" — signing out on one device just
-- removes that one row.

alter table public.profiles drop column if exists last_seen_at;

create table public.profile_sessions (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  session_key text not null,
  last_seen_at timestamptz not null default now(),
  unique (profile_id, session_key)
);

create index idx_profile_sessions_profile on public.profile_sessions(profile_id);
create index idx_profile_sessions_last_seen on public.profile_sessions(last_seen_at);

alter table public.profile_sessions enable row level security;

-- Only admins need to read presence (Staff Accounts, admin-only). Each
-- signed-in user manages only their own session rows.
create policy profile_sessions_select_admin on public.profile_sessions
  for select to authenticated using (public.app_is_admin());
create policy profile_sessions_write_self on public.profile_sessions
  for all to authenticated using (profile_id = auth.uid()) with check (profile_id = auth.uid());
