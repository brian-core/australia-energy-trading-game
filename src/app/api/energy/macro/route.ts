import { NextResponse } from "next/server";
import { buildMacroPayload } from "@/lib/energy/macro";

// Macro context: live FX (Frankfurter/ECB), CPI (ABS when reachable),
// fuel-cost reference levels. Cached an hour.
export async function GET() {
  const payload = await buildMacroPayload();
  return NextResponse.json(payload, {
    headers: { "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=86400" },
  });
}
