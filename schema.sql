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
  paid          boolean not null default false,
  paid_at       timestamptz,
  placed_at     timestamptz not null default now()
);
create index if not exists orders_placed_idx on orders(placed_at desc);

-- Upgrading from an earlier version? These add the payment columns without
-- touching existing rows. Safe to run more than once.
alter table orders add column if not exists paid    boolean not null default false;
alter table orders add column if not exists paid_at timestamptz;

-- -------------------------------------------------------------- reviews ----
create table if not exists reviews (
  id         uuid primary key default gen_random_uuid(),
  name       text default '',
  rating     int not null check (rating between 1 and 5),
  body       text default '',
  chef_id    text references chefs(id) on delete set null,  -- null = the kitchen in general
  created_at timestamptz not null default now()
);
create index if not exists reviews_recent_idx on reviews(created_at desc);
create index if not exists reviews_chef_idx on reviews(chef_id);

-- Already have a reviews table from an earlier version? This adds the column
-- without touching what's in it. Safe to run more than once.
alter table reviews add column if not exists chef_id text references chefs(id) on delete set null;

-- ------------------------------------------- payments spotted in WhatsApp ----
-- The hourly sync has no login, so it cannot mark an order paid itself.
-- It drops what it saw here instead, and the chef confirms with one tap.
create table if not exists pending_payments (
  id        uuid primary key default gen_random_uuid(),
  who       text not null,                 -- name as it appears in the chat
  amount    numeric(10,2),                 -- null when it couldn't be read
  chef_id   text references chefs(id) on delete set null,
  source    text not null default 'text'
            check (source in ('text','screenshot')),
  raw       text default '',               -- the message, or what the image said
  seen_at   timestamptz not null default now(),
  resolved  boolean not null default false
);
create index if not exists pending_open_idx on pending_payments(resolved, seen_at desc);

-- ---------------------------------------------- dishes spotted in WhatsApp ----
-- Same idea as pending_payments: when a chef posts "Atta Laddoo 250g for 250rs"
-- in the group, the sync/listener has no login and cannot add a dish. It queues
-- it here, and the chef adds it to the menu with one tap. msg_key makes the
-- same post queue only once however many times it is seen.
create table if not exists pending_dishes (
  id        uuid primary key default gen_random_uuid(),
  chef_id   text not null references chefs(id) on delete cascade,
  name      text not null check (char_length(name) between 3 and 90),
  price     numeric(10,2) not null check (price > 0 and price <= 20000),
  slot      text not null default 'all'
            check (slot in ('all','breakfast','lunch','dinner')),
  diet      text not null default 'veg' check (diet in ('veg','nonveg')),
  note      text default '' check (char_length(note) <= 160),
  raw       text default '' check (char_length(raw) <= 400),
  posted_at timestamptz not null default now(),
  msg_key   text unique,
  resolved  boolean not null default false
);
create index if not exists pending_dishes_open_idx on pending_dishes(resolved, posted_at desc);

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
alter table chefs            enable row level security;
alter table dishes           enable row level security;
alter table orders           enable row level security;
alter table reviews          enable row level security;
alter table manual_earnings  enable row level security;
alter table pending_payments enable row level security;
alter table pending_dishes   enable row level security;

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

-- a signed-in chef marks an order paid or unpaid
drop policy if exists orders_update_chefs on orders;
create policy orders_update_chefs on orders for update
  using (auth.uid() is not null) with check (auth.uid() is not null);

-- reviews: anyone may post and read
drop policy if exists reviews_insert_any on reviews;
create policy reviews_insert_any on reviews for insert with check (true);

drop policy if exists reviews_read on reviews;
create policy reviews_read on reviews for select using (true);

-- manual earnings: private to the chef who entered them
drop policy if exists manual_own on manual_earnings;
create policy manual_own on manual_earnings for all
  using (is_chef(chef_id)) with check (is_chef(chef_id));

-- pending payments: the sync writes them without a login; only a signed-in
-- chef can see or clear them, so nobody browsing the site sees who paid what.
drop policy if exists pending_insert_any on pending_payments;
create policy pending_insert_any on pending_payments for insert with check (true);

drop policy if exists pending_read_chefs on pending_payments;
create policy pending_read_chefs on pending_payments for select
  using (auth.uid() is not null);

drop policy if exists pending_update_chefs on pending_payments;
create policy pending_update_chefs on pending_payments for update
  using (auth.uid() is not null) with check (auth.uid() is not null);

-- pending dishes: anyone may queue one (the sync has no login) but only the
-- chef it belongs to can see or clear it. Nothing here reaches the public menu
-- until she adds it, and she is the only one who can write to dishes.
drop policy if exists pdish_insert_any on pending_dishes;
create policy pdish_insert_any on pending_dishes for insert with check (true);

drop policy if exists pdish_read_own on pending_dishes;
create policy pdish_read_own on pending_dishes for select using (is_chef(chef_id));

drop policy if exists pdish_update_own on pending_dishes;
create policy pdish_update_own on pending_dishes for update
  using (is_chef(chef_id)) with check (is_chef(chef_id));

grant insert on pending_dishes to anon, authenticated;
grant select, update on pending_dishes to authenticated;

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
