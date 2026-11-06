// The driving HUD canvas, ported from Night Tuner 08-hud.js drawHud: gauge cluster (tach, speed,
// gear, nitrous arc, boost bar, SHIFT light), cash, race position / lap / time / gap, drift score,
// outrun gap bar, checkpoint / GPS arrow, drag tach and the corner minimap. Brand colours: accent
// #ffd23f where Night Tuner used cyan, tube blue #79a6ff, Barlow Condensed numbers, Barlow text.
// Everything comes in through HudState; the HUD reads no game globals. World positions are metres
// (physics space), as in Night Tuner. The full-screen map (M) is StripScene.drawMapInto, not here.
import { clamp, type Vehicle } from './physics';
import { EV_COL, type EventDef } from './data';
import { CELL, N, RW, SPAN, type Node } from './strip/routes';
import type { AI } from './strip/ai';
import type { ActiveEvent, Outrun, Standing } from './strip/events';

export type HudMarker = { ev: EventDef; x: number; z: number };
export type HudGps = { label: string; node: Node; path: Node[] };

export type HudState = {
  PV: Vehicle;
  event: ActiveEvent | null;
  /** the active event's standings, leader first (EventRunner's sorted list); [] when none */
  standings: Standing[];
  outrun: Outrun | null;
  gps: HudGps | null;
  markers: readonly HudMarker[];
  ais: readonly AI[];
  money: number;
  units: 'kmh' | 'mph';
  manual: boolean;
  /** narrow layout (Night Tuner: width < 700) */
  small: boolean;
  /** touch controls are showing: lift the cluster above them */
  touch: boolean;
  /** the minimap, GPS arrow, cash and event readouts draw only in the Strip */
  district: 'town' | 'strip';
  /** career stage: markers above it are hidden on the minimap (default: all shown) */
  stage?: number;
  /** ms clock for the SHIFT flash (default performance.now()) */
  now?: number;
};

const ACCENT = '#ffd23f', ACCENT_HI = '#fff1b0', BLUE = '#79a6ff', CHROME = '#f3f6fb', GOLD = '#ffd23f', DIM = '#8e9bb0', INK = '#dfe7f2', RED = '#ff5a6a';
const DF = "'Barlow Condensed','Arial Narrow',sans-serif", UF = "'Barlow',sans-serif";

export const kmhOf = (V: Vehicle): number => Math.abs(V.u) * 3.6;
export const spdNum = (kmh: number, units: 'kmh' | 'mph'): number => Math.round(units === 'mph' ? kmh * .6214 : kmh);
export const spdUnit = (units: 'kmh' | 'mph'): string => units === 'mph' ? 'MPH' : 'KM/H';
export const distStr = (m: number, units: 'kmh' | 'mph'): string => units === 'mph' ? Math.round(m * 3.281) + ' ft' : Math.round(m) + ' m';
export const moneyStr = (n: number): string => '$' + Math.round(n).toLocaleString('en-US');
export const fmtT = (s: number | null | undefined): string => { if (s == null || !isFinite(s)) return '--'; const m = Math.floor(s / 60), r = s - m * 60; return m ? m + ':' + r.toFixed(2).padStart(5, '0') : r.toFixed(2); };
/** Night Tuner cleared the GPS inside 14 m of its target; the HUD does not mutate state, so the caller checks this. */
export const gpsReached = (PV: Vehicle, gps: HudGps): boolean => Math.hypot(PV.x - gps.node[0] * CELL, PV.z - gps.node[1] * CELL) < 14;

type Fonts = { tick: string; speed: string; unit: string; gear: string; boost: string; nos: string; shift: string; cash: string; big: string; sub: string; driftCur: string };
const fontsFor = (small: boolean): Fonts => {
  const R = small ? 66 : 100;
  return {
    tick: `italic 800 ${R * .16}px ${DF}`, speed: `italic 900 ${R * .46}px ${DF}`, unit: `700 ${R * .12}px ${UF}`, gear: `italic 900 ${R * .26}px ${DF}`, boost: `700 ${R * .1}px ${UF}`,
    nos: `italic 800 ${small ? 12 : 15}px ${DF}`, shift: `italic 900 ${small ? 16 : 22}px ${DF}`, cash: `italic 800 ${small ? 22 : 28}px ${DF}`,
    big: `italic 900 ${small ? 34 : 46}px ${DF}`, sub: `700 ${small ? 11 : 13}px ${UF}`, driftCur: `italic 900 ${small ? 26 : 34}px ${DF}`,
  };
};
const FONTS: Record<'s' | 'l', Fonts> = { s: fontsFor(true), l: fontsFor(false) };
const F_OUT = `700 12px ${UF}`, F_DRAG_T = `700 10px ${UF}`, F_DRAG_BIG = `italic 900 44px ${DF}`, F_DRAG_SUB = `700 11px ${UF}`, F_DRAG_MSG = `italic 800 14px ${DF}`;

export class Hud {
  private readonly hx: CanvasRenderingContext2D | null;
  private HW = 0; private HH = 0; private HD = 1;
  private insB = 0; private insT = 0;

  constructor(private readonly canvas: HTMLCanvasElement) {
    this.hx = canvas.getContext('2d');
    this.resize();
  }

  /** Match the backing store to the canvas's CSS size and the device pixel ratio (call on window resize). */
  resize(): void {
    const g = globalThis as unknown as { devicePixelRatio?: number; innerWidth?: number; innerHeight?: number; getComputedStyle?: (e: Element) => CSSStyleDeclaration; document?: Document };
    const w = this.canvas.clientWidth || g.innerWidth || 800, h = this.canvas.clientHeight || g.innerHeight || 600;
    this.HD = Math.min(2, g.devicePixelRatio || 1); this.HW = w; this.HH = h;
    this.canvas.width = Math.round(w * this.HD); this.canvas.height = Math.round(h * this.HD);
    try {
      if (g.getComputedStyle && g.document) { const cs = g.getComputedStyle(g.document.documentElement); this.insB = parseFloat(cs.paddingBottom) || 0; this.insT = parseFloat(cs.paddingTop) || 0; }
    } catch { this.insB = this.insT = 0; }
  }

  clear(): void { const hx = this.hx; if (!hx) return; hx.setTransform(this.HD, 0, 0, this.HD, 0, 0); hx.clearRect(0, 0, this.HW, this.HH); }

  draw(s: HudState): void {
    const hx = this.hx; if (!hx) return;
    const { HW, HH } = this; hx.setTransform(this.HD, 0, 0, this.HD, 0, 0); hx.clearRect(0, 0, HW, HH);
    const PV = s.PV, small = s.small, strip = s.district === 'strip', a = strip ? s.event : null, outrun = strip ? s.outrun : null, units = s.units;
    const insB = this.insB, insT = this.insT, Fo = FONTS[small ? 's' : 'l'];
    const kmh = kmhOf(PV);
    /* gauge cluster */
    const R = small ? 66 : 100, cx = HW - R - (small ? 20 : 40), cy = HH - R - (small ? (s.touch ? 196 : 22) : 34) - insB, P = PV.P, red = P.redline, maxR = Math.ceil((red + 800) / 1000) * 1000;
    if (!(a && a.type === 'drag')) {
      hx.save(); hx.translate(cx, cy);
      hx.fillStyle = 'rgba(14,18,23,.62)'; hx.beginPath(); hx.arc(0, 0, R + 14, 0, Math.PI * 2); hx.fill();
      const a0 = Math.PI * .75, a1 = Math.PI * 2.25, ang = (v: number) => a0 + (a1 - a0) * v / maxR;
      hx.lineWidth = R * .07; hx.strokeStyle = 'rgba(255,210,63,.15)'; hx.beginPath(); hx.arc(0, 0, R + 6, a0, a1); hx.stroke();
      if (P.nos.cap > 0) { hx.strokeStyle = ACCENT; hx.shadowColor = ACCENT; hx.shadowBlur = PV.nosOn ? 16 : 6; hx.beginPath(); hx.arc(0, 0, R + 6, a0, a0 + (a1 - a0) * (PV.nos / P.nos.cap)); hx.stroke(); hx.shadowBlur = 0; }
      hx.lineWidth = R * .1; hx.strokeStyle = 'rgba(255,60,80,.7)'; hx.beginPath(); hx.arc(0, 0, R * .86, ang(red), ang(maxR)); hx.stroke();
      hx.font = Fo.tick; hx.textAlign = 'center'; hx.textBaseline = 'middle';
      for (let v = 0; v <= maxR; v += 500) {
        const an = ang(v), big = v % 1000 === 0; const r1 = R * (big ? .72 : .78);
        hx.strokeStyle = v >= red ? RED : INK; hx.lineWidth = big ? 3 : 1.5; hx.beginPath(); hx.moveTo(Math.cos(an) * r1, Math.sin(an) * r1); hx.lineTo(Math.cos(an) * R * .86, Math.sin(an) * R * .86); hx.stroke();
        if (big) { hx.fillStyle = v >= red ? RED : INK; hx.fillText(String(v / 1000), Math.cos(an) * R * .56, Math.sin(an) * R * .56); }
      }
      const na = ang(Math.min(maxR, PV.rpm)); hx.strokeStyle = '#ff3b5c'; hx.lineWidth = 3; hx.shadowColor = '#ff3b5c'; hx.shadowBlur = 10; hx.beginPath(); hx.moveTo(-Math.cos(na) * R * .12, -Math.sin(na) * R * .12); hx.lineTo(Math.cos(na) * R * .84, Math.sin(na) * R * .84); hx.stroke(); hx.shadowBlur = 0;
      hx.fillStyle = '#0e1217'; hx.beginPath(); hx.arc(0, 0, R * .1, 0, 7); hx.fill();
      hx.fillStyle = '#fff'; hx.textAlign = 'center'; hx.textBaseline = 'alphabetic'; hx.font = Fo.speed; hx.fillText(String(spdNum(kmh, units)), 0, R * .6);
      hx.font = Fo.unit; hx.fillStyle = DIM; hx.fillText(spdUnit(units), 0, R * .78);
      hx.font = Fo.gear; hx.fillStyle = PV.gear === -1 ? GOLD : PV.shift > 0 ? DIM : ACCENT; hx.fillText(PV.gear === -1 ? 'R' : String(PV.gear), 0, -R * .2);
      if (P.turbo) { hx.fillStyle = 'rgba(255,255,255,.12)'; hx.fillRect(-R * .4, R * .88, R * .8, 5); hx.fillStyle = BLUE; hx.fillRect(-R * .4, R * .88, R * .8 * PV.boost, 5); hx.fillStyle = DIM; hx.font = Fo.boost; hx.fillText('BOOST', 0, R * .88 + 14); }
      hx.restore();
      if (P.nos.cap > 0) { hx.font = Fo.nos; hx.fillStyle = PV.nosOn ? ACCENT_HI : ACCENT; hx.textAlign = 'center'; hx.fillText('NITROUS', cx, cy - R - 24); }
      if (s.manual && PV.rpm > red * .9 && PV.gear < P.gears.length) { const now = s.now ?? (typeof performance !== 'undefined' ? performance.now() : 0); hx.font = Fo.shift; hx.fillStyle = Math.sin(now / 60) > 0 ? RED : '#fff'; hx.textAlign = 'center'; hx.fillText('SHIFT', cx, cy - R - (small ? 44 : 50)); }
    }
    if (!strip) return;
    /* top-left: cash / event info */
    const lx = small ? 16 : 34, ty = (small ? 14 : 24) + insT;
    hx.textAlign = 'left'; hx.textBaseline = 'top'; hx.font = Fo.cash; hx.fillStyle = GOLD; hx.fillText(moneyStr(s.money), lx, ty);
    if (a && (a.state === 'race' || a.state === 'done')) {
      const st = s.standings; let me = -1; for (let i = 0; i < st.length; i++) if (st[i].me) { me = i; break; }
      const pos = me + 1, y = ty + (small ? 30 : 38), n = Math.max(1, st.length);
      hx.font = Fo.big; hx.fillStyle = '#fff';
      if (a.type === 'drift') {
        const D = a.drift; hx.fillText(Math.round(D.score).toLocaleString('en-US'), lx, y);
        hx.font = Fo.sub; hx.fillStyle = DIM; hx.fillText('DRIFT SCORE · POS ' + pos + '/' + n + ' · LAP ' + Math.min(a.laps, a.pLap + 1) + '/' + a.laps, lx, y + (small ? 38 : 50));
        if (D.cur > 0) { hx.font = Fo.driftCur; hx.fillStyle = BLUE; hx.textAlign = 'center'; hx.fillText(Math.round(D.cur).toLocaleString('en-US') + (D.mult > 1 ? '  x' + D.mult : ''), HW / 2, ty + (small ? 64 : 78)); }
      } else {
        hx.fillText(pos + '/' + n, lx, y);
        hx.font = Fo.sub; hx.fillStyle = DIM; const lapTxt = a.route.loop && a.type !== 'drag' ? 'LAP ' + Math.min(a.laps, a.pLap + 1) + '/' + a.laps + ' · ' : ''; hx.fillText(lapTxt + fmtT(a.time), lx, y + (small ? 38 : 50));
        if (a.type !== 'drag' && st.length > 1 && me >= 0) { const lead = st[0].me ? st[1] : st[0]; const gap = (st[me].s ?? 0) - (lead.s ?? 0); hx.fillText((gap >= 0 ? '+' : '') + Math.round(gap) + ' m to ' + (gap >= 0 ? '2nd' : 'leader'), lx, y + (small ? 54 : 70)); }
      }
      hx.textAlign = 'left';
    }
    if (outrun) {
      const g = clamp(outrun.gap / 300, -1, 1); const w = small ? 200 : 300, x = HW / 2 - w / 2, y = ty + (small ? 4 : 10);
      hx.fillStyle = 'rgba(14,18,23,.6)'; hx.fillRect(x - 8, y - 6, w + 16, 34); hx.fillStyle = 'rgba(255,255,255,.12)'; hx.fillRect(x, y + 10, w, 8);
      hx.fillStyle = g >= 0 ? '#8cff5a' : '#ff4d5e'; hx.fillRect(x + w / 2, y + 10, g * w / 2, 8);
      hx.fillStyle = '#fff'; hx.font = F_OUT; hx.textAlign = 'center'; hx.fillText('OUTRUN ' + outrun.A.name.toUpperCase() + '  ' + (outrun.gap >= 0 ? '+' : '') + distStr(outrun.gap, units), HW / 2, y - 4); hx.textAlign = 'left';
    }
    /* checkpoint / gps arrow */
    let tx = 0, tz = 0, label = '', has = false;
    if (a && a.state === 'race' && a.type !== 'drag') { const k = a.pCp % a.route.nodes.length; const nd = a.route.nodes[k]; tx = nd[0] * CELL; tz = nd[1] * CELL; label = k === 0 ? 'FINISH LINE' : 'CHECKPOINT'; has = true; }
    else if (!a && s.gps) { tx = s.gps.node[0] * CELL; tz = s.gps.node[1] * CELL; label = s.gps.label; has = true; }
    if (has) {
      const dx = tx - PV.x, dz = tz - PV.z, dist = Math.hypot(dx, dz); const an = Math.atan2(dx, dz) - PV.h;
      hx.save(); hx.translate(HW / 2, ty + (small ? 14 : 22)); hx.rotate(-an); hx.fillStyle = ACCENT; hx.beginPath(); hx.moveTo(0, -16); hx.lineTo(11, 10); hx.lineTo(0, 4); hx.lineTo(-11, 10); hx.closePath(); hx.fill(); hx.restore();
      hx.font = Fo.sub; hx.fillStyle = INK; hx.textAlign = 'center'; hx.fillText(label + ' · ' + distStr(dist, units), HW / 2, ty + (small ? 34 : 46)); hx.textAlign = 'left';
    }
    /* drag tach */
    if (a && a.type === 'drag') {
      const w = Math.min(HW - 40, 560), x = HW / 2 - w / 2, y = HH - (small ? (s.touch ? 200 : 70) : 90) - insB;
      hx.fillStyle = 'rgba(14,18,23,.7)'; hx.fillRect(x - 14, y - 54, w + 28, 96);
      const X = (r: number) => x + clamp(r / maxR, 0, 1) * w;
      hx.fillStyle = 'rgba(255,255,255,.1)'; hx.fillRect(x, y, w, 22);
      hx.fillStyle = 'rgba(140,255,90,.35)'; hx.fillRect(X(red * .9), y, X(red + 150) - X(red * .9), 22);
      hx.fillStyle = 'rgba(255,60,80,.45)'; hx.fillRect(X(red + 150), y, X(maxR) - X(red + 150), 22);
      const frac = PV.rpm / maxR; const grd = hx.createLinearGradient(x, 0, x + w, 0); grd.addColorStop(0, BLUE); grd.addColorStop(.7, ACCENT); grd.addColorStop(1, '#ff3b5c'); hx.fillStyle = grd; hx.fillRect(x, y + 4, w * clamp(frac, 0, 1), 14);
      hx.font = F_DRAG_T; hx.textAlign = 'center';
      for (let r = 0; r <= maxR; r += 1000) { hx.fillStyle = INK; hx.fillRect(X(r), y - 6, 1.5, 34); hx.fillText(String(r / 1000), X(r), y + 40); }
      hx.fillStyle = '#fff'; hx.font = F_DRAG_BIG; hx.textAlign = 'left'; hx.fillText(PV.gear === -1 ? 'R' : String(PV.gear), x, y - 14);
      hx.textAlign = 'right'; hx.fillText(String(spdNum(kmh, units)), x + w, y - 14); hx.font = F_DRAG_SUB; hx.fillStyle = DIM; hx.fillText(spdUnit(units) + ' · ' + Math.round(PV.rpm) + ' RPM', x + w, y - 2);
      hx.textAlign = 'center'; hx.fillStyle = PV.perfectT > 0 ? '#8cff5a' : DIM; hx.font = F_DRAG_MSG; hx.fillText(PV.perfectT > 0 ? 'PERFECT SHIFT' : 'SHIFT IN THE GREEN · ← → CHANGE LANE', HW / 2, y - 20);
      if (P.nos.cap > 0) { hx.fillStyle = 'rgba(255,210,63,.2)'; hx.fillRect(x, y + 30, w, 4); hx.fillStyle = ACCENT; hx.fillRect(x, y + 30, w * PV.nos / P.nos.cap, 4); }
      hx.textAlign = 'left';
    }
    /* minimap */
    const mr = small ? 56 : 84, mx = mr + (small ? 16 : 34), my = small ? mr + 16 + insT + (a || outrun ? 74 : 50) : HH - mr - 34 - insB;
    hx.save(); hx.translate(mx, my); hx.beginPath(); hx.arc(0, 0, mr, 0, 7); hx.fillStyle = 'rgba(14,18,23,.7)'; hx.fill(); hx.clip();
    const sc = small ? .3 : .4; hx.rotate(Math.PI + PV.h); hx.scale(sc, sc); hx.translate(-PV.x, -PV.z);
    hx.strokeStyle = 'rgba(150,170,200,.45)'; hx.lineWidth = RW * .8; hx.beginPath(); for (let i = 0; i <= N; i++) { hx.moveTo(i * CELL, -RW); hx.lineTo(i * CELL, SPAN + RW); hx.moveTo(-RW, i * CELL); hx.lineTo(SPAN + RW, i * CELL); } hx.stroke();
    if (a && a.type !== 'drag') { hx.strokeStyle = EV_COL[a.type]; hx.lineWidth = 6; hx.beginPath(); const pts = a.route.pts; for (let i = 0; i < pts.length; i++) i ? hx.lineTo(pts[i][0], pts[i][1]) : hx.moveTo(pts[i][0], pts[i][1]); if (a.route.loop) hx.closePath(); hx.stroke(); }
    else if (!a && s.gps && s.gps.path.length) { hx.strokeStyle = ACCENT; hx.lineWidth = 7; hx.beginPath(); const p = s.gps.path; for (let i = 0; i < p.length; i++) i ? hx.lineTo(p[i][0] * CELL, p[i][1] * CELL) : hx.moveTo(p[i][0] * CELL, p[i][1] * CELL); hx.stroke(); }
    if (!a) { const stg = s.stage ?? Infinity; for (const m of s.markers) { if (m.ev.stage > stg) continue; hx.fillStyle = EV_COL[m.ev.type]; hx.beginPath(); hx.arc(m.x, m.z, 9, 0, 7); hx.fill(); } }
    for (const c of s.ais) { if (c.parked) continue; if (Math.abs(c.x - PV.x) > 400 || Math.abs(c.z - PV.z) > 400) continue; hx.fillStyle = c.kind === 'racer' ? CHROME : c.kind === 'rival' ? BLUE : '#ff6a6a'; hx.beginPath(); hx.arc(c.x, c.z, c.kind === 'traffic' ? 5 : 7, 0, 7); hx.fill(); }
    if (a && a.type === 'drag') for (const o of a.drag.ai) { hx.fillStyle = CHROME; hx.beginPath(); hx.arc(o.V.x, o.V.z, 7, 0, 7); hx.fill(); }
    hx.restore();
    hx.save(); hx.translate(mx, my); hx.fillStyle = ACCENT; hx.beginPath(); hx.moveTo(0, -9); hx.lineTo(6, 7); hx.lineTo(0, 3); hx.lineTo(-6, 7); hx.closePath(); hx.fill(); hx.strokeStyle = 'rgba(255,210,63,.5)'; hx.lineWidth = 2; hx.beginPath(); hx.arc(0, 0, mr, 0, 7); hx.stroke(); hx.restore();
  }
}
