create table if not exists public.traffic_events (
  source_event_id text primary key,
  source_id uuid references public.sources(id) on delete set null,
  description text not null,
  incident_type text,
  county text,
  direction text,
  lanes_status text,
  traffic_alert boolean not null default false,
  traffic_alert_text text,
  latitude double precision,
  longitude double precision,
  start_at timestamptz,
  last_seen_at timestamptz not null default now(),
  source_url text not null default 'https://chart.maryland.gov/Incidents/GetIncidents',
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create index if not exists traffic_events_active_seen_idx
  on public.traffic_events(active, last_seen_at desc);

alter table public.traffic_events enable row level security;
revoke all on table public.traffic_events from anon, authenticated;
grant select on table public.traffic_events to anon, authenticated;

drop policy if exists "Public can read current traffic events" on public.traffic_events;
create policy "Public can read current traffic events"
on public.traffic_events
for select
to anon, authenticated
using (active and last_seen_at >= now() - interval '45 minutes');

create unique index if not exists events_source_title_starts_venue_uidx
  on public.events(source_id, title, starts_at, venue_name);

grant select on table public.events to anon, authenticated;
drop policy if exists "Public can read approved upcoming events" on public.events;
create policy "Public can read approved upcoming events"
on public.events
for select
to anon, authenticated
using (
  editorial_status = 'approved'
  and coalesce(ends_at, starts_at) >= now() - interval '6 hours'
);
