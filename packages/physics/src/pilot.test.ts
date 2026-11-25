// The pilot drives the four proof cars (golden.ts) round the two proof circuits (line.ts): at skill 0.9 every car
// laps without a wheel leaving the road, inside the skill band of its own limit lap and never faster than it; the same
// seed gives the same bits, other seeds other laps of much the same time; it pulls away from a standing start; and
// its step allocates nothing.
import { describe, expect, it } from 'vitest';
import type { Controls, VehicleModel } from './types';
import type { Envelope } from './lap';
import type { PilotTraits } from './pilot';
import { PRECISION_HIGH, PRECISION_LOW, REACTION_HIGH, REACTION_LOW, SKILL_HIGH, SKILL_LOW, createPilot, pilotTraits } from './pilot';
import { alongAt, limitLap, measureEnvelope } from './lap';
import type { RacingLine } from './line';
import { arc, centrelineFrom, createPlace, placeOnTrack, proofLine, racingLine, straight } from './line';
import { PROOF_CARS, proofSheet } from './golden';
import { resolveModel } from './resolve';
import { setRolling } from './bench';
import { FLAT, defaultControls } from './state';
import { createVehicle, hashState, placeVehicle, step } from './vehicle';

const LONG = 180_000;
type Name = (typeof PROOF_CARS)[number];
const models = new Map<string, VehicleModel>(), envelopes = new Map<string, Envelope>();
const model = (name: Name): VehicleModel => { let m = models.get(name); if (!m) { m = resolveModel(proofSheet(name)).model; models.set(name, m); } return m; };
const envelope = (name: Name): Envelope => { let e = envelopes.get(name); if (!e) { e = measureEnvelope(model(name)); envelopes.set(name, e); } return e; };
// A sweeper into a hairpin, 10 m wide (the Harbour GP's width): a 400 m straight, a 250 m radius left of 40 degrees
// (175 m of it) tightening into a 25 m radius hairpin, out the same way, a 400 m straight back and a long 180 degree
// left home. The braking for the hairpin is done in the sweeper, at 0.5 g and more across the car, where the inside
// wheels run light: the shape of the Harbour GP's left-hander 300-360 m past its line, where pilots near the top of
// the skill band ran 5-16 m wide.
function sweeperLine(): RacingLine {
  const R1 = 250, turn = 0.7, R2 = 25, L = 400;
  const across = 2 * R1 * (1 - Math.cos(turn)) + 2 * R2 * Math.cos(turn);
  const c = centrelineFrom([straight(L), arc(R1, turn), arc(R2, Math.PI - 2 * turn), arc(R1, turn), straight(L), arc(across / 2, Math.PI)], 1);
  return racingLine(c.x, c.y, 10);
}
const lines: Record<string, RacingLine> = { oval: proofLine('oval'), club: proofLine('club'), sweeper: sweeperLine() };

type Run = { laps: number[]; limit: number; beyond: number; hash: number; plan: number; over: number };

/**
 * A pilot drives a car round a circuit: from rolling at its own speed on the line's point 0 (or standing still
 * `behind` m back, if given) until it has completed `laps` laps or a time limit. Laps are timed as the distance driven
 * along the line passes each multiple of its length. `beyond` is the furthest any wheel's contact patch went past the
 * road's edge, m (negative: it stayed that far inside).
 */
function drive(name: Name, circuit: string, traits: PilotTraits, laps: number, behind = -1): Run {
  const m = model(name), e = envelope(name), line = lines[circuit];
  const pilot = createPilot(m, line, e, traits);
  const s = createVehicle(m), c: Controls = defaultControls();
  if (behind < 0) {
    placeVehicle(s, line.x[0], line.y[0], line.tx[0], line.ty[0]);
    setRolling(s, pilot.plan.speed[0], pilot.plan.speed[0] * line.k[0]);
  } else {
    let i = line.n - 1;
    while (line.s[i] > line.length - behind) i--;
    placeVehicle(s, line.x[i], line.y[i], line.tx[i], line.ty[i]);
  }
  const ch = m.chassis, wx = [ch.a, ch.a, -ch.b, -ch.b], wy = [ch.trackFront / 2, -ch.trackFront / 2, ch.trackRear / 2, -ch.trackRear / 2];
  const at = createPlace(), hints = [-1, -1, -1, -1];
  const out: number[] = [];
  let beyond = -Infinity, t0 = NaN, lastT = 0, lastP = NaN, over = 0;
  for (let k = 0; k < 120 * 60 * (laps + 1) && out.length < laps; k++) {
    pilot.control(s, c);
    // How far over its target it is where its plan slows the car, once the first lap is under way: on the brakes or
    // not (a pilot that has eased its brake to nothing and coasts on at speed is the failure this measures).
    if (pilot.progress > 0.5 * line.length && alongAt(pilot.plan, pilot.place.s, pilot.place.index) < 0) over = Math.max(over, Math.sqrt(s.u * s.u + s.v * s.v) - pilot.target);
    // The pilot has just read where the car is: the distance it has driven along the line, at this moment.
    const P = pilot.progress, L = line.length;
    if (lastP === lastP && Math.floor(P / L) > Math.floor(lastP / L) && P > 0) {
      const crossed = lastT + (s.time - lastT) * (Math.floor(P / L) * L - lastP) / (P - lastP);
      if (t0 === t0) out.push(crossed - t0);
      t0 = crossed;
    }
    if (t0 !== t0 && behind < 0) t0 = 0;
    lastP = P; lastT = s.time;
    step(s, c, FLAT);
    for (let w = 0; w < 4; w++) {
      placeOnTrack(line, s.x + s.hx * wx[w] - s.hy * wy[w], s.y + s.hy * wx[w] + s.hx * wy[w], hints[w], at);
      hints[w] = at.index;
      beyond = Math.max(beyond, Math.abs(at.offset) - line.width / 2);
    }
  }
  return { laps: out, limit: limitLap(line, e).lapTime, beyond, hash: hashState(s), plan: pilot.plan.lapTime, over };
}

const at = (seed: number, skill: number): PilotTraits => ({ ...pilotTraits(seed), skill });

describe('who is driving', () => {
  it('a seed gives a pilot: the same seed the same one; seeds spread skill over 0.80-0.98, reaction over 0.10-0.20 s, precision over 0.7-1', () => {
    expect(pilotTraits(42)).toEqual(pilotTraits(42));
    expect(pilotTraits(42)).not.toEqual(pilotTraits(43));
    const lo = { skill: 1, reaction: 1, precision: 1 }, hi = { skill: 0, reaction: 0, precision: 0 };
    for (let seed = 1; seed <= 500; seed++) {
      const t = pilotTraits(seed);
      for (const k of ['skill', 'reaction', 'precision'] as const) { lo[k] = Math.min(lo[k], t[k]); hi[k] = Math.max(hi[k], t[k]); }
    }
    expect(SKILL_LOW).toBe(0.8); expect(SKILL_HIGH).toBe(0.98);
    expect(lo.skill).toBeGreaterThanOrEqual(SKILL_LOW); expect(lo.skill).toBeLessThan(SKILL_LOW + 0.01);
    expect(hi.skill).toBeLessThanOrEqual(SKILL_HIGH); expect(hi.skill).toBeGreaterThan(SKILL_HIGH - 0.01);
    expect(lo.reaction).toBeGreaterThanOrEqual(REACTION_LOW); expect(hi.reaction).toBeLessThanOrEqual(REACTION_HIGH);
    expect(hi.reaction - lo.reaction).toBeGreaterThan(0.95 * (REACTION_HIGH - REACTION_LOW));
    expect(lo.precision).toBeGreaterThanOrEqual(PRECISION_LOW); expect(hi.precision).toBeLessThanOrEqual(PRECISION_HIGH);
    expect(hi.precision - lo.precision).toBeGreaterThan(0.95 * (PRECISION_HIGH - PRECISION_LOW));
  });
});

describe('a pilot on the proof circuits', () => {
  it('at skill 0.9 every proof car laps each circuit three times with all four wheels on the road, each lap between 1/0.98 and 1/0.80 of its limit lap', () => {
    for (const name of PROOF_CARS) {
      for (const circuit of ['oval', 'club']) {
        const r = drive(name, circuit, at(1, 0.9), 3);
        expect(r.laps.length, `${name} ${circuit}`).toBe(3);
        expect(r.beyond, `${name} ${circuit}: a wheel ${r.beyond.toFixed(2)} m past the edge`).toBeLessThan(0);
        for (const lap of r.laps) {
          expect(lap, `${name} ${circuit}`).toBeGreaterThan(r.limit);
          expect(lap / r.limit, `${name} ${circuit}`).toBeGreaterThanOrEqual(1 / 0.98);
          expect(lap / r.limit, `${name} ${circuit}`).toBeLessThanOrEqual(1 / 0.8);
        }
        // It drives to its own plan (the envelope at its skill), and loses no more than 6% more to being human.
        expect(r.laps[2] / r.plan, `${name} ${circuit}`).toBeLessThan(1.06);
      }
    }
  }, LONG);

  it('brakes to its plan through a sweeper into a hairpin at skill 0.97: never more than 4 m/s over its target where its plan slows it, and no wheel more than 0.3 m past the edge', () => {
    // Braking at 0.5 g and more across the car, the inside wheels carry a fifth of their axle's load; a light tyre
    // peaks at a smaller slip and reads past its peak whenever the loaded one is at it. Judged by its worst single
    // tyre, the pilot eased the brakes to a fraction of its plan there, arrived 4-8 m/s too fast and ran 4-27 m wide.
    for (const name of PROOF_CARS) {
      for (const seed of [1, 2, 3, 4]) {
        const r = drive(name, 'sweeper', at(seed, 0.97), 2);
        expect(r.laps.length, `${name} seed ${seed}`).toBe(2);
        expect(r.beyond, `${name} seed ${seed}: a wheel ${r.beyond.toFixed(2)} m past the edge`).toBeLessThan(0.3);
        expect(r.over, `${name} seed ${seed}: ${r.over.toFixed(1)} m/s over its target on the brakes`).toBeLessThan(4);
        // and it still drives near its plan: within 6% of it.
        expect(r.laps[1] / r.plan, `${name} seed ${seed}`).toBeLessThan(1.06);
      }
    }
  }, LONG);

  it('two runs with the same seed give the same bits', () => {
    const a = drive('sports', 'club', pilotTraits(7), 1), b = drive('sports', 'club', pilotTraits(7), 1);
    expect(a.hash).toBe(b.hash);
    expect(a.laps).toEqual(b.laps);
  }, LONG);

  it('different seeds give different laps of much the same time: within 2% of each other, all on the road', () => {
    const runs = [1, 2, 3, 4].map((seed) => drive('pickup', 'club', at(seed, 0.9), 2));
    const hashes = new Set(runs.map((r) => r.hash));
    expect(hashes.size).toBe(4);
    const times = runs.map((r) => r.laps[1]);
    expect(Math.max(...times) / Math.min(...times)).toBeLessThan(1.02);
    for (const r of runs) expect(r.beyond).toBeLessThan(0);
  }, LONG);

  it('more skill is more speed, never beyond the limit: 0.98, 0.90 and 0.80 in the same coupe', () => {
    const [fast, mid, slow] = [0.98, 0.9, 0.8].map((skill) => drive('coupe', 'club', at(3, skill), 2));
    expect(fast.laps[1]).toBeLessThan(mid.laps[1]);
    expect(mid.laps[1]).toBeLessThan(slow.laps[1]);
    expect(fast.laps[1] / fast.limit).toBeGreaterThanOrEqual(1 / 0.98);
    expect(slow.laps[1] / slow.limit).toBeLessThanOrEqual(1 / 0.8);
    for (const r of [fast, mid, slow]) expect(r.beyond).toBeLessThan(0);
  }, LONG);

  it('pulls away from a standing start 10 m behind the line and laps on the road; the launch costs under 6 s', () => {
    for (const name of ['sports', 'sedan'] as const) {
      const standing = drive(name, 'club', at(1, 0.9), 1, 10), flying = drive(name, 'club', at(1, 0.9), 1);
      expect(standing.laps.length, name).toBe(1);
      expect(standing.beyond, name).toBeLessThan(0);
      expect(standing.laps[0] - flying.laps[0], name).toBeGreaterThan(0.5);
      expect(standing.laps[0] - flying.laps[0], name).toBeLessThan(6);
    }
  }, LONG);

  it('pilots share nothing: two cars driven turn about give each the bits it gives driven alone', () => {
    const go = (name: Name, seed: number) => {
      const m = model(name), line = lines.club, pilot = createPilot(m, line, envelope(name), at(seed, 0.9));
      const s = createVehicle(m), c = defaultControls();
      placeVehicle(s, line.x[0], line.y[0], line.tx[0], line.ty[0]);
      setRolling(s, pilot.plan.speed[0], pilot.plan.speed[0] * line.k[0]);
      return { s, step: (): void => { pilot.control(s, c); step(s, c, FLAT); } };
    };
    const a = go('sedan', 5), b = go('coupe', 6);
    for (let k = 0; k < 1200; k++) { a.step(); b.step(); }
    const lone = go('sedan', 5);
    for (let k = 0; k < 1200; k++) lone.step();
    expect(hashState(a.s)).toBe(hashState(lone.s));
  }, LONG);
});

/* ------------------------------------------------------------------ the step allocates nothing */

// The pilot's step and everything it calls in this package's own files, read off the sources: no object or array
// literals, closures, `new`, spreads or template strings (DESIGN.md rule 4, as determinism.test.ts checks the car's
// step).
const sources = import.meta.glob(['./pilot.ts', './line.ts', './lap.ts', './drivers.ts', './tyre.ts', './systems.ts', './math.ts'], { query: '?raw', import: 'default', eager: true }) as Record<string, string>;

/** A source with its comments and the insides of its strings blanked out, so only code is read. */
function codeOf(src: string): string {
  let out = '', i = 0;
  while (i < src.length) {
    const ch = src[i], next = src[i + 1];
    if (ch === '/' && next === '/') { while (i < src.length && src[i] !== '\n') i++; continue; }
    if (ch === '/' && next === '*') { i += 2; while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) i++; i += 2; continue; }
    if (ch === '\'' || ch === '"' || ch === '`') {
      out += ch === '`' ? '`' : '""';
      i++;
      while (i < src.length && src[i] !== ch) i += src[i] === '\\' ? 2 : 1;
      i++;
      continue;
    }
    out += ch;
    i++;
  }
  return out;
}

/** Every `function name(...) ... { body }` in a source: its body. */
function functionsIn(code: string): Map<string, string> {
  const found = new Map<string, string>();
  const head = /function\s+([A-Za-z_$][\w$]*)\s*(<[^>]*>)?\s*\(/g;
  let m: RegExpExecArray | null;
  while ((m = head.exec(code)) !== null) {
    let i = head.lastIndex, depth = 1;
    while (depth > 0 && i < code.length) { if (code[i] === '(') depth++; else if (code[i] === ')') depth--; i++; }
    // Past the return type to the body's brace: a '{' right after ':' '|' '&' ',' is a type's.
    while (i < code.length && code[i] !== ';' && !(code[i] === '{' && !/[:|&,]\s*$/.test(code.slice(Math.max(0, i - 3), i)))) {
      if (code[i] === '{') { let d = 1; i++; while (d > 0 && i < code.length) { if (code[i] === '{') d++; else if (code[i] === '}') d--; i++; } continue; }
      i++;
    }
    if (code[i] !== '{') continue;
    const start = i + 1;
    depth = 1; i++;
    while (depth > 0 && i < code.length) { if (code[i] === '{') depth++; else if (code[i] === '}') depth--; i++; }
    found.set(m[1], code.slice(start, i - 1));
  }
  return found;
}

describe('the pilot\'s step allocates nothing (DESIGN.md rule 4)', () => {
  const all = new Map<string, string>();
  for (const file of Object.keys(sources).sort()) for (const [name, body] of functionsIn(codeOf(sources[file]))) if (!all.has(name)) all.set(name, body);
  // The car's shift points are worked out on a model's first look-up (systems.ts pointsFor); createPilot looks them up
  // first (prepareShiftPoints), so in the step that branch never runs. The last test here holds createPilot to it.
  const ONCE = new Set(['computeShiftPoints']);
  const reached = (): string[] => {
    const seen = new Set<string>(), queue = ['think'];
    while (queue.length > 0) {
      const name = queue.shift() as string;
      if (seen.has(name) || !all.has(name) || ONCE.has(name)) continue;
      seen.add(name);
      for (const call of (all.get(name) as string).matchAll(/(?<![.\w$])([A-Za-z_$][\w$]*)\s*\(/g)) queue.push(call[1]);
    }
    return [...seen];
  };
  const allocations = (body: string): string[] => {
    const bad: string[] = [];
    if (/[=(,?:]\s*\{|\breturn\s*\{/.test(body)) bad.push('an object literal');
    if (/[=(,]\s*\[|\breturn\s*\[/.test(body)) bad.push('an array literal');
    if (/=>/.test(body)) bad.push('a closure');
    if (/\bnew\b|\bfunction\b/.test(body)) bad.push('new or function');
    if (/\.\.\./.test(body)) bad.push('a spread');
    if (/`/.test(body)) bad.push('a template string');
    return bad;
  };

  it('the scan sees through the call chain and catches each kind of allocation', () => {
    const names = reached();
    for (const name of ['think', 'steer', 'pedals', 'gearFor', 'placeOnLine', 'nearestSegment', 'steerFor', 'understeerAt', 'speedAt', 'curvatureAt', 'restControls', 'peakSlipTan', 'shiftUpOmega']) {
      expect(names, name).toContain(name);
    }
    for (const line of ['const a = { x: 1 };', 'f(x, [1, 2]);', 'const g = () => 1;', 'const b = new Float64Array(4);', 'g(...xs);', 'const s = `${x}`;', 'return [x];']) {
      expect(allocations(codeOf(line)), line).not.toEqual([]);
    }
    expect(allocations(codeOf('const a = b[i] * (c + d); if (x) { y = 1; } p.q = r[0];'))).toEqual([]);
  });

  it('every function the pilot\'s step reaches allocates nothing', () => {
    const found: string[] = [];
    for (const name of reached()) for (const what of allocations(all.get(name) as string)) found.push(`${name}: ${what}`);
    expect(found).toEqual([]);
  });

  it('its control() only hands the car to the step and copies out what it reports', () => {
    const code = codeOf(sources['./pilot.ts']);
    const body = /control\(s: VehicleState, c: Controls\): void \{([^}]*)\}/.exec(code);
    expect(body).not.toBeNull();
    expect(allocations((body as RegExpExecArray)[1])).toEqual([]);
    expect((body as RegExpExecArray)[1]).toContain('think(mind, s, c)');
    // What the step may only read from a cache is put in the cache when the pilot is made.
    expect(all.get('createPilot')).toContain('prepareShiftPoints(model)');
  });
});
