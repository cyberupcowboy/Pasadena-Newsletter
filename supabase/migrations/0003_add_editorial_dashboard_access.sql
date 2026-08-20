create schema if not exists app_private;
revoke all on schema app_private from public;

grant usage on schema app_private to authenticated;

create table if not exists app_private.editor_members (
  user_id uuid primary key references auth.users(id) on delete cascade,
  role text not null default 'editor' check (role in ('editor','admin')),
  active boolean not null default true,
  created_at timestamptz not null default now()
);

alter table app_private.editor_members enable row level security;

create or replace function app_private.is_editor()
returns boolean
language sql
stable
security definer
set search_path = app_private, pg_catalog
as $$
  select exists (
    select 1
    from app_private.editor_members m
    where m.user_id = (select auth.uid())
      and m.active = true
  );
$$;

revoke all on function app_private.is_editor() from public;
grant execute on function app_private.is_editor() to authenticated;

alter table public.stories
  add column if not exists reviewed_by uuid references auth.users(id) on delete set null,
  add column if not exists reviewed_at timestamptz,
  add column if not exists last_edited_at timestamptz;

create or replace function app_private.stamp_story_review()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if new.ai_headline is distinct from old.ai_headline
     or new.ai_summary is distinct from old.ai_summary
     or new.review_notes is distinct from old.review_notes then
    new.last_edited_at := now();
  end if;

  if new.editorial_status is distinct from old.editorial_status
     and new.editorial_status in ('approved','rejected') then
    new.reviewed_by := auth.uid();
    new.reviewed_at := now();
  end if;

  return new;
end;
$$;

drop trigger if exists stories_stamp_review on public.stories;
create trigger stories_stamp_review
before update on public.stories
for each row execute function app_private.stamp_story_review();

grant select on public.stories to authenticated;
grant update (ai_headline, ai_summary, editorial_status, review_notes) on public.stories to authenticated;

drop policy if exists "Editors can read stories" on public.stories;
create policy "Editors can read stories"
on public.stories
for select
to authenticated
using ((select app_private.is_editor()));

drop policy if exists "Editors can update stories" on public.stories;
create policy "Editors can update stories"
on public.stories
for update
to authenticated
using ((select app_private.is_editor()))
with check ((select app_private.is_editor()));
