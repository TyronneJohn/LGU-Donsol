-- "Confirmed By": the real name of the person behind each project action.
--
-- Office accounts (MPDC, Engineering, BAC) are shared by several staff, so
-- the account alone can't say who actually created, submitted, reviewed or
-- updated a project. Every such action in the staff app now requires the
-- person to type their own full name, recorded here alongside the account
-- that was signed in. Shown in the "Confirmed By" section at the bottom of
-- each project page (ConfirmedBySection.jsx).
--
-- Append-only: rows are never edited or deleted from the app, so the trail
-- can't be rewritten after the fact.

create table if not exists public.project_confirmations (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  action text not null check (length(btrim(action)) between 1 and 120),
  confirmed_by_name text not null check (length(btrim(confirmed_by_name)) between 2 and 120),
  account_id uuid not null default auth.uid() references public.profiles(id) on delete restrict,
  account_role public.app_role,
  created_at timestamptz not null default now()
);

create index if not exists idx_project_confirmations_project
  on public.project_confirmations(project_id, created_at desc);

-- account_id / account_role always come from the session, never the client,
-- so a row can't claim to have been made from another office's account.
create or replace function public.stamp_project_confirmation()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  new.account_id := auth.uid();
  new.account_role := public.app_current_role();
  new.confirmed_by_name := btrim(new.confirmed_by_name);
  new.created_at := now();
  return new;
end;
$$;

drop trigger if exists trg_stamp_project_confirmation on public.project_confirmations;
create trigger trg_stamp_project_confirmation
before insert on public.project_confirmations
for each row execute function public.stamp_project_confirmation();

alter table public.project_confirmations enable row level security;

drop policy if exists project_confirmations_select_staff on public.project_confirmations;
create policy project_confirmations_select_staff on public.project_confirmations
  for select to authenticated using (public.app_is_staff());

drop policy if exists project_confirmations_insert_staff on public.project_confirmations;
create policy project_confirmations_insert_staff on public.project_confirmations
  for insert to authenticated with check (public.app_is_staff());
