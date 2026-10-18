-- Messenger-style replies: a message can quote an earlier message from the
-- same conversation (apps/staff/src/pages/shared/Messaging.jsx).
--
-- reply_to_id is set once, on insert, and is frozen afterwards like the
-- rest of a message's content. ON DELETE SET NULL keeps a reply when its
-- original is removed (there's no delete policy, so only the dashboard /
-- service role can do that) — the reply then just loses its quote.

alter table public.messages
  add column reply_to_id uuid references public.messages(id) on delete set null;

create index idx_messages_reply_to on public.messages(reply_to_id);

-- =========================================================================
-- 1. A reply may only point at a message from the same two-office
--    conversation. RLS already hides other conversations from the client,
--    but without this a crafted insert could still link to (and leak the
--    existence of) a message id from somewhere else. Security definer so
--    the lookup isn't itself limited by RLS.
-- =========================================================================
create or replace function public.check_message_reply()
returns trigger
language plpgsql security definer set search_path = public as $$
declare
  original public.messages;
begin
  if new.reply_to_id is null then
    return new;
  end if;

  select * into original from public.messages where id = new.reply_to_id;

  if not found or not (
    (original.sender_role = new.sender_role and original.recipient_role = new.recipient_role)
    or (original.sender_role = new.recipient_role and original.recipient_role = new.sender_role)
  ) then
    raise exception 'A reply must point at a message in the same conversation.';
  end if;

  return new;
end;
$$;

create trigger trg_messages_check_reply
before insert on public.messages
for each row execute function public.check_message_reply();

-- =========================================================================
-- 2. Freeze reply_to_id along with the other content columns (same list as
--    20260926100000_message_file_attachments.sql). Clearing it to null is
--    still allowed: that's the ON DELETE SET NULL cascade above, which runs
--    as an UPDATE under whoever deleted the original.
-- =========================================================================
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
       or new.attachment_size is distinct from old.attachment_size
       or (new.reply_to_id is distinct from old.reply_to_id and new.reply_to_id is not null) then
      raise exception 'Only is_read/read_at can be updated on an existing message.';
    end if;
  end if;
  return new;
end;
$$;
