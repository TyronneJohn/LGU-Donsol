-- An AFTER photo is only meaningful against a BEFORE baseline: reject AFTER
-- photos for a project that has no BEFORE photo yet. Same rule the Before &
-- After section (BeforeAfterSection.jsx) applies in the UI, enforced here so
-- it can't be skipped. Complements trg_require_before_photo on
-- project_updates (20261015100000_before_after_comparison.sql).

create or replace function public.require_before_for_after_photo()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.image_stage = 'AFTER' and not exists (
    select 1 from public.project_images
    where project_id = new.project_id and image_stage = 'BEFORE'
  ) then
    raise exception 'Upload a BEFORE photo of the site first (Before & After section) before taking an AFTER photo.'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_require_before_for_after_photo on public.project_images;
create trigger trg_require_before_for_after_photo
before insert on public.project_images
for each row execute function public.require_before_for_after_photo();
