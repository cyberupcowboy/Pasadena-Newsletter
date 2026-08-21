create or replace function app_private.ensure_story_transparency()
returns trigger
language plpgsql
security definer
set search_path = 'pg_catalog', 'public', 'app_private'
as $$
begin
  if new.editorial_status in ('approved','published') then
    insert into public.story_transparency (
      story_id,
      editorial_origin,
      public_byline,
      ai_assisted,
      how_reported,
      why_it_matters,
      neighborhood,
      topic_key,
      updated_at
    ) values (
      new.id,
      'aggregated_source',
      'Pasadena Current Desk',
      true,
      'The Pasadena Current summarized and linked this source report. AI assisted with the brief, and a human editor reviewed it before publication.',
      nullif(trim(new.relevance_reason), ''),
      nullif(trim(new.location_text), ''),
      lower(trim(both '-' from regexp_replace(coalesce(new.category, 'local'), '[^a-zA-Z0-9]+', '-', 'g'))),
      now()
    )
    on conflict (story_id) do update set
      why_it_matters = coalesce(public.story_transparency.why_it_matters, excluded.why_it_matters),
      neighborhood = coalesce(public.story_transparency.neighborhood, excluded.neighborhood),
      topic_key = coalesce(public.story_transparency.topic_key, excluded.topic_key),
      updated_at = now();
  end if;
  return new;
end;
$$;

revoke execute on function app_private.ensure_story_transparency() from public, anon, authenticated;
drop trigger if exists stories_ensure_transparency on public.stories;
create trigger stories_ensure_transparency
after insert or update of editorial_status, relevance_reason, location_text, category on public.stories
for each row execute function app_private.ensure_story_transparency();
