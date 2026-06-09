import { NextResponse } from "next/server";
import { fetchFacilities } from "@/lib/energy/sources";

// Power station register (name, coordinates, fuel tech, registered MW).
// Changes rarely; upstream fetch is cached for a day.
export async function GET() {
  const { demo, facilities } = await fetchFacilities();
  return NextResponse.json(
    { demo, count: facilities.length, facilities },
    { headers: { "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=86400" } },
  );
}
