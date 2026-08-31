"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  CF_BY_FUEL,
  CHEATS,
  TASKS_BY_FUEL,
  assetOutputMW,
  buyPrice,
  companyValue,
  sellPrice,
} from "@/lib/energy/game";
import { FUEL_META } from "@/lib/energy/regions";
import { priceColor } from "@/lib/energy/pricing";
import type { Facility, LivePayload } from "@/lib/energy/types";
import AccountCard from "./account-card";
import type { GameApi } from "./use-game";

// OPS view: the asset management game. Buy plants, run maintenance, earn the
// live spot price. All simulated — but the prices are real.

function money(x: number): string {
  const sign = x < 0 ? "−" : "";
  const abs = Math.abs(x);
  if (abs >= 1e9) return `${sign}$${(abs / 1e9).toFixed(2)}b`;
  if (abs >= 1e6) return `${sign}$${(abs / 1e6).toFixed(1)}m`;
  if (abs >= 1e3) return `${sign}$${(abs / 1e3).toFixed(0)}k`;
  return `${sign}$${abs.toFixed(0)}`;
}

function condColor(v: number): string {
  if (v >= 70) return "#48a87c";
  if (v >= 40) return "#f2c14e";
  return "#e2483d";
}

const CHEAT_CODES = Object.keys(CHEATS);
const CHEAT_BUFFER_LEN = Math.max(...CHEAT_CODES.map((c) => c.length));

/** GTA-style typed cheat codes: type a code (see CHEATS in game.ts) anywhere
 *  in OPS, outside a text field, to trigger it. Not a hidden backdoor — it's
 *  an Easter egg the player has to know or discover, and using one flips
 *  GameState.cheatsUsed so cloud save/leaderboard turn off for that game. */
function useCheatListener(onMatch: (code: string) => void) {
  const bufferRef = useRef("");
  useEffect(() => {
    function handleKeydown(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null;
      if (target && /^(INPUT|TEXTAREA)$/.test(target.tagName)) return;
      if (e.key.length !== 1 || !/[a-zA-Z]/.test(e.key)) return;
      bufferRef.current = (bufferRef.current + e.key.toUpperCase()).slice(-CHEAT_BUFFER_LEN);
      const hit = CHEAT_CODES.find((c) => bufferRef.current.endsWith(c));
      if (hit) {
        bufferRef.current = "";
        onMatch(hit);
      }
    }
    window.addEventListener("keydown", handleKeydown);
    return () => window.removeEventListener("keydown", handleKeydown);
  }, [onMatch]);
}

export default function OpsPanel({
  game,
  live,
  facilities,
  onFocusAsset,
  onEnterSite,
}: {
  game: GameApi;
  live: LivePayload;
  facilities: Facility[];
  onFocusAsset: (lat: number, lng: number) => void;
  onEnterSite: (facility: Facility) => void;
}) {
  const { state, buy, sell, maintain, applyCheat, reset, now } = game;
  const [marketOpen, setMarketOpen] = useState(state.fleet.length === 0);
  useCheatListener(useCallback((code: string) => applyCheat(code), [applyCheat]));

  const spotByRegion = useMemo(
    () => new Map(live.regions.map((r) => [r.code, r.priceAUD])),
    [live],
  );

  const market = useMemo(
    () =>
      facilities
        .filter((f) => !state.fleet.some((a) => a.id === f.name))
        .sort((a, b) => buyPrice(a) - buyPrice(b)),
    [facilities, state.fleet],
  );

  const incomePerH = state.fleet.reduce((s, a) => {
    const spot = spotByRegion.get(a.region);
    return spot != null ? s + assetOutputMW(a, now) * spot : s;
  }, 0);

  return (
    <div className="space-y-3 font-[family-name:var(--f-mono)] text-xs">
      <div className="text-[10px] tracking-widest text-[var(--ink-soft)]">
        OPS — RUN A GENERATION COMPANY ON LIVE PRICES. KEEP THE FLEET MAINTAINED.
      </div>

      {/* Company */}
      <div className="rounded-lg border p-3.5" style={{ borderColor: "var(--edge)" }}>
        <div className="grid grid-cols-3 gap-2">
          <div>
            <div className="text-base">{money(state.cash)}</div>
            <div className="text-[10px] tracking-widest text-[var(--ink-soft)]">CASH</div>
          </div>
          <div>
            <div className="text-base" style={{ color: incomePerH >= 0 ? "var(--gen)" : "#e2483d" }}>
              {money(incomePerH)}/h
            </div>
            <div className="text-[10px] tracking-widest text-[var(--ink-soft)]">INCOME NOW</div>
          </div>
          <div>
            <div className="text-base">{money(companyValue(state))}</div>
            <div className="text-[10px] tracking-widest text-[var(--ink-soft)]">COMPANY VALUE</div>
          </div>
        </div>
        <button
          onClick={() => {
            if (window.confirm("Start over? Fleet and cash reset.")) reset();
          }}
          className="mt-2 rounded border px-1.5 py-0.5 text-[10px] tracking-widest text-[var(--ink-soft)]"
          style={{ borderColor: "var(--edge)" }}
        >
          NEW GAME
        </button>
      </div>

      <AccountCard game={game} />

      {/* Fleet */}
      {state.fleet.length > 0 && (
        <div className="space-y-2">
          {state.fleet.map((asset) => {
            const tasks = TASKS_BY_FUEL[asset.fuel];
            const spot = spotByRegion.get(asset.region) ?? null;
            const out = assetOutputMW(asset, now);
            const busy = asset.job && asset.job.until > now;
            return (
              <div key={asset.id} className="rounded-lg border p-3.5" style={{ borderColor: "var(--edge)" }}>
                <div className="flex items-baseline justify-between gap-2">
                  <button
                    onClick={() => onFocusAsset(asset.lat, asset.lng)}
                    className="text-left text-xs font-semibold hover:underline"
                    title="fly to asset"
                  >
                    <span style={{ color: FUEL_META[asset.fuel].color }}>●</span> {asset.name}
                  </button>
                  <span className="flex shrink-0 items-center gap-2">
                    <button
                      onClick={() =>
                        onEnterSite({
                          name: asset.name,
                          lat: asset.lat,
                          lng: asset.lng,
                          fuel: asset.fuel,
                          capacityMW: asset.capacityMW,
                          region: asset.region,
                        })
                      }
                      className="rounded border px-1.5 py-0.5 text-[10px] tracking-widest"
                      style={{ borderColor: "var(--edge)", color: "var(--gen)" }}
                    >
                      ▶ SITE
                    </button>
                    <button
                      onClick={() => sell(asset.id)}
                      className="text-[10px] tracking-widest text-[var(--ink-soft)] hover:text-[#e2483d]"
                      title={`sell for ${money(sellPrice(asset))}`}
                    >
                      SELL {money(sellPrice(asset))}
                    </button>
                  </span>
                </div>
                <div className="mt-0.5 text-[11px] text-[var(--ink-soft)]">
                  {Math.round(out)} / {asset.capacityMW} MW out
                  {spot != null && (
                    <>
                      {" "}· spot <span style={{ color: priceColor(spot) }}>${spot.toFixed(0)}</span> · earning{" "}
                      {money(out * spot)}/h
                    </>
                  )}
                  {busy && <span style={{ color: "#f2c14e" }}> · CREW ON SITE</span>}
                </div>
                <div className="mt-1.5 space-y-1">
                  {tasks.map((task) => {
                    const cond = asset.conditions[task.id] ?? 100;
                    const inProgress = asset.job?.taskId === task.id && asset.job.until > now;
                    const cost = task.costPerMW * asset.capacityMW;
                    return (
                      <div key={task.id} className="flex items-center gap-2 text-[11px]">
                        <span className="w-32 truncate text-[var(--ink-soft)]">{task.label}</span>
                        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/10">
                          <div
                            className="h-full rounded-full"
                            style={{
                              width: `${inProgress ? Math.min(100, ((now - (asset.job!.until - task.durationSec * 1000)) / (task.durationSec * 1000)) * 100) : cond}%`,
                              background: inProgress ? "#3f8fd2" : condColor(cond),
                            }}
                          />
                        </div>
                        <span className="w-8 text-right" style={{ color: inProgress ? "#3f8fd2" : condColor(cond) }}>
                          {inProgress ? "…" : `${Math.round(cond)}%`}
                        </span>
                        <button
                          onClick={() => maintain(asset.id, task.id)}
                          disabled={!!asset.job || cost > state.cash}
                          className="rounded border px-1.5 py-0.5 text-[10px] tracking-wider text-[var(--ink-soft)] disabled:opacity-30"
                          style={{ borderColor: "var(--edge)" }}
                          title={`${money(cost)} · ${task.durationSec}s`}
                        >
                          FIX {money(cost)}
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Market */}
      <details
        className="rounded-lg border p-3.5"
        style={{ borderColor: "var(--edge)" }}
        open={marketOpen}
        onToggle={(e) => setMarketOpen((e.target as HTMLDetailsElement).open)}
      >
        <summary className="cursor-pointer text-[11px] tracking-widest text-[var(--ink-soft)]">
          MARKET — {market.length} ASSETS FOR SALE
        </summary>
        <div className="mt-2 max-h-56 space-y-1 overflow-y-auto hud-scroll">
          {market.map((f) => {
            const price = buyPrice(f);
            const affordable = price <= state.cash;
            const spot = spotByRegion.get(f.region);
            const estPerH = spot != null ? f.capacityMW * CF_BY_FUEL[f.fuel] * spot : null;
            return (
              <div key={`${f.name}:${f.lat}:${f.lng}`} className="flex items-center justify-between gap-2 text-[11px]">
                <span className="truncate">
                  <span style={{ color: FUEL_META[f.fuel].color }}>●</span> {f.name}{" "}
                  <span className="text-[var(--ink-soft)]">
                    {f.capacityMW}MW {f.region.replace(/\d$/, "")}
                    {estPerH != null && ` · ~${money(estPerH)}/h`}
                  </span>
                </span>
                <button
                  onClick={() => buy(f)}
                  disabled={!affordable}
                  className="shrink-0 rounded border px-1.5 py-0.5 text-[10px] tracking-wider disabled:opacity-30"
                  style={{ borderColor: "var(--edge)", color: affordable ? "var(--gen)" : "var(--ink-soft)" }}
                >
                  BUY {money(price)}
                </button>
              </div>
            );
          })}
        </div>
      </details>

      {/* Log */}
      <div className="rounded-lg border p-3.5" style={{ borderColor: "var(--edge)" }}>
        <div className="mb-1 text-[11px] tracking-widest text-[var(--ink-soft)]">SITE LOG</div>
        <div className="max-h-40 space-y-1 overflow-y-auto hud-scroll">
          {[...state.log].reverse().map((entry, i) => (
            <div key={`${entry.at}-${i}`} className="flex gap-1.5 text-[11px] leading-snug">
              <span style={{ color: entry.warn ? "#e2483d" : "var(--ink-soft)" }}>
                {entry.warn ? "⚠" : "·"}
              </span>
              <span className={entry.warn ? "" : "text-[var(--ink-soft)]"}>{entry.msg}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
