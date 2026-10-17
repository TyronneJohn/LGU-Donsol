-- Retake of the After photo of a monitoring update.
--
-- A monitoring update carries exactly one After photo (BeforeAfterSection.jsx).
-- Taking another one while the update is open is a retake: the new photo is
-- saved first, then the previous DRAFT After photo is removed — its file, its
-- row, and (by on delete cascade) the comparisons generated from it.
--
-- Engineering may delete only DRAFT After photos (released_at is null) of a
-- project of its own office. Anything already submitted to MPDC stays
-- admin-only (images_delete_admin), and every delete is still audited by
-- trg_audit_project_image_change.

create or replace function public.app_can_delete_draft_after_photo(p_project_id uuid, p_stage public.image_stage, p_released_at timestamptz)
returns boolean
language sql stable security definer set search_path = public as $$
  select p_stage = 'AFTER'
    and p_released_at is null
    and public.app_current_role() = 'engineering'
    and public.app_can_see_draft_photos(p_project_id);
$$;

revoke all on function public.app_can_delete_draft_after_photo(uuid, public.image_stage, timestamptz) from public;
grant execute on function public.app_can_delete_draft_after_photo(uuid, public.image_stage, timestamptz) to authenticated;

drop policy if exists images_delete_engineering_draft_after on public.project_images;
create policy images_delete_engineering_draft_after on public.project_images
  for delete to authenticated
  using (public.app_can_delete_draft_after_photo(project_id, image_stage, released_at));

-- The file goes before the row (the row is what proves it is a draft).
create or replace function public.is_deletable_draft_after_file(p_path text)
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1
    from public.project_images i
    where i.storage_path = p_path
      and public.app_can_delete_draft_after_photo(i.project_id, i.image_stage, i.released_at)
  );
$$;

revoke all on function public.is_deletable_draft_after_file(text) from public;
grant execute on function public.is_deletable_draft_after_file(text) to authenticated;

drop policy if exists "project_images_storage_delete_engineering_draft_after" on storage.objects;
create policy "project_images_storage_delete_engineering_draft_after" on storage.objects
  for delete to authenticated
  using (bucket_id = 'project-images' and public.is_deletable_draft_after_file(name));
