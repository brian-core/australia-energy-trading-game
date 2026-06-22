"use client";

import { useEffect, useMemo, useState } from "react";
import { runBacktest } from "@/lib/energy/backtest";
import { loadDeskState } from "@/lib/energy/desk-storage";
import type { HistoryPayload, PricePoint } from "@/lib/energy/history";
import type { MacroPayload } from "@/lib/energy/macro";
import { FUEL_META } from "@/lib/energy/regions";
import {
  PIPELINE_PROJECTS,
  runScenario,
  type ScenarioAsset,
  type ScenarioResult,
  type ScenarioTech,
} from "@/lib/energy/scenario";
import {
  defaultFinanceInputs,
  runFinance,
  runMonteCarlo,
  type FinanceInputs,
} from "@/lib/energy/finance";
import type { LivePayload } from "@/lib/energy/types";
import PriceChart from "./price-chart";

// BUILD view: model a new utility-scale asset (or a closure) and see its
// first-order effect on the region's price curve, generation mix, its own
// captured revenue, and the user's subscription book.

export interface ScenarioSite {
  lat: number;
  lng: number;
  label: string;
}

function money(x: number): string {
  const sign = x < 0 ? "−" : "";
  const abs = Math.abs(x);
  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(1)}m`;
  if (abs >= 1000) return `${sign}$${(abs / 1000).toFixed(0)}k`;
  return `${sign}$${abs.toFixed(0)}`;
}

function MixBar({ mix }: { mix: { fuel: string; mwh: number }[] }) {
  const total = mix.reduce((s, m) => s + m.mwh, 0);
  if (total <= 0) return null;
  return (
    <div className="flex h-2 w-full overflow-hidden rounded-full">
      {mix.map((m) => (
        <div
          key={m.fuel}
          title={`${m.fuel} ${Math.round((m.mwh / total) * 100)}%`}
          style={{
            width: `${(m.mwh / total) * 100}%`,
            background: FUEL_META[m.fuel as keyof typeof FUEL_META]?.color ?? "#888",
            minWidth: 1,
          }}
        />
      ))}
    </div>
  );
}

const TECH_OPTIONS: { value: ScenarioTech; label: string }[] = [
  { value: "solar", label: "solar farm" },
  { value: "wind", label: "wind farm" },
  { value: "battery", label: "battery (4h)" },
  { value: "phes", label: "pumped hydro" },
  { value: "gas", label: "gas peaker" },
];

function NpvSpark({ samples, p50 }: { samples: number[]; p50: number }) {
  // Simple histogram of NPV outcomes; bar at/above zero green, below red.
  const bins = 32;
  if (samples.length === 0) return null;
  const lo = Math.min(...samples);
  const hi = Math.max(...samples);
  const span = hi - lo || 1;
  const counts = new Array(bins).fill(0);
  for (const v of samples) counts[Math.min(bins - 1, Math.floor(((v - lo) / span) * bins))]++;
  const max = Math.max(...counts, 1);
  const zeroBin = Math.min(bins - 1, Math.max(0, Math.floor(((0 - lo) / span) * bins)));
  return (
    <div className="flex h-8 items-end gap-px" title={`P50 NPV ${money(p50)}`}>
      {counts.map((c, i) => (
        <div
          key={i}
          className="flex-1 rounded-sm"
          style={{
            height: `${(c / max) * 100}%`,
            minHeight: c > 0 ? 1 : 0,
            background: i >= zeroBin ? "var(--gen)" : "#e2483d",
            opacity: 0.85,
          }}
        />
      ))}
    </div>
  );
}

function FinField({
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
      <span className="text-[9px] tracking-wider text-[var(--ink-soft)]">{label}</span>
      <span className="flex items-center gap-1">
        <input
          type="number"
          value={value}
          step={step}
          onChange={(e) => onChange(Number(e.target.value))}
          className="w-full rounded border bg-black/30 px-1 py-0.5 text-right text-[10px]"
          style={{ borderColor: "var(--edge)" }}
        />
        {suffix && <span className="text-[9px] text-[var(--ink-soft)]">{suffix}</span>}
      </span>
    </label>
  );
}

/**
 * Developer-grade project finance for a custom asset: editable cost/performance
 * inputs feeding LCOE/LCOS, NPV/IRR/payback, and a Monte-Carlo distribution of
 * lifetime NPV (price risk bootstrapped from the region's price history).
 */
// Equity-risk premium added to the RBA cash rate to seed the discount-rate
// (WACC) default. User-overridable in the inputs panel.
const EQUITY_PREMIUM = 0.04;

function ProjectFinance({
  tech,
  capacityMW,
  captureAUD,
  prices,
  demo,
  macro,
}: {
  tech: ScenarioTech;
  capacityMW: number;
  captureAUD: number;
  prices: PricePoint[];
  demo: boolean;
  macro: MacroPayload | null;
}) {
  const [open, setOpen] = useState(false);
  const [overrides, setOverrides] = useState<Partial<FinanceInputs>>({});
  // Reset overrides when the technology changes (defaults differ per tech).
  // Render-time reset per the React "you might not need an effect" pattern.
  const [prevTech, setPrevTech] = useState(tech);
  if (prevTech !== tech) {
    setPrevTech(tech);
    setOverrides({});
  }

  // Seed WACC and inflation from live macro: discount = cash rate + equity
  // premium; inflation = headline CPI. Falls back to finance.ts defaults.
  const macroDefaults = useMemo(
    () =>
      macro
        ? {
            discountRate: macro.cashRate.pct / 100 + EQUITY_PREMIUM,
            inflation: macro.cpi.yoyPct / 100,
          }
        : undefined,
    [macro],
  );
  const macroLive = !!macro && (macro.cashRate.live || macro.cpi.live);

  const fin: FinanceInputs = useMemo(
    () => ({ ...defaultFinanceInputs(tech, capacityMW, captureAUD, macroDefaults), ...overrides }),
    [tech, capacityMW, captureAUD, macroDefaults, overrides],
  );
  const result = useMemo(() => runFinance(fin), [fin]);
  const mc = useMemo(() => runMonteCarlo(fin, prices), [fin, prices]);
  const set = (k: keyof FinanceInputs) => (v: number) => setOverrides((o) => ({ ...o, [k]: v }));

  const irrPct = (x: number | null) => (x == null ? "—" : `${(x * 100).toFixed(1)}%`);

  return (
    <div className="rounded-lg border p-2.5" style={{ borderColor: "var(--edge)" }}>
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between text-[10px] tracking-widest text-[var(--ink-soft)]"
      >
        <span>PROJECT FINANCE — {result.levelisedKind}</span>
        <span>{open ? "−" : "+"}</span>
      </button>

      {/* Headline outputs (always visible) */}
      <div className="mt-2 grid grid-cols-3 gap-2">
        <div>
          <div className="text-sm">${result.lcoeAUD.toFixed(0)}</div>
          <div className="text-[9px] tracking-widest text-[var(--ink-soft)]">{result.levelisedKind} $/MWH</div>
        </div>
        <div>
          <div className="text-sm" style={{ color: result.npvAUD >= 0 ? "var(--gen)" : "#e2483d" }}>
            {money(result.npvAUD)}
          </div>
          <div className="text-[9px] tracking-widest text-[var(--ink-soft)]">NPV @ {(fin.discountRate * 100).toFixed(1)}%</div>
        </div>
        <div>
          <div className="text-sm">{irrPct(result.irr)}</div>
          <div className="text-[9px] tracking-widest text-[var(--ink-soft)]">IRR</div>
        </div>
      </div>

      <div className="mt-1.5 space-y-0.5 text-[10px] text-[var(--ink-soft)]">
        <div className="flex justify-between">
          <span>capex / AEP yr1</span>
          <span>
            {money(result.totalCapexAUD)} · {Math.round(result.aepYear1MWh / 1000)} GWh
          </span>
        </div>
        <div className="flex justify-between">
          <span>payback (undiscounted)</span>
          <span>{result.paybackYears == null ? "never" : `${result.paybackYears} yr`}</span>
        </div>
        {mc && (
          <div className="flex justify-between">
            <span>P(NPV&gt;0) · {mc.runs} runs</span>
            <span style={{ color: mc.probPositive >= 0.5 ? "var(--gen)" : "#e2483d" }}>
              {Math.round(mc.probPositive * 100)}%
            </span>
          </div>
        )}
        {macro && (
          <div className="text-[9px] text-[var(--ink-soft)]">
            WACC default {macroLive ? "from RBA cash rate" : "≈"} {macro.cashRate.pct.toFixed(2)}% +{" "}
            {(EQUITY_PREMIUM * 100).toFixed(0)}% premium · inflation {macro.cpi.yoyPct.toFixed(1)}%
            {macroLive ? "" : " (reference)"}
          </div>
        )}
      </div>

      {/* Monte-Carlo distribution */}
      {mc && (
        <div className="mt-2">
          <div className="mb-0.5 flex justify-between text-[9px] text-[var(--ink-soft)]">
            <span>NPV P10 {money(mc.npvP10)}</span>
            <span>P50 {money(mc.npvP50)}</span>
            <span>P90 {money(mc.npvP90)}</span>
          </div>
          <NpvSpark samples={mc.npvSamples} p50={mc.npvP50} />
          <div className="mt-0.5 text-[9px] text-[var(--ink-soft)]">
            IRR P10–P90 {irrPct(mc.irrP10)} – {irrPct(mc.irrP90)}
            {demo && " · SYNTHETIC HISTORY"}
          </div>
        </div>
      )}

      {/* Editable inputs */}
      {open && (
        <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1.5 border-t pt-2" style={{ borderColor: "var(--edge)" }}>
          <FinField label="CAPACITY FACTOR" value={Math.round(fin.capacityFactor * 1000) / 10} step={1} suffix="%" onChange={(v) => set("capacityFactor")(v / 100)} />
          <FinField label="CAPEX" value={Math.round(fin.capexPerMW / 1000)} step={50} suffix="$k/MW" onChange={(v) => set("capexPerMW")(v * 1000)} />
          <FinField label="O&M" value={fin.omPerMWh} step={1} suffix="$/MWh" onChange={set("omPerMWh")} />
          <FinField label="O&M ESCALATION" value={Math.round(fin.omEscalation * 1000) / 10} step={0.5} suffix="%/yr" onChange={(v) => set("omEscalation")(v / 100)} />
          <FinField label="DEGRADATION" value={Math.round(fin.degradation * 1000) / 10} step={0.1} suffix="%/yr" onChange={(v) => set("degradation")(v / 100)} />
          <FinField label="DISCOUNT (WACC)" value={Math.round(fin.discountRate * 1000) / 10} step={0.5} suffix="%" onChange={(v) => set("discountRate")(v / 100)} />
          <FinField label="OPERATING LIFE" value={fin.operatingLifeYears} step={1} suffix="yr" onChange={set("operatingLifeYears")} />
          <FinField label="COMMISSIONING" value={fin.commissioningYear} step={1} onChange={set("commissioningYear")} />
          <FinField label="DEV PHASE" value={fin.devPhaseYears} step={1} suffix="yr" onChange={set("devPhaseYears")} />
          <FinField label="DEV COST" value={Math.round(fin.devCostPerYear / 1000)} step={100} suffix="$k/yr" onChange={(v) => set("devCostPerYear")(v * 1000)} />
          <FinField label="DECOMMISSION" value={Math.round(fin.decommissioningCost / 1000)} step={500} suffix="$k" onChange={(v) => set("decommissioningCost")(v * 1000)} />
          <FinField label="PRICE GROWTH" value={Math.round(fin.priceGrowth * 1000) / 10} step={0.5} suffix="%/yr real" onChange={(v) => set("priceGrowth")(v / 100)} />
          <FinField label="INFLATION" value={Math.round(fin.inflation * 1000) / 10} step={0.5} suffix="%/yr" onChange={(v) => set("inflation")(v / 100)} />
          <FinField label="CAPTURE PRICE" value={Math.round(fin.captureAUD)} step={5} suffix="$/MWh" onChange={set("captureAUD")} />
          <button
            onClick={() => setOverrides({})}
            className="col-span-2 mt-0.5 rounded border px-2 py-0.5 text-[9px] tracking-widest text-[var(--ink-soft)] hover:text-[var(--ink)]"
            style={{ borderColor: "var(--edge)" }}
          >
            RESET TO {tech.toUpperCase()} DEFAULTS
          </button>
        </div>
      )}
      <div className="mt-1.5 text-[9px] leading-snug text-[var(--ink-soft)]">
        First-order developer finance — capture price from the merit-order sim, price risk
        bootstrapped from the region&apos;s history. Not a bankable valuation.
      </div>
    </div>
  );
}

export default function BuildPanel({
  live,
  history,
  onScenarioSite,
}: {
  live: LivePayload;
  history: HistoryPayload | null;
  onScenarioSite: (site: ScenarioSite | null) => void;
}) {
  const [projectId, setProjectId] = useState<string>(PIPELINE_PROJECTS[0].id);
  const [custom, setCustom] = useState<{ region: string; tech: ScenarioTech; mw: number }>({
    region: "NSW1",
    tech: "solar",
    mw: 500,
  });

  // Live macro context (RBA cash rate + CPI) → finance defaults. Optional; the
  // finance card falls back to its built-in defaults when this is null.
  const [macro, setMacro] = useState<MacroPayload | null>(null);
  useEffect(() => {
    let cancelled = false;
    fetch("/api/energy/macro")
      .then((r) => r.json() as Promise<MacroPayload>)
      .then((m) => {
        if (!cancelled) setMacro(m);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const project = projectId === "custom" ? null : PIPELINE_PROJECTS.find((p) => p.id === projectId);

  const asset: ScenarioAsset = useMemo(() => {
    if (project) {
      return {
        region: project.region,
        tech: project.tech === "closure" ? "gas" : project.tech,
        mw: project.mw,
        closureFuel: project.closureFuel,
      };
    }
    return { region: custom.region, tech: custom.tech, mw: custom.mw };
  }, [project, custom]);

  const result: ScenarioResult | null = useMemo(() => {
    const prices = history?.regions[asset.region];
    if (!history || !prices || prices.length < 10 || asset.mw === 0) return null;
    return runScenario(prices, history.intervalHours, asset);
  }, [history, asset]);

  // Surface the asset's site to the globe (pulsing ring); clear on unmount.
  useEffect(() => {
    if (!result) {
      onScenarioSite(null);
      return;
    }
    if (project) {
      onScenarioSite({ lat: project.lat, lng: project.lng, label: project.name });
    } else {
      const region = live.regions.find((r) => r.code === asset.region);
      onScenarioSite(
        region ? { lat: region.lat, lng: region.lng, label: `custom ${asset.tech}` } : null,
      );
    }
    return () => onScenarioSite(null);
  }, [result, project, asset.region, asset.tech, live, onScenarioSite]);

  // Impact on the user's subscription book: re-run the backtest for this
  // region with the modelled price curves before vs after.
  const bookImpact = useMemo(() => {
    if (!result || !history) return null;
    const desk = loadDeskState();
    if ((desk.book.loadsMW[result.region] ?? 0) <= 0) return null;
    const mk = (series: typeof result.seriesBefore): HistoryPayload => ({
      window: history.window,
      intervalHours: history.intervalHours,
      demo: history.demo,
      regions: { [result.region]: series },
    });
    const before = runBacktest(mk(result.seriesBefore), desk.book, desk.trades);
    const after = runBacktest(mk(result.seriesAfter), desk.book, desk.trades);
    return after.marginAUD - before.marginAUD;
  }, [result, history]);

  const deltaAvg = result ? result.avgAfterAUD - result.avgBeforeAUD : 0;
  const annualFactor = result && result.hours > 0 ? 8760 / result.hours : 0;

  return (
    <div className="space-y-3 font-[family-name:var(--f-mono)] text-[11px]">
      <div className="text-[9px] leading-snug tracking-widest text-[var(--ink-soft)]">
        STYLISED MERIT-ORDER SIMULATION — NOT A DISPATCH MODEL. PIPELINE LIST IS INDICATIVE.
      </div>

      {/* Asset picker */}
      <div className="rounded-lg border p-2.5" style={{ borderColor: "var(--edge)" }}>
        <div className="mb-1.5 text-[10px] tracking-widest text-[var(--ink-soft)]">NEW ASSET / CLOSURE</div>
        <select
          value={projectId}
          onChange={(e) => setProjectId(e.target.value)}
          className="w-full rounded border bg-black/30 px-1.5 py-1"
          style={{ borderColor: "var(--edge)" }}
        >
          {PIPELINE_PROJECTS.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name} · {p.region.replace(/\d$/, "")} {Math.abs(p.mw)} MW · {p.year}
            </option>
          ))}
          <option value="custom">custom asset…</option>
        </select>
        {projectId === "custom" && (
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            <select
              value={custom.region}
              onChange={(e) => setCustom({ ...custom, region: e.target.value })}
              className="rounded border bg-black/30 px-1 py-0.5"
              style={{ borderColor: "var(--edge)" }}
            >
              {live.regions.map((r) => (
                <option key={r.code} value={r.code}>
                  {r.code.replace(/\d$/, "")}
                </option>
              ))}
            </select>
            <select
              value={custom.tech}
              onChange={(e) => setCustom({ ...custom, tech: e.target.value as ScenarioTech })}
              className="rounded border bg-black/30 px-1 py-0.5"
              style={{ borderColor: "var(--edge)" }}
            >
              {TECH_OPTIONS.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </select>
            <input
              type="number"
              value={custom.mw}
              min={0}
              step={50}
              onChange={(e) => setCustom({ ...custom, mw: Number(e.target.value) || 0 })}
              className="w-20 rounded border bg-black/30 px-1 py-0.5 text-right"
              style={{ borderColor: "var(--edge)" }}
            />
            <span className="text-[var(--ink-soft)]">MW</span>
          </div>
        )}
      </div>

      {project && (
        <div className="rounded-lg border p-2.5" style={{ borderColor: "var(--edge)" }}>
          <div className="mb-1.5 text-[10px] tracking-widest text-[var(--ink-soft)]">PROJECT INFO</div>
          <div className="space-y-1 text-[10px]">
            <div className="leading-snug text-[var(--ink)]">{project.description}</div>
            <div className="flex justify-between text-[var(--ink-soft)]">
              <span>developer</span>
              <span className="text-right">{project.developer}</span>
            </div>
            <div className="flex justify-between text-[var(--ink-soft)]">
              <span>status</span>
              <span className="text-right">{project.status}</span>
            </div>
            <div className="flex justify-between text-[var(--ink-soft)]">
              <span>capacity</span>
              <span>
                {Math.abs(project.mw).toLocaleString()} MW{project.mw < 0 ? " retired" : ""}
                {project.storage ? ` · ${project.storage}` : ""}
              </span>
            </div>
            {project.cost && (
              <div className="flex justify-between text-[var(--ink-soft)]">
                <span>indicative cost</span>
                <span>{project.cost}</span>
              </div>
            )}
            <div className="flex justify-between text-[var(--ink-soft)]">
              <span>target</span>
              <span>{project.year}</span>
            </div>
          </div>
          {project.url && (
            <a
              href={project.url}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-2 inline-block rounded border px-2 py-0.5 text-[10px] tracking-wider text-[var(--ink-soft)] hover:text-[var(--ink)]"
              style={{ borderColor: "var(--edge)" }}
            >
              PROJECT SITE ↗
            </a>
          )}
        </div>
      )}

      {!result ? (
        <div className="text-[10px] text-[var(--ink-soft)]">loading price history…</div>
      ) : (
        <>
          {/* Price impact */}
          <div className="rounded-lg border p-2.5" style={{ borderColor: "var(--edge)" }}>
            <div className="mb-1.5 text-[10px] tracking-widest text-[var(--ink-soft)]">
              PRICE IMPACT — {result.region.replace(/\d$/, "")} · LAST 7 DAYS
            </div>
            <div className="grid grid-cols-3 gap-2">
              <div>
                <div className="text-sm">${result.avgBeforeAUD.toFixed(0)}</div>
                <div className="text-[9px] tracking-widest text-[var(--ink-soft)]">AVG BEFORE</div>
              </div>
              <div>
                <div className="text-sm">${result.avgAfterAUD.toFixed(0)}</div>
                <div className="text-[9px] tracking-widest text-[var(--ink-soft)]">AVG AFTER</div>
              </div>
              <div>
                <div className="text-sm" style={{ color: deltaAvg <= 0 ? "var(--gen)" : "#e2483d" }}>
                  {deltaAvg <= 0 ? "" : "+"}
                  {deltaAvg.toFixed(0)}
                </div>
                <div className="text-[9px] tracking-widest text-[var(--ink-soft)]">Δ $/MWH</div>
              </div>
            </div>
            <div className="mt-2">
              <PriceChart
                points={result.seriesAfter}
                secondary={result.seriesBefore}
                color={deltaAvg <= 0 ? "#2c8c8a" : "#e2483d"}
              />
            </div>
            <div className="mt-1 text-[9px] text-[var(--ink-soft)]">
              after (solid) vs before (faint) · p95 ${Math.round(result.p95BeforeAUD)} → $
              {Math.round(result.p95AfterAUD)}
              {history?.demo && " · SYNTHETIC HISTORY"}
            </div>
          </div>

          {/* Mix impact */}
          <div className="rounded-lg border p-2.5" style={{ borderColor: "var(--edge)" }}>
            <div className="mb-1.5 text-[10px] tracking-widest text-[var(--ink-soft)]">GENERATION MIX (MODELLED)</div>
            <div className="space-y-1.5">
              <div>
                <div className="mb-0.5 text-[9px] text-[var(--ink-soft)]">before</div>
                <MixBar mix={result.mixBefore} />
              </div>
              <div>
                <div className="mb-0.5 text-[9px] text-[var(--ink-soft)]">after</div>
                <MixBar mix={result.mixAfter} />
              </div>
            </div>
            <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5 text-[9px] text-[var(--ink-soft)]">
              {result.mixAfter.slice(0, 6).map((m) => {
                const beforeMwh = result.mixBefore.find((b) => b.fuel === m.fuel)?.mwh ?? 0;
                const delta = m.mwh - beforeMwh;
                return (
                  <span key={m.fuel} className="inline-flex items-center gap-1">
                    <span
                      className="h-2 w-2 rounded-sm"
                      style={{ background: FUEL_META[m.fuel as keyof typeof FUEL_META]?.color }}
                    />
                    {m.fuel} {delta === 0 ? "" : delta > 0 ? `+${Math.round(delta / 1000)}GWh` : `${Math.round(delta / 1000)}GWh`}
                  </span>
                );
              })}
            </div>
          </div>

          {/* Asset economics + book impact */}
          <div className="rounded-lg border p-2.5" style={{ borderColor: "var(--edge)" }}>
            <div className="mb-1.5 text-[10px] tracking-widest text-[var(--ink-soft)]">ASSET & BOOK</div>
            <div className="space-y-0.5 text-[10px]">
              {result.realizedCF != null && (
                <div className="flex justify-between text-[var(--ink-soft)]">
                  <span>realised capacity factor</span>
                  <span>{Math.round(result.realizedCF * 100)}%</span>
                </div>
              )}
              {result.captureAUD != null && (
                <div className="flex justify-between text-[var(--ink-soft)]">
                  <span>capture price (post-build)</span>
                  <span>
                    ${result.captureAUD.toFixed(0)}/MWh
                    {deltaAvg < 0 && " (self-cannibalising)"}
                  </span>
                </div>
              )}
              {result.revenueWindowAUD != null && (
                <div className="flex justify-between text-[var(--ink-soft)]">
                  <span>merchant revenue (window × 8760h)</span>
                  <span>{money(result.revenueWindowAUD * annualFactor)}</span>
                </div>
              )}
              {project?.tech === "closure" && (
                <div className="text-[9px] leading-snug text-[var(--ink-soft)]">
                  closure modelled with no replacement build — peak prices are the upper bound
                </div>
              )}
              {bookImpact != null && (
                <div className="flex justify-between">
                  <span className="text-[var(--ink-soft)]">your book margin over window</span>
                  <span style={{ color: bookImpact >= 0 ? "var(--gen)" : "#e2483d" }}>
                    {bookImpact >= 0 ? "+" : ""}
                    {money(bookImpact)}
                  </span>
                </div>
              )}
            </div>
          </div>

          {/* Project finance — custom assets only */}
          {!project && (
            <ProjectFinance
              tech={asset.tech}
              capacityMW={asset.mw}
              captureAUD={result.captureAUD ?? result.avgAfterAUD}
              prices={history?.regions[asset.region] ?? []}
              demo={!!history?.demo}
              macro={macro}
            />
          )}
        </>
      )}
    </div>
  );
}
