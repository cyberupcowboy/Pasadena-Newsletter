alter table public.community_submissions
  drop constraint if exists community_submissions_source_url_http_check;

alter table public.community_submissions
  add constraint community_submissions_source_url_http_check
    check (source_url is null or source_url ~* '^https?://');
