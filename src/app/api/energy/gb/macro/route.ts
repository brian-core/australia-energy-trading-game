import { NextResponse } from "next/server";
import { buildUkMacro } from "@/lib/energy/gb";

// UK macro for the North Sea feasibility view: BoE Bank Rate + ONS CPI.
// Seeds the study's discount-rate and inflation defaults.
export async function GET() {
  const payload = await buildUkMacro();
  return NextResponse.json(payload, {
    headers: { "Cache-Control": "public, s-maxage=21600, stale-while-revalidate=86400" },
  });
}
