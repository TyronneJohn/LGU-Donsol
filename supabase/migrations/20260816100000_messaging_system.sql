-- LGU Donsol Project Monitoring System — internal office-to-office messaging
--
-- The initial schema already shipped a `messages` table and a `notifications`
-- table (with an unused NEW_MESSAGE category) for this exact feature, but
-- nothing was ever wired up to them. This migration finishes that: it adds
-- the columns needed to address a message at an OFFICE rather than a single
-- user (conversations are office-to-office, not person-to-person — any staff
-- member in the destination office can read/reply), links notifications back
-- to their message, and — critically — removes the admin blanket-read
-- bypass on both tables so an administrator can only read conversations/
-- notifications they are actually a party to, not every private message in
-- the system.
--
-- Purely additive: no table is dropped, no already-applied migration is
-- edited. `offices` is intentionally left untouched — it only has 3 rows
-- (Engineering/MPDC/BAC, admin has no office row), so "office" for messaging
-- purposes is keyed off profiles.role (app_role already covers all four:
-- admin/mpdc/engineering/bac) rather than the offices table.

-- =========================================================================
-- 1. messages: add role-based addressing columns
-- =========================================================================

alter table public.messages
  add column sender_role public.app_role,
  add column recipient_role public.app_role;

alter table public.messages
  drop constraint chk_message_recipient,
  add constraint chk_message_recipient check (
    recipient_id is not null or recipient_office_id is not null or recipient_role is not null
  );

create index idx_messages_recipient_role on public.messages(recipient_role, created_at);
create index idx_messages_sender_role on public.messages(sender_role, created_at);

-- Recipients may only toggle is_read/read_at, not rewrite message content —
-- re-declared here (same shape as the initial migration) to also cover the
-- two new columns, so a "mark as read" update can't smuggle in a role change.
create or replace function public.restrict_message_update()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if not public.app_is_admin() then
    if new.body is distinct from old.body
       or new.sender_id is distinct from old.sender_id
       or new.recipient_id is distinct from old.recipient_id
       or new.recipient_office_id is distinct from old.recipient_office_id
       or new.sender_role is distinct from old.sender_role
       or new.recipient_role is distinct from old.recipient_role
       or new.project_id is distinct from old.project_id then
      raise exception 'Only is_read/read_at can be updated on an existing message.';
    end if;
  end if;
  return new;
end;
$$;

-- =========================================================================
-- 2. notifications: link back to sender + message (for bell click-through
--    and bulk "mark as read when conversation opened")
-- =========================================================================

alter table public.notifications
  add column sender_id uuid references public.profiles(id) on delete set null,
  add column related_message_id uuid references public.messages(id) on delete set null;

create index idx_notifications_message on public.notifications(related_message_id);

-- Same reasoning as above: the existing update-guard trigger only protected
-- the original columns from a non-admin "mark as read" update. Extend it to
-- the two new columns so a recipient can't rewrite who a notification is
-- attributed to while toggling is_read.
create or replace function public.restrict_notification_update()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if not public.app_is_admin() then
    if new.title is distinct from old.title
       or new.message is distinct from old.message
       or new.category is distinct from old.category
       or new.recipient_id is distinct from old.recipient_id
       or new.related_project_id is distinct from old.related_project_id
       or new.sender_id is distinct from old.sender_id
       or new.related_message_id is distinct from old.related_message_id then
      raise exception 'Only is_read/read_at can be updated on an existing notification.';
    end if;
  end if;
  return new;
end;
$$;

-- =========================================================================
-- 3. RLS — office-to-office privacy
--
--    A message is readable by: whoever sent it, whoever it was directly
--    addressed to (legacy recipient_id path, unused by new sends but kept
--    functional), or any staff member whose role matches either side of the
--    conversation (recipient_role/sender_role). That last clause is what
--    makes it "office-to-office": every MPDC user can read every MPDC↔X
--    conversation, not just messages they personally sent or received —
--    but MPDC still can never see an Engineering↔BAC conversation, and
--    admin only sees conversations admin is actually a party to.
-- =========================================================================

drop policy if exists messages_select_participant on public.messages;
create policy messages_select_participant on public.messages
  for select to authenticated
  using (
    sender_id = auth.uid()
    or recipient_id = auth.uid()
    or (recipient_role is not null and recipient_role = public.app_current_role())
    or (sender_role is not null and sender_role = public.app_current_role())
  );

drop policy if exists messages_insert_staff on public.messages;
create policy messages_insert_staff on public.messages
  for insert to authenticated
  with check (
    public.app_is_staff()
    and sender_id = auth.uid()
    and sender_role = public.app_current_role()
    and recipient_role is not null
    and recipient_role is distinct from sender_role
  );

drop policy if exists messages_update_recipient on public.messages;
create policy messages_update_recipient on public.messages
  for update to authenticated
  using (
    recipient_id = auth.uid()
    or (recipient_role is not null and recipient_role = public.app_current_role())
    or public.app_is_admin()
  );

-- notifications: strictly recipient-only now — the admin bypass here would
-- have let admin read message previews (title/message) for every private
-- conversation in the system, defeating the point of the messages-table
-- privacy fix above. No existing admin page reads this table today, so
-- nothing regresses.
drop policy if exists notifications_select_own on public.notifications;
create policy notifications_select_own on public.notifications
  for select to authenticated using (recipient_id = auth.uid());

-- =========================================================================
-- 4. Realtime — enable postgres_changes delivery for live message/bell
--    updates without a manual refresh.
-- =========================================================================

alter publication supabase_realtime add table public.messages;
alter publication supabase_realtime add table public.notifications;
