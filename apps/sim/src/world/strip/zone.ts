// A zone is where the player is: the hub, or one circuit (world metres, offset applied).
import { HUB, type Bounds, type Pt, type RoadData, type TrackData } from './district';
import { offsetPts } from './routes';

export type Zone = { kind: 'hub' } | { kind: 'track'; track: TrackData };

// computed once per track data object (the HUD and the runner ask every frame)
const roadsOf = new WeakMap<TrackData, RoadData[]>(), wallsOf = new WeakMap<TrackData, Pt[][]>();
export function zoneRoads(z: Zone): RoadData[] {
  if (z.kind === 'hub') return HUB.roads;
  const t = z.track; let r = roadsOf.get(t);
  if (!r) { r = [{ id: 'centre', pts: offsetPts(t.centre.pts, t.offset), loop: true, width: t.centre.width }]; roadsOf.set(t, r); }
  return r;
}
export function zoneWalls(z: Zone): Pt[][] {
  if (z.kind === 'hub') return HUB.walls;
  const t = z.track; let w = wallsOf.get(t);
  if (!w) { w = t.walls.map(p => offsetPts(p, t.offset)); wallsOf.set(t, w); }
  return w;
}
export function zoneBounds(z: Zone): Bounds {
  if (z.kind === 'hub') return HUB.bounds;
  const b = z.track.bounds, [ox, oz] = z.track.offset; return { minX: b.minX + ox, minZ: b.minZ + oz, maxX: b.maxX + ox, maxZ: b.maxZ + oz };
}
