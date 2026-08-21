create index if not exists comment_reports_comment_id_idx on public.comment_reports(comment_id);
create index if not exists comment_reports_reviewed_by_idx on public.comment_reports(reviewed_by);
create index if not exists community_comments_community_submission_id_idx on public.community_comments(community_submission_id);
create index if not exists reader_error_reports_reviewed_by_idx on public.reader_error_reports(reviewed_by);
create index if not exists reader_error_reports_story_id_idx on public.reader_error_reports(story_id);

-- Businesses: one SELECT policy per role/action while retaining public approved rows and full editor access.
drop policy if exists "Editors can read all businesses" on public.businesses;
drop policy if exists "Editors manage businesses" on public.businesses;
drop policy if exists "Public can read approved businesses" on public.businesses;
create policy "Anonymous can read approved businesses"
  on public.businesses for select to anon
  using (editorial_status = 'approved');
create policy "Authenticated can read approved or editor businesses"
  on public.businesses for select to authenticated
  using (editorial_status = 'approved' or (select app_private.is_editor()));
create policy "Editors can insert businesses"
  on public.businesses for insert to authenticated
  with check ((select app_private.is_editor()));
create policy "Editors can update businesses"
  on public.businesses for update to authenticated
  using ((select app_private.is_editor()))
  with check ((select app_private.is_editor()));
create policy "Editors can delete businesses"
  on public.businesses for delete to authenticated
  using ((select app_private.is_editor()));

-- Neighborhoods: public active rows, editors all rows and writes.
drop policy if exists "Editors manage neighborhoods" on public.neighborhoods;
drop policy if exists "Public can read active neighborhoods" on public.neighborhoods;
create policy "Anonymous can read active neighborhoods"
  on public.neighborhoods for select to anon
  using (active = true);
create policy "Authenticated can read active or editor neighborhoods"
  on public.neighborhoods for select to authenticated
  using (active = true or (select app_private.is_editor()));
create policy "Editors can insert neighborhoods"
  on public.neighborhoods for insert to authenticated
  with check ((select app_private.is_editor()));
create policy "Editors can update neighborhoods"
  on public.neighborhoods for update to authenticated
  using ((select app_private.is_editor()))
  with check ((select app_private.is_editor()));
create policy "Editors can delete neighborhoods"
  on public.neighborhoods for delete to authenticated
  using ((select app_private.is_editor()));

-- Story transparency: readers see published metadata; editors see all metadata.
drop policy if exists "Editors can read all story transparency" on public.story_transparency;
drop policy if exists "Public can read transparency for published stories" on public.story_transparency;
create policy "Anonymous can read published story transparency"
  on public.story_transparency for select to anon
  using (exists (select 1 from public.published_stories p where p.story_id = story_transparency.story_id));
create policy "Authenticated can read published or editor transparency"
  on public.story_transparency for select to authenticated
  using (
    exists (select 1 from public.published_stories p where p.story_id = story_transparency.story_id)
    or (select app_private.is_editor())
  );

-- Comments: preserve approved-public, owner, and editor visibility with one SELECT policy per role.
drop policy if exists "Editors can read all comments" on public.community_comments;
drop policy if exists "Members can read their own comments" on public.community_comments;
drop policy if exists "Public can read approved comments" on public.community_comments;
create policy "Anonymous can read approved comments"
  on public.community_comments for select to anon
  using (moderation_status = 'approved');
create policy "Authenticated can read approved own or editor comments"
  on public.community_comments for select to authenticated
  using (
    moderation_status = 'approved'
    or (select auth.uid()) = user_id
    or (select app_private.is_editor())
  );
