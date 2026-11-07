import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Reads the committed OSM centreline files; no network.
const DIR = resolve(process.cwd(), '../../tools/tracks/data');

const TABLE = [
  { id: 'spa', lapM: 7004, dir: 'cw', width: 12 },
  { id: 'monza', lapM: 5793, dir: 'cw', width: 12 },
  { id: 'silverstone', lapM: 5891, dir: 'cw', width: 12 },
  { id: 'suzuka', lapM: 5807, dir: 'cw', width: 12 },
  { id: 'nurburgring', lapM: 5148, dir: 'cw', width: 12 },
  { id: 'monaco', lapM: 3337, dir: 'cw', width: 10 },
  { id: 'interlagos', lapM: 4309, dir: 'ccw', width: 12 },
  { id: 'cota', lapM: 5513, dir: 'ccw', width: 12 },
  { id: 'laguna', lapM: 3602, dir: 'ccw', width: 11 },
  { id: 'bathurst', lapM: 6213, dir: 'ccw', width: 11 },
] as const;

describe('OSM centrelines', () => {
  for (const t of TABLE) {
    describe(t.id, () => {
      const file = resolve(DIR, `${t.id}.json`);
      it('file exists', () => expect(existsSync(file)).toBe(true));
      if (!existsSync(file)) return;
      const d = JSON.parse(readFileSync(file, 'utf8'));
      const pts: [number, number][] = d.pts;

      it('metadata', () => {
        expect(d.id).toBe(t.id);
        expect(d.source).toBe('OpenStreetMap');
        expect(d.licence).toBe('ODbL');
        expect(d.lapM).toBe(t.lapM);
        expect(d.widthM).toBe(t.width);
        expect(d.centre).toHaveLength(2);
        expect(Number.isNaN(Date.parse(d.fetchedAt))).toBe(false);
      });
      it('length within 3 % of the published lap', () => {
        expect(Math.abs(d.lenM - t.lapM) / t.lapM).toBeLessThanOrEqual(0.03);
      });
      it('spacing 2-4 m and the loop closes', () => {
        for (let i = 0; i < pts.length; i++) {
          const a = pts[i], b = pts[(i + 1) % pts.length];
          const s = Math.hypot(b[0] - a[0], b[1] - a[1]);
          expect(s).toBeGreaterThanOrEqual(2);
          expect(s).toBeLessThanOrEqual(4);
        }
      });
      it('point count matches length', () => {
        expect(Math.abs(pts.length - Math.round(d.lenM / 3))).toBeLessThanOrEqual(2);
      });
      it('runs in the race direction', () => {
        let a = 0;
        for (let i = 0; i < pts.length; i++) {
          const p = pts[i], q = pts[(i + 1) % pts.length];
          a += (p[0] * q[1] - q[0] * p[1]) / 2;
        }
        if (t.dir === 'cw') expect(a).toBeLessThan(0);
        else expect(a).toBeGreaterThan(0);
      });
    });
  }
});
