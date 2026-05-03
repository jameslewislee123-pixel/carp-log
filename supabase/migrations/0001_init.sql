-- carp-log schema (no auth — single anon key, RLS allow-all)
create extension if not exists "uuid-ossp";

create table if not exists app_config (
  id          uuid primary key default uuid_generate_v4(),
  version     int  not null default 1,
  created_at  timestamptz not null default now()
);

create table if not exists anglers (
  id          uuid primary key default uuid_generate_v4(),
  name        text not null,
  color       text not null,
  created_at  timestamptz not null default now()
);

create table if not exists trips (
  id          uuid primary key default uuid_generate_v4(),
  name        text not null,
  location    text,
  start_date  timestamptz not null,
  end_date    timestamptz not null,
  notes       text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table if not exists catches (
  id          uuid primary key default uuid_generate_v4(),
  angler_id   uuid not null references anglers(id) on delete cascade,
  lost        boolean not null default false,
  lbs         int  not null default 0,
  oz          int  not null default 0,
  species     text,
  date        timestamptz not null,
  trip_id     uuid references trips(id) on delete set null,
  lake        text,
  swim        text,
  bait        text,
  rig         text,
  notes       text,
  has_photo   boolean not null default false,
  weather     jsonb,
  moon        jsonb,
  comments    jsonb not null default '[]'::jsonb,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table if not exists photos (
  id          uuid primary key default uuid_generate_v4(),
  catch_id    uuid not null references catches(id) on delete cascade,
  data        text not null, -- base64 data URL
  created_at  timestamptz not null default now()
);
create unique index if not exists photos_catch_id_idx on photos(catch_id);

create table if not exists notify_config (
  id          int  primary key default 1,
  token       text,
  chat_id     text,
  enabled     boolean not null default false,
  constraint singleton check (id = 1)
);

-- Trigger: bump updated_at
create or replace function bump_updated_at() returns trigger as $$
begin new.updated_at = now(); return new; end;
$$ language plpgsql;

drop trigger if exists trips_bump on trips;
create trigger trips_bump before update on trips for each row execute function bump_updated_at();
drop trigger if exists catches_bump on catches;
create trigger catches_bump before update on catches for each row execute function bump_updated_at();

-- RLS off (household anon-key model). If you ever want RLS-on, replace with allow-all:
alter table anglers       disable row level security;
alter table trips         disable row level security;
alter table catches       disable row level security;
alter table photos        disable row level security;
alter table notify_config disable row level security;
alter table app_config    disable row level security;

-- Realtime publication
alter publication supabase_realtime add table catches;
alter publication supabase_realtime add table trips;
alter publication supabase_realtime add table anglers;
alter publication supabase_realtime add table notify_config;

-- Seed singletons
insert into app_config (version) values (1) on conflict do nothing;
insert into notify_config (id, enabled) values (1, false) on conflict (id) do nothing;
