/* Night Tuner 06-events.js — races: sprint, circuit, street X, drag, drift; outrun; results.
   A pure state machine in metres: no THREE, no DOM. Banners, sounds, racer meshes, the checkpoint mark,
   the career stage and the style rating come in through `EventFx`. Racer meshes are opaque handles;
   the renderer places them from the AI / drag-car state. Payout is not here (server side, later). */
import { clamp, makeVehicle, NO_INPUT, resetVehicle, simStats, stepVehicle, type Input, type Params, type Vehicle } from '../physics';
import { CATS, PALETTE, STOCK_CFG, type CarCfg, type EventDef, type EventType, type VisualCfg } from '../data';
import { cpPoint, routePoint, routeProgress, snapToRoad, type RoadData, type Route } from './routes';
import { HUB, routeFor } from './district';
import { hubPoint } from './roadGraph';
import { makeAI, parkAI, separateAIs, setWander, stepAI, type AI } from './ai';
import { LIGHTS, NET_HOLD_S, lightsLit, soloCountLen, soloHold, usesLights } from './lights';
import { RaceTiming, withTiming } from './timing';

export type { EventType };

export type EventFx = {
  banner(txt: string, bad?: boolean, hold?: boolean): void;
  sfx(name: string): void;
  /** a racer's car; with `who` (a person in a challenge) that body style, with the name over it */
  spawnRacerMesh(cfg: VisualCfg, who?: { style: string; name: string }): unknown;
  disposeMesh(m: unknown): void;
  placeCp(p: { x: number; z: number } | null, tangent?: { tx: number; tz: number }): void;
  stage(): number;
  styleRating(): number;
};

/** `key`: the car in the race's timing ('me', 'r0'.., 'p:<pid>'); `best`: its best lap (s); `gap`: seconds to the leader (null: the leader, or not known) */
export type Standing = { name: string; me?: boolean; ft?: number | null; s?: number; score?: number; estimated?: boolean; key?: string; color?: string; best?: number | null; gap?: number | null };
/** `remote`: a person in a challenge (`pid`), whose state comes from the network: never stepped, never estimated. */
export type Racer = AI & { estimated?: boolean; remote?: boolean; pid?: string; key?: string; color?: string };
/** A challenge race: the field the room made, and the clock its racers share. */
export type NetField = {
  /** my place on the grid, 0..3 (a drag: my lane) */
  slot: number;
  others: { id: string; name: string; slot: number; color: string; style: string }[];
  /** the green light, in ms on `now`'s clock; null until the server has named it */
  goAt(): number | null;
  now(): number;
};
export type DragCar = { V: Vehicle; m: unknown; lane: number; s: number; ft: number | null; react: number; name: string; crash: boolean; estimated?: boolean };
export type DragTraffic = { A: AI; s: number; lane: number; v: number };
export type ActiveEvent = {
  ev: EventDef; route: Route; laps: number; type: EventType; state: 'count' | 'race' | 'done'; t: number; time: number;
  racers: Racer[]; pS: number; pMax: number; pLap: number; pCp: number; wrong: number; pFt: number | null;
  results: Standing[] | null; quick: boolean; retT: number; fail: string | null; target: number;
  drift: { cur: number; score: number; mult: number; dT: number; idle: number; lastBank: number };
  drag: { lane: number; trafficA: DragTraffic[]; ai: DragCar[]; dir: number; fwd: [number, number]; right: [number, number]; p0: { x: number; z: number } | null; perfSeen?: number };
  startX?: number; startZ?: number; lastB?: string; wrongShown?: boolean;
  /** a challenge (the other cars are people), and its green light once the count has begun */
  net: NetField | null; go: number | null;
  /** a lap race's start lights: how many are on (null: a challenge still waiting for its green), seconds to the
   *  green, the hold after the fifth, and the count's whole length (for the camera's sweep). Unused by drag and drift. */
  lit: number | null; goIn: number; hold: number; countLen: number;
  /** lap, sector and gap timing for a lap race (null for drag and drift) */
  timing: RaceTiming | null;
};
export type Outrun = { A: AI; t: number; gap: number; state: 'run' | 'done'; t2?: number };
export type EventResults = { pos: number; list: Standing[]; failed: string | null; type: EventType; ev: EventDef; time: number | null; score: number };

export const DRAG_LANES = [-6, -2, 2, 6];
/** The lane each place of a challenge takes: the middle two first, so two people race side by side and nobody starts on the tarmac's edge until a third comes. */
const NET_LANES = [1, 2, 0, 3];
/** A race (not a drift) auto-finishes after this many seconds: the larger of 600 s and 60 s plus 1 s per 8 m of the event (Ardennes GP, 13.9 km: about 30 min). */
export function raceCapS(targetM: number): number { return Math.max(600, 60 + targetM / 8); }
const AI_NAMES = ['Rico', 'Nadia', 'Vince', 'Tam', 'Lola', 'Jet', 'Suki', 'Bram'];
const clone = <T>(o: T): T => JSON.parse(JSON.stringify(o)) as T;

export function randomCfg(): CarCfg {
  const c = clone(STOCK_CFG); c.color = PALETTE[Math.floor(Math.random() * PALETTE.length)][0];
  c.finish = (['gloss', 'metallic', 'pearl', 'candy'] as const)[Math.random() * 4 | 0]; c.rim = CATS.rim.items[1 + Math.random() * 5 | 0].v as CarCfg['rim']; c.rimSize = 18;
  c.spoiler = (Math.random() * 5 | 0) as CarCfg['spoiler']; c.front = (Math.random() * 4 | 0) as CarCfg['front']; c.rear = (Math.random() * 3 | 0) as CarCfg['rear']; c.skirts = (Math.random() * 3 | 0) as CarCfg['skirts'];
  c.hood = (Math.random() * 4 | 0) as CarCfg['hood']; c.vinyl = (Math.random() * 5 | 0) as CarCfg['vinyl']; c.vinylColor = CATS.vinylColor.items[Math.random() * 7 | 0].v as string; c.tint = 2;
  if (Math.random() < .5) c.neon = CATS.neon.items[1 + Math.random() * 6 | 0].v as string;
  return c;
}
export function playerTopMs(P: Params): number { return simStats(P).top / 3.6; }
export function playerAccel(P: Params): number { const st = simStats(P); return st.t100 ? 100 / 3.6 / st.t100 : 3; }

export function sortStandings<T extends Standing>(list: T[], type: EventType): T[] {
  if (type === 'drift') list.sort((p, q) => (q.score ?? 0) - (p.score ?? 0));
  else list.sort((p, q) => { const pf = p.ft == null ? Infinity : p.ft, qf = q.ft == null ? Infinity : q.ft; if (pf !== qf) return pf - qf; return (q.s || 0) - (p.s || 0); });
  return list;
}

export class EventRunner {
  active: ActiveEvent | null = null;
  constructor(public PV: Vehicle, public ais: AI[], public fx: EventFx, public playerParams: () => Params, public roads: () => RoadData[] = () => HUB.roads) {}

  start(ev: EventDef, opts: { quick?: boolean; net?: NetField } = {}): void {
    const PV = this.PV, fx = this.fx;
    if (this.active) this.cleanup();
    const route = routeFor(ev.id);
    const a: ActiveEvent = this.active = { ev, route, laps: ev.laps || 1, type: ev.type, state: 'count', t: 3.6, time: 0, racers: [], pS: 0, pMax: 0, pLap: 0, pCp: 1, wrong: 0, pFt: null, results: null, quick: !!opts.quick, retT: 0, fail: null, target: 0,
      drift: { cur: 0, score: 0, mult: 1, dT: 0, idle: 0, lastBank: 0 }, drag: { lane: 1, trafficA: [], ai: [], dir: 0, fwd: [0, 1], right: [1, 0], p0: null }, net: opts.net ?? null, go: null, lit: null, goIn: 0, hold: 0, countLen: 0, timing: null };
    const net = a.net, gridOf = (slot: number) => clamp(Math.floor(slot) || 0, 0, 3);
    a.target = route.loop ? route.len * a.laps : route.len;
    a.timing = usesLights(ev.type) ? new RaceTiming(route.len, route.loop) : null;
    const p0 = routePoint(route, 0), fwd: [number, number] = [p0.tx, p0.tz], right: [number, number] = [-p0.tz, p0.tx]; const dir = Math.atan2(fwd[0], fwd[1]);
    const place = (lane: number, back: number) => ({ x: p0.x + right[0] * lane + fwd[0] * back, z: p0.z + right[1] * lane + fwd[1] * back });
    const st = fx.stage();
    // traffic
    for (const A of this.ais) { if (A.kind === 'traffic' || A.kind === 'rival') { if (ev.noTraffic || ev.type === 'drag') parkAI(A); else A.hold = false; } }
    if (ev.type === 'drag') {
      a.drag.dir = dir; a.drag.fwd = fwd; a.drag.right = right; a.drag.p0 = p0;
      const slots = [0, 1, 2, 3]; const my = net ? NET_LANES[gridOf(net.slot)] : Math.floor(Math.random() * 4); a.drag.lane = my;
      const pp = place(DRAG_LANES[my], 0); resetVehicle(PV, pp.x, pp.z, dir); PV.nos = PV.P.nos.cap;
      if (net) for (const o of net.others) this.addPerson(a, o, place(DRAG_LANES[NET_LANES[gridOf(o.slot)]], 0), dir);
      else for (const li of slots) {
        if (li === my) continue;
        const P = { ...this.playerParams() }; P.tqMul *= (.86 + .05 * st + Math.random() * .06); P.peakT *= P.tqMul; const AV = makeVehicle(P); const pp2 = place(DRAG_LANES[li], 0); resetVehicle(AV, pp2.x, pp2.z, dir);
        const m = fx.spawnRacerMesh(randomCfg());
        a.drag.ai.push({ V: AV, m, lane: li, s: 0, ft: null, react: .15 + Math.random() * .4, name: AI_NAMES[(li * 2 + Math.random() * 2) | 0], crash: false });
      }
      // lane traffic only on an event that allows it (every library event is noTraffic: closed circuits)
      const tr = ev.noTraffic ? [] : this.ais.filter(A => A.kind === 'traffic').slice(0, 6); let s = 70;
      for (const A of tr) { A.parked = false; A.hold = true; a.drag.trafficA.push({ A, s, lane: Math.floor(Math.random() * 4), v: 10 + Math.random() * 3 }); s += 55 + Math.random() * 50; }
    } else {
      const slots = [[-3, 0], [3, 0], [-3, -8], [3, -8]]; const my = net ? gridOf(net.slot) : Math.floor(Math.random() * 4);
      const pp = place(slots[my][0], slots[my][1]); resetVehicle(PV, pp.x, pp.z, dir); PV.nos = PV.P.nos.cap;
      const top = playerTopMs(PV.P), acc = playerAccel(PV.P);
      if (net) for (const o of net.others) { const sl = slots[gridOf(o.slot)]; this.addPerson(a, o, place(sl[0], sl[1]), dir); }
      else slots.forEach((sl, i) => {
        if (i === my) return; const cfg = randomCfg(), m = fx.spawnRacerMesh(cfg);
        const A: Racer = makeAI({ m, kind: 'racer', route, lane: sl[0] * .9, vmax: top * (.74 + .06 * st) * (.96 + Math.random() * .08), acc: acc * 1.1, brk: 10, name: AI_NAMES[(i * 2 + Math.random() * 2) | 0], hold: true });
        A.key = 'r' + i; A.color = cfg.color;
        const q = place(sl[0], sl[1]); A.x = q.x; A.z = q.z; A.h = dir; A.s = routeProgress(route, A.x, A.z, 0, 30).s; A.ft = null; A.laps = 0; A.done = false; a.racers.push(A); this.ais.push(A);
      });
    }
    a.pS = routeProgress(route, PV.x, PV.z, 0, 30).s; a.pMax = a.pS;
    this.placeCpMark();
    if (usesLights(ev.type)) {
      if (net) { a.hold = NET_HOLD_S; a.countLen = LIGHTS; } // lit stays null until the server has named the green
      else { a.hold = soloHold(Math.random); a.countLen = soloCountLen(a.hold); a.goIn = a.countLen; a.lit = 0; }
    } else if (!net) { fx.banner('3'); fx.sfx('beep'); } // a challenge counts only once the server has named the green light
  }
  /** A person in a challenge, on their grid place: a racer this browser never drives (the scene places it from the network). */
  private addPerson(a: ActiveEvent, o: NetField['others'][number], at: { x: number; z: number }, dir: number): void {
    const m = this.fx.spawnRacerMesh({ ...STOCK_CFG, color: o.color }, { style: o.style, name: o.name });
    const A: Racer = makeAI({ m, kind: 'racer', route: a.route, lane: 0, name: o.name, hold: true });
    A.remote = true; A.pid = o.id; A.key = 'p:' + o.id; A.color = o.color; A.x = at.x; A.z = at.z; A.h = dir;
    A.s = a.type === 'drag' ? 0 : routeProgress(a.route, A.x, A.z, 0, 30).s; A.ft = null; A.laps = 0; A.done = false;
    a.racers.push(A); this.ais.push(A);
  }
  /** A person in the challenge is home in `ft` seconds; or (null) is out of the race, and their car leaves the track. */
  remoteDone(pid: string, ft: number | null): void {
    const R = this.active?.racers.find(r => r.remote && r.pid === pid); if (!R) return;
    R.done = true; R.ft = ft; if (ft == null) parkAI(R);
  }

  private placeCpMark(): void {
    const a = this.active; if (!a) return; const r = a.route;
    if (a.type === 'drag' || (a.state !== 'race' && a.state !== 'count')) { this.fx.placeCp(null); return; }
    const q = routePoint(r, r.cps[a.pCp % r.cps.length]);
    this.fx.placeCp(cpPoint(r, a.pCp % r.cps.length), { tx: q.tx, tz: q.tz });
  }
  private dragLat(): number { const d = this.active!.drag; return (this.PV.x - d.p0!.x) * d.right[0] + (this.PV.z - d.p0!.z) * d.right[1]; }
  private dragS(x: number, z: number): number { const d = this.active!.drag; return (x - d.p0!.x) * d.fwd[0] + (z - d.p0!.z) * d.fwd[1]; }

  /* called each physics step with the player's raw input; returns the input the car should get */
  input(I: Input, _dt: number): Input {
    const a = this.active; if (!a) return I;
    if (a.state === 'count') { const J = Object.assign({}, I, { steer: 0, hb: false, nos: false }); J.fwd = I.fwd; return J; }
    if (a.type === 'drag') { const J = Object.assign({}, I, { steer: 0, hb: false, manual: true }); return J; }
    return I;
  }
  postStep(dt: number): void {
    const a = this.active, PV = this.PV; if (!a) return;
    if (a.state === 'count') { PV.u = PV.v = PV.w = PV.vx = PV.vz = 0; PV.x = a.startX != null ? a.startX : (a.startX = PV.x); PV.z = a.startZ != null ? a.startZ : (a.startZ = PV.z); return; }
    if (a.type === 'drag' && a.state === 'race') {
      const d = a.drag; PV.h = d.dir; PV.v = 0; PV.w = 0; PV.vx = d.fwd[0] * PV.u; PV.vz = d.fwd[1] * PV.u;
      const lat = this.dragLat(), tgt = DRAG_LANES[d.lane]; const nl = lat + clamp(tgt - lat, -7 * dt, 7 * dt); PV.x += d.right[0] * (nl - lat); PV.z += d.right[1] * (nl - lat);
    }
  }
  dragLane(dir: -1 | 1): void { const a = this.active; if (!a || a.type !== 'drag' || a.state !== 'race') return; a.drag.lane = clamp(a.drag.lane + dir, 0, 3); }

  update(dt: number): void {
    const a = this.active, fx = this.fx; if (!a) return;
    if (a.state === 'count') {
      if (usesLights(a.type)) { this.countLights(dt); return; }
      let n: number, off: boolean;
      if (a.net) {
        // a challenge: everyone's count ends at the one instant the server named, whatever this browser's frame rate
        const g = a.net.goAt(); if (g == null) return;   // on the grid, the others still loading
        const ms = g - a.net.now(); if (ms > 3000) return; // named, but the count is three seconds long
        a.go = g; a.t = .6 + ms / 1000; n = Math.ceil(ms / 1000); off = ms <= 0;
      } else { a.t -= dt; n = Math.ceil(a.t - .6); off = a.t <= .6; }
      const txt = n >= 1 ? String(n) : 'GO'; if (txt !== a.lastB) { a.lastB = txt; fx.banner(txt); fx.sfx(n >= 1 ? 'beep' : 'go'); }
      if (off) { a.state = 'race'; a.time = 0; for (const r of a.racers) r.hold = false; this.placeCpMark(); }
      return;
    }
    if (a.state === 'race') {
      // a challenge is timed on the wall clock from the shared green light: a pause or a slow frame costs real time
      a.time = a.net && a.go != null ? (a.net.now() - a.go) / 1000 : a.time + dt;
      if (a.type === 'drag') this.updateDrag(dt); else this.updateRace(dt); return;
    }
    if (a.state === 'done') { a.retT += dt; if (a.retT > 1.4 && !a.results) this.results(); }
  }
  /** A lap race's count: the lights come on one a second and never go back; all out is the green. */
  private countLights(dt: number): void {
    const a = this.active!, fx = this.fx;
    if (a.net) {
      const g = a.net.goAt(); if (g == null) return;      // on the grid, the others still loading
      const ms = g - a.net.now(); if (ms > LIGHTS * 1000) return; // named, but the lights take five seconds
      a.go = g; a.goIn = ms / 1000;
    } else a.goIn -= dt;
    const was = a.lit ?? 0, lit = Math.max(was, lightsLit(a.goIn, a.hold));
    if (lit > was) fx.sfx('beep');
    a.lit = lit;
    if (a.goIn <= 0) { a.state = 'race'; a.time = 0; a.lit = 0; for (const r of a.racers) r.hold = false; this.placeCpMark(); fx.sfx('go'); }
  }
  private updateRace(dt: number): void {
    const a = this.active!, r = a.route, drift = a.type === 'drift', PV = this.PV, fx = this.fx;
    const pr = routeProgress(r, PV.x, PV.z, a.pS + PV.u * dt, 45); a.pS = pr.s;
    if (a.pS > a.pMax) a.pMax = a.pS;
    a.timing?.step('me', a.pS, a.time);
    a.wrong = (a.pMax - a.pS > 14) ? a.wrong + dt : 0;
    if (a.wrong > .6 && !a.wrongShown) { a.wrongShown = true; fx.banner('Wrong way', true, true); } else if (a.wrong <= 0 && a.wrongShown) { a.wrongShown = false; fx.banner(''); }
    // checkpoints / laps
    const nCp = r.cps.length; const cpS = a.pCp < nCp ? a.pLap * r.len + r.cps[a.pCp] : (a.pLap + 1) * r.len;
    if (a.pS >= cpS - 1) {
      if (!r.loop) { if (a.pCp >= nCp - 1) return this.playerFinish(); a.pCp++; fx.sfx('cp'); }
      else if (a.pCp >= nCp) { a.pLap++; a.pCp = 1; if (a.pLap >= a.laps) return this.playerFinish(); fx.banner('Lap ' + (a.pLap + 1) + '/' + a.laps); fx.sfx('cp'); }
      else { a.pCp++; fx.sfx('cp'); }
      this.placeCpMark();
    }
    // racers
    for (const R of a.racers) {
      if (R.done) continue;
      if (R.remote) { if (R.key) a.timing?.step(R.key, R.s, a.time); continue; } // a person: placed from the network by the scene
      stepAI(R, dt, a.pS, fx.stage()); const tot = R.s; if (R.key) a.timing?.step(R.key, tot, a.time); if (tot >= a.target - 1) { R.done = true; R.ft = a.time; R.v *= .5; }
      if (drift) { R.score += dt * (90 + 55 * fx.stage()) * (.6 + .8 * Math.random()) * (R.v > 8 ? 1 : 0); }
    }
    if (!a.net) separateAIs(a.racers);
    if (drift) this.updateDrift(dt);
    if (!a.net && a.type !== 'drift' && a.time > raceCapS(a.target)) this.playerFinish(); // a challenge is closed by its room, not by a cap here
  }
  private playerFinish(): void {
    const a = this.active!; a.pFt = a.time; a.state = 'done'; a.retT = 0; this.fx.placeCp(null); this.fx.banner('Finish'); this.fx.sfx('finish');
    for (const R of a.racers) { if (R.remote) continue; if (R.ft == null) { R.ft = a.time + Math.max(0, a.target - R.s) / Math.max(6, R.vmax * .8); R.estimated = true; } R.hold = true; }
    for (const A of this.ais) if (A.kind === 'traffic' || A.kind === 'rival') A.hold = false;
    if (a.type === 'drift') { this.bankDrift(true); }
    this.onFinish?.(a);
  }
  private updateDrift(dt: number): void {
    const D = this.active!.drift, PV = this.PV; const spd = Math.abs(PV.u) * 3.6, ang = Math.abs(PV.beta);
    if (PV.hit > 4) { if (D.cur > 0) { this.fx.banner('Crash: drift lost', true); this.fx.sfx('no'); } D.cur = 0; D.mult = 1; D.dT = 0; PV.hit = 0; }
    if (spd > 25 && ang > .17) { D.cur += spd * ang * dt * 3.4; D.dT += dt; D.idle = 0; D.mult = 1 + Math.min(5, Math.floor(D.dT / 2.5)); }
    else { D.idle += dt; if (D.idle > .7 && D.cur > 0) this.bankDrift(false); if (D.idle > 3) D.mult = 1; }
  }
  private bankDrift(final: boolean): void {
    const D = this.active!.drift;
    if (D.cur > 0) { const b = Math.round(D.cur * D.mult); D.score += b; D.lastBank = b; this.fx.sfx('ok'); if (!final) this.fx.banner('+' + b.toLocaleString('en-US') + (D.mult > 1 ? '  x' + D.mult : '')); }
    D.cur = 0; D.dT = 0;
  }
  private updateDrag(dt: number): void {
    const a = this.active!, d = a.drag, PV = this.PV, fx = this.fx, p0 = d.p0!;
    const s = this.dragS(PV.x, PV.z); a.pS = s;
    if (PV.overRev > 1.5 && !PV.blown) { PV.blown = true; a.fail = 'Engine blown'; fx.banner('Engine blown', true, true); fx.sfx('no'); return this.dragEnd(); }
    const lat = this.dragLat();
    for (const t of d.trafficA) {
      t.s += t.v * dt; const p = { x: p0.x + d.fwd[0] * t.s + d.right[0] * DRAG_LANES[t.lane], z: p0.z + d.fwd[1] * t.s + d.right[1] * DRAG_LANES[t.lane] }; t.A.x = p.x; t.A.z = p.z; t.A.h = d.dir; t.A.v = t.v;
      if (Math.abs(t.s - s) < 4.4 && Math.abs(DRAG_LANES[t.lane] - lat) < 2.3 && !a.fail) { a.fail = 'Crashed into traffic'; fx.banner('Crashed', true, true); fx.sfx('crash'); PV.u *= .2; PV.vx = d.fwd[0] * PV.u; PV.vz = d.fwd[1] * PV.u; return this.dragEnd(); }
    }
    for (const o of d.ai) {
      if (o.ft != null) continue; const AV = o.V; o.react -= dt; const I: Input = Object.assign({}, NO_INPUT, { fwd: o.react <= 0 ? 1 : 0, manual: true, shiftUp: AV.rpm > AV.P.redline * .95 && AV.shift <= 0, nos: o.s > 60 && AV.gear >= 3 });
      stepVehicle(AV, I, dt, false); AV.h = d.dir; AV.v = 0; AV.w = 0; AV.vx = d.fwd[0] * AV.u; AV.vz = d.fwd[1] * AV.u; o.s = this.dragS(AV.x, AV.z);
      AV.x = p0.x + d.fwd[0] * o.s + d.right[0] * DRAG_LANES[o.lane]; AV.z = p0.z + d.fwd[1] * o.s + d.right[1] * DRAG_LANES[o.lane];
      if (o.s >= a.route.len) o.ft = a.time;
    }
    if ((PV.perfectN || 0) !== (d.perfSeen || 0)) { d.perfSeen = PV.perfectN; fx.banner('Perfect shift'); fx.sfx('perfect'); }
    if (s >= a.route.len) return this.dragEnd();
  }
  private dragEnd(): void {
    const a = this.active!; a.pFt = a.fail ? null : a.time; a.state = 'done'; a.retT = 0; this.fx.banner(a.fail ? a.fail : 'Finish', !!a.fail, true); if (!a.fail) this.fx.sfx('finish');
    for (const o of a.drag.ai) if (o.ft == null) { const rem = Math.max(0, a.route.len - o.s); o.ft = a.time + rem / Math.max(10, Math.abs(o.V.u)); o.estimated = true; }
    this.onFinish?.(a);
  }

  standings(): Standing[] {
    const a = this.active; if (!a) return []; let list: Standing[];
    if (a.type === 'drag') list = [{ name: 'You', me: true, ft: a.pFt, s: a.pS }, ...a.drag.ai.map(o => ({ name: o.name, ft: o.ft, s: o.s, estimated: o.estimated })), ...a.racers.map(r => ({ name: r.name, ft: r.ft, s: r.s }))];
    else if (a.type === 'drift') list = [{ name: 'You', me: true, score: Math.round(a.drift.score + a.drift.cur * a.drift.mult) }, ...a.racers.map(r => ({ name: r.name, score: Math.round(r.score) }))];
    else list = [{ name: 'You', me: true, ft: a.pFt, s: a.pS, key: 'me' }, ...a.racers.map(r => ({ name: r.name, ft: r.ft, s: r.s, estimated: r.estimated, key: r.key, color: r.color }))];
    const sorted = sortStandings(list, a.type);
    return a.timing ? withTiming(sorted, a.timing, a.time) : sorted;
  }
  /* showResults without the DOM and the payout: freezes the standings once and reports them */
  results(): EventResults | null {
    const a = this.active; if (!a) return null;
    if (!a.results) { a.results = this.standings(); this.fx.banner(''); }
    const list = a.results; const pos = list.findIndex(p => p.me) + 1;
    return { pos, list, failed: a.fail, type: a.type, ev: a.ev, time: a.pFt, score: list.find(p => p.me)?.score ?? 0 };
  }
  /** Called once when the player's run ends, at the line or by failing (a blown engine): before the pause that precedes the results. */
  onFinish?: (a: ActiveEvent) => void;
  /** Called once when a live event ends without results (R, leaving the Strip, a new start): the server drops its entry. */
  onAbandon?: (ev: EventDef) => void;
  /** Called once whenever a live event ends (every path goes through cleanup): the scene drops its route ribbon. */
  onCleanup?: () => void;
  cleanup(): void {
    const a = this.active; if (!a) return;
    if (!a.results) this.onAbandon?.(a.ev);
    for (const R of a.racers) { const i = this.ais.indexOf(R); if (i >= 0) this.ais.splice(i, 1); this.fx.disposeMesh(R.m); }
    for (const o of a.drag.ai) this.fx.disposeMesh(o.m);
    for (const t of a.drag.trafficA) { setWander(t.A, hubPoint()); }
    for (const A of this.ais) { if ((A.kind === 'traffic' || A.kind === 'rival') && A.parked) setWander(A, hubPoint()); A.hold = false; }
    this.fx.placeCp(null); this.fx.banner(''); this.active = null;
    this.onCleanup?.();
  }
  quit(): void { this.cleanup(); snapToRoad(this.PV, this.roads()); }
}

/** How far the count has run, 0..1, for the camera's sweep along the route before the start. */
export function countProgress(a: ActiveEvent): number {
  if (!usesLights(a.type)) return (3.6 - a.t) / 3;
  if (a.lit == null || a.countLen <= 0) return 0;
  return clamp(1 - a.goIn / a.countLen, 0, 1);
}
/** Whether the count has begun (a challenge waits for the server's green before it does). */
export function countBegun(a: ActiveEvent): boolean { return usesLights(a.type) ? a.lit !== null : a.lastB !== undefined; }

/* ---- free roam: markers, outrun. The caller skips these while an event or an outrun is running. ---- */
export function nearEvent(PV: Vehicle, markers: { ev: EventDef; x: number; z: number }[], stage: number): EventDef | null {
  for (const m of markers) { if (m.ev.stage > stage) continue; if (Math.hypot(PV.x - m.x, PV.z - m.z) < 11) return m.ev; }
  return null;
}
export function nearRival(PV: Vehicle, ais: AI[]): AI | null {
  for (const A of ais) { if (A.kind !== 'rival' || A.parked || A.cool > 0) continue; if (Math.hypot(PV.x - A.x, PV.z - A.z) < 32) return A; }
  return null;
}
export function startOutrun(A: AI, playerTopMs: number, playerAccel: number, stage: number, fx?: Pick<EventFx, 'banner' | 'sfx'>): Outrun {
  const o: Outrun = { A, t: 0, gap: 0, state: 'run' }; A.vmax = playerTopMs * (.72 + .05 * stage); A.acc = playerAccel * 1.05; A.brk = 10;
  fx?.banner('Outrun: get 300 m ahead'); fx?.sfx('go');
  return o;
}
/* 'won' / 'lost' on the step the gap passes 300 m; 'done' once the 2.2 s wind-down ends (the rival is reset, drop the Outrun); 'run' otherwise */
export function updateOutrun(o: Outrun, PV: Vehicle, dt: number, fx?: Pick<EventFx, 'banner' | 'sfx'>): 'run' | 'won' | 'lost' | 'done' {
  const A = o.A; o.t += dt;
  const dx = PV.x - A.x, dz = PV.z - A.z; const ahead = dx * Math.sin(A.h) + dz * Math.cos(A.h); const dist = Math.hypot(dx, dz); o.gap = ahead >= 0 ? dist : -dist;
  if (o.state === 'run') {
    if (o.gap > 300) { o.state = 'done'; fx?.banner('Outrun won'); fx?.sfx('finish'); return 'won'; }
    else if (o.gap < -300) { o.state = 'done'; fx?.banner('Outrun lost', true); fx?.sfx('no'); return 'lost'; }
  } else { o.t2 = (o.t2 || 0) + dt; if (o.t2 > 2.2) { A.vmax = 16; A.acc = 6; A.cool = 20; return 'done'; } }
  return 'run';
}
