-- "Confirmed By" history is for the Admin only.
--
-- Office accounts still record the name of the person behind each action
-- (insert stays open to staff), but only the Admin can read the trail, shown
-- per project on AdminProjectDetail. Office pages keep just the name input.

drop policy if exists project_confirmations_select_staff on public.project_confirmations;
drop policy if exists project_confirmations_select_admin on public.project_confirmations;
create policy project_confirmations_select_admin on public.project_confirmations
  for select to authenticated using (public.app_is_admin());
