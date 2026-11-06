import { beforeAll, describe, expect, it } from 'vitest';
import path from 'node:path';
import { HUB, TRACKS, markerFor, type TrackData } from './district';
import { readTrackSync, setTrackDir } from './districtNode';
import { zoneBounds, zoneMarkers, zoneRoads, zoneWalls, type Zone } from './zone';

let t: TrackData, monaco: Zone, ox: number, oz: number;
beforeAll(() => { setTrackDir(path.resolve(process.cwd(), 'public/strip/tracks')); t = readTrackSync(TRACKS[5].id); [ox, oz] = t.offset; monaco = { kind: 'track', track: t }; });

describe('zones', () => {
  it('zoneWalls of a track equals its walls plus the offset', () => {
    const w = zoneWalls(monaco);
    expect(w.length).toBe(t.walls.length);
    t.walls.forEach((wall, i) => wall.forEach((p, k) => { expect(w[i][k][0]).toBe(p[0] + ox); expect(w[i][k][1]).toBe(p[1] + oz); }));
  });
  it('zoneRoads of the hub are the hub roads and of a track the offset centreline', () => {
    expect(zoneRoads({ kind: 'hub' })).toBe(HUB.roads);
    const r = zoneRoads(monaco);
    expect(r).toHaveLength(1); expect(r[0].loop).toBe(true); expect(r[0].width).toBe(t.centre.width);
    expect(r[0].pts[0]).toEqual([t.centre.pts[0][0] + ox, t.centre.pts[0][1] + oz]);
  });
  it('zoneBounds of a track adds the offset', () => {
    const b = zoneBounds(monaco);
    expect(b.minX).toBeCloseTo(t.bounds.minX + ox); expect(b.maxZ).toBeCloseTo(t.bounds.maxZ + oz);
    expect(zoneBounds({ kind: 'hub' })).toBe(HUB.bounds);
  });
  it('zoneMarkers(hub) has ten portals with labels', () => {
    const m = zoneMarkers({ kind: 'hub' });
    expect(m).toHaveLength(10); expect(TRACKS).toHaveLength(10);
    for (const k of m) { expect(k.kind).toBe('portal'); expect(k.label.en.length).toBeGreaterThan(0); expect(k.label.es.length).toBeGreaterThan(0); }
  });
  it('zoneMarkers(track) has one marker per event plus a return', () => {
    const m = zoneMarkers(monaco);
    expect(m.filter(k => k.kind === 'event').map(k => k.id).sort()).toEqual(Object.keys(t.markers).sort());
    expect(m.filter(k => k.kind === 'return')).toHaveLength(1);
    for (const k of m.filter(k => k.kind === 'event')) {
      const w = markerFor(k.id); expect(k.at[0]).toBeCloseTo(w[0], 2); expect(k.at[1]).toBeCloseTo(w[1], 2);
    }
    const ret = m.find(k => k.kind === 'return')!;
    expect(ret.at[0]).toBeCloseTo(t.return[0] + ox, 2); expect(ret.at[1]).toBeCloseTo(t.return[1] + oz, 2);
  });
});
