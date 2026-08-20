alter table public.community_submissions
  drop constraint if exists community_submissions_submission_type_check,
  drop constraint if exists community_submissions_moderation_status_check;

alter table public.community_submissions
  add constraint community_submissions_submission_type_check
    check (submission_type = any (array[
      'news_report'::text,
      'opinion'::text,
      'event'::text,
      'yard_sale'::text,
      'lost_found'::text,
      'business'::text,
      'community_notice'::text,
      'photo'::text,
      'tip'::text,
      'other'::text
    ])),
  add constraint community_submissions_moderation_status_check
    check (moderation_status = any (array[
      'pending'::text,
      'review'::text,
      'approved'::text,
      'rejected'::text,
      'published'::text
    ]));

alter table public.community_submissions
  add column if not exists byline_preference text not null default 'full_name',
  add column if not exists consent_to_publish boolean not null default false,
  add column if not exists ai_editor_notes text,
  add column if not exists ai_risk_level integer,
  add column if not exists ai_risk_flags jsonb not null default '[]'::jsonb,
  add column if not exists ai_model text,
  add column if not exists ai_processed_at timestamptz,
  add column if not exists moderator_notes text,
  add column if not exists editor_byline text,
  add column if not exists publication_location text,
  add column if not exists reviewed_by uuid references auth.users(id) on delete set null,
  add column if not exists reviewed_at timestamptz,
  add column if not exists published_at timestamptz;

alter table public.community_submissions
  drop constraint if exists community_submissions_byline_preference_check,
  drop constraint if exists community_submissions_ai_risk_level_check;

alter table public.community_submissions
  add constraint community_submissions_byline_preference_check
    check (byline_preference = any (array['full_name'::text,'first_name_last_initial'::text,'anonymous'::text])),
  add constraint community_submissions_ai_risk_level_check
    check (ai_risk_level is null or (ai_risk_level between 0 and 100));

create index if not exists community_submissions_moderation_created_idx
  on public.community_submissions (moderation_status, created_at desc);
create index if not exists community_submissions_reviewed_by_idx
  on public.community_submissions (reviewed_by);

create table if not exists public.published_community_submissions (
  submission_id uuid primary key references public.community_submissions(id) on delete cascade,
  submission_type text not null,
  byline text not null,
  headline text not null,
  body text not null,
  location_text text,
  source_url text,
  published_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.published_community_submissions enable row level security;

revoke all on table public.community_submissions from anon, authenticated;
revoke all on table public.published_community_submissions from anon, authenticated;

grant insert (
  submission_type,
  submitter_name,
  submitter_email,
  title,
  description,
  address,
  starts_at,
  ends_at,
  source_url,
  byline_preference,
  consent_to_publish
) on public.community_submissions to anon;

grant select, update on public.community_submissions to authenticated;
grant select on public.published_community_submissions to anon, authenticated;

drop policy if exists "Public can submit community items" on public.community_submissions;
create policy "Public can submit community items"
  on public.community_submissions
  for insert
  to anon
  with check (
    moderation_status = 'pending'
    and consent_to_publish = true
    and char_length(trim(coalesce(submitter_name, ''))) between 2 and 120
    and char_length(trim(coalesce(submitter_email, ''))) between 5 and 254
    and position('@' in coalesce(submitter_email, '')) > 1
    and char_length(trim(title)) between 5 and 180
    and char_length(trim(coalesce(description, ''))) between 40 and 8000
    and byline_preference = any (array['full_name'::text,'first_name_last_initial'::text,'anonymous'::text])
  );

drop policy if exists "Editors can read community submissions" on public.community_submissions;
create policy "Editors can read community submissions"
  on public.community_submissions
  for select
  to authenticated
  using ((select app_private.is_editor()));

drop policy if exists "Editors can update community submissions" on public.community_submissions;
create policy "Editors can update community submissions"
  on public.community_submissions
  for update
  to authenticated
  using ((select app_private.is_editor()))
  with check ((select app_private.is_editor()));

drop policy if exists "Public can read published community voices" on public.published_community_submissions;
create policy "Public can read published community voices"
  on public.published_community_submissions
  for select
  to anon, authenticated
  using (true);

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

  return new;
end;
$$;

create or replace function app_private.sync_published_community_submission()
returns trigger
language plpgsql
security definer
set search_path = 'pg_catalog', 'public', 'app_private'
as $$
declare
  generated_byline text;
  trimmed_name text;
  last_word text;
begin
  if new.moderation_status in ('approved','published') then
    trimmed_name := trim(coalesce(new.submitter_name, ''));
    last_word := regexp_replace(trimmed_name, '^.*[[:space:]]', '');

    generated_byline := case new.byline_preference
      when 'anonymous' then 'Anonymous Pasadena resident'
      when 'first_name_last_initial' then
        trim(split_part(trimmed_name, ' ', 1) ||
          case when position(' ' in trimmed_name) > 0 then ' ' || left(last_word, 1) || '.' else '' end)
      else coalesce(nullif(trimmed_name, ''), 'Pasadena community member')
    end;

    insert into public.published_community_submissions (
      submission_id,
      submission_type,
      byline,
      headline,
      body,
      location_text,
      source_url,
      published_at,
      updated_at
    ) values (
      new.id,
      new.submission_type,
      coalesce(nullif(trim(new.editor_byline), ''), generated_byline),
      coalesce(nullif(trim(new.ai_cleaned_title), ''), trim(new.title)),
      coalesce(nullif(trim(new.ai_cleaned_description), ''), trim(coalesce(new.description, ''))),
      nullif(trim(new.publication_location), ''),
      new.source_url,
      coalesce(new.published_at, now()),
      now()
    )
    on conflict (submission_id) do update set
      submission_type = excluded.submission_type,
      byline = excluded.byline,
      headline = excluded.headline,
      body = excluded.body,
      location_text = excluded.location_text,
      source_url = excluded.source_url,
      published_at = excluded.published_at,
      updated_at = now();
  else
    delete from public.published_community_submissions where submission_id = new.id;
  end if;

  return new;
end;
$$;

revoke execute on function app_private.stamp_community_submission_review() from public, anon, authenticated;
revoke execute on function app_private.sync_published_community_submission() from public, anon, authenticated;

drop trigger if exists community_submissions_stamp_review on public.community_submissions;
create trigger community_submissions_stamp_review
before update on public.community_submissions
for each row execute function app_private.stamp_community_submission_review();

drop trigger if exists community_submissions_sync_public on public.community_submissions;
create trigger community_submissions_sync_public
after update on public.community_submissions
for each row execute function app_private.sync_published_community_submission();
