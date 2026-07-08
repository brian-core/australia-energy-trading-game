// GB (Great Britain) market data for the North Sea feasibility view.
// All endpoints are Elexon "Insights" BMRS APIs — keyless, JSON.
//   - Spot price: MID dataset (APX market index, 30-min, £/MWh) — the
//     standard keyless proxy for GB wholesale spot.
//   - Wind out-turn: AGWS (actual generation, wind onshore/offshore, 30-min).
// Falls back to demo series when unreachable, flagged via `demo`, matching
// the AU feeds' honesty pattern.

import type { PricePoint } from "./history";

const ELEXON = "https://data.elexon.co.uk/bmrs/api/v1";

export interface GbMarketPayload {
  updatedAt: string;
  demo: boolean;
  /** 30-min GB spot (£/MWh), last `windowDays` days, ascending. */
  spot: PricePoint[];
  /** 30-min offshore wind out-turn (MW), aligned window, ascending. */
  windOffshoreMW: PricePoint[];
  /** 30-min onshore wind out-turn (MW). */
  windOnshoreMW: PricePoint[];
  windowDays: number;
}

function iso(ts: number): string {
  return new Date(ts).toISOString().slice(0, 16) + "Z";
}

async function fetchMid(fromMs: number, toMs: number): Promise<PricePoint[]> {
  // MID caps rows per call; page by day to stay well inside limits.
  const out: PricePoint[] = [];
  for (let t = fromMs; t < toMs; t += 86400_000) {
    const end = Math.min(t + 86400_000, toMs);
    const url = `${ELEXON}/datasets/MID?from=${iso(t)}&to=${iso(end)}&dataProviders=APXMIDP&format=json`;
    const res = await fetch(url, { next: { revalidate: 1800 } });
    if (!res.ok) throw new Error(`MID HTTP ${res.status}`);
    const json = (await res.json()) as { data?: Array<{ startTime: string; price: number }> };
    for (const row of json.data ?? []) {
      const ms = Date.parse(row.startTime);
      if (Number.isFinite(ms) && Number.isFinite(row.price)) out.push([ms, row.price]);
    }
  }
  out.sort((a, b) => a[0] - b[0]);
  return out;
}

async function fetchWind(fromMs: number, toMs: number): Promise<{ off: PricePoint[]; on: PricePoint[] }> {
  const off: PricePoint[] = [];
  const on: PricePoint[] = [];
  for (let t = fromMs; t < toMs; t += 86400_000) {
    const end = Math.min(t + 86400_000, toMs);
    const url = `${ELEXON}/generation/actual/per-type/wind-and-solar?from=${iso(t)}&to=${iso(end)}&format=json`;
    const res = await fetch(url, { next: { revalidate: 1800 } });
    if (!res.ok) throw new Error(`AGWS HTTP ${res.status}`);
    const json = (await res.json()) as {
      data?: Array<{ psrType: string; quantity: number; startTime: string }>;
    };
    for (const row of json.data ?? []) {
      const ms = Date.parse(row.startTime);
      if (!Number.isFinite(ms) || !Number.isFinite(row.quantity)) continue;
      if (row.psrType === "Wind Offshore") off.push([ms, row.quantity]);
      else if (row.psrType === "Wind Onshore") on.push([ms, row.quantity]);
    }
  }
  off.sort((a, b) => a[0] - b[0]);
  on.sort((a, b) => a[0] - b[0]);
  return { off, on };
}

/** Synthetic GB-shaped series so the feasibility view keeps working offline. */
function demoMarket(windowDays: number): GbMarketPayload {
  const now = Math.floor(Date.now() / 1800_000) * 1800_000;
  const n = windowDays * 48;
  const spot: PricePoint[] = [];
  const off: PricePoint[] = [];
  const on: PricePoint[] = [];
  for (let i = n; i > 0; i--) {
    const ts = now - i * 1800_000;
    const hod = new Date(ts).getUTCHours() + new Date(ts).getUTCMinutes() / 60;
    const evening = Math.exp(-((hod - 18) ** 2) / 8) * 45;
    const windCycle = 0.5 + 0.4 * Math.sin(i / 60) + 0.1 * Math.sin(i / 7);
    spot.push([ts, Math.max(-40, 70 + evening - windCycle * 55 + (Math.sin(i * 7.3) + Math.sin(i * 3.1)) * 9)]);
    off.push([ts, Math.max(0, windCycle * 12000)]);
    on.push([ts, Math.max(0, windCycle * 8000)]);
  }
  return { updatedAt: new Date().toISOString(), demo: true, spot, windOffshoreMW: off, windOnshoreMW: on, windowDays };
}

export async function buildGbMarketPayload(windowDays = 7): Promise<GbMarketPayload> {
  const toMs = Math.floor(Date.now() / 1800_000) * 1800_000;
  const fromMs = toMs - windowDays * 86400_000;
  try {
    const [spot, wind] = await Promise.all([fetchMid(fromMs, toMs), fetchWind(fromMs, toMs)]);
    if (spot.length < 48) throw new Error("MID too thin");
    return {
      updatedAt: new Date().toISOString(),
      demo: false,
      spot,
      windOffshoreMW: wind.off,
      windOnshoreMW: wind.on,
      windowDays,
    };
  } catch {
    return demoMarket(windowDays);
  }
}

// --- UK macro (BoE Bank Rate + ONS CPI) -------------------------------------

export interface UkMacro {
  bankRate: { live: boolean; asOf: string; pct: number };
  cpi: { live: boolean; asOf: string; yoyPct: number };
}

/** BoE IADB CSV — official Bank Rate (IUDBEDR), daily. */
export async function fetchBoeBankRate(): Promise<{ asOf: string; pct: number; csv: string } | null> {
  try {
    const url =
      "https://www.bankofengland.co.uk/boeapps/iadb/fromshowcolumns.asp?csv.x=yes&Datefrom=01/Jan/2015&Dateto=now&SeriesCodes=IUDBEDR&CSVF=TN&UsingCodes=Y&VPD=Y&VFD=N";
    const res = await fetch(url, { next: { revalidate: 86400 } });
    if (!res.ok) return null;
    const csv = await res.text();
    const lines = csv.trim().split("\n");
    const last = lines[lines.length - 1]?.split(",");
    const pct = Number(last?.[1]);
    if (!last || !Number.isFinite(pct)) return null;
    const asOf = new Date(last[0]).toISOString().slice(0, 10);
    return { asOf, pct, csv };
  } catch {
    return null;
  }
}

/** ONS time series JSON — CPI annual rate, all items (D7G7). */
export async function fetchOnsCpi(): Promise<{
  asOf: string;
  yoyPct: number;
  months: Array<{ date: string; value: number }>;
} | null> {
  try {
    const res = await fetch(
      "https://www.ons.gov.uk/economy/inflationandpriceindices/timeseries/d7g7/mm23/data",
      { next: { revalidate: 86400 }, headers: { Accept: "application/json" } },
    );
    if (!res.ok) return null;
    const json = (await res.json()) as { months?: Array<{ date: string; value: string }> };
    const months = (json.months ?? [])
      .map((m) => ({ date: m.date, value: Number(m.value) }))
      .filter((m) => Number.isFinite(m.value));
    const last = months[months.length - 1];
    if (!last) return null;
    return { asOf: last.date, yoyPct: last.value, months };
  } catch {
    return null;
  }
}

export async function buildUkMacro(): Promise<UkMacro> {
  const [boe, ons] = await Promise.all([fetchBoeBankRate(), fetchOnsCpi()]);
  return {
    bankRate: boe
      ? { live: true, asOf: boe.asOf, pct: boe.pct }
      : { live: false, asOf: "2026 reference", pct: 4.0 },
    cpi: ons
      ? { live: true, asOf: ons.asOf, yoyPct: ons.yoyPct }
      : { live: false, asOf: "2026 reference", yoyPct: 2.8 },
  };
}
