alter table public.stories
  add column if not exists ai_model text,
  add column if not exists ai_processed_at timestamptz,
  add column if not exists relevance_reason text;

create index if not exists stories_source_id_idx on public.stories(source_id);
create index if not exists events_source_id_idx on public.events(source_id);
create index if not exists story_locations_location_id_idx on public.story_locations(location_id);
