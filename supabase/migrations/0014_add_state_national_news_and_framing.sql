alter table public.stories
  add column if not exists content_scope text not null default 'local',
  add column if not exists political_content boolean not null default false,
  add column if not exists political_slant text,
  add column if not exists political_slant_confidence integer,
  add column if not exists political_slant_reason text;

alter table public.stories
  drop constraint if exists stories_content_scope_check,
  drop constraint if exists stories_political_slant_check,
  drop constraint if exists stories_political_slant_confidence_check;

alter table public.stories
  add constraint stories_content_scope_check
    check (content_scope = any (array['local'::text,'state'::text,'national'::text])),
  add constraint stories_political_slant_check
    check (political_slant is null or political_slant = any (array['left'::text,'center'::text,'right'::text,'mixed'::text,'unclear'::text,'not_political'::text])),
  add constraint stories_political_slant_confidence_check
    check (political_slant_confidence is null or political_slant_confidence between 0 and 100);

create index if not exists stories_content_scope_status_idx
  on public.stories (content_scope, editorial_status, published_at desc nulls last);

alter table public.published_stories
  add column if not exists content_scope text not null default 'local',
  add column if not exists political_content boolean not null default false,
  add column if not exists political_slant text,
  add column if not exists political_slant_confidence integer,
  add column if not exists political_slant_reason text;

alter table public.published_stories
  drop constraint if exists published_stories_content_scope_check,
  drop constraint if exists published_stories_political_slant_check,
  drop constraint if exists published_stories_political_slant_confidence_check;

alter table public.published_stories
  add constraint published_stories_content_scope_check
    check (content_scope = any (array['local'::text,'state'::text,'national'::text])),
  add constraint published_stories_political_slant_check
    check (political_slant is null or political_slant = any (array['left'::text,'center'::text,'right'::text,'mixed'::text,'unclear'::text,'not_political'::text])),
  add constraint published_stories_political_slant_confidence_check
    check (political_slant_confidence is null or political_slant_confidence between 0 and 100);

create index if not exists published_stories_scope_date_idx
  on public.published_stories (content_scope, source_published_at desc nulls last);

insert into public.sources (name, source_type, base_url, trust_score, active)
select v.name, 'news', v.base_url, v.trust_score, true
from (values
  ('Maryland Matters', 'https://marylandmatters.org', 92),
  ('WBAL-TV 11', 'https://www.wbaltv.com', 90),
  ('FOX45 Baltimore', 'https://foxbaltimore.com', 84),
  ('WTOP News', 'https://wtop.com', 90),
  ('Associated Press', 'https://apnews.com', 96),
  ('Reuters', 'https://www.reuters.com', 96),
  ('NPR', 'https://www.npr.org', 90),
  ('Fox News', 'https://www.foxnews.com', 84),
  ('CNN', 'https://www.cnn.com', 86),
  ('The Hill', 'https://thehill.com', 88)
) as v(name, base_url, trust_score)
where not exists (
  select 1 from public.sources s where lower(s.name) = lower(v.name)
);

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
      approved_at, updated_at, content_scope, political_content,
      political_slant, political_slant_confidence, political_slant_reason
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
      now(),
      new.content_scope,
      new.political_content,
      new.political_slant,
      new.political_slant_confidence,
      new.political_slant_reason
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
      content_scope = excluded.content_scope,
      political_content = excluded.political_content,
      political_slant = excluded.political_slant,
      political_slant_confidence = excluded.political_slant_confidence,
      political_slant_reason = excluded.political_slant_reason,
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
  published_at, reviewed_at, content_scope, political_content,
  political_slant, political_slant_confidence, political_slant_reason
on public.stories
for each row
execute function app_private.sync_published_story();

update public.published_stories ps
set content_scope = s.content_scope,
    political_content = s.political_content,
    political_slant = s.political_slant,
    political_slant_confidence = s.political_slant_confidence,
    political_slant_reason = s.political_slant_reason,
    updated_at = now()
from public.stories s
where s.id = ps.story_id;
