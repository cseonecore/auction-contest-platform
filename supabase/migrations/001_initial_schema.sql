
-- Auction Contest Platform
-- Initial database schema

create extension if not exists pgcrypto;

create table public.settings (
  key text primary key,
  value jsonb not null
);

create table public.teams (
  id uuid primary key default gen_random_uuid(),
  name text unique not null,
  captain_id uuid,
  locked boolean not null default false,
  created_at timestamptz not null default now()
);

create table public.members (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams(id) on delete cascade,
  name text not null,
  email text unique not null,
  college text,
  created_at timestamptz not null default now()
);

create table public.topics (
  id uuid primary key default gen_random_uuid(),
  level text not null check (level in ('easy', 'hard')),
  title text not null,
  description text,
  criterion jsonb
);

create table public.slots (
  id uuid primary key default gen_random_uuid(),
  topic_id uuid not null references public.topics(id),
  round integer not null check (round in (1, 2)),
  status text not null default 'pending'
    check (status in ('pending', 'open', 'sold', 'skipped')),
  current_bid integer not null default 0,
  leader_team_id uuid references public.teams(id),
  end_time timestamptz,
  winner_team_id uuid references public.teams(id)
);

create table public.wallets (
  team_id uuid references public.teams(id) on delete cascade,
  round integer not null check (round in (1, 2)),
  balance integer not null,
  primary key (team_id, round)
);

create table public.bids (
  id uuid primary key default gen_random_uuid(),
  slot_id uuid not null references public.slots(id),
  team_id uuid not null references public.teams(id),
  amount integer not null,
  server_time timestamptz not null default now()
);
