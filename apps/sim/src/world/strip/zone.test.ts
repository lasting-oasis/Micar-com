import { beforeAll, describe, expect, it } from 'vitest';
import path from 'node:path';
import { HUB, TRACKS, type TrackData } from './district';
import { readTrackSync, setTrackDir } from './districtNode';
import { zoneBounds, zoneRoads, zoneWalls, type Zone } from './zone';

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
  it('a track\'s roads and walls are computed once per track', () => {
    expect(zoneRoads({ kind: 'track', track: t })).toBe(zoneRoads(monaco));
    expect(zoneWalls({ kind: 'track', track: t })).toBe(zoneWalls(monaco));
  });
  it('zoneBounds of a track adds the offset', () => {
    const b = zoneBounds(monaco);
    expect(b.minX).toBeCloseTo(t.bounds.minX + ox); expect(b.maxZ).toBeCloseTo(t.bounds.maxZ + oz);
    expect(zoneBounds({ kind: 'hub' })).toBe(HUB.bounds);
  });
});
