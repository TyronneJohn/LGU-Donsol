-- Annual Budget ceiling — a system-wide appropriation figure Admin sets
-- once per fiscal year (mirrors an LGU's Annual Investment Program
-- ceiling: an appropriated amount that individual projects draw down,
-- rather than a figure derived by summing project costs). Dashboards
-- compute "Remaining Budget" as this amount minus the sum of
-- approved_budget/estimated_cost across every project from APPROVED
-- onward (mirrors MONITORING_VISIBLE_STATUSES in projectStatus.js) —
-- pre-approval projects (DRAFT/SUBMITTED_FOR_REVIEW/RETURNED_FOR_REVISION/
-- REJECTED) aren't yet an appropriated obligation and don't draw against
-- the ceiling.
create table public.annual_budgets (
  id uuid primary key default gen_random_uuid(),
  year integer not null unique,
  amount numeric(14, 2) not null default 0 check (amount >= 0),
  updated_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger trg_annual_budgets_updated_at
before update on public.annual_budgets
for each row execute function public.set_updated_at();

alter table public.annual_budgets enable row level security;

-- Every active staff member can see the ceiling (it drives the "Remaining
-- Budget" tile on all four dashboards) — only an admin can set it.
create policy annual_budgets_select_staff on public.annual_budgets
  for select to authenticated using (public.app_is_staff());

create policy annual_budgets_insert_admin on public.annual_budgets
  for insert to authenticated with check (public.app_is_admin() and updated_by = auth.uid());

create policy annual_budgets_update_admin on public.annual_budgets
  for update to authenticated using (public.app_is_admin())
  with check (public.app_is_admin() and updated_by = auth.uid());
