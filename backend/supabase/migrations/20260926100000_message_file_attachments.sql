-- LGU Donsol Project Monitoring System — file attachments on messages
--
-- Until now a message could only carry a link to a project. When something
-- goes wrong on a project, offices need to pass along the actual paperwork
-- or site photo (a letter, a revised POW, a screenshot) without leaving the
-- conversation, so a message can now also carry one file picked from the
-- sender's computer.
--
-- Files go into a private `message-attachments` bucket at
--   <sender_role>/<recipient_role>/<uuid>-<file name>
-- so storage access can mirror the office-to-office privacy of the messages
-- table itself: only the two offices on either side of the conversation can
-- read the file (admin included only when admin is one of them).
--
-- Purely additive: no table is dropped, no already-applied migration edited.

-- =========================================================================
-- 1. messages: attachment metadata
-- =========================================================================

alter table public.messages
  add column attachment_path text,
  add column attachment_name text,
  add column attachment_type text,
  add column attachment_size bigint;

-- Re-declared (same shape as 20260816100000_messaging_system.sql) to also
-- freeze the attachment columns: a "mark as read" update must not be able
-- to swap the file a message points at.
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
       or new.project_id is distinct from old.project_id
       or new.attachment_path is distinct from old.attachment_path
       or new.attachment_name is distinct from old.attachment_name
       or new.attachment_type is distinct from old.attachment_type
       or new.attachment_size is distinct from old.attachment_size then
      raise exception 'Only is_read/read_at can be updated on an existing message.';
    end if;
  end if;
  return new;
end;
$$;

-- =========================================================================
-- 2. Storage bucket. Private; 25 MB per file.
-- =========================================================================

insert into storage.buckets (id, name, public, file_size_limit)
values ('message-attachments', 'message-attachments', false, 26214400)
on conflict (id) do nothing;

-- Readable by either office in the conversation (first two path segments).
create policy "message_attachments_storage_select_party" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'message-attachments'
    and public.app_is_staff()
    and (
      (storage.foldername(name))[1] = public.app_current_role()::text
      or (storage.foldername(name))[2] = public.app_current_role()::text
    )
  );

-- Uploads only into your own office's outbox, addressed to another office.
create policy "message_attachments_storage_insert_sender" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'message-attachments'
    and public.app_is_staff()
    and (storage.foldername(name))[1] = public.app_current_role()::text
    and (storage.foldername(name))[2] is distinct from public.app_current_role()::text
  );

-- The sender may remove their own upload (cleanup when the message insert
-- fails right after the upload); admin may remove anything.
create policy "message_attachments_storage_delete_owner" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'message-attachments'
    and (owner = auth.uid() or public.app_is_admin())
  );
