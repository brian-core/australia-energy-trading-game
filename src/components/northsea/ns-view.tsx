"use client";

// NORTH SEA — platform-repurposing feasibility view. Reads like a live
// feasibility study: a weighted screening ranker over the curated platform
// fleet, and per platform a numbered study (site → resource → concept →
// options appraisal → sensitivity → risk register) that recomputes on every
// edited assumption. Engines shared with the AU game (MC price paths,
// deterministic PRNG); GB market data from Elexon, macro from BoE/ONS.

import dynamic from "next/dynamic";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import cablesJson from "@/data/northsea/cables.json";
import platformsJson from "@/data/northsea/platforms.json";
import windfarmsJson from "@/data/northsea/windfarms.json";
import type { GbMarketPayload, UkMacro } from "@/lib/energy/gb";
import {
  DEFAULT_WEIGHTS,
  screenFleet,
  type CableLanding,
  type Platform,
  type ScreenResult,
  type ScreenWeights,
  type WindFarm,
} from "@/lib/energy/northsea";
import {
  buildYearShapes,
  conceptWeightTonnes,
  defaultConcept,
  runFeasibility,
  runTornado,
  type ConceptInputs,
} from "@/lib/energy/northsea-finance";
import PriceChart from "@/components/energy/price-chart";

const NsGlobe = dynamic(() => import("./ns-globe"), {
  ssr: false,
  loading: () => (
    <div className="flex h-full w-full items-center justify-center font-[family-name:var(--f-mono)] text-xs tracking-widest text-[var(--ink-soft)]">
      LOADING BASIN…
    </div>
  ),
});

const PLATFORMS = platformsJson.platforms as Platform[];
const FARMS = windfarmsJson.farms as WindFarm[];
const LANDINGS = cablesJson.landings as CableLanding[];

const EQUITY_PREMIUM = 0.04;

function gbpM(x: number): string {
  const sign = x < 0 ? "−" : "";
  const abs = Math.abs(x);
  if (abs >= 1000) return `${sign}£${(abs / 1000).toFixed(2)}bn`;
  return `${sign}£${abs.toFixed(0)}m`;
}

function Badge({ live, children }: { live: boolean; children: React.ReactNode }) {
  return (
    <span
      className="rounded border px-1 py-px text-[9px] tracking-widest"
      style={{ borderColor: "var(--edge)", color: live ? "#48a87c" : "#f2c14e" }}
    >
      {children}
    </span>
  );
}

function Section({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border p-3.5" style={{ borderColor: "var(--edge)" }}>
      <div className="mb-2 text-[11px] tracking-widest text-[var(--ink-soft)]">
        {n}. {title}
      </div>
      {children}
    </div>
  );
}

function Row({ k, v, warn }: { k: string; v: React.ReactNode; warn?: boolean }) {
  return (
    <div className="flex justify-between gap-3 text-[11px]">
      <span className="text-[var(--ink-soft)]">{k}</span>
      <span className="text-right" style={warn ? { color: "#e2483d" } : undefined}>
        {v}
      </span>
    </div>
  );
}

function NumField({
  label,
  value,
  step,
  suffix,
  onChange,
}: {
  label: string;
  value: number;
  step: number;
  suffix?: string;
  onChange: (v: number) => void;
}) {
  return (
    <label className="flex flex-col gap-0.5">
      <span className="text-[10px] tracking-wider text-[var(--ink-soft)]">{label}</span>
      <span className="flex items-center gap-1">
        <input
          type="number"
          value={value}
          step={step}
          onChange={(e) => onChange(Number(e.target.value))}
          className="w-full rounded border bg-black/30 px-1 py-0.5 text-right text-[11px]"
          style={{ borderColor: "var(--edge)" }}
        />
        {suffix && <span className="whitespace-nowrap text-[10px] text-[var(--ink-soft)]">{suffix}</span>}
      </span>
    </label>
  );
}

function WeightSlider({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <label className="flex items-center gap-2 text-[11px]">
      <span className="w-24 text-[var(--ink-soft)]">{label}</span>
      <input type="range" min={0} max={50} value={value} onChange={(e) => onChange(Number(e.target.value))} className="flex-1" />
      <span className="w-6 text-right">{value}</span>
    </label>
  );
}

function Tornado({ rows }: { rows: ReturnType<typeof runTornado> }) {
  const max = Math.max(...rows.map((r) => Math.max(Math.abs(r.lowGBPm), Math.abs(r.highGBPm))), 1);
  return (
    <div className="space-y-1">
      {rows.map((r) => (
        <div key={r.key} className="flex items-center gap-2 text-[10px]">
          <span className="w-36 shrink-0 text-[var(--ink-soft)]">{r.label}</span>
          <div className="relative h-3 flex-1">
            <div className="absolute inset-y-0 left-1/2 w-px bg-white/25" />
            {[r.lowGBPm, r.highGBPm].map((v, i) => (
              <div
                key={i}
                className="absolute inset-y-0.5 rounded-sm"
                style={{
                  left: v < 0 ? `${50 - (Math.abs(v) / max) * 50}%` : "50%",
                  width: `${(Math.abs(v) / max) * 50}%`,
                  background: v >= 0 ? "rgba(72,168,124,0.7)" : "rgba(226,72,61,0.7)",
                }}
              />
            ))}
          </div>
          <span className="w-24 shrink-0 text-right text-[var(--ink-soft)]">
            {gbpM(r.lowGBPm)} / {gbpM(r.highGBPm)}
          </span>
        </div>
      ))}
    </div>
  );
}

export default function NsView() {
  const [market, setMarket] = useState<GbMarketPayload | null>(null);
  const [macro, setMacro] = useState<UkMacro | null>(null);
  const [weights, setWeights] = useState<ScreenWeights>(DEFAULT_WEIGHTS);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [overrides, setOverrides] = useState<Partial<ConceptInputs>>({});
  const [size, setSize] = useState({ width: 0, height: 0 });
  const globeBox = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const [m, mk] = await Promise.all([
        fetch("/api/energy/gb/market").then((r) => r.json() as Promise<GbMarketPayload>).catch(() => null),
        fetch("/api/energy/gb/macro").then((r) => r.json() as Promise<UkMacro>).catch(() => null),
      ]);
      if (!cancelled) {
        setMarket(m);
        setMacro(mk);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const el = globeBox.current;
    if (!el) return;
    const obs = new ResizeObserver(([e]) => setSize({ width: e.contentRect.width, height: e.contentRect.height }));
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  const results: ScreenResult[] = useMemo(
    () => screenFleet(PLATFORMS, FARMS, LANDINGS, weights),
    [weights],
  );
  const sel = results.find((r) => r.platform.id === selectedId) ?? null;

  const shapes = useMemo(
    () => (market ? buildYearShapes(market.spot, market.windOffshoreMW, market.demo) : null),
    [market],
  );

  // Reset concept overrides when the platform changes.
  const [prevSel, setPrevSel] = useState(selectedId);
  if (prevSel !== selectedId) {
    setPrevSel(selectedId);
    setOverrides({});
  }

  const concept: ConceptInputs | null = useMemo(() => {
    if (!sel) return null;
    const base = defaultConcept(
      sel.platform,
      sel.distances.nearestWind?.km ?? 100,
      sel.distances.nearestLanding?.km ?? 150,
      macro
        ? { discountRate: macro.bankRate.pct / 100 + EQUITY_PREMIUM, inflation: macro.cpi.yoyPct / 100 }
        : undefined,
    );
    return { ...base, ...overrides };
  }, [sel, macro, overrides]);

  const feas = useMemo(
    () => (concept && shapes ? runFeasibility(concept, shapes) : null),
    [concept, shapes],
  );
  const tornado = useMemo(
    () => (concept && shapes ? runTornado(concept, shapes) : null),
    [concept, shapes],
  );

  const set = (k: keyof ConceptInputs) => (v: number) => setOverrides((o) => ({ ...o, [k]: v }));

  const computeW = concept ? conceptWeightTonnes(concept, "compute") : 0;
  const h2W = concept ? conceptWeightTonnes(concept, "h2") : 0;
  const intW = concept ? conceptWeightTonnes(concept, "interruptible") : 0;

  const spotAvg = market && market.spot.length ? market.spot.reduce((s, p) => s + p[1], 0) / market.spot.length : 0;

  return (
    <div className="fixed inset-0 overflow-hidden md:flex">
      {/* Study column */}
      <div
        className="z-10 flex flex-col rounded-xl border backdrop-blur max-md:absolute max-md:inset-x-0 max-md:bottom-0 max-md:max-h-[85dvh] md:m-4 md:h-[calc(100vh-2rem)] md:w-[480px] md:shrink-0 lg:w-[600px] xl:w-[680px]"
        style={{ background: "var(--panel)", borderColor: "var(--edge)" }}
      >
        <div className="shrink-0 p-4 pb-2">
          <div className="flex items-baseline justify-between gap-2">
            <h1 className="text-lg font-semibold leading-tight">North Sea — Platform Repurposing</h1>
            <Link
              href="/play"
              className="rounded border px-1.5 py-0.5 font-[family-name:var(--f-mono)] text-[9px] tracking-widest text-[var(--ink-soft)]"
              style={{ borderColor: "var(--edge)" }}
            >
              ← AU GRID
            </Link>
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-1.5 font-[family-name:var(--f-mono)]">
            <span className="text-[10px] tracking-widest text-[var(--ink-soft)]">
              LIVE FEASIBILITY STUDY · REV {new Date().toISOString().slice(0, 10)}
            </span>
            <Badge live={!!market && !market.demo}>GB SPOT {market ? (market.demo ? "DEMO" : "LIVE") : "…"}</Badge>
            <Badge live={!!macro?.bankRate.live}>BOE {macro?.bankRate.live ? `${macro.bankRate.pct.toFixed(2)}%` : "REF"}</Badge>
            <Badge live={!!macro?.cpi.live}>CPI {macro ? `${macro.cpi.yoyPct.toFixed(1)}%` : "…"}</Badge>
          </div>
        </div>

        <div className="hud-scroll min-h-0 space-y-3 overflow-y-auto px-4 pb-4 font-[family-name:var(--f-mono)] text-xs">
          {!sel && (
            <>
              <div className="text-[10px] leading-snug tracking-widest text-[var(--ink-soft)]">
                SCREENING {PLATFORMS.length} UKCS PLATFORMS FOR AI-COMPUTE / LDES / H2 SECOND LIVES. ADJUST THE
                WEIGHTS — THE FLEET RE-RANKS LIVE. CLICK A PLATFORM (TABLE OR GLOBE) TO OPEN ITS STUDY.
              </div>

              <Section n={1} title="SCREENING WEIGHTS">
                <div className="space-y-1.5">
                  <WeightSlider label="wind adjacency" value={weights.wind} onChange={(v) => setWeights({ ...weights, wind: v })} />
                  <WeightSlider label="fibre proximity" value={weights.fibre} onChange={(v) => setWeights({ ...weights, fibre: v })} />
                  <WeightSlider label="topside capacity" value={weights.capacity} onChange={(v) => setWeights({ ...weights, capacity: v })} />
                  <WeightSlider label="remaining life" value={weights.life} onChange={(v) => setWeights({ ...weights, life: v })} />
                  <WeightSlider label="pipeline reuse" value={weights.pipeline} onChange={(v) => setWeights({ ...weights, pipeline: v })} />
                </div>
                <div className="mt-1.5 text-[10px] leading-snug text-[var(--ink-soft)]">
                  fibre proximity is a screen for connectivity potential, not a guarantee of dark fibre.
                </div>
              </Section>

              <Section n={2} title={`RANKED FLEET — ${PLATFORMS.length} CANDIDATES`}>
                <table className="w-full">
                  <thead>
                    <tr className="text-left text-[10px] tracking-wider text-[var(--ink-soft)]">
                      <th className="pb-1">#</th>
                      <th>PLATFORM</th>
                      <th className="text-right">WIND KM</th>
                      <th className="text-right">FIBRE KM</th>
                      <th className="text-right">COP</th>
                      <th className="text-right">SCORE</th>
                    </tr>
                  </thead>
                  <tbody>
                    {results.map((r, i) => (
                      <tr
                        key={r.platform.id}
                        onClick={() => setSelectedId(r.platform.id)}
                        className="cursor-pointer text-[11px] hover:bg-white/5"
                      >
                        <td className="py-0.5 text-[var(--ink-soft)]">{i + 1}</td>
                        <td>{r.platform.name}</td>
                        <td className="text-right text-[var(--ink-soft)]">
                          {r.distances.nearestWind ? Math.round(r.distances.nearestWind.km) : "—"}
                        </td>
                        <td className="text-right text-[var(--ink-soft)]">
                          {r.distances.nearestLanding ? Math.round(r.distances.nearestLanding.km) : "—"}
                        </td>
                        <td className="text-right text-[var(--ink-soft)]">{r.platform.copYear}</td>
                        <td
                          className="text-right"
                          style={{ color: r.score >= 60 ? "#48a87c" : r.score >= 40 ? "#f2c14e" : "#d97a86" }}
                        >
                          {Math.round(r.score)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </Section>

              <Section n={3} title="GB MARKET CONTEXT">
                {market ? (
                  <>
                    <PriceChart points={market.spot} color="#6ea8dc" />
                    <div className="mt-1 text-[10px] text-[var(--ink-soft)]">
                      GB spot (Elexon MID) · 7-day avg £{spotAvg.toFixed(0)}/MWh
                      {market.demo && " · SYNTHETIC (feed unreachable)"}
                    </div>
                  </>
                ) : (
                  <div className="text-[10px] text-[var(--ink-soft)]">loading GB market…</div>
                )}
              </Section>

              <div className="text-[9px] leading-snug text-[var(--ink-soft)]">
                platform records curated from public sources (NSTA/OPRED programmes, OSPAR); tonnages and COP dates
                are screening estimates where flagged. wind: Crown Estate rounds · fibre: public cable references
                incl. Tampnet offshore network.
              </div>
            </>
          )}

          {sel && concept && (
            <>
              <button onClick={() => setSelectedId(null)} className="text-[10px] tracking-widest text-[var(--ink-soft)] hover:text-[var(--ink)]">
                ← BACK TO RANKED FLEET
              </button>

              {/* Executive summary */}
              <div className="rounded-lg border p-3.5" style={{ borderColor: feas && feas.compute.npvGBPm > feas.decomNow.npvGBPm ? "#48a87c" : "var(--edge)" }}>
                <div className="mb-1 flex items-baseline justify-between">
                  <span className="text-sm font-semibold">{sel.platform.name}</span>
                  <span className="text-[10px] text-[var(--ink-soft)]">
                    {sel.platform.operator} · screen score {Math.round(sel.score)} · rank{" "}
                    {results.findIndex((r) => r.platform.id === sel.platform.id) + 1}/{results.length}
                  </span>
                </div>
                {feas && (
                  <div className="space-y-0.5 text-[11px] leading-snug">
                    <div>
                      interruptible compute (v2) NPV{" "}
                      <span style={{ color: feas.interruptible.npvGBPm >= feas.decomNow.npvGBPm ? "#48a87c" : "#e2483d" }}>
                        {gbpM(feas.interruptible.npvGBPm)}
                      </span>{" "}
                      vs decom-now {gbpM(feas.decomNow.npvGBPm)} · P(beats decom){" "}
                      {Math.round(feas.interruptible.probBeatsDecom * 100)}% · effective utilisation{" "}
                      {Math.round(feas.interruptible.deliveredShare * 100)}%
                    </div>
                    <div className="text-[var(--ink-soft)]">
                      break-even rate £{Math.round(feas.interruptible.breakEvenRateGBPMWh)}/MWh-IT — the compute
                      equivalent of H2 at £{concept.h2PriceGBPkg.toFixed(2)}/kg · firm v1 comparator NPV{" "}
                      {gbpM(feas.compute.npvGBPm)}
                    </div>
                  </div>
                )}
              </div>

              <Section n={1} title="SITE & INFRASTRUCTURE">
                <div className="space-y-0.5">
                  <Row k="type / installed" v={`${sel.platform.type} · ${sel.platform.installedYear}`} />
                  <Row k="cessation of production" v={`${sel.platform.copYear} (${sel.platform.status})`} />
                  {sel.platform.nstaStatus && <Row k="NSTA registry status" v={sel.platform.nstaStatus} />}
                  <Row k="water depth" v={`${sel.platform.waterDepthM} m`} />
                  <Row k="topside weight budget" v={`${sel.platform.topsideTonnes.toLocaleString()} t${sel.platform.estimated.includes("topsideTonnes") ? " (est)" : ""}`} />
                  <Row
                    k="nearest wind"
                    v={
                      sel.distances.nearestWind
                        ? `${sel.distances.nearestWind.farm.name} · ${Math.round(sel.distances.nearestWind.km)} km`
                        : "—"
                    }
                  />
                  <Row k="wind pool ≤60 km" v={`${Math.round(sel.distances.windWithin60kmMW).toLocaleString()} MW`} />
                  <Row
                    k="nearest fibre landing"
                    v={
                      sel.distances.nearestLanding
                        ? `${sel.distances.nearestLanding.landing.name} · ${Math.round(sel.distances.nearestLanding.km)} km`
                        : "—"
                    }
                  />
                  <Row k="pipeline reuse" v={sel.platform.pipelineReuse ? "yes — H2 export credit" : "no"} />
                  {sel.platform.note && <div className="pt-1 text-[10px] leading-snug text-[var(--ink-soft)]">{sel.platform.note}</div>}
                  <div className="pt-1 text-[9px] text-[var(--ink-soft)]">source: {sel.platform.source}</div>
                </div>
              </Section>

              <Section n={2} title="POWER & RESOURCE">
                {market && (
                  <>
                    <PriceChart points={market.spot} color="#6ea8dc" />
                    <div className="mt-1 text-[10px] text-[var(--ink-soft)]">
                      GB spot 7d avg £{spotAvg.toFixed(0)}/MWh {market.demo && "· SYNTHETIC"} · year shapes tiled
                      from this window, seasonally modulated (screening approximation)
                    </div>
                  </>
                )}
              </Section>

              <Section n={3} title="DEVELOPMENT CONCEPT — EDIT & THE STUDY RECOMPUTES">
                <div className="grid grid-cols-2 gap-x-3 gap-y-1.5">
                  <NumField label="IT CAPACITY" value={concept.computeMW} step={10} suffix="MW" onChange={set("computeMW")} />
                  <NumField label="PUE" value={concept.pue} step={0.01} onChange={set("pue")} />
                  <NumField label="ALL-IN LEASE" value={concept.leaseKGBPPerMWyr} step={50} suffix="£k/MW-yr" onChange={set("leaseKGBPPerMWyr")} />
                  <NumField label="UTILISATION" value={Math.round(concept.utilisation * 100)} step={5} suffix="%" onChange={(v) => set("utilisation")(v / 100)} />
                  <NumField label="LDES ENERGY" value={concept.storageGWh} step={0.1} suffix="GWh" onChange={set("storageGWh")} />
                  <NumField label="LDES POWER" value={concept.storagePowerMW} step={10} suffix="MW" onChange={set("storagePowerMW")} />
                  <NumField label="TIED WIND" value={concept.tiedWindMW} step={25} suffix="MW" onChange={set("tiedWindMW")} />
                  <NumField label="PPA STRIKE" value={concept.ppaStrikeGBP} step={5} suffix="£/MWh" onChange={set("ppaStrikeGBP")} />
                  <NumField label="SECOND LIFE" value={concept.secondLifeYears} step={1} suffix="yr" onChange={set("secondLifeYears")} />
                  <NumField label="ELECTROLYSER" value={concept.h2ElectrolyserMW} step={10} suffix="MW" onChange={set("h2ElectrolyserMW")} />
                </div>
                <div className="mt-2 border-t pt-2" style={{ borderColor: "var(--edge)" }}>
                  <div className="mb-1.5 text-[10px] tracking-widest text-[var(--ink-soft)]">
                    INTERRUPTIBLE VARIANT (V2) — CHECKPOINT & POWER DOWN IN LULLS · NO LDES DECK · NO HVDC · NO TAKE-OR-PAY
                  </div>
                  <div className="grid grid-cols-2 gap-x-3 gap-y-1.5">
                    <NumField label="COMPUTE RATE" value={concept.intRevenueGBPPerMWhIT} step={10} suffix="£/MWh-IT" onChange={set("intRevenueGBPPerMWhIT")} />
                    <NumField label="ENERGY STRIKE" value={concept.intStrikeGBP} step={5} suffix="£/MWh" onChange={set("intStrikeGBP")} />
                    <NumField label="MIN LOAD" value={Math.round(concept.intMinLoadShare * 100)} step={5} suffix="%" onChange={(v) => set("intMinLoadShare")(v / 100)} />
                    <NumField label="AC CABLE" value={concept.acCableGBPmPerKm} step={0.1} suffix="£m/km" onChange={set("acCableGBPmPerKm")} />
                    <NumField label="BESS (3-4 CTNRS)" value={concept.bessCapexGBPm} step={1} suffix="£m" onChange={set("bessCapexGBPm")} />
                    <NumField label="FIBRE VIA PIPE" value={concept.fibrePullGBPm} step={1} suffix="£m" onChange={set("fibrePullGBPm")} />
                  </div>
                  {!sel.platform.pipelineReuse && (
                    <div className="mt-1 text-[10px] leading-snug" style={{ color: "#f2c14e" }}>
                      no surviving export pipeline on this platform — fibre-via-pipe cost should be re-set to a
                      subsea lay to {sel.distances.nearestLanding ? Math.round(sel.distances.nearestLanding.km) : "—"} km.
                    </div>
                  )}
                </div>
                <div className="mt-2 space-y-0.5">
                  <Row
                    k={`payload weight — interruptible v2 (${Math.round(intW).toLocaleString()} t)`}
                    v={`${Math.round((intW / sel.platform.topsideTonnes) * 100)}% of budget`}
                    warn={intW > sel.platform.topsideTonnes}
                  />
                  <Row
                    k={`payload weight — compute+LDES (${Math.round(computeW).toLocaleString()} t)`}
                    v={`${Math.round((computeW / sel.platform.topsideTonnes) * 100)}% of budget`}
                    warn={computeW > sel.platform.topsideTonnes}
                  />
                  <Row
                    k={`payload weight — H2 (${Math.round(h2W).toLocaleString()} t)`}
                    v={`${Math.round((h2W / sel.platform.topsideTonnes) * 100)}% of budget`}
                    warn={h2W > sel.platform.topsideTonnes}
                  />
                  <div className="text-[9px] leading-snug text-[var(--ink-soft)]">
                    module tonnage per MW/GWh are engineering estimates — the Dutch-shelf finding that topside
                    weight (not area) binds is preserved: breach shows red.
                  </div>
                </div>
              </Section>

              {feas && (
                <Section n={4} title={`OPTIONS APPRAISAL — SHARED PRICE/WIND PATHS · MC ×${feas.runs}`}>
                  <table className="w-full text-[11px]">
                    <thead>
                      <tr className="text-left text-[10px] tracking-wider text-[var(--ink-soft)]">
                        <th className="pb-1">OPTION</th>
                        <th className="text-right">CAPEX</th>
                        <th className="text-right">NPV P10</th>
                        <th className="text-right">NPV P50</th>
                        <th className="text-right">NPV P90</th>
                        <th className="text-right">P&gt;DECOM</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr>
                        <td className="py-0.5">A · decommission now</td>
                        <td className="text-right">{gbpM(feas.decomNow.capexGBPm)}</td>
                        <td className="text-right" colSpan={3}>
                          {gbpM(feas.decomNow.npvGBPm)} (deterministic)
                        </td>
                        <td className="text-right text-[var(--ink-soft)]">—</td>
                      </tr>
                      <tr>
                        <td className="py-0.5">B · interruptible compute (v2)</td>
                        <td className="text-right">{gbpM(feas.interruptible.capexGBPm)}</td>
                        <td className="text-right">{gbpM(feas.interruptible.npvP10GBPm)}</td>
                        <td className="text-right" style={{ color: feas.interruptible.npvGBPm >= feas.decomNow.npvGBPm ? "#48a87c" : "#e2483d" }}>
                          {gbpM(feas.interruptible.npvGBPm)}
                        </td>
                        <td className="text-right">{gbpM(feas.interruptible.npvP90GBPm)}</td>
                        <td className="text-right">{Math.round(feas.interruptible.probBeatsDecom * 100)}%</td>
                      </tr>
                      <tr>
                        <td className="py-0.5">C · firm compute + LDES (v1)</td>
                        <td className="text-right">{gbpM(feas.compute.capexGBPm)}</td>
                        <td className="text-right">{gbpM(feas.compute.npvP10GBPm)}</td>
                        <td className="text-right" style={{ color: feas.compute.npvGBPm >= feas.decomNow.npvGBPm ? "#48a87c" : "#e2483d" }}>
                          {gbpM(feas.compute.npvGBPm)}
                        </td>
                        <td className="text-right">{gbpM(feas.compute.npvP90GBPm)}</td>
                        <td className="text-right">{Math.round(feas.compute.probBeatsDecom * 100)}%</td>
                      </tr>
                      <tr>
                        <td className="py-0.5">D · H2 electrolysis</td>
                        <td className="text-right">{gbpM(feas.h2.capexGBPm)}</td>
                        <td className="text-right">{gbpM(feas.h2.npvP10GBPm)}</td>
                        <td className="text-right" style={{ color: feas.h2.npvGBPm >= feas.decomNow.npvGBPm ? "#48a87c" : "#e2483d" }}>
                          {gbpM(feas.h2.npvGBPm)}
                        </td>
                        <td className="text-right">{gbpM(feas.h2.npvP90GBPm)}</td>
                        <td className="text-right">{Math.round(feas.h2.probBeatsDecom * 100)}%</td>
                      </tr>
                    </tbody>
                  </table>
                  <div className="mt-1.5 space-y-0.5 text-[10px] text-[var(--ink-soft)]">
                    <div>
                      B: £{concept.intRevenueGBPPerMWhIT}/MWh-IT merchant · yr-1 revenue{" "}
                      {gbpM(feas.interruptible.revenueGBPmYr)} vs power+opex {gbpM(feas.interruptible.costGBPmYr)} ·
                      effective utilisation {Math.round(feas.interruptible.deliveredShare * 100)}% on these wind shapes
                    </div>
                    <div>
                      C: all-in lease £{concept.leaseKGBPPerMWyr}k/MW-yr with take-or-pay PPA + LDES + HVDC — the
                      firmed comparator v2 engineered out
                    </div>
                    <div>
                      D: {feas.h2.annualKt.toFixed(1)} kt H2/yr at £{concept.h2PriceGBPkg.toFixed(2)}/kg (Aberdeen/NDC
                      anchor) · all repurposing options defer decom {concept.secondLifeYears} yr
                    </div>
                  </div>
                </Section>
              )}

              {tornado && (
                <Section n={5} title="SENSITIVITY — INTERRUPTIBLE (V2) NPV, ±20% PER INPUT">
                  <Tornado rows={tornado} />
                </Section>
              )}

              <Section n={6} title="RISK REGISTER">
                <div className="space-y-1 text-[11px]">
                  <Row k="structural remediation (MC, lognormal fat tail)" v={`mean £${concept.remediationMeanGBPm}m`} />
                  <Row k="fibre connectivity" v="proximity screened — dark-fibre capacity unverified" />
                  <Row k="marine opex" v={`£${concept.opexKGBPPerMWyr}k/MW-yr — offshore-wind O&M analogue, reference`} />
                  <Row k="classification / new deck loading" v="not modelled — flagged for platform-integrity review" />
                  <Row k="OSPAR 98/3 / derogation" v="full removal is the regulatory default — repurposing is a case-by-case carve-out" />
                  <Row k="pipeline internal condition" v="fibre-via-pipe assumes a pull-ready flooded line — pigging records are the proxy" />
                  <Row k="heavy-lift / vessel market" v="basin-wide capacity pressure — schedule risk, not priced here" />
                </div>
              </Section>

              <Section n={7} title="ASSUMPTIONS REGISTER — UNIT COSTS & MACRO">
                <div className="grid grid-cols-2 gap-x-3 gap-y-1.5">
                  <NumField label="COMPUTE CAPEX" value={concept.computeCapexGBPmPerMW} step={0.5} suffix="£m/MW" onChange={set("computeCapexGBPmPerMW")} />
                  <NumField label="LDES CAPEX" value={concept.storageCapexGBPmPerGWh} step={1} suffix="£m/GWh" onChange={set("storageCapexGBPmPerGWh")} />
                  <NumField label="CONVERSION" value={concept.conversionCapexGBPm} step={10} suffix="£m" onChange={set("conversionCapexGBPm")} />
                  <NumField label="REMEDIATION μ" value={concept.remediationMeanGBPm} step={5} suffix="£m" onChange={set("remediationMeanGBPm")} />
                  <NumField label="MARINE OPEX" value={concept.opexKGBPPerMWyr} step={10} suffix="£k/MW-yr" onChange={set("opexKGBPPerMWyr")} />
                  <NumField label="DECOM COST" value={concept.decomCostGBPm} step={10} suffix="£m" onChange={set("decomCostGBPm")} />
                  <NumField label="H2 PRICE" value={concept.h2PriceGBPkg} step={0.25} suffix="£/kg" onChange={set("h2PriceGBPkg")} />
                  <NumField label="DISCOUNT" value={Math.round(concept.discountRate * 1000) / 10} step={0.5} suffix="%" onChange={(v) => set("discountRate")(v / 100)} />
                </div>
                <div className="mt-1.5 text-[9px] leading-snug text-[var(--ink-soft)]">
                  discount default = BoE Bank Rate {macro?.bankRate.live ? `${macro.bankRate.pct.toFixed(2)}%` : "(ref)"} + 4%
                  premium · inflation = ONS CPI {macro ? `${macro.cpi.yoyPct.toFixed(1)}%` : ""} · unit costs are
                  reference values — every figure editable, the study reflows live.
                </div>
              </Section>
            </>
          )}
        </div>
      </div>

      {/* Globe */}
      <div ref={globeBox} className="max-md:absolute max-md:inset-0 md:relative md:order-2 md:min-w-0 md:flex-1">
        {size.width > 0 && (
          <NsGlobe
            results={results}
            farms={FARMS}
            landings={LANDINGS}
            selectedId={selectedId}
            onSelect={setSelectedId}
            width={size.width}
            height={size.height}
          />
        )}
        <div
          className="absolute bottom-4 left-4 rounded-xl border p-3 font-[family-name:var(--f-mono)] text-[10px] text-[var(--ink-soft)] backdrop-blur max-md:hidden"
          style={{ background: "var(--panel)", borderColor: "var(--edge)" }}
        >
          <div>● platforms coloured by screening score · size = selection</div>
          <div>
            <span style={{ color: "#2c8c8a" }}>●</span> wind farms (size = capacity) ·{" "}
            <span style={{ color: "#6ea8dc" }}>●</span> fibre landings
          </div>
          <div>select a platform to draw its wind + fibre ties</div>
          <div className="mt-1.5 border-t pt-1.5" style={{ borderColor: "var(--edge)" }}>
            GB market: Elexon (BMRS) · macro: BoE + ONS · infrastructure: curated public sources
          </div>
        </div>
      </div>
    </div>
  );
}
