create table if not exists public.published_stories (
  story_id uuid primary key references public.stories(id) on delete cascade,
  source_url text not null,
  source_title text,
  headline text not null,
  summary text,
  category text,
  pasadena_relevance integer check (pasadena_relevance between 0 and 100),
  urgency integer not null default 0 check (urgency between 0 and 100),
  location_text text,
  source_published_at timestamptz,
  approved_at timestamptz,
  updated_at timestamptz not null default now()
);

alter table public.published_stories enable row level security;
revoke all on table public.published_stories from anon, authenticated;
grant select on table public.published_stories to anon, authenticated;

drop policy if exists "Public can read published stories" on public.published_stories;
create policy "Public can read published stories"
on public.published_stories
for select
to anon, authenticated
using (true);

create index if not exists published_stories_approved_at_idx
  on public.published_stories (approved_at desc nulls last);
create index if not exists published_stories_category_idx
  on public.published_stories (category);

create or replace function app_private.sync_published_story()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, app_private
as $$
begin
  if new.editorial_status in ('approved', 'published') then
    insert into public.published_stories (
      story_id, source_url, source_title, headline, summary, category,
      pasadena_relevance, urgency, location_text, source_published_at,
      approved_at, updated_at
    ) values (
      new.id,
      new.source_url,
      new.source_title,
      coalesce(nullif(new.ai_headline, ''), nullif(new.source_title, ''), 'Untitled story'),
      new.ai_summary,
      new.category,
      new.pasadena_relevance,
      new.urgency,
      new.location_text,
      new.published_at,
      new.reviewed_at,
      now()
    )
    on conflict (story_id) do update set
      source_url = excluded.source_url,
      source_title = excluded.source_title,
      headline = excluded.headline,
      summary = excluded.summary,
      category = excluded.category,
      pasadena_relevance = excluded.pasadena_relevance,
      urgency = excluded.urgency,
      location_text = excluded.location_text,
      source_published_at = excluded.source_published_at,
      approved_at = excluded.approved_at,
      updated_at = now();
  else
    delete from public.published_stories where story_id = new.id;
  end if;

  return new;
end;
$$;

revoke all on function app_private.sync_published_story() from public, anon, authenticated;

drop trigger if exists stories_sync_published on public.stories;
create trigger stories_sync_published
after insert or update of editorial_status, ai_headline, ai_summary, category,
  pasadena_relevance, urgency, location_text, source_url, source_title,
  published_at, reviewed_at
on public.stories
for each row
execute function app_private.sync_published_story();

insert into public.published_stories (
  story_id, source_url, source_title, headline, summary, category,
  pasadena_relevance, urgency, location_text, source_published_at,
  approved_at, updated_at
)
select
  s.id,
  s.source_url,
  s.source_title,
  coalesce(nullif(s.ai_headline, ''), nullif(s.source_title, ''), 'Untitled story'),
  s.ai_summary,
  s.category,
  s.pasadena_relevance,
  s.urgency,
  s.location_text,
  s.published_at,
  s.reviewed_at,
  now()
from public.stories s
where s.editorial_status in ('approved', 'published')
on conflict (story_id) do update set
  source_url = excluded.source_url,
  source_title = excluded.source_title,
  headline = excluded.headline,
  summary = excluded.summary,
  category = excluded.category,
  pasadena_relevance = excluded.pasadena_relevance,
  urgency = excluded.urgency,
  location_text = excluded.location_text,
  source_published_at = excluded.source_published_at,
  approved_at = excluded.approved_at,
  updated_at = now();
