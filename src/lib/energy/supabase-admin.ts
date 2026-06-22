// Server-only Supabase client using the SERVICE-ROLE key. This bypasses RLS
// and must NEVER be imported into client code — it is for trusted server-side
// ingestion (writing macro_ingest / macro_observations) only. The client-side
// anon layer lives in src/lib/cloud.ts.

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let admin: SupabaseClient | null | undefined;

/**
 * Service-role client, or null when SUPABASE_SERVICE_ROLE_KEY (or the URL) is
 * absent. Callers must handle null and surface a clear "key not configured"
 * message rather than crashing.
 */
export function getSupabaseAdmin(): SupabaseClient | null {
  if (admin !== undefined) return admin;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  admin =
    url && key
      ? createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })
      : null;
  return admin;
}
