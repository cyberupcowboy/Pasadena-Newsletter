-- Community information system foundations for The Pasadena Current.
-- Adds public transparency, corrections intake, subscriptions, neighborhoods,
-- business-directory publishing, moderated comments, newsletter drafts, and public search.

create table if not exists public.story_transparency (
  story_id uuid primary key references public.stories(id) on delete cascade,
  editorial_origin text not null default 'aggregated_source',
  public_byline text not null default 'Pasadena Current Desk',
  ai_assisted boolean not null default true,
  how_reported text,
  why_it_matters text,
  neighborhood text,
  topic_key text,
  correction_note text,
  correction_at timestamptz,
  updated_at timestamptz not null default now(),
  constraint story_transparency_origin_check check (
    editorial_origin = any (array[
      'aggregated_source'::text,
      'staff_report'::text,
      'press_release'::text,
      'community_submission'::text,
      'public_record'::text,
      'other'::text
    ])
  )
);

alter table public.story_transparency enable row level security;
revoke all on table public.story_transparency from anon, authenticated;
grant select on table public.story_transparency to anon, authenticated;
grant insert, update on table public.story_transparency to authenticated;

drop policy if exists "Public can read transparency for published stories" on public.story_transparency;
create policy "Public can read transparency for published stories"
  on public.story_transparency
  for select
  to anon, authenticated
  using (exists (
    select 1 from public.published_stories p where p.story_id = story_transparency.story_id
  ));

drop policy if exists "Editors can read all story transparency" on public.story_transparency;
create policy "Editors can read all story transparency"
  on public.story_transparency
  for select
  to authenticated
  using ((select app_private.is_editor()));

drop policy if exists "Editors can insert story transparency" on public.story_transparency;
create policy "Editors can insert story transparency"
  on public.story_transparency
  for insert
  to authenticated
  with check ((select app_private.is_editor()));

drop policy if exists "Editors can update story transparency" on public.story_transparency;
create policy "Editors can update story transparency"
  on public.story_transparency
  for update
  to authenticated
  using ((select app_private.is_editor()))
  with check ((select app_private.is_editor()));

insert into public.story_transparency (
  story_id, editorial_origin, public_byline, ai_assisted, how_reported,
  why_it_matters, neighborhood, topic_key
)
select
  s.id,
  'aggregated_source',
  'Pasadena Current Desk',
  true,
  'The Pasadena Current summarized and linked this source report. AI assisted with the local brief, and a human editor reviewed it before publication.',
  nullif(trim(s.relevance_reason), ''),
  nullif(trim(s.location_text), ''),
  lower(trim(both '-' from regexp_replace(coalesce(s.category, 'local'), '[^a-zA-Z0-9]+', '-', 'g')))
from public.stories s
where s.editorial_status in ('approved','published')
on conflict (story_id) do nothing;

create table if not exists public.reader_error_reports (
  id uuid primary key default gen_random_uuid(),
  story_id uuid not null references public.stories(id) on delete cascade,
  reporter_email text,
  message text not null,
  status text not null default 'new',
  resolution_note text,
  reviewed_by uuid references auth.users(id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  constraint reader_error_reports_status_check check (status = any (array['new'::text,'reviewing'::text,'resolved'::text,'dismissed'::text])),
  constraint reader_error_reports_message_check check (char_length(trim(message)) between 10 and 4000),
  constraint reader_error_reports_email_check check (reporter_email is null or char_length(trim(reporter_email)) between 5 and 254)
);

alter table public.reader_error_reports enable row level security;
revoke all on table public.reader_error_reports from anon, authenticated;
grant insert (story_id, reporter_email, message) on public.reader_error_reports to anon, authenticated;
grant select, update on public.reader_error_reports to authenticated;

drop policy if exists "Readers can report errors on published stories" on public.reader_error_reports;
create policy "Readers can report errors on published stories"
  on public.reader_error_reports
  for insert
  to anon, authenticated
  with check (
    status = 'new'
    and exists (select 1 from public.published_stories p where p.story_id = reader_error_reports.story_id)
  );

drop policy if exists "Editors can read error reports" on public.reader_error_reports;
create policy "Editors can read error reports"
  on public.reader_error_reports
  for select
  to authenticated
  using ((select app_private.is_editor()));

drop policy if exists "Editors can update error reports" on public.reader_error_reports;
create policy "Editors can update error reports"
  on public.reader_error_reports
  for update
  to authenticated
  using ((select app_private.is_editor()))
  with check ((select app_private.is_editor()));

create table if not exists public.alert_subscriptions (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  categories text[] not null default '{}'::text[],
  neighborhoods text[] not null default '{}'::text[],
  cadence text not null default 'daily',
  consent boolean not null default false,
  status text not null default 'pending',
  source text not null default 'website',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint alert_subscriptions_cadence_check check (cadence = any (array['breaking'::text,'daily'::text,'weekly'::text])),
  constraint alert_subscriptions_status_check check (status = any (array['pending'::text,'active'::text,'unsubscribed'::text])),
  constraint alert_subscriptions_email_check check (char_length(trim(email)) between 5 and 254 and position('@' in email) > 1)
);

create unique index if not exists alert_subscriptions_email_cadence_uidx
  on public.alert_subscriptions (lower(email), cadence);

alter table public.alert_subscriptions enable row level security;
revoke all on table public.alert_subscriptions from anon, authenticated;
grant insert (email, categories, neighborhoods, cadence, consent, source) on public.alert_subscriptions to anon, authenticated;
grant select, update on public.alert_subscriptions to authenticated;

drop policy if exists "Readers can request alert subscriptions" on public.alert_subscriptions;
create policy "Readers can request alert subscriptions"
  on public.alert_subscriptions
  for insert
  to anon, authenticated
  with check (status = 'pending' and consent = true);

drop policy if exists "Editors can read alert subscriptions" on public.alert_subscriptions;
create policy "Editors can read alert subscriptions"
  on public.alert_subscriptions
  for select
  to authenticated
  using ((select app_private.is_editor()));

drop policy if exists "Editors can update alert subscriptions" on public.alert_subscriptions;
create policy "Editors can update alert subscriptions"
  on public.alert_subscriptions
  for update
  to authenticated
  using ((select app_private.is_editor()))
  with check ((select app_private.is_editor()));

create table if not exists public.neighborhoods (
  slug text primary key,
  name text not null,
  description text,
  sort_order integer not null default 100,
  active boolean not null default true
);

alter table public.neighborhoods enable row level security;
revoke all on table public.neighborhoods from anon, authenticated;
grant select on public.neighborhoods to anon, authenticated;
grant insert, update, delete on public.neighborhoods to authenticated;

drop policy if exists "Public can read active neighborhoods" on public.neighborhoods;
create policy "Public can read active neighborhoods"
  on public.neighborhoods
  for select
  to anon, authenticated
  using (active = true);

drop policy if exists "Editors manage neighborhoods" on public.neighborhoods;
create policy "Editors manage neighborhoods"
  on public.neighborhoods
  for all
  to authenticated
  using ((select app_private.is_editor()))
  with check ((select app_private.is_editor()));

insert into public.neighborhoods (slug, name, description, sort_order) values
  ('pasadena','Pasadena','Community-wide coverage around 21122.',10),
  ('lake-shore','Lake Shore','News, events and neighborhood updates around Lake Shore.',20),
  ('riviera-beach','Riviera Beach','News and community life around Riviera Beach.',30),
  ('green-haven','Green Haven','Neighborhood updates from Green Haven.',40),
  ('jacobsville','Jacobsville','Neighborhood updates from Jacobsville.',50),
  ('gibson-island','Gibson Island','Community and waterfront coverage around Gibson Island.',60),
  ('severna-park','Severna Park','Nearby Severna Park stories that affect Pasadena readers.',70),
  ('glen-burnie','Glen Burnie','Nearby Glen Burnie stories that affect Pasadena readers.',80)
on conflict (slug) do update set
  name = excluded.name,
  description = excluded.description,
  sort_order = excluded.sort_order,
  active = true;

alter table public.businesses
  add column if not exists description text,
  add column if not exists hours_text text,
  add column if not exists photo_url text,
  add column if not exists specials text,
  add column if not exists editorial_status text not null default 'draft',
  add column if not exists updated_at timestamptz not null default now();

alter table public.businesses
  drop constraint if exists businesses_editorial_status_check;
alter table public.businesses
  add constraint businesses_editorial_status_check
    check (editorial_status = any (array['draft'::text,'approved'::text,'archived'::text]));

revoke all on table public.businesses from anon, authenticated;
grant select on public.businesses to anon, authenticated;
grant insert, update, delete on public.businesses to authenticated;

drop policy if exists "Public can read approved businesses" on public.businesses;
create policy "Public can read approved businesses"
  on public.businesses
  for select
  to anon, authenticated
  using (editorial_status = 'approved');

drop policy if exists "Editors can read all businesses" on public.businesses;
create policy "Editors can read all businesses"
  on public.businesses
  for select
  to authenticated
  using ((select app_private.is_editor()));

drop policy if exists "Editors manage businesses" on public.businesses;
create policy "Editors manage businesses"
  on public.businesses
  for all
  to authenticated
  using ((select app_private.is_editor()))
  with check ((select app_private.is_editor()));

create table if not exists public.community_comments (
  id uuid primary key default gen_random_uuid(),
  story_id uuid references public.stories(id) on delete cascade,
  community_submission_id uuid references public.community_submissions(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  display_name text not null,
  body text not null,
  moderation_status text not null default 'pending',
  ai_risk_score integer,
  ai_risk_flags jsonb not null default '[]'::jsonb,
  ai_moderation_reason text,
  ai_processed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint community_comments_target_check check ((story_id is not null) <> (community_submission_id is not null)),
  constraint community_comments_status_check check (moderation_status = any (array['pending'::text,'approved'::text,'review'::text,'rejected'::text])),
  constraint community_comments_name_check check (char_length(trim(display_name)) between 2 and 60),
  constraint community_comments_body_check check (char_length(trim(body)) between 2 and 3000),
  constraint community_comments_risk_check check (ai_risk_score is null or ai_risk_score between 0 and 100)
);

create index if not exists community_comments_story_created_idx on public.community_comments (story_id, created_at desc);
create index if not exists community_comments_status_created_idx on public.community_comments (moderation_status, created_at);
create index if not exists community_comments_user_created_idx on public.community_comments (user_id, created_at desc);

alter table public.community_comments enable row level security;
revoke all on table public.community_comments from anon, authenticated;
grant select on public.community_comments to anon, authenticated;
grant insert (story_id, community_submission_id, user_id, display_name, body) on public.community_comments to authenticated;
grant update on public.community_comments to authenticated;

drop policy if exists "Public can read approved comments" on public.community_comments;
create policy "Public can read approved comments"
  on public.community_comments
  for select
  to anon, authenticated
  using (moderation_status = 'approved');

drop policy if exists "Members can read their own comments" on public.community_comments;
create policy "Members can read their own comments"
  on public.community_comments
  for select
  to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "Members can submit comments" on public.community_comments;
create policy "Members can submit comments"
  on public.community_comments
  for insert
  to authenticated
  with check (
    (select auth.uid()) = user_id
    and moderation_status = 'pending'
    and (
      (story_id is not null and exists (select 1 from public.published_stories p where p.story_id = community_comments.story_id))
      or
      (community_submission_id is not null and exists (select 1 from public.published_community_submissions c where c.submission_id = community_comments.community_submission_id))
    )
  );

drop policy if exists "Editors can read all comments" on public.community_comments;
create policy "Editors can read all comments"
  on public.community_comments
  for select
  to authenticated
  using ((select app_private.is_editor()));

drop policy if exists "Editors can moderate comments" on public.community_comments;
create policy "Editors can moderate comments"
  on public.community_comments
  for update
  to authenticated
  using ((select app_private.is_editor()))
  with check ((select app_private.is_editor()));

create or replace function app_private.enforce_comment_rate_limit()
returns trigger
language plpgsql
security definer
set search_path = 'pg_catalog', 'public', 'app_private'
as $$
begin
  if auth.uid() is null or auth.uid() <> new.user_id then
    raise exception 'Authenticated user mismatch';
  end if;

  if exists (
    select 1
    from public.community_comments c
    where c.user_id = new.user_id
      and c.created_at > now() - interval '60 seconds'
  ) then
    raise exception 'Please wait at least 60 seconds between comments';
  end if;

  return new;
end;
$$;

revoke execute on function app_private.enforce_comment_rate_limit() from public, anon, authenticated;
drop trigger if exists community_comments_rate_limit on public.community_comments;
create trigger community_comments_rate_limit
before insert on public.community_comments
for each row execute function app_private.enforce_comment_rate_limit();

create table if not exists public.newsletter_editions (
  id uuid primary key default gen_random_uuid(),
  edition_type text not null,
  issue_date date not null,
  subject text not null,
  body text not null,
  status text not null default 'draft',
  generated_at timestamptz not null default now(),
  approved_at timestamptz,
  sent_at timestamptz,
  constraint newsletter_editions_type_check check (edition_type = any (array['morning'::text,'week_ahead'::text])),
  constraint newsletter_editions_status_check check (status = any (array['draft'::text,'approved'::text,'sent'::text,'archived'::text])),
  unique (edition_type, issue_date)
);

alter table public.newsletter_editions enable row level security;
revoke all on table public.newsletter_editions from anon, authenticated;
grant select, insert, update on public.newsletter_editions to authenticated;

drop policy if exists "Editors manage newsletter editions" on public.newsletter_editions;
create policy "Editors manage newsletter editions"
  on public.newsletter_editions
  for all
  to authenticated
  using ((select app_private.is_editor()))
  with check ((select app_private.is_editor()));

create or replace function public.search_current(search_text text, result_limit integer default 25)
returns table (
  kind text,
  item_id text,
  title text,
  summary text,
  category text,
  location_text text,
  occurred_at timestamptz,
  source_url text,
  rank real
)
language sql
stable
security invoker
set search_path = 'pg_catalog', 'public'
as $$
  with q as (
    select websearch_to_tsquery('english', trim(search_text)) as query
    where char_length(trim(search_text)) >= 2
  ), results as (
    select
      'story'::text as kind,
      p.story_id::text as item_id,
      p.headline as title,
      p.summary,
      p.category,
      coalesce(t.neighborhood, p.location_text) as location_text,
      coalesce(p.source_published_at, p.approved_at) as occurred_at,
      p.source_url,
      ts_rank_cd(
        to_tsvector('english', coalesce(p.headline,'') || ' ' || coalesce(p.summary,'') || ' ' || coalesce(p.location_text,'') || ' ' || coalesce(t.why_it_matters,'')),
        q.query
      ) as rank
    from public.published_stories p
    cross join q
    left join public.story_transparency t on t.story_id = p.story_id
    where to_tsvector('english', coalesce(p.headline,'') || ' ' || coalesce(p.summary,'') || ' ' || coalesce(p.location_text,'') || ' ' || coalesce(t.why_it_matters,'')) @@ q.query

    union all

    select
      'community'::text,
      c.submission_id::text,
      c.headline,
      left(c.body, 500),
      c.submission_type,
      c.location_text,
      c.published_at,
      c.source_url,
      ts_rank_cd(
        to_tsvector('english', coalesce(c.headline,'') || ' ' || coalesce(c.body,'') || ' ' || coalesce(c.location_text,'')),
        q.query
      )
    from public.published_community_submissions c
    cross join q
    where to_tsvector('english', coalesce(c.headline,'') || ' ' || coalesce(c.body,'') || ' ' || coalesce(c.location_text,'')) @@ q.query

    union all

    select
      'event'::text,
      e.id::text,
      e.title,
      e.description,
      e.category,
      coalesce(e.venue_name, e.address),
      e.starts_at,
      e.source_url,
      ts_rank_cd(
        to_tsvector('english', coalesce(e.title,'') || ' ' || coalesce(e.description,'') || ' ' || coalesce(e.venue_name,'') || ' ' || coalesce(e.address,'')),
        q.query
      )
    from public.events e
    cross join q
    where e.editorial_status = 'approved'
      and to_tsvector('english', coalesce(e.title,'') || ' ' || coalesce(e.description,'') || ' ' || coalesce(e.venue_name,'') || ' ' || coalesce(e.address,'')) @@ q.query

    union all

    select
      'business'::text,
      b.id::text,
      b.name,
      b.description,
      b.category,
      b.address,
      b.updated_at,
      b.website,
      ts_rank_cd(
        to_tsvector('english', coalesce(b.name,'') || ' ' || coalesce(b.description,'') || ' ' || coalesce(b.category,'') || ' ' || coalesce(b.address,'')),
        q.query
      )
    from public.businesses b
    cross join q
    where b.editorial_status = 'approved'
      and to_tsvector('english', coalesce(b.name,'') || ' ' || coalesce(b.description,'') || ' ' || coalesce(b.category,'') || ' ' || coalesce(b.address,'')) @@ q.query
  )
  select r.kind, r.item_id, r.title, r.summary, r.category, r.location_text, r.occurred_at, r.source_url, r.rank
  from results r
  order by r.rank desc, r.occurred_at desc nulls last
  limit greatest(1, least(coalesce(result_limit, 25), 50));
$$;

revoke execute on function public.search_current(text, integer) from public;
grant execute on function public.search_current(text, integer) to anon, authenticated;
