import * as THREE from "three";
import type { FuelGroup } from "./types";

// Procedural low-poly "SimCity" scenes for each asset type. Nothing here is
// a real site layout — it's a gamified stand-in: turbine count scales with
// capacity, the dam drains as it generates, the coal pile shrinks until a
// delivery lands. Components map 1:1 to the OPS maintenance tasks so the
// X-ray view doubles as a health inspector.

export interface SceneComponent {
  taskId: string;
  label: string;
  group: THREE.Group;
  /** Hidden behind the building shell until X-ray is enabled. */
  interior: boolean;
  /** Material tinted by condition (green → red). */
  statusMat: THREE.MeshLambertMaterial;
}

export interface BuiltAsset {
  root: THREE.Group;
  components: SceneComponent[];
  /** Exterior meshes faded out in X-ray mode. */
  shells: THREE.Mesh[];
  /** Per-frame animation. */
  tick: (tSec: number, outputFactor: number, conditions: Record<string, number>) => void;
}

const mat = (color: number | string, opts: Partial<THREE.MeshLambertMaterialParameters> = {}) =>
  new THREE.MeshLambertMaterial({ color, ...opts });

function box(w: number, h: number, d: number, m: THREE.Material): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
  mesh.position.y = h / 2;
  return mesh;
}

function cyl(rTop: number, rBot: number, h: number, m: THREE.Material, seg = 12): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(rTop, rBot, h, seg), m);
  mesh.position.y = h / 2;
  return mesh;
}

export function condColorHex(v: number): number {
  if (v >= 70) return 0x48a87c;
  if (v >= 40) return 0xf2c14e;
  return 0xe2483d;
}

function statusLamp(): { mesh: THREE.Mesh; mat: THREE.MeshLambertMaterial } {
  const m = mat(0x48a87c, { emissive: 0x1c4a38 });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(0.55, 8, 8), m);
  return { mesh, mat: m };
}

function makeComponent(taskId: string, label: string, interior: boolean): SceneComponent {
  const lamp = statusLamp();
  const group = new THREE.Group();
  group.userData.taskId = taskId;
  return { taskId, label, group, interior, statusMat: lamp.mat };
}

// ---------------------------------------------------------------------------

function buildWind(capacityMW: number, offshore: boolean): BuiltAsset {
  const root = new THREE.Group();
  const shells: THREE.Mesh[] = [];
  const towerH = offshore ? 26 : 17;
  const bladeL = offshore ? 11 : 7.5;
  const count = Math.max(4, Math.min(30, Math.round(capacityMW / 18)));

  const gearbox = makeComponent("gearbox", "Turbine nacelles & gearboxes", false);
  const software = makeComponent("software", "Control room & SCADA", false);

  const towerMat = mat(0xd8dde2);
  const nacelleMat = mat(0xb9c2c9);
  const bladeMat = mat(0xeef2f4);
  const rotors: THREE.Group[] = [];

  const cols = Math.ceil(Math.sqrt(count * 1.6));
  for (let i = 0; i < count; i++) {
    const turbine = new THREE.Group();
    const tower = cyl(0.35, 0.55, towerH, towerMat, 8);
    turbine.add(tower);
    const nacelle = box(2.2, 1.1, 1.1, nacelleMat);
    nacelle.position.set(0.3, towerH, 0);
    turbine.add(nacelle);
    const rotor = new THREE.Group();
    for (let b = 0; b < 3; b++) {
      const blade = new THREE.Mesh(new THREE.BoxGeometry(0.18, bladeL, 0.55), bladeMat);
      blade.position.y = bladeL / 2;
      const arm = new THREE.Group();
      arm.add(blade);
      arm.rotation.z = (b * 2 * Math.PI) / 3;
      rotor.add(arm);
    }
    rotor.position.set(1.55, towerH, 0);
    turbine.add(rotor);
    rotors.push(rotor);
    const x = (i % cols) * 14 - (cols * 14) / 2;
    const z = Math.floor(i / cols) * 16 - 18;
    turbine.position.set(x + (i % 2) * 4, 0, z);
    turbine.rotation.y = -0.3;
    gearbox.group.add(turbine);
  }

  // Control building with the SCADA lamp.
  const ctl = box(6, 3, 4.5, mat(0x2d3137));
  ctl.position.set(0, 0, 18);
  ctl.position.y = 1.5;
  software.group.add(ctl);
  const lamp = statusLamp();
  software.statusMat = lamp.mat;
  lamp.mesh.position.set(0, 4, 18);
  software.group.add(lamp.mesh);

  root.add(gearbox.group, software.group);

  return {
    root,
    components: [gearbox, software],
    shells,
    tick: (t, out) => {
      const speed = 0.4 + out * 5;
      for (const rotor of rotors) rotor.rotation.x += speed * 0.016;
    },
  };
}

function buildSolar(capacityMW: number): BuiltAsset {
  const root = new THREE.Group();
  const shells: THREE.Mesh[] = [];
  const soiling = makeComponent("soiling", "Panel arrays", false);
  const software = makeComponent("software", "Inverter stations", false);

  const rows = Math.max(6, Math.min(16, Math.round(Math.sqrt(capacityMW))));
  const cols = Math.max(10, Math.min(26, Math.round(capacityMW / rows / 2)));
  const panelMat = mat(0x1d3a5f);
  soiling.statusMat = panelMat as THREE.MeshLambertMaterial;

  const panel = new THREE.BoxGeometry(4.0, 0.2, 2.6);
  const inst = new THREE.InstancedMesh(panel, panelMat, rows * cols);
  const dummy = new THREE.Object3D();
  let n = 0;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      dummy.position.set(c * 4.4 - (cols * 4.4) / 2, 1.1, r * 4.2 - (rows * 4.2) / 2);
      dummy.rotation.set(-0.35, 0, 0);
      dummy.updateMatrix();
      inst.setMatrixAt(n++, dummy.matrix);
    }
  }
  soiling.group.add(inst);

  // Inverter cabins between every few rows.
  const invMat = mat(0xb8bdb2);
  for (let r = 0; r < Math.max(2, Math.floor(rows / 3)); r++) {
    const cabin = box(2.4, 1.8, 1.6, invMat);
    cabin.position.set((cols * 4.4) / 2 + 4, 0.9, r * 12 - (rows * 4.2) / 2 + 4);
    software.group.add(cabin);
    const lamp = statusLamp();
    if (r === 0) software.statusMat = lamp.mat;
    lamp.mesh.scale.setScalar(0.7);
    lamp.mesh.position.set((cols * 4.4) / 2 + 4, 2.5, r * 12 - (rows * 4.2) / 2 + 4);
    software.group.add(lamp.mesh);
  }

  root.add(soiling.group, software.group);
  return {
    root,
    components: [soiling, software],
    shells,
    tick: (t, out, conditions) => {
      // Dusty panels visibly brown as soiling condition drops.
      const cond = (conditions.soiling ?? 100) / 100;
      panelMat.color.setRGB(
        0.1 + (1 - cond) * 0.4,
        0.16 + (1 - cond) * 0.2,
        0.42 + cond * 0.2,
      );
    },
  };
}

function buildHydro(capacityMW: number): BuiltAsset {
  const root = new THREE.Group();
  const shells: THREE.Mesh[] = [];
  const mech = makeComponent("mech", "Turbine hall", true);

  // Dam wall across a valley.
  const wall = new THREE.Mesh(new THREE.CylinderGeometry(26, 26, 14, 24, 1, true, -0.6, 1.2), mat(0xcfd4cd, { side: THREE.DoubleSide }));
  wall.position.set(0, 7, -6);
  shells.push(wall);
  root.add(wall);

  // Reservoir behind the dam — level animates with generation.
  const water = new THREE.Mesh(new THREE.BoxGeometry(56, 8, 38), mat(0x2c6f8c, { transparent: true, opacity: 0.85 }));
  water.position.set(0, 4, -30);
  root.add(water);

  // Outflow + spray at the base when generating.
  const outflow = new THREE.Mesh(new THREE.BoxGeometry(12, 1.2, 16), mat(0x7fb6c9, { transparent: true, opacity: 0.0 }));
  outflow.position.set(0, 0.6, 12);
  root.add(outflow);

  // Powerhouse with turbines inside (X-ray reveals them).
  const house = box(18, 6, 9, mat(0x9aa3a8));
  house.position.set(0, 3, 8);
  shells.push(house);
  root.add(house);
  const turbines: THREE.Mesh[] = [];
  const nTurb = Math.max(2, Math.min(6, Math.round(capacityMW / 350)));
  for (let i = 0; i < nTurb; i++) {
    const turb = new THREE.Mesh(new THREE.TorusGeometry(1.3, 0.45, 8, 14), mech.statusMat);
    turb.position.set(i * 3.2 - (nTurb - 1) * 1.6, 3, 8);
    turb.rotation.y = Math.PI / 2;
    turbines.push(turb);
    mech.group.add(turb);
  }
  // Penstocks from dam to powerhouse.
  for (let i = 0; i < nTurb; i++) {
    const pen = cyl(0.5, 0.5, 12, mat(0x6e7535), 8);
    pen.rotation.x = Math.PI / 2.6;
    pen.position.set(i * 3.2 - (nTurb - 1) * 1.6, 5, 0);
    root.add(pen);
  }

  root.add(mech.group);
  return {
    root,
    components: [mech],
    shells,
    tick: (t, out) => {
      // Slow drain while generating, refill when idle (pumping overnight).
      const level = 5.4 + Math.sin(t / 38) * 1.6 - out * 1.8;
      water.position.y = Math.max(level, 1.4);
      (outflow.material as THREE.MeshLambertMaterial).opacity = Math.min(out * 1.4, 0.8);
      outflow.position.z = 12 + Math.sin(t * 5) * 0.15;
      for (const turb of turbines) turb.rotation.z += (0.5 + out * 6) * 0.016;
    },
  };
}

function buildCoal(capacityMW: number): BuiltAsset {
  const root = new THREE.Group();
  const shells: THREE.Mesh[] = [];
  const coalstock = makeComponent("coalstock", "Coal stockpile & conveyor", false);
  const mech = makeComponent("mech", "Boiler & turbine hall", true);

  // Boiler house + turbine hall.
  const hall = box(22, 10, 12, mat(0x8d9499));
  shells.push(hall);
  root.add(hall);
  const nUnits = Math.max(2, Math.min(4, Math.round(capacityMW / 700)));
  const gens: THREE.Mesh[] = [];
  for (let i = 0; i < nUnits; i++) {
    const gen = new THREE.Mesh(new THREE.CylinderGeometry(1.4, 1.4, 4.5, 10), mech.statusMat);
    gen.rotation.z = Math.PI / 2;
    gen.position.set(i * 5 - (nUnits - 1) * 2.5, 3.4, 0);
    gens.push(gen);
    mech.group.add(gen);
  }

  // Cooling towers with rising steam.
  const steam: THREE.Mesh[] = [];
  for (let i = 0; i < 2; i++) {
    const tower = new THREE.Mesh(new THREE.CylinderGeometry(4.2, 5.6, 16, 14, 1, true), mat(0xc9ccc4, { side: THREE.DoubleSide }));
    tower.position.set(i * 14 - 25, 8, -4);
    shells.push(tower);
    root.add(tower);
    for (let s = 0; s < 4; s++) {
      const puff = new THREE.Mesh(new THREE.SphereGeometry(2 + s * 0.6, 8, 8), mat(0xe8ebe6, { transparent: true, opacity: 0.3 }));
      puff.position.set(i * 14 - 25, 16 + s * 3, -4);
      puff.userData.base = 16 + s * 3;
      steam.push(puff);
      root.add(puff);
    }
  }
  const chimney = cyl(0.9, 1.3, 24, mat(0xd8d2c6), 10);
  chimney.position.set(14, 12, -6);
  shells.push(chimney);
  root.add(chimney);

  // Coal stockpile whose size IS the coal stock condition, plus conveyor.
  const pile = new THREE.Mesh(new THREE.ConeGeometry(7, 5, 12), mat(0x23262b));
  pile.position.set(0, 2.5, 16);
  coalstock.group.add(pile);
  const conveyor = box(16, 0.6, 1.6, mat(0x4a4a52));
  conveyor.rotation.z = 0.22;
  conveyor.position.set(-6, 3.4, 14);
  coalstock.group.add(conveyor);
  const lamp = statusLamp();
  coalstock.statusMat = lamp.mat;
  lamp.mesh.position.set(0, 7.5, 16);
  coalstock.group.add(lamp.mesh);

  root.add(coalstock.group, mech.group);
  return {
    root,
    components: [coalstock, mech],
    shells,
    tick: (t, out, conditions) => {
      const stock = Math.max((conditions.coalstock ?? 100) / 100, 0.12);
      pile.scale.set(stock, stock, stock);
      pile.position.y = 2.5 * stock;
      for (const puff of steam) {
        puff.position.y = puff.userData.base + ((t * (1.5 + out * 2)) % 6);
        (puff.material as THREE.MeshLambertMaterial).opacity = Math.max(0.05, 0.32 * out * (1 - (puff.position.y - puff.userData.base) / 7));
      }
      for (const gen of gens) gen.rotation.x += (0.5 + out * 5) * 0.016;
    },
  };
}

function buildGas(capacityMW: number): BuiltAsset {
  const root = new THREE.Group();
  const shells: THREE.Mesh[] = [];
  const mech = makeComponent("mech", "Gas turbines", true);
  const software = makeComponent("software", "Turbine control", false);

  const hall = box(16, 7, 10, mat(0x9aa3a8));
  shells.push(hall);
  root.add(hall);
  const nUnits = Math.max(1, Math.min(4, Math.round(capacityMW / 250)));
  const turbs: THREE.Mesh[] = [];
  for (let i = 0; i < nUnits; i++) {
    const turb = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 1.1, 5, 10), mech.statusMat);
    turb.rotation.z = Math.PI / 2;
    turb.position.set(i * 4 - (nUnits - 1) * 2, 2.6, 0);
    turbs.push(turb);
    mech.group.add(turb);
  }
  const flame: THREE.Mesh[] = [];
  for (let i = 0; i < nUnits; i++) {
    const stack = cyl(0.7, 0.9, 14, mat(0xc9ccc4), 8);
    stack.position.set(i * 4 - (nUnits - 1) * 2, 7, -6);
    shells.push(stack);
    root.add(stack);
    const glow = new THREE.Mesh(new THREE.SphereGeometry(0.9, 8, 8), mat(0xe2792e, { transparent: true, opacity: 0.0, emissive: 0xa14a10 }));
    glow.position.set(i * 4 - (nUnits - 1) * 2, 14.4, -6);
    flame.push(glow);
    root.add(glow);
  }
  const ctl = box(5, 2.6, 3.5, mat(0x2d3137));
  ctl.position.set(12, 1.3, 4);
  software.group.add(ctl);
  const lamp = statusLamp();
  software.statusMat = lamp.mat;
  lamp.mesh.position.set(12, 3.6, 4);
  software.group.add(lamp.mesh);

  root.add(mech.group, software.group);
  return {
    root,
    components: [mech, software],
    shells,
    tick: (t, out) => {
      for (const turb of turbs) turb.rotation.x += (0.3 + out * 7) * 0.016;
      for (const glow of flame) {
        (glow.material as THREE.MeshLambertMaterial).opacity = out * (0.5 + 0.3 * Math.sin(t * 9));
      }
    },
  };
}

function buildBattery(capacityMW: number): BuiltAsset {
  const root = new THREE.Group();
  const shells: THREE.Mesh[] = [];
  const cells = makeComponent("cells", "Battery racks", false);
  const software = makeComponent("software", "BMS control", false);

  const n = Math.max(6, Math.min(36, Math.round(capacityMW / 12)));
  const cols = Math.ceil(Math.sqrt(n * 2));
  const rackMat = mat(0xe8e8ec);
  const lampMats: THREE.MeshLambertMaterial[] = [];
  for (let i = 0; i < n; i++) {
    const rack = box(4.2, 2.6, 1.6, rackMat);
    const x = (i % cols) * 5.4 - (cols * 5.4) / 2;
    const z = Math.floor(i / cols) * 4 - 6;
    rack.position.set(x, 1.3, z);
    cells.group.add(rack);
    const lm = mat(0x9b6bd3, { emissive: 0x4a2a70, transparent: true });
    const light = new THREE.Mesh(new THREE.BoxGeometry(3.8, 0.18, 0.18), lm);
    light.position.set(x, 2.2, z + 0.85);
    lampMats.push(lm as THREE.MeshLambertMaterial);
    cells.group.add(light);
  }
  cells.statusMat = lampMats[0];

  const ctl = box(5, 2.8, 4, mat(0x2d3137));
  ctl.position.set((cols * 5.4) / 2 + 5, 1.4, 0);
  software.group.add(ctl);
  const lamp = statusLamp();
  software.statusMat = lamp.mat;
  lamp.mesh.position.set((cols * 5.4) / 2 + 5, 3.6, 0);
  software.group.add(lamp.mesh);

  root.add(cells.group, software.group);
  return {
    root,
    components: [cells, software],
    shells,
    tick: (t, out) => {
      // Charge lights ripple; speed follows dispatch.
      lampMats.forEach((lm, i) => {
        lm.opacity = 0.35 + 0.65 * Math.abs(Math.sin(t * (1 + out * 3) + i * 0.6));
      });
    },
  };
}

function buildGeneric(): BuiltAsset {
  const root = new THREE.Group();
  const mech = makeComponent("mech", "Plant equipment", true);
  const shed = box(14, 6, 9, mat(0x9aa3a8));
  const shells = [shed];
  root.add(shed);
  const gen = new THREE.Mesh(new THREE.CylinderGeometry(1.3, 1.3, 4, 10), mech.statusMat);
  gen.rotation.z = Math.PI / 2;
  gen.position.y = 3;
  mech.group.add(gen);
  const stack = cyl(0.8, 1, 13, mat(0xd8d2c6), 8);
  stack.position.set(8, 6.5, -3);
  shells.push(stack);
  root.add(stack, mech.group);
  return {
    root,
    components: [mech],
    shells,
    tick: (t, out) => {
      gen.rotation.x += (0.3 + out * 5) * 0.016;
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
