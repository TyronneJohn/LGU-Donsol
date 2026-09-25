-- Seeds the three offices that map to the non-admin roles (app_role enum:
-- 'mpdc', 'engineering', 'bac'). Reference data, not application/business
-- data — needed so profiles.office_id has something to point at and the
-- Staff Accounts admin page has offices to assign staff to.

insert into public.offices (code, name) values
  ('ENGG', 'Engineering Office'),
  ('MPDC', 'Municipal Planning and Development Coordinator'),
  ('BAC', 'Bids and Awards Committee')
on conflict (code) do nothing;
