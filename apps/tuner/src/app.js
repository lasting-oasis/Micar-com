import { Engine, FINISHES, STAGE, hexToRgb, rgbToHex } from './engine.js';
import { CATEGORIES, PACKS, FACTORY_COLORS, INTERIOR_COLORS, WHEEL_COLORS, FINISH_ORDER, ZONE_PARTS, FILTERS } from './catalog.js';

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const app = $('#app');

// ---------- boot ----------
const manifest = await (await fetch('assets/sprites/manifest.json')).json();
const engine = new Engine($('#car'), manifest, 'assets/sprites/');
const S = engine.state;
const ui = { zone: 'exterior', partKey: null, swatchPage: 0, category: null, mode: 'finishes', autoRotate: true, sounds: true, fast: false, transform: true, filter: 'none', lastInteraction: 0, pan: { x: 0, y: 0 } };
let bgImage = null; { const i = new Image(); i.src = 'assets/bg/garage.jpg'; i.onload = () => { bgImage = i; }; }

restoreFromHash();
await engine.preloadFrame(S.frame);
engine.render();
$('#loaderPct').textContent = '100%'; $('#loaderBar').style.width = '100%';
setTimeout(() => $('#loader').classList.add('done'), 250);
const pill = $('#preloadPill'); pill.hidden = false;
engine.preloadAll(p => { const el = $('#preloadPct'); if (el) el.textContent = Math.round(p * 100) + '%'; if (p >= 1) pill.hidden = true; });

// ---------- render loop ----------
let needsRender = true;
function invalidate() { needsRender = true; }
function loop(t) {
  if (ui.autoRotate && !drag.active && t - ui.lastInteraction > 2500 && !S.before) {
    if (!loop.last || t - loop.last > 140) { // advance to the next fully loaded frame (skips frames still caching)
      for (let d = 1; d < engine.frameCount; d++) { const f = (S.frame + d) % engine.frameCount; if (engine.frameReady(f)) { S.frame = f; break; } }
      loop.last = t; needsRender = true;
    }
  }
  if (needsRender || engine.dirty) { engine.dirty = false; engine.render(); needsRender = false; }
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);

// ---------- stage: drag to rotate / pan, wheel to zoom ----------
const stageWrap = $('#stageWrap'), stage = $('#stage');
const drag = { active: false, x0: 0, y0: 0, f0: 0, moved: 0 };
function applyStageTransform() {
  // Like the original: the 1440x900 stage stays 1:1 and is cropped vertically (shifted up so the wheels clear the
  // bottom panel); it only scales down when the viewport is narrower than the stage.
  const fit = Math.min(1, stageWrap.clientWidth / STAGE.w);
  const lift = Math.max(0, Math.min(60, (STAGE.h * fit - stageWrap.clientHeight) / 2 + 10));
  stage.style.transform = `translate(${ui.pan.x}px, ${ui.pan.y - lift}px) scale(${(fit * S.zoom).toFixed(3)})`;
  $('#stageBg').style.filter = ui.filter === 'none' ? '' : FILTERS.find(f => f.id === ui.filter).css;
  stage.style.filter = $('#stageBg').style.filter;
}
window.addEventListener('resize', applyStageTransform); applyStageTransform();
stageWrap.addEventListener('pointerdown', e => { if (e.button !== 0) return; drag.active = true; drag.x0 = e.clientX; drag.y0 = e.clientY; drag.f0 = S.frame; drag.moved = 0; drag.px = ui.pan.x; drag.py = ui.pan.y; stageWrap.setPointerCapture(e.pointerId); stageWrap.classList.add('dragging'); $('#dragHint').classList.add('hide'); });
stageWrap.addEventListener('pointermove', e => {
  if (!drag.active) return; const dx = e.clientX - drag.x0, dy = e.clientY - drag.y0; drag.moved = Math.max(drag.moved, Math.abs(dx) + Math.abs(dy));
  if (ui.transform) { const pxPerFrame = ui.fast ? 24 : 12; const f = drag.f0 - dx / pxPerFrame; S.frame = ((Math.round(f) % engine.frameCount) + engine.frameCount) % engine.frameCount; }
  else { ui.pan.x = drag.px + dx; ui.pan.y = drag.py + dy; applyStageTransform(); }
  ui.lastInteraction = performance.now(); invalidate();
});
const endDrag = e => { if (!drag.active) return; drag.active = false; stageWrap.classList.remove('dragging'); ui.lastInteraction = performance.now(); };
stageWrap.addEventListener('pointerup', endDrag); stageWrap.addEventListener('pointercancel', endDrag);
stageWrap.addEventListener('wheel', e => { e.preventDefault(); S.zoom = Math.min(1.8, Math.max(0.6, S.zoom * (e.deltaY > 0 ? 0.94 : 1.06))); $('#zoom').value = S.zoom; applyStageTransform(); }, { passive: false });
window.addEventListener('keydown', e => { if (e.target.matches('input')) return; if (e.key === 'ArrowLeft') { S.frame = (S.frame + 1) % engine.frameCount; ui.lastInteraction = performance.now(); invalidate(); } if (e.key === 'ArrowRight') { S.frame = (S.frame - 1 + engine.frameCount) % engine.frameCount; ui.lastInteraction = performance.now(); invalidate(); } });

// ---------- sounds (synthesized; no copyrighted audio) ----------
let audio = null, engineNodes = null;
function ac() { if (!audio) audio = new (window.AudioContext || window.webkitAudioContext)(); if (audio.state === 'suspended') audio.resume(); return audio; }
function click() { if (!ui.sounds) return; try { const a = ac(), o = a.createOscillator(), g = a.createGain(); o.type = 'square'; o.frequency.value = 1200; g.gain.setValueAtTime(0.03, a.currentTime); g.gain.exponentialRampToValueAtTime(0.0001, a.currentTime + 0.05); o.connect(g).connect(a.destination); o.start(); o.stop(a.currentTime + 0.06); } catch (e) { } }
function engineStart() {
  if (!ui.sounds) return; const a = ac(); const t = a.currentTime;
  const out = a.createGain(); out.gain.value = 0; out.connect(a.destination);
  const lp = a.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 220; lp.Q.value = 2; lp.connect(out);
  const o1 = a.createOscillator(); o1.type = 'sawtooth'; o1.frequency.value = 38; const o2 = a.createOscillator(); o2.type = 'square'; o2.frequency.value = 76.5;
  const lfo = a.createOscillator(); lfo.frequency.value = 9; const lg = a.createGain(); lg.gain.value = 6; lfo.connect(lg).connect(o1.frequency); lfo.start();
  const noise = a.createBufferSource(); const buf = a.createBuffer(1, a.sampleRate * 2, a.sampleRate); const d = buf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * 0.3; noise.buffer = buf; noise.loop = true; const ng = a.createGain(); ng.gain.value = 0.25; noise.connect(ng).connect(lp);
  o1.connect(lp); const g2 = a.createGain(); g2.gain.value = 0.35; o2.connect(g2).connect(lp); o1.start(); o2.start(); noise.start();
  // crank, then settle to idle
  out.gain.linearRampToValueAtTime(0.22, t + 0.15); o1.frequency.setValueAtTime(18, t); o1.frequency.linearRampToValueAtTime(70, t + 0.9); o1.frequency.exponentialRampToValueAtTime(42, t + 2.2);
  o2.frequency.setValueAtTime(36, t); o2.frequency.linearRampToValueAtTime(140, t + 0.9); o2.frequency.exponentialRampToValueAtTime(84, t + 2.2);
  lp.frequency.setValueAtTime(140, t); lp.frequency.linearRampToValueAtTime(520, t + 0.9); lp.frequency.exponentialRampToValueAtTime(260, t + 2.4);
  engineNodes = { out, stop: () => { const t2 = a.currentTime; out.gain.linearRampToValueAtTime(0, t2 + 0.5); setTimeout(() => { [o1, o2, lfo, noise].forEach(n => { try { n.stop(); } catch (e) { } }); }, 600); } };
}
function engineStop() { if (engineNodes) { engineNodes.stop(); engineNodes = null; } }

// ---------- toggles (right dock) ----------
function setToggle(btn, on, onText = 'On', offText = 'Off') { btn.dataset.on = String(on); btn.querySelector('.tv').textContent = on ? onText : offText; }
$('#tFilters').onclick = () => { click(); setMode(ui.mode === 'filters' ? 'finishes' : 'filters'); };
$('#tBefore').onclick = () => { click(); S.before = !S.before; setToggle($('#tBefore'), S.before); invalidate(); toast(S.before ? 'Showing the factory build (before)' : 'Showing your build (after)'); };
$('#tSounds').onclick = () => { ui.sounds = !ui.sounds; setToggle($('#tSounds'), ui.sounds); if (!ui.sounds) engineStop(); click(); };
$('#tEngine').onclick = () => { click(); const on = $('#tEngine').dataset.on !== 'true'; setToggle($('#tEngine'), on, 'STOP', 'START'); app.classList.toggle('engine-on', on); if (on) { engineStart(); if (!S.lights) { S.lights = true; $('#cLights').classList.add('active'); invalidate(); setTimeout(() => { S.lights = false; $('#cLights').classList.remove('active'); invalidate(); }, 1400); } } else engineStop(); };
$('#tFast').onclick = () => { click(); ui.fast = !ui.fast; setToggle($('#tFast'), ui.fast); };
$('#tTransform').onclick = () => { click(); ui.transform = !ui.transform; setToggle($('#tTransform'), ui.transform); stageWrap.classList.toggle('pan', !ui.transform); if (ui.transform) { ui.pan = { x: 0, y: 0 }; applyStageTransform(); } toast(ui.transform ? 'Drag rotates the car' : 'Drag pans the view (Transform off)'); };

// ---------- modes (left dock + bottom panel) ----------
function setMode(mode) {
  ui.mode = mode; app.dataset.mode = mode;
  $$('.dock-left .opt').forEach(b => b.classList.toggle('sel-elem', b.dataset.mode === mode || (mode === 'variants' && b.dataset.mode === 'parts')));
  setToggle($('#tFilters'), ui.filter !== 'none');
  if (mode === 'parts') renderCategoryStrip();
}
$$('.dock-left .opt').forEach(b => b.onclick = () => { click(); setMode(b.dataset.mode); });

// ---------- colors panel ----------
const colorInput = $('#colorInput');
function currentPaint() { return ui.partKey ? (S.partPaint[ui.partKey] || { ...S.paint[ui.zone] }) : S.paint[ui.zone]; }
function setPaint(patch) {
  if (ui.partKey) S.partPaint[ui.partKey] = { ...currentPaint(), ...patch };
  else { Object.assign(S.paint[ui.zone], patch); for (const k of Object.keys(S.partPaint)) { const p = (ZONE_PARTS[ui.zone] || []).find(z => z.key === k); if (p) delete S.partPaint[k]; } }
  if (ui.zone === 'wheels' && patch.color === 'body') { const c = S.paint.exterior.color; if (ui.partKey) S.partPaint[ui.partKey].color = c; else S.paint.wheels.color = c; S.paint.wheels.linked = !ui.partKey; }
  else if (ui.zone === 'exterior' && patch.color && S.paint.wheels.linked) S.paint.wheels.color = patch.color;
  refreshColorsPanel(); invalidate();
}
function zoneColors() { return ui.zone === 'interior' ? INTERIOR_COLORS : ui.zone === 'wheels' ? WHEEL_COLORS : FACTORY_COLORS; }
function refreshColorsPanel() {
  const p = currentPaint();
  $('#colorHex').textContent = p.color; colorInput.value = p.color;
  $('#finishName').textContent = FINISHES[p.finish].label;
  $$('.p-i-elem', $('#panelFinishes')).forEach(b => b.classList.toggle('selected', b.dataset.zone === ui.zone));
  // swatches page
  const cols = zoneColors(); const per = 6; const pages = Math.ceil(cols.length / per); ui.swatchPage = ui.swatchPage % pages;
  const sw = $('#swatches'); sw.innerHTML = '';
  cols.slice(ui.swatchPage * per, ui.swatchPage * per + per).forEach(c => { const b = document.createElement('button'); b.className = 'swatch' + (c.value === 'body' ? ' body-colour' : '') + (('#' + c.value) === p.color ? ' active' : ''); if (c.value !== 'body') b.style.background = '#' + c.value; b.title = c.name; b.onclick = () => { click(); setPaint({ color: c.value === 'body' ? 'body' : '#' + c.value }); }; sw.appendChild(b); });
  $('#swatchNext').style.visibility = pages > 1 ? 'visible' : 'hidden';
  // finishes
  const fz = $('#finishes'); fz.innerHTML = '';
  FINISH_ORDER.forEach(id => { const b = document.createElement('button'); b.className = 'finish' + (p.finish === id ? ' active' : ''); b.title = FINISHES[id].label; b.appendChild(finishIcon(id, p.color)); b.onclick = () => { click(); setPaint({ finish: id }); }; fz.appendChild(b); });
  // dropdown
  const list = ZONE_PARTS[ui.zone]; $('#partDropdownBtn').firstChild.textContent = (list.find(z => z.key === ui.partKey) || list[0]).label;
  const ul = $('#partDropdownList'); ul.innerHTML = ''; list.forEach(z => { const li = document.createElement('li'); li.textContent = z.label; li.className = z.key === ui.partKey ? 'active' : ''; li.onclick = () => { click(); ui.partKey = z.key; $('#partDropdown').classList.remove('open'); refreshColorsPanel(); }; ul.appendChild(li); });
}
function finishIcon(id, color) {
  const c = document.createElement('canvas'); c.width = 98; c.height = 72; const x = c.getContext('2d'); const F = FINISHES[id];
  let [r, g, b] = hexToRgb(color); const lum = 0.299 * r + 0.587 * g + 0.114 * b; r += (lum - r) * F.gray; g += (lum - g) * F.gray; b += (lum - b) * F.gray;
  const base = rgbToHex(r * F.diff * 0.75, g * F.diff * 0.75, b * F.diff * 0.75);
  x.fillStyle = base; x.fillRect(0, 0, 98, 72);
  const grad = x.createLinearGradient(0, 0, 98, 72); grad.addColorStop(0, `rgba(255,255,255,${Math.min(0.95, 0.12 + 0.3 * F.spec)})`); grad.addColorStop(0.45, 'rgba(255,255,255,0)'); grad.addColorStop(0.55, 'rgba(255,255,255,0)'); grad.addColorStop(1, `rgba(255,255,255,${Math.min(0.8, 0.18 * F.spec)})`);
  x.fillStyle = grad; x.fillRect(0, 0, 98, 72);
  if (id === 'metallic' || id === 'pearl') { for (let i = 0; i < 160; i++) { x.fillStyle = `rgba(255,255,255,${Math.random() * 0.5})`; x.fillRect(Math.random() * 98, Math.random() * 72, 1.5, 1.5); } }
  if (id === 'matte') { x.fillStyle = 'rgba(0,0,0,0.08)'; for (let i = 0; i < 300; i++) x.fillRect(Math.random() * 98, Math.random() * 72, 1, 1); }
  return c;
}
$$('.p-i-elem', $('#panelFinishes')).forEach(b => b.onclick = () => { click(); ui.zone = b.dataset.zone; ui.partKey = null; ui.swatchPage = 0; refreshColorsPanel(); });
$('#swatchNext').onclick = () => { click(); ui.swatchPage++; refreshColorsPanel(); };
$('#partDropdownBtn').onclick = e => { e.stopPropagation(); click(); $('#partDropdown').classList.toggle('open'); };
document.addEventListener('click', e => { if (!e.target.closest('#partDropdown')) $('#partDropdown').classList.remove('open'); if (!e.target.closest('.popover') && !e.target.closest('[data-popover]')) hidePopover(); });
colorInput.addEventListener('input', () => setPaint({ color: colorInput.value }));
$('#manipBtn').dataset.popover = '1';
$('#manipBtn').onclick = e => {
  click(); const p = currentPaint(); const [r, g, b] = hexToRgb(p.color); const hsl = rgbToHsl(r, g, b); const base = { ...hsl };
  showPopover(e.currentTarget, `<label>Brightness <input type="range" id="mB" min="-50" max="50" value="0"></label><label>Saturation <input type="range" id="mS" min="-50" max="50" value="0"></label><label>Hue shift <input type="range" id="mH" min="-180" max="180" value="0"></label>`);
  const upd = () => { const h = (base.h + +$('#mH').value + 360) % 360, s = Math.max(0, Math.min(100, base.s + +$('#mS').value)), l = Math.max(0, Math.min(100, base.l + +$('#mB').value)); setPaint({ color: hslToHex(h, s, l) }); };
  ['#mB', '#mS', '#mH'].forEach(id => $(id).addEventListener('input', upd));
};

// ---------- parts panel ----------
function variantsOf(cat) {
  if (cat.kind === 'packs') return PACKS.map(p => ({ id: p.id, name: p.name, price: p.price, pack: p }));
  const key = cat.keys[0]; const seen = new Set(); const out = [];
  for (const meta of Object.values(manifest.partsMeta)) { if (meta.configKey !== key || seen.has(meta.variant)) continue; seen.add(meta.variant); out.push({ id: meta.variant, name: meta.name, price: meta.price, meta }); }
  return out;
}
function currentVariant(cat) { if (cat.kind === 'packs') { return PACKS.find(p => Object.entries(p.patch).every(([k, v]) => S.config[k] === v))?.id || null; } return S.config[cat.keys[0]]; }
function iconFor(cat, variantId, w, h) {
  const frame = cat.iconFrame;
  if (cat.kind === 'packs') { // whole-car thumbnail of that kit (or the current build for the category tile)
    const pack = PACKS.find(p => p.id === variantId); const cfg = pack ? { ...manifest.defaultConfig, ...pack.patch } : S.config;
    const ids = engine.orderFor(frame, engine.activeParts(cfg)).filter(p => !engine.layersOf(p).includes('glow')).map(p => p.id);
    const c = engine.renderIcon(ids, frame, w, h, 4); const metas = ids.map(id => manifest.partsMeta[id]);
    if (!engine.frameReady(frame, metas)) engine.preloadFrame(frame, metas).then(() => { const d = engine.renderIcon(ids, frame, w, h, 4); const x = c.getContext('2d'); x.setTransform(1, 0, 0, 1, 0, 0); x.clearRect(0, 0, w, h); x.drawImage(d, 0, 0); });
    return c;
  }
  const base = cat.iconParts || cat.keys.slice(0, 1);
  const ids = [];
  for (const k of base) { const metas = Object.values(manifest.partsMeta).filter(m => (m.category === k || m.configKey === k) && m.variant === variantId); for (const m of metas) if (manifest.parts[m.id]) ids.push(m.id); }
  if (cat.id === 'spare_wheel' && variantId === 'mounted') ids.push(`spare/${S.config.tire_fl}`);
  if (cat.id === 'tires') ids.push(`rim_fl/${S.config.rim_fl}`);
  if (!ids.length) { const c = document.createElement('canvas'); c.width = w; c.height = h; const x = c.getContext('2d'); x.strokeStyle = '#bbb'; x.lineWidth = 3; x.beginPath(); x.arc(w / 2, h / 2, 22, 0, Math.PI * 2); x.moveTo(w / 2 - 15, h / 2 + 15); x.lineTo(w / 2 + 15, h / 2 - 15); x.stroke(); return c; }
  // draw now if cached, and redraw once the layers for that frame have loaded
  const c = engine.renderIcon(ids, frame, w, h);
  const metas = ids.map(id => manifest.partsMeta[id]).filter(Boolean);
  if (!engine.frameReady(frame, metas)) engine.preloadFrame(frame, metas).then(() => { const d = engine.renderIcon(ids, frame, w, h); const x = c.getContext('2d'); x.setTransform(1, 0, 0, 1, 0, 0); x.clearRect(0, 0, w, h); x.drawImage(d, 0, 0); });
  return c;
}
function renderCategoryStrip() {
  const strip = $('#catStrip'); strip.innerHTML = '';
  CATEGORIES.forEach(cat => { const b = document.createElement('button'); b.className = 'cat-tile' + (ui.category === cat.id ? ' active' : ''); const cv = iconFor(cat, currentVariant(cat) || variantsOf(cat)[0].id, 280, 148); cv.style.width = '140px'; cv.style.height = '74px'; b.appendChild(cv); const p = document.createElement('p'); p.textContent = cat.label; b.appendChild(p); b.onclick = () => { click(); openCategory(cat.id); }; strip.appendChild(b); });
}
function openCategory(id) {
  ui.category = id; const cat = CATEGORIES.find(c => c.id === id); setMode('variants');
  // auto-rotate to a frame where the part is visible (the original turns the car when a category is picked)
  if (cat.iconFrame !== undefined) { S.frame = cat.iconFrame; ui.lastInteraction = performance.now() + 6000; invalidate(); }
  const tile = $('#tinyTile'); const cv = iconFor(cat, currentVariant(cat) || variantsOf(cat)[0].id, 280, 128); tile.querySelector('canvas').replaceWith(cv); cv.style.width = '140px'; cv.style.height = '64px'; tile.querySelector('p').textContent = cat.label;
  const strip = $('#variantStrip'); strip.innerHTML = '';
  const cur = currentVariant(cat);
  variantsOf(cat).forEach(v => {
    const b = document.createElement('button'); b.className = 'component-item' + (v.id === cur ? ' cur' : '');
    const icon = iconFor(cat, v.id, 380, 140); icon.style.width = '190px'; icon.style.height = '70px'; b.appendChild(icon);
    const n = document.createElement('p'); n.className = 'comp-name'; n.textContent = v.name; b.appendChild(n);
    const pr = document.createElement('p'); pr.className = 'comp-price'; pr.innerHTML = v.price ? `Starting at: $${v.price.toLocaleString()}` : `<small>Included</small>`; b.appendChild(pr);
    b.onclick = () => { click(); selectVariant(cat, v); };
    strip.appendChild(b);
  });
  const curEl = strip.querySelector('.cur'); if (curEl) curEl.scrollIntoView({ inline: 'center', block: 'nearest' });
}
function selectVariant(cat, v) {
  if (cat.kind === 'packs') Object.assign(S.config, v.pack.patch);
  else for (const k of cat.keys) S.config[k] = v.id;
  // dependent parts: spare wheel follows the tire type, door glass only with full doors (handled by `requires`)
  engine.preloadFrame(Math.round(S.frame)).then(invalidate);
  invalidate(); openCategory(cat.id); updateHash();
}
$('#tinyTile').onclick = () => { click(); setMode('parts'); };
$('#tinyPrev').onclick = () => { click(); const i = CATEGORIES.findIndex(c => c.id === ui.category); openCategory(CATEGORIES[(i - 1 + CATEGORIES.length) % CATEGORIES.length].id); };
$('#tinyNext').onclick = () => { click(); const i = CATEGORIES.findIndex(c => c.id === ui.category); openCategory(CATEGORIES[(i + 1) % CATEGORIES.length].id); };
$('#catPrev').onclick = () => $('#catStrip').scrollBy({ left: -486, behavior: 'smooth' });
$('#catNext').onclick = () => $('#catStrip').scrollBy({ left: 486, behavior: 'smooth' });
$('#catStrip').addEventListener('wheel', e => { if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) { e.preventDefault(); e.currentTarget.scrollBy({ left: e.deltaY }); } }, { passive: false });
$('#variantStrip').addEventListener('wheel', e => { if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) { e.preventDefault(); e.currentTarget.scrollBy({ left: e.deltaY }); } }, { passive: false });

// ---------- settings panel ----------
const sliders = { tint: v => { S.tint = +v; invalidate(); }, suspension: v => { S.suspension = +v; invalidate(); }, zoom: v => { S.zoom = +v; applyStageTransform(); } };
for (const id in sliders) { const el = $('#' + id); el.addEventListener('input', () => sliders[id](el.value)); }
$$('.pm').forEach(b => b.onclick = () => { click(); const el = $('#' + b.dataset.for); const step = +el.step * 5 * +b.dataset.step; el.value = Math.min(+el.max, Math.max(+el.min, +el.value + step)); sliders[b.dataset.for](el.value); });
const checks = {
  cWheelNeon: () => { S.wheelNeon.on = !S.wheelNeon.on; return S.wheelNeon.on; },
  cCarNeon: () => { S.underglow.on = !S.underglow.on; return S.underglow.on; },
  cLights: () => { S.lights = !S.lights; return S.lights; },
  cRock: () => { S.rockLights = !S.rockLights; return S.rockLights; },
  cAuto: () => { ui.autoRotate = !ui.autoRotate; return ui.autoRotate; },
};
for (const id in checks) { const el = $('#' + id); el.parentElement.addEventListener('click', e => { if (e.target.matches('input')) return; click(); el.classList.toggle('active', checks[id]()); invalidate(); }); }
$('#wheelNeonColor').addEventListener('input', e => { S.wheelNeon.color = e.target.value; if (!S.wheelNeon.on) { S.wheelNeon.on = true; $('#cWheelNeon').classList.add('active'); } invalidate(); });
$('#carNeonColor').addEventListener('input', e => { S.underglow.color = e.target.value; if (!S.underglow.on) { S.underglow.on = true; $('#cCarNeon').classList.add('active'); } invalidate(); });

// ---------- filters ----------
{ const fs = $('#filterStrip'); FILTERS.forEach(f => { const b = document.createElement('button'); b.className = 'filter' + (f.id === ui.filter ? ' active' : ''); b.textContent = f.label; b.onclick = () => { click(); ui.filter = f.id; $$('.filter', fs).forEach(x => x.classList.toggle('active', x === b)); applyStageTransform(); setToggle($('#tFilters'), ui.filter !== 'none'); }; fs.appendChild(b); }); }

// ---------- modals: parts used, my builds, save menu, home ----------
function openModal(html) { $('#modalBody').innerHTML = html; $('#modal').hidden = false; }
$('#modalClose').onclick = () => { $('#modal').hidden = true; };
$('#modal').addEventListener('click', e => { if (e.target === e.currentTarget) e.currentTarget.hidden = true; });
function partsUsed() {
  const rows = []; let total = 0;
  for (const cat of CATEGORIES) { if (cat.kind === 'packs') continue; const v = variantsOf(cat).find(x => x.id === currentVariant(cat)); if (!v) continue; const stock = manifest.defaultConfig[cat.keys[0]] === v.id; rows.push(`<tr><td>${cat.label}</td><td>${v.name}</td><td class="num">${v.price ? '$' + v.price.toLocaleString() : (stock ? 'Factory' : 'Included')}</td></tr>`); total += v.price || 0; }
  const paints = Object.entries(S.paint).map(([z, p]) => `<tr><td>${z[0].toUpperCase() + z.slice(1)} paint</td><td>${p.color} · ${FINISHES[p.finish].label}</td><td class="num">${p.finish === 'glossy' ? 'Included' : '$' + (p.finish === 'chrome' ? 2400 : p.finish === 'candy' ? 1800 : 900).toLocaleString()}</td></tr>`).join('');
  total += Object.values(S.paint).reduce((a, p) => a + (p.finish === 'glossy' ? 0 : p.finish === 'chrome' ? 2400 : p.finish === 'candy' ? 1800 : 900), 0);
  openModal(`<h2>Parts used</h2><table><tr><th>Category</th><th>Part</th><th class="num">Starting at</th></tr>${rows.join('')}${paints}<tr class="total"><td colspan="2">Build total (parts &amp; paint)</td><td class="num">$${total.toLocaleString()}</td></tr></table><p>Prices are illustrative placeholders in this local build — wire them to your own catalog or DMS.</p>`);
}
$('#partsUsedBtn').onclick = () => { click(); partsUsed(); };
const LS = 'micar-builds';
function loadBuilds() { try { return JSON.parse(localStorage.getItem(LS) || '[]'); } catch { return []; } }
function serialize() { return { config: S.config, paint: S.paint, partPaint: S.partPaint, tint: S.tint, suspension: S.suspension, zoom: S.zoom, lights: S.lights, underglow: S.underglow, wheelNeon: S.wheelNeon, rockLights: S.rockLights, frame: Math.round(S.frame), filter: ui.filter }; }
function applySerialized(b) { if (!b) return; Object.assign(S.config, b.config || {}); if (b.paint) Object.assign(S.paint, b.paint); S.partPaint = b.partPaint || {}; for (const k of ['tint', 'suspension', 'zoom', 'lights', 'rockLights', 'frame']) if (b[k] !== undefined) S[k] = b[k]; if (b.underglow) S.underglow = b.underglow; if (b.wheelNeon) S.wheelNeon = b.wheelNeon; ui.filter = b.filter || 'none'; syncControls(); }
function syncControls() { $$('#filterStrip .filter').forEach((b, i) => b.classList.toggle('active', FILTERS[i].id === ui.filter)); $('#tint').value = S.tint; $('#suspension').value = S.suspension; $('#zoom').value = S.zoom; $('#cWheelNeon').classList.toggle('active', S.wheelNeon.on); $('#cCarNeon').classList.toggle('active', S.underglow.on); $('#cLights').classList.toggle('active', S.lights); $('#cRock').classList.toggle('active', S.rockLights); $('#wheelNeonColor').value = S.wheelNeon.color; $('#carNeonColor').value = S.underglow.color; applyStageTransform(); refreshColorsPanel(); setToggle($('#tFilters'), ui.filter !== 'none'); invalidate(); }
function thumb() { const c = engine.snapshot(bgImage); const t = document.createElement('canvas'); t.width = 320; t.height = 200; t.getContext('2d').drawImage(c, 0, 0, 320, 200); return t.toDataURL('image/jpeg', 0.7); }
function myBuilds() {
  const builds = loadBuilds();
  openModal(`<h2>My builds</h2>${builds.length ? `<div class="builds">${builds.map((b, i) => `<div class="build"><img src="${b.thumb}" alt=""><div class="meta"><b>${b.name}</b><span>${new Date(b.date).toLocaleString()}</span></div><div class="actions"><button data-load="${i}">Load</button><button data-share="${i}">Copy link</button><button data-del="${i}">Delete</button></div></div>`).join('')}</div>` : '<p>No saved builds yet. Use the save button (bottom right) to keep a build here — this replaces the original site\'s community “Top Ranked” gallery with your own local garage.</p>'}`);
  $('#modalBody').onclick = e => { const t = e.target; if (t.dataset.load !== undefined) { applySerialized(builds[+t.dataset.load].state); $('#modal').hidden = true; toast('Build loaded'); } if (t.dataset.del !== undefined) { builds.splice(+t.dataset.del, 1); localStorage.setItem(LS, JSON.stringify(builds)); myBuilds(); } if (t.dataset.share !== undefined) { copyLink(builds[+t.dataset.share].state); } };
}
$('#buildsBtn').onclick = () => { click(); myBuilds(); };
function encodeState(st = serialize()) { return btoa(unescape(encodeURIComponent(JSON.stringify(st)))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }
function decodeState(s) { try { return JSON.parse(decodeURIComponent(escape(atob(s.replace(/-/g, '+').replace(/_/g, '/'))))); } catch { return null; } }
function updateHash() { history.replaceState(null, '', '#b=' + encodeState()); }
function restoreFromHash() { const m = location.hash.match(/#b=([^&]+)/); if (m) { const st = decodeState(m[1]); if (st) { Object.assign(S.config, st.config || {}); if (st.paint) Object.assign(S.paint, st.paint); S.partPaint = st.partPaint || {}; for (const k of ['tint', 'suspension', 'zoom', 'lights', 'rockLights', 'frame']) if (st[k] !== undefined) S[k] = st[k]; if (st.underglow) S.underglow = st.underglow; if (st.wheelNeon) S.wheelNeon = st.wheelNeon; ui.filter = st.filter || 'none'; } } }
async function copyLink(st) { const url = location.origin + location.pathname + '#b=' + encodeState(st); try { await navigator.clipboard.writeText(url); toast('Share link copied'); } catch { prompt('Copy this link', url); } }
$('#saveBtn').dataset.popover = '1';
$('#saveBtn').onclick = e => {
  click(); showPopover(e.currentTarget, `<button class="menu-item" id="mSave">Save to My Builds</button><button class="menu-item" id="mShare">Copy share link</button><button class="menu-item" id="mSnap">Download snapshot (PNG)</button><button class="menu-item" id="mReset">Reset to factory</button>`, 'left');
  $('#mSave').onclick = () => { const name = prompt('Name this build', 'Build ' + (loadBuilds().length + 1)); if (!name) return; const builds = loadBuilds(); builds.unshift({ name, date: Date.now(), state: serialize(), thumb: thumb() }); localStorage.setItem(LS, JSON.stringify(builds.slice(0, 24))); hidePopover(); toast('Saved to My Builds'); };
  $('#mShare').onclick = () => { updateHash(); copyLink(); hidePopover(); };
  $('#mSnap').onclick = () => { const c = engine.snapshot(bgImage); const a = document.createElement('a'); a.download = 'micar-build.png'; a.href = c.toDataURL('image/png'); a.click(); hidePopover(); toast('Snapshot downloaded'); };
  $('#mReset').onclick = () => { S.config = { ...manifest.defaultConfig }; S.paint = { exterior: { color: '#bc1d17', finish: 'glossy' }, interior: { color: '#2b2b2e', finish: 'matte' }, wheels: { color: '#c9ccd1', finish: 'metallic' } }; S.partPaint = {}; S.tint = 0.25; S.suspension = 0; S.zoom = 1; S.lights = false; S.rockLights = false; S.underglow.on = false; S.wheelNeon.on = false; ui.filter = 'none'; syncControls(); history.replaceState(null, '', location.pathname); hidePopover(); toast('Factory build restored'); if (ui.mode === 'variants') openCategory(ui.category); };
};
$('#homeBtn').dataset.popover = '1';
$('#homeBtn').onclick = e => { click(); showPopover(e.currentTarget, `<button class="menu-item" id="hAbout">About this configurator</button><button class="menu-item" id="hBuilds">My builds</button><button class="menu-item" id="hParts">Parts used</button>`, 'right'); $('#hAbout').onclick = () => { hidePopover(); openModal(`<h2>Micar Tuner</h2><p>A local sprite-turntable configurator: <b>${engine.frameCount}</b> pre-rendered rotation frames, each composited from ${Object.keys(manifest.parts).length} part layers (re-coloured, lifted and lit at runtime). The vehicle is an original procedural model rendered by <code>tools/render-sprites.mjs</code>.</p><p>Drag to rotate · scroll to zoom · arrow keys step frames · Transform off = drag pans.</p>`); }; $('#hBuilds').onclick = () => { hidePopover(); myBuilds(); }; $('#hParts').onclick = () => { hidePopover(); partsUsed(); }; };

// ---------- popover / toast ----------
function showPopover(anchor, html, side = 'top') {
  const p = $('#popover'); p.innerHTML = html; p.hidden = false; const r = anchor.getBoundingClientRect(); const pr = p.getBoundingClientRect();
  let left, top;
  if (side === 'left') { left = r.left - pr.width - 8; top = r.bottom - pr.height; }
  else if (side === 'right') { left = r.right + 8; top = r.top; }
  else { left = r.left + r.width / 2 - pr.width / 2; top = r.top - pr.height - 10; }
  p.style.left = Math.max(8, Math.min(window.innerWidth - pr.width - 8, left)) + 'px'; p.style.top = Math.max(8, top) + 'px';
}
function hidePopover() { $('#popover').hidden = true; }
let toastTimer; function toast(msg) { const t = $('#toast'); t.textContent = msg; t.hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.hidden = true; }, 1800); }

// ---------- color helpers ----------
function rgbToHsl(r, g, b) { r /= 255; g /= 255; b /= 255; const max = Math.max(r, g, b), min = Math.min(r, g, b); let h = 0, s = 0; const l = (max + min) / 2; if (max !== min) { const d = max - min; s = l > 0.5 ? d / (2 - max - min) : d / (max + min); switch (max) { case r: h = (g - b) / d + (g < b ? 6 : 0); break; case g: h = (b - r) / d + 2; break; default: h = (r - g) / d + 4; } h *= 60; } return { h, s: s * 100, l: l * 100 }; }
function hslToHex(h, s, l) { s /= 100; l /= 100; const k = n => (n + h / 30) % 12; const a = s * Math.min(l, 1 - l); const f = n => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1))); return rgbToHex(f(0) * 255, f(8) * 255, f(4) * 255); }

// ---------- init ----------
syncControls(); setMode('finishes');
window.micar = { engine, state: S, ui };
window.__done = { ok: true, parts: engine.activeParts().length };
