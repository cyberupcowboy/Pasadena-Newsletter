alter table public.events
  add column if not exists origin_submission_id uuid references public.community_submissions(id) on delete cascade;
create unique index if not exists events_origin_submission_uidx
  on public.events (origin_submission_id)
  where origin_submission_id is not null;

alter table public.businesses
  add column if not exists origin_submission_id uuid references public.community_submissions(id) on delete cascade;
create unique index if not exists businesses_origin_submission_uidx
  on public.businesses (origin_submission_id)
  where origin_submission_id is not null;

create or replace function app_private.sync_community_submission_destinations()
returns trigger
language plpgsql
security definer
set search_path = 'pg_catalog', 'public', 'app_private'
as $$
begin
  if new.submission_type in ('event','yard_sale') then
    if new.moderation_status in ('approved','published') and new.starts_at is not null then
      insert into public.events (
        origin_submission_id, title, description, venue_name, starts_at, ends_at,
        source_url, category, pasadena_relevance, editorial_status
      ) values (
        new.id,
        coalesce(nullif(trim(new.ai_cleaned_title), ''), trim(new.title)),
        coalesce(nullif(trim(new.ai_cleaned_description), ''), trim(coalesce(new.description, ''))),
        coalesce(nullif(trim(new.publication_location), ''), 'Pasadena area'),
        new.starts_at,
        new.ends_at,
        new.source_url,
        case when new.submission_type = 'yard_sale' then 'yard_sale' else 'community' end,
        100,
        'approved'
      )
      on conflict (origin_submission_id) do update set
        title = excluded.title,
        description = excluded.description,
        venue_name = excluded.venue_name,
        starts_at = excluded.starts_at,
        ends_at = excluded.ends_at,
        source_url = excluded.source_url,
        category = excluded.category,
        pasadena_relevance = excluded.pasadena_relevance,
        editorial_status = 'approved';
    else
      delete from public.events where origin_submission_id = new.id;
    end if;
  end if;

  if new.submission_type = 'business' then
    if new.moderation_status in ('approved','published') then
      insert into public.businesses (
        origin_submission_id, name, category, address, website, description,
        verified, sponsor_status, editorial_status, updated_at
      ) values (
        new.id,
        coalesce(nullif(trim(new.ai_cleaned_title), ''), trim(new.title)),
        'community_listing',
        nullif(trim(new.publication_location), ''),
        new.source_url,
        coalesce(nullif(trim(new.ai_cleaned_description), ''), trim(coalesce(new.description, ''))),
        false,
        'none',
        'approved',
        now()
      )
      on conflict (origin_submission_id) do update set
        name = excluded.name,
        address = excluded.address,
        website = excluded.website,
        description = excluded.description,
        editorial_status = 'approved',
        updated_at = now();
    else
      delete from public.businesses where origin_submission_id = new.id;
    end if;
  end if;

  return new;
end;
$$;

revoke execute on function app_private.sync_community_submission_destinations() from public, anon, authenticated;
drop trigger if exists community_submissions_sync_destinations on public.community_submissions;
create trigger community_submissions_sync_destinations
after insert or update on public.community_submissions
for each row execute function app_private.sync_community_submission_destinations();

-- Backfill already-approved event/business submissions without exposing raw submitter fields.
update public.community_submissions
set moderation_status = moderation_status
where moderation_status in ('approved','published')
  and submission_type in ('event','yard_sale','business');

create table if not exists public.comment_reports (
  id uuid primary key default gen_random_uuid(),
  comment_id uuid not null references public.community_comments(id) on delete cascade,
  reason text not null,
  status text not null default 'new',
  created_at timestamptz not null default now(),
  reviewed_by uuid references auth.users(id) on delete set null,
  reviewed_at timestamptz,
  resolution_note text,
  constraint comment_reports_reason_check check (char_length(trim(reason)) between 3 and 1000),
  constraint comment_reports_status_check check (status = any (array['new'::text,'reviewing'::text,'resolved'::text,'dismissed'::text]))
);

alter table public.comment_reports enable row level security;
revoke all on public.comment_reports from anon, authenticated;
grant insert (comment_id, reason) on public.comment_reports to anon, authenticated;
grant select, update on public.comment_reports to authenticated;

drop policy if exists "Readers can report public comments" on public.comment_reports;
create policy "Readers can report public comments"
  on public.comment_reports
  for insert
  to anon, authenticated
  with check (status = 'new' and exists (
    select 1 from public.community_comments c
    where c.id = comment_reports.comment_id and c.moderation_status = 'approved'
  ));

drop policy if exists "Editors can read comment reports" on public.comment_reports;
create policy "Editors can read comment reports"
  on public.comment_reports
  for select
  to authenticated
  using ((select app_private.is_editor()));

drop policy if exists "Editors can update comment reports" on public.comment_reports;
create policy "Editors can update comment reports"
  on public.comment_reports
  for update
  to authenticated
  using ((select app_private.is_editor()))
  with check ((select app_private.is_editor()));
