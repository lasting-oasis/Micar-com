// The racing line on the two proof circuits (an oval of two 300 m straights and two 60 m turns, 12 m wide; a club
// circuit with a chicane and a 15 m hairpin): it bends less than the road's centreline, stays on the road less its
// margin, takes the outside-inside-outside path a driver takes, and is the same line on every machine.
import { describe, expect, it } from 'vitest';
import type { RacingLine } from './line';
import {
  LINE_MARGIN, LINE_PASSES, PROOF_CIRCUITS, arc, bending, centreCurvature, centrelineFrom, createPlace, curvature3,
  placeOnLine, placeOnTrack, proofCircuit, proofLine, racingLine, straight,
} from './line';
import { PI } from './math';

const lines: Record<string, RacingLine> = { oval: proofLine('oval'), club: proofLine('club') };
const room = (line: RacingLine): number => line.width / 2 - line.margin;
const most = (a: Float64Array): number => { let m = 0; for (const x of a) m = Math.max(m, Math.abs(x)); return m; };

describe('the proof circuits', () => {
  it('close on themselves: the last piece ends where the first began, heading the same way', () => {
    for (const name of PROOF_CIRCUITS) {
      const c = centrelineFrom(proofCircuit(name).pieces, 1);
      expect(c.gap, name).toBeLessThan(1e-9);
      expect(c.turn, name).toBeLessThan(1e-9);
    }
  });

  it('are the size they say: the oval 600 m + 2 pi 60 m = 977 m round, the club circuit about 842 m', () => {
    // Drawn a point a metre, each metre of a 60 m arc is a chord 0.005 mm short of it: 4 mm round the lap.
    expect(Math.abs(lines.oval.centreLength - (600 + 120 * PI))).toBeLessThan(0.005);
    expect(lines.club.centreLength).toBeGreaterThan(835);
    expect(lines.club.centreLength).toBeLessThan(850);
    // The club circuit's tightest bend is its 15 m hairpin; the oval's its 60 m turns.
    expect(1 / most(centreCurvature(lines.club))).toBeCloseTo(15, 0);
    expect(1 / most(centreCurvature(lines.oval))).toBeCloseTo(60, 0);
  });
});

describe('curvature from three points', () => {
  it('three points on a 40 m circle give 1/40 per metre, positive turning left, negative turning right', () => {
    const R = 40, p = (a: number): [number, number] => [R * Math.cos(a), R * Math.sin(a)];
    const [a, b, c] = [p(0.1), p(0.2), p(0.3)];
    expect(curvature3(a[0], a[1], b[0], b[1], c[0], c[1])).toBeCloseTo(1 / R, 12);
    expect(curvature3(c[0], c[1], b[0], b[1], a[0], a[1])).toBeCloseTo(-1 / R, 12);
    expect(curvature3(0, 0, 1, 0, 2, 0)).toBe(0);
  });
});

describe('the racing line', () => {
  it('bends less than the centreline: the integral of curvature squared falls 14% on the oval and by half on the club circuit', () => {
    const oval = lines.oval, club = lines.club;
    const centreOval = bending(centreCurvature(oval), oval.cs, oval.centreLength);
    const centreClub = bending(centreCurvature(club), club.cs, club.centreLength);
    // A circle of radius R bends 2 pi / R: the oval's two half circles of 60 m give 2 pi / 60 = 0.105 per metre.
    expect(centreOval).toBeCloseTo(2 * PI / 60, 2);
    expect(bending(oval.k, oval.s, oval.length) / centreOval).toBeLessThan(0.9);
    expect(bending(club.k, club.s, club.length) / centreClub).toBeLessThan(0.5);
  });

  it('is shorter round than the centreline', () => {
    for (const name of PROOF_CIRCUITS) expect(lines[name].length, name).toBeLessThan(lines[name].centreLength - 15);
  });

  it('opens the chicane: its tightest radius there is over 25 m against the road\'s 15 m (a third more speed on the same grip)', () => {
    const club = lines.club, pieces = proofCircuit('club').pieces;
    // The chicane is the club circuit's fourth to sixth pieces, on the back straight.
    let start = 0;
    for (let k = 0; k < 3; k++) start += pieces[k].length;
    const end = start + pieces[3].length + pieces[4].length + pieces[5].length;
    let tightest = 0, road = 0;
    const centre = centreCurvature(club);
    for (let i = 0; i < club.n; i++) {
      if (club.cs[i] < start || club.cs[i] > end) continue;
      tightest = Math.max(tightest, Math.abs(club.k[i]));
      road = Math.max(road, Math.abs(centre[i]));
    }
    expect(1 / road).toBeCloseTo(15, 0);
    expect(1 / tightest).toBeGreaterThan(25);
  });

  it('stays on the track less its margin: every point, and the line between points, within 6 - 1.6 = 4.4 m of the centreline', () => {
    const at = createPlace();
    for (const name of PROOF_CIRCUITS) {
      const line = lines[name];
      expect(line.margin).toBe(LINE_MARGIN);
      expect(most(line.offset), name).toBeLessThanOrEqual(room(line) + 1e-12);
      // Midway between points, measured against the centreline itself.
      let hint = -1, worst = 0;
      for (let i = 0; i < line.n; i++) {
        const j = i + 1 < line.n ? i + 1 : 0;
        placeOnTrack(line, 0.5 * (line.x[i] + line.x[j]), 0.5 * (line.y[i] + line.y[j]), hint, at);
        hint = at.index;
        worst = Math.max(worst, Math.abs(at.offset));
      }
      expect(worst, name).toBeLessThan(room(line) + 0.01);
    }
  });

  it('runs outside, inside, outside: wide on each oval straight, on the inside edge through the middle of each turn', () => {
    const oval = lines.oval, at = createPlace();
    // The oval runs anticlockwise from the start of its first straight: turns centred at 300 + 30 pi and 600 + 90 pi m.
    const offsetAt = (at0: number): number => {
      const s = at0 % oval.centreLength;
      let i = 0;
      while (i + 1 < oval.n && oval.cs[i + 1] <= s) i++;
      placeOnTrack(oval, oval.x[i], oval.y[i], i, at);
      return at.offset;
    };
    for (const middle of [300 + 30 * PI, 600 + 90 * PI]) {
      expect(offsetAt(middle)).toBeGreaterThan(room(oval) - 0.05);     // left turns: the inside is to the left
      expect(offsetAt(middle - 30 * PI - 60)).toBeLessThan(-room(oval) + 0.5);   // 60 m before the turn: the outside
      expect(offsetAt(middle + 30 * PI + 60)).toBeLessThan(-room(oval) + 0.5);   // 60 m after it: the outside again
    }
  });

  it('is the mirror image on a mirrored circuit, to a millimetre', () => {
    const c = proofCircuit('club'), centre = centrelineFrom(c.pieces, 1);
    const flipped = racingLine(centre.x, centre.y.map((y) => -y), c.width);
    const line = lines.club;
    let worst = 0;
    for (let i = 0; i < line.n; i++) worst = Math.max(worst, Math.abs(flipped.x[i] - line.x[i]), Math.abs(flipped.y[i] + line.y[i]));
    expect(worst).toBeLessThan(1e-3);
  });

  it('has settled: twice the passes moves its bending by under 0.1% and its tightest radius by under 2%', () => {
    for (const name of PROOF_CIRCUITS) {
      const c = proofCircuit(name), centre = centrelineFrom(c.pieces, 1);
      const more = racingLine(centre.x, centre.y, c.width, LINE_MARGIN, 2, 2 * LINE_PASSES), line = lines[name];
      const b0 = bending(line.k, line.s, line.length), b1 = bending(more.k, more.s, more.length);
      expect(Math.abs(b1 / b0 - 1), name).toBeLessThan(0.001);
      expect(Math.abs(most(more.k) / most(line.k) - 1), name).toBeLessThan(0.02);
    }
  });

  it('is the same line, bit for bit, every time it is drawn', () => {
    const again = proofLine('club'), line = lines.club;
    expect(Array.from(again.x)).toEqual(Array.from(line.x));
    expect(Array.from(again.y)).toEqual(Array.from(line.y));
    expect(Array.from(again.k)).toEqual(Array.from(line.k));
  });

  it('on a road too narrow for its margin is the centreline itself', () => {
    const c = proofCircuit('oval'), centre = centrelineFrom(c.pieces, 1);
    const narrow = racingLine(centre.x, centre.y, 3, 1.6);
    expect(most(narrow.offset)).toBe(0);
    expect(narrow.length).toBeCloseTo(narrow.centreLength, 0);
  });

  it('works from a coarse polygon too: a 100 m square with 30 m rounded corners drawn every 5 m', () => {
    const square = centrelineFrom([straight(100), arc(30, PI / 2), straight(100), arc(30, PI / 2), straight(100), arc(30, PI / 2), straight(100), arc(30, PI / 2)], 5);
    const line = racingLine(square.x, square.y, 10);
    expect(most(line.offset)).toBeLessThanOrEqual(5 - LINE_MARGIN + 1e-12);
    // A quarter turn with room to run wide needs no tighter than the corner's own 30 m, and a racing line opens it.
    expect(1 / most(line.k)).toBeGreaterThan(30);
  });

  it('does not fold where the centreline turns tighter than the line\'s room: a quarter turn of 4 m radius on a 12 m road', () => {
    // A drawn circuit's centreline can kink (the Eifel GP's turns 72 degrees in 6 m, a 4.2 m radius) where the road is
    // 12 m wide: 4.4 m in from it the normals have crossed. Laid there, the line turned the wrong way in a 0.4 m
    // radius cusp; it must instead cut the corner on a curve a car can follow.
    const kinked = centrelineFrom([straight(256), arc(4, PI / 2), straight(256), arc(40, PI / 2), straight(220), arc(40, PI / 2), straight(220), arc(40, PI / 2)], 1);
    expect(kinked.gap).toBeLessThan(1e-9);
    const line = racingLine(kinked.x, kinked.y, 12);
    expect(most(line.offset)).toBeLessThanOrEqual(6 - LINE_MARGIN + 1e-12);
    // Its tightest radius is over 10 m (it was 0.4 m), and every point's neighbours lie ahead of and behind it.
    expect(1 / most(line.k)).toBeGreaterThan(10);
    for (let i = 0; i < line.n; i++) {
      const j = (i + 1) % line.n;
      expect((line.x[j] - line.x[i]) * line.tx[i] + (line.y[j] - line.y[i]) * line.ty[i], `point ${i}`).toBeGreaterThan(0);
    }
  });
});

describe('finding a car against the line and the track', () => {
  it('a point 2 m left of the centreline reads 2 m left, at the distance along it where it stands', () => {
    const oval = lines.oval, at = createPlace();
    const i = 100, x = oval.cx[i] + 2 * oval.nx[i], y = oval.cy[i] + 2 * oval.ny[i];
    placeOnTrack(oval, x, y, -1, at);
    expect(at.offset).toBeCloseTo(2, 6);
    expect(at.s).toBeCloseTo(oval.cs[i], 3);
    // The tangent is along the road, a quarter turn right of the left normal.
    expect(at.tx).toBeCloseTo(oval.ny[i], 3);
    expect(at.ty).toBeCloseTo(-oval.nx[i], 3);
  });

  it('a point on the line reads no offset from it; a stale hint on the far side of the lap still finds it', () => {
    const club = lines.club, at = createPlace();
    const i = 300;
    placeOnLine(club, club.x[i], club.y[i], (i + club.n / 2) | 0, at);
    // On a point, the end of one segment or the start of the next: either way the same place.
    expect(Math.abs(at.index - i)).toBeLessThanOrEqual(1);
    expect(Math.abs(at.offset)).toBeLessThan(1e-9);
    expect(at.dist).toBeLessThan(1e-9);
    expect(at.s).toBeCloseTo(club.s[i], 9);
  });
});
