// Macro context for the LAB: FX (live, keyless via Frankfurter/ECB),
// Australian CPI (attempted live from the ABS API, otherwise a labelled
// reference), and fuel-cost reference levels (no free live feed exists for
// Newcastle coal / east-coast gas — these are maintained reference values).
//
// Honesty note baked into the payload: each block carries `live` so the UI
// can label reference data as such. For the LAB's 24-72h horizon these are
// level/context inputs, not short-run drivers — weather and outages dominate.

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
  cpi: { live: boolean; asOf: string; yoyPct: number; note: string };
  fuels: {
    live: boolean;
    asOf: string;
    newcastleCoalUsdT: number;
    eastCoastGasAudGj: number;
    note: string;
  };
}

const FX_HOSTS = ["https://api.frankfurter.dev/v1", "https://api.frankfurter.app"];

async function fetchFx(): Promise<MacroPayload["fx"] | null> {
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

async function fetchCpi(): Promise<MacroPayload["cpi"] | null> {
  try {
    // ABS Indicator API (keyless). If the dataflow shape changes this fails
    // gracefully to the reference value.
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
    return { live: true, asOf: "latest ABS quarter", yoyPct: yoy, note: "ABS CPI, annual change" };
  } catch {
    return null;
  }
}

export async function buildMacroPayload(): Promise<MacroPayload> {
  const [fx, cpi] = await Promise.all([fetchFx(), fetchCpi()]);
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
    cpi:
      cpi ?? {
        live: false,
        asOf: "FY25-26 reference",
        yoyPct: 3.0,
        note: "reference value — ABS feed unavailable",
      },
    fuels: {
      live: false,
      asOf: "2026 reference",
      newcastleCoalUsdT: 105,
      eastCoastGasAudGj: 12,
      note: "no free live feed for coal/gas — maintained reference levels",
    },
  };
}
