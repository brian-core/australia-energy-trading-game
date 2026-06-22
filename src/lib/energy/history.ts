import { REGIONS } from "./regions";
import { DEMO_REGION_DATA } from "./demo-data";
import { oeFetch, toNetworkNaive, type OeRow } from "./sources";

// Historic spot prices per region, from the OpenElectricity v4 market API.
//
//  - 7d window: 5-minute spot price series.
//  - 90d window: daily average price (interval=1d) directly from the API.
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

function rowsToPoints(rows: OeRow[]): PricePoint[] {
  const out: PricePoint[] = [];
  for (const [ts, v] of rows) {
    const ms = Date.parse(ts);
    if (Number.isFinite(ms) && typeof v === "number" && Number.isFinite(v)) out.push([ms, v]);
  }
  return out.sort((a, b) => a[0] - b[0]);
}

/** Price series per region for a network over the last `days` at `interval`. */
async function fetchNetworkPrices(
  network: "NEM" | "WEM",
  interval: "5m" | "1d",
  days: number,
): Promise<Map<string, PricePoint[]>> {
  const dateStart = toNetworkNaive(network, Date.now() - days * 86400_000);
  const env = await oeFetch(
    `/market/network/${network}`,
    { metrics: "price", interval, primary_grouping: "network_region", date_start: dateStart },
    interval === "1d" ? 3600 : 300,
  );
  const block = env.data.find((b) => b.metric === "price");
  const out = new Map<string, PricePoint[]>();
  if (!block) return out;
  for (const r of block.results) {
    out.set(r.columns.region ?? network, rowsToPoints(r.data));
  }
  return out;
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
  const interval: "5m" | "1d" = window === "7d" ? "5m" : "1d";
  const days = window === "7d" ? 7 : 90;

  const [nem, wem] = await Promise.all([
    fetchNetworkPrices("NEM", interval, days).catch(() => null),
    fetchNetworkPrices("WEM", interval, days).catch(() => null),
  ]);

  const endMs = Date.now();
  const count = window === "7d" ? 7 * 48 : 90;

  let anyReal = false;
  const regions: Record<string, PricePoint[]> = {};
  REGIONS.forEach((meta) => {
    const region = meta.network === "WEM" ? "WEM" : meta.code;
    const pts = (meta.network === "WEM" ? wem : nem)?.get(region) ?? null;
    if (pts && pts.length >= 10) {
      anyReal = true;
      regions[meta.code] = pts;
    } else {
      regions[meta.code] = synthSeries(meta.code, count, intervalHours, endMs);
    }
  });

  return { window, intervalHours, demo: !anyReal, regions };
}
