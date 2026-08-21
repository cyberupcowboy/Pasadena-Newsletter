create or replace function app_private.stamp_community_submission_review()
returns trigger
language plpgsql
set search_path = 'pg_catalog', 'public'
as $$
begin
  if new.moderation_status is distinct from old.moderation_status
     and new.moderation_status in ('approved','published') then
    if new.ai_processed_at is null
       or new.ai_editorial_recommendation is null
       or coalesce(new.ai_review_version, 0) < 2
       or new.ai_reprocess_requested_at is not null then
      raise exception 'Community submission requires a completed, current AI editorial review before publication';
    end if;

    new.reviewed_by := auth.uid();
    new.reviewed_at := now();
  end if;

  if new.moderation_status is distinct from old.moderation_status
     and new.moderation_status in ('approved','published')
     and new.published_at is null then
    new.published_at := now();
  end if;

  return new;
end;
$$;

revoke execute on function app_private.stamp_community_submission_review() from public, anon, authenticated;
