import { REGIONS } from "./regions";
import { fetchJsonWithHostFallback } from "./sources";
import { synthHourly } from "./weather";

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
}

export interface SeriesPayload {
  demo: boolean;
  updatedAt: string;
  regions: Record<string, RegionSeriesData>;
}

interface OeSeries {
  id?: string;
  type?: string;
  fuel_tech?: string;
  history?: { start?: string; interval?: string; data?: Array<number | null> };
}

function intervalToH(s: string | undefined): number {
  const m = s?.match(/^(\d+)(m|h|d)$/i);
  if (!m) return 0.5;
  const n = Number(m[1]);
  return m[2] === "m" ? n / 60 : m[2] === "h" ? n : n * 24;
}

/** Resample a series onto a 30-min grid anchored at startMs (nearest index). */
function onGrid(s: OeSeries, startMs: number, len: number): number[] {
  const out = new Array<number>(len).fill(NaN);
  const sStart = s.history?.start ? Date.parse(s.history.start) : NaN;
  const sInt = intervalToH(s.history?.interval) * 3600_000;
  const data = s.history?.data;
  if (!Number.isFinite(sStart) || !sInt || !data) return out;
  for (let i = 0; i < len; i++) {
    const ts = startMs + i * 1800_000;
    const j = Math.round((ts - sStart) / sInt);
    const v = data[j];
    if (typeof v === "number" && Number.isFinite(v)) out[i] = v;
  }
  return out;
}

async function fetchRegionSeries(network: "NEM" | "WEM", region?: string): Promise<RegionSeriesData> {
  const path = region
    ? `/v3/stats/au/${network}/${region}/power/7d.json`
    : `/v3/stats/au/${network}/power/7d.json`;
  const json = (await fetchJsonWithHostFallback(path, 600)) as { data?: OeSeries[] };
  if (!Array.isArray(json.data)) throw new Error(`bad payload ${path}`);

  const price = json.data.find((s) => s.type === "price" || s.id?.endsWith(".price"));
  const demand = json.data.find((s) => s.type === "demand" || s.id?.endsWith(".demand"));
  const anchor = price ?? demand;
  const startMs = anchor?.history?.start ? Date.parse(anchor.history.start) : NaN;
  const len = anchor?.history?.data?.length ?? 0;
  if (!Number.isFinite(startMs) || len < 48) throw new Error(`no anchor series ${path}`);

  const sum = (matchers: string[]): number[] => {
    const acc = new Array<number>(len).fill(0);
    const seen = new Array<boolean>(len).fill(false);
    for (const s of json.data!) {
      if (s.type !== "power" || !s.fuel_tech) continue;
      if (!matchers.some((m) => s.fuel_tech!.startsWith(m))) continue;
      const g = onGrid(s, startMs, len);
      for (let i = 0; i < len; i++) {
        if (Number.isFinite(g[i])) {
          acc[i] += g[i];
          seen[i] = true;
        }
      }
    }
    return acc.map((v, i) => (seen[i] ? v : NaN));
  };

  return {
    startMs,
    intervalH: 0.5,
    t: Array.from({ length: len }, (_, i) => startMs + i * 1800_000),
    priceAUD: price ? onGrid(price, startMs, len) : new Array(len).fill(NaN),
    demandMW: demand ? onGrid(demand, startMs, len) : sum([""]),
    windMW: sum(["wind"]),
    solarMW: sum(["solar"]),
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
  const startMs = capital.t[0];
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
    const u = residual / (k.base * 1.25);
    let price = 22 + 130 * Math.max(u, 0) ** 2.2;
    if (u < 0.18) price = -20 + 200 * u; // glut → negative prices
    priceAUD.push(Math.round(price * 10) / 10);
    demandMW.push(Math.round(demand));
    windMW.push(Math.round(windOut));
    solarMW.push(Math.round(solarOut));
  }
  return { startMs, intervalH: 0.5, t, priceAUD, demandMW, windMW, solarMW };
}

export async function buildSeriesPayload(): Promise<SeriesPayload> {
  const results = await Promise.all(
    REGIONS.map((r) =>
      (r.network === "WEM" ? fetchRegionSeries("WEM") : fetchRegionSeries("NEM", r.code)).catch(
        () => null,
      ),
    ),
  );
  const anyOk = results.some((r) => r !== null);
  const endMs = Math.floor(Date.now() / 3600_000) * 3600_000;
  const regions: Record<string, RegionSeriesData> = {};
  REGIONS.forEach((meta, i) => {
    regions[meta.code] = results[i] ?? synthSeries(meta.code, endMs);
  });
  return { demo: !anyOk, updatedAt: new Date().toISOString(), regions };
}
