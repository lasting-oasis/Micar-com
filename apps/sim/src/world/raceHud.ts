// The Strip's lap-race HUD (circuit, sprint, street X), in Slipstream's arrangement and MiCar's brand:
//   - the timing tower, top left (in portrait, under the car panel)
//   - the lap timer with three sector bars and last / best, top right (on a phone: top centre in landscape, beside the
//     tower in portrait, with the checkpoint arrow in its first row)
//   - the five start lights, top centre (in portrait, in the timer's place)
//   - the dash (rev lights, gear, speed), at the cluster's anchor
//   - the car card (model, nitrous, boost), bottom right; on a phone nitrous and boost join the dash
// raceLayout places them around the car panel and the touch controls.
// raceView is the pure view model; drawRaceHud only paints it on the HUD canvas. No React, nothing kept between frames.
import { clamp } from './physics';
import { fmtT, kmhOf, spdNum, spdUnit, type HudState } from './hud';
import { usesLights } from './strip/lights';
import { SECTORS, type SectorMark } from './strip/timing';
import type { ActiveEvent } from './strip/events';

export type HudTxt = { lap: string; leader: string; last: string; best: string; sprint: string; nitrous: string; boost: string; you: string; lapDown: string; lapsDown: string };
export const HUD_TXT: Record<'en' | 'es', HudTxt> = {
  en: { lap: 'LAP', leader: 'LEADER', last: 'LAST', best: 'BEST', sprint: 'SPRINT', nitrous: 'NITROUS', boost: 'BOOST', you: 'YOU', lapDown: 'LAP', lapsDown: 'LAPS' },
  es: { lap: 'VUELTA', leader: 'LÍDER', last: 'ÚLTIMA', best: 'MEJOR', sprint: 'SPRINT', nitrous: 'NITRO', boost: 'TURBO', you: 'TÚ', lapDown: 'VUELTA', lapsDown: 'VUELTAS' },
};
export type TowerRow = { pos: number; name: string; color: string; me: boolean; gap: string };
export type RaceView = {
  title: string; rows: TowerRow[]; lapTime: string; last: string; best: string;
  sectors: { fill: number; mark: SectorMark }[]; lit: number | null; counting: boolean; laps: boolean;
};

export const NIGHT = '#0e1217', PANEL = 'rgba(14,18,23,.9)', LINE = '#262d37';
const INK = '#e7eaee', HAZE = '#9aa3ad', ACCENT = '#ffd23f', ACCENT_HI = '#fff1b0', BLUE = '#79a6ff', GREEN = '#2bd66b', PURPLE = '#b25cff', RED = '#ff5a6a', LAMP = '#ff2a2a';
const DF = "'Barlow Condensed','Arial Narrow',sans-serif", UF = "'Barlow',sans-serif";
const DONE_COL: Record<SectorMark, string> = { open: ACCENT, plain: ACCENT, pb: GREEN, best: PURPLE };

/** '+1.2' seconds, '+1 LAP' / '+2 LAPS' a lap or more down, '' when not known (or not behind). */
export function gapText(g: number | null | undefined, lapsDown: number, t: HudTxt): string {
  if (lapsDown >= 1) return '+' + lapsDown + ' ' + (lapsDown >= 2 ? t.lapsDown : t.lapDown);
  if (g == null || !Number.isFinite(g) || g <= 0) return '';
  return '+' + g.toFixed(1);
}

/** The lap-race HUD's content, or null when this frame isn't a lap race in the Strip (counting, racing or done). */
export function raceView(s: HudState): RaceView | null {
  const a = s.district === 'strip' ? s.event : null;
  if (!a || !usesLights(a.type) || (a.state !== 'count' && a.state !== 'race' && a.state !== 'done')) return null;
  const t = HUD_TXT[s.lang ?? 'en'], T = a.timing, loop = a.route.loop, L = a.route.len, st = s.standings, lead = st[0];
  const rows = st.map((p, i): TowerRow => {
    const down = loop && i > 0 && lead && p.ft == null && lead.s != null && p.s != null ? Math.floor((lead.s - p.s) / L) : 0;
    return { pos: i + 1, name: p.me ? t.you : p.name, color: p.color ?? HAZE, me: !!p.me, gap: i === 0 ? t.leader : gapText(p.gap, down, t) };
  });
  const counting = a.state === 'count';
  const lapTime = counting ? '' : a.state === 'done' ? fmtT(a.pFt) : fmtT(T ? T.lapTime('me', a.time) : a.time);
  const secs = T ? T.sectors('me') : Array.from({ length: SECTORS }, () => ({ time: null as number | null, mark: 'open' as SectorMark }));
  const into = a.pS <= 0 ? 0 : loop ? a.pS % L : Math.min(a.pS, L), secLen = L / SECTORS;
  const sectors = secs.map((x, i) => ({ mark: x.mark, fill: x.time != null ? 1 : counting ? 0 : clamp((into - i * secLen) / secLen, 0, 1) }));
  return {
    title: loop ? t.lap + ' ' + Math.min(a.laps, a.pLap + 1) + '/' + a.laps : t.sprint, rows, lapTime,
    last: fmtT(T?.last('me')), best: fmtT(T?.best('me')), sectors, lit: a.lit, counting, laps: loop,
  };
}

export function panel(hx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number): void {
  hx.fillStyle = PANEL; hx.fillRect(x, y, w, h);
  hx.strokeStyle = LINE; hx.lineWidth = 1; hx.strokeRect(x + .5, y + .5, w - 1, h - 1);
}
function bar(hx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, f: number, c: string): void {
  hx.fillStyle = 'rgba(255,255,255,.12)'; hx.fillRect(x, y, w, h);
  hx.fillStyle = c; hx.fillRect(x, y, w * clamp(f, 0, 1), h);
}

export type Box = { x: number; y: number; w: number; h: number };
/** What the race HUD has to fit around, in HUD-canvas pixels: inset is the car panel's bottom edge (0 when it is not
 *  showing); (cx, cy) is where the dash centres (the gauge cluster's place); leftTop / rightTop are where the touch
 *  controls begin at each bottom corner (H when there are none). */
/** colL / colR: the touch controls' column widths (0 without them); panelL / panelR: the car panel's left and right
 *  edges (it sits at the top centre, down to `inset`). */
export type RaceLayoutIn = { W: number; H: number; insT: number; insB: number; inset: number; small: boolean; rows: number; laps: boolean; cx: number; cy: number; leftTop: number; rightTop: number; colL?: number; colR?: number; panelL?: number; panelR?: number };
/** Where each part goes. tower is null when not even one row fits; rowsShown: how many of its rows (the top ones and
 *  the player: towerRows); compact: the timer without its LAST / BEST rows. arrow is the checkpoint arrow's centre, ly
 *  its label's baseline; cueIn: the arrow rides in the timer's first row with just the distance (a phone); map is null
 *  when it has no room. */
export type RaceLayout = { tower: Box | null; rowH: number; rowsShown: number; nameCh: number; timer: Box; compact: boolean; lights: Box; dash: Box; card: Box | null; arrow: { x: number; y: number; ly: number }; cueIn: boolean; map: { cx: number; cy: number; r: number } | null };

const hitBox = (a: Box, b: Box) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
const grow = (b: Box, d: number): Box => ({ x: b.x - d, y: b.y - d, w: b.w + 2 * d, h: b.h + 2 * d });
/** The tower's rows when only n fit: the top ones, the last of them given up to the player if the player is further back. */
export function towerRows<T extends { me?: boolean }>(rows: T[], n: number): T[] {
  if (rows.length <= n) return rows;
  const top = rows.slice(0, n), me = rows.findIndex(r => r.me);
  return me < n || me < 0 ? top : [...rows.slice(0, n - 1), rows[me]];
}

/**
 * Lay the race HUD out. A desktop keeps the corners (tower top left, timer top right, map bottom left, car card bottom
 * right). A landscape phone puts the timer (or the lights) at the top centre under the car panel and a smaller map at
 * the top right, above the NOS / DRIFT buttons. A portrait phone shares the row under the car panel between the tower and
 * the timer, with the map under the timer. On a phone the checkpoint arrow rides in the timer's first row, so nothing
 * sits over the car. The tower's rows shrink (20 px down to 14) to clear whatever sits under it.
 */
export function raceLayout(o: RaceLayoutIn): RaceLayout {
  const { W, H, small } = o, pad = small ? 12 : 34, top = (small ? 10 : 24) + o.insT, gap = small ? 6 : 10;
  const below = Math.max(top, o.inset + gap); // the first free line under the car panel
  const dw = small ? 210 : 300, dh = small ? 70 : 92;
  const dash = { x: clamp(o.cx - dw / 2, 8, Math.max(8, W - dw - 8)), y: clamp(o.cy - dh / 2, 8, Math.max(8, H - dh - 8 - o.insB)), w: dw, h: dh };
  const lw = small ? 176 : 230, lh = o.laps ? (small ? 76 : 100) : (small ? 50 : 66);
  const rr = small ? 10 : 15, gw = (small ? 28 : 42) * 4 + rr * 2 + 24, gh = rr * 2 + 20, hh = small ? 24 : 32, rows = Math.max(1, o.rows);
  if (!small) {
    const ay = below + 22;
    return {
      tower: { x: pad, y: top, w: 270, h: hh + 26 * rows + 4 }, rowH: 26, rowsShown: rows, nameCh: 14,
      timer: { x: W - pad - lw, y: top, w: lw, h: lh }, compact: false, lights: { x: W / 2 - gw / 2, y: below, w: gw, h: gh }, dash,
      card: { x: W - pad - 220, y: H - 34 - o.insB - 80, w: 220, h: 80 },
      arrow: { x: W / 2, y: ay, ly: ay + 24 }, cueIn: false, map: { cx: 84 + pad, cy: H - 84 - pad - o.insB, r: 84 },
    };
  }
  const wide = W >= 560, colL = o.colL ?? 168, colR = o.colR ?? 168, panelL = o.panelL ?? W / 2 - 80, panelR = o.panelR ?? W / 2 + 80;
  // the dash keeps clear of the right controls: narrower if it can stay 170 px wide, else lifted above them
  const rightCol: Box = { x: W - colR, y: o.rightTop, w: colR, h: H - o.rightTop };
  let d: Box = dash;
  if (colR > 0 && hitBox(d, grow(rightCol, gap))) {
    const w2 = W - colR - gap - d.x;
    d = w2 >= 170 ? { ...d, w: Math.min(dw, w2) } : { ...d, y: Math.max(8, o.rightTop - gap - dh) };
  }
  // the tower: the top left corner in landscape (narrowed, else moved under the car panel, when the panel reaches it);
  // in portrait it shares the row under the panel with the timer, or stacks over it when the two cannot share a row
  let tw = wide ? 196 : clamp(W - 2 * pad - lw - 8, 150, 196), ty = wide ? top : below;
  const tl = wide ? lw : clamp(W - 2 * pad - tw - 8, 150, lw), stack = !wide && W - 2 * pad - 8 < 300;
  if (stack) tw = Math.min(196, W - 2 * pad);
  if (wide && panelL < pad + tw + gap) { if (panelL - gap - pad >= 150) tw = panelL - gap - pad; else ty = below; }
  // rows that fit over the left controls (and over the dash when it shares the tower's columns), 14 to 20 px each
  const fit = (tx: number, ty: number, under: number) => {
    let floor = under;
    if (d.x < tx + tw && d.x + d.w > tx && d.y > ty) floor = Math.min(floor, d.y);
    const room = floor - gap - ty - hh - 4, n = clamp(Math.floor(room / 14), 0, rows);
    return { tx, ty, n, rowH: n ? clamp(Math.floor(room / n), 14, 20) : 14 };
  };
  let f = fit(pad, ty, o.leftTop);
  // a short landscape screen whose left controls reach the top: the tower stands right of them instead
  if (wide && f.n < 2 && colL > 0) {
    const tx = colL + gap, t2 = panelL < tx + tw + gap && panelR > tx ? below : top, g = fit(tx, t2, H - 8 - o.insB);
    if (g.n > f.n) f = g;
  }
  const { rowH } = f, rowsShown = f.n;
  const tower = rowsShown ? { x: f.tx, y: f.ty, w: tw, h: hh + rowH * rowsShown + 4 } : null, nameCh = clamp(Math.floor((tw - 92) / 6.5), 6, 14);
  // beside the tower (pushed right of it when they would meet), dropping its LAST / BEST rows before it meets the dash
  const beside = (y: number, w: number, h: number): Box => {
    let x = wide ? W / 2 - w / 2 : W - pad - w;
    if (tower && wide && y < tower.y + tower.h + gap && x < tower.x + tower.w + gap) x = tower.x + tower.w + gap;
    return { x, y, w, h };
  };
  const ty2 = stack && tower ? tower.y + tower.h + gap : below;
  let timer = beside(ty2, tl, lh), compact = false;
  if (o.laps && hitBox(timer, grow(d, gap))) { timer = beside(ty2, tl, small ? 50 : 66); compact = true; }
  const lights = beside(ty2, Math.max(gw, 0), gh);
  const arrow = { x: timer.x + 22, y: timer.y + 18, ly: timer.y + 21 };
  if (wide) {
    let r = Math.min(56, Math.floor((o.rightTop - top - gap) / 2));
    const mapBox = (r: number): Box => ({ x: W - pad - 2 * r, y: top, w: 2 * r, h: 2 * r });
    while (r >= 28 && [timer, lights, { x: panelL, y: 0, w: panelR - panelL, h: o.inset }].some(b => hitBox(mapBox(r), grow(b, gap / 2)))) r -= 4;
    return { tower, rowH, rowsShown, nameCh, timer, compact, lights, dash: d, card: null, arrow, cueIn: true, map: r >= 28 ? { cx: W - pad - r, cy: top + r, r } : null };
  }
  const r = 56, my = timer.y + timer.h + gap + 2 + r;
  return {
    tower, rowH, rowsShown, nameCh, timer, compact, lights: { x: timer.x + (tl - gw) / 2, y: timer.y, w: gw, h: gh }, dash: d, card: null,
    arrow, cueIn: true, map: my + r <= o.rightTop - gap ? { cx: W - pad - r, cy: my, r } : null,
  };
}

export function drawRaceHud(hx: CanvasRenderingContext2D, v: RaceView, s: HudState, L: RaceLayout): void {
  const small = s.small, t = HUD_TXT[s.lang ?? 'en'];
  hx.save(); hx.textBaseline = 'middle';

  /* the timing tower: the rows that fit (the top ones and the player) */
  if (L.tower) {
  const { x: px, y: top, w: tw } = L.tower, rh = L.rowH, hh = small ? 24 : 32, inner = rh - (rh < 18 ? 4 : 8);
  panel(hx, px, top, tw, L.tower.h);
  hx.fillStyle = INK; hx.font = `italic 900 ${small ? 16 : 22}px ${DF}`; hx.textAlign = 'left'; hx.fillText(v.title, px + 10, top + hh / 2 + 1);
  towerRows(v.rows, L.rowsShown).forEach((r, i) => {
    const y = top + hh + i * rh, mid = y + rh / 2;
    if (r.me) { hx.fillStyle = ACCENT; hx.fillRect(px + 1, y, tw - 2, rh); }
    hx.fillStyle = r.me ? NIGHT : INK; hx.font = `italic 800 ${small ? 13 : 16}px ${DF}`; hx.textAlign = 'right'; hx.fillText(String(r.pos), px + (small ? 22 : 28), mid);
    hx.fillStyle = r.me ? NIGHT : r.color; hx.fillRect(px + (small ? 28 : 36), y + (rh - inner) / 2, 4, inner);
    hx.fillStyle = r.me ? NIGHT : INK; hx.font = `700 ${small ? 11 : 14}px ${UF}`; hx.textAlign = 'left'; hx.fillText(r.name.toUpperCase().slice(0, L.nameCh), px + (small ? 38 : 48), mid);
    hx.fillStyle = r.me ? NIGHT : HAZE; hx.font = `italic 700 ${small ? 12 : 15}px ${DF}`; hx.textAlign = 'right'; hx.fillText(r.gap, px + tw - 10, mid);
  });
  }

  /* the five start lights */
  if (v.counting) {
    const rr = small ? 10 : 15, step = small ? 28 : 42, { x: x0, y: y0, w, h } = L.lights;
    panel(hx, x0, y0, w, h);
    for (let i = 0; i < 5; i++) {
      const on = (v.lit ?? 0) > i;
      hx.fillStyle = on ? LAMP : 'rgba(255,255,255,.1)'; hx.shadowColor = LAMP; hx.shadowBlur = on ? 14 : 0;
      hx.beginPath(); hx.arc(x0 + 12 + rr + i * step, y0 + 10 + rr, rr, 0, Math.PI * 2); hx.fill();
    }
    hx.shadowBlur = 0;
  } else {
    /* the lap timer */
    const { x: x0, y: y0, w: lw, h: lh } = L.timer;
    panel(hx, x0, y0, lw, lh);
    hx.fillStyle = INK; hx.textAlign = 'right'; hx.font = `italic 900 ${small ? 24 : 34}px ${DF}`; hx.fillText(v.lapTime, x0 + lw - 10, y0 + (small ? 16 : 22));
    const bw = (lw - 28) / 3, by = y0 + (small ? 32 : 44);
    v.sectors.forEach((sec, i) => bar(hx, x0 + 10 + i * (bw + 4), by, bw, 5, sec.fill, sec.fill >= 1 ? DONE_COL[sec.mark] : ACCENT));
    if (v.laps && !L.compact) {
      const r1 = by + (small ? 17 : 23), r2 = r1 + (small ? 16 : 20);
      hx.font = `700 ${small ? 10 : 11}px ${UF}`; hx.fillStyle = HAZE; hx.textAlign = 'left'; hx.fillText(t.last, x0 + 10, r1); hx.fillText(t.best, x0 + 10, r2);
      hx.font = `italic 800 ${small ? 13 : 16}px ${DF}`; hx.textAlign = 'right'; hx.fillStyle = INK; hx.fillText(v.last, x0 + lw - 10, r1); hx.fillStyle = BLUE; hx.fillText(v.best, x0 + lw - 10, r2);
    }
  }

  /* the dash, and the car card (on a phone the card's bars join the dash) */
  const PV = s.PV, P = PV.P, { x: dx, y: dy, w: dw, h: dh } = L.dash;
  panel(hx, dx, dy, dw, dh);
  const frac = P.redline > 0 ? PV.rpm / P.redline : 0, litN = Math.round(clamp((frac - .45) / .5, 0, 1) * 10);
  const now = s.now ?? (typeof performance !== 'undefined' ? performance.now() : 0);
  const flash = s.manual && PV.rpm > P.redline * .9 && PV.gear < P.gears.length && Math.sin(now / 60) > 0;
  const rr = small ? 4 : 5, sp = (dw - 40) / 9;
  for (let i = 0; i < 10; i++) {
    hx.fillStyle = flash ? RED : i < litN ? (i < 4 ? GREEN : i < 7 ? ACCENT : RED) : 'rgba(255,255,255,.1)';
    hx.beginPath(); hx.arc(dx + 20 + i * sp, dy + (small ? 11 : 14), rr, 0, Math.PI * 2); hx.fill();
  }
  hx.textBaseline = 'alphabetic';
  hx.textAlign = 'center'; hx.font = `italic 900 ${small ? 34 : 46}px ${DF}`; hx.fillStyle = PV.gear === -1 ? ACCENT : PV.shift > 0 ? HAZE : INK;
  hx.fillText(PV.gear === -1 ? 'R' : String(PV.gear), dx + dw / 2, dy + dh - (small ? 12 : 16));
  hx.textAlign = 'right'; hx.font = `italic 900 ${small ? 24 : 32}px ${DF}`; hx.fillStyle = INK; hx.fillText(String(spdNum(kmhOf(PV), s.units)), dx + dw - 12, dy + dh - (small ? 22 : 28));
  hx.font = `700 ${small ? 9 : 11}px ${UF}`; hx.fillStyle = HAZE; hx.fillText(spdUnit(s.units), dx + dw - 12, dy + dh - (small ? 10 : 12));
  const bars = (x: number, y: number, w: number, gapY: number) => {
    hx.textAlign = 'left'; hx.font = `700 ${small ? 9 : 10}px ${UF}`;
    if (P.nos.cap > 0) { hx.fillStyle = HAZE; hx.fillText(t.nitrous, x, y); bar(hx, x, y + 4, w, 5, PV.nos / P.nos.cap, PV.nosOn ? ACCENT_HI : ACCENT); }
    if (P.turbo) { hx.fillStyle = HAZE; hx.fillText(t.boost, x, y + gapY); bar(hx, x, y + gapY + 4, w, 5, PV.boost, BLUE); }
  };
  if (!L.card) bars(dx + 12, dy + dh - 34, 62, 18);
  else {
    const { x: cx0, y: cy0, w: cw, h: ch } = L.card;
    panel(hx, cx0, cy0, cw, ch);
    hx.textAlign = 'left'; hx.font = `italic 800 18px ${DF}`; hx.fillStyle = INK; hx.fillText((s.carName ?? '').toUpperCase().slice(0, 22), cx0 + 12, cy0 + 24);
    bars(cx0 + 12, cy0 + 42, cw - 24, 22);
  }
  hx.restore();
}

/** The scale and offset that fit a route into a w x h box centred on (cx, cy), less `pad` each side, north up (the
 *  full map's way round): screen x = ox + s * x, screen y = oz + s * z. One scale for both axes, the route centred,
 *  every point inside; a route less than a metre across on an axis counts as a metre. */
export function fitRoute(pts: readonly (readonly [number, number])[], cx: number, cy: number, w: number, h: number, pad: number): { s: number; ox: number; oz: number } {
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (const [x, z] of pts) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (z < z0) z0 = z; if (z > z1) z1 = z; }
  if (!(x1 >= x0)) x0 = x1 = z0 = z1 = 0;
  const s = Math.min(Math.max(1, w - 2 * pad) / Math.max(1, x1 - x0), Math.max(1, h - 2 * pad) / Math.max(1, z1 - z0));
  return { s, ox: cx - s * (x0 + x1) / 2, oz: cy - s * (z0 + z1) / 2 };
}

const MAP_EDGE = 'rgba(5,7,10,.85)', MAP_LINE = '#f3f6fb', MAP_DOT = '#c9d1db';
/**
 * The lap-race map (circuit, sprint, street X) in the radar's place: the event's whole route, north up, fitted to the
 * square around the radar's circle; a white line on a dark edge, the start line across it (and a ring at a sprint's
 * finish), each racer a dot in its colour (a parked one not at all) and the player as a yellow arrow on top, pointing
 * the way the car faces. A car off the route stays on the map, at its edge.
 */
export function drawRouteMap(hx: CanvasRenderingContext2D, a: ActiveEvent, PV: { x: number; z: number; h: number }, m: { cx: number; cy: number; r: number }, small: boolean): void {
  const pts = a.route.pts, n = pts.length, loop = a.route.loop; if (n < 2) return;
  const f = fitRoute(pts, 0, 0, 2 * m.r, 2 * m.r, small ? 6 : 8), X = (x: number) => f.ox + f.s * x, Y = (z: number) => f.oz + f.s * z, lim = m.r - 2;
  hx.save(); hx.translate(m.cx, m.cy); hx.lineJoin = 'round'; hx.lineCap = 'round';
  hx.beginPath();
  for (let i = 0; i < n; i++) { const x = X(pts[i][0]), y = Y(pts[i][1]); if (i) hx.lineTo(x, y); else hx.moveTo(x, y); }
  if (loop) hx.closePath();
  hx.strokeStyle = MAP_EDGE; hx.lineWidth = small ? 5 : 6.5; hx.stroke();
  hx.strokeStyle = MAP_LINE; hx.lineWidth = small ? 2.2 : 2.8; hx.stroke();
  // the start line: across the route at its first point (a loop runs in from its last point)
  const from = loop ? pts[n - 1] : pts[0], tx = X(pts[1][0]) - X(from[0]), ty = Y(pts[1][1]) - Y(from[1]), tl = Math.hypot(tx, ty) || 1, half = small ? 5 : 6.5;
  const sx = X(pts[0][0]), sy = Y(pts[0][1]), nx = -ty / tl * half, ny = tx / tl * half;
  hx.beginPath(); hx.moveTo(sx - nx, sy - ny); hx.lineTo(sx + nx, sy + ny);
  hx.strokeStyle = MAP_EDGE; hx.lineWidth = small ? 4.5 : 5.5; hx.stroke(); hx.strokeStyle = '#ffffff'; hx.lineWidth = small ? 2 : 2.5; hx.stroke();
  if (!loop) { hx.beginPath(); hx.arc(X(pts[n - 1][0]), Y(pts[n - 1][1]), small ? 3 : 3.5, 0, 7); hx.strokeStyle = MAP_EDGE; hx.lineWidth = 4; hx.stroke(); hx.strokeStyle = '#ffffff'; hx.lineWidth = 1.5; hx.stroke(); }
  const dot = (x: number, z: number, r: number, c: string) => {
    hx.fillStyle = c; hx.beginPath(); hx.arc(clamp(X(x), -lim, lim), clamp(Y(z), -lim, lim), r, 0, 7); hx.fill();
    hx.strokeStyle = MAP_EDGE; hx.lineWidth = 1.5; hx.stroke();
  };
  for (const R of a.racers) if (!R.parked) dot(R.x, R.z, small ? 3 : 3.5, R.color ?? MAP_DOT);
  // the player: the radar's yellow arrow, pointing the way the car faces (a dot could be a rival in the same
  // yellow: a challenge's first slot races in it), kept wholly inside the box
  const k = small ? .8 : 1, edge = m.r - 10 * k, px = clamp(X(PV.x), -edge, edge), py = clamp(Y(PV.z), -edge, edge);
  const c = Math.cos(Math.PI - PV.h) * k, sn = Math.sin(Math.PI - PV.h) * k, at = (lx: number, ly: number) => [px + lx * c - ly * sn, py + lx * sn + ly * c] as const;
  hx.beginPath();
  for (const [i, [lx, ly]] of ([[0, -9], [6, 7], [0, 3], [-6, 7]] as const).entries()) { const [x, y] = at(lx, ly); if (i) hx.lineTo(x, y); else hx.moveTo(x, y); }
  hx.closePath(); hx.fillStyle = ACCENT; hx.fill(); hx.strokeStyle = MAP_EDGE; hx.lineWidth = 1.5; hx.stroke();
  hx.restore();
}
