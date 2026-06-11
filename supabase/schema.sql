-- Energy Planet: accounts, cloud saves, leaderboard.
-- Paste into the Supabase SQL editor (Dashboard -> SQL -> New query -> Run).

create table if not exists public.game_saves (
  user_id uuid primary key references auth.users (id) on delete cascade,
  state jsonb not null,
  updated_at timestamptz not null default now()
);

alter table public.game_saves enable row level security;

create policy "read own save" on public.game_saves
  for select using (auth.uid() = user_id);
create policy "insert own save" on public.game_saves
  for insert with check (auth.uid() = user_id);
create policy "update own save" on public.game_saves
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

create table if not exists public.leaderboard (
  user_id uuid primary key references auth.users (id) on delete cascade,
  handle text not null default 'anon' check (char_length(handle) between 1 and 24),
  company_value numeric not null default 0,
  updated_at timestamptz not null default now()
);

alter table public.leaderboard enable row level security;

create policy "leaderboard is public" on public.leaderboard
  for select using (true);
create policy "insert own row" on public.leaderboard
  for insert with check (auth.uid() = user_id);
create policy "update own row" on public.leaderboard
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

create index if not exists leaderboard_value_idx
  on public.leaderboard (company_value desc);
