-- NextUp Bill Pay Ledger — Supabase schema
-- Run this once in Project > SQL Editor > New query.

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  name text,
  status text not null default 'new',       -- new | trialing | active | expired
  plan text,                                 -- monthly | free | owner | null
  subscribed boolean not null default false,
  is_owner boolean not null default false,   -- true only for the app owner's real-data account
  trial_started_at timestamptz,
  trial_ends_at timestamptz,
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

create policy "profiles: select own" on public.profiles
  for select using (auth.uid() = id);

create policy "profiles: update own" on public.profiles
  for update using (auth.uid() = id);

create policy "profiles: insert own" on public.profiles
  for insert with check (auth.uid() = id);

create table if not exists public.ledger_data (
  user_id uuid primary key references auth.users(id) on delete cascade,
  data jsonb not null,
  updated_at timestamptz not null default now()
);

alter table public.ledger_data enable row level security;

create policy "ledger_data: select own" on public.ledger_data
  for select using (auth.uid() = user_id);

create policy "ledger_data: update own" on public.ledger_data
  for update using (auth.uid() = user_id);

create policy "ledger_data: insert own" on public.ledger_data
  for insert with check (auth.uid() = user_id);

-- Auto-create a profile row the moment someone signs up via Supabase Auth.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, name)
  values (new.id, new.raw_user_meta_data->>'name');
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
