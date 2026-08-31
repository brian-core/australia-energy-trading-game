import { createClient } from "@supabase/supabase-js";

// Verifies a Supabase access token sent as `Authorization: Bearer <jwt>` and
// returns the authenticated user id, or null. Used by server routes that
// must know *who* is writing before touching game_saves/leaderboard with the
// service-role key (which bypasses RLS, so this check is the only gate).
export async function getAuthedUserId(request: Request): Promise<string | null> {
  const header = request.headers.get("authorization") ?? request.headers.get("Authorization");
  const token = header?.startsWith("Bearer ") ? header.slice(7).trim() : null;
  if (!token) return null;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) return null;

  const sb = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await sb.auth.getUser(token);
  if (error || !data.user) return null;
  return data.user.id;
}
