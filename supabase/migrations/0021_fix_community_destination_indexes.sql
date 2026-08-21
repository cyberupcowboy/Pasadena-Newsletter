drop index if exists public.events_origin_submission_uidx;
create unique index events_origin_submission_uidx on public.events(origin_submission_id);

drop index if exists public.businesses_origin_submission_uidx;
create unique index businesses_origin_submission_uidx on public.businesses(origin_submission_id);
