// A car's envelope and its limit lap, on the four proof cars (golden.ts) and the two proof circuits (line.ts). The
// envelope is measured through the core's own step, so it must give back what the bench measures in its own way; the
// limit lap must rank the cars as their bench figures do and be the lap a racing engineer expects on such a circuit.
import { describe, expect, it } from 'vitest';
import type { BenchResult, VehicleModel } from './types';
import type { Envelope } from './lap';
import { CORNER_SPEEDS, STEER_STEP, cornerSpeed, envelopeAt, lapOn, limitLap, measureEnvelope, speedAt, steerFor } from './lap';
import { PROOF_CARS, proofSheet } from './golden';
import { resolveModel } from './resolve';
import { runBench } from './bench';
import { centrelineFrom, proofCircuit, proofLine, racingLine } from './line';
import type { RacingLine } from './line';
import { G, RHO_AIR, datan } from './math';
import { FT, MPH } from './units';

const LONG = 120_000;
type Name = (typeof PROOF_CARS)[number];
const models = new Map<string, VehicleModel>(), envelopes = new Map<string, Envelope>(), benches = new Map<string, BenchResult>();
const model = (name: Name): VehicleModel => { let m = models.get(name); if (!m) { m = resolveModel(proofSheet(name)).model; models.set(name, m); } return m; };
const envelope = (name: Name): Envelope => { let e = envelopes.get(name); if (!e) { e = measureEnvelope(model(name)); envelopes.set(name, e); } return e; };
const bench = (name: Name): BenchResult => { let b = benches.get(name); if (!b) { b = runBench(model(name), 'all'); benches.set(name, b); } return b; };
const lines: Record<string, RacingLine> = { oval: proofLine('oval'), club: proofLine('club') };
// Driving the middle of the road: the centreline as a line with no room to move.
const centres: Record<string, RacingLine> = {};
for (const name of ['oval', 'club']) {
  const c = proofCircuit(name), centre = centrelineFrom(c.pieces, 1);
  centres[name] = racingLine(centre.x, centre.y, c.width, c.width / 2);
}
const tightest = (line: RacingLine): number => { let k = 0; for (const x of line.k) k = Math.max(k, Math.abs(x)); return k; };

describe('the envelope, measured through the core\'s own step', () => {
  it('corners as the bench\'s skidpad does: within 1.5% of the 300 ft and 200 ft figures, at the speed each circle is driven', () => {
    for (const name of PROOF_CARS) {
      const e = envelope(name), b = bench(name);
      for (const [g, radius] of [[b.skidpad300, 150 * FT], [b.skidpad200, 100 * FT]]) {
        const v = Math.sqrt(g * G * radius);
        expect(Math.abs(envelopeAt(e.lateral, e, v) / g - 1), `${name} ${radius}`).toBeLessThan(0.015);
      }
    }
  }, LONG);

  it('gives back the bench\'s 0-60 within 4%, its 60-0 within 2% and its top speed exactly', () => {
    for (const name of PROOF_CARS) {
      const e = envelope(name), b = bench(name);
      // Time to 60 mph: dv over the acceleration at each speed; distance from 60 mph: v dv over the deceleration.
      let t = 0, d = 0;
      const dv = 0.01, sixty = 60 * MPH;
      for (let v = 0; v < sixty; v += dv) t += dv / (G * envelopeAt(e.accel, e, v + dv / 2));
      for (let v = sixty; v > 0; v -= dv) d += (v - dv / 2) * dv / (G * envelopeAt(e.brake, e, v - dv / 2));
      expect(Math.abs(t / b.zeroToSixty - 1), `${name} 0-60 ${t} ${b.zeroToSixty}`).toBeLessThan(0.04);
      expect(Math.abs(d / FT / b.braking60 - 1), `${name} 60-0 ${d / FT} ${b.braking60}`).toBeLessThan(0.02);
      expect(e.topSpeed / MPH, name).toBeCloseTo(b.topSpeed, 3);
    }
  }, LONG);

  it('a speed past the top speed has no acceleration left; a standing car has its tyres\' traction', () => {
    for (const name of PROOF_CARS) {
      const e = envelope(name);
      expect(envelopeAt(e.accel, e, e.topSpeed + 1), name).toBe(0);
      expect(envelopeAt(e.accel, e, 2), name).toBeGreaterThan(0.3);
    }
  }, LONG);

  it('downforce shows at speed and not in a hairpin: 1.2 m^2 of it adds most of its extra load\'s share of grip at 40 m/s, next to none at 10 m/s', () => {
    const stock = model('sports');
    const winged: VehicleModel = { ...stock, aero: { ...stock.aero, liftAreaFront: -0.5, liftAreaRear: -0.7 } };
    const plain = envelope('sports'), wing = measureEnvelope(winged);
    const extra = (v: number): number => 0.5 * RHO_AIR * v * v * 1.2 / (stock.chassis.mass * G);   // added load over weight
    const gain = (v: number): number => envelopeAt(wing.lateral, wing, v) / envelopeAt(plain.lateral, plain, v) - 1;
    // At 40 m/s the wing adds 7% to the load; grip grows a little more slowly than load (tyre load sensitivity).
    expect(extra(40)).toBeGreaterThan(0.065);
    expect(gain(40)).toBeGreaterThan(0.5 * extra(40));
    expect(gain(40)).toBeLessThan(1.05 * extra(40));
    expect(Math.abs(gain(10))).toBeLessThan(0.01);
  }, LONG);

  it('holds the car\'s handling diagram: the kinematic lock for a gentle curve, more the harder it corners (understeer)', () => {
    for (const name of PROOF_CARS) {
      const e = envelope(name), L = model(name).chassis.a + model(name).chassis.b, v = 25;
      const extra = (g: number): number => { const k = g * G / (v * v); return steerFor(e, L, v, k) - datan(L * k); };
      expect(Math.abs(extra(0.01)), name).toBeLessThan(0.002);     // a tenth of a degree
      expect(extra(0.4), name).toBeGreaterThan(0);
      expect(extra(0.8), name).toBeGreaterThan(extra(0.4));
      // Turning right takes the same lock the other way.
      expect(steerFor(e, L, v, -0.6 * G / (v * v)), name).toBeCloseTo(-steerFor(e, L, v, 0.6 * G / (v * v)), 12);
      // The diagram reaches up to the car's own cornering at each speed it was measured.
      for (const c of e.corners) expect(c.reach * STEER_STEP, name).toBeGreaterThan(c.g - 2 * STEER_STEP);
    }
    expect(CORNER_SPEEDS[0]).toBe(10);
  }, LONG);

  it('is the same bits every time it is measured', () => {
    const a = measureEnvelope(model('pickup')), b = envelope('pickup');
    expect(Array.from(a.accel)).toEqual(Array.from(b.accel));
    expect(Array.from(a.brake)).toEqual(Array.from(b.brake));
    expect(Array.from(a.lateral)).toEqual(Array.from(b.lateral));
  }, LONG);
});

describe('the limit lap', () => {
  it('the racing line is worth it: every car laps the oval at least 4% and the club circuit at least 12% quicker on it than down the middle', () => {
    for (const name of PROOF_CARS) {
      const e = envelope(name);
      expect(limitLap(lines.oval, e).lapTime / limitLap(centres.oval, e).lapTime, name).toBeLessThan(0.96);
      expect(limitLap(lines.club, e).lapTime / limitLap(centres.club, e).lapTime, name).toBeLessThan(0.88);
    }
  }, LONG);

  it('ranks the cars as their bench figures do: the sports car fastest and the coupe second on both circuits, the pickup slowest on the oval', () => {
    // The sports car beats every other car, and the coupe the sedan and the pickup, on every bench figure: 0-60, 60-0,
    // the skidpad and top speed. So they must lap faster anywhere.
    const beats = (a: Name, b: Name): boolean => {
      const x = bench(a), y = bench(b);
      return x.zeroToSixty < y.zeroToSixty && x.braking60 < y.braking60 && x.skidpad300 > y.skidpad300 && x.topSpeed > y.topSpeed;
    };
    for (const other of ['coupe', 'sedan', 'pickup'] as const) expect(beats('sports', other), other).toBe(true);
    for (const other of ['sedan', 'pickup'] as const) expect(beats('coupe', other), other).toBe(true);
    for (const circuit of ['oval', 'club']) {
      const t = (name: Name): number => limitLap(lines[circuit], envelope(name)).lapTime;
      expect(t('sports'), circuit).toBeLessThan(t('coupe'));
      expect(t('coupe'), circuit).toBeLessThan(Math.min(t('sedan'), t('pickup')));
    }
    // The sedan and the pickup split the bench: the pickup is quicker in a straight line (0-60 in 5.2 s against 7.5 s,
    // a third more power for its weight), the sedan corners and stops better (0.79 g against 0.70 g, 127 ft against
    // 144 ft). On the oval, whose two long 60 m turns are half its lap, the grip tells and the pickup is slowest.
    expect(limitLap(lines.oval, envelope('pickup')).lapTime).toBeGreaterThan(limitLap(lines.oval, envelope('sedan')).lapTime);
    // On the club circuit, where each slow corner opens onto a straight, the two are within 2% of each other.
    const sedan = limitLap(lines.club, envelope('sedan')).lapTime, pickup = limitLap(lines.club, envelope('pickup')).lapTime;
    expect(Math.abs(sedan / pickup - 1)).toBeLessThan(0.02);
  }, LONG);

  it('is plausible for such a circuit: 85 to 135 km/h round the oval and 65 to 110 km/h round the club circuit; slowest in the tightest bend at the bench\'s skidpad speed for it; never past top speed', () => {
    for (const name of PROOF_CARS) {
      const e = envelope(name), b = bench(name);
      for (const [circuit, lo, hi] of [['oval', 85, 135], ['club', 65, 110]] as const) {
        const line = lines[circuit], lap = limitLap(line, e);
        const average = line.length / lap.lapTime * 3.6;
        expect(average, `${name} ${circuit}`).toBeGreaterThan(lo);
        expect(average, `${name} ${circuit}`).toBeLessThan(hi);
        let slowest = Infinity, fastest = 0;
        for (const v of lap.speed) { slowest = Math.min(slowest, v); fastest = Math.max(fastest, v); }
        expect(Math.abs(slowest / Math.sqrt(b.skidpad300 * G / tightest(line)) - 1), `${name} ${circuit}`).toBeLessThan(0.04);
        expect(fastest, `${name} ${circuit}`).toBeLessThan(b.topSpeed * MPH);
      }
    }
  }, LONG);

  it('a driver using 90% of the grip takes the tightest bend at the square root of 0.9 of the limit speed, within 1%, and laps 2 to 6% slower', () => {
    for (const name of PROOF_CARS) {
      const e = envelope(name);
      for (const circuit of ['oval', 'club']) {
        const line = lines[circuit], limit = limitLap(line, e), driver = lapOn(line, e, 0.9);
        let i = 0;
        for (let k = 0; k < line.n; k++) if (limit.speed[k] < limit.speed[i]) i = k;
        expect(Math.abs(driver.speed[i] / limit.speed[i] / Math.sqrt(0.9) - 1), `${name} ${circuit}`).toBeLessThan(0.01);
        expect(driver.lapTime / limit.lapTime, `${name} ${circuit}`).toBeGreaterThan(1.02);
        expect(driver.lapTime / limit.lapTime, `${name} ${circuit}`).toBeLessThan(1.06);
        for (let k = 0; k < line.n; k++) expect(driver.speed[k]).toBeLessThanOrEqual(limit.speed[k] + 1e-9);
      }
    }
  }, LONG);

  it('never asks more of the tyres than the envelope: along and across the path within the friction ellipse, the corner speed at every point', () => {
    for (const name of PROOF_CARS) {
      const e = envelope(name);
      for (const circuit of ['oval', 'club']) {
        const line = lines[circuit], lap = limitLap(line, e);
        for (let i = 0; i < line.n; i++) {
          const v = lap.speed[i];
          expect(v, `${name} ${circuit} ${i}`).toBeLessThanOrEqual(cornerSpeed(e, line.k[i], 1) + 1e-9);
          const across = Math.abs(lap.across[i]) / (G * envelopeAt(e.lateral, e, v));
          expect(across, `${name} ${circuit} ${i}`).toBeLessThanOrEqual(1 + 1e-6);
        }
      }
    }
  }, LONG);

  it('reads between its points and wraps round the lap', () => {
    const lap = limitLap(lines.club, envelope('coupe')), L = lines.club.length;
    expect(speedAt(lap, 0, -1)).toBeCloseTo(lap.speed[0], 12);
    expect(speedAt(lap, L + 10, -1)).toBeCloseTo(speedAt(lap, 10, -1), 12);
    expect(speedAt(lap, -5, -1)).toBeCloseTo(speedAt(lap, L - 5, -1), 12);
    expect(lap.time[0]).toBe(0);
    expect(lap.time[lines.club.n - 1]).toBeLessThan(lap.lapTime);
  }, LONG);

  it('is a pure function of the envelope and the line: the same profile, bit for bit', () => {
    const e = envelope('sedan');
    const a = limitLap(lines.club, e), b = limitLap(lines.club, e);
    expect(Array.from(a.speed)).toEqual(Array.from(b.speed));
    expect(a.lapTime).toBe(b.lapTime);
  }, LONG);
});
