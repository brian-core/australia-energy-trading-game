import { NextResponse } from "next/server";
import { buildWeatherPayload } from "@/lib/energy/weather";

// Hourly weather per region: 7 days back + 7 days forecast, two points per
// region (capital + renewables belt). Source: Open-Meteo, cached 30 min.
export async function GET() {
  const payload = await buildWeatherPayload();
  return NextResponse.json(payload, {
    headers: { "Cache-Control": "public, s-maxage=1800, stale-while-revalidate=3600" },
  });
}
