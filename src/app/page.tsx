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
    <main className="h-screen overflow-y-auto" style={{ background: "var(--bg)", color: "var(--ink)" }}>
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

      <Section title="HOW IT WORKS">
        <ol className="list-decimal space-y-2 pl-5">
          <li>
            <b>Found your company</b> — you start with $500m and a market of 300+ real Australian
            generators: coal, gas, hydro, wind, solar and batteries, each priced by capacity.
          </li>
          <li>
            <b>Earn the live spot price</b> — your fleet&apos;s output sells at the real AEMO
            5-minute price for its region. A price spike in South Australia pays your battery;
            negative midday prices punish your solar farm.
          </li>
          <li>
            <b>Keep it maintained</b> — panels gather dust, gearboxes wear, coal stocks run down.
            Condition drives output. Dispatch a crew, watch the ute roll out, see the coal train
            arrive.
          </li>
          <li>
            <b>Walk your sites</b> — dive from orbit into a SimCity-style isometric scene of every
            asset, flick on X-ray to inspect the machinery, and fix what&apos;s failing.
          </li>
        </ol>
      </Section>

      <Section title="ALSO IN THE BOX">
        <p>
          <b>Live grid map</b> — a 3D globe of Australia&apos;s power system: generation vs demand
          per state, every major power station, interconnector flows, city supply arcs, and
          satellite imagery when you zoom in.
        </p>
        <p>
          <b>Prices</b> — live wholesale spot per region against benchmark retail rates, with 7-day
          and 90-day history.
        </p>
        <p>
          <b>Trading desk</b> — paper-trade swaps and caps against the live market for a
          hypothetical flat-rate energy retailer, with backtesting and hedge alerts.
        </p>
        <p>
          <b>Build modeller</b> — what does Snowy 2.0 or the Eraring closure do to prices? A
          stylised merit-order model answers, using real project data.
        </p>
      </Section>

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
