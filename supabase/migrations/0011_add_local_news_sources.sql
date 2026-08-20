insert into public.sources (name, source_type, base_url, trust_score, active)
select 'Anne Arundel County Health Department', 'official', 'https://www.aahealth.org', 95, true
where not exists (
  select 1 from public.sources where name = 'Anne Arundel County Health Department'
);

insert into public.sources (name, source_type, base_url, trust_score, active)
select 'Eye On Annapolis', 'news', 'https://www.eyeonannapolis.net', 82, true
where not exists (
  select 1 from public.sources where name = 'Eye On Annapolis'
);
