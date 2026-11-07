import { beforeAll, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { HUB, TRACKS, forgetTrack, markerFor, offsetOf, routeFor, trackOfEvent, type Pt, type TrackData } from './district';
import { readTrackSync, setTrackDir } from './districtNode';
import { routePoint } from './routes';

const OFFSETS: Record<string, Pt> = {
  spa: [0, 0], monza: [8000, 0], silverstone: [16000, 0], suzuka: [24000, 0], nurburgring: [0, 8000],
  monaco: [8000, 8000], interlagos: [16000, 8000], cota: [24000, 8000], laguna: [0, 16000], bathurst: [8000, 16000],
};
const dir = () => path.resolve(process.cwd(), 'public/strip/tracks');
const data: Record<string, TrackData> = {};
const events = () => TRACKS.flatMap(t => t.events);
const isDrag = (e: string) => e.endsWith('_drag');
function segDist(p: Pt, a: Pt, b: Pt): number {
  const dx = b[0] - a[0], dz = b[1] - a[1], L2 = dx * dx + dz * dz || 1;
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / L2));
  return Math.hypot(p[0] - (a[0] + dx * t), p[1] - (a[1] + dz * t));
}
function wallDist(p: Pt, walls: Pt[][]): number {
  let d = Infinity; for (const w of walls) for (let i = 0; i + 1 < w.length; i++) d = Math.min(d, segDist(p, w[i], w[i + 1])); return d;
}
const inside = (p: { x: number; z: number }, b: TrackData['bounds']) => p.x >= b.minX && p.x <= b.maxX && p.z >= b.minZ && p.z <= b.maxZ;

beforeAll(() => { setTrackDir(dir()); for (const t of TRACKS) data[t.id] = readTrackSync(t.id); });

describe('district data', () => {
  it('the index and the track files agree', () => {
    expect(TRACKS.length).toBe(10);
    for (const t of TRACKS) {
      expect(t.offset).toEqual(OFFSETS[t.id]); expect(offsetOf(t.id)).toEqual(t.offset);
      expect(data[t.id].id).toBe(t.id); expect(data[t.id].offset).toEqual(t.offset);
      for (const e of t.events) { expect(data[t.id].routes[e], e).toBeDefined(); expect(trackOfEvent(e)).toBe(t.id); }
    }
    expect(() => trackOfEvent('nope')).toThrow();
  });
  it('checkpoints: start at 0, increase, end on open routes', () => {
    for (const e of events()) {
      const r = routeFor(e);
      expect(r.cps[0], e).toBe(0);
      for (let i = 1; i < r.cps.length; i++) expect(r.cps[i], e).toBeGreaterThan(r.cps[i - 1]);
      const last = r.cps[r.cps.length - 1];
      if (r.loop) expect(last, e).toBeLessThanOrEqual(r.len + 0.1); else expect(last, e).toBeCloseTo(r.len, 1);
    }
  });
  it('drag routes are straight and 402 / 805 m', () => {
    for (const [e, len] of [['royal_drag', 402], ['mountain_drag', 805]] as const) {
      const r = routeFor(e), a = r.pts[0], b = r.pts[r.pts.length - 1];
      expect(Math.abs(r.len - len), e).toBeLessThan(2);
      for (const p of r.pts) expect(segDist(p, a, b), e).toBeLessThan(.5);
    }
  });
  it('lobby, return and markers lie inside bounds and clear the walls', () => {
    for (const t of TRACKS) {
      const d = data[t.id], pts: [string, Pt][] = [['lobby', [d.lobby.x, d.lobby.z]], ['return', d.return], ...Object.entries(d.markers)];
      for (const [name, p] of pts) {
        expect(inside({ x: p[0], z: p[1] }, d.bounds), t.id + ' ' + name).toBe(true);
        expect(wallDist(p, d.walls), t.id + ' ' + name).toBeGreaterThanOrEqual(1.5);
      }
    }
  });
  it('start grids and drag lanes clear the walls', () => {
    for (const t of TRACKS) {
      const walls = data[t.id].walls.map(w => w.map((p): Pt => [p[0] + t.offset[0], p[1] + t.offset[1]]));
      for (const e of t.events) {
        const p0 = routePoint(routeFor(e), 0), rx = -p0.tz, rz = p0.tx;
        const lanes = isDrag(e) ? [-7.5, -2.5, 2.5, 7.5] : [-3, 3], backs = isDrag(e) ? [0] : [0, -8];
        for (const lane of lanes) for (const back of backs) {
          const q: Pt = [p0.x + rx * lane + p0.tx * back, p0.z + rz * lane + p0.tz * back];
          expect(wallDist(q, walls), `${e} lane ${lane} back ${back}`).toBeGreaterThanOrEqual(1.5);
        }
      }
    }
  });
  it('wall points keep clear of non-adjacent centreline points', () => {
    for (const id of ['suzuka', 'monaco']) {
      const d = data[id], c = d.centre.pts, n = c.length, min = d.centre.width / 2 + 2 - .01;
      for (const w of d.walls) {
        const closed = w.length > 2 && w[0][0] === w[w.length - 1][0] && w[0][1] === w[w.length - 1][1];
        if (closed) continue;
        for (const p of w) {
          let ni = 0, nd = Infinity;
          for (let k = 0; k < n; k++) { const dd = Math.hypot(p[0] - c[k][0], p[1] - c[k][1]); if (dd < nd) { nd = dd; ni = k; } }
          let far = Infinity;
          for (let i = 0; i < n; i++) {
            const gap = Math.min(Math.abs(i - ni), n - Math.abs(i - ni));
            if (gap > 15) far = Math.min(far, Math.hypot(p[0] - c[i][0], p[1] - c[i][1]));
          }
          expect(far, id).toBeGreaterThanOrEqual(min);
        }
      }
    }
  });
  it('assets are within budget', () => {
    const pub = path.resolve(process.cwd(), 'public/strip');
    expect(fs.statSync(path.join(pub, 'hub.glb')).size).toBeLessThanOrEqual(1_500_000);
    for (const t of TRACKS) {
      expect(fs.statSync(path.join(pub, 'tracks', t.id + '.glb')).size, t.id).toBeLessThanOrEqual(800_000);
      expect(fs.statSync(path.join(pub, 'tracks', t.id + '.json')).size, t.id).toBeLessThanOrEqual(200_000);
    }
    expect(HUB.portals).toBeDefined();
  });
  it('routeFor adds the offset and caches', () => {
    const r = routeFor('royal_gp'), loc = data.monza.routes.royal_gp.pts[0];
    expect(r.pts[0]).toEqual([loc[0] + 8000, loc[1]]);
    expect(routeFor('royal_gp')).toBe(r);
    expect(() => routeFor('nope')).toThrow();
    const m = data.monza.markers.royal_gp; expect(markerFor('royal_gp')).toEqual([m[0] + 8000, m[1]]);
  });
  it('loadTrack caches and uses the fetcher', async () => {
    vi.resetModules();
    const d = await import('./district'); // fresh cache: nothing registered yet
    let calls = 0, url = '';
    const f = (u: string) => { calls++; url = u; return Promise.resolve(JSON.parse(fs.readFileSync(path.join(dir(), 'bathurst.json'), 'utf8')) as TrackData); };
    expect(d.trackLoaded('bathurst')).toBeUndefined();
    const [a, b] = await Promise.all([d.loadTrack('bathurst', f), d.loadTrack('bathurst', f)]);
    await d.loadTrack('bathurst', f);
    expect(calls).toBe(1); expect(a).toBe(b); expect(url).toBe('/strip/tracks/bathurst.json');
    expect(d.trackLoaded('bathurst')).toBe(a);
  });
  it('forgetTrack drops the track and its cached routes', () => {
    routeFor('royal_gp');
    forgetTrack('monza');
    try { expect(() => routeFor('royal_gp')).toThrow('track not loaded: monza'); } finally { readTrackSync('monza'); }
  });
});
