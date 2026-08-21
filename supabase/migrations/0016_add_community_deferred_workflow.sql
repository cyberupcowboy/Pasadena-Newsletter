alter table public.community_submissions
  drop constraint if exists community_submissions_moderation_status_check;

alter table public.community_submissions
  add constraint community_submissions_moderation_status_check
    check (moderation_status = any (array[
      'pending'::text,
      'review'::text,
      'deferred'::text,
      'approved'::text,
      'rejected'::text,
      'published'::text
    ])),
  add column if not exists deferred_at timestamptz;

create or replace function app_private.stamp_community_submission_review()
returns trigger
language plpgsql
set search_path = 'pg_catalog', 'public'
as $$
begin
  if new.moderation_status is distinct from old.moderation_status
     and new.moderation_status in ('approved','rejected','published') then
    new.reviewed_by := auth.uid();
    new.reviewed_at := now();
  end if;

  if new.moderation_status is distinct from old.moderation_status
     and new.moderation_status in ('approved','published')
     and new.published_at is null then
    new.published_at := now();
  end if;

  if new.moderation_status is distinct from old.moderation_status
     and new.moderation_status = 'deferred' then
    new.deferred_at := now();
  elsif new.moderation_status is distinct from old.moderation_status
     and old.moderation_status = 'deferred'
     and new.moderation_status <> 'deferred' then
    new.deferred_at := null;
  end if;

  return new;
end;
$$;

revoke execute on function app_private.stamp_community_submission_review() from public, anon, authenticated;
