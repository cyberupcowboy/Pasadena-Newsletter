create extension if not exists pgcrypto;

create table public.locations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  location_type text not null check (location_type = any (array['neighborhood','community','city','county','state','national','other'])),
  parent_name text,
  latitude double precision,
  longitude double precision,
  radius_miles numeric,
  created_at timestamptz not null default now(),
  unique (name, location_type)
);

create table public.sources (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  source_type text not null check (source_type = any (array['official','news','community','social','manual','other'])),
  base_url text,
  rss_url text,
  trust_score integer not null default 50 check (trust_score between 0 and 100),
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.stories (
  id uuid primary key default gen_random_uuid(),
  source_id uuid references public.sources(id) on delete set null,
  external_id text,
  source_url text not null unique,
  source_title text,
  original_text text,
  ai_headline text,
  ai_summary text,
  category text,
  pasadena_relevance integer check (pasadena_relevance between 0 and 100),
  trust_score integer check (trust_score between 0 and 100),
  urgency integer not null default 0 check (urgency between 0 and 100),
  latitude double precision,
  longitude double precision,
  location_text text,
  published_at timestamptz,
  ingested_at timestamptz not null default now(),
  editorial_status text not null default 'new' check (editorial_status = any (array['new','review','approved','rejected','published','archived'])),
  review_notes text,
  published_to_facebook boolean not null default false,
  published_to_newsletter boolean not null default false
);

create table public.story_locations (
  story_id uuid not null references public.stories(id) on delete cascade,
  location_id uuid not null references public.locations(id) on delete cascade,
  primary key (story_id, location_id)
);

create table public.events (
  id uuid primary key default gen_random_uuid(),
  source_id uuid references public.sources(id) on delete set null,
  title text not null,
  description text,
  venue_name text,
  address text,
  latitude double precision,
  longitude double precision,
  starts_at timestamptz not null,
  ends_at timestamptz,
  source_url text,
  category text,
  pasadena_relevance integer check (pasadena_relevance between 0 and 100),
  editorial_status text not null default 'new' check (editorial_status = any (array['new','review','approved','rejected','published','archived'])),
  created_at timestamptz not null default now()
);

create table public.community_submissions (
  id uuid primary key default gen_random_uuid(),
  submission_type text not null check (submission_type = any (array['event','yard_sale','lost_found','business','community_notice','photo','tip','other'])),
  submitter_name text,
  submitter_email text,
  submitter_phone text,
  title text not null,
  description text,
  address text,
  starts_at timestamptz,
  ends_at timestamptz,
  source_url text,
  moderation_status text not null default 'pending' check (moderation_status = any (array['pending','approved','rejected','published'])),
  ai_cleaned_title text,
  ai_cleaned_description text,
  created_at timestamptz not null default now()
);

create table public.businesses (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  category text,
  address text,
  website text,
  phone text,
  latitude double precision,
  longitude double precision,
  verified boolean not null default false,
  sponsor_status text not null default 'none' check (sponsor_status = any (array['none','prospect','active','paused'])),
  created_at timestamptz not null default now()
);

alter table public.locations enable row level security;
alter table public.sources enable row level security;
alter table public.stories enable row level security;
alter table public.story_locations enable row level security;
alter table public.events enable row level security;
alter table public.community_submissions enable row level security;
alter table public.businesses enable row level security;

revoke all on table public.locations from anon, authenticated;
revoke all on table public.sources from anon, authenticated;
revoke all on table public.stories from anon, authenticated;
revoke all on table public.story_locations from anon, authenticated;
revoke all on table public.events from anon, authenticated;
revoke all on table public.community_submissions from anon, authenticated;
revoke all on table public.businesses from anon, authenticated;
