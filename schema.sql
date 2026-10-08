-- ============================================================================
-- SRN Kitchen — database schema
--
-- Run this once in your Supabase project: SQL Editor -> New query -> paste ->
-- Run. It creates the tables, locks them down, and seeds the three chefs.
-- ============================================================================

-- ---------------------------------------------------------------- chefs ----
create table if not exists chefs (
  id        text primary key,            -- 'shobha', 'ramya', 'neha'
  name      text not null,
  phone     text not null,               -- country code + number, digits only
  open      boolean not null default true,
  auth_uid  uuid unique,                 -- links a chef to her login
  updated_at timestamptz not null default now()
);

-- --------------------------------------------------------------- dishes ----
create table if not exists dishes (
  id         uuid primary key default gen_random_uuid(),
  chef_id    text not null references chefs(id) on delete cascade,
  chef_name  text not null,              -- shown on the dish; editable per dish
  name       text not null,
  note       text default '',
  price      numeric(10,2) not null check (price > 0),
  slot       text not null default 'all'
             check (slot in ('all','breakfast','lunch','dinner')),
  diet       text not null default 'veg'
             check (diet in ('veg','nonveg')),
  available  boolean not null default true,
  image_url  text,                       -- public URL in the dish-photos bucket
  created_at timestamptz not null default now()
);
create index if not exists dishes_chef_idx on dishes(chef_id);
create index if not exists dishes_live_idx on dishes(available, created_at desc);

-- --------------------------------------------------------------- orders ----
-- items is a JSON array:
--   [{ "chef_id":"shobha", "name":"Chicken Biryani",
--      "qty":2, "price":180, "amount":360 }, ...]
create table if not exists orders (
  id            uuid primary key default gen_random_uuid(),
  customer_name text not null,
  phone         text not null,
  tower         text not null,
  flat          text not null,
  note          text default '',
  items         jsonb not null,
  grand         numeric(10,2) not null,
  placed_at     timestamptz not null default now()
);
create index if not exists orders_placed_idx on orders(placed_at desc);

-- -------------------------------------------------------------- reviews ----
create table if not exists reviews (
  id         uuid primary key default gen_random_uuid(),
  name       text default '',
  rating     int not null check (rating between 1 and 5),
  body       text default '',
  created_at timestamptz not null default now()
);
create index if not exists reviews_recent_idx on reviews(created_at desc);

-- ----------------------------------------------- manually added earnings ----
-- For days that were sold before the app existed, or cash taken outside it.
create table if not exists manual_earnings (
  id      uuid primary key default gen_random_uuid(),
  chef_id text not null references chefs(id) on delete cascade,
  day     date not null,
  amount  numeric(10,2) not null,
  note    text default '',
  unique (chef_id, day, note)
);
create index if not exists manual_day_idx on manual_earnings(chef_id, day);

-- ============================================================================
-- Row level security
--
-- The anon key ships inside the web page, so anyone can read it. These
-- policies are what actually protect the data — not the key.
-- ============================================================================
alter table chefs           enable row level security;
alter table dishes          enable row level security;
alter table orders          enable row level security;
alter table reviews         enable row level security;
alter table manual_earnings enable row level security;

-- Is the caller the chef who owns this row?
create or replace function is_chef(target text)
returns boolean language sql stable security definer as $$
  select exists (
    select 1 from chefs c where c.id = target and c.auth_uid = auth.uid()
  );
$$;

-- chefs: everyone reads the roster (names drive the menu); a chef edits herself
drop policy if exists chefs_read on chefs;
create policy chefs_read on chefs for select using (true);

drop policy if exists chefs_update_own on chefs;
create policy chefs_update_own on chefs for update
  using (auth_uid = auth.uid()) with check (auth_uid = auth.uid());

-- dishes: everyone reads the menu; a chef writes only her own dishes
drop policy if exists dishes_read on dishes;
create policy dishes_read on dishes for select using (true);

drop policy if exists dishes_write_own on dishes;
create policy dishes_write_own on dishes for all
  using (is_chef(chef_id)) with check (is_chef(chef_id));

-- orders: customers place them without logging in, but only chefs can read
-- them back. That keeps names, phones and flat numbers out of public reach.
drop policy if exists orders_insert_any on orders;
create policy orders_insert_any on orders for insert with check (true);

drop policy if exists orders_read_chefs on orders;
create policy orders_read_chefs on orders for select
  using (auth.uid() is not null);

-- reviews: anyone may post and read
drop policy if exists reviews_insert_any on reviews;
create policy reviews_insert_any on reviews for insert with check (true);

drop policy if exists reviews_read on reviews;
create policy reviews_read on reviews for select using (true);

-- manual earnings: private to the chef who entered them
drop policy if exists manual_own on manual_earnings;
create policy manual_own on manual_earnings for all
  using (is_chef(chef_id)) with check (is_chef(chef_id));

-- ============================================================================
-- Seed the roster
-- ============================================================================
insert into chefs (id, name, phone) values
  ('shobha', 'Shobha', '919800373577'),
  ('ramya',  'Ramya',  '918105177446'),
  ('neha',   'Neha',   '919962506977')
on conflict (id) do nothing;

-- ============================================================================
-- After running this, create one login per chef:
--
--   Authentication -> Users -> Add user  (tick "Auto Confirm User")
--     shobha@srnkitchen.app   password = her 6-digit PIN
--     ramya@srnkitchen.app    password = her 6-digit PIN
--     neha@srnkitchen.app     password = her 6-digit PIN
--
-- Then link each account to its chef row by pasting the new user's UID:
--
--   update chefs set auth_uid = '<UID for shobha>' where id = 'shobha';
--   update chefs set auth_uid = '<UID for ramya>'  where id = 'ramya';
--   update chefs set auth_uid = '<UID for neha>'   where id = 'neha';
--
-- The PIN is never stored in the website's code — Supabase holds it hashed,
-- and a chef changes it from the app or you reset it from this dashboard.
--
-- Last, for dish photos: Storage -> New bucket -> name it "dish-photos" and
-- mark it public.
-- ============================================================================
