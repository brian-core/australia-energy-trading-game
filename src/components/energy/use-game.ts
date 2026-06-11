"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  buyAsset,
  loadGame,
  newGame,
  saveGame,
  sellAsset,
  startMaintenance,
  tick,
  type GameState,
} from "@/lib/energy/game";
import type { Facility, LivePayload } from "@/lib/energy/types";
import { loadCloudSave, saveCloudSave, useSession } from "@/lib/cloud";

const TICK_MS = 5000;

export interface GameApi {
  state: GameState;
  buy: (facility: Facility) => void;
  sell: (assetId: string) => void;
  maintain: (assetId: string, taskId: string) => void;
  reset: () => void;
  now: number;
}

/** Game clock + persistence. Revenue accrues at the live regional spot. */
export function useEnergyGame(live: LivePayload | null, enabled: boolean): GameApi {
  const [state, setState] = useState<GameState>(loadGame);
  const [now, setNow] = useState<number>(() => Date.now());
  const session = useSession();
  const stateRef = useRef(state);
  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  // Cloud sync: on sign-in adopt the newer save; push the latest every 30s.
  useEffect(() => {
    if (!session) return;
    let cancelled = false;
    void loadCloudSave().then((remote) => {
      if (!cancelled && remote && remote.lastTick > stateRef.current.lastTick) {
        setState(remote);
      }
    });
    const push = setInterval(() => void saveCloudSave(stateRef.current), 30_000);
    return () => {
      cancelled = true;
      clearInterval(push);
      void saveCloudSave(stateRef.current);
    };
  }, [session]);

  const spotByRegion = useMemo(
    () => new Map((live?.regions ?? []).map((r) => [r.code, r.priceAUD])),
    [live],
  );
  const spotRef = useRef(spotByRegion);
  useEffect(() => {
    spotRef.current = spotByRegion;
  }, [spotByRegion]);

  useEffect(() => {
    if (!enabled) return;
    const timer = setInterval(() => {
      const t = Date.now();
      setNow(t);
      setState((s) => tick(s, t, spotRef.current));
    }, TICK_MS);
    return () => clearInterval(timer);
  }, [enabled]);

  useEffect(() => {
    saveGame(state);
  }, [state]);

  const buy = useCallback((facility: Facility) => {
    setState((s) => buyAsset(s, facility, Date.now()) ?? s);
  }, []);
  const sell = useCallback((assetId: string) => {
    setState((s) => sellAsset(s, assetId, Date.now()));
  }, []);
  const maintain = useCallback((assetId: string, taskId: string) => {
    setState((s) => startMaintenance(s, assetId, taskId, Date.now()));
  }, []);
  const reset = useCallback(() => {
    setState(newGame());
  }, []);

  return { state, buy, sell, maintain, reset, now };
}
