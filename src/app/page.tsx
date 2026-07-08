import type { Metadata } from "next";
import Link from "next/link";

// Static, crawlable landing page: explains the game for humans, search
// engines and AI agents alike. The game itself lives at /play.

export const metadata: Metadata = {
  title: "Energy Planet — the Australian energy trading game on live grid data",
  description:
    "A free browser game running on Australia's real electricity market. Buy power stations, keep them maintained, and earn the actual AEMO spot price — updated every 5 minutes. Plus a live 3D map of the grid, a hedging desk, and a what-if modeller for new energy projects.",
  openGraph: {
    title: "Energy Planet — play Australia's real electricity grid",
    description:
      "Run a generation company on live AEMO prices. Real power stations, real 5-minute spot data, SimCity-style sites.",
    type: "website",
  },
};

const JSON_LD = {
  "@context": "https://schema.org",
  "@type": "VideoGame",
  name: "Energy Planet",
  description:
    "A free browser strategy game built on Australia's real electricity market data. Players buy real power stations, maintain them, and earn the live AEMO wholesale spot price, updated every five minutes.",
  genre: ["Strategy", "Simulation", "Tycoon"],
  playMode: "SinglePlayer",
  applicationCategory: "Game",
  operatingSystem: "Web browser",
  offers: { "@type": "Offer", price: "0", priceCurrency: "AUD" },
};

function Chip({ children }: { children: React.ReactNode }) {
  return (
    <span
      className="rounded border px-2 py-0.5 font-[family-name:var(--f-mono)] text-[10px] tracking-widest text-[var(--ink-soft)]"
      style={{ borderColor: "var(--edge)" }}
    >
      {children}
    </span>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mx-auto w-full max-w-3xl px-6 py-10">
      <h2 className="mb-4 font-[family-name:var(--f-mono)] text-xs tracking-[0.25em] text-[var(--gen)]">
        {title}
      </h2>
      <div className="space-y-3 text-[15px] leading-relaxed text-[var(--ink)]/90">{children}</div>
    </section>
  );
}

export default function Landing() {
  return (
    <main className="h-dvh overflow-y-auto" style={{ background: "var(--bg)", color: "var(--ink)" }}>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(JSON_LD) }} />

      {/* Hero */}
      <div className="mx-auto flex w-full max-w-3xl flex-col items-start gap-6 px-6 pb-10 pt-20">
        <div className="flex flex-wrap gap-1.5">
          <Chip>FREE BROWSER GAME</Chip>
          <Chip>LIVE AEMO DATA · 5-MIN</Chip>
          <Chip>NO DOWNLOAD</Chip>
        </div>
        <h1 className="text-4xl font-semibold leading-tight sm:text-5xl">
          Run a power company on{" "}
          <span style={{ color: "var(--gen)" }}>Australia&apos;s real electricity grid</span>.
        </h1>
        <p className="max-w-xl text-lg text-[var(--ink-soft)]">
          Buy real power stations. Keep the turbines spinning, the panels clean and the coal trains
          coming. Every megawatt you send out earns the <em>actual</em> wholesale spot price, live
          from the Australian Energy Market Operator.
        </p>
        <div className="flex flex-wrap gap-3">
          <Link
            href="/play"
            className="rounded-lg px-5 py-2.5 font-[family-name:var(--f-mono)] text-sm tracking-widest"
            style={{ background: "var(--gen)", color: "#0b0d11" }}
          >
            ▶ PLAY NOW
          </Link>
          <Link
            href="/login"
            className="rounded-lg border px-5 py-2.5 font-[family-name:var(--f-mono)] text-sm tracking-widest text-[var(--ink)]"
            style={{ borderColor: "var(--edge)" }}
          >
            SIGN UP / SIGN IN
          </Link>
        </div>
        <p className="text-xs text-[var(--ink-soft)]">
          No account needed to play — sign up for cloud saves and the leaderboard.
        </p>
      </div>

      <div className="border-t" style={{ borderColor: "var(--edge)" }} />

      <Section title="WHAT&apos;S INSIDE — SIX VIEWS">
        <div className="grid gap-3 sm:grid-cols-2">
          {[
            {
              tab: "POWER",
              title: "The live grid",
              body: "A 3D globe of Australia\u2019s power system: generation vs demand columns per state, 300+ real power stations, interconnector flows, energy arcs into the cities, satellite imagery as you zoom.",
            },
            {
              tab: "PRICE",
              title: "Live & historic prices",
              body: "Wholesale spot per region in AEMO price bands, merchant vs retail comparison, and 7/90-day price history charts.",
            },
            {
              tab: "DESK",
              title: "The trading desk",
              body: "Set up a flat-rate retail book, paper-trade swaps and caps against the live market, backtest over real history, and get rule-based hedge signals.",
            },
            {
              tab: "BUILD",
              title: "What-if modeller",
              body: "Drop Snowy 2.0 or close Eraring and watch a merit-order model re-price the region \u2014 mix shift, capture prices, and the hit to your book.",
            },
            {
              tab: "OPS",
              title: "The game",
              body: "Found a company with $500m. Buy real stations, keep them maintained, earn the actual 5-minute spot price, climb the leaderboard.",
            },
            {
              tab: "LAB",
              title: "Weather & forecasting",
              body: "Live weather per region, spike-trimmed correlations, outage detection, and a time-travel price forecast you can snapshot and grade against reality.",
            },
          ].map((f) => (
            <div key={f.tab} className="rounded-xl border p-4" style={{ borderColor: "var(--edge)" }}>
              <div className="mb-1 flex items-center gap-2">
                <span
                  className="rounded px-1.5 py-0.5 font-[family-name:var(--f-mono)] text-[10px] tracking-widest"
                  style={{ background: "var(--gen)", color: "#0b0d11" }}
                >
                  {f.tab}
                </span>
                <span className="font-semibold">{f.title}</span>
              </div>
              <p className="text-sm text-[var(--ink-soft)]">{f.body}</p>
            </div>
          ))}
        </div>
      </Section>

      <div className="border-t" style={{ borderColor: "var(--edge)" }} />

      <Section title="HOW TO PLAY">
        <ol className="list-decimal space-y-2 pl-5">
          <li>
            Open <Link href="/play" className="underline">the app</Link> and pick the{" "}
            <b>OPS</b> tab. You start with <b>$500m</b>.
          </li>
          <li>
            <b>Buy stations</b> from the MARKET — they&apos;re real Australian generators, priced by
            capacity and fuel. Each one immediately starts earning its region&apos;s live AEMO spot
            price for every megawatt it sends out.
          </li>
          <li>
            <b>Maintain or decay</b> — panels gather dust, gearboxes wear, coal stocks run down,
            and output falls with condition. Hit FIX (costs cash, derates the asset while the crew
            works) and watch the ute roll out.
          </li>
          <li>
            <b>Visit your sites</b> — press ▶ SITE to dive from orbit into an isometric pixel-art
            scene of the asset running. Toggle <b>X-RAY</b> to see the machinery, tap the floating
            diamonds to inspect a component, fix it on the spot. Coal deliveries arrive by train.
          </li>
          <li>
            <b>Play the market</b> — prices spike in heatwaves and crash in sunny lunchtimes.
            Batteries love volatility; coal loves steady highs; solar earns nothing at night.
            Watch the LAB forecast to time your maintenance windows.
          </li>
          <li>
            <Link href="/login" className="underline">
              <b>Sign up</b>
            </Link>{" "}
            (free, passwordless) for cloud saves across devices and a spot on the leaderboard —
            ranked by company value. Or just play as a guest.
          </li>
        </ol>
        <div className="mt-4 rounded-xl border p-4 text-sm text-[var(--ink-soft)]" style={{ borderColor: "var(--edge)" }}>
          <b className="text-[var(--ink)]">Controls</b> — drag to rotate, scroll or pinch to zoom,
          click/tap anything that glows or floats. On the globe: click a station dot for its detail
          card, a state for its stats. On mobile the panel lives in a bottom sheet — tap the handle
          to expand. In site view: drag orbits, X-RAY reveals internals, diamonds mark what you can
          inspect.
        </div>
      </Section>

      <Section title="UNDER THE HOOD — THE MODELLING">
        <p className="text-[var(--ink-soft)]">
          The game doubles as a set of real quantitative models. Every technique below runs live in
          your browser, on real data, with deterministic seeds — the same inputs always reproduce
          the same numbers, and anything that isn&apos;t live is labelled a reference value.
        </p>
        <div className="space-y-3">
          {[
            {
              where: "LAB",
              name: "Short-horizon price forecast (24–72h)",
              body: "Transparent regressions fitted to the last 7 days of real 30-minute data: wind generation ~ wind speed cubed, solar ~ irradiance, demand ~ hour-of-day plus heating/cooling degrees, and price ~ thermal utilisation (residual demand over the rolling 48-hour max of coal+gas output — so a tripped unit reprices the curve automatically). Prices are winsorized for the fit so spikes don’t crush least-squares. The fits then run over the live weather forecast to project price, demand and renewables forward.",
            },
            {
              where: "LAB",
              name: "Monte-Carlo price fan + calibration scoring",
              body: "240 simulated paths built by block-bootstrapping the model’s own in-sample errors (4-hour blocks preserve spike clustering; raw residuals keep the fat upper tail) around the deterministic forecast, giving P10–P90 bands. Snapshots store the fan, and when reality catches up the scorecard reports the actual hit-rate inside the band against the ~80% nominal — the forecast’s honesty is measured, not asserted.",
            },
            {
              where: "DESK",
              name: "Structural 12-month spot simulation",
              body: "For quarterly horizons the game simulates the physics instead of bootstrapping history: every registered coal and gas station is split into unit blocks, and each unit runs a daily Markov chain — forced trips, lognormal repairs, and a small catastrophic tail (months offline, the Callide scenario). Seasonal demand with heatwave shocks and AR(1) renewables paths feed a convex utilisation→price curve calibrated so a median year reproduces the last 90 days’ average. A big unit failure shifts the price regime for the whole repair — a spiky quarter, not a spiky half-hour. Outputs: distributions of quarterly average prices and your retail book’s 12-month margin.",
            },
            {
              where: "BUILD",
              name: "Merit-order what-if",
              body: "Adding or closing a plant re-dispatches a stylised merit-order model over the last 7 days of real prices: price impact, generation-mix shift, the new asset’s capture price (including self-cannibalisation for wind and solar), and the flow-through to your retail book.",
            },
            {
              where: "BUILD",
              name: "Project finance with risk",
              body: "Developer-grade appraisal per asset: LCOE/LCOS, NPV, IRR and payback, with the WACC default seeded live from the RBA cash rate plus an equity premium and inflation from the CPI. A 600-run Monte Carlo bootstraps annual price levels from observed history and adds a right-skewed capex-overrun draw and a systematic capacity-factor error — giving NPV/IRR distributions, P(NPV>0) and a lifetime capture-price fan. Every assumption is editable and the outputs reflow live.",
            },
            {
              where: "/NORTHSEA",
              name: "Platform-repurposing feasibility (UK North Sea)",
              body: "A separate research tool on the same engines: screening end-of-life oil & gas platforms for AI-compute second lives (wind adjacency, fibre-through-pipeline backhaul, topside weight budgets), then appraising decommission-now vs compute vs hydrogen vs an operator-sponsored anchor tenancy on shared Monte-Carlo paths — with live GB market data from Elexon and Bank of England macro.",
            },
          ].map((m) => (
            <div key={m.name} className="rounded-xl border p-4" style={{ borderColor: "var(--edge)" }}>
              <div className="mb-1 flex items-center gap-2">
                <span
                  className="rounded px-1.5 py-0.5 font-[family-name:var(--f-mono)] text-[10px] tracking-widest"
                  style={{ background: "var(--gen)", color: "#0b0d11" }}
                >
                  {m.where}
                </span>
                <span className="font-semibold">{m.name}</span>
              </div>
              <p className="text-sm text-[var(--ink-soft)]">{m.body}</p>
            </div>
          ))}
        </div>
        <p className="text-sm text-[var(--ink-soft)]">
          Shared machinery: seeded Mulberry32 PRNG (reproducible runs), Box–Muller normals,
          winsorized robust fits, block and annual bootstraps, and a macro pipeline that ingests
          RBA/ABS (and Bank of England/ONS) series into a normalised store. Known limits, stated
          plainly: the price formation is a stylised merit-order proxy, not a dispatch engine;
          short-horizon models assume the recent window is representative; outage rates in the
          structural simulator are reference values, not unit history.
        </p>
        <p>
          Curious about the North Sea research tool?{" "}
          <Link href="/northsea" className="underline">
            Open the feasibility study
          </Link>
          .
        </p>
      </Section>

      <div className="border-t" style={{ borderColor: "var(--edge)" }} />

      <Section title="THE DATA IS REAL">
        <p>
          Generation, demand, prices and interconnector flows come from{" "}
          <a className="underline" href="https://visualisations.aemo.com.au" target="_blank" rel="noopener noreferrer">
            AEMO
          </a>{" "}
          and{" "}
          <a className="underline" href="https://openelectricity.org.au" target="_blank" rel="noopener noreferrer">
            OpenElectricity
          </a>{" "}
          public feeds, refreshed every five minutes, covering the five NEM regions and Western
          Australia&apos;s SWIS. The power stations are real — names, locations, fuels and
          capacities from the national facility register.
        </p>
        <p className="text-sm text-[var(--ink-soft)]">
          Everything else is simulation: the trading is paper-only, the maintenance economics are
          tuned for fun, and nothing connects to any real market system. Not financial advice;
          not affiliated with AEMO. Zoom imagery © Esri.
        </p>
      </Section>

      <div className="border-t" style={{ borderColor: "var(--edge)" }} />

      <footer className="mx-auto flex w-full max-w-3xl flex-wrap items-center justify-between gap-3 px-6 py-8 font-[family-name:var(--f-mono)] text-[10px] tracking-wider text-[var(--ink-soft)]">
        <span>ENERGY PLANET · built on open data</span>
        <span className="flex gap-4">
          <Link href="/play" className="underline">
            PLAY
          </Link>
          <Link href="/login" className="underline">
            SIGN IN
          </Link>
          <a href="/llms.txt" className="underline">
            LLMS.TXT
          </a>
        </span>
      </footer>
    </main>
  );
}
