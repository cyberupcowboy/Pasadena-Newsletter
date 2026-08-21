alter table public.businesses
  add column if not exists cuisine text,
  add column if not exists eats_status text not null default 'none',
  add column if not exists eats_rank integer,
  add column if not exists eats_blurb text,
  add column if not exists signature_item text,
  add column if not exists price_level text,
  add column if not exists local_eats_updated_at timestamptz;

alter table public.businesses
  drop constraint if exists businesses_eats_status_check;
alter table public.businesses
  add constraint businesses_eats_status_check
  check (eats_status = any (array['none'::text,'hot'::text,'favorite'::text,'both'::text]));

alter table public.businesses
  drop constraint if exists businesses_eats_rank_check;
alter table public.businesses
  add constraint businesses_eats_rank_check
  check (eats_rank is null or eats_rank between 1 and 1000);

alter table public.businesses
  drop constraint if exists businesses_price_level_check;
alter table public.businesses
  add constraint businesses_price_level_check
  check (price_level is null or price_level = any (array['$'::text,'$$'::text,'$$$'::text,'$$$$'::text]));

create index if not exists businesses_local_eats_idx
  on public.businesses (eats_status, eats_rank, updated_at desc)
  where editorial_status = 'approved' and eats_status <> 'none';

insert into public.businesses (name, category, cuisine, address, website, phone, description, hours_text, verified, sponsor_status, editorial_status, eats_status, eats_rank, eats_blurb, signature_item, price_level, local_eats_updated_at)
select * from (values
  ('Betty Lou''s','restaurant','Southern / comfort food','33 Magothy Beach Rd, Ste 100, Pasadena, MD 21122','https://www.bettylousmd.com/','443-548-2013','Scratch-made Southern-inspired comfort food with a creative cocktail program in a cozy neighborhood setting.','Tue–Thu 3–10pm · Fri–Sat 11am–10pm · Sun brunch 10:30am–3pm',false,'none','approved','hot',10,'A newer-generation Pasadena favorite with a strong date-night and brunch following, inventive drinks, and a scratch-kitchen identity.','Chicken pot pie','$$',now()),
  ('Pho Dena','restaurant','Vietnamese','4141 Mountain Rd, Pasadena, MD 21122','https://phodena.com/','410-807-9999','Modern Vietnamese restaurant serving pho, rice dishes, vermicelli, banh mi and seafood dishes.','Daily 11am–9pm',false,'none','approved','hot',20,'A polished Mountain Road spot that has quickly built a following for deeply flavored pho and a broader Vietnamese menu.','Pho Dena Special','$$',now()),
  ('Sam & Maggie''s Dockside Grill','restaurant','Chesapeake / New American','1575 Fairview Beach Rd, Pasadena, MD 21122','https://www.samandmaggies.com/','410-360-9526','Seasonal waterfront scratch kitchen at Fairview Marina with Chesapeake ingredients and Caribbean and Latin influences.','Seasonal May–Oct · Fri–Sat 4:30–9:30pm',false,'none','approved','hot',30,'The sunset-and-dinner pick: limited seasonal hours, waterfront tables and a chef-driven rotating menu make it feel like a destination without leaving Pasadena.','Jumbo lump crab cake','$$$',now()),
  ('Taquería La Oaxaqueña','restaurant','Mexican / Oaxacan','8101 Governor Ritchie Hwy, Pasadena, MD 21122',null,'410-980-0885','Casual Mexican food truck known for fresh tacos, birria, al pastor and other street-food staples.','Wed–Thu 10am–8pm · Fri–Sat 10am–9pm · Sun–Mon 10am–8pm',false,'none','approved','hot',40,'A low-frills, high-flavor local food-truck stop whose birria and tacos keep showing up in current Pasadena food recommendations.','Birria tacos','$',now()),
  ('Cookie''s Kitchen','restaurant','American diner / breakfast','4108 Mountain Rd, Pasadena, MD 21122',null,'410-437-8305','Long-running neighborhood diner serving breakfast, lunch and home-style comfort food.','Mon–Tue 6am–2:30pm · Wed–Fri 6am–8pm · Sat 6am–1pm · Sun 6:30am–1:30pm',false,'none','approved','favorite',10,'The kind of Pasadena place where regulars recognize the staff: classic breakfast, generous comfort food and decades of neighborhood familiarity.','Breakfast bowl / home fries','$',now()),
  ('Two Rivers Steak & Fish House','restaurant','Steakhouse / Chesapeake seafood','4105 Mountain Rd, Pasadena, MD 21122','https://www.tworiverssteak.com/','410-360-1919','Locally owned scratch kitchen serving steaks, seafood, cocktails and house-made bakery items.','Mon–Thu 4–9pm · Fri–Sat noon–10pm · Sun noon–8:30pm',false,'none','approved','favorite',20,'A Pasadena institution since 2011 for family dinners, steaks, seafood and special occasions, with deep local roots.','Two Rivers crab dip','$$$',now()),
  ('Bahama Mike''s','restaurant','Maryland seafood','8154 Ritchie Hwy, Pasadena, MD 21122','https://www.bahamamikes.com/','410-544-7800','Casual Maryland seafood and carryout spot serving crab cakes, fried seafood, sandwiches and catering.','Wed–Sat 11am–8pm · Sun 11am–7pm',false,'none','approved','favorite',30,'A dependable local seafood stop with the kind of crab-and-fish menu Pasadena families keep in the regular rotation.','Crab Stacker','$$',now()),
  ('Bangkok Garden Pasadena','restaurant','Thai','8043 Ritchie Hwy F, Pasadena, MD 21122','https://www.bkgpasadena.com/','410-766-0973','Thai and Asian takeout-focused restaurant serving curries, noodles, rice dishes and other Thai favorites.','Tue–Sun 11am–8pm',false,'none','approved','favorite',40,'A small local Thai option with a loyal following for flavorful noodles, curries and straightforward takeout.','Pad Thai / drunken noodles','$$',now())
) as seed(name,category,cuisine,address,website,phone,description,hours_text,verified,sponsor_status,editorial_status,eats_status,eats_rank,eats_blurb,signature_item,price_level,local_eats_updated_at)
where not exists (
  select 1 from public.businesses b
  where lower(b.name) = lower(seed.name)
    and lower(coalesce(b.address,'')) = lower(coalesce(seed.address,''))
);

update public.businesses set
  cuisine = case lower(name)
    when 'betty lou''s' then 'Southern / comfort food'
    when 'pho dena' then 'Vietnamese'
    when 'sam & maggie''s dockside grill' then 'Chesapeake / New American'
    when 'taquería la oaxaqueña' then 'Mexican / Oaxacan'
    when 'cookie''s kitchen' then 'American diner / breakfast'
    when 'two rivers steak & fish house' then 'Steakhouse / Chesapeake seafood'
    when 'bahama mike''s' then 'Maryland seafood'
    when 'bangkok garden pasadena' then 'Thai'
    else cuisine end,
  local_eats_updated_at = coalesce(local_eats_updated_at, now())
where lower(name) in ('betty lou''s','pho dena','sam & maggie''s dockside grill','taquería la oaxaqueña','cookie''s kitchen','two rivers steak & fish house','bahama mike''s','bangkok garden pasadena');