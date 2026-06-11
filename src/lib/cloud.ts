"use client";

// Optional cloud layer: Supabase auth + game saves + leaderboard.
// Entirely env-gated — when the env vars are absent, cloudEnabled() is false
// and the game stays on localStorage.

import { createClient, type Session, type SupabaseClient } from "@supabase/supabase-js";
import { useEffect, useState } from "react";
import type { GameState } from "./energy/game";

let client: SupabaseClient | null | undefined;

export function getSupabase(): SupabaseClient | null {
  if (client !== undefined) return client;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  client = url && key ? createClient(url, key) : null;
  return client;
}

export function cloudEnabled(): boolean {
  return getSupabase() !== null;
}

export function useSession(): Session | null {
  const [session, setSession] = useState<Session | null>(null);
  useEffect(() => {
    const sb = getSupabase();
    if (!sb) return;
    sb.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: sub } = sb.auth.onAuthStateChange((_event, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);
  return session;
}

export async function signInWithEmail(email: string): Promise<string | null> {
  const sb = getSupabase();
  if (!sb) return "cloud not configured";
  const { error } = await sb.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: typeof window !== "undefined" ? window.location.origin : undefined },
  });
  return error ? error.message : null;
}

export async function signOut(): Promise<void> {
  await getSupabase()?.auth.signOut();
}

export async function loadCloudSave(): Promise<GameState | null> {
  const sb = getSupabase();
  if (!sb) return null;
  const { data } = await sb.from("game_saves").select("state").maybeSingle();
  return (data?.state as GameState) ?? null;
}

export async function saveCloudSave(state: GameState): Promise<void> {
  const sb = getSupabase();
  const user = (await sb?.auth.getUser())?.data.user;
  if (!sb || !user) return;
  await sb
    .from("game_saves")
    .upsert({ user_id: user.id, state, updated_at: new Date().toISOString() });
}

export interface LeaderboardRow {
  handle: string;
  company_value: number;
  user_id: string;
}

export async function pushLeaderboard(handle: string, companyValue: number): Promise<void> {
  const sb = getSupabase();
  const user = (await sb?.auth.getUser())?.data.user;
  if (!sb || !user) return;
  await sb.from("leaderboard").upsert({
    user_id: user.id,
    handle: handle.slice(0, 24) || "anon",
    company_value: Math.round(companyValue),
    updated_at: new Date().toISOString(),
  });
}

export async function fetchLeaderboard(limit = 10): Promise<LeaderboardRow[]> {
  const sb = getSupabase();
  if (!sb) return [];
  const { data } = await sb
    .from("leaderboard")
    .select("handle, company_value, user_id")
    .order("company_value", { ascending: false })
    .limit(limit);
  return data ?? [];
}
