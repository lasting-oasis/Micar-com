import * as THREE from 'three';

// Procedural car models and paint (colour names, rust, mud).

// Map the game's colour names to real colours.
export const carColorHex = (c?: string) => {
    if (c === 'Trade-In Silver') return '#C0C0C0';
    if (c === 'Repo Gray') return '#808080';
    return c || '#4b5563';
};
export const RUST_COLOR = new THREE.Color('#8b4513');
export const MUD_COLOR = new THREE.Color('#5c4033');
// Body paint: thick mud when dirty, otherwise the paint colour, tinted toward
// rust and dulled when the body is badly damaged.
export const applyCarPaint = (mat: THREE.MeshStandardMaterial, hex: string, bodyCond: number, dirty: boolean) => {
    if (dirty) { mat.color.copy(MUD_COLOR); mat.roughness = 1.0; mat.metalness = 0.1; return; }
    mat.color.set(hex);
    if (bodyCond < 50) {
        mat.color.lerp(RUST_COLOR, 1 - (bodyCond / 50));
        mat.roughness = 0.9; mat.metalness = 0.1;
    } else {
        mat.roughness = 0.2; mat.metalness = 0.6;
    }
};
// Fallback body style for legacy/customer cars that have no bodyStyle set.
export const deriveStyle = (model: string) => {
    const m = (model || '').toLowerCase();
    if (/f-150|silverado|tacoma|tundra|ranger|colorado|ridgeline|truck|pickup/.test(m)) return 'truck';
    if (/rav4|cr-v|explorer|tahoe|x5|x3|pilot|equinox|escape|suv/.test(m)) return 'suv';
    if (/mustang|camaro|corvette|supra|\bz4\b|sport/.test(m)) return 'sports';
    if (/\bm4\b|4 series|coupe/.test(m)) return 'coupe';
    if (/prius|\bfit\b|focus|hatch/.test(m)) return 'hatchback';
    if (/sienna|odyssey|\bvan\b/.test(m)) return 'van';
    return 'sedan';
};

export const buildCarModel = (style: string, rawColor: string, bodyCond: number = 100, mechCond: number = 100) => {
     const group = new THREE.Group();
     group.userData.dynamic = true;

     // Paint with rust for a damaged body (see applyCarPaint)
     const bodyMat = new THREE.MeshStandardMaterial();
     applyCarPaint(bodyMat, rawColor, bodyCond, false);
     const glassMat = new THREE.MeshStandardMaterial({ color: '#1e293b', metalness: 0.9, roughness: 0.1, transparent: true, opacity: bodyCond < 40 ? 0.3 : 0.8 });
     const rubberMat = new THREE.MeshStandardMaterial({ color: '#111111', roughness: 0.9 });
     const chromeMat = new THREE.MeshStandardMaterial({ color: '#e2e8f0', metalness: 1.0, roughness: bodyCond < 50 ? 0.8 : 0.2 });

     // Per-body-style silhouette: dimensions, cab placement, optional bed
     const STYLES: Record<string, { w: number; len: number; chH: number; yOff: number; cabH: number; cabFrac: number; cabZ: number; wR: number; bed?: boolean }> = {
         sedan:     { w: 4.0, len: 9.0,  chH: 1.5, yOff: 1.0,  cabH: 1.8,  cabFrac: 0.5,  cabZ: -0.6, wR: 0.8 },
         coupe:     { w: 4.0, len: 8.6,  chH: 1.3, yOff: 0.95, cabH: 1.5,  cabFrac: 0.4,  cabZ: -1.3, wR: 0.85 },
         hatchback: { w: 3.7, len: 7.8,  chH: 1.5, yOff: 0.95, cabH: 1.95, cabFrac: 0.55, cabZ: -0.9, wR: 0.78 },
         suv:       { w: 4.5, len: 10.0, chH: 2.0, yOff: 1.4,  cabH: 2.4,  cabFrac: 0.62, cabZ: -0.2, wR: 1.15 },
         truck:     { w: 4.6, len: 11.0, chH: 1.9, yOff: 1.4,  cabH: 2.3,  cabFrac: 0.32, cabZ: 2.2,  wR: 1.2, bed: true },
         sports:    { w: 4.2, len: 9.4,  chH: 1.0, yOff: 0.7,  cabH: 1.3,  cabFrac: 0.38, cabZ: -0.9, wR: 0.95 },
         van:       { w: 4.4, len: 10.6, chH: 2.5, yOff: 1.45, cabH: 2.7,  cabFrac: 0.8,  cabZ: 0.3,  wR: 1.0 },
     };
     const cfg = STYLES[style] || STYLES.sedan;
     const width = cfg.w;
     const length = cfg.len;
     const chassisH = cfg.chH;
     const yOff = cfg.yOff;

     const chassisGeo = new THREE.BoxGeometry(width, chassisH, length);
     const chassis = new THREE.Mesh(chassisGeo, bodyMat);
     chassis.position.y = yOff;
     chassis.castShadow = true;
     chassis.receiveShadow = true;
     group.add(chassis);

     const cabW = width * 0.9;
     const cabL = length * cfg.cabFrac;
     const cabH = cfg.cabH;
     const cabZ = cfg.cabZ;
     const cabGeo = new THREE.BoxGeometry(cabW, cabH, cabL);
     const cab = new THREE.Mesh(cabGeo, glassMat);
     cab.position.set(0, yOff + (chassisH / 2) + (cabH / 2), cabZ);
     group.add(cab);

     // Pickup bed: open cargo box behind the cab (side rails + tailgate)
     if (cfg.bed) {
         const bedLen = length * 0.42;
         const bedZ = -length / 2 + bedLen / 2 + 0.4;
         const railH = 0.85;
         const railY = yOff + chassisH / 2 + railH / 2;
         [-1, 1].forEach(sx => {
             const rail = new THREE.Mesh(new THREE.BoxGeometry(0.3, railH, bedLen), bodyMat);
             rail.position.set(sx * (width / 2 - 0.15), railY, bedZ); rail.castShadow = true; group.add(rail);
         });
         const tail = new THREE.Mesh(new THREE.BoxGeometry(width, railH, 0.3), bodyMat);
         tail.position.set(0, railY, bedZ - bedLen / 2); tail.castShadow = true; group.add(tail);
     }

     const wR = cfg.wR;
     const wD = wR * 0.8;
     const wheelGeo = new THREE.CylinderGeometry(wR, wR, wD, 16);
     wheelGeo.rotateZ(Math.PI / 2);

     const wPos = [
         { x: -width/2, z: length/2 - 1.5 }, { x: width/2,  z: length/2 - 1.5 },
         { x: -width/2, z: -length/2 + 2 },  { x: width/2,  z: -length/2 + 2 }
     ];

     const wheels: THREE.Mesh[] = [];
     const frontPivots: THREE.Group[] = [];
     wPos.forEach((p, idx) => {
         const wheelPivot = new THREE.Group();
         wheelPivot.position.set(p.x, wR, p.z);
         
         const wheel = new THREE.Mesh(wheelGeo, rubberMat);
         wheel.castShadow = true;
         
         const hubGeo = new THREE.CylinderGeometry(wR*0.6, wR*0.6, wD+0.1, 8);
         hubGeo.rotateZ(Math.PI / 2);
         const hub = new THREE.Mesh(hubGeo, chromeMat);
         wheel.add(hub);

         wheelPivot.add(wheel);
         group.add(wheelPivot);
         wheels.push(wheel);
         if (idx < 2) frontPivots.push(wheelPivot);
     });

     const hlM = new THREE.MeshStandardMaterial({ color: '#ffffff', emissive: '#ffffff', emissiveIntensity: 2.0 });
     const hlG = new THREE.BoxGeometry(1, 0.4, 0.2);
     const hl1 = new THREE.Mesh(hlG, hlM); hl1.position.set(-width/2 + 0.8, yOff + 0.5, length/2 + 0.01); group.add(hl1);
     const hl2 = new THREE.Mesh(hlG, hlM); hl2.position.set(width/2 - 0.8, yOff + 0.5, length/2 + 0.01); group.add(hl2);

     const tlM = new THREE.MeshStandardMaterial({ color: '#ef4444', emissive: '#dc2626', emissiveIntensity: 2.0 });
     const tl1 = new THREE.Mesh(hlG, tlM); tl1.position.set(-width/2 + 0.8, yOff + 0.5, -length/2 - 0.01); group.add(tl1);
     const tl2 = new THREE.Mesh(hlG, tlM); tl2.position.set(width/2 - 0.8, yOff + 0.5, -length/2 - 0.01); group.add(tl2);

     // Smoke particle system for poor mechanical condition. Always built but
     // its visibility tracks the car's CURRENT condition, so it clears on a
     // repair (and reappears if the car is damaged again later).
     const partGeo = new THREE.BufferGeometry();
     const partCount = 50;
     const pPos = new Float32Array(partCount * 3);
     for (let i = 0; i < partCount * 3; i++) pPos[i] = (Math.random() - 0.5) * 2;
     partGeo.setAttribute('position', new THREE.BufferAttribute(pPos, 3));
     const partMat = new THREE.PointsMaterial({ color: 0x888888, size: 0.8, transparent: true, opacity: 0.4 });
     const smokeParticles = new THREE.Points(partGeo, partMat);
     smokeParticles.position.set(0, yOff + chassisH, length / 2 - 1); // Hood position
     smokeParticles.visible = mechCond < 50;
     group.add(smokeParticles);

     return { group, wheels, body: chassis, frontPivots, smokeParticles };
};
