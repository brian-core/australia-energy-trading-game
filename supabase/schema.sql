-- Energy Planet: accounts, cloud saves, leaderboard.
-- Paste into the Supabase SQL editor (Dashboard -> SQL -> New query -> Run).
--
-- SECURITY: game_saves/leaderboard rows are written only by the app's server
-- (via SUPABASE_SERVICE_ROLE_KEY, which bypasses RLS) after server-side
-- validation — see src/app/api/game/save and src/app/api/game/leaderboard.
-- The browser client only ever reads these tables. Earlier versions of this
-- schema let a signed-in user insert/update their own rows directly, which
-- meant anyone could write arbitrary cash/company_value numbers (including
-- straight to the public leaderboard) by calling the Supabase REST API with
-- their own anon-key session, bypassing the game entirely. If you deployed
-- an earlier version, re-run this file — the DROP POLICY statements below
-- remove that access from an existing project.

create table if not exists public.game_saves (
  user_id uuid primary key references auth.users (id) on delete cascade,
  state jsonb not null,
  updated_at timestamptz not null default now()
);

alter table public.game_saves enable row level security;

drop policy if exists "insert own save" on public.game_saves;
drop policy if exists "update own save" on public.game_saves;

create policy "read own save" on public.game_saves
  for select using (auth.uid() = user_id);

create table if not exists public.leaderboard (
  user_id uuid primary key references auth.users (id) on delete cascade,
  handle text not null default 'anon' check (char_length(handle) between 1 and 24),
  company_value numeric not null default 0,
  updated_at timestamptz not null default now()
);

alter table public.leaderboard enable row level security;

drop policy if exists "insert own row" on public.leaderboard;
drop policy if exists "update own row" on public.leaderboard;

create policy "leaderboard is public" on public.leaderboard
  for select using (true);

create index if not exists leaderboard_value_idx
  on public.leaderboard (company_value desc);
