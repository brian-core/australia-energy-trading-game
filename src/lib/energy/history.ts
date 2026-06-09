import { REGIONS } from "./regions";
import { DEMO_REGION_DATA } from "./demo-data";
import { fetchJsonWithHostFallback } from "./sources";

// Historic spot prices per region.
//
//  - 7d window: OpenElectricity per-region 30-minute price series (the same
//    7d stats file the live view uses).
//  - 90d window: daily volume-weighted price derived from the yearly energy
//    files (explicit price series when present, otherwise market_value /
//    energy summed across fuel techs).
//
// When feeds are unreachable a deterministic synthetic series is generated
// per region (typical double-peak intraday shape, solar midday dip,
// occasional spikes and negative midday prices) and flagged demo:true.

export type PricePoint = [epochMs: number, priceAUD: number];

export type HistoryWindow = "7d" | "90d";

export interface HistoryPayload {
  window: HistoryWindow;
  intervalHours: number;
  demo: boolean;
  regions: Record<string, PricePoint[]>;
}

interface OeSeries {
  id?: string;
  type?: string;
  units?: string;
  fuel_tech?: string;
  history?: { start?: string; interval?: string; data?: Array<number | null> };
}

function intervalToHours(interval: string | undefined): number | null {
  if (!interval) return null;
  const m = interval.match(/^(\d+)(m|h|d)$/i);
  if (!m) return null;
  const n = Number(m[1]);
  return m[2] === "m" ? n / 60 : m[2] === "h" ? n : n * 24;
}

function seriesPoints(series: OeSeries): PricePoint[] {
  const start = series.history?.start ? Date.parse(series.history.start) : NaN;
  const hours = intervalToHours(series.history?.interval);
  const data = series.history?.data;
  if (!Number.isFinite(start) || !hours || !Array.isArray(data)) return [];
  const out: PricePoint[] = [];
  data.forEach((v, i) => {
    if (typeof v === "number" && Number.isFinite(v)) {
      out.push([start + i * hours * 3600_000, v]);
    }
  });
  return out;
}

async function fetch7dPrices(network: "NEM" | "WEM", region?: string): Promise<PricePoint[]> {
  const path = region
    ? `/v3/stats/au/${network}/${region}/power/7d.json`
    : `/v3/stats/au/${network}/power/7d.json`;
  const json = (await fetchJsonWithHostFallback(path, 300)) as { data?: OeSeries[] };
  if (!Array.isArray(json.data)) throw new Error(`unexpected payload ${path}`);
  const price = json.data.find((s) => s.type === "price" || s.id?.endsWith(".price"));
  const points = price ? seriesPoints(price) : [];
  if (points.length < 10) throw new Error(`no price series in ${path}`);
  return points;
}

async function fetchDailyPrices(
  network: "NEM" | "WEM",
  region: string | undefined,
  days: number,
): Promise<PricePoint[]> {
  const now = new Date();
  const years = new Set([now.getUTCFullYear()]);
  const fromMs = now.getTime() - days * 86400_000;
  years.add(new Date(fromMs).getUTCFullYear());

  const all: PricePoint[] = [];
  for (const year of [...years].sort()) {
    const path = region
      ? `/v3/stats/au/${network}/${region}/energy/${year}.json`
      : `/v3/stats/au/${network}/energy/${year}.json`;
    const json = (await fetchJsonWithHostFallback(path, 3600)) as { data?: OeSeries[] };
    if (!Array.isArray(json.data)) throw new Error(`unexpected payload ${path}`);

    const explicit = json.data.find((s) => s.type === "price" || s.id?.endsWith(".price"));
    if (explicit) {
      all.push(...seriesPoints(explicit));
      continue;
    }
    // Derive daily volume-weighted price: sum(market_value) / sum(energy).
    const value = new Map<number, number>();
    const energy = new Map<number, number>();
    for (const s of json.data) {
      const isValue = s.type === "market_value" || s.id?.includes(".market_value");
      const isEnergy = s.type === "energy" || s.id?.includes(".energy");
      if (!isValue && !isEnergy) continue;
      for (const [ts, v] of seriesPoints(s)) {
        const map = isValue ? value : energy;
        map.set(ts, (map.get(ts) ?? 0) + v);
      }
    }
    for (const [ts, mv] of value) {
      const e = energy.get(ts);
      // market_value $ / energy GWh -> $/MWh
      if (e && e > 0) all.push([ts, mv / (e * 1000)]);
    }
  }
  const cutoff = now.getTime() - days * 86400_000;
  const points = all.filter(([ts]) => ts >= cutoff).sort((a, b) => a[0] - b[0]);
  if (points.length < 10) throw new Error(`no daily prices for ${region ?? network}`);
  return points;
}

// ---------------------------------------------------------------------------
// Deterministic synthetic fallback

function hash01(n: number): number {
  const x = Math.sin(n) * 43758.5453;
  return x - Math.floor(x);
}

function seedOf(code: string): number {
  return [...code].reduce((s, c) => s + c.charCodeAt(0), 0);
}

/** Higher solar penetration = deeper midday dip and more negative prices. */
const SOLAR_DIP: Record<string, number> = {
  SA1: 0.55, VIC1: 0.35, QLD1: 0.4, NSW1: 0.35, TAS1: 0.1, WEM: 0.45,
};

function synthSeries(code: string, count: number, intervalHours: number, endMs: number): PricePoint[] {
  const base = DEMO_REGION_DATA[code]?.priceAUD ?? 90;
  const seed = seedOf(code);
  const dip = SOLAR_DIP[code] ?? 0.3;
  const points: PricePoint[] = [];
  for (let i = 0; i < count; i++) {
    const ts = endMs - (count - 1 - i) * intervalHours * 3600_000;
    let price: number;
    if (intervalHours < 24) {
      // AEST-ish intraday shape: morning shoulder, solar dip, evening peak.
      const h = (new Date(ts).getUTCHours() + 10 + new Date(ts).getUTCMinutes() / 60) % 24;
      const shape =
        0.62 +
        0.85 * Math.exp(-((h - 18.7) ** 2) / 5) +
        0.3 * Math.exp(-((h - 7.5) ** 2) / 4) -
        dip * Math.exp(-((h - 12.5) ** 2) / 7);
      price = base * shape * (0.8 + 0.4 * hash01(seed + i * 1.37));
      const spikeRoll = hash01(seed * 7.13 + i);
      if (spikeRoll > 0.992) price *= 8 + 50 * hash01(seed + i * 3.1);
      if (h > 10.5 && h < 14.5 && hash01(seed * 3.7 + i) > 0.9) {
        price = -10 - 40 * hash01(seed + i * 5.3);
      }
    } else {
      // Daily VWA: gentler weekly rhythm + occasional expensive day.
      const day = Math.floor(ts / 86400_000);
      price = base * (0.8 + 0.4 * hash01(seed + day * 1.61) + 0.15 * Math.sin(day / 3.5));
      if (hash01(seed * 5.77 + day) > 0.96) price *= 2.2 + 2.5 * hash01(seed + day);
    }
    points.push([ts, Math.round(price * 10) / 10]);
  }
  return points;
}

// ---------------------------------------------------------------------------

export async function buildHistoryPayload(window: HistoryWindow): Promise<HistoryPayload> {
  const intervalHours = window === "7d" ? 0.5 : 24;
  const results = await Promise.all(
    REGIONS.map((r) =>
      (window === "7d"
        ? r.network === "WEM"
          ? fetch7dPrices("WEM")
          : fetch7dPrices("NEM", r.code)
        : r.network === "WEM"
          ? fetchDailyPrices("WEM", undefined, 90)
          : fetchDailyPrices("NEM", r.code, 90)
      ).catch(() => null),
    ),
  );

  const anyReal = results.some((p) => p !== null);
  const endMs = Date.now();
  const count = window === "7d" ? 7 * 48 : 90;

  const regions: Record<string, PricePoint[]> = {};
  REGIONS.forEach((meta, i) => {
    regions[meta.code] = results[i] ?? synthSeries(meta.code, count, intervalHours, endMs);
  });

  return { window, intervalHours, demo: !anyReal, regions };
}
