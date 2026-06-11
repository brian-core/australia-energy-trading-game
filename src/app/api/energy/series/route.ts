import { NextResponse } from "next/server";
import { buildSeriesPayload } from "@/lib/energy/series";

// Aligned 7-day 30-minute series per region (price, demand, wind, solar)
// for the LAB's correlation fitting and forecast scoring.
export async function GET() {
  const payload = await buildSeriesPayload();
  return NextResponse.json(payload, {
    headers: { "Cache-Control": "public, s-maxage=600, stale-while-revalidate=3600" },
  });
}
