import { NextResponse } from "next/server";
import { companyValue } from "@/lib/energy/game";
import { getAuthedUserId } from "@/lib/energy/server-auth";
import { getSupabaseAdmin } from "@/lib/energy/supabase-admin";
import { validateGameState } from "@/lib/energy/validate";

// Leaderboard write path. The client used to compute companyValue itself and
// push that number directly to Supabase with the anon key — anyone could
// post any score. Now the client only sends a display handle; the score is
// always recomputed here from the caller's own validated cloud save, so it's
// impossible to submit a number that didn't come from a plausible game
// state (see validateGameState for what "plausible" bounds).

export const runtime = "nodejs";

function bad(status: number, error: string) {
  return NextResponse.json({ error }, { status });
}

const CONTROL_CHAR_CUTOFF = 32; // codepoints below this are ASCII control characters
const DEL_CODE = 127;
const MAX_HANDLE_LENGTH = 24;

function sanitizeHandle(raw: unknown): string {
  if (typeof raw !== "string") return "anon";
  let out = "";
  for (const ch of raw) {
    const code = ch.codePointAt(0) ?? 0;
    if (code < CONTROL_CHAR_CUTOFF || code === DEL_CODE) continue;
    out += ch;
    if (out.length >= MAX_HANDLE_LENGTH) break;
  }
  out = out.trim();
  return out || "anon";
}

export async function POST(request: Request) {
  const userId = await getAuthedUserId(request);
  if (!userId) return bad(401, "sign in required");

  const admin = getSupabaseAdmin();
  if (!admin) return bad(503, "leaderboard not configured");

  let body: { handle?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return bad(400, "invalid JSON body");
  }
  const handle = sanitizeHandle(body.handle);

  const { data: saveRow, error: saveErr } = await admin
    .from("game_saves")
    .select("state")
    .eq("user_id", userId)
    .maybeSingle();
  if (saveErr) return bad(500, "could not read save");
  if (!saveRow) return bad(400, "no saved game yet — play a little first, then try again");

  const { data: userData, error: userErr } = await admin.auth.admin.getUserById(userId);
  if (userErr || !userData?.user) return bad(401, "user not found");
  const accountCreatedAtMs = new Date(userData.user.created_at).getTime();

  const now = Date.now();
  const result = validateGameState(saveRow.state, now, accountCreatedAtMs);
  if (!result.ok) return bad(409, `stored save failed validation: ${result.error}`);

  const value = companyValue(result.state);
  const { error } = await admin
    .from("leaderboard")
    .upsert({ user_id: userId, handle, company_value: Math.round(value), updated_at: new Date(now).toISOString() });
  if (error) return bad(500, "leaderboard update failed");

  return NextResponse.json({ ok: true, companyValue: value });
}
