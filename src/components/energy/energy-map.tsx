"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useRef, useState } from "react";
import type { FacilitiesPayload, FuelSlice, LivePayload, RegionLive } from "@/lib/energy/types";

const EnergyGlobe = dynamic(() => import("./energy-globe"), {
  ssr: false,
  loading: () => (
    <div className="flex h-full w-full items-center justify-center font-[family-name:var(--f-mono)] text-xs tracking-widest text-[var(--ink-soft)]">
      LOADING GLOBE…
    </div>
  ),
});

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
      className="w-full shrink-0 rounded-lg border p-3 text-left transition-colors max-md:w-64"
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
    </button>
  );
}

export default function EnergyMap() {
  const [live, setLive] = useState<LivePayload | null>(null);
  const [facilities, setFacilities] = useState<FacilitiesPayload | null>(null);
  const [stale, setStale] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
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
          width={size.width}
          height={size.height}
        />
      )}

      {/* Top-left: title + national stats */}
      <div
        className="absolute left-4 top-4 w-[300px] max-w-[calc(100vw-2rem)] rounded-xl border p-4 backdrop-blur"
        style={{ background: "var(--panel)", borderColor: "var(--edge)" }}
      >
        <h1 className="text-lg font-semibold leading-tight">Australia Live Grid</h1>
        <div className="mt-1">
          <StatusChip live={live} stale={stale} />
        </div>
        {live && (
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
          </>
        )}
      </div>

      {/* Region cards: right rail on desktop, bottom strip on mobile */}
      <div className="absolute flex gap-2 max-md:bottom-3 max-md:left-3 max-md:right-3 max-md:flex-row max-md:overflow-x-auto md:right-4 md:top-4 md:bottom-4 md:w-72 md:flex-col md:overflow-y-auto hud-scroll">
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

      {/* Bottom-left: map key + attribution */}
      <div
        className="absolute bottom-4 left-4 rounded-xl border p-3 font-[family-name:var(--f-mono)] text-[10px] text-[var(--ink-soft)] backdrop-blur max-md:hidden"
        style={{ background: "var(--panel)", borderColor: "var(--edge)" }}
      >
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
        <div className="mt-2 border-t pt-2" style={{ borderColor: "var(--edge)" }}>
          data: AEMO + OpenElectricity (OpenNEM) · 5-min dispatch
          {updated && <> · updated {updated.toLocaleTimeString()}</>}
          {facilities?.demo && <> · station list: built-in sample</>}
        </div>
      </div>
    </div>
  );
}
