// Weather feed for the LAB: hourly history (7d back) + forecast (7d ahead)
// per region from Open-Meteo (free, keyless). Two points per region: the
// capital (temperature drives demand) and a renewables-belt point (wind
// speed and solar radiation drive VRE output). Demo fallback generates
// coherent synthetic weather so correlations still exist offline.

export interface HourlySeries {
  /** Epoch ms for each hour, past..future. */
  t: number[];
  tempC: number[];
  windMs: number[];
  /** Shortwave radiation W/m². */
  radWm2: number[];
}

export interface RegionWeather {
  capital: HourlySeries;
  belt: HourlySeries;
  /** Index of the first future hour (== now boundary). */
  nowIdx: number;
}

export interface WeatherPayload {
  demo: boolean;
  updatedAt: string;
  regions: Record<string, RegionWeather>;
}

/** [capitalLat, capitalLng, beltLat, beltLng] per region. */
export const WEATHER_POINTS: Record<string, [number, number, number, number]> = {
  QLD1: [-27.47, 153.03, -26.7, 151.0],
  NSW1: [-33.87, 151.21, -34.5, 148.9],
  VIC1: [-37.81, 144.96, -37.9, 143.0],
  SA1: [-34.93, 138.6, -33.5, 138.0],
  TAS1: [-42.88, 147.33, -41.0, 145.5],
  WEM: [-31.95, 115.86, -31.0, 116.5],
};

interface OpenMeteoHourly {
  time: string[];
  temperature_2m: number[];
  wind_speed_100m: number[];
  shortwave_radiation: number[];
}

async function fetchPoint(lat: number, lng: number): Promise<HourlySeries> {
  const url =
    `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}` +
    `&hourly=temperature_2m,wind_speed_100m,shortwave_radiation` +
    `&windspeed_unit=ms&past_days=7&forecast_days=7&timezone=UTC`;
  const res = await fetch(url, { next: { revalidate: 1800 } });
  if (!res.ok) throw new Error(`open-meteo ${res.status}`);
  const json = (await res.json()) as { hourly?: OpenMeteoHourly };
  const h = json.hourly;
  if (!h?.time?.length) throw new Error("open-meteo empty");
  return {
    t: h.time.map((s) => Date.parse(s + "Z")),
    tempC: h.temperature_2m,
    windMs: h.wind_speed_100m,
    radWm2: h.shortwave_radiation,
  };
}

// ---------------------------------------------------------------------------
// Deterministic synthetic weather (offline / demo). Shapes chosen so the
// demo generation/demand series derived from it produce real correlations.

function hash01(n: number): number {
  const x = Math.sin(n * 127.1) * 43758.5453;
  return x - Math.floor(x);
}

export function synthHourly(seed: number, hours: number, endMs: number): HourlySeries {
  const t: number[] = [];
  const tempC: number[] = [];
  const windMs: number[] = [];
  const radWm2: number[] = [];
  const startMs = endMs - (hours - 1) * 3600_000;
  for (let i = 0; i < hours; i++) {
    const ts = startMs + i * 3600_000;
    const hod = (new Date(ts).getUTCHours() + 10) % 24; // AEST-ish
    const day = Math.floor(ts / 86400_000);
    t.push(ts);
    // Temperature: diurnal swing + multi-day weather systems.
    tempC.push(
      19 +
        6 * Math.sin((Math.PI * (hod - 9)) / 12) +
        5 * Math.sin(day / 2.3 + seed) +
        2 * (hash01(seed + i * 1.7) - 0.5),
    );
    // Wind: slow synoptic waves + gusty noise.
    windMs.push(
      Math.max(
        0.5,
        7 + 4.5 * Math.sin(day / 1.7 + seed * 2 + i / 19) + 3.5 * (hash01(seed * 3 + i) - 0.5) * 2,
      ),
    );
    // Solar radiation: clear-sky bell with random cloudiness.
    const sun = Math.sin((Math.PI * (hod - 6)) / 13);
    const cloud = 0.55 + 0.45 * hash01(seed * 7 + day * 3 + Math.floor(i / 5));
    radWm2.push(sun > 0 ? Math.round(950 * Math.pow(sun, 1.2) * cloud) : 0);
  }
  return { t, tempC, windMs, radWm2 };
}

export async function buildWeatherPayload(): Promise<WeatherPayload> {
  const codes = Object.keys(WEATHER_POINTS);
  const results = await Promise.all(
    codes.map(async (code) => {
      const [clat, clng, blat, blng] = WEATHER_POINTS[code];
      try {
        const [capital, belt] = await Promise.all([fetchPoint(clat, clng), fetchPoint(blat, blng)]);
        return { code, capital, belt, ok: true };
      } catch {
        return { code, capital: null, belt: null, ok: false };
      }
    }),
  );

  const anyOk = results.some((r) => r.ok);
  const now = Date.now();
  const regions: Record<string, RegionWeather> = {};
  for (const r of results) {
    let capital = r.capital;
    let belt = r.belt;
    if (!capital || !belt) {
      const seed = r.code.charCodeAt(0) + r.code.charCodeAt(1);
      // 7d past + 7d future on the hour grid.
      const endMs = Math.ceil(now / 3600_000) * 3600_000 + 7 * 24 * 3600_000;
      capital = synthHourly(seed, 14 * 24, endMs);
      belt = synthHourly(seed * 1.7 + 5, 14 * 24, endMs);
    }
    const nowIdx = capital.t.findIndex((ts) => ts > now);
    regions[r.code] = { capital, belt, nowIdx: nowIdx === -1 ? capital.t.length : nowIdx };
  }
  return { demo: !anyOk, updatedAt: new Date(now).toISOString(), regions };
}
