import * as THREE from "three";
import type { FuelGroup } from "./types";

// Procedural "SimCity" dioramas for each asset type. Stylised, not site-
// accurate — but every scene should read as a real industrial place: fenced
// pad, access road, switchyard, transmission line marching off, terrain and
// trees, and chunky animated equipment scaled by capacity. Components map
// 1:1 to OPS maintenance tasks so X-ray doubles as a health inspector.

export interface SceneComponent {
  taskId: string;
  label: string;
  group: THREE.Group;
  interior: boolean;
  /** Material tinted by condition (green → red). */
  statusMat: THREE.MeshLambertMaterial;
}

export interface ActiveJob {
  taskId: string;
  /** 0..1 through the job's duration. */
  progress: number;
}

export interface BuiltAsset {
  root: THREE.Group;
  components: SceneComponent[];
  /** Exterior meshes faded out in X-ray mode. */
  shells: THREE.Mesh[];
  /** Where the maintenance ute parks when idle. */
  crewStart: [number, number, number];
  /** Where the crew drives to for each task. */
  workSites: Record<string, [number, number, number]>;
  tick: (
    tSec: number,
    outputFactor: number,
    conditions: Record<string, number>,
    job?: ActiveJob | null,
  ) => void;
}

// ---------------------------------------------------------------------------
// shared kit

const C = {
  steel: 0xb7c0c8,
  steelDark: 0x7e8a93,
  concrete: 0xd2d4cd,
  hall: 0x97a1a8,
  road: 0x34383d,
  gravel: 0x9a958a,
  dirt: 0x7a6a4e,
  grass: 0x5d7a40,
  scrub: 0x77834d,
  desert: 0xa08a5e,
  water: 0x2d7fa6,
  fence: 0xa8aeb4,
  glassGlow: 0xffe9b8,
  red: 0xc7402e,
};

function hash01(n: number): number {
  const x = Math.sin(n * 127.1) * 43758.5453;
  return x - Math.floor(x);
}

const mat = (color: number | string, opts: Partial<THREE.MeshLambertMaterialParameters> = {}) =>
  new THREE.MeshLambertMaterial({ color, ...opts });

function box(
  w: number,
  h: number,
  d: number,
  m: THREE.Material | number,
  x = 0,
  y: number | null = null,
  z = 0,
): THREE.Mesh {
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(w, h, d),
    typeof m === "number" ? mat(m) : m,
  );
  mesh.position.set(x, y == null ? h / 2 : y, z);
  return mesh;
}

function cyl(
  rT: number,
  rB: number,
  h: number,
  m: THREE.Material | number,
  x = 0,
  y: number | null = null,
  z = 0,
  seg = 12,
): THREE.Mesh {
  const mesh = new THREE.Mesh(
    new THREE.CylinderGeometry(rT, rB, h, seg),
    typeof m === "number" ? mat(m) : m,
  );
  mesh.position.set(x, y == null ? h / 2 : y, z);
  return mesh;
}

export function condColorHex(v: number): number {
  if (v >= 70) return 0x48a87c;
  if (v >= 40) return 0xf2c14e;
  return 0xe2483d;
}

function statusLamp(scale = 1): { mesh: THREE.Mesh; mat: THREE.MeshLambertMaterial } {
  const m = mat(0x48a87c, { emissive: 0x1c4a38 });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(0.5 * scale, 10, 10), m);
  return { mesh, mat: m };
}

function makeComponent(taskId: string, label: string, interior: boolean): SceneComponent {
  return { taskId, label, group: new THREE.Group(), interior, statusMat: statusLamp().mat };
}

/** Terrain: big ground disc, tonal patches, gentle perimeter hills. */
function makeTerrain(groundColor: number, hills = true): THREE.Group {
  const g = new THREE.Group();
  const ground = new THREE.Mesh(new THREE.CircleGeometry(260, 48), mat(groundColor));
  ground.rotation.x = -Math.PI / 2;
  g.add(ground);
  const patch = mat(new THREE.Color(groundColor).multiplyScalar(0.88).getHex());
  for (let i = 0; i < 9; i++) {
    const p = new THREE.Mesh(new THREE.CircleGeometry(10 + hash01(i) * 22, 14), patch);
    p.rotation.x = -Math.PI / 2;
    p.position.set((hash01(i + 11) - 0.5) * 360, 0.04, (hash01(i + 23) - 0.5) * 360);
    g.add(p);
  }
  if (hills) {
    const hillMat = mat(new THREE.Color(groundColor).multiplyScalar(0.75).getHex());
    for (let i = 0; i < 12; i++) {
      const r = 16 + hash01(i + 5) * 26;
      const hill = new THREE.Mesh(new THREE.SphereGeometry(r, 10, 8), hillMat);
      const a = (i / 12) * Math.PI * 2 + hash01(i) * 0.5;
      const d = 190 + hash01(i + 7) * 60;
      hill.position.set(Math.cos(a) * d, -r * 0.72, Math.sin(a) * d);
      hill.scale.y = 0.55;
      g.add(hill);
    }
  }
  return g;
}

/** Gravel pad with perimeter fence. */
function makePad(w: number, d: number): THREE.Group {
  const g = new THREE.Group();
  g.add(box(w, 0.22, d, C.gravel));
  const post = mat(C.fence);
  const rail = mat(C.fence, { transparent: true, opacity: 0.6 });
  const step = 7;
  for (let x = -w / 2; x <= w / 2; x += step) {
    g.add(cyl(0.07, 0.07, 1.7, post, x, null, -d / 2, 6));
    g.add(cyl(0.07, 0.07, 1.7, post, x, null, d / 2, 6));
  }
  for (let z = -d / 2; z <= d / 2; z += step) {
    g.add(cyl(0.07, 0.07, 1.7, post, -w / 2, null, z, 6));
    g.add(cyl(0.07, 0.07, 1.7, post, w / 2, null, z, 6));
  }
  const railH = 1.45;
  g.add(box(w, 0.07, 0.07, rail, 0, railH, -d / 2));
  g.add(box(w, 0.07, 0.07, rail, 0, railH, d / 2));
  g.add(box(0.07, 0.07, d, rail, -w / 2, railH, 0));
  g.add(box(0.07, 0.07, d, rail, w / 2, railH, 0));
  return g;
}

/** Access road from the pad edge off to the horizon, with centre dashes. */
function makeRoad(startZ: number): THREE.Group {
  const g = new THREE.Group();
  const len = 240 - startZ;
  g.add(box(7, 0.16, len, C.road, 0, null, startZ + len / 2));
  const dash = mat(0xd8d8cf);
  for (let z = startZ + 4; z < 235; z += 9) {
    g.add(box(0.35, 0.18, 3.2, dash, 0, 0.18, z));
  }
  return g;
}

/** Switchyard: transformers with bushings + gantry frame. */
function makeSubstation(): THREE.Group {
  const g = new THREE.Group();
  g.add(box(16, 0.18, 11, 0x2b3036));
  for (let i = 0; i < 2; i++) {
    const x = i * 7 - 3.5;
    g.add(box(4, 3, 2.6, C.steelDark, x, null, -1.5));
    for (let f = 0; f < 5; f++) g.add(box(0.12, 2.4, 2.2, 0x2b3036, x - 1.8 + f * 0.9, 1.5, -3));
    for (let b = 0; b < 3; b++) {
      g.add(cyl(0.14, 0.2, 1.6, C.concrete, x - 1.2 + b * 1.2, 3.7, -1.5, 8));
      const cap = new THREE.Mesh(new THREE.SphereGeometry(0.22, 8, 8), mat(C.steel));
      cap.position.set(x - 1.2 + b * 1.2, 4.6, -1.5);
      g.add(cap);
    }
  }
  const gm = mat(C.steel);
  g.add(cyl(0.12, 0.12, 7, gm, -7, null, 3.5, 6));
  g.add(cyl(0.12, 0.12, 7, gm, 7, null, 3.5, 6));
  g.add(box(14.4, 0.22, 0.22, gm, 0, 7, 3.5));
  return g;
}

/** Pylons with three conductors marching away from the substation. */
function makePowerline(origin: THREE.Vector3, dir: THREE.Vector3, count = 5): THREE.Group {
  const g = new THREE.Group();
  const legMat = mat(C.steel);
  const wireMat = mat(0x6f767d);
  const armY = 16;
  const positions: THREE.Vector3[] = [];
  for (let i = 0; i < count; i++) {
    const p = origin.clone().addScaledVector(dir, i * 34);
    positions.push(p);
    const pylon = new THREE.Group();
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        const leg = cyl(0.09, 0.16, armY, legMat, 0, null, 0, 6);
        leg.position.set(sx * 1.2, armY / 2, sz * 1.2);
        leg.rotation.z = sx * 0.07;
        leg.rotation.x = -sz * 0.07;
        pylon.add(leg);
      }
    }
    pylon.add(box(7.5, 0.35, 0.35, legMat, 0, armY));
    pylon.add(box(0.3, 3.4, 0.3, legMat, 0, armY + 1.7));
    pylon.position.copy(p);
    g.add(pylon);
  }
  const side = new THREE.Vector3(-dir.z, 0, dir.x);
  for (let i = 0; i < count - 1; i++) {
    for (const off of [-3.4, 0, 3.4]) {
      const start = positions[i].clone().addScaledVector(side, off).setY(armY - 0.4);
      const end = positions[i + 1].clone().addScaledVector(side, off).setY(armY - 0.4);
      const len = start.distanceTo(end);
      const wire = cyl(0.05, 0.05, len, wireMat, 0, 0, 0, 5);
      wire.position.copy(start.clone().add(end).multiplyScalar(0.5));
      wire.lookAt(end);
      wire.rotateX(Math.PI / 2);
      g.add(wire);
    }
  }
  return g;
}

function makeTrees(count: number, minR: number, maxR: number, seed = 0): THREE.Group {
  const g = new THREE.Group();
  const greens = [0x4f7a3a, 0x5d8a44, 0x3f6b31];
  const trunk = mat(0x6b4f35);
  for (let i = 0; i < count; i++) {
    const a = hash01(i + seed) * Math.PI * 2;
    const d = minR + hash01(i + seed + 31) * (maxR - minR);
    const s = 0.7 + hash01(i + seed + 57) * 1.1;
    const tree = new THREE.Group();
    tree.add(cyl(0.18 * s, 0.26 * s, 1.6 * s, trunk, 0, null, 0, 6));
    const can = new THREE.Mesh(new THREE.ConeGeometry(1.5 * s, 3.6 * s, 7), mat(greens[i % 3]));
    can.position.y = 1.6 * s + 1.8 * s;
    tree.add(can);
    tree.position.set(Math.cos(a) * d, 0, Math.sin(a) * d);
    g.add(tree);
  }
  return g;
}

function makeFloodlight(x: number, z: number): THREE.Group {
  const g = new THREE.Group();
  g.add(cyl(0.1, 0.14, 7, mat(C.steelDark), x, null, z, 6));
  const head = new THREE.Mesh(
    new THREE.SphereGeometry(0.42, 8, 8),
    mat(0xfff0c8, { emissive: 0x9a8a50 }),
  );
  head.position.set(x, 7.1, z);
  g.add(head);
  return g;
}

interface Beacon {
  mat: THREE.MeshLambertMaterial;
}
function makeBeacon(x: number, y: number, z: number, beacons: Beacon[]): THREE.Mesh {
  const m = mat(0xff4030, { emissive: 0xb01808 });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(0.3, 8, 8), m);
  mesh.position.set(x, y, z);
  beacons.push({ mat: m });
  return mesh;
}

function makeUte(x: number, z: number, rotY = 0): THREE.Group {
  const g = new THREE.Group();
  const bodyColors = [0xd8dde0, 0xc7402e, 0x3f6b9a];
  const c = bodyColors[Math.floor(hash01(x + z) * 3)];
  g.add(box(2.6, 0.7, 1.3, c, 0, 0.65));
  g.add(box(1.1, 0.55, 1.2, c, -0.3, 1.25));
  const wheel = mat(0x1c1e22);
  for (const [wx, wz] of [[-0.9, 0.65], [0.9, 0.65], [-0.9, -0.65], [0.9, -0.65]] as const) {
    const w = cyl(0.28, 0.28, 0.24, wheel, wx, 0.3, wz, 8);
    w.rotation.x = Math.PI / 2;
    g.add(w);
  }
  g.position.set(x, 0, z);
  g.rotation.y = rotY;
  return g;
}

function blinkBeacons(beacons: Beacon[], t: number) {
  const on = (Math.sin(t * 2.6) + 1) / 2;
  for (const b of beacons) b.mat.emissive.setRGB(0.7 * on + 0.1, 0.08 * on, 0.03 * on);
}

// ---------------------------------------------------------------------------
// WIND

function buildWind(capacityMW: number, offshore: boolean): BuiltAsset {
  const root = new THREE.Group();
  const beacons: Beacon[] = [];
  const towerH = offshore ? 30 : 20;
  const bladeL = offshore ? 13 : 9;
  const count = Math.max(5, Math.min(26, Math.round(capacityMW / 16)));

  const gearbox = makeComponent("gearbox", "Turbine nacelles & gearboxes", false);
  const software = makeComponent("software", "Control room & SCADA", false);

  if (offshore) {
    const sea = new THREE.Mesh(
      new THREE.CircleGeometry(260, 48),
      mat(0x1f5d7a, { transparent: true, opacity: 0.95 }),
    );
    sea.rotation.x = -Math.PI / 2;
    root.add(sea);
  } else {
    root.add(makeTerrain(C.scrub));
    root.add(makeTrees(26, 95, 200, 3));
  }

  const towerMat = mat(0xe6eaee);
  const nacelleMat = mat(0xcfd6db);
  const bladeMat = mat(0xf4f7f8);
  const rotors: THREE.Group[] = [];

  const cols = Math.ceil(Math.sqrt(count * 1.7));
  for (let i = 0; i < count; i++) {
    const turbine = new THREE.Group();
    turbine.add(cyl(0.55, 0.95, towerH * 0.55, towerMat, 0, null, 0, 10));
    const upper = cyl(0.38, 0.55, towerH * 0.45, towerMat, 0, null, 0, 10);
    upper.position.y = towerH * 0.55 + (towerH * 0.45) / 2;
    turbine.add(upper);
    if (offshore) {
      turbine.add(cyl(1.3, 1.6, 2.2, mat(0xd9b23a), 0, 1.1, 0, 10));
    } else {
      turbine.add(cyl(2.6, 3, 0.5, mat(C.concrete), 0, 0.25, 0, 12));
    }
    turbine.add(box(3.4, 1.5, 1.5, nacelleMat, 0.5, towerH + 0.75));
    turbine.add(makeBeacon(0.5, towerH + 1.8, 0, beacons));
    const rotor = new THREE.Group();
    const hub = new THREE.Mesh(new THREE.ConeGeometry(0.55, 1.3, 10), nacelleMat);
    hub.rotation.x = Math.PI / 2;
    rotor.add(hub);
    for (let b = 0; b < 3; b++) {
      const blade = new THREE.Mesh(new THREE.ConeGeometry(0.42, bladeL, 6), bladeMat);
      blade.position.y = bladeL / 2;
      blade.scale.z = 0.28;
      const tip = new THREE.Mesh(new THREE.ConeGeometry(0.12, 1.4, 6), mat(C.red));
      tip.position.y = bladeL - 0.6;
      tip.scale.z = 0.28;
      const arm = new THREE.Group();
      arm.add(blade, tip);
      arm.rotation.z = (b * 2 * Math.PI) / 3;
      rotor.add(arm);
    }
    rotor.position.set(2.05, towerH + 0.75, 0);
    rotor.rotation.y = Math.PI / 2;
    turbine.add(rotor);
    rotors.push(rotor);

    const x = (i % cols) * 19 - (cols * 19) / 2 + (Math.floor(i / cols) % 2) * 9;
    const z = Math.floor(i / cols) * 22 - 30;
    turbine.position.set(x, 0, z);
    turbine.rotation.y = -0.4;
    if (!offshore) {
      const padDisc = new THREE.Mesh(new THREE.CircleGeometry(3.6, 12), mat(C.dirt));
      padDisc.rotation.x = -Math.PI / 2;
      padDisc.position.set(x, 0.06, z);
      root.add(padDisc);
    }
    gearbox.group.add(turbine);
  }

  // O&M compound: control room, ute, switchyard, transmission line.
  const baseZ = 42;
  if (!offshore) {
    const pad = makePad(30, 18);
    pad.position.z = baseZ;
    root.add(pad);
    root.add(makeRoad(baseZ + 9));
  }
  software.group.add(box(7, 3.2, 5, mat(0x39424a), -8, null, baseZ));
  software.group.add(box(7.6, 0.3, 5.6, C.concrete, -8, 3.3, baseZ));
  software.group.add(
    box(6.4, 0.9, 0.05, mat(C.glassGlow, { emissive: 0x6b5a28 }), -8, 2.1, baseZ + 2.55),
  );
  const lamp = statusLamp();
  software.statusMat = lamp.mat;
  lamp.mesh.position.set(-8, 4.2, baseZ);
  software.group.add(lamp.mesh);
  software.group.add(makeUte(-2, baseZ + 4, 0.4));
  const sub = makeSubstation();
  sub.position.set(7, 0, baseZ);
  root.add(sub);
  root.add(
    makePowerline(new THREE.Vector3(7, 0, baseZ + 14), new THREE.Vector3(0.25, 0, 1).normalize(), 5),
  );
  root.add(makeFloodlight(-14, baseZ - 7), makeFloodlight(14, baseZ - 7));

  root.add(gearbox.group, software.group);
  return {
    root,
    components: [gearbox, software],
    shells: [],
    crewStart: [-2, 0, 46],
    workSites: { gearbox: [-cols * 9.5 + 9, 0, -30], software: [-8, 0, 42] },
    tick: (t, out) => {
      const speed = 0.5 + out * 5.5;
      rotors.forEach((rotor, i) => {
        rotor.rotation.z = -t * speed * (0.92 + 0.16 * hash01(i));
      });
      blinkBeacons(beacons, t);
    },
  };
}

// ---------------------------------------------------------------------------
// SOLAR

function buildSolar(capacityMW: number): BuiltAsset {
  const root = new THREE.Group();
  const soiling = makeComponent("soiling", "Panel arrays", false);
  const software = makeComponent("software", "Inverter stations", false);

  root.add(makeTerrain(C.desert));
  root.add(makeTrees(14, 120, 210, 9));

  const rows = Math.max(8, Math.min(18, Math.round(Math.sqrt(capacityMW) * 1.4)));
  const rackLen = 13;
  const cols = Math.max(4, Math.min(8, Math.round(capacityMW / rows / 8) + 3));
  const fieldW = cols * (rackLen + 3) + 6;
  const fieldD = rows * 5;

  root.add(makePad(fieldW + 14, fieldD + 16));
  root.add(makeRoad(fieldD / 2 + 8));

  const panelMat = mat(0x1c3f7a);
  const soilLamp = statusLamp();
  soiling.statusMat = soilLamp.mat;
  soilLamp.mesh.position.set(-fieldW / 2 + 2, 3.2, -fieldD / 2 - 2);
  soiling.group.add(soilLamp.mesh);
  soiling.group.add(cyl(0.08, 0.1, 3, mat(C.steelDark), -fieldW / 2 + 2, null, -fieldD / 2 - 2, 6));
  const frameMat = mat(C.steelDark);

  const rackGeo = new THREE.BoxGeometry(rackLen, 0.18, 2.9);
  const inst = new THREE.InstancedMesh(rackGeo, panelMat, rows * cols);
  const legGeo = new THREE.BoxGeometry(0.14, 1.1, 0.14);
  const legs = new THREE.InstancedMesh(legGeo, frameMat, rows * cols * 2);
  const dummy = new THREE.Object3D();
  let n = 0;
  let ln = 0;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const x = c * (rackLen + 3) - fieldW / 2 + rackLen / 2 + (c >= cols / 2 ? 6 : 0) + 2;
      const z = r * 5 - fieldD / 2;
      dummy.position.set(x, 1.5, z);
      dummy.rotation.set(-0.38, 0, 0);
      dummy.updateMatrix();
      inst.setMatrixAt(n++, dummy.matrix);
      for (const lx of [-rackLen / 2 + 1, rackLen / 2 - 1]) {
        dummy.position.set(x + lx, 0.55, z);
        dummy.rotation.set(0, 0, 0);
        dummy.updateMatrix();
        legs.setMatrixAt(ln++, dummy.matrix);
      }
    }
  }
  soiling.group.add(inst, legs);

  const nInv = Math.max(3, Math.floor(rows / 4));
  for (let i = 0; i < nInv; i++) {
    const z = i * (fieldD / nInv) - fieldD / 2 + 4;
    software.group.add(box(3, 2, 2.2, mat(0xc4c9bf), 3, null, z));
    software.group.add(box(0.8, 0.5, 1.6, C.steelDark, 4.4, 2.1, z));
    const lamp = statusLamp(0.7);
    if (i === 0) software.statusMat = lamp.mat;
    lamp.mesh.position.set(3, 2.6, z);
    software.group.add(lamp.mesh);
  }
  software.group.add(makeUte(8, fieldD / 2 + 3, 1.2));

  const sub = makeSubstation();
  sub.position.set(-fieldW / 2 - 2, 0, fieldD / 2 + 9);
  root.add(sub);
  root.add(
    makePowerline(
      new THREE.Vector3(-fieldW / 2 - 2, 0, fieldD / 2 + 22),
      new THREE.Vector3(-0.35, 0, 1).normalize(),
      5,
    ),
  );
  root.add(makeFloodlight(-fieldW / 2 - 5, 0), makeFloodlight(fieldW / 2 + 5, 0));

  root.add(soiling.group, software.group);
  return {
    root,
    components: [soiling, software],
    shells: [],
    crewStart: [8, 0, fieldD / 2 + 3],
    workSites: { soiling: [-6, 0, 0], software: [3, 0, -fieldD / 2 + 4] },
    tick: (_t, _out, conditions) => {
      const cond = (conditions.soiling ?? 100) / 100;
      panelMat.color.setRGB(0.1 + (1 - cond) * 0.42, 0.2 + (1 - cond) * 0.18, 0.46 + cond * 0.16);
    },
  };
}

// ---------------------------------------------------------------------------
// HYDRO

function buildHydro(capacityMW: number): BuiltAsset {
  const root = new THREE.Group();
  const beacons: Beacon[] = [];
  const mech = makeComponent("mech", "Turbine hall", true);
  const shells: THREE.Mesh[] = [];

  root.add(makeTerrain(C.grass, false));
  const ridgeMat = mat(0x4a6136);
  for (const sx of [-1, 1]) {
    const ridge = new THREE.Mesh(new THREE.SphereGeometry(60, 12, 10), ridgeMat);
    ridge.position.set(sx * 78, -28, -34);
    ridge.scale.set(1, 0.85, 1.7);
    root.add(ridge);
  }
  root.add(makeTrees(40, 95, 215, 17));

  const wall = new THREE.Mesh(
    new THREE.CylinderGeometry(34, 36, 20, 28, 1, true, -0.55, 1.1),
    mat(C.concrete, { side: THREE.DoubleSide }),
  );
  wall.position.set(0, 10, -16);
  shells.push(wall);
  root.add(wall);
  root.add(box(26, 0.5, 2.4, C.road, 0, 20.2, -13.6));
  for (let x = -12; x <= 12; x += 3) root.add(cyl(0.08, 0.08, 1, mat(C.fence), x, 20.4, -12.6, 6));
  root.add(makeBeacon(0, 21.6, -13.6, beacons));

  const water = new THREE.Mesh(
    new THREE.CylinderGeometry(80, 80, 9, 32, 1, false, Math.PI * 0.86, Math.PI * 1.28),
    mat(C.water, { transparent: true, opacity: 0.88 }),
  );
  water.position.set(0, 4.5, -68);
  root.add(water);

  const chute = box(7, 1, 26, C.concrete, -20, 6, 0);
  chute.rotation.x = 0.42;
  root.add(chute);
  const rapids = box(6, 0.5, 24, mat(0xcfe9f2, { transparent: true, opacity: 0 }), -20, 6.8, 0);
  rapids.rotation.x = 0.42;
  root.add(rapids);

  const river = box(16, 0.3, 150, mat(C.water, { transparent: true, opacity: 0.82 }), 0, 0.15, 78);
  root.add(river);

  const house = box(22, 8, 11, mat(C.hall), 0, null, 6);
  shells.push(house);
  root.add(house);
  const roof = box(23, 0.5, 12, C.concrete, 0, 8.2, 6);
  shells.push(roof);
  root.add(roof);
  root.add(box(20, 1.4, 0.1, mat(C.glassGlow, { emissive: 0x6b5a28 }), 0, 5.4, 11.6));
  const nTurb = Math.max(2, Math.min(6, Math.round(capacityMW / 350)));
  const turbines: THREE.Mesh[] = [];
  for (let i = 0; i < nTurb; i++) {
    const x = i * 3.6 - (nTurb - 1) * 1.8;
    const turb = new THREE.Mesh(new THREE.TorusGeometry(1.5, 0.5, 8, 16), mech.statusMat);
    turb.position.set(x, 3.4, 6);
    turb.rotation.y = Math.PI / 2;
    turbines.push(turb);
    mech.group.add(turb);
    const shaft = cyl(0.3, 0.3, 5, mat(C.steel), x, 3.4, 6, 8);
    shaft.rotation.z = Math.PI / 2;
    mech.group.add(shaft);
    const pen = cyl(0.7, 0.7, 15, mat(0x46505a), x, 0, 0, 10);
    pen.rotation.x = Math.PI / 2.45;
    pen.position.set(x, 7.5, -5);
    root.add(pen);
  }

  const sub = makeSubstation();
  sub.position.set(22, 0, 14);
  root.add(sub);
  root.add(makePowerline(new THREE.Vector3(22, 0, 28), new THREE.Vector3(0.3, 0, 1).normalize(), 5));
  root.add(makeFloodlight(-13, 13), makeFloodlight(13, 1));
  root.add(makeUte(15, 20, -0.5));
  root.add(makeRoad(34));

  root.add(mech.group);
  return {
    root,
    components: [mech],
    shells,
    crewStart: [15, 0, 20],
    workSites: { mech: [0, 0, 14] },
    tick: (t, out) => {
      const level = 4.2 + Math.sin(t / 34) * 1.4 - out * 2.2;
      water.position.y = Math.max(level, 1.2);
      (rapids.material as THREE.MeshLambertMaterial).opacity = Math.min(out * 1.3, 0.85);
      rapids.position.y = 6.8 + Math.sin(t * 6) * 0.08;
      for (const turb of turbines) turb.rotation.z += (0.5 + out * 6) * 0.016;
      blinkBeacons(beacons, t);
    },
  };
}

// ---------------------------------------------------------------------------
// COAL

function buildCoal(capacityMW: number): BuiltAsset {
  const root = new THREE.Group();
  const beacons: Beacon[] = [];
  const shells: THREE.Mesh[] = [];
  const coalstock = makeComponent("coalstock", "Coal stockyard & conveyor", false);
  const mech = makeComponent("mech", "Boiler & turbine hall", true);

  // Everything scales with capacity so Eraring dwarfs a 300 MW plant.
  const nUnits = Math.max(1, Math.min(4, Math.round(capacityMW / 700)));
  const nTowers = Math.max(1, Math.min(4, Math.round(capacityMW / 800)));
  const nPiles = Math.max(2, Math.min(5, Math.round(capacityMW / 600) + 1));
  const hallW = 18 + nUnits * 5;
  const boilerH = 13 + nUnits * 2;
  const padW = 70 + nUnits * 10 + nTowers * 6;

  root.add(makeTerrain(C.scrub));
  root.add(makeTrees(18, padW * 1.6, 210, 27));
  root.add(makePad(padW, 64));
  root.add(makeRoad(35));

  const hall = box(hallW, 9 + nUnits, 14, mat(C.hall), -10, null, 2);
  shells.push(hall);
  root.add(hall);
  const ridge = box(hallW + 0.6, 1, 6, C.concrete, -10, 9.4 + nUnits, 2);
  shells.push(ridge);
  root.add(ridge);
  root.add(box(hallW - 2, 1.2, 0.1, mat(C.glassGlow, { emissive: 0x6b5a28 }), -10, 6.4, 9.1));
  const boilerX = hallW / 2 - 4;
  const boiler = box(12 + nUnits * 2, boilerH, 12, mat(C.steelDark), boilerX, null, 0);
  shells.push(boiler);
  root.add(boiler);
  for (let i = 0; i < 4; i++)
    root.add(cyl(0.35, 0.35, boilerH - 1, mat(C.steel), boilerX + 6 + nUnits, null, -4 + i * 2.6, 8));

  const gens: THREE.Mesh[] = [];
  for (let i = 0; i < nUnits; i++) {
    const gen = new THREE.Mesh(new THREE.CylinderGeometry(1.6, 1.6, 5.5, 12), mech.statusMat);
    gen.rotation.z = Math.PI / 2;
    gen.position.set(i * 7 - 10 - (nUnits - 1) * 3.5, 3.6, 2);
    gens.push(gen);
    mech.group.add(gen);
  }

  const steam: THREE.Mesh[] = [];
  for (let i = 0; i < nTowers; i++) {
    const tx = i * 16 - padW / 2 + 12;
    const tower = new THREE.Mesh(
      new THREE.CylinderGeometry(5.4, 7.6, 19, 18, 1, true),
      mat(0xd6d9d2, { side: THREE.DoubleSide }),
    );
    tower.position.set(tx, 9.5, -14);
    shells.push(tower);
    root.add(tower);
    for (let p = 0; p < 5; p++) {
      const puff = new THREE.Mesh(
        new THREE.SphereGeometry(2.4 + p * 0.8, 8, 8),
        mat(0xeef1ec, { transparent: true, opacity: 0.3 }),
      );
      puff.position.set(tx, 19 + p * 3.4, -14);
      puff.userData.base = 19 + p * 3.4;
      puff.userData.phase = hash01(i * 7 + p) * 7;
      steam.push(puff);
      root.add(puff);
    }
  }
  const chimX = boilerX + 9 + nUnits;
  const chimney = cyl(1.1, 1.7, 28 + nUnits * 2, mat(0xd8d2c6), chimX, null, -8, 12);
  shells.push(chimney);
  root.add(chimney);
  root.add(cyl(1.18, 1.25, 2.2, mat(C.red), chimX, 25 + nUnits * 2, -8, 12));
  root.add(makeBeacon(chimX, 28.8 + nUnits * 2, -8, beacons));

  // Stockyard scaled to capacity.
  const pileMat = mat(0x1f2227);
  const piles: THREE.Mesh[] = [];
  for (let i = 0; i < nPiles; i++) {
    const r = 6.5 - i * 0.7;
    const ph = 5.2 - i * 0.5;
    const pile = new THREE.Mesh(new THREE.ConeGeometry(r, ph, 12), pileMat);
    pile.position.set(i * 11 - (nPiles - 1) * 5.5 - 6, ph / 2, 23);
    pile.userData.h = ph;
    piles.push(pile);
    coalstock.group.add(pile);
  }
  // Inclined conveyor: a single gallery from the first pile up to the boiler
  // top, with trestle legs that actually meet it.
  const cStart = new THREE.Vector3(-10, 2.5, 21);
  const cEnd = new THREE.Vector3(boilerX - 2, boilerH - 1, 1);
  const cDir = cEnd.clone().sub(cStart);
  const gallery = box(cDir.length() + 2, 1.5, 2.2, mat(C.steel));
  gallery.position.copy(cStart.clone().add(cEnd).multiplyScalar(0.5));
  gallery.lookAt(cEnd);
  gallery.rotateY(Math.PI / 2);
  coalstock.group.add(gallery);
  for (const f of [0.25, 0.5, 0.75]) {
    const px = cStart.clone().lerp(cEnd, f);
    coalstock.group.add(box(0.5, px.y, 0.5, C.steelDark, px.x, px.y / 2, px.z));
  }
  const lamp = statusLamp();
  coalstock.statusMat = lamp.mat;
  lamp.mesh.position.set(-12, 8.4, 23);
  coalstock.group.add(lamp.mesh);
  coalstock.group.add(cyl(0.1, 0.12, 8, mat(C.steelDark), -12, null, 23, 6));
  for (const dz of [-0.9, 0.9])
    coalstock.group.add(box(padW + 120, 0.12, 0.22, mat(0x55595e), -40, 0.2, 30 + dz));
  // Coal train: loco + hoppers. Parked off-site; rolls in during a delivery.
  const train = new THREE.Group();
  train.add(box(5, 2.6, 2.2, mat(0x3f6b9a), 0, null, 0));
  train.add(box(1.6, 0.9, 1.8, mat(0x2b3036), 1.4, 3, 0));
  const nWagons = Math.min(nPiles + 1, 6);
  for (let i = 0; i < nWagons; i++) {
    train.add(box(5.4, 1.7, 2.1, mat(0x5a3b2e), -(i + 1) * 6.2 - 0.5, 0.9, 0));
    train.add(box(4.6, 0.5, 1.7, mat(0x1f2227), -(i + 1) * 6.2 - 0.5, 2, 0));
  }
  train.position.set(-(padW / 2 + 50), 0, 30);
  const trainParkedX = -(padW / 2 + 50);
  const trainDockX = 6;
  coalstock.group.add(train);
  coalstock.group.add(makeUte(-24, 16, 0.9));
  // Lumps riding the conveyor while the plant runs.
  const lumps: THREE.Mesh[] = [];
  for (let i = 0; i < 6; i++) {
    const lump = new THREE.Mesh(new THREE.SphereGeometry(0.55, 7, 6), mat(0x16181c));
    lumps.push(lump);
    coalstock.group.add(lump);
  }

  const sub = makeSubstation();
  sub.position.set(-padW / 2 + 10, 0, 16);
  root.add(sub);
  root.add(
    makePowerline(new THREE.Vector3(-padW / 2 + 10, 0, 30), new THREE.Vector3(-0.2, 0, 1).normalize(), 5),
  );
  root.add(makeFloodlight(-padW / 2 + 4, -22), makeFloodlight(padW / 2 - 6, 18), makeFloodlight(-12, 27));

  root.add(coalstock.group, mech.group);
  return {
    root,
    components: [coalstock, mech],
    shells,
    crewStart: [-24, 0, 16],
    workSites: { coalstock: [-6, 0, 23], mech: [-10, 0, 10] },
    tick: (t, out, conditions, job) => {
      const stock = Math.max((conditions.coalstock ?? 100) / 100, 0.1);
      piles.forEach((pile, i) => {
        const s2 = Math.max(stock - i * 0.06, 0.08);
        pile.scale.set(s2, s2, s2);
        pile.position.y = (pile.userData.h / 2) * s2;
      });
      for (const puff of steam) {
        const rise = (t * (1.6 + out * 2.4) + puff.userData.phase) % 7;
        puff.position.y = puff.userData.base + rise;
        (puff.material as THREE.MeshLambertMaterial).opacity = Math.max(0.04, 0.34 * out * (1 - rise / 8));
      }
      for (const gen of gens) gen.rotation.x += (0.5 + out * 5) * 0.016;
      // Delivery in progress: the train rolls in for the first stretch of the
      // job, unloads, then rolls home once the crew is done.
      const delivering = job?.taskId === "coalstock" ? job.progress : null;
      const targetX =
        delivering != null ? trainParkedX + (trainDockX - trainParkedX) * Math.min(delivering * 2.8, 1) : trainParkedX;
      train.position.x += (targetX - train.position.x) * 0.04;
      const lumpDir = cEnd.clone().sub(cStart);
      lumps.forEach((lump, i) => {
        const f = (t * (0.05 + out * 0.12) + i / 6) % 1;
        lump.visible = out > 0.05;
        lump.position.copy(cStart).addScaledVector(lumpDir, f);
        lump.position.y += 1.1;
      });
      blinkBeacons(beacons, t);
    },
  };
}

// ---------------------------------------------------------------------------
// GAS

function buildGas(capacityMW: number): BuiltAsset {
  const root = new THREE.Group();
  const beacons: Beacon[] = [];
  const shells: THREE.Mesh[] = [];
  const mech = makeComponent("mech", "Gas turbines", true);
  const software = makeComponent("software", "Turbine control", false);

  root.add(makeTerrain(C.scrub));
  root.add(makeTrees(16, 110, 200, 41));
  root.add(makePad(64, 44));
  root.add(makeRoad(25));

  const hall = box(20, 8, 12, mat(C.hall), -6, null, 0);
  shells.push(hall);
  root.add(hall);
  root.add(box(18, 1.1, 0.1, mat(C.glassGlow, { emissive: 0x6b5a28 }), -6, 5.4, 6.1));

  const nUnits = Math.max(2, Math.min(4, Math.round(capacityMW / 250)));
  const turbs: THREE.Mesh[] = [];
  const flames: THREE.Mesh[] = [];
  for (let i = 0; i < nUnits; i++) {
    const x = i * 5 - 6 - (nUnits - 1) * 2.5 + 2.5;
    const turb = new THREE.Mesh(new THREE.CylinderGeometry(1.3, 1.3, 5.5, 12), mech.statusMat);
    turb.rotation.z = Math.PI / 2;
    turb.position.set(x, 3, 0);
    turbs.push(turb);
    mech.group.add(turb);
    const stack = cyl(0.9, 1.2, 16, mat(0xcfd3cb), x, null, -8, 10);
    shells.push(stack);
    root.add(stack);
    const glow = new THREE.Mesh(
      new THREE.SphereGeometry(1, 8, 8),
      mat(0xe2792e, { transparent: true, opacity: 0, emissive: 0xa14a10 }),
    );
    glow.position.set(x, 16.4, -8);
    flames.push(glow);
    root.add(glow);
  }
  root.add(makeBeacon(-3.5, 17.4, -8, beacons));

  for (let i = 0; i < 2; i++) {
    const sphere = new THREE.Mesh(new THREE.SphereGeometry(3.2, 14, 12), mat(0xe7e4da));
    sphere.position.set(16 + i * 8, 3.6, -8);
    root.add(sphere);
    for (let l = 0; l < 4; l++)
      root.add(
        cyl(
          0.12,
          0.12,
          3.4,
          mat(C.steelDark),
          16 + i * 8 + Math.cos(l * 1.57) * 2.2,
          null,
          -8 + Math.sin(l * 1.57) * 2.2,
          6,
        ),
      );
  }
  for (let i = 0; i < 3; i++) {
    const tank = cyl(1.1, 1.1, 7, mat(0xd9dcd2), 18, 1.4, 2 + i * 3, 10);
    tank.rotation.z = Math.PI / 2;
    root.add(tank);
  }
  for (let i = 0; i < 5; i++) root.add(box(22, 0.14, 0.14, C.steel, 4, 2.2 + i * 0.32, 9));
  for (let x = -6; x <= 14; x += 5) root.add(box(0.3, 2.2, 0.3, C.steelDark, x, null, 9));

  const flare = cyl(0.25, 0.4, 19, mat(C.steel), 28, null, 12, 8);
  root.add(flare);
  const flame = new THREE.Mesh(
    new THREE.ConeGeometry(0.8, 2.6, 8),
    mat(0xf2a23e, { emissive: 0xc05a10, transparent: true }),
  );
  flame.position.set(28, 20.2, 12);
  root.add(flame);

  software.group.add(box(6, 3, 4, mat(0x39424a), -20, null, 8));
  const lamp = statusLamp();
  software.statusMat = lamp.mat;
  lamp.mesh.position.set(-20, 3.8, 8);
  software.group.add(lamp.mesh);
  software.group.add(makeUte(-14, 14, 0.2));

  const sub = makeSubstation();
  sub.position.set(-24, 0, -8);
  root.add(sub);
  root.add(
    makePowerline(new THREE.Vector3(-24, 0, -22), new THREE.Vector3(-0.3, 0, -1).normalize(), 5),
  );
  root.add(makeFloodlight(-28, 16), makeFloodlight(26, -16));

  root.add(mech.group, software.group);
  return {
    root,
    components: [mech, software],
    shells,
    crewStart: [-14, 0, 14],
    workSites: { mech: [-6, 0, 7], software: [-20, 0, 11] },
    tick: (t, out) => {
      for (const turb of turbs) turb.rotation.x += (0.4 + out * 7) * 0.016;
      flames.forEach((glow, i) => {
        (glow.material as THREE.MeshLambertMaterial).opacity = out * (0.45 + 0.3 * Math.sin(t * 9 + i));
      });
      flame.scale.setScalar(0.7 + 0.4 * Math.abs(Math.sin(t * 7)) + out * 0.5);
      blinkBeacons(beacons, t);
    },
  };
}

// ---------------------------------------------------------------------------
// BATTERY

function buildBattery(capacityMW: number): BuiltAsset {
  const root = new THREE.Group();
  const cells = makeComponent("cells", "Battery racks", false);
  const software = makeComponent("software", "BMS control", false);

  root.add(makeTerrain(C.scrub));
  root.add(makeTrees(14, 100, 200, 53));

  const n = Math.max(8, Math.min(40, Math.round(capacityMW / 14)));
  const cols = Math.ceil(Math.sqrt(n * 2.4));
  const rows = Math.ceil(n / cols);
  const padW = cols * 6.4 + 14;
  const padD = rows * 5.2 + 16;
  root.add(makePad(padW, padD));
  root.add(makeRoad(padD / 2 + 6));

  const containerMat = mat(0xeceef0);
  const doorMat = mat(0xc6cdd3);
  const lampMats: THREE.MeshLambertMaterial[] = [];
  for (let i = 0; i < n; i++) {
    const x = (i % cols) * 6.4 - (cols * 6.4) / 2 + 3;
    const z = Math.floor(i / cols) * 5.2 - padD / 2 + 8;
    const unit = new THREE.Group();
    unit.add(box(5, 2.9, 2.2, containerMat));
    unit.add(box(0.1, 2.3, 1.7, doorMat, 2.56, 1.45, 0));
    unit.add(box(1, 0.7, 1.6, C.steelDark, -1.6, 3.05, 0));
    const lm = mat(0x9b6bd3, { emissive: 0x4a2a70, transparent: true });
    unit.add(box(4.6, 0.16, 0.1, lm, 0, 2.45, 1.16));
    lampMats.push(lm as THREE.MeshLambertMaterial);
    unit.position.set(x, 0, z);
    cells.group.add(unit);
  }
  cells.statusMat = lampMats[0];

  for (let i = 0; i < Math.max(2, Math.floor(rows / 2)); i++) {
    root.add(box(3.4, 2.2, 2.4, mat(0xc4c9bf), padW / 2 - 4, null, i * 8 - padD / 2 + 10));
  }
  software.group.add(box(6, 3, 4.4, mat(0x39424a), -padW / 2 + 6, null, padD / 2 - 6));
  software.group.add(
    box(5.2, 0.9, 0.05, mat(C.glassGlow, { emissive: 0x6b5a28 }), -padW / 2 + 6, 2, padD / 2 - 3.75),
  );
  const lamp = statusLamp();
  software.statusMat = lamp.mat;
  lamp.mesh.position.set(-padW / 2 + 6, 3.8, padD / 2 - 6);
  software.group.add(lamp.mesh);
  software.group.add(makeUte(2, padD / 2 - 4, 0.8));

  const sub = makeSubstation();
  sub.position.set(padW / 2 + 8, 0, 0);
  root.add(sub);
  root.add(
    makePowerline(new THREE.Vector3(padW / 2 + 8, 0, 14), new THREE.Vector3(0.4, 0, 1).normalize(), 5),
  );
  root.add(makeFloodlight(-padW / 2 - 3, -padD / 2 - 3), makeFloodlight(padW / 2 + 3, padD / 2 + 3));

  root.add(cells.group, software.group);
  return {
    root,
    components: [cells, software],
    shells: [],
    crewStart: [2, 0, padD / 2 - 4],
    workSites: { cells: [0, 0, 0], software: [-padW / 2 + 6, 0, padD / 2 - 9] },
    tick: (t, out) => {
      lampMats.forEach((lm, i) => {
        lm.opacity = 0.3 + 0.7 * Math.abs(Math.sin(t * (1 + out * 3) + i * 0.45));
      });
    },
  };
}

// ---------------------------------------------------------------------------
// GENERIC (bioenergy / distillate)

function buildGeneric(): BuiltAsset {
  const root = new THREE.Group();
  const beacons: Beacon[] = [];
  const mech = makeComponent("mech", "Plant equipment", true);
  root.add(makeTerrain(C.scrub));
  root.add(makeTrees(16, 100, 200, 71));
  root.add(makePad(42, 32));
  root.add(makeRoad(18));
  const shed = box(16, 7, 10, mat(C.hall));
  const shells = [shed];
  root.add(shed);
  root.add(box(14, 1, 0.1, mat(C.glassGlow, { emissive: 0x6b5a28 }), 0, 4.6, 5.1));
  const gen = new THREE.Mesh(new THREE.CylinderGeometry(1.5, 1.5, 4.5, 12), mech.statusMat);
  gen.rotation.z = Math.PI / 2;
  gen.position.y = 3.2;
  mech.group.add(gen);
  const stack = cyl(0.8, 1.1, 15, mat(0xd8d2c6), 10, null, -4, 8);
  shells.push(stack);
  root.add(stack);
  root.add(makeBeacon(10, 15.8, -4, beacons));
  for (let i = 0; i < 2; i++) root.add(cyl(2.2, 2.2, 5, mat(0xd9dcd2), -13, null, -4 + i * 6, 14));
  const sub = makeSubstation();
  sub.position.set(14, 0, 8);
  root.add(sub);
  root.add(makePowerline(new THREE.Vector3(14, 0, 22), new THREE.Vector3(0.3, 0, 1).normalize(), 4));
  root.add(makeFloodlight(-16, 12), makeFloodlight(16, -12));
  root.add(mech.group);
  return {
    root,
    components: [mech],
    shells,
    crewStart: [8, 0, 14],
    workSites: { mech: [0, 0, 7] },
    tick: (t, out) => {
      gen.rotation.x += (0.3 + out * 5) * 0.016;
      blinkBeacons(beacons, t);
    },
  };
}

export function buildAssetScene(fuel: FuelGroup, capacityMW: number, name: string): BuiltAsset {
  switch (fuel) {
    case "wind":
      return buildWind(capacityMW, /offshore/i.test(name));
    case "solar":
      return buildSolar(capacityMW);
    case "hydro":
      return buildHydro(capacityMW);
    case "coal":
      return buildCoal(capacityMW);
    case "gas":
      return buildGas(capacityMW);
    case "battery":
      return buildBattery(capacityMW);
    default:
      return buildGeneric();
  }
}
