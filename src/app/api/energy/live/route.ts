import { NextResponse } from "next/server";
import { buildLivePayload } from "@/lib/energy/sources";

// Live grid snapshot: per-region demand, generation by fuel tech, prices and
// interconnector flows. Upstream fetches are cached ~55s, matching the
// 5-minute dispatch cadence well enough for a polling client.
export async function GET() {
  const payload = await buildLivePayload();
  return NextResponse.json(payload, {
    headers: { "Cache-Control": "public, s-maxage=55, stale-while-revalidate=300" },
  });
}
