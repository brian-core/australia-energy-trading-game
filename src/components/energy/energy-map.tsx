"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { cloudEnabled, useSession } from "@/lib/cloud";
import type { HistoryPayload } from "@/lib/energy/history";
import { PRICE_BANDS, RETAIL_REF, fmtRetail, priceColor, spotAsCkwh } from "@/lib/energy/pricing";
import BuildPanel, { type ScenarioSite } from "./build-panel";
import DeskPanel from "./desk-panel";
import type { MapMode } from "./energy-globe";
import OpsPanel from "./ops-panel";
import PriceChart from "./price-chart";
import { useEnergyGame } from "./use-game";
import { FUEL_META } from "@/lib/energy/regions";
import type { Facility, FacilitiesPayload, FuelSlice, LivePayload, RegionLive } from "@/lib/energy/types";

type ViewTab = "power" | "price" | "desk" | "build" | "ops";

const EnergyGlobe = dynamic(() => import("./energy-globe"), {
  ssr: false,
  loading: () => (
    <div className="flex h-full w-full items-center justify-center font-[family-name:var(--f-mono)] text-xs tracking-widest text-[var(--ink-soft)]">
      LOADING GLOBE…
    </div>
  ),
});

const AssetScene = dynamic(() => import("./asset-scene"), { ssr: false });

const POLL_MS = 60_000;

function fmtMW(mw: number): string {
  return mw >= 1000 ? `${(mw / 1000).toFixed(1)} GW` : `${Math.round(mw)} MW`;
}

function pct(x: number): string {
  return `${Math.round(x * 100)}%`;
}

function FuelBar({ mix, height = 8 }: { mix: FuelSlice[]; height?: number }) {
  const total = mix.reduce((sum, s) => sum + s.mw, 0);
  if (total <= 0) return null;
  return (
    <div className="flex w-full overflow-hidden rounded-full" style={{ height }}>
      {mix.map((s) => (
        <div
          key={s.tech}
          title={`${s.label} ${fmtMW(s.mw)}`}
          style={{ width: `${(s.mw / total) * 100}%`, background: s.color, minWidth: 2 }}
        />
      ))}
    </div>
  );
}

function StatusChip({ live, stale }: { live: LivePayload | null; stale: boolean }) {
  let color = "#f2c14e";
  let text = "CONNECTING";
  if (live?.demo) {
    text = "DEMO DATA — FEEDS UNREACHABLE";
  } else if (live && stale) {
    text = "LIVE · STALE";
  } else if (live) {
    color = "#48a87c";
    text = live.sources.openelectricity === "partial" ? "LIVE · PARTIAL FEED" : "LIVE · 5-MIN DATA";
  }
  return (
    <span className="inline-flex items-center gap-2 font-[family-name:var(--f-mono)] text-[10px] tracking-widest text-[var(--ink-soft)]">
      <span className="pulse-dot inline-block h-2 w-2 rounded-full" style={{ background: color }} />
      {text}
    </span>
  );
}

function RegionCard({
  region,
  selected,
  onSelect,
}: {
  region: RegionLive;
  selected: boolean;
  onSelect: () => void;
}) {
  const maxMW = Math.max(region.generationMW, region.demandMW, 1);
  const exporting = region.netInterchangeMW > 25;
  const importing = region.netInterchangeMW < -25;
  return (
    <button
      onClick={onSelect}
      className="w-full shrink-0 rounded-lg border p-3 text-left transition-colors"
      style={{
        background: "var(--panel)",
        borderColor: selected ? "var(--gen)" : "var(--edge)",
      }}
    >
      <div className="mb-1.5 flex items-baseline justify-between gap-2">
        <span className="text-sm font-semibold">{region.name}</span>
        <span className="font-[family-name:var(--f-mono)] text-[10px] text-[var(--ink-soft)]">
          {region.priceAUD != null ? `$${region.priceAUD.toFixed(0)}/MWh` : region.network}
        </span>
      </div>
      <div className="space-y-1 font-[family-name:var(--f-mono)] text-[10px]">
        <div className="flex items-center gap-2">
          <span className="w-7 text-[var(--ink-soft)]">GEN</span>
          <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/10">
            <div
              className="h-full rounded-full"
              style={{ width: `${(region.generationMW / maxMW) * 100}%`, background: "var(--gen)" }}
            />
          </div>
          <span className="w-14 text-right">{fmtMW(region.generationMW)}</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="w-7 text-[var(--ink-soft)]">LOAD</span>
          <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/10">
            <div
              className="h-full rounded-full"
              style={{ width: `${(region.demandMW / maxMW) * 100}%`, background: "var(--load)" }}
            />
          </div>
          <span className="w-14 text-right">{fmtMW(region.demandMW)}</span>
        </div>
      </div>
      <div className="mt-2">
        <FuelBar mix={region.fuelMix} height={6} />
      </div>
      <div className="mt-1.5 flex items-center justify-between font-[family-name:var(--f-mono)] text-[10px] text-[var(--ink-soft)]">
        <span>renewables {pct(region.renewableShare)}</span>
        {exporting && <span style={{ color: "var(--gen)" }}>▲ exporting {fmtMW(region.netInterchangeMW)}</span>}
        {importing && <span style={{ color: "var(--load)" }}>▼ importing {fmtMW(-region.netInterchangeMW)}</span>}
        {!exporting && !importing && <span>balanced</span>}
      </div>
      <div className="mt-1 flex items-center justify-between font-[family-name:var(--f-mono)] text-[10px] text-[var(--ink-soft)]">
        <span>
          merchant{" "}
          {region.priceAUD != null ? (
            <span style={{ color: priceColor(region.priceAUD) }}>
              {spotAsCkwh(region.priceAUD).toFixed(1)}c
            </span>
          ) : (
            "n/a"
          )}
        </span>
        {RETAIL_REF[region.code] && <span>retail {fmtRetail(RETAIL_REF[region.code])}/kWh</span>}
      </div>
    </button>
  );
}

function SpotHistoryCard({
  history,
  regionCode,
  onSelectRegion,
  regions,
}: {
  history: HistoryPayload | null;
  regionCode: string;
  onSelectRegion: (code: string) => void;
  regions: RegionLive[];
}) {
  const points = history?.regions[regionCode] ?? [];
  const prices = points.map((p) => p[1]);
  const avg = prices.length ? prices.reduce((s, v) => s + v, 0) / prices.length : 0;
  const negShare = prices.length ? prices.filter((v) => v < 0).length / prices.length : 0;
  return (
    <div className="mt-3 border-t pt-3 font-[family-name:var(--f-mono)]" style={{ borderColor: "var(--edge)" }}>
      <div className="mb-1.5 flex items-center justify-between">
        <span className="text-[10px] tracking-widest text-[var(--ink-soft)]">SPOT — LAST 7 DAYS</span>
        {history?.demo && <span className="text-[9px] text-[#f2c14e]">SYNTHETIC</span>}
      </div>
      <div className="mb-2 flex flex-wrap gap-1">
        {regions.map((r) => (
          <button
            key={r.code}
            onClick={() => onSelectRegion(r.code)}
            className="rounded border px-1.5 py-0.5 text-[9px] tracking-wider"
            style={
              r.code === regionCode
                ? { background: "var(--gen)", color: "#0b0d11", borderColor: "var(--gen)" }
                : { color: "var(--ink-soft)", borderColor: "var(--edge)" }
            }
          >
            {r.code.replace(/\d$/, "")}
          </button>
        ))}
      </div>
      {!history ? (
        <div className="text-[10px] text-[var(--ink-soft)]">loading price history…</div>
      ) : (
        <>
          <PriceChart points={points} color={priceColor(avg)} />
          <div className="mt-1 text-[10px] text-[var(--ink-soft)]">
            avg ${Math.round(avg)}/MWh ({spotAsCkwh(avg).toFixed(1)}c/kWh)
            {negShare > 0 && <> · negative {Math.round(negShare * 100)}% of intervals</>}
          </div>
        </>
      )}
    </div>
  );
}

function LinkChip({ href, label }: { href: string; label: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="rounded border px-2 py-0.5 text-[10px] tracking-wider text-[var(--ink-soft)] hover:text-[var(--ink)]"
      style={{ borderColor: "var(--edge)" }}
    >
      {label} ↗
    </a>
  );
}

function FacilityCard({
  facility,
  spotAUD,
  onClose,
  onEnterSite,
}: {
  facility: Facility;
  spotAUD: number | null;
  onClose: () => void;
  onEnterSite: (facility: Facility) => void;
}) {
  const meta = FUEL_META[facility.fuel];
  const q = encodeURIComponent(`${facility.name} power station Australia`);
  return (
    <div
      className="absolute bottom-4 left-1/2 z-10 w-[400px] max-w-[calc(100vw-2rem)] -translate-x-1/2 rounded-xl border p-4 font-[family-name:var(--f-mono)] backdrop-blur"
      style={{ background: "var(--panel)", borderColor: "var(--edge)" }}
    >
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="text-sm font-semibold">{facility.name}</div>
          <div className="mt-0.5 text-[10px] text-[var(--ink-soft)]">
            <span style={{ color: meta.color }}>●</span> {meta.label} ·{" "}
            {facility.capacityMW >= 1000
              ? `${(facility.capacityMW / 1000).toFixed(2)} GW`
              : `${facility.capacityMW} MW`}{" "}
            registered
            {facility.region && <> · {facility.region.replace(/\d$/, "")}</>}
          </div>
        </div>
        <button onClick={onClose} className="text-[var(--ink-soft)] hover:text-[var(--ink)]">
          ✕
        </button>
      </div>
      <div className="mt-2 space-y-1 text-[10px] text-[var(--ink-soft)]">
        {facility.owner && (
          <div>
            owner/operator <span className="text-[var(--ink)]">{facility.owner}</span>
          </div>
        )}
        {spotAUD != null && (
          <div>
            regional merchant spot{" "}
            <span style={{ color: priceColor(spotAUD) }}>${spotAUD.toFixed(0)}/MWh</span>
          </div>
        )}
        <div>
          {facility.lat.toFixed(2)}, {facility.lng.toFixed(2)}
        </div>
      </div>
      <div className="mt-3 flex flex-wrap gap-1.5">
        <button
          onClick={() => onEnterSite(facility)}
          className="rounded px-2 py-0.5 text-[10px] tracking-widest"
          style={{ background: "var(--gen)", color: "#0b0d11" }}
        >
          ▶ ENTER SITE
        </button>
        {facility.url && <LinkChip href={facility.url} label="OFFICIAL SITE" />}
        <LinkChip href={`https://www.google.com/search?q=${q}`} label="GOOGLE" />
        <LinkChip
          href={`https://en.wikipedia.org/wiki/Special:Search?search=${encodeURIComponent(facility.name + " power station")}`}
          label="WIKIPEDIA"
        />
        <LinkChip href={`https://www.google.com/maps?q=${facility.lat},${facility.lng}`} label="MAP" />
        <LinkChip href="https://explore.openelectricity.org.au/facilities/nem/" label="OPENELECTRICITY" />
      </div>
    </div>
  );
}

export default function EnergyMap() {
  const [live, setLive] = useState<LivePayload | null>(null);
  const [facilities, setFacilities] = useState<FacilitiesPayload | null>(null);
  const [stale, setStale] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [tab, setTab] = useState<ViewTab>("power");
  // Mobile: the HUD lives in a bottom sheet; collapsed shows just header+tabs.
  const [sheetOpen, setSheetOpen] = useState(false);
  // The desk reads best against the price map.
  const mode: MapMode = tab === "power" ? "power" : "price";

  const [scenarioSite, setScenarioSite] = useState<ScenarioSite | null>(null);
  const [facilityDetail, setFacilityDetail] = useState<Facility | null>(null);
  const [siteFacility, setSiteFacility] = useState<Facility | null>(null);
  const [flyTo, setFlyTo] = useState<{ lat: number; lng: number; seq: number; altitude?: number; ms?: number } | null>(null);
  const flySeq = useRef(0);
  const focusAsset = useCallback((lat: number, lng: number) => {
    flySeq.current += 1;
    setFlyTo({ lat, lng, seq: flySeq.current });
  }, []);
  // OPS game clock runs regardless of tab so the fleet keeps earning.
  const game = useEnergyGame(live, true);
  const session = useSession();

  // Seamless site entry: dive the globe camera onto the asset, then mount the
  // scene (which continues the descent and crossfades in). Exit reverses.
  const enterTimer = useRef<number | null>(null);
  const enterSite = useCallback(
    (f: Facility) => {
      setFacilityDetail(null);
      flySeq.current += 1;
      setFlyTo({ lat: f.lat, lng: f.lng, seq: flySeq.current, altitude: 0.03, ms: 1500 });
      if (enterTimer.current) window.clearTimeout(enterTimer.current);
      enterTimer.current = window.setTimeout(() => setSiteFacility(f), 1450);
    },
    [],
  );
  useEffect(() => () => {
    if (enterTimer.current) window.clearTimeout(enterTimer.current);
  }, []);
  const exitSite = useCallback(() => {
    setSiteFacility(null);
    // Pull the globe camera back out to continue the ascent.
    setFlyTo((prev) => {
      if (!prev) return prev;
      flySeq.current += 1;
      return { ...prev, seq: flySeq.current, altitude: 0.5, ms: 1400 };
    });
  }, []);

  // 7-day spot history, loaded the first time the price or build view opens.
  const [history7d, setHistory7d] = useState<HistoryPayload | null>(null);
  useEffect(() => {
    if ((tab !== "price" && tab !== "build") || history7d) return;
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch("/api/energy/history?window=7d");
        if (res.ok && !cancelled) setHistory7d(await res.json());
      } catch {
        // chart card simply stays in loading state
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [tab, history7d]);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const containerRef = useRef<HTMLDivElement | null>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/energy/live");
      if (!res.ok) throw new Error(String(res.status));
      setLive(await res.json());
      setStale(false);
    } catch {
      // keep last good payload, flag it stale
      setStale(true);
    }
  }, []);

  useEffect(() => {
    void (async () => {
      await refresh();
    })();
    void (async () => {
      try {
        const res = await fetch("/api/energy/facilities");
        if (res.ok) setFacilities(await res.json());
      } catch {
        // facilities layer is optional; the globe works without it
      }
    })();
    const timer = setInterval(() => {
      if (!document.hidden) void refresh();
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [refresh]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => {
      setSize({ width: entry.contentRect.width, height: entry.contentRect.height });
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const updated = live ? new Date(live.updatedAt) : null;

  return (
    <div ref={containerRef} className="fixed inset-0 overflow-hidden">
      {size.width > 0 && (
        <EnergyGlobe
          regions={live?.regions ?? []}
          flows={live?.flows ?? []}
          facilities={facilities?.facilities ?? []}
          selectedRegion={selected}
          onSelectRegion={setSelected}
          onSelectFacility={setFacilityDetail}
          mode={mode}
          scenarioSite={tab === "build" ? scenarioSite : null}
          ownedAssets={game.state.fleet}
          flyTo={flyTo}
          width={size.width}
          height={size.height}
        />
      )}

      {/* HUD panel: floating card on desktop, bottom sheet on mobile */}
      <div
        className="absolute z-10 flex flex-col rounded-xl border backdrop-blur max-md:inset-x-0 max-md:bottom-0 max-md:max-h-[80dvh] max-md:rounded-b-none max-md:border-b-0 md:left-4 md:top-4 md:w-[330px] md:max-h-[calc(100vh-2rem)]"
        style={{ background: "var(--panel)", borderColor: "var(--edge)" }}
      >
        <div
          className="shrink-0 cursor-pointer p-4 pb-2 md:cursor-default"
          onClick={() => setSheetOpen((o) => !o)}
        >
          <div className="mx-auto mb-2 h-1 w-10 rounded-full bg-white/25 md:hidden" />
          <div className="flex items-center justify-between gap-2">
            <h1 className="text-lg font-semibold leading-tight">Australia Live Grid</h1>
            <span className="font-[family-name:var(--f-mono)] text-[10px] text-[var(--ink-soft)] md:hidden">
              {sheetOpen ? "▼" : "▲"}
            </span>
          </div>
          <div
            className="mt-2 flex w-fit overflow-hidden rounded-md border font-[family-name:var(--f-mono)] text-[10px] tracking-widest"
            style={{ borderColor: "var(--edge)" }}
          >
            {(["power", "price", "desk", "build", "ops"] as const).map((m) => (
              <button
                key={m}
                onClick={(e) => {
                  e.stopPropagation();
                  setTab(m);
                  setSheetOpen(true);
                }}
                className="px-2 py-1.5 uppercase"
                style={
                  tab === m
                    ? { background: "var(--gen)", color: "#0b0d11" }
                    : { color: "var(--ink-soft)" }
                }
              >
                {m}
              </button>
            ))}
          </div>
          <div className="mt-1.5 flex items-center justify-between gap-2">
            <StatusChip live={live} stale={stale} />
            <span className="flex items-center gap-1.5">
              {selected && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setSelected(null);
                  }}
                  className="rounded border px-1.5 py-0.5 font-[family-name:var(--f-mono)] text-[9px] tracking-widest text-[var(--ink-soft)] md:hidden"
                  style={{ borderColor: "var(--edge)" }}
                >
                  ⤺ RESET
                </button>
              )}
              {cloudEnabled() && !session && (
                <Link
                  href="/login"
                  onClick={(e) => e.stopPropagation()}
                  className="rounded border px-1.5 py-0.5 font-[family-name:var(--f-mono)] text-[9px] tracking-widest text-[var(--gen)]"
                  style={{ borderColor: "var(--edge)" }}
                >
                  SIGN IN
                </Link>
              )}
            </span>
          </div>
        </div>
        <div
          className={`min-h-0 overflow-y-auto px-4 pb-4 hud-scroll ${sheetOpen ? "" : "max-md:hidden"}`}
        >
        {live && tab === "desk" && (
          <div className="mt-3">
            <DeskPanel live={live} />
          </div>
        )}
        {live && tab === "build" && (
          <div className="mt-3">
            <BuildPanel live={live} history={history7d} onScenarioSite={setScenarioSite} />
          </div>
        )}
        {live && tab === "ops" && (
          <div className="mt-3">
            <OpsPanel
              game={game}
              live={live}
              facilities={facilities?.facilities ?? []}
              onFocusAsset={focusAsset}
              onEnterSite={enterSite}
            />
          </div>
        )}
        {live && tab !== "desk" && tab !== "build" && tab !== "ops" && (
          <>
            <div className="mt-3 grid grid-cols-3 gap-2 font-[family-name:var(--f-mono)]">
              <div>
                <div className="text-base" style={{ color: "var(--gen)" }}>
                  {fmtMW(live.national.generationMW)}
                </div>
                <div className="text-[9px] tracking-widest text-[var(--ink-soft)]">GENERATION</div>
              </div>
              <div>
                <div className="text-base" style={{ color: "var(--load)" }}>
                  {fmtMW(live.national.demandMW)}
                </div>
                <div className="text-[9px] tracking-widest text-[var(--ink-soft)]">DEMAND</div>
              </div>
              <div>
                <div className="text-base">{pct(live.national.renewableShare)}</div>
                <div className="text-[9px] tracking-widest text-[var(--ink-soft)]">RENEWABLE</div>
              </div>
            </div>
            {live.national.avgSpotAUD != null && (
              <div className="mt-2 font-[family-name:var(--f-mono)] text-[10px] text-[var(--ink-soft)]">
                avg merchant spot{" "}
                <span style={{ color: priceColor(live.national.avgSpotAUD) }}>
                  ${live.national.avgSpotAUD.toFixed(0)}/MWh
                </span>{" "}
                ({spotAsCkwh(live.national.avgSpotAUD).toFixed(1)}c/kWh) · demand-weighted
              </div>
            )}
            <div className="mt-3">
              <FuelBar mix={live.national.fuelMix} />
            </div>
            <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1">
              {live.national.fuelMix.map((s) => (
                <span
                  key={s.tech}
                  className="inline-flex items-center gap-1 font-[family-name:var(--f-mono)] text-[10px] text-[var(--ink-soft)]"
                >
                  <span className="h-2 w-2 rounded-sm" style={{ background: s.color }} />
                  {s.label} {fmtMW(s.mw)}
                </span>
              ))}
            </div>
            {tab === "price" && (
              <SpotHistoryCard
                history={history7d}
                regionCode={selected ?? "NSW1"}
                onSelectRegion={setSelected}
                regions={live.regions}
              />
            )}
            <div className="mt-3 space-y-2 md:hidden">
              {live.regions.map((region) => (
                <RegionCard
                  key={region.code}
                  region={region}
                  selected={selected === region.code}
                  onSelect={() => setSelected(selected === region.code ? null : region.code)}
                />
              ))}
            </div>
          </>
        )}
        </div>
      </div>

      {/* Region cards: right rail, desktop only (mobile gets them in the sheet) */}
      <div className="absolute hidden gap-2 hud-scroll md:right-4 md:top-4 md:bottom-4 md:flex md:w-72 md:flex-col md:overflow-y-auto">
        {(live?.regions ?? []).map((region) => (
          <RegionCard
            key={region.code}
            region={region}
            selected={selected === region.code}
            onSelect={() => setSelected(selected === region.code ? null : region.code)}
          />
        ))}
        {selected && (
          <button
            onClick={() => setSelected(null)}
            className="shrink-0 rounded-lg border px-3 py-2 font-[family-name:var(--f-mono)] text-[10px] tracking-widest text-[var(--ink-soft)]"
            style={{ background: "var(--panel)", borderColor: "var(--edge)" }}
          >
            ⤺ RESET VIEW
          </button>
        )}
      </div>

      {facilityDetail && (
        <FacilityCard
          facility={facilityDetail}
          spotAUD={live?.regions.find((r) => r.code === facilityDetail.region)?.priceAUD ?? null}
          onClose={() => setFacilityDetail(null)}
          onEnterSite={enterSite}
        />
      )}

      {siteFacility && (
        <AssetScene
          facility={siteFacility}
          game={game}
          spotAUD={live?.regions.find((r) => r.code === siteFacility.region)?.priceAUD ?? null}
          estLiveMW={(() => {
            // Estimate this site's live output: regional fuel-tech generation
            // split by capacity share among same-fuel facilities.
            const region = live?.regions.find((r) => r.code === siteFacility.region);
            const slice = region?.fuelMix.find((f) => f.tech === siteFacility.fuel);
            const peers = facilities?.facilities.filter(
              (f) => f.region === siteFacility.region && f.fuel === siteFacility.fuel,
            );
            const capSum = peers?.reduce((sum, f) => sum + f.capacityMW, 0) ?? 0;
            if (!slice || capSum <= 0) return null;
            return (slice.mw * siteFacility.capacityMW) / capSum;
          })()}
          onClose={exitSite}
        />
      )}

      {/* Bottom-left: map key + attribution (hidden while desk/build use the column) */}
      {tab !== "desk" && tab !== "build" && tab !== "ops" && (
      <div
        className="absolute bottom-4 left-4 rounded-xl border p-3 font-[family-name:var(--f-mono)] text-[10px] text-[var(--ink-soft)] backdrop-blur max-md:hidden"
        style={{ background: "var(--panel)", borderColor: "var(--edge)" }}
      >
        {mode === "power" ? (
          <div className="space-y-1">
            <div>
              <span style={{ color: "var(--gen)" }}>█</span> generation column ·{" "}
              <span style={{ color: "var(--load)" }}>█</span> load column (height = MW)
            </div>
            <div>● power stations coloured by fuel, sized by capacity</div>
            <div>
              <span style={{ color: "#f2c14e" }}>⌒</span> interconnector flow (speed = MW)
            </div>
          </div>
        ) : (
          <div className="space-y-1">
            <div>█ column height = wholesale spot price ($/MWh)</div>
            <div className="flex flex-wrap gap-x-2">
              {PRICE_BANDS.map((band) => (
                <span key={band.label} className="inline-flex items-center gap-1">
                  <span className="h-2 w-2 rounded-sm" style={{ background: band.color }} />
                  {band.label}
                </span>
              ))}
            </div>
            <div>retail = FY25–26 reference offers (DMO / VDO / regulated), incl GST</div>
          </div>
        )}
        <div className="mt-2 border-t pt-2" style={{ borderColor: "var(--edge)" }}>
          data: AEMO + OpenElectricity (OpenNEM) · 5-min dispatch · zoom imagery © Esri
          {updated && <> · updated {updated.toLocaleTimeString()}</>}
          {facilities?.demo && <> · station list: built-in sample</>}
        </div>
      </div>
      )}
    </div>
  );
}
