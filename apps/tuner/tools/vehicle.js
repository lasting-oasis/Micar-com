// Procedural, original 4-door off-road SUV built from primitives.
// Coordinate system: +X = forward (nose), +Y = up, +Z = right side (driver side is -Z). Units: meters.
// Every part is registered with: category, variant, group (core | wheels | ground | peripheral), layers it exports,
// and an occluder policy. See REBUILD.md "Sprite pipeline" for how these drive the renderer.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

// ---------- dimensions ----------
export const DIM = {
  wheelbase: 3.2, frontAxleX: 1.45, rearAxleX: -1.75, track: 1.62,
  bodyFront: 2.25, bodyRear: -2.45, halfWidth: 0.925,
  sillBottom: 0.55, sillTop: 0.72, belt: 1.12, roofBottom: 1.80, roofTop: 1.92,
  archR: 0.51, archCY: 0.43,
  tireR: { at: 0.43, mt: 0.465 }, tireW: { at: 0.27, mt: 0.30 }, rimR: 0.245,
  frontDoor: [0.55, -0.35], rearDoor: [-0.35, -1.19],
};

// ---------- materials ----------
export function makeMaterials() {
  const M = {
    paint: new THREE.MeshPhysicalMaterial({ color: 0xffffff, roughness: 0.35, metalness: 0.0, clearcoat: 1, clearcoatRoughness: 0.08 }),
    plastic: new THREE.MeshStandardMaterial({ color: 0x1b1c1d, roughness: 0.8, metalness: 0.05 }),
    plasticLight: new THREE.MeshStandardMaterial({ color: 0x2a2c2e, roughness: 0.7, metalness: 0.05 }),
    steel: new THREE.MeshStandardMaterial({ color: 0x33363a, roughness: 0.5, metalness: 0.55 }),
    steelDark: new THREE.MeshStandardMaterial({ color: 0x202224, roughness: 0.6, metalness: 0.5 }),
    chrome: new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.1, metalness: 1.0 }),
    alu: new THREE.MeshStandardMaterial({ color: 0xc9ccd1, roughness: 0.3, metalness: 0.9 }),
    rubber: new THREE.MeshStandardMaterial({ color: 0x141415, roughness: 0.95, metalness: 0.0 }),
    rubberLug: new THREE.MeshStandardMaterial({ color: 0x1b1b1c, roughness: 0.9, metalness: 0.0 }),
    glass: new THREE.MeshPhysicalMaterial({ color: 0x8fa9bd, transparent: true, opacity: 0.38, roughness: 0.04, metalness: 0.0, clearcoat: 1, side: THREE.DoubleSide }),
    lens: new THREE.MeshStandardMaterial({ color: 0xf2f2ee, roughness: 0.25, metalness: 0.1 }),
    lensRed: new THREE.MeshStandardMaterial({ color: 0xb01414, roughness: 0.3, metalness: 0.1 }),
    lensAmber: new THREE.MeshStandardMaterial({ color: 0xd98a1a, roughness: 0.3, metalness: 0.1 }),
    interiorDark: new THREE.MeshStandardMaterial({ color: 0x232426, roughness: 0.85 }),
    seat: new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.7, metalness: 0.0 }), // paintable (interior zone)
    rim: new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.25, metalness: 0.85 }), // paintable (rims)
    brake: new THREE.MeshStandardMaterial({ color: 0xd8dadd, roughness: 0.35, metalness: 0.9 }),
    caliper: new THREE.MeshStandardMaterial({ color: 0xc8201c, roughness: 0.5, metalness: 0.2 }),
    fabric: new THREE.MeshStandardMaterial({ color: 0x1d1e20, roughness: 1.0, metalness: 0 }),
    glow: new THREE.MeshBasicMaterial({ color: 0xffffff }),
    shadow: null,
  };
  return M;
}

// ---------- helpers ----------
const box = (w, h, d, r = 0.02, seg = 3) => new RoundedBoxGeometry(w, h, d, seg, Math.min(r, w / 2, h / 2, d / 2));
const cyl = (rt, rb, h, seg = 32) => new THREE.CylinderGeometry(rt, rb, h, seg);
function mesh(geo, mat, x = 0, y = 0, z = 0, rot = null) {
  const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z);
  if (rot) m.rotation.set(rot[0] || 0, rot[1] || 0, rot[2] || 0);
  return m;
}
function tube(points, r, closed = false, seg = 8) {
  const curve = new THREE.CatmullRomCurve3(points.map(p => new THREE.Vector3(...p)), closed, 'catmullrom', 0.0);
  return new THREE.Mesh(new THREE.TubeGeometry(curve, Math.max(8, points.length * 8), r, seg, closed), null);
}
function segTube(a, b, r, mat, seg = 10) {
  const va = new THREE.Vector3(...a), vb = new THREE.Vector3(...b);
  const len = va.distanceTo(vb); const g = new THREE.CylinderGeometry(r, r, len, seg);
  const m = new THREE.Mesh(g, mat); m.position.copy(va).add(vb).multiplyScalar(0.5);
  m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), vb.clone().sub(va).normalize());
  return m;
}
// Extruded 2D shape in the XY plane, thickness along Z, centered on z
function extrudeXY(shape, depth, z = 0, bevel = 0.01) {
  const g = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 2, curveSegments: 24 });
  g.translate(0, 0, z - depth / 2); return g;
}
// Annular sector (fender flare profile) from angle a0 to a1 (radians), inner r0, outer r1
function arcBand(r0, r1, a0, a1, cx = 0, cy = 0) {
  const s = new THREE.Shape();
  s.absarc(cx, cy, r1, a0, a1, false); s.absarc(cx, cy, r0, a1, a0, true); s.closePath(); return s;
}

// ---------- part registry ----------
export class Vehicle {
  constructor() {
    this.group = new THREE.Group();
    this.M = makeMaterials();
    this.parts = []; // {id, category, variant, group, layers, occlude, meshes[], zBias}
    this.build();
  }
  add(def, meshes) {
    if (def.split && meshes.length) {
      // Split side-symmetric parts into left (-Z) / right (+Z) halves so the compositor can order them against the body.
      const left = meshes.filter(m => m.position.z < 0), right = meshes.filter(m => m.position.z >= 0);
      const base = { ...def, split: false, configKey: def.category };
      const l = this.add({ ...base, category: def.category + '_l', name: def.name, side: 'l' }, left);
      const r = this.add({ ...base, category: def.category + '_r', name: def.name, side: 'r' }, right);
      return [l, r];
    }
    const g = new THREE.Group(); meshes.forEach(m => g.add(m)); this.group.add(g);
    const part = { id: `${def.category}/${def.variant}`, zBias: 0, layers: ['lit'], occlude: 'core', group: 'peripheral', ...def, node: g, meshes };
    part.configKey = part.configKey || part.category;
    this.parts.push(part); return part;
  }
  build() {
    const D = DIM, M = this.M;
    this.buildCore(); this.buildGlass(); this.buildHoods(); this.buildDoors(); this.buildRoofs();
    this.buildBumpers(); this.buildFlares(); this.buildWheels(); this.buildLights(); this.buildGrilles();
    this.buildMirrors(); this.buildSteps(); this.buildRacks(); this.buildMisc(); this.buildShadow(); this.buildNeon();
  }

  // ----- core body (always present) -----
  buildCore() {
    const D = DIM, M = this.M, m = [];
    const hw = D.halfWidth;
    // sill segments (between/around the arches)
    const frontArchX0 = D.frontAxleX - D.archR, frontArchX1 = D.frontAxleX + D.archR;
    const rearArchX0 = D.rearAxleX - D.archR, rearArchX1 = D.rearAxleX + D.archR;
    const sillH = D.sillTop - D.sillBottom, sillY = (D.sillTop + D.sillBottom) / 2;
    m.push(mesh(box(frontArchX0 - rearArchX1, sillH, hw * 2, 0.03), M.paint, (frontArchX0 + rearArchX1) / 2, sillY, 0));
    m.push(mesh(box(D.bodyFront - frontArchX1, sillH, hw * 2, 0.03), M.paint, (D.bodyFront + frontArchX1) / 2, sillY, 0));
    m.push(mesh(box(rearArchX0 - D.bodyRear, sillH, hw * 2, 0.03), M.paint, (rearArchX0 + D.bodyRear) / 2, sillY, 0));
    // front wings (above the front arch, under the hood line) and the engine bay cover
    const wingY0 = D.archCY + D.archR - 0.02, wingH = D.belt - wingY0;
    const wingLen = D.bodyFront - 0.62;
    m.push(mesh(box(wingLen, wingH, hw * 2, 0.03), M.paint, D.bodyFront - wingLen / 2, wingY0 + wingH / 2, 0));
    // body-colored band in front of the front doors (A-pillar base to the wing): x 0.55..0.62 is covered by the wing block above
    // rear quarters: upper band over the rear arch + closing panel behind the arch
    const qx0 = D.bodyRear, qx1 = D.rearDoor[1];
    m.push(mesh(box(qx1 - qx0, D.belt - wingY0, hw * 2, 0.03), M.paint, (qx0 + qx1) / 2, (D.belt + wingY0) / 2, 0));
    m.push(mesh(box(rearArchX0 - D.bodyRear, wingY0 - D.sillTop + 0.01, hw * 2, 0.02), M.paint, (rearArchX0 + D.bodyRear) / 2, (wingY0 + D.sillTop) / 2, 0));
    // rear quarter panel between belt and roof (the C-pillar area), tailgate, and the upper body around the cabin
    m.push(mesh(box(0.07, D.belt - D.sillTop, hw * 2 - 0.1, 0.02), M.paint, D.bodyRear + 0.035, (D.belt + D.sillTop) / 2, 0)); // tailgate (lower)
    // cowl side panels between the front doors and the front arch
    m.push(mesh(box(0.36, wingY0 - D.sillTop + 0.01, hw * 2, 0.02), M.paint, 0.72, (wingY0 + D.sillTop) / 2, 0));
    // front face: grille surround + header
    m.push(mesh(box(0.16, D.belt - D.sillTop, hw * 2 - 0.08, 0.03), M.paint, D.bodyFront - 0.08, (D.belt + D.sillTop) / 2, 0));
    // cowl (between hood and windshield), windshield frame: A-pillars + header + base
    m.push(mesh(box(0.22, 0.05, hw * 2 - 0.05, 0.01), M.paint, 0.72, D.belt + 0.025, 0));
    const wsBase = [0.76, D.belt + 0.03], wsTop = [0.52, D.roofBottom];
    const wsLen = Math.hypot(wsTop[0] - wsBase[0], wsTop[1] - wsBase[1]);
    const wsAng = Math.atan2(wsTop[0] - wsBase[0], wsTop[1] - wsBase[1]); // tilt back
    for (const s of [-1, 1]) m.push(mesh(box(0.07, wsLen, 0.07, 0.01), M.paint, (wsBase[0] + wsTop[0]) / 2, (wsBase[1] + wsTop[1]) / 2, s * (hw - 0.06), [0, 0, wsAng]));
    m.push(mesh(box(0.08, 0.07, hw * 2 - 0.05, 0.01), M.paint, wsTop[0] - 0.01, D.roofBottom - 0.02, 0)); // header
    m.push(mesh(box(0.06, 0.06, hw * 2 - 0.05, 0.01), M.paint, wsBase[0], wsBase[1], 0)); // base
    // engine bay cover (under the hood) so hood variants never reveal a hole
    m.push(mesh(box(1.45, 0.04, 1.55, 0.005), M.plastic, D.bodyFront - 0.85, D.belt - 0.03, 0));
    // floor and inner door jambs
    m.push(mesh(box(D.bodyFront - D.bodyRear - 0.2, 0.06, hw * 2 - 0.1), M.interiorDark, (D.bodyFront + D.bodyRear) / 2, D.sillBottom + 0.05, 0));
    for (const s of [-1, 1]) m.push(mesh(box(D.frontDoor[0] - D.rearDoor[1], 0.08, 0.06), M.interiorDark, (D.frontDoor[0] + D.rearDoor[1]) / 2, D.sillTop + 0.03, s * (hw - 0.05)));
    // wheel-well liners (dark) + chassis rails
    for (const [ax, len] of [[D.frontAxleX, D.archR * 2], [D.rearAxleX, D.archR * 2]]) {
      m.push(mesh(box(len - 0.05, D.archR + 0.25, hw * 2 - 0.3, 0.01), M.plastic, ax, D.archCY + 0.22, 0));
    }
    m.push(mesh(box(D.bodyFront - D.bodyRear - 0.5, 0.12, 0.12), M.steelDark, (D.bodyFront + D.bodyRear) / 2, D.sillBottom - 0.05, 0.45));
    m.push(mesh(box(D.bodyFront - D.bodyRear - 0.5, 0.12, 0.12), M.steelDark, (D.bodyFront + D.bodyRear) / 2, D.sillBottom - 0.05, -0.45));
    m.push(mesh(box(0.5, 0.25, 1.3, 0.03), M.steelDark, D.frontAxleX, D.archCY, 0)); // axle housings
    m.push(mesh(box(0.5, 0.25, 1.3, 0.03), M.steelDark, D.rearAxleX, D.archCY, 0));
    // body-colour "B" core — paintable layers
    const paintMeshes = m.filter(x => x.material === M.paint);
    const otherMeshes = m.filter(x => x.material !== M.paint);
    this.add({ category: 'body', variant: 'stock', name: 'Body', group: 'core', layers: ['diffuse', 'spec'], paintable: true, zone: 'exterior', occlude: 'core' }, paintMeshes);
    this.add({ category: 'chassis', variant: 'stock', name: 'Chassis & liners', group: 'core', layers: ['lit'], occlude: 'core', hidden: true }, otherMeshes);

    // sport bar (roll cage) + B-pillars — always present, visible with soft/no top and through glass
    const bar = [];
    const bx = D.rearDoor[0] + 0.05, by = D.roofBottom - 0.08;
    bar.push(segTube([bx, D.sillTop + 0.05, hw - 0.14], [bx, by, hw - 0.14], 0.035, M.plastic));
    bar.push(segTube([bx, D.sillTop + 0.05, -hw + 0.14], [bx, by, -hw + 0.14], 0.035, M.plastic));
    bar.push(segTube([bx, by, hw - 0.14], [bx, by, -hw + 0.14], 0.035, M.plastic));
    bar.push(segTube([bx, by, hw - 0.14], [D.bodyRear + 0.25, by, hw - 0.14], 0.03, M.plastic));
    bar.push(segTube([bx, by, -hw + 0.14], [D.bodyRear + 0.25, by, -hw + 0.14], 0.03, M.plastic));
    bar.push(segTube([D.bodyRear + 0.25, by, hw - 0.14], [D.bodyRear + 0.25, by, -hw + 0.14], 0.03, M.plastic));
    this.add({ category: 'sportbar', variant: 'stock', name: 'Sport bar', group: 'core', layers: ['lit'], occlude: 'core', hidden: true }, bar);

    // interior: seats, dash, console (paintable interior zone)
    const it = [];
    const seat = (x, z) => {
      it.push(mesh(box(0.5, 0.18, 0.5, 0.05), M.seat, x, D.sillBottom + 0.42, z));
      it.push(mesh(box(0.16, 0.62, 0.5, 0.05), M.seat, x - 0.25, D.sillBottom + 0.78, z));
      it.push(mesh(box(0.14, 0.22, 0.26, 0.04), M.seat, x - 0.28, D.sillBottom + 1.12, z));
    };
    seat(0.05, 0.42); seat(0.05, -0.42); seat(-0.85, 0.42); seat(-0.85, -0.42);
    const dash = [mesh(box(0.42, 0.35, hw * 2 - 0.2, 0.04), M.interiorDark, 0.62, D.belt - 0.2, 0),
      mesh(box(0.9, 0.22, 0.3, 0.03), M.interiorDark, -0.1, D.sillBottom + 0.3, 0),
      mesh(new THREE.TorusGeometry(0.18, 0.025, 10, 32), M.interiorDark, 0.35, D.belt - 0.1, -0.42, [0, Math.PI / 2 + 0.3, 0])];
    this.add({ category: 'interior', variant: 'stock', name: 'Interior', group: 'core', layers: ['diffuse', 'spec'], paintable: true, zone: 'interior', occlude: 'core', hidden: true }, it);
    this.add({ category: 'dash', variant: 'stock', name: 'Dash', group: 'core', layers: ['lit'], occlude: 'core', hidden: true }, dash);
  }

  // ----- glass (windshield always; door glass and top glass are variant-dependent) -----
  buildGlass() {
    const D = DIM, M = this.M, hw = D.halfWidth;
    const wsBase = [0.76, D.belt + 0.03], wsTop = [0.52, D.roofBottom];
    const wsLen = Math.hypot(wsTop[0] - wsBase[0], wsTop[1] - wsBase[1]);
    const wsAng = Math.atan2(wsTop[0] - wsBase[0], wsTop[1] - wsBase[1]);
    const ws = mesh(new THREE.PlaneGeometry(hw * 2 - 0.18, wsLen - 0.12), M.glass, (wsBase[0] + wsTop[0]) / 2, (wsBase[1] + wsTop[1]) / 2, 0, [0, Math.PI / 2, 0]);
    ws.rotateX(-wsAng); // tilt
    this.add({ category: 'windshield', variant: 'stock', name: 'Windshield', group: 'core', layers: ['glass', 'glassMask'], occlude: 'core', hidden: true, isGlass: true }, [ws]);
  }

  // ----- hoods -----
  buildHoods() {
    const D = DIM, M = this.M;
    const len = D.bodyFront - 0.78, cx = D.bodyFront - len / 2, y = D.belt + 0.06;
    const stock = [mesh(box(len, 0.11, 1.62, 0.04), M.paint, cx, y, 0)];
    this.add({ category: 'hood', variant: 'stock', name: 'Flat hood', group: 'peripheral', layers: ['diffuse', 'spec'], paintable: true, zone: 'exterior', occlude: 'core', price: 0 }, stock);
    const vented = [mesh(box(len, 0.11, 1.62, 0.04), M.paint, cx, y, 0),
      mesh(box(0.55, 0.07, 0.42, 0.03), M.paint, cx + 0.1, y + 0.07, 0)];
    for (let i = 0; i < 4; i++) vented.push(mesh(box(0.04, 0.03, 0.34, 0.005), M.plastic, cx - 0.05 + i * 0.1, y + 0.11, 0));
    for (const s of [-1, 1]) for (let i = 0; i < 3; i++) vented.push(mesh(box(0.22, 0.015, 0.035, 0.004), M.plastic, cx - 0.35, y + 0.06, s * (0.45 + i * 0.07)));
    this.add({ category: 'hood', variant: 'vented', name: 'Power-bulge vented hood', group: 'peripheral', layers: ['diffuse', 'spec'], paintable: true, zone: 'exterior', occlude: 'core', price: 1290 }, vented);
  }

  // ----- doors -----
  buildDoors() {
    const D = DIM, M = this.M, hw = D.halfWidth;
    const doorSpecs = [['front', D.frontDoor], ['rear', D.rearDoor]];
    const lowerH = D.belt - D.sillTop - 0.02, lowerY = D.sillTop + 0.01 + lowerH / 2;
    const frameTop = D.roofBottom - 0.02;
    const mk = (variant) => {
      const panels = [], frames = [], glass = [];
      for (const s of [-1, 1]) for (const [name, [x0, x1]] of doorSpecs) {
        const len = x0 - x1 - 0.04, cx = (x0 + x1) / 2, z = s * (hw - 0.02);
        panels.push(mesh(box(len, lowerH, 0.07, 0.02), M.paint, cx, lowerY, z));
        panels.push(mesh(box(0.22, 0.03, 0.03, 0.01), M.plastic, cx - 0.15, D.belt - 0.14, s * (hw + 0.02))); // handle
        if (variant === 'full') {
          // window frame (paint) + glass
          const fh = frameTop - D.belt, fy = D.belt + fh / 2;
          frames.push(mesh(box(len, 0.05, 0.06, 0.01), M.paint, cx, frameTop - 0.025, z));
          frames.push(mesh(box(0.06, fh, 0.06, 0.01), M.paint, x0 - 0.05, fy, z));
          frames.push(mesh(box(0.06, fh, 0.06, 0.01), M.paint, x1 + 0.05, fy, z));
          frames.push(mesh(box(len, 0.03, 0.06, 0.01), M.paint, cx, D.belt + 0.015, z));
          glass.push(mesh(new THREE.PlaneGeometry(len - 0.1, fh - 0.08), M.glass, cx, fy, s * (hw - 0.02)));
        } else if (variant === 'tube') {
          const r = 0.03, zz = s * (hw - 0.02);
          const pts = [[x0 - 0.05, D.sillTop + 0.05], [x0 - 0.05, D.belt + 0.05], [x1 + 0.05, D.belt + 0.05], [x1 + 0.05, D.sillTop + 0.05]];
          for (let i = 0; i < pts.length - 1; i++) frames.push(segTube([pts[i][0], pts[i][1], zz], [pts[i + 1][0], pts[i + 1][1], zz], r, M.steel));
          frames.push(segTube([x0 - 0.05, D.sillTop + 0.05, zz], [x1 + 0.05, D.belt - 0.25, zz], r * 0.8, M.steel));
          frames.push(segTube([x0 - 0.05, D.belt - 0.25, zz], [x1 + 0.05, D.sillTop + 0.05, zz], r * 0.8, M.steel));
        }
      }
      return { panels, frames, glass };
    };
    const full = mk('full');
    this.add({ category: 'doors', variant: 'full', split: true, name: 'Full doors', group: 'peripheral', layers: ['diffuse', 'spec'], paintable: true, zone: 'exterior', occlude: 'core', price: 0 }, [...full.panels, ...full.frames]);
    this.add({ category: 'door_glass', variant: 'full', split: true, name: 'Door glass', group: 'peripheral', layers: ['glass', 'glassMask'], occlude: ['core', 'doors_l/full', 'doors_r/full'], hidden: true, isGlass: true, requires: { doors: 'full' } }, full.glass);
    const half = mk('half');
    this.add({ category: 'doors', variant: 'half', split: true, name: 'Half doors', group: 'peripheral', layers: ['diffuse', 'spec'], paintable: true, zone: 'exterior', occlude: 'core', price: 2450 }, half.panels);
    const tube_ = mk('tube');
    this.add({ category: 'doors', variant: 'tube', split: true, name: 'Trail tube doors', group: 'peripheral', layers: ['lit'], occlude: 'core', price: 1180 }, tube_.frames);
    this.add({ category: 'doors', variant: 'none', name: 'Doors removed', group: 'peripheral', layers: [], occlude: 'core', price: 0 }, []);
  }

  // ----- roofs -----
  buildRoofs() {
    const D = DIM, M = this.M, hw = D.halfWidth;
    const x0 = 0.5, x1 = D.bodyRear + 0.02, len = x0 - x1, cx = (x0 + x1) / 2;
    const h = D.roofTop - D.roofBottom + 0.02, y = (D.roofTop + D.roofBottom) / 2 + 0.01;
    const hard = [mesh(box(len, h, hw * 2 - 0.06, 0.05), M.paint, cx, y, 0)];
    // hardtop side walls behind the rear doors (C-pillar) and above belt: body-color panels + windows
    const sideH = D.roofBottom - D.belt - 0.02, sideY = (D.roofBottom + D.belt) / 2;
    const glass = [];
    hard.push(mesh(box(0.06, 0.08, hw * 2 - 0.12, 0.01), M.paint, D.bodyRear + 0.03, D.roofBottom - 0.04, 0)); // upper tailgate header
    hard.push(mesh(box(0.06, 0.06, hw * 2 - 0.12, 0.01), M.paint, D.bodyRear + 0.03, D.belt + 0.03, 0)); // upper tailgate sill
    for (const s of [-1, 1]) {
      hard.push(mesh(box(0.42, sideH + 0.02, 0.06, 0.01), M.paint, D.bodyRear + 0.21, sideY, s * (hw - 0.03))); // C-pillar panel
      hard.push(mesh(box(0.1, sideH, 0.05, 0.01), M.paint, D.rearDoor[1] - 0.03, sideY, s * (hw - 0.03))); // pillar behind rear door
      hard.push(mesh(box(D.rearDoor[1] - D.bodyRear - 0.4, 0.06, 0.05, 0.01), M.paint, (D.rearDoor[1] + D.bodyRear + 0.4) / 2 - 0.05, D.belt + 0.03, s * (hw - 0.03)));
      glass.push(mesh(new THREE.PlaneGeometry(D.rearDoor[1] - D.bodyRear - 0.55, sideH - 0.1), M.glass, (D.rearDoor[1] + D.bodyRear + 0.4) / 2 - 0.05, sideY, s * (hw - 0.03)));
    }
    glass.push(mesh(new THREE.PlaneGeometry(hw * 2 - 0.3, sideH - 0.1), M.glass, D.bodyRear + 0.03, sideY, 0, [0, Math.PI / 2, 0])); // rear glass
    this.add({ category: 'roof', variant: 'hardtop', name: 'Hard top', group: 'peripheral', layers: ['diffuse', 'spec'], paintable: true, zone: 'exterior', occlude: 'core', price: 0 }, hard);
    this.add({ category: 'top_glass', variant: 'hardtop', name: 'Top glass', group: 'peripheral', layers: ['glass', 'glassMask'], occlude: ['core', 'roof/hardtop'], hidden: true, isGlass: true, requires: { roof: 'hardtop' } }, glass);
    const soft = [mesh(box(len - 0.05, h + 0.03, hw * 2 - 0.12, 0.09), M.fabric, cx, y + 0.01, 0)];
    for (const s of [-1, 1]) soft.push(mesh(box(D.rearDoor[1] - D.bodyRear - 0.1, sideH, 0.04, 0.02), M.fabric, (D.rearDoor[1] + D.bodyRear) / 2 - 0.03, sideY, s * (hw - 0.03)));
    soft.push(mesh(box(0.05, sideH, hw * 2 - 0.2, 0.02), M.fabric, D.bodyRear + 0.03, sideY, 0));
    this.add({ category: 'roof', variant: 'soft', name: 'Soft top', group: 'peripheral', layers: ['lit'], occlude: 'core', price: 1690 }, soft);
    this.add({ category: 'roof', variant: 'none', name: 'Top removed', group: 'peripheral', layers: [], occlude: 'core', price: 0 }, []);
  }

  // ----- bumpers -----
  buildBumpers() {
    const D = DIM, M = this.M, hw = D.halfWidth;
    const fy = D.sillBottom + 0.12;
    const fstock = [mesh(box(0.22, 0.26, hw * 2 + 0.06, 0.06), M.plastic, D.bodyFront + 0.08, fy + 0.02, 0),
      mesh(box(0.16, 0.12, hw * 2 - 0.5, 0.03), M.plastic, D.bodyFront + 0.06, fy - 0.16, 0)];
    this.add({ category: 'front_bumper', variant: 'stock', name: 'Factory front bumper', group: 'peripheral', layers: ['lit'], occlude: 'core', price: 0 }, fstock);
    const steel = [mesh(box(0.26, 0.3, hw * 2 + 0.1, 0.02), M.steel, D.bodyFront + 0.1, fy, 0),
      mesh(box(0.3, 0.08, 0.9, 0.01), M.steel, D.bodyFront + 0.12, fy + 0.19, 0), // winch plate
      mesh(box(0.2, 0.14, 0.5, 0.02), M.steelDark, D.bodyFront + 0.1, fy + 0.3, 0)]; // winch
    const hx = D.bodyFront + 0.25, hy0 = fy + 0.1, hy1 = fy + 0.62;
    steel.push(segTube([hx, hy0, 0.42], [hx, hy1, 0.42], 0.025, M.steel), segTube([hx, hy0, -0.42], [hx, hy1, -0.42], 0.025, M.steel), segTube([hx, hy1, 0.42], [hx, hy1, -0.42], 0.025, M.steel));
    for (const s of [-1, 1]) steel.push(mesh(cyl(0.06, 0.06, 0.05, 20), M.lens, D.bodyFront + 0.24, fy + 0.02, s * 0.6, [0, 0, Math.PI / 2]));
    this.add({ category: 'front_bumper', variant: 'steel', name: 'Steel winch bumper', group: 'peripheral', layers: ['lit'], occlude: 'core', price: 1890 }, steel);
    const stubby = [mesh(box(0.24, 0.28, 1.25, 0.02), M.steel, D.bodyFront + 0.1, fy, 0),
      mesh(box(0.28, 0.07, 0.8, 0.01), M.steel, D.bodyFront + 0.12, fy + 0.18, 0)];
    for (const s of [-1, 1]) stubby.push(mesh(box(0.2, 0.2, 0.12, 0.02), M.steel, D.bodyFront + 0.08, fy - 0.02, s * 0.66, [0, 0, 0]));
    this.add({ category: 'front_bumper', variant: 'stubby', name: 'Stubby steel bumper', group: 'peripheral', layers: ['lit'], occlude: 'core', price: 1240 }, stubby);
    // rear
    const ry = D.sillBottom + 0.1;
    const rstock = [mesh(box(0.2, 0.24, hw * 2 + 0.06, 0.06), M.plastic, D.bodyRear - 0.08, ry, 0)];
    this.add({ category: 'rear_bumper', variant: 'stock', name: 'Factory rear bumper', group: 'peripheral', layers: ['lit'], occlude: 'core', price: 0 }, rstock);
    const rsteel = [mesh(box(0.24, 0.28, hw * 2 + 0.1, 0.02), M.steel, D.bodyRear - 0.1, ry, 0),
      mesh(box(0.14, 0.08, 0.12, 0.01), M.steelDark, D.bodyRear - 0.22, ry - 0.04, 0)]; // hitch
    for (const s of [-1, 1]) rsteel.push(mesh(box(0.2, 0.05, 0.22, 0.01), M.steel, D.bodyRear - 0.12, ry + 0.16, s * 0.55));
    this.add({ category: 'rear_bumper', variant: 'steel', name: 'Steel rear bumper w/ hitch', group: 'peripheral', layers: ['lit'], occlude: 'core', price: 1450 }, rsteel);
  }

  // ----- fender flares -----
  buildFlares() {
    const D = DIM, M = this.M, hw = D.halfWidth;
    const mk = (axleX, r0, r1, thick, zOff) => {
      const out = [];
      for (const s of [-1, 1]) {
        const shape = arcBand(r0, r1, 0, Math.PI);
        const g = extrudeXY(shape, thick, 0, 0.006);
        const mm = new THREE.Mesh(g, M.plastic); mm.position.set(axleX, D.archCY, s * (hw + zOff + thick / 2)); out.push(mm);
      }
      return out;
    };
    const stockR1 = D.archR + 0.11;
    this.add({ category: 'front_flares', variant: 'stock', split: true, name: 'Factory flares', group: 'peripheral', layers: ['lit'], occlude: 'core', zBias: 0.25, price: 0 }, mk(D.frontAxleX, D.archR + 0.01, stockR1, 0.09, 0.0));
    this.add({ category: 'front_flares', variant: 'wide', split: true, name: 'Wide flat flares', group: 'peripheral', layers: ['lit'], occlude: 'core', zBias: 0.25, price: 520 }, mk(D.frontAxleX, D.archR + 0.01, D.archR + 0.2, 0.16, 0.0));
    this.add({ category: 'rear_flares', variant: 'stock', split: true, name: 'Factory flares', group: 'peripheral', layers: ['lit'], occlude: 'core', zBias: 0.25, price: 0 }, mk(D.rearAxleX, D.archR + 0.01, stockR1, 0.09, 0.0));
    this.add({ category: 'rear_flares', variant: 'wide', split: true, name: 'Wide flat flares', group: 'peripheral', layers: ['lit'], occlude: 'core', zBias: 0.25, price: 520 }, mk(D.rearAxleX, D.archR + 0.01, D.archR + 0.2, 0.16, 0.0));
  }

  // ----- wheels: tires (2 types) x rims (3 designs) at 4 positions + brakes -----
  tireGeo(type) {
    const R = DIM.tireR[type], W = DIM.tireW[type], r = DIM.rimR + 0.02;
    // profile: inner bead -> sidewall bulge -> tread -> sidewall -> inner bead
    const prof = [[r, -W / 2 + 0.02], [R * 0.86, -W / 2 + 0.01], [R * 0.97, -W / 2 + 0.05], [R, -W / 2 + 0.1], [R, W / 2 - 0.1], [R * 0.97, W / 2 - 0.05], [R * 0.86, W / 2 - 0.01], [r, W / 2 - 0.02]].map(p => new THREE.Vector2(p[0], p[1]));
    return new THREE.LatheGeometry(prof, 48);
  }
  rimMeshes(design) {
    const axisSign = 1;
    const M = this.M, R = DIM.rimR, out = [];
    const face = 0.06; // spoke plane sits near the outer lip
    const hub = mesh(cyl(R * 0.42, R * 0.42, 0.09, 24), M.rim, 0, face, 0); out.push(hub);
    const barrel = new THREE.Mesh(new THREE.LatheGeometry([[R * 0.95, -0.1], [R, -0.09], [R, 0.1], [R * 0.95, 0.11], [R * 0.9, 0.09], [R * 0.9, -0.08]].map(p => new THREE.Vector2(...p)), 40), M.rim); out.push(barrel);
    if (design === 'fivespoke') { for (let i = 0; i < 5; i++) { const a = i / 5 * Math.PI * 2; const sp = mesh(box(R * 0.85, 0.04, 0.075, 0.01), M.rim, Math.cos(a) * R * 0.5, face, Math.sin(a) * R * 0.5); sp.rotation.y = -a; out.push(sp); } }
    else if (design === 'beadlock') {
      for (let i = 0; i < 8; i++) { const a = i / 8 * Math.PI * 2; const sp = mesh(box(R * 0.85, 0.035, 0.05, 0.008), M.rim, Math.cos(a) * R * 0.5, face, Math.sin(a) * R * 0.5); sp.rotation.y = -a; out.push(sp); }
      const ring = new THREE.Mesh(new THREE.TorusGeometry(R * 0.97, 0.022, 10, 48), M.steelDark); ring.rotation.x = Math.PI / 2; ring.position.y = axisSign * 0.1; out.push(ring);
      for (let i = 0; i < 16; i++) { const a = i / 16 * Math.PI * 2; const b = mesh(cyl(0.012, 0.012, 0.02, 8), M.alu, Math.cos(a) * R * 0.97, axisSign * 0.11, Math.sin(a) * R * 0.97); out.push(b); }
    } else { // steel wheel: solid dish with 6 holes (rendered as dark discs)
      const dish = mesh(cyl(R * 0.9, R * 0.9, 0.03, 40), M.rim, 0, face, 0); out.push(dish);
      for (let i = 0; i < 6; i++) { const a = i / 6 * Math.PI * 2; out.push(mesh(cyl(0.045, 0.045, 0.034, 16), M.plastic, Math.cos(a) * R * 0.58, face, Math.sin(a) * R * 0.58)); }
    }
    return out;
  }
  buildWheels() {
    const D = DIM, M = this.M;
    const positions = { fl: [D.frontAxleX, -1], fr: [D.frontAxleX, 1], rl: [D.rearAxleX, -1], rr: [D.rearAxleX, 1] };
    const posName = { fl: 'Front left', fr: 'Front right', rl: 'Rear left', rr: 'Rear right' };
    for (const [pos, [ax, s]] of Object.entries(positions)) {
      const z = s * D.track / 2;
      for (const [type, name, price] of [['at', 'All-terrain 33"', 0], ['mt', 'Mud-terrain 35"', 1480]]) {
        const R = D.tireR[type], cy = R; // tire sits on the ground: center height = radius
        const t = new THREE.Mesh(this.tireGeo(type), M.rubber); t.rotation.x = Math.PI / 2; t.position.set(ax, cy, z);
        const lugs = [];
        const nl = type === 'mt' ? 22 : 30; for (let i = 0; i < nl; i++) { const a = i / nl * Math.PI * 2; const lug = mesh(box(type === 'mt' ? 0.07 : 0.05, 0.02, D.tireW[type] - 0.06, 0.004), M.rubberLug, ax + Math.cos(a) * (R - 0.004), cy + Math.sin(a) * (R - 0.004), z); lug.rotation.z = a + Math.PI / 2; lugs.push(lug); }
        this.add({ category: `tire_${pos}`, variant: type, name, group: 'wheels', layers: ['lit'], occlude: 'none', price, wheelPos: pos, tireType: type }, [t, ...lugs]);
      }
      for (const [design, name, price] of [['fivespoke', '5-spoke alloy', 0], ['beadlock', 'Beadlock 8-spoke', 1960], ['steel', 'Classic steel', 640]]) {
        const grp = new THREE.Group(); this.rimMeshes(design).forEach(m => grp.add(m));
        grp.rotation.x = s * Math.PI / 2; // rim axis (local +Y = outer face) -> world s*Z, facing outward
        grp.position.set(ax, D.tireR.at, z + s * 0.03);
        this.add({ category: `rim_${pos}`, variant: design, name, group: 'wheels', layers: ['diffuse', 'spec'], paintable: true, zone: 'wheels', occlude: 'none', price, wheelPos: pos }, [grp]);
      }
      const disc = mesh(cyl(0.17, 0.17, 0.03, 32), M.brake, ax, D.tireR.at, z - s * 0.06, [Math.PI / 2, 0, 0]);
      const cal = mesh(box(0.1, 0.16, 0.06, 0.015), M.caliper, ax + 0.1, D.tireR.at + 0.06, z - s * 0.06);
      this.add({ category: `brake_${pos}`, variant: 'stock', name: 'Brake', group: 'wheels', layers: ['lit'], occlude: 'none', hidden: true, wheelPos: pos }, [disc, cal]);
    }
    // wheel-axis positions (for neon rings) are derived from DIM at runtime
  }

  // ----- lights -----
  buildLights() {
    const D = DIM, M = this.M;
    const hy = D.sillTop + 0.24, hz = 0.6;
    const halogen = [], halogenGlow = [];
    for (const s of [-1, 1]) {
      halogen.push(mesh(cyl(0.14, 0.14, 0.05, 32), M.plastic, D.bodyFront - 0.02, hy, s * hz, [0, 0, Math.PI / 2]));
      const lens = mesh(cyl(0.11, 0.11, 0.03, 32), M.lens, D.bodyFront + 0.01, hy, s * hz, [0, 0, Math.PI / 2]); halogen.push(lens);
      halogenGlow.push(mesh(cyl(0.11, 0.11, 0.03, 32), M.glow, D.bodyFront + 0.012, hy, s * hz, [0, 0, Math.PI / 2]));
      // turn signals (amber) at the outer corners
      halogen.push(mesh(box(0.03, 0.08, 0.14, 0.01), M.lensAmber, D.bodyFront + 0.005, D.sillTop + 0.16, s * 0.78));
    }
    this.add({ category: 'headlights', variant: 'halogen', name: 'Halogen headlights', group: 'peripheral', layers: ['lit'], occlude: 'core', price: 0 }, halogen);
    this.add({ category: 'headlights_glow', variant: 'halogen', name: 'Headlight glow', group: 'peripheral', layers: ['glow'], occlude: 'core', hidden: true, requires: { headlights: 'halogen' } }, halogenGlow);
    const led = [], ledGlow = [];
    for (const s of [-1, 1]) {
      led.push(mesh(cyl(0.14, 0.14, 0.05, 32), M.plastic, D.bodyFront - 0.02, hy, s * hz, [0, 0, Math.PI / 2]));
      led.push(mesh(cyl(0.07, 0.07, 0.035, 32), M.lens, D.bodyFront + 0.01, hy, s * hz, [0, 0, Math.PI / 2]));
      led.push(new THREE.Mesh(new THREE.TorusGeometry(0.105, 0.012, 8, 40), M.lens)); led[led.length - 1].position.set(D.bodyFront + 0.012, hy, s * hz); led[led.length - 1].rotation.y = Math.PI / 2;
      const halo = new THREE.Mesh(new THREE.TorusGeometry(0.105, 0.014, 8, 40), M.glow); halo.position.set(D.bodyFront + 0.014, hy, s * hz); halo.rotation.y = Math.PI / 2; ledGlow.push(halo);
      ledGlow.push(mesh(cyl(0.07, 0.07, 0.035, 32), M.glow, D.bodyFront + 0.012, hy, s * hz, [0, 0, Math.PI / 2]));
      led.push(mesh(box(0.03, 0.08, 0.14, 0.01), M.lensAmber, D.bodyFront + 0.005, D.sillTop + 0.16, s * 0.78));
    }
    this.add({ category: 'headlights', variant: 'led', name: 'LED halo headlights', group: 'peripheral', layers: ['lit'], occlude: 'core', price: 690 }, led);
    this.add({ category: 'headlights_glow', variant: 'led', name: 'Headlight glow', group: 'peripheral', layers: ['glow'], occlude: 'core', hidden: true, requires: { headlights: 'led' } }, ledGlow);
    // taillights (core-ish, always) + glow
    const tl = [], tlGlow = [];
    for (const s of [-1, 1]) {
      tl.push(mesh(box(0.05, 0.26, 0.16, 0.015), M.lensRed, D.bodyRear - 0.02, D.sillTop + 0.26, s * 0.76));
      tl.push(mesh(box(0.05, 0.07, 0.16, 0.01), M.lens, D.bodyRear - 0.02, D.sillTop + 0.08, s * 0.76));
      tlGlow.push(mesh(box(0.05, 0.26, 0.16, 0.015), M.glow, D.bodyRear - 0.022, D.sillTop + 0.26, s * 0.76));
    }
    this.add({ category: 'taillights', variant: 'stock', name: 'Taillights', group: 'core', layers: ['lit'], occlude: 'core', hidden: true }, tl);
    this.add({ category: 'taillights_glow', variant: 'stock', name: 'Taillight glow', group: 'core', layers: ['glow'], occlude: 'core', hidden: true, glowColor: 'ff2a1a' }, tlGlow);
  }

  // ----- grilles -----
  buildGrilles() {
    const D = DIM, M = this.M;
    const gx = D.bodyFront + 0.005, gy = D.sillTop + 0.21;
    const slat = [mesh(box(0.03, 0.3, 0.86, 0.01), M.plastic, gx + 0.012, gy, 0)];
    for (let i = 0; i < 3; i++) slat.push(mesh(box(0.03, 0.05, 0.8, 0.01), M.plasticLight, gx + 0.035, gy - 0.09 + i * 0.09, 0));
    this.add({ category: 'grille', variant: 'slat', name: 'Factory slat grille', group: 'peripheral', layers: ['lit'], occlude: 'core', price: 0 }, slat);
    const meshG = [mesh(box(0.03, 0.3, 0.86, 0.01), M.plastic, gx + 0.012, gy, 0)];
    const hexTex = (() => { const c = document.createElement('canvas'); c.width = 256; c.height = 128; const ctx = c.getContext('2d'); ctx.fillStyle = '#0d0d0e'; ctx.fillRect(0, 0, 256, 128); ctx.strokeStyle = '#5a5e63'; ctx.lineWidth = 3; const r = 10; for (let y = 0; y < 140; y += r * 1.5) for (let x = 0; x < 270; x += r * 1.732) { const ox = ((y / (r * 1.5)) % 2) * r * 0.866; ctx.beginPath(); for (let k = 0; k < 6; k++) { const a = Math.PI / 6 + k * Math.PI / 3; ctx.lineTo(x + ox + r * Math.cos(a), y + r * Math.sin(a)); } ctx.closePath(); ctx.stroke(); } const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(2, 1); return t; })();
    meshG.push(mesh(new THREE.PlaneGeometry(0.8, 0.26), new THREE.MeshStandardMaterial({ map: hexTex, roughness: 0.6, metalness: 0.4 }), gx + 0.03, gy, 0, [0, Math.PI / 2, 0]));
    meshG.push(mesh(box(0.02, 0.32, 0.88, 0.01), M.alu, gx + 0.005, gy, 0));
    this.add({ category: 'grille', variant: 'mesh', name: 'Hex mesh grille', group: 'peripheral', layers: ['lit'], occlude: 'core', price: 310 }, meshG);
  }

  // ----- mirrors -----
  buildMirrors() {
    const D = DIM, M = this.M, hw = D.halfWidth;
    const mk = (w, h) => { const out = []; for (const s of [-1, 1]) { out.push(mesh(box(0.05, 0.03, 0.18, 0.01), M.plastic, 0.48, D.belt + 0.12, s * (hw + 0.07))); out.push(mesh(box(0.05, h, w, 0.02), M.plastic, 0.46, D.belt + 0.2, s * (hw + 0.16))); out.push(mesh(box(0.012, h - 0.04, w - 0.04, 0.005), M.chrome, 0.432, D.belt + 0.2, s * (hw + 0.16))); } return out; };
    this.add({ category: 'mirrors', variant: 'stock', split: true, name: 'Factory mirrors', group: 'peripheral', layers: ['lit'], occlude: 'core', price: 0 }, mk(0.2, 0.16));
    this.add({ category: 'mirrors', variant: 'tow', split: true, name: 'Trail tow mirrors', group: 'peripheral', layers: ['lit'], occlude: 'core', price: 380 }, mk(0.26, 0.24));
  }

  // ----- side steps / rock sliders -----
  buildSteps() {
    const D = DIM, M = this.M, hw = D.halfWidth;
    const x0 = D.frontDoor[0], x1 = D.rearDoor[1], cx = (x0 + x1) / 2, len = x0 - x1;
    const steps = [];
    for (const s of [-1, 1]) { steps.push(segTube([x0, D.sillBottom - 0.08, s * (hw + 0.12)], [x1, D.sillBottom - 0.08, s * (hw + 0.12)], 0.035, M.plastic)); for (const x of [x0 - 0.2, cx, x1 + 0.2]) steps.push(segTube([x, D.sillBottom - 0.08, s * (hw + 0.12)], [x, D.sillBottom + 0.02, s * (hw - 0.1)], 0.02, M.steelDark)); }
    this.add({ category: 'steps', variant: 'none', name: 'No side steps', group: 'peripheral', layers: [], occlude: 'core', price: 0 }, []);
    this.add({ category: 'steps', variant: 'tube', split: true, name: 'Tube side steps', group: 'peripheral', layers: ['lit'], occlude: 'core', price: 420 }, steps);
    const sliders = [];
    for (const s of [-1, 1]) { sliders.push(mesh(box(len + 0.1, 0.07, 0.2, 0.015), M.steel, cx, D.sillBottom - 0.04, s * (hw + 0.08))); sliders.push(mesh(box(len - 0.2, 0.05, 0.12, 0.01), M.steel, cx, D.sillBottom - 0.02, s * (hw - 0.02))); }
    this.add({ category: 'steps', variant: 'sliders', split: true, name: 'Rock sliders', group: 'peripheral', layers: ['lit'], occlude: 'core', price: 760 }, sliders);
  }

  // ----- roof rack, light bar, snorkel, antenna, spare -----
  buildRacks() {
    const D = DIM, M = this.M, hw = D.halfWidth;
    const y = D.roofTop + 0.16, x0 = 0.3, x1 = D.bodyRear + 0.25, zz = hw - 0.14;
    const rack = [segTube([x0, y, zz], [x1, y, zz], 0.02, M.steelDark), segTube([x0, y, -zz], [x1, y, -zz], 0.02, M.steelDark), segTube([x0, y, zz], [x0, y, -zz], 0.02, M.steelDark), segTube([x1, y, zz], [x1, y, -zz], 0.02, M.steelDark)];
    for (let i = 1; i < 6; i++) { const x = x0 + (x1 - x0) * i / 6; rack.push(segTube([x, y - 0.01, zz], [x, y - 0.01, -zz], 0.012, M.steelDark)); }
    for (const [x, z] of [[x0 + 0.1, zz - 0.05], [x0 + 0.1, -zz + 0.05], [x1 - 0.1, zz - 0.05], [x1 - 0.1, -zz + 0.05]]) rack.push(segTube([x, D.roofTop, z], [x, y, z], 0.018, M.steelDark));
    this.add({ category: 'roof_rack', variant: 'none', name: 'No roof rack', group: 'peripheral', layers: [], occlude: 'core', price: 0 }, []);
    this.add({ category: 'roof_rack', variant: 'basket', name: 'Basket roof rack', group: 'peripheral', layers: ['lit'], occlude: 'core', price: 890 }, rack);
    // light bar on the windshield header
    const lbx = 0.46, lby = D.roofTop + 0.06;
    const bar = [mesh(box(0.06, 0.07, 1.3, 0.015), M.steelDark, lbx, lby, 0), mesh(box(0.012, 0.045, 1.24, 0.005), M.lens, lbx + 0.03, lby, 0)];
    for (const s of [-1, 1]) bar.push(mesh(box(0.08, 0.12, 0.03, 0.01), M.steelDark, lbx + 0.02, lby - 0.06, s * 0.66));
    const barGlow = [mesh(box(0.012, 0.045, 1.24, 0.005), M.glow, lbx + 0.032, lby, 0)];
    this.add({ category: 'light_bar', variant: 'none', name: 'No light bar', group: 'peripheral', layers: [], occlude: 'core', price: 0 }, []);
    this.add({ category: 'light_bar', variant: 'led', name: '50" LED light bar', group: 'peripheral', layers: ['lit'], occlude: 'core', price: 540 }, bar);
    this.add({ category: 'light_bar_glow', variant: 'led', name: 'Light bar glow', group: 'peripheral', layers: ['glow'], occlude: 'core', hidden: true, requires: { light_bar: 'led' } }, barGlow);
    // snorkel (right side A-pillar)
    const sn = [segTube([1.1, D.belt + 0.1, hw + 0.03], [0.62, D.belt + 0.1, hw + 0.03], 0.045, M.plastic), segTube([0.62, D.belt + 0.1, hw + 0.03], [0.5, D.roofBottom + 0.05, hw + 0.03], 0.045, M.plastic), mesh(box(0.2, 0.1, 0.11, 0.03), M.plastic, 0.45, D.roofBottom + 0.1, hw + 0.03)];
    this.add({ category: 'snorkel', variant: 'none', name: 'No snorkel', group: 'peripheral', layers: [], occlude: 'core', price: 0 }, []);
    this.add({ category: 'snorkel', variant: 'raised', name: 'Raised air intake', group: 'peripheral', layers: ['lit'], occlude: 'core', price: 460 }, sn);
    // antenna
    this.add({ category: 'antenna', variant: 'none', name: 'No antenna', group: 'peripheral', layers: [], occlude: 'core', price: 0 }, []);
    this.add({ category: 'antenna', variant: 'whip', name: 'Whip antenna', group: 'peripheral', layers: ['lit'], occlude: 'core', price: 45 }, [segTube([1.9, D.belt, -hw + 0.12], [1.86, D.belt + 0.95, -hw + 0.12], 0.008, M.plastic), mesh(cyl(0.025, 0.03, 0.05, 12), M.plastic, 1.9, D.belt + 0.02, -hw + 0.12)]);
  }
  buildMisc() {
    const D = DIM, M = this.M;
    // spare wheel on the tailgate (uses stock 5-spoke rim + the selected tire type)
    for (const type of ['at', 'mt']) {
      const R = D.tireR[type];
      const t = new THREE.Mesh(this.tireGeo(type), M.rubber); t.rotation.z = Math.PI / 2; t.position.set(D.bodyRear - 0.25, D.belt + 0.1, 0.15);
      const rim = new THREE.Group(); this.rimMeshes('fivespoke', 1).forEach(mm => rim.add(mm)); rim.rotation.z = Math.PI / 2; rim.position.set(D.bodyRear - 0.28, D.belt + 0.1, 0.15);
      const carrier = mesh(box(0.1, 0.5, 0.3, 0.02), M.steelDark, D.bodyRear - 0.1, D.belt + 0.1, 0.15);
      this.add({ category: 'spare', variant: type, name: 'Spare wheel', group: 'peripheral', layers: ['lit'], occlude: 'core', hidden: true, requires: { spare_wheel: 'mounted', tire_fl: type } }, [t, rim, carrier]);
    }
    this.add({ category: 'spare_wheel', variant: 'none', name: 'Spare removed', group: 'peripheral', layers: [], occlude: 'core', price: 0 }, []);
    this.add({ category: 'spare_wheel', variant: 'mounted', name: 'Tailgate spare', group: 'peripheral', layers: [], occlude: 'core', price: 0 }, []);
    // exhaust tip
    this.add({ category: 'exhaust', variant: 'stock', name: 'Exhaust', group: 'core', layers: ['lit'], occlude: 'core', hidden: true }, [mesh(cyl(0.04, 0.04, 0.3, 16), M.chrome, D.bodyRear - 0.1, D.sillBottom - 0.08, 0.55, [0, 0, Math.PI / 2])]);
  }
  buildShadow() {
    const D = DIM, M = this.M;
    const c = document.createElement('canvas'); c.width = 512; c.height = 256; const ctx = c.getContext('2d');
    ctx.clearRect(0, 0, 512, 256);
    const g = ctx.createRadialGradient(256, 128, 40, 256, 128, 230); g.addColorStop(0, 'rgba(0,0,0,0.55)'); g.addColorStop(0.6, 'rgba(0,0,0,0.35)'); g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g; ctx.save(); ctx.scale(1, 0.55); ctx.beginPath(); ctx.ellipse(256, 232, 240, 170, 0, 0, Math.PI * 2); ctx.fill(); ctx.restore();
    // wheel contact spots
    const sx = 512 / 5.6, sz = 256 / 2.8;
    for (const [x, z] of [[D.frontAxleX, D.track / 2], [D.frontAxleX, -D.track / 2], [D.rearAxleX, D.track / 2], [D.rearAxleX, -D.track / 2]]) {
      const px = 256 + x * sx, pz = 128 + z * sz; const gg = ctx.createRadialGradient(px, pz, 2, px, pz, 34); gg.addColorStop(0, 'rgba(0,0,0,0.8)'); gg.addColorStop(1, 'rgba(0,0,0,0)'); ctx.fillStyle = gg; ctx.beginPath(); ctx.ellipse(px, pz, 40, 24, 0, 0, Math.PI * 2); ctx.fill();
    }
    const tex = new THREE.CanvasTexture(c);
    M.shadow = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false });
    const plane = mesh(new THREE.PlaneGeometry(5.6, 2.8), M.shadow, -0.1, 0.004, 0, [-Math.PI / 2, 0, 0]);
    this.add({ category: 'shadow', variant: 'stock', name: 'Shadow', group: 'ground', layers: ['lit'], occlude: 'none', hidden: true, zBias: -5 }, [plane]);
  }
  buildNeon() {
    const D = DIM, M = this.M;
    const gc = document.createElement('canvas'); gc.width = 512; gc.height = 256; const gx = gc.getContext('2d');
    const grad = gx.createRadialGradient(256, 128, 20, 256, 128, 250); grad.addColorStop(0, 'rgba(255,255,255,1)'); grad.addColorStop(0.45, 'rgba(255,255,255,0.75)'); grad.addColorStop(1, 'rgba(255,255,255,0)');
    gx.fillStyle = grad; gx.save(); gx.scale(1, 0.5); gx.beginPath(); gx.ellipse(256, 256, 256, 250, 0, 0, Math.PI * 2); gx.fill(); gx.restore();
    const underMat = new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(gc), transparent: true, depthWrite: false });
    const under = mesh(new THREE.PlaneGeometry(5.2, 2.6), underMat, -0.1, 0.01, 0, [-Math.PI / 2, 0, 0]); under.userData.keepMat = true;
    this.add({ category: 'underglow', variant: 'stock', name: 'Underglow', group: 'ground', layers: ['glow'], occlude: 'none', hidden: true, zBias: -4, softGlow: true }, [under]);
    for (const [pos, ax, s] of [['fl', D.frontAxleX, -1], ['fr', D.frontAxleX, 1], ['rl', D.rearAxleX, -1], ['rr', D.rearAxleX, 1]]) {
      const r = new THREE.Mesh(new THREE.TorusGeometry(D.rimR + 0.03, 0.02, 8, 48), M.glow); r.position.set(ax, D.tireR.at, s * (D.track / 2 + 0.17));
      this.add({ category: `wheel_neon_${pos}`, configKey: 'wheel_neon', variant: 'stock', name: 'Wheel neon', group: 'wheels', layers: ['glow'], occlude: 'none', hidden: true, softGlow: true, wheelPos: pos }, [r]);
    }
  }
}

// Default build configuration (category -> variant)
export const DEFAULT_CONFIG = {
  body: 'stock', chassis: 'stock', sportbar: 'stock', interior: 'stock', dash: 'stock', windshield: 'stock', taillights: 'stock', taillights_glow: 'stock', exhaust: 'stock', shadow: 'stock',
  hood: 'stock', doors: 'full', door_glass: 'full', roof: 'hardtop', top_glass: 'hardtop',
  front_bumper: 'stock', rear_bumper: 'stock', front_flares: 'stock', rear_flares: 'stock',
  tire_fl: 'at', tire_fr: 'at', tire_rl: 'at', tire_rr: 'at', rim_fl: 'fivespoke', rim_fr: 'fivespoke', rim_rl: 'fivespoke', rim_rr: 'fivespoke',
  brake_fl: 'stock', brake_fr: 'stock', brake_rl: 'stock', brake_rr: 'stock',
  headlights: 'halogen', headlights_glow: 'halogen', grille: 'slat', mirrors: 'stock', steps: 'none', roof_rack: 'none', light_bar: 'none', light_bar_glow: 'led', snorkel: 'none', antenna: 'none', spare: 'at', spare_wheel: 'mounted',
  underglow: 'stock', wheel_neon: 'stock',
};
