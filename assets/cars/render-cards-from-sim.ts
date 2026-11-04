import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { buildCarModel, applyCarPaint, carFrameTick } from '../../micar-merge/work/micar/apps/sim/src/scene/carModel';
import { CAR_STYLES, stepStyle } from '../../micar-merge/work/micar/apps/sim/src/scene/car/carStyles';
import { stepCarAtlas } from '../../micar-merge/work/micar/apps/sim/src/scene/car/carAtlas';
// Card art straight from the sim's own car geometry: the garage look (dark floor, blue tubes), 3/4 front, portrait.
const W = 880, H = 960;
const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setSize(W, H); renderer.shadowMap.enabled = true; renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.1;
document.body.appendChild(renderer.domElement);
const scene = new THREE.Scene(); scene.background = new THREE.Color('#0b1020');
const pm = new THREE.PMREMGenerator(renderer); scene.environment = pm.fromScene(new RoomEnvironment(), 0.04).texture;
const floor = new THREE.Mesh(new THREE.PlaneGeometry(400, 400), new THREE.MeshPhysicalMaterial({ color: '#0d1422', roughness: 0.25, metalness: 0, clearcoat: 0.6 })); floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; scene.add(floor);
const key = new THREE.DirectionalLight('#fff4e0', 1.6); key.position.set(40, 50, 30); key.castShadow = true; key.shadow.mapSize.set(2048, 2048); Object.assign(key.shadow.camera, { left: -30, right: 30, top: 30, bottom: -30 }); scene.add(key);
scene.add(new THREE.HemisphereLight('#8fb3ff', '#101010', 0.5));
const tubeMat = new THREE.MeshStandardMaterial({ color: '#ffffff', emissive: '#bcd6ff', emissiveIntensity: 6 });
[[-16, 0], [16, 0]].forEach(([x]) => { const t = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 12, 12), tubeMat); t.position.set(x, 7, -14); scene.add(t); const l = new THREE.PointLight('#8fb3ff', 60, 60); l.position.copy(t.position); scene.add(l); });
const cam = new THREE.PerspectiveCamera(34, W / H, 0.1, 500);
const style = new URLSearchParams(location.search).get('style') || 'truck';
(async () => {
  for (let i = 0; i < 2000; i++) { carFrameTick(); let busy = false; for (const s of CAR_STYLES) if (stepStyle(s)) busy = true; if (stepCarAtlas()) busy = true; if (!busy) break; }
  const a = buildCarModel(style, '#cfd6e0', 100, 100) as any; applyCarPaint(a.body, '#cfd6e0', 100, false);
  a.group.rotation.y = 0; scene.add(a.group);
  const box = new THREE.Box3().setFromObject(a.group); const c = box.getCenter(new THREE.Vector3()); const L = box.max.z - box.min.z;
  cam.position.set(c.x - L * 1.25, c.y + L * 0.55, c.z - L * 1.75); cam.lookAt(c.x, c.y * 0.8, c.z);
  renderer.render(scene, cam); (window as any).__done = { style, size: box.getSize(new THREE.Vector3()).toArray().map(v => +v.toFixed(1)) };
})().catch(e => { (window as any).__done = { error: String(e) }; });
