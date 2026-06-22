// Macro context for the LAB and the BUILD project-finance defaults:
//   - FX (live, keyless via Frankfurter/ECB),
//   - RBA cash-rate target and CPI (headline + trimmed mean), read from the
//     macro_observations table populated by /api/energy/macro/ingest, with a
//     graceful fall back to the ABS Indicator API and then labelled reference
//     values,
//   - fuel-cost reference levels (no free live feed exists for Newcastle coal /
//     east-coast gas — maintained reference values).
//
// Honesty note baked into the payload: each block carries `live` so the UI can
// label reference data as such.

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export interface MacroPayload {
  updatedAt: string;
  fx: {
    live: boolean;
    asOf: string;
    audUsd: number;
    audEur: number;
    audJpy: number;
    /** ~90-day AUD/USD trend, weekly points [epochMs, rate]. */
    trend: Array<[number, number]>;
  };
  /** RBA cash-rate target (per cent). Powers the BUILD WACC default. */
  cashRate: { live: boolean; asOf: string; pct: number };
  cpi: {
    live: boolean;
    asOf: string;
    /** Year-ended headline CPI inflation, per cent. */
    yoyPct: number;
    /** Year-ended trimmed-mean (underlying) inflation, per cent — null when unknown. */
    trimmedMeanPct: number | null;
    note: string;
  };
  fuels: {
    live: boolean;
    asOf: string;
    newcastleCoalUsdT: number;
    eastCoastGasAudGj: number;
    note: string;
  };
}

const FX_HOSTS = ["https://api.frankfurter.dev/v1", "https://api.frankfurter.app"];

export async function fetchFx(): Promise<MacroPayload["fx"] | null> {
  for (const host of FX_HOSTS) {
    try {
      const latest = (await (
        await fetch(`${host}/latest?base=AUD&symbols=USD,EUR,JPY`, { next: { revalidate: 3600 } })
      ).json()) as { date?: string; rates?: Record<string, number> };
      if (!latest.rates?.USD) continue;
      const end = latest.date ?? new Date().toISOString().slice(0, 10);
      const start = new Date(Date.now() - 90 * 86400_000).toISOString().slice(0, 10);
      let trend: Array<[number, number]> = [];
      try {
        const hist = (await (
          await fetch(`${host}/${start}..${end}?base=AUD&symbols=USD`, { next: { revalidate: 21600 } })
        ).json()) as { rates?: Record<string, { USD?: number }> };
        trend = Object.entries(hist.rates ?? {})
          .map(([d, r]) => [Date.parse(d), r.USD ?? NaN] as [number, number])
          .filter(([, v]) => Number.isFinite(v))
          .sort((a, b) => a[0] - b[0])
          .filter((_, i) => i % 5 === 0);
      } catch {
        // trend optional
      }
      return {
        live: true,
        asOf: end,
        audUsd: latest.rates.USD,
        audEur: latest.rates.EUR ?? NaN,
        audJpy: latest.rates.JPY ?? NaN,
        trend,
      };
    } catch {
      // try next host
    }
  }
  return null;
}

/** Latest year-ended headline CPI from the ABS Indicator API (keyless). */
export async function fetchAbsCpi(): Promise<{ yoyPct: number } | null> {
  try {
    // If the dataflow shape changes this fails gracefully to the reference value.
    const res = await fetch(
      "https://data.api.abs.gov.au/rest/data/ABS,CPI,1.0.0/3.10001.10.50.Q?lastNObservations=1&format=jsondata",
      { next: { revalidate: 86400 }, headers: { Accept: "application/vnd.sdmx.data+json" } },
    );
    if (!res.ok) return null;
    const json = (await res.json()) as {
      data?: { dataSets?: Array<{ series?: Record<string, { observations?: Record<string, number[]> }> }> };
    };
    const series = json.data?.dataSets?.[0]?.series;
    const first = series && Object.values(series)[0];
    const obs = first?.observations && Object.values(first.observations)[0];
    const yoy = obs?.[0];
    if (typeof yoy !== "number" || yoy < -5 || yoy > 30) return null;
    return { yoyPct: yoy };
  } catch {
    return null;
  }
}

// Series IDs read from macro_observations.
const SERIES = {
  cashRate: "FIRMMCRT", // RBA cash rate target
  cpiHeadlineYoy: "GCPIAGYP", // year-ended headline CPI inflation
  cpiTrimmedYoy: "GCPIOCPMTMYP", // year-ended trimmed-mean inflation
} as const;

let readClient: SupabaseClient | null | undefined;

function getReadClient(): SupabaseClient | null {
  if (readClient !== undefined) return readClient;
  // macro_observations is anon-readable (RLS select using true), so the public
  // anon/publishable key is sufficient — never the service-role key here.
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  readClient = url && key ? createClient(url, key, { auth: { persistSession: false } }) : null;
  return readClient;
}

interface DbMacro {
  cashRate?: { asOf: string; pct: number };
  cpiHeadline?: { asOf: string; yoyPct: number };
  cpiTrimmed?: number;
}

/** Read the latest cash-rate and CPI observations from Supabase. */
async function readMacroFromDb(): Promise<DbMacro> {
  const sb = getReadClient();
  if (!sb) return {};
  try {
    const ids = [SERIES.cashRate, SERIES.cpiHeadlineYoy, SERIES.cpiTrimmedYoy];
    const { data, error } = await sb
      .from("macro_observations")
      .select("series_id, obs_date, value")
      .eq("source", "RBA")
      .in("series_id", ids)
      .order("obs_date", { ascending: false });
    if (error || !data) return {};
    // First row per series is the most recent (ordered desc).
    const latest = new Map<string, { obs_date: string; value: number }>();
    for (const row of data as Array<{ series_id: string; obs_date: string; value: number | null }>) {
      if (row.value == null || latest.has(row.series_id)) continue;
      latest.set(row.series_id, { obs_date: row.obs_date, value: row.value });
    }
    const cash = latest.get(SERIES.cashRate);
    const head = latest.get(SERIES.cpiHeadlineYoy);
    const trim = latest.get(SERIES.cpiTrimmedYoy);
    return {
      cashRate: cash ? { asOf: cash.obs_date, pct: cash.value } : undefined,
      cpiHeadline: head ? { asOf: head.obs_date, yoyPct: head.value } : undefined,
      cpiTrimmed: trim?.value,
    };
  } catch {
    return {};
  }
}

export async function buildMacroPayload(): Promise<MacroPayload> {
  const [fx, db] = await Promise.all([fetchFx(), readMacroFromDb()]);
  // CPI: prefer the DB (RBA/ABS, richer), then the ABS API, then reference.
  const absCpi = db.cpiHeadline ? null : await fetchAbsCpi();

  const cpi: MacroPayload["cpi"] = db.cpiHeadline
    ? {
        live: true,
        asOf: db.cpiHeadline.asOf,
        yoyPct: db.cpiHeadline.yoyPct,
        trimmedMeanPct: db.cpiTrimmed ?? null,
        note: "RBA G1 — year-ended CPI inflation",
      }
    : absCpi
      ? {
          live: true,
          asOf: "latest ABS quarter",
          yoyPct: absCpi.yoyPct,
          trimmedMeanPct: null,
          note: "ABS CPI, annual change",
        }
      : {
          live: false,
          asOf: "FY25-26 reference",
          yoyPct: 3.0,
          trimmedMeanPct: 3.2,
          note: "reference value — CPI feed unavailable",
        };

  const cashRate: MacroPayload["cashRate"] = db.cashRate
    ? { live: true, asOf: db.cashRate.asOf, pct: db.cashRate.pct }
    : { live: false, asOf: "2026 reference", pct: 3.85 };

  return {
    updatedAt: new Date().toISOString(),
    fx:
      fx ?? {
        live: false,
        asOf: "reference",
        audUsd: 0.66,
        audEur: 0.61,
        audJpy: 102,
        trend: [],
      },
    cashRate,
    cpi,
    fuels: {
      live: false,
      asOf: "2026 reference",
      newcastleCoalUsdT: 105,
      eastCoastGasAudGj: 12,
      note: "no free live feed for coal/gas — maintained reference levels",
    },
  };
}
