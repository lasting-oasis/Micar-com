import * as THREE from 'three';

// Shared building details: windows, doors, canopies, trim. Every piece uses one
// of a handful of materials created ONCE here, so the static batcher merges all
// the windows (or all the door frames, ...) of the whole town into one draw
// call per material. Pieces never cast shadows; only the big wall masses do.
//
// Each helper builds its piece in a local frame where the facade faces +z and
// the wall surface is the plane z = 0; `place()` puts it on a building face.

export type Face = '+x' | '-x' | '+z' | '-z';
const FACE_ROT: Record<Face, number> = { '+z': 0, '-z': Math.PI, '+x': Math.PI / 2, '-x': -Math.PI / 2 };

// Door atlas regions (u0, v0, u1, v1) — see drawDoorAtlas.
const ATLAS_STEEL: [number, number, number, number] = [0, 0, 0.25, 1];
const ATLAS_WOOD: [number, number, number, number] = [0.25, 0, 0.5, 1];
const ATLAS_ROLLUP: [number, number, number, number] = [0.5, 0, 1, 1];

// One glass pane (tiles: each texture repeat is one pane, its edges form the mullions).
function drawPane(lit: boolean) {
    const s = lit ? 64 : 128;
    const c = document.createElement('canvas'); c.width = s; c.height = s;
    const g = c.getContext('2d')!;
    const b = Math.round(s * 0.04); // half mullion
    if (lit) {
        // Emissive map: interior glow, brighter under the ceiling lights; mullions stay dark.
        g.fillStyle = '#000'; g.fillRect(0, 0, s, s);
        const grad = g.createLinearGradient(0, b, 0, s - b);
        grad.addColorStop(0, '#ffffff'); grad.addColorStop(0.55, '#e0d2b8'); grad.addColorStop(1, '#9c8a6a');
        g.fillStyle = grad; g.fillRect(b, b, s - 2 * b, s - 2 * b);
    } else {
        // Colour map: sky reflected in the glass (lighter at the top), a soft sheen, metal mullions.
        const grad = g.createLinearGradient(0, 0, 0, s);
        grad.addColorStop(0, '#7f9dbd'); grad.addColorStop(0.45, '#3f5b7c'); grad.addColorStop(1, '#1d2b3f');
        g.fillStyle = grad; g.fillRect(0, 0, s, s);
        g.fillStyle = 'rgba(255,255,255,0.10)';
        g.beginPath(); g.moveTo(s * 0.15, 0); g.lineTo(s * 0.42, 0); g.lineTo(s * 0.12, s); g.lineTo(-s * 0.15, s); g.fill();
        g.fillStyle = '#3a4049';
        g.fillRect(0, 0, s, b); g.fillRect(0, s - b, s, b); g.fillRect(0, 0, b, s); g.fillRect(s - b, 0, b, s);
        g.fillStyle = 'rgba(255,255,255,0.18)';
        g.fillRect(b, b, s - 2 * b, 1); g.fillRect(b, b, 1, s - 2 * b);
    }
    const t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
}

// 512x256 atlas: steel personnel door | wooden panel leaf | roll-up door slats.
function drawDoorAtlas() {
    const c = document.createElement('canvas'); c.width = 512; c.height = 256;
    const g = c.getContext('2d')!;
    // Steel door (0..128)
    g.fillStyle = '#5d6b7a'; g.fillRect(0, 0, 128, 256);
    g.strokeStyle = 'rgba(0,0,0,0.35)'; g.lineWidth = 2; g.strokeRect(10, 10, 108, 236);
    g.fillStyle = '#1b2633'; g.fillRect(44, 34, 40, 62);           // vision window
    g.fillStyle = 'rgba(255,255,255,0.25)'; g.fillRect(46, 36, 8, 58);
    g.fillStyle = '#9aa3ad'; g.fillRect(10, 214, 108, 30);         // kick plate
    g.fillStyle = '#d4d8dd'; g.fillRect(92, 128, 22, 6); g.fillRect(92, 122, 6, 16); // lever handle
    // Wooden leaf (128..256): two raised panels, brass handle
    g.fillStyle = '#5a361a'; g.fillRect(128, 0, 128, 256);
    for (const [y, h] of [[18, 100], [134, 104]]) {
        g.fillStyle = '#6e4423'; g.fillRect(146, y, 92, h);
        g.strokeStyle = '#3d2410'; g.lineWidth = 3; g.strokeRect(146, y, 92, h);
        g.strokeStyle = 'rgba(255,220,170,0.25)'; g.lineWidth = 2; g.strokeRect(154, y + 8, 76, h - 16);
    }
    g.fillStyle = '#d6b25e'; g.fillRect(232, 118, 8, 22);
    // Roll-up door (256..512): horizontal slats and a bottom bar
    g.fillStyle = '#b7bec7'; g.fillRect(256, 0, 256, 256);
    for (let y = 0; y < 240; y += 12) {
        g.fillStyle = 'rgba(0,0,0,0.28)'; g.fillRect(256, y + 10, 256, 2);
        g.fillStyle = 'rgba(255,255,255,0.35)'; g.fillRect(256, y + 1, 256, 1);
    }
    g.fillStyle = '#4b535d'; g.fillRect(256, 240, 256, 16);
    g.fillStyle = '#e5e7eb'; g.fillRect(372, 228, 24, 6);           // pull handle
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
}

const remapUV = (geo: THREE.BufferGeometry, [u0, v0, u1, v1]: [number, number, number, number]) => {
    const uv = geo.attributes.uv as THREE.BufferAttribute;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, u0 + uv.getX(i) * (u1 - u0), v0 + uv.getY(i) * (v1 - v0));
    return geo;
};

/** Scale a BoxGeometry's side-face UVs so each texture repeat covers cellW x cellH world units. */
export const boxUVsWorld = (geo: THREE.BoxGeometry, w: number, h: number, d: number, cellW: number, cellH: number, yBottom = 0) => {
    const uv = geo.attributes.uv as THREE.BufferAttribute;
    // BoxGeometry face order: +x, -x, +y, -y, +z, -z (4 vertices each)
    const faceW = [d, d, w, w, w, w];
    for (let f = 0; f < 6; f++) {
        for (let k = 0; k < 4; k++) {
            const i = f * 4 + k;
            if (f === 2 || f === 3) { uv.setXY(i, 0.5 / 8, 0.004); continue; } // roof/floor: one flat colour
            uv.setXY(i, uv.getX(i) * faceW[f] / cellW, (yBottom + uv.getY(i) * h) / cellH);
        }
    }
    return geo;
};

export function createArchitectureKit(cityMaterials: THREE.Material[], cityTextures: THREE.Texture[], emissiveFacadeMaterials: THREE.MeshStandardMaterial[]) {
    const paneTex = drawPane(false), paneGlowTex = drawPane(true), doorAtlas = drawDoorAtlas();
    cityTextures.push(paneTex, paneGlowTex, doorAtlas);

    /** Dark anodised aluminium: window frames, mullions, door frames, canopies. */
    const frameMat = new THREE.MeshStandardMaterial({ color: '#2b3038', roughness: 0.5, metalness: 0.55 });
    /** Light cast stone / concrete: sills, lintels, cornices, steps, columns, docks. */
    const trimMat = new THREE.MeshStandardMaterial({ color: '#c9c3b5', roughness: 0.85 });
    /** Window glass of an unlit room (reflects the sky). */
    const glassMat = new THREE.MeshStandardMaterial({ map: paneTex, roughness: 0.2, metalness: 0.45 });
    /** Window glass of a lit room: same look by day, warm glow at night (applyTimeOfDay drives emissiveIntensity). */
    const litGlassMat = new THREE.MeshStandardMaterial({ map: paneTex, roughness: 0.2, metalness: 0.45, emissive: '#ffd99a', emissiveMap: paneGlowTex, emissiveIntensity: 0.15 });
    /** Doors from the atlas (steel, wood, roll-up). */
    const doorMat = new THREE.MeshStandardMaterial({ map: doorAtlas, roughness: 0.6, metalness: 0.25 });
    cityMaterials.push(frameMat, trimMat, glassMat, litGlassMat, doorMat);
    emissiveFacadeMaterials.push(litGlassMat);

    const UNIT = new THREE.BoxGeometry(1, 1, 1);
    // Same box without its -z face: for pieces fixed to a wall (that face is never seen).
    const UNIT_ON_WALL = new THREE.BoxGeometry(1, 1, 1);
    UNIT_ON_WALL.setIndex(Array.from(UNIT_ON_WALL.index!.array).slice(0, 30));
    UNIT_ON_WALL.clearGroups();

    // Every piece receives shadows (so all pieces of one material merge into a
    // single batch) and none casts them.
    /** A box of the given size (scaled shared unit box: the batcher bakes the transform). */
    const box = (parent: THREE.Object3D, mat: THREE.Material, w: number, h: number, d: number, x: number, y: number, z: number, onWall = false) => {
        const m = new THREE.Mesh(onWall ? UNIT_ON_WALL : UNIT, mat);
        m.scale.set(w, h, d); m.position.set(x, y, z);
        m.receiveShadow = true;
        parent.add(m);
        return m;
    };
    const wbox = (parent: THREE.Object3D, mat: THREE.Material, w: number, h: number, d: number, x: number, y: number, z: number) => box(parent, mat, w, h, d, x, y, z, true);
    const plane = (parent: THREE.Object3D, mat: THREE.Material, geo: THREE.BufferGeometry, x: number, y: number, z: number) => {
        const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.receiveShadow = true; parent.add(m); return m;
    };
    /** A glass sheet w x h tiled into cols x rows panes. */
    const paneGeo = (w: number, h: number, cols: number, rows: number) => {
        const geo = new THREE.PlaneGeometry(w, h);
        const uv = geo.attributes.uv as THREE.BufferAttribute;
        for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * cols, uv.getY(i) * rows);
        return geo;
    };
    /** A glass box whose four sides are tiled into panes of about cellW x cellH. */
    const glassBox = (parent: THREE.Object3D, mat: THREE.Material, w: number, h: number, d: number, x: number, y: number, z: number, cellW: number, cellH: number) => {
        const m = new THREE.Mesh(boxUVsWorld(new THREE.BoxGeometry(w, h, d), w, h, d, cellW, cellH), mat);
        m.position.set(x, y, z); m.receiveShadow = true; parent.add(m); return m;
    };

    /** Put a facade piece (built facing +z) onto a building face at local (x, y, z). */
    const place = (parent: THREE.Object3D, piece: THREE.Object3D, face: Face, x: number, y: number, z: number) => {
        piece.position.set(x, y, z); piece.rotation.y = FACE_ROT[face]; parent.add(piece); return piece;
    };

    type WindowOpts = { cols?: number; rows?: number; lit?: boolean | number; frame?: number; depth?: number; sill?: boolean; lintel?: boolean; surround?: THREE.Material };
    /** Framed window centred on (0, 0): glass panes, frame, sill and optional lintel. */
    const windowUnit = (w: number, h: number, o: WindowOpts = {}) => {
        const g = new THREE.Group();
        const f = o.frame ?? 0.14, dp = o.depth ?? 0.18;
        const cols = o.cols ?? Math.max(1, Math.round(w / 1.4)), rows = o.rows ?? Math.max(1, Math.round(h / 2.2));
        const lit = typeof o.lit === 'number' ? Math.random() < o.lit : (o.lit ?? Math.random() < 0.5);
        plane(g, lit ? litGlassMat : glassMat, paneGeo(w, h, cols, rows), 0, 0, 0.05);
        const fm = o.surround ?? frameMat;
        wbox(g, fm, w + 2 * f, f, dp, 0, h / 2 + f / 2, dp / 2);
        wbox(g, fm, f, h, dp, -w / 2 - f / 2, 0, dp / 2);
        wbox(g, fm, f, h, dp, w / 2 + f / 2, 0, dp / 2);
        if (o.sill !== false) wbox(g, trimMat, w + 2 * f + 0.3, 0.14, dp + 0.24, 0, -h / 2 - 0.07, (dp + 0.24) / 2);
        else wbox(g, fm, w + 2 * f, f, dp, 0, -h / 2 - f / 2, dp / 2);
        if (o.lintel) wbox(g, trimMat, w + 2 * f + 0.3, 0.26, 0.16, 0, h / 2 + f + 0.13, 0.08);
        return g;
    };
    /** A row of identical windows along a face: `count` windows centred on `along` spaced `step` apart. */
    const windowRow = (parent: THREE.Object3D, face: Face, count: number, step: number, along: number, y: number, surface: number, w: number, h: number, o: WindowOpts = {}) => {
        for (let i = 0; i < count; i++) {
            const a = along + (i - (count - 1) / 2) * step;
            const [x, z] = face === '+z' || face === '-z' ? [a, surface] : [surface, a];
            place(parent, windowUnit(w, h, o), face, x, y, z);
        }
    };

    /** Closed glass double (or single) doors with transom — for buildings you can't walk into. Bottom at y = 0. */
    const glassDoors = (w = 3.4, h = 3.0, o: { leaves?: number; transom?: number; lit?: boolean } = {}) => {
        const g = new THREE.Group();
        const leaves = o.leaves ?? 2, tr = o.transom ?? 0.9, f = 0.16, dp = 0.22;
        const mat = o.lit === false ? glassMat : litGlassMat;
        plane(g, mat, paneGeo(w, h, leaves, 1), 0, h / 2, 0.06);
        if (tr > 0) plane(g, mat, paneGeo(w, tr, leaves, 1), 0, h + f + tr / 2, 0.06);
        wbox(g, frameMat, w + 2 * f, f, dp, 0, h + f / 2, dp / 2);                       // head
        if (tr > 0) wbox(g, frameMat, w + 2 * f, f, dp, 0, h + tr + f * 1.5, dp / 2);     // top of transom
        const top = h + (tr > 0 ? tr + 2 * f : f);
        wbox(g, frameMat, f, top, dp, -w / 2 - f / 2, top / 2, dp / 2);                   // jambs
        wbox(g, frameMat, f, top, dp, w / 2 + f / 2, top / 2, dp / 2);
        for (let i = 1; i < leaves; i++) wbox(g, frameMat, f * 0.8, h, dp, -w / 2 + (i * w) / leaves, h / 2, dp / 2); // meeting stiles
        wbox(g, frameMat, w, 0.22, dp * 0.8, 0, 0.11, dp * 0.4);                         // bottom rail
        const lw = w / leaves;
        for (let i = 0; i < leaves; i++) wbox(g, trimMat, lw * 0.6, 0.07, 0.1, -w / 2 + lw * (i + 0.5), 1.05, dp + 0.08); // push bars
        return g;
    };

    /** Steel personnel door with frame, step and a small canopy. Bottom at y = 0. */
    const steelDoor = (w = 1.15, h = 2.3, o: { canopy?: boolean; step?: boolean; wood?: boolean } = {}) => {
        const g = new THREE.Group();
        plane(g, doorMat, remapUV(new THREE.PlaneGeometry(w, h), o.wood ? ATLAS_WOOD : ATLAS_STEEL), 0, h / 2, 0.05);
        const f = 0.14, dp = 0.2;
        wbox(g, frameMat, w + 2 * f, f, dp, 0, h + f / 2, dp / 2);
        wbox(g, frameMat, f, h + f, dp, -w / 2 - f / 2, (h + f) / 2, dp / 2);
        wbox(g, frameMat, f, h + f, dp, w / 2 + f / 2, (h + f) / 2, dp / 2);
        if (o.canopy !== false) wbox(g, frameMat, w + 1.0, 0.14, 1.2, 0, h + 0.5, 0.6);
        if (o.step !== false) wbox(g, trimMat, w + 1.0, 0.16, 1.0, 0, 0.08, 0.5);
        return g;
    };

    /** Roll-up (sectional) door with guide rails and the coil housing. Bottom at y = 0. */
    const rollupDoor = (w: number, h: number) => {
        const g = new THREE.Group();
        plane(g, doorMat, remapUV(new THREE.PlaneGeometry(w, h), ATLAS_ROLLUP), 0, h / 2, 0.04);
        wbox(g, frameMat, 0.28, h, 0.26, -w / 2 - 0.14, h / 2, 0.13);
        wbox(g, frameMat, 0.28, h, 0.26, w / 2 + 0.14, h / 2, 0.13);
        wbox(g, frameMat, w + 0.7, 0.7, 0.45, 0, h + 0.35, 0.22);
        return g;
    };

    /** An opened door leaf hinged at the origin, swung `angle` (radians) about y. Leaf spans +x. */
    const openLeaf = (w: number, h: number, angle: number, glass: THREE.Material | null, wood = false) => {
        const pivot = new THREE.Group();
        const leaf = new THREE.Group(); leaf.position.x = w / 2; pivot.add(leaf);
        if (glass) {
            const f = 0.12;
            box(leaf, glass, w - 2 * f, h - 2 * f, 0.04, 0, h / 2, 0); // a thin box: seen from both sides
            box(leaf, frameMat, w, f, 0.09, 0, h - f / 2, 0);
            box(leaf, frameMat, w, f * 1.8, 0.09, 0, f * 0.9, 0);
            box(leaf, frameMat, f, h, 0.09, -w / 2 + f / 2, h / 2, 0);
            box(leaf, frameMat, f, h, 0.09, w / 2 - f / 2, h / 2, 0);
            box(leaf, trimMat, 0.05, 1.0, 0.2, w / 2 - 0.3, 1.1, 0);                    // pull handle
        } else {
            const m = new THREE.Mesh(remapUV(new THREE.BoxGeometry(w, h, 0.09), wood ? ATLAS_WOOD : ATLAS_STEEL), doorMat);
            m.position.y = h / 2; leaf.add(m);
        }
        pivot.rotation.y = angle;
        return pivot;
    };

    return { frameMat, trimMat, glassMat, litGlassMat, doorMat, box, plane, paneGeo, glassBox, place, windowUnit, windowRow, glassDoors, steelDoor, rollupDoor, openLeaf };
}

export type ArchitectureKit = ReturnType<typeof createArchitectureKit>;
