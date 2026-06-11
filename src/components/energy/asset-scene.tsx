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
  // Crossfade in after the globe finishes its dive; fade out on exit.
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const id = requestAnimationFrame(() => setVisible(true));
    return () => cancelAnimationFrame(id);
  }, []);
  const closingRef = useRef<number | null>(null);
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

  // Active maintenance job (owned assets only) so the scene can show the crew.
  const jobRef = useRef<{ taskId: string; until: number; durationMs: number } | null>(null);
  useEffect(() => {
    if (owned?.job && owned.job.until > game.now) {
      const def = tasks.find((t) => t.id === owned.job!.taskId);
      jobRef.current = {
        taskId: owned.job.taskId,
        until: owned.job.until,
        durationMs: (def?.durationSec ?? 60) * 1000,
      };
    } else {
      jobRef.current = null;
    }
  }, [owned, game.now, tasks]);

  // Build the scene once per facility.
  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    // Retro pixel look: render small, upscale with nearest-neighbour.
    const PIXEL_SCALE = 0.55;
    const renderer = new THREE.WebGLRenderer({ antialias: false });
    renderer.setSize(
      Math.round(mount.clientWidth * PIXEL_SCALE),
      Math.round(mount.clientHeight * PIXEL_SCALE),
      false,
    );
    renderer.domElement.style.width = "100%";
    renderer.domElement.style.height = "100%";
    renderer.domElement.style.imageRendering = "pixelated";
    mount.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    // Day/night sky from AEST-ish local time.
    const h = (new Date().getUTCHours() + 10) % 24;
    const daylight = Math.max(Math.sin((Math.PI * (h - 6)) / 13), 0.22);
    const sky = new THREE.Color(0x0c1322).lerp(new THREE.Color(0x8ecdf0), Math.max(daylight - 0.22, 0) / 0.78);
    scene.background = sky;
    // No atmospheric fog: the iso pixel style is crisp to the horizon.

    // Orthographic dimetric projection — the SimCity 3000 / RCT camera.
    const VIEW_H = 110;
    const aspect = mount.clientWidth / mount.clientHeight;
    const camera = new THREE.OrthographicCamera(
      (-VIEW_H * aspect) / 2,
      (VIEW_H * aspect) / 2,
      VIEW_H / 2,
      -VIEW_H / 2,
      -600,
      1600,
    );
    // Classic 2:1 iso elevation (~26.6°), azimuth 45°.
    const CAM_HIGH = new THREE.Vector3(12, 420, 18);
    const CAM_REST = new THREE.Vector3(170, 120, 170);
    const ZOOM_HIGH = 0.45;
    const ZOOM_REST = 1;
    camera.position.copy(CAM_HIGH);
    camera.zoom = ZOOM_HIGH;
    camera.updateProjectionMatrix();
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.target.set(0, 5, 0);
    controls.minZoom = 0.4;
    controls.maxZoom = 4;
    // Keep the tilt inside a tycoon-ish band; spin freely.
    controls.minPolarAngle = 0.95;
    controls.maxPolarAngle = 1.25;
    controls.enableDamping = true;
    controls.enabled = false;

    scene.add(new THREE.HemisphereLight(0xdde9f0, 0x3a4046, 0.85 + daylight * 0.35));
    // Fixed key direction so box faces always read as three clean tones.
    const sun = new THREE.DirectionalLight(0xfff4e0, 0.45 + daylight * 0.75);
    sun.position.set(120, 160, 60);
    scene.add(sun);
    // Site floodlights so night visits stay readable.
    const flood = new THREE.PointLight(0xfff4e0, (1 - daylight) * 1400, 220, 1.7);
    flood.position.set(0, 40, 10);
    scene.add(flood);

    const built = buildAssetScene(facility.fuel, facility.capacityMW, facility.name);
    builtRef.current = built;
    scene.add(built.root);

    // Maintenance crew rig: hi-vis ute with a flashing beacon; cones and
    // workers appear once it arrives at the work site.
    const rig = new THREE.Group();
    const orange = new THREE.MeshLambertMaterial({ color: 0xe87b2e });
    const uteBody = new THREE.Mesh(new THREE.BoxGeometry(2.8, 0.7, 1.4), orange);
    uteBody.position.y = 0.65;
    const uteCab = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.6, 1.3), orange);
    uteCab.position.set(-0.4, 1.3, 0);
    const beaconMat = new THREE.MeshLambertMaterial({ color: 0x3f8fd2, emissive: 0x1a4a8a });
    const uteBeacon = new THREE.Mesh(new THREE.SphereGeometry(0.18, 8, 8), beaconMat);
    uteBeacon.position.set(-0.4, 1.72, 0);
    rig.add(uteBody, uteCab, uteBeacon);
    const wheelMat = new THREE.MeshLambertMaterial({ color: 0x1c1e22 });
    for (const [wx, wz] of [[-0.95, 0.7], [0.95, 0.7], [-0.95, -0.7], [0.95, -0.7]] as const) {
      const w = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.25, 8), wheelMat);
      w.rotation.x = Math.PI / 2;
      w.position.set(wx, 0.32, wz);
      rig.add(w);
    }
    const siteKit = new THREE.Group();
    const coneMat = new THREE.MeshLambertMaterial({ color: 0xe87b2e });
    for (let i = 0; i < 4; i++) {
      const cone = new THREE.Mesh(new THREE.ConeGeometry(0.28, 0.8, 8), coneMat);
      const a = (i / 4) * Math.PI * 2 + 0.5;
      cone.position.set(Math.cos(a) * 2.4, 0.4, Math.sin(a) * 2.4);
      siteKit.add(cone);
    }
    const hiVis = new THREE.MeshLambertMaterial({ color: 0xf2c14e, emissive: 0x6a5210 });
    for (const off of [-0.9, 0.9]) {
      const worker = new THREE.Mesh(new THREE.BoxGeometry(0.45, 1.15, 0.45), hiVis);
      worker.position.set(off, 0.95, 1.3);
      siteKit.add(worker);
    }
    siteKit.visible = false;
    rig.add(siteKit);
    rig.visible = false;
    scene.add(rig);
    const crewStart = new THREE.Vector3(...built.crewStart);

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
    const INTRO_MS = 1600;
    const ease = (k: number) => 1 - Math.pow(1 - k, 3);
    const animate = () => {
      raf = requestAnimationFrame(animate);
      const nowMs = performance.now();
      const t = (nowMs - t0) / 1000;
      // Continue the dive: drop from orbit height to the resting shot.
      if (nowMs - t0 < INTRO_MS) {
        const k = ease((nowMs - t0) / INTRO_MS);
        camera.position.lerpVectors(CAM_HIGH, CAM_REST, k);
        camera.zoom = ZOOM_HIGH + (ZOOM_REST - ZOOM_HIGH) * k;
        camera.updateProjectionMatrix();
        camera.lookAt(0, 5, 0);
      } else if (closingRef.current != null) {
        const k = Math.min((nowMs - closingRef.current) / 900, 1);
        controls.enabled = false;
        camera.position.lerpVectors(CAM_REST, CAM_HIGH, ease(k));
        camera.zoom = ZOOM_REST + (ZOOM_HIGH - ZOOM_REST) * ease(k);
        camera.updateProjectionMatrix();
        camera.lookAt(0, 5, 0);
      } else if (!controls.enabled) {
        controls.enabled = true;
      }
      // Job progress + crew choreography.
      let activeJob: { taskId: string; progress: number } | null = null;
      const jb = jobRef.current;
      if (jb && jb.until > Date.now()) {
        activeJob = {
          taskId: jb.taskId,
          progress: Math.min(Math.max(1 - (jb.until - Date.now()) / jb.durationMs, 0), 1),
        };
      }
      if (activeJob) {
        const siteArr = built.workSites[activeJob.taskId];
        if (siteArr) {
          rig.visible = true;
          const site = new THREE.Vector3(siteArr[0], 0, siteArr[2]);
          const driveK = Math.min(activeJob.progress / 0.22, 1);
          const eased = 1 - Math.pow(1 - driveK, 2);
          rig.position.lerpVectors(crewStart, site, eased);
          if (driveK < 1) rig.lookAt(site.x, 0, site.z);
          siteKit.visible = driveK >= 1;
          const flash = (Math.sin(t * 9) + 1) / 2;
          beaconMat.emissive.setRGB(0.1, 0.2 + 0.5 * flash, 0.9 * flash + 0.1);
        }
      } else {
        rig.visible = false;
      }
      built.tick(t, outputRef.current, conditionsRef.current, activeJob);
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
      const a = mount.clientWidth / mount.clientHeight;
      camera.left = (-VIEW_H * a) / 2;
      camera.right = (VIEW_H * a) / 2;
      camera.updateProjectionMatrix();
      renderer.setSize(
        Math.round(mount.clientWidth * PIXEL_SCALE),
        Math.round(mount.clientHeight * PIXEL_SCALE),
        false,
      );
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

  const close = useCallback(() => {
    if (closingRef.current != null) return;
    closingRef.current = performance.now();
    setVisible(false);
    window.setTimeout(onClose, 900);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-30 font-[family-name:var(--f-mono)] transition-opacity duration-700"
      style={{ opacity: visible ? 1 : 0 }}
    >
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
