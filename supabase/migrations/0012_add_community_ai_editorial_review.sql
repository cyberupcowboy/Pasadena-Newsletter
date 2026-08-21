alter table public.community_submissions
  add column if not exists ai_fact_check_summary text,
  add column if not exists ai_fact_checks jsonb not null default '[]'::jsonb,
  add column if not exists ai_fact_check_sources jsonb not null default '[]'::jsonb,
  add column if not exists ai_civility_assessment text,
  add column if not exists ai_harm_assessment text,
  add column if not exists ai_editorial_recommendation text,
  add column if not exists ai_reprocess_requested_at timestamptz,
  add column if not exists ai_review_version integer not null default 0;

alter table public.community_submissions
  drop constraint if exists community_submissions_ai_editorial_recommendation_check,
  drop constraint if exists community_submissions_ai_review_version_check;

alter table public.community_submissions
  add constraint community_submissions_ai_editorial_recommendation_check
    check (
      ai_editorial_recommendation is null
      or ai_editorial_recommendation = any (array[
        'publishable'::text,
        'publishable_with_edits'::text,
        'hold_for_verification'::text,
        'do_not_publish'::text
      ])
    ),
  add constraint community_submissions_ai_review_version_check
    check (ai_review_version >= 0);

create index if not exists community_submissions_ai_reprocess_idx
  on public.community_submissions (ai_reprocess_requested_at)
  where ai_reprocess_requested_at is not null;

create or replace function app_private.stamp_community_submission_review()
returns trigger
language plpgsql
set search_path = 'pg_catalog', 'public'
as $$
begin
  if new.moderation_status is distinct from old.moderation_status
     and new.moderation_status in ('approved','published') then
    if new.ai_processed_at is null or new.ai_editorial_recommendation is null then
      raise exception 'Community submission requires completed AI editorial review before publication';
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
