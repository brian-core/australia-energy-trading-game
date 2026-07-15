import { NextResponse } from "next/server";
import { fetchQuarterPrices, parseQuarterId, recentQuarters } from "@/lib/energy/buy-timing";

// Hourly spot prices for a full calendar quarter, per region:
// ?q=2026-Q1 (defaults to the most recent completed quarter).
// Finished quarters never change, so responses cache for a day.
export async function GET(request: Request) {
  const url = new URL(request.url);
  const q = parseQuarterId(url.searchParams.get("q") ?? "") ?? recentQuarters(1)[0];
  const payload = await fetchQuarterPrices(q);
  return NextResponse.json(payload, {
    headers: { "Cache-Control": "public, s-maxage=86400, stale-while-revalidate=604800" },
  });
}
