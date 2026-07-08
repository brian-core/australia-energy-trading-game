import { NextResponse } from "next/server";
import { buildGbMarketPayload } from "@/lib/energy/gb";

// GB spot (Elexon MID) + wind out-turn for the North Sea feasibility view.
export async function GET() {
  const payload = await buildGbMarketPayload(7);
  return NextResponse.json(payload, {
    headers: { "Cache-Control": "public, s-maxage=1800, stale-while-revalidate=7200" },
  });
}
