import { NextResponse } from "next/server";
import { getAuthedUserId } from "@/lib/energy/server-auth";
import { getSupabaseAdmin } from "@/lib/energy/supabase-admin";
import { validateGameState } from "@/lib/energy/validate";

// Cloud save write path. The client used to upsert game_saves directly with
// the anon key, trusting whatever cash/fleet numbers it had computed — RLS
// only checked row ownership, not value sanity, so a user could push any
// state (or write straight to the REST API, bypassing the app entirely).
// Now the client can only read its own save (see supabase/schema.sql); every
// write goes through here, gets checked by validateGameState, and is then
// written with the service-role key.

export const runtime = "nodejs";

function bad(status: number, error: string) {
  return NextResponse.json({ error }, { status });
}

export async function POST(request: Request) {
  const userId = await getAuthedUserId(request);
  if (!userId) return bad(401, "sign in required");

  const admin = getSupabaseAdmin();
  if (!admin) return bad(503, "cloud save not configured");

  let body: { state?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return bad(400, "invalid JSON body");
  }

  const { data: userData, error: userErr } = await admin.auth.admin.getUserById(userId);
  if (userErr || !userData?.user) return bad(401, "user not found");
  const accountCreatedAtMs = new Date(userData.user.created_at).getTime();

  const now = Date.now();
  const result = validateGameState(body.state, now, accountCreatedAtMs);
  if (!result.ok) return bad(400, result.error);

  const { error } = await admin
    .from("game_saves")
    .upsert({ user_id: userId, state: result.state, updated_at: new Date(now).toISOString() });
  if (error) return bad(500, "save failed");

  return NextResponse.json({ ok: true });
}
