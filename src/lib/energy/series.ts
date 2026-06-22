import { REGIONS, groupFuelTech } from "./regions";
import { oeFetch, toNetworkNaive, type OeEnvelope, type OeResult, type OeRow } from "./sources";
import { synthHourly } from "./weather";
import type { FuelGroup } from "./types";

// Aligned 7-day, 30-minute series per region for the LAB: price, demand,
// wind generation, solar generation. Live from the OpenElectricity 7d files;
// demo mode derives everything from the synthetic weather (same seeds as the
// weather feed) so weather↔grid correlations exist offline too.

export interface RegionSeriesData {
  startMs: number;
  intervalH: number;
  t: number[];
  priceAUD: number[];
  demandMW: number[];
  windMW: number[];
  solarMW: number[];
  /** Coal + gas output — the dispatchable fleet, for outage inference. */
  thermalMW: number[];
}

export interface SeriesPayload {
  demo: boolean;
  updatedAt: string;
  regions: Record<string, RegionSeriesData>;
}

const STEP_MS = 1800_000; // 30 minutes
const LEN = 7 * 48; // 336 half-hour points

/**
 * Resample a [ts, value] series onto the 30-min grid anchored at startMs by
 * picking the source sample nearest each grid point (within one step).
 */
function resample(rows: OeRow[], startMs: number): number[] {
  const out = new Array<number>(LEN).fill(NaN);
  const pts: Array<[number, number]> = [];
  for (const [ts, v] of rows) {
    const ms = Date.parse(ts);
    if (Number.isFinite(ms) && typeof v === "number" && Number.isFinite(v)) pts.push([ms, v]);
  }
  if (pts.length === 0) return out;
  let j = 0;
  for (let i = 0; i < LEN; i++) {
    const t = startMs + i * STEP_MS;
    while (j + 1 < pts.length && Math.abs(pts[j + 1][0] - t) <= Math.abs(pts[j][0] - t)) j++;
    if (Math.abs(pts[j][0] - t) <= STEP_MS) out[i] = pts[j][1];
  }
  return out;
}

/** Sum the resampled power series whose fuel tech maps to one of `groups`. */
function sumGroups(results: OeResult[], groups: FuelGroup[], startMs: number): number[] {
  const acc = new Array<number>(LEN).fill(0);
  const seen = new Array<boolean>(LEN).fill(false);
  for (const r of results) {
    const g = r.columns.fueltech ? groupFuelTech(r.columns.fueltech) : null;
    if (!g || !groups.includes(g)) continue;
    const grid = resample(r.data, startMs);
    for (let i = 0; i < LEN; i++) {
      if (Number.isFinite(grid[i])) {
        acc[i] += grid[i];
        seen[i] = true;
      }
    }
  }
  return acc.map((v, i) => (seen[i] ? v : NaN));
}

function powerResults(env: OeEnvelope | null, region: string): OeResult[] {
  const block = env?.data.find((b) => b.metric === "power");
  if (!block) return [];
  return block.results.filter((r) => (r.columns.region ?? region) === region);
}

function marketRows(env: OeEnvelope | null, region: string, metric: string): OeRow[] {
  const block = env?.data.find((b) => b.metric === metric);
  const r = block?.results.find((rr) => (rr.columns.region ?? region) === region);
  return r?.data ?? [];
}

function assembleRegion(
  startMs: number,
  power: OeEnvelope | null,
  market: OeEnvelope | null,
  region: string,
): RegionSeriesData | null {
  const results = powerResults(power, region);
  const priceAUD = resample(marketRows(market, region, "price"), startMs);
  const demandMW = resample(marketRows(market, region, "demand"), startMs);
  // LAB solar is utility-scale only (the "solar" group), matching operational
  // demand; rooftop is netted out of demand and grouped separately.
  const windMW = sumGroups(results, ["wind"], startMs);
  const solarMW = sumGroups(results, ["solar"], startMs);
  const thermalMW = sumGroups(results, ["coal", "gas"], startMs);

  const hasData = [priceAUD, demandMW, windMW, solarMW, thermalMW].some((a) =>
    a.some(Number.isFinite),
  );
  if (!hasData) return null;
  return {
    startMs,
    intervalH: 0.5,
    t: Array.from({ length: LEN }, (_, i) => startMs + i * STEP_MS),
    priceAUD,
    demandMW,
    windMW,
    solarMW,
    thermalMW,
  };
}

/** Demo: derive grid series from the same synthetic weather the LAB sees. */
function synthSeries(code: string, endMs: number): RegionSeriesData {
  const seed = code.charCodeAt(0) + code.charCodeAt(1);
  const hours = 7 * 24;
  const capital = synthHourly(seed, hours, endMs);
  const belt = synthHourly(seed * 1.7 + 5, hours, endMs);
  const scale: Record<string, { base: number; wind: number; solar: number }> = {
    QLD1: { base: 6200, wind: 2600, solar: 5200 },
    NSW1: { base: 7800, wind: 3400, solar: 4800 },
    VIC1: { base: 5100, wind: 4500, solar: 2100 },
    SA1: { base: 1400, wind: 2200, solar: 800 },
    TAS1: { base: 1050, wind: 580, solar: 10 },
    WEM: { base: 2300, wind: 880, solar: 580 },
  };
  const k = scale[code] ?? scale.NSW1;
  const len = hours * 2;
  const t: number[] = [];
  const priceAUD: number[] = [];
  const demandMW: number[] = [];
  const windMW: number[] = [];
  const solarMW: number[] = [];
  const thermalMW: number[] = [];
  const startMs = capital.t[0];
  // Demo outage: a chunk of the thermal fleet tripped ~2 days ago and is
  // still offline, so the rolling-max availability visibly steps down.
  const outageStart = len - 100;
  const outageEnd = len;
  for (let i = 0; i < len; i++) {
    const h = Math.min(Math.floor(i / 2), hours - 1);
    const ts = startMs + i * 1800_000;
    t.push(ts);
    const temp = capital.tempC[h];
    const wind = belt.windMs[h];
    const rad = belt.radWm2[h];
    const hod = (new Date(ts).getUTCHours() + 10) % 24;
    // Demand: base diurnal + heating/cooling response to temperature.
    const diurnal = 1 + 0.16 * Math.sin((Math.PI * (hod - 11)) / 12);
    const cdd = Math.max(temp - 22, 0);
    const hdd = Math.max(15 - temp, 0);
    const demand = k.base * diurnal + k.base * 0.018 * cdd + k.base * 0.014 * hdd;
    // VRE from weather (cubic-ish wind power curve, linear solar).
    const windOut = Math.min(k.wind, k.wind * Math.pow(Math.min(wind, 13) / 13, 3) * 1.15);
    const solarOut = (k.solar * rad) / 950;
    // Price from residual demand through a convex curve.
    const residual = demand - windOut - solarOut;
    const outage = i >= outageStart && i < outageEnd ? 0.72 : 1;
    const availThermal = k.base * 1.05 * outage;
    const thermal = Math.min(Math.max(residual, 0) * 0.95, availThermal);
    const u = Math.max(residual, 0) / Math.max(availThermal, 1);
    let price = 22 + 150 * Math.max(u, 0) ** 2.4;
    if (residual / (k.base * 1.25) < 0.18) price = -20 + 200 * (residual / (k.base * 1.25));
    priceAUD.push(Math.round(price * 10) / 10);
    demandMW.push(Math.round(demand));
    windMW.push(Math.round(windOut));
    solarMW.push(Math.round(solarOut));
    thermalMW.push(Math.round(thermal));
  }
  return { startMs, intervalH: 0.5, t, priceAUD, demandMW, windMW, solarMW, thermalMW };
}

export async function buildSeriesPayload(): Promise<SeriesPayload> {
  const endMs = Math.floor(Date.now() / STEP_MS) * STEP_MS;
  const startMs = endMs - (LEN - 1) * STEP_MS;
  const windowStart = startMs - STEP_MS;

  const power = (network: "NEM" | "WEM") =>
    oeFetch(
      `/data/network/${network}`,
      {
        metrics: "power",
        interval: "5m",
        primary_grouping: "network_region",
        secondary_grouping: "fueltech",
        date_start: toNetworkNaive(network, windowStart),
      },
      600,
    ).catch(() => null);
  const market = (network: "NEM" | "WEM") =>
    oeFetch(
      `/market/network/${network}`,
      {
        metrics: ["price", "demand"],
        interval: "5m",
        primary_grouping: "network_region",
        date_start: toNetworkNaive(network, windowStart),
      },
      600,
    ).catch(() => null);

  const [nemPower, nemMarket, wemPower, wemMarket] = await Promise.all([
    power("NEM"),
    market("NEM"),
    power("WEM"),
    market("WEM"),
  ]);

  let anyReal = false;
  const regions: Record<string, RegionSeriesData> = {};
  REGIONS.forEach((meta) => {
    const isWem = meta.network === "WEM";
    const region = isWem ? "WEM" : meta.code;
    const real = assembleRegion(
      startMs,
      isWem ? wemPower : nemPower,
      isWem ? wemMarket : nemMarket,
      region,
    );
    if (real) anyReal = true;
    regions[meta.code] = real ?? synthSeries(meta.code, endMs);
  });
  return { demo: !anyReal, updatedAt: new Date().toISOString(), regions };
}
