import { NextResponse } from "next/server";
import { buildHistoryPayload, type HistoryWindow } from "@/lib/energy/history";

// Historic spot prices per region: ?window=7d (30-min) or ?window=90d (daily).
export async function GET(request: Request) {
  const url = new URL(request.url);
  const windowParam = url.searchParams.get("window");
  const window: HistoryWindow = windowParam === "90d" ? "90d" : "7d";
  const payload = await buildHistoryPayload(window);
  return NextResponse.json(payload, {
    headers: { "Cache-Control": "public, s-maxage=300, stale-while-revalidate=3600" },
  });
}
