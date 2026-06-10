"use client";

// Full-screen "SimCity" view of a single asset: a procedural low-poly scene
// that animates with live output, an X-ray mode that exposes the working
// components, and click-to-inspect wired into the OPS maintenance engine.
// Loaded via next/dynamic ssr:false — three.js needs the DOM.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import {
  buildAssetScene,
  condColorHex,
  type BuiltAsset,
} from "@/lib/energy/asset-scene-builders";
import { CF_BY_FUEL, TASKS_BY_FUEL, assetOutputMW, type OwnedAsset } from "@/lib/energy/game";
import { FUEL_META } from "@/lib/energy/regions";
import { priceColor } from "@/lib/energy/pricing";
import type { Facility } from "@/lib/energy/types";
import type { GameApi } from "./use-game";

function money(x: number): string {
  const abs = Math.abs(x);
  if (abs >= 1e6) return `$${(abs / 1e6).toFixed(1)}m`;
  if (abs >= 1e3) return `$${(abs / 1e3).toFixed(0)}k`;
  return `$${abs.toFixed(0)}`;
}

function groundColor(fuel: Facility["fuel"], offshore: boolean): number {
  if (offshore) return 0x1c4a5e;
  switch (fuel) {
    case "solar":
      return 0x8a6d3b;
    case "wind":
      return 0x55672f;
    case "hydro":
      return 0x4a5a3a;
    default:
      return 0x3a4046;
  }
}

export default function AssetScene({
  facility,
  game,
  spotAUD,
  onClose,
}: {
  facility: Facility;
  game: GameApi;
  spotAUD: number | null;
  onClose: () => void;
}) {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const [xray, setXray] = useState(false);
  const xrayRef = useRef(false);
  useEffect(() => {
    xrayRef.current = xray;
  }, [xray]);
  const [selected, setSelected] = useState<string | null>(null);
  const builtRef = useRef<BuiltAsset | null>(null);

  const owned: OwnedAsset | undefined = game.state.fleet.find((a) => a.id === facility.name);
  const tasks = TASKS_BY_FUEL[facility.fuel];
  const conditions = useMemo<Record<string, number>>(() => {
    if (owned) return owned.conditions;
    const steady: Record<string, number> = {};
    for (const t of tasks) steady[t.id] = 92;
    return steady;
  }, [owned, tasks]);
  const conditionsRef = useRef(conditions);
  useEffect(() => {
    conditionsRef.current = conditions;
  }, [conditions]);

  const outputFactor = owned
    ? assetOutputMW(owned, game.now) / Math.max(facility.capacityMW, 1)
    : CF_BY_FUEL[facility.fuel] * 0.9;
  const outputRef = useRef(outputFactor);
  useEffect(() => {
    outputRef.current = outputFactor;
  }, [outputFactor]);

  // Build the scene once per facility.
  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(mount.clientWidth, mount.clientHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    mount.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0b1018);
    scene.fog = new THREE.Fog(0x0b1018, 90, 220);

    const camera = new THREE.PerspectiveCamera(50, mount.clientWidth / mount.clientHeight, 0.1, 500);
    camera.position.set(38, 26, 48);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.target.set(0, 5, 0);
    controls.maxDistance = 140;
    controls.minDistance = 8;
    controls.maxPolarAngle = Math.PI / 2.05;
    controls.enableDamping = true;

    // Day/night lighting from AEST-ish local time.
    const h = (new Date().getUTCHours() + 10) % 24;
    const daylight = Math.max(Math.sin((Math.PI * (h - 6)) / 13), 0.2);
    scene.add(new THREE.HemisphereLight(0xbfd6e0, 0x20242a, 0.5 + daylight * 0.5));
    const sun = new THREE.DirectionalLight(0xfff2dd, 0.4 + daylight * 1.1);
    sun.position.set(Math.cos((h / 24) * Math.PI * 2) * 60, 30 + daylight * 50, -40);
    scene.add(sun);
    // Site floodlights so night visits stay readable.
    const flood = new THREE.PointLight(0xfff4e0, (1 - daylight) * 900, 160, 1.8);
    flood.position.set(0, 35, 10);
    scene.add(flood);

    const offshore = /offshore/i.test(facility.name);
    const ground = new THREE.Mesh(
      new THREE.CircleGeometry(130, 48),
      new THREE.MeshLambertMaterial({ color: groundColor(facility.fuel, offshore) }),
    );
    ground.rotation.x = -Math.PI / 2;
    scene.add(ground);

    const built = buildAssetScene(facility.fuel, facility.capacityMW, facility.name);
    builtRef.current = built;
    scene.add(built.root);

    // Raycast clicks onto components for inspection.
    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    let downAt = 0;
    const onDown = () => {
      downAt = Date.now();
    };
    const onUp = (e: PointerEvent) => {
      if (Date.now() - downAt > 250) return; // drag, not click
      const rect = renderer.domElement.getBoundingClientRect();
      pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(pointer, camera);
      for (const comp of built.components) {
        if (raycaster.intersectObject(comp.group, true).length > 0) {
          setSelected(comp.taskId);
          return;
        }
      }
      setSelected(null);
    };
    renderer.domElement.addEventListener("pointerdown", onDown);
    renderer.domElement.addEventListener("pointerup", onUp);

    let raf = 0;
    const t0 = performance.now();
    const animate = () => {
      raf = requestAnimationFrame(animate);
      const t = (performance.now() - t0) / 1000;
      built.tick(t, outputRef.current, conditionsRef.current);
      // Status materials track live condition; shells fade in X-ray mode.
      for (const comp of built.components) {
        comp.statusMat.color.setHex(condColorHex(conditionsRef.current[comp.taskId] ?? 100));
      }
      for (const shell of built.shells) {
        const m = shell.material as THREE.MeshLambertMaterial;
        m.transparent = true;
        m.opacity = xrayRef.current ? 0.14 : 1;
        m.depthWrite = !xrayRef.current;
      }
      controls.update();
      renderer.render(scene, camera);
    };
    animate();

    const onResize = () => {
      camera.aspect = mount.clientWidth / mount.clientHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(mount.clientWidth, mount.clientHeight);
    };
    window.addEventListener("resize", onResize);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", onResize);
      renderer.domElement.removeEventListener("pointerdown", onDown);
      renderer.domElement.removeEventListener("pointerup", onUp);
      controls.dispose();
      renderer.dispose();
      mount.removeChild(renderer.domElement);
      scene.traverse((obj) => {
        if (obj instanceof THREE.Mesh) {
          obj.geometry.dispose();
          const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
          mats.forEach((m) => m.dispose());
        }
      });
      builtRef.current = null;
    };
  }, [facility]);

  // Interior components are the ones hidden inside building shells.
  const selectedInterior = selected === "mech";
  const selectedTask = tasks.find((t) => t.id === selected);
  const cond = selected != null ? Math.round(conditions[selected] ?? 100) : null;
  const fixCost = selectedTask ? selectedTask.costPerMW * facility.capacityMW : 0;
  const busy = owned?.job != null && owned.job.until > game.now;
  const outMW = Math.round(outputFactor * facility.capacityMW);

  const close = useCallback(() => onClose(), [onClose]);

  return (
    <div className="fixed inset-0 z-30 bg-[#0b1018] font-[family-name:var(--f-mono)]">
      <div ref={mountRef} className="absolute inset-0" />

      {/* Top bar */}
      <div className="absolute left-4 top-4 flex items-center gap-3">
        <button
          onClick={close}
          className="rounded-lg border px-3 py-1.5 text-[10px] tracking-widest text-[var(--ink-soft)] backdrop-blur hover:text-[var(--ink)]"
          style={{ background: "var(--panel)", borderColor: "var(--edge)" }}
        >
          ← BACK TO MAP
        </button>
        <button
          onClick={() => setXray((x) => !x)}
          className="rounded-lg border px-3 py-1.5 text-[10px] tracking-widest backdrop-blur"
          style={{
            background: xray ? "var(--gen)" : "var(--panel)",
            color: xray ? "#0b0d11" : "var(--ink-soft)",
            borderColor: xray ? "var(--gen)" : "var(--edge)",
          }}
        >
          ⊕ X-RAY {xray ? "ON" : "OFF"}
        </button>
      </div>

      {/* Asset header */}
      <div
        className="absolute right-4 top-4 w-[280px] rounded-xl border p-3 backdrop-blur"
        style={{ background: "var(--panel)", borderColor: "var(--edge)" }}
      >
        <div className="text-sm font-semibold">
          <span style={{ color: FUEL_META[facility.fuel].color }}>●</span> {facility.name}
        </div>
        <div className="mt-1 text-[10px] text-[var(--ink-soft)]">
          {FUEL_META[facility.fuel].label} · {facility.capacityMW} MW registered
          {facility.owner && <> · {facility.owner}</>}
        </div>
        <div className="mt-1.5 text-[10px] text-[var(--ink-soft)]">
          sending out <span className="text-[var(--ink)]">{outMW} MW</span>
          {spotAUD != null && (
            <>
              {" "}
              at <span style={{ color: priceColor(spotAUD) }}>${spotAUD.toFixed(0)}/MWh</span> ·{" "}
              {money(outMW * spotAUD)}/h
            </>
          )}
        </div>
        <div className="mt-1.5 space-y-1">
          {tasks.map((task) => {
            const v = Math.round(conditions[task.id] ?? 100);
            return (
              <button
                key={task.id}
                onClick={() => setSelected(task.id)}
                className="flex w-full items-center gap-2 text-[10px]"
              >
                <span className="w-28 truncate text-left text-[var(--ink-soft)]">{task.label}</span>
                <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/10">
                  <div
                    className="h-full rounded-full"
                    style={{ width: `${v}%`, background: `#${condColorHex(v).toString(16)}` }}
                  />
                </div>
                <span className="w-8 text-right" style={{ color: `#${condColorHex(v).toString(16)}` }}>
                  {v}%
                </span>
              </button>
            );
          })}
        </div>
        {!owned && (
          <div className="mt-2 text-[9px] leading-snug text-[var(--ink-soft)]">
            NOT IN YOUR FLEET — buy it in OPS to manage maintenance. Showing nominal condition.
          </div>
        )}
      </div>

      {/* Inspect card */}
      {selectedTask && cond != null && (
        <div
          className="absolute bottom-4 left-1/2 w-[380px] max-w-[calc(100vw-2rem)] -translate-x-1/2 rounded-xl border p-3.5 backdrop-blur"
          style={{ background: "var(--panel)", borderColor: "var(--edge)" }}
        >
          <div className="flex items-start justify-between gap-2">
            <div className="text-[12px] font-semibold">{selectedTask.label}</div>
            <button onClick={() => setSelected(null)} className="text-[var(--ink-soft)]">
              ✕
            </button>
          </div>
          <div className="mt-1 text-[10px] text-[var(--ink-soft)]">
            condition{" "}
            <span style={{ color: `#${condColorHex(cond).toString(16)}` }}>{cond}%</span> · wears{" "}
            {selectedTask.decayPerMin.toFixed(1)}%/min ·{" "}
            {selectedInterior ? "interior — use X-ray to see it working" : "visible on site"}
          </div>
          {owned ? (
            <button
              onClick={() => game.maintain(owned.id, selectedTask.id)}
              disabled={busy || fixCost > game.state.cash}
              className="mt-2 rounded px-3 py-1 text-[10px] tracking-widest disabled:opacity-30"
              style={{ background: "var(--gen)", color: "#0b0d11" }}
            >
              {busy
                ? "CREW BUSY"
                : `RUN ${selectedTask.label.toUpperCase()} · ${money(fixCost)} · ${selectedTask.durationSec}s`}
            </button>
          ) : (
            <div className="mt-2 text-[10px] text-[var(--ink-soft)]">
              maintenance available once owned (OPS → MARKET)
            </div>
          )}
        </div>
      )}

      {/* Hint */}
      {!selectedTask && (
        <div className="pointer-events-none absolute bottom-4 left-1/2 -translate-x-1/2 text-[10px] tracking-widest text-[var(--ink-soft)]">
          DRAG TO ORBIT · SCROLL TO ZOOM · CLICK A COMPONENT TO INSPECT
        </div>
      )}
    </div>
  );
}
