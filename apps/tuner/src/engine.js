// Sprite-turntable compositor. Mirrors 3DTuning's rendering model:
// discrete rotation frames, one cropped layer image per part per frame (positioned at an x/y offset on a fixed
// 1440x900 stage), per-frame z-ordering, runtime recolouring of paintable layers, pixel-shift suspension, CSS zoom.
export const STAGE = { w: 1440, h: 900 };

const FINISHES = {
  glossy:   { label: 'Glossy',   diff: 1.00, spec: 0.70, gray: 0.00 },
  matte:    { label: 'Matte',    diff: 0.96, spec: 0.12, gray: 0.00 },
  satin:    { label: 'Satin',    diff: 0.98, spec: 0.35, gray: 0.00 },
  metallic: { label: 'Metallic', diff: 0.92, spec: 1.10, gray: 0.10 },
  pearl:    { label: 'Pearl',    diff: 1.08, spec: 0.75, gray: 0.15 },
  candy:    { label: 'Candy',    diff: 0.80, spec: 1.20, gray: 0.00 },
  chrome:   { label: 'Chrome',   diff: 0.45, spec: 2.20, gray: 0.55 },
};
export { FINISHES };

export function hexToRgb(hex) { const h = hex.replace('#', ''); return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)]; }
export function rgbToHex(r, g, b) { return '#' + [r, g, b].map(v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join(''); }

export class Engine {
  constructor(canvas, manifest, base = 'assets/sprites/') {
    this.canvas = canvas; this.ctx = canvas.getContext('2d');
    canvas.width = STAGE.w; canvas.height = STAGE.h;
    this.m = manifest; this.base = base;
    this.frameCount = manifest.frameCount;
    this.images = new Map();   // key -> HTMLImageElement (loaded) | Promise
    this.tintCache = new Map(); // key -> canvas
    this.state = {
      frame: manifest.startFrame || 0,
      config: { ...manifest.defaultConfig },
      paint: { exterior: { color: '#bc1d17', finish: 'glossy' }, interior: { color: '#2b2b2e', finish: 'matte' }, wheels: { color: '#c9ccd1', finish: 'metallic' } },
      partPaint: {}, // configKey -> {color, finish} overrides within a zone
      tint: 0.25, suspension: 0, zoom: 1,
      lights: false, underglow: { on: false, color: '#2fd4ff' }, wheelNeon: { on: false, color: '#ff2fb0' }, rockLights: false,
      before: false,
    };
    this.onProgress = null; this.dirty = true;
  }

  // ---------- active parts & ordering ----------
  partsMeta() { return this.m.partsMeta; }
  isActive(meta, config) {
    if (config[meta.configKey] !== meta.variant) return false;
    if (meta.requires) for (const [k, v] of Object.entries(meta.requires)) if (config[k] !== v) return false;
    return true;
  }
  activeParts(config = this.state.config) {
    const out = [];
    for (const id in this.m.partsMeta) { const p = this.m.partsMeta[id]; if (!this.m.parts[id]) continue; if (this.isActive(p, config)) out.push(p); }
    return out;
  }
  // Order rules (see REBUILD.md): ground -> far wheels -> core (exact) -> peripheral & near wheels by depth.
  orderFor(frameIdx, parts) {
    const f = this.m.frames[frameIdx]; const depth = f.depth, core = f.coreDepth;
    const key = p => { const d = depth[p.id] ?? 0;
      if (p.group === 'ground') return -1000 + d;
      if (p.group === 'core') return core - 0.0005;           // all core at the same slot, exact among themselves
      if (p.group === 'wheels') return d < core ? d - 0.001 : Math.max(d, core + 0.0001);
      return Math.max(d, core + 0.0002);                        // peripheral always after core
    };
    return parts.slice().sort((a, b) => key(a) - key(b));
  }

  // ---------- images ----------
  layerInfo(id, layer, frame) { const p = this.m.parts[id]; if (!p) return null; const fr = p.frames[frame]; return fr && fr[layer] ? fr[layer] : null; }
  imgKey(id, layer, frame) { return `${id}/${layer}/${frame}`; }
  getImage(id, layer, frame) {
    const info = this.layerInfo(id, layer, frame); if (!info) return null;
    const key = this.imgKey(id, layer, frame); const cached = this.images.get(key);
    if (cached && cached.complete) return cached;
    if (!cached) {
      const img = new Image(); img.decoding = 'async';
      img.src = `${this.base}${id}/${layer}/f${String(frame).padStart(2, '0')}_${info[0]}_${info[1]}.webp`;
      img.onload = () => { this.dirty = true; };
      this.images.set(key, img);
    }
    return null;
  }
  // Preload all layers of the active parts for a frame; resolves when loaded.
  preloadFrame(frame, parts = this.activeParts()) {
    const waits = [];
    for (const p of parts) for (const layer of this.layersOf(p)) {
      const info = this.layerInfo(p.id, layer, frame); if (!info) continue;
      const key = this.imgKey(p.id, layer, frame); let img = this.images.get(key);
      if (!img) { this.getImage(p.id, layer, frame); img = this.images.get(key); }
      if (img && !img.complete) waits.push(new Promise(r => { img.addEventListener('load', r, { once: true }); img.addEventListener('error', r, { once: true }); }));
    }
    return Promise.all(waits);
  }
  // Coarse-first preload (every 4th frame, then every 2nd, then the rest) — the same strategy the original uses
  // (its a0000, a0004, a0008… layers arrive first) so a rough turntable is available within seconds.
  async preloadAll(onProgress) {
    const active = this.activeParts(); const all = Object.values(this.m.partsMeta).filter(p => this.m.parts[p.id]);
    const order = []; const seen = new Set();
    for (const step of [4, 2, 1]) for (let f = 0; f < this.frameCount; f += step) if (!seen.has(f)) { seen.add(f); order.push(f); }
    let done = 0; const total = order.length * 2;
    for (const f of order) { await this.preloadFrame(f, active); done++; onProgress && onProgress(done / total); }
    for (const f of order) { await this.preloadFrame(f, all); done++; onProgress && onProgress(done / total); }
  }
  frameReady(frame, parts = this.activeParts(this.effectiveConfig())) {
    if (!this.m.frames[frame]) return false;
    for (const p of parts) for (const layer of this.layersOf(p)) { const info = this.layerInfo(p.id, layer, frame); if (!info) continue; const img = this.images.get(this.imgKey(p.id, layer, frame)); if (!img || !img.complete || !img.naturalWidth) return false; }
    return true;
  }
  nearestReady(frame) {
    const n = this.frameCount; if (this.frameReady(frame)) return frame;
    for (let d = 1; d < n; d++) { const a = (frame + d) % n, b = (frame - d + n) % n; if (this.frameReady(a)) return a; if (this.frameReady(b)) return b; }
    return null;
  }
  layersOf(p) { const pm = this.m.parts[p.id]; if (!pm) return []; const any = Object.values(pm.frames)[0] || {}; return Object.keys(any); }

  // ---------- paint ----------
  zoneOf(p) { return p.zone || 'exterior'; }
  paintFor(p) { const s = this.state; const o = s.partPaint[p.configKey]; return o || s.paint[this.zoneOf(p)]; }
  tinted(id, frame, color, finish, specGain) {
    const key = `${id}/${frame}/${color}/${finish}`; const hit = this.tintCache.get(key); if (hit) return hit;
    const dimg = this.getImage(id, 'diffuse', frame); if (!dimg) return null;
    const F = FINISHES[finish] || FINISHES.glossy; let [r, g, b] = hexToRgb(color);
    const lum = 0.299 * r + 0.587 * g + 0.114 * b; r = r + (lum - r) * F.gray; g = g + (lum - g) * F.gray; b = b + (lum - b) * F.gray;
    const c = document.createElement('canvas'); c.width = dimg.width; c.height = dimg.height; const x = c.getContext('2d');
    x.drawImage(dimg, 0, 0);
    x.globalCompositeOperation = 'multiply'; x.fillStyle = rgbToHex(r * F.diff, g * F.diff, b * F.diff); x.fillRect(0, 0, c.width, c.height);
    if (F.diff > 1) { x.globalCompositeOperation = 'lighter'; x.globalAlpha = Math.min(1, F.diff - 1); x.drawImage(dimg, 0, 0); x.globalAlpha = 1; }
    x.globalCompositeOperation = 'destination-in'; x.drawImage(dimg, 0, 0);
    x.globalCompositeOperation = 'source-over';
    if (this.tintCache.size > 1500) this.tintCache.clear();
    this.tintCache.set(key, c); return c;
  }
  glowCanvas(id, frame, color, soft) {
    const key = `glow/${id}/${frame}/${color}/${soft}`; const hit = this.tintCache.get(key); if (hit) return hit;
    const img = this.getImage(id, 'glow', frame); if (!img) return null;
    const b = soft ? 26 : 10; const c = document.createElement('canvas'); c.width = img.width + b * 2; c.height = img.height + b * 2; const x = c.getContext('2d');
    // tinted sharp copy
    const t = document.createElement('canvas'); t.width = img.width; t.height = img.height; const tx = t.getContext('2d');
    tx.drawImage(img, 0, 0); tx.globalCompositeOperation = 'multiply'; tx.fillStyle = color; tx.fillRect(0, 0, t.width, t.height); tx.globalCompositeOperation = 'destination-in'; tx.drawImage(img, 0, 0);
    x.filter = `blur(${b * 0.5}px)`; x.globalAlpha = soft ? 0.9 : 0.8; x.drawImage(t, b, b);
    x.filter = `blur(${b}px)`; x.globalAlpha = 0.7; x.drawImage(t, b, b);
    x.filter = 'none'; x.globalAlpha = soft ? 0.5 : 1; x.drawImage(t, b, b);
    c.pad = b; this.tintCache.set(key, c); return c;
  }

  // ---------- render ----------
  effectiveConfig() { return this.state.before ? { ...this.m.defaultConfig } : this.state.config; }
  render() {
    const s = this.state, ctx = this.ctx, want = ((Math.round(s.frame) % this.frameCount) + this.frameCount) % this.frameCount;
    const config = this.effectiveConfig();
    // Never composite a half-loaded frame: show the nearest fully loaded one and keep loading the wanted frame.
    let frame = want;
    if (!this.frameReady(want)) { this.preloadFrame(want).then(() => { this.dirty = true; }); const nr = this.nearestReady(want); if (nr === null) return 1; frame = nr; }
    this.shownFrame = frame;
    const parts = this.orderFor(frame, this.activeParts(config));
    ctx.clearRect(0, 0, STAGE.w, STAGE.h);
    const lift = s.before ? 0 : s.suspension; // px; body group moves up, wheels/ground stay
    let missing = 0;
    for (const p of parts) {
      const isGlow = this.layersOf(p).includes('glow');
      if (isGlow) {
        if (s.before) continue;
        if (p.configKey === 'underglow' && !s.underglow.on) continue;
        if (p.configKey === 'wheel_neon' && !s.wheelNeon.on) continue;
        if (p.configKey.endsWith('_glow') && !s.lights) continue;
      }
      const dy = (p.group === 'wheels' || p.group === 'ground') ? 0 : -lift;
      const fr = this.m.parts[p.id].frames[frame]; if (!fr) continue;
      if (p.paintable && fr.diffuse) {
        const paint = s.before ? (this.zoneOf(p) === 'interior' ? { color: '#2b2b2e', finish: 'matte' } : this.zoneOf(p) === 'wheels' ? { color: '#c9ccd1', finish: 'metallic' } : { color: '#d9dadc', finish: 'glossy' }) : this.paintFor(p);
        const F = FINISHES[paint.finish] || FINISHES.glossy;
        const tc = this.tinted(p.id, frame, paint.color, paint.finish); if (tc) ctx.drawImage(tc, fr.diffuse[0], fr.diffuse[1] + dy); else missing++;
        const simg = fr.spec && this.getImage(p.id, 'spec', frame);
        if (simg) { ctx.globalCompositeOperation = 'lighter'; let gain = F.spec; while (gain > 0) { ctx.globalAlpha = Math.min(1, gain); ctx.drawImage(simg, fr.spec[0], fr.spec[1] + dy); gain -= 1; } ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over'; }
        const limg = fr.lit && this.getImage(p.id, 'lit', frame); if (limg) ctx.drawImage(limg, fr.lit[0], fr.lit[1] + dy);
      } else if (fr.glass) {
        const g = this.getImage(p.id, 'glass', frame); if (g) ctx.drawImage(g, fr.glass[0], fr.glass[1] + dy); else missing++;
        const mk = fr.glassMask && this.getImage(p.id, 'glassMask', frame);
        if (mk && s.tint > 0) { ctx.globalAlpha = Math.min(0.92, s.tint * 0.92); ctx.drawImage(mk, fr.glassMask[0], fr.glassMask[1] + dy); ctx.globalAlpha = 1; }
      } else if (fr.glow) {
        const color = p.configKey === 'underglow' ? s.underglow.color : p.configKey === 'wheel_neon' ? s.wheelNeon.color : p.glowColor ? '#' + p.glowColor : '#fff6d8';
        const gc = this.glowCanvas(p.id, frame, color, p.softGlow); if (!gc) { missing++; continue; }
        ctx.globalCompositeOperation = 'lighter'; ctx.drawImage(gc, fr.glow[0] - gc.pad, fr.glow[1] + dy - gc.pad); ctx.globalCompositeOperation = 'source-over';
      } else if (fr.lit) {
        const img = this.getImage(p.id, 'lit', frame); if (img) ctx.drawImage(img, fr.lit[0], fr.lit[1] + dy); else missing++;
      }
    }
    if (s.rockLights && !s.before) { // warm pools of light under each wheel (hub positions from the manifest)
      const hubs = this.m.frames[frame].hubs; ctx.globalCompositeOperation = 'lighter';
      for (const [x, y] of Object.values(hubs)) { const g = ctx.createRadialGradient(x, y + 70, 10, x, y + 70, 150); g.addColorStop(0, 'rgba(255,214,150,0.55)'); g.addColorStop(1, 'rgba(255,214,150,0)'); ctx.fillStyle = g; ctx.beginPath(); ctx.ellipse(x, y + 70, 150, 60, 0, 0, Math.PI * 2); ctx.fill(); }
      ctx.globalCompositeOperation = 'source-over';
    }
    if (missing > 0) this.preloadFrame(frame).then(() => { this.dirty = true; });
    return missing;
  }

  // Render a part (or list of parts) alone into a small canvas — used for category/variant icons.
  renderIcon(ids, frame, w, h, pad = 6) {
    const c = document.createElement('canvas'); c.width = w; c.height = h; const x = c.getContext('2d');
    const boxes = [];
    for (const id of ids) { const fr = this.m.parts[id] && this.m.parts[id].frames[frame]; if (!fr) continue; for (const L of Object.values(fr)) boxes.push(L); }
    if (!boxes.length) return c;
    const x0 = Math.min(...boxes.map(b => b[0])), y0 = Math.min(...boxes.map(b => b[1])), x1 = Math.max(...boxes.map(b => b[0] + b[2])), y1 = Math.max(...boxes.map(b => b[1] + b[3]));
    const sc = Math.min((w - pad * 2) / (x1 - x0), (h - pad * 2) / (y1 - y0));
    x.translate((w - (x1 - x0) * sc) / 2, (h - (y1 - y0) * sc) / 2); x.scale(sc, sc); x.translate(-x0, -y0);
    for (const id of ids) {
      const p = this.m.partsMeta[id]; const fr = this.m.parts[id].frames[frame]; if (!fr) continue;
      if (fr.diffuse) { const paint = this.paintFor(p); const tc = this.tinted(id, frame, paint.color, paint.finish); if (tc) x.drawImage(tc, fr.diffuse[0], fr.diffuse[1]); const simg = fr.spec && this.getImage(id, 'spec', frame); if (simg) { x.globalCompositeOperation = 'lighter'; x.drawImage(simg, fr.spec[0], fr.spec[1]); x.globalCompositeOperation = 'source-over'; } }
      if (fr.lit) { const img = this.getImage(id, 'lit', frame); if (img) x.drawImage(img, fr.lit[0], fr.lit[1]); }
      if (fr.glass) { const img = this.getImage(id, 'glass', frame); if (img) x.drawImage(img, fr.glass[0], fr.glass[1]); }
    }
    return c;
  }
  // Composite the current view onto a canvas with the background for snapshots.
  snapshot(bgImage) {
    const c = document.createElement('canvas'); c.width = STAGE.w; c.height = STAGE.h; const x = c.getContext('2d');
    if (bgImage) x.drawImage(bgImage, 0, 0, STAGE.w, STAGE.h);
    const z = this.state.zoom; x.translate(STAGE.w / 2, STAGE.h / 2); x.scale(z, z); x.translate(-STAGE.w / 2, -STAGE.h / 2);
    x.drawImage(this.canvas, 0, 0); return c;
  }
}
