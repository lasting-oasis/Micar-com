// A zone is where the player is: the hub, or one circuit (world metres, offset applied).
import { HUB, TRACK_LABELS, type Bounds, type Pt, type RoadData, type TrackData } from './district';
import { offsetPts } from './routes';

export type Zone = { kind: 'hub' } | { kind: 'track'; track: TrackData };
export type ZoneMarker = { id: string; kind: 'event' | 'portal' | 'return'; at: Pt; label: { en: string; es: string } };

export function zoneRoads(z: Zone): RoadData[] {
  if (z.kind === 'hub') return HUB.roads;
  const t = z.track; return [{ id: 'centre', pts: offsetPts(t.centre.pts, t.offset), loop: true, width: t.centre.width }];
}
export function zoneWalls(z: Zone): Pt[][] { return z.kind === 'hub' ? HUB.walls : z.track.walls.map(w => offsetPts(w, z.track.offset)); }
export function zoneBounds(z: Zone): Bounds {
  if (z.kind === 'hub') return HUB.bounds;
  const b = z.track.bounds, [ox, oz] = z.track.offset; return { minX: b.minX + ox, minZ: b.minZ + oz, maxX: b.maxX + ox, maxZ: b.maxZ + oz };
}
export function zoneMarkers(z: Zone): ZoneMarker[] {
  if (z.kind === 'hub') return Object.keys(HUB.portals).map(id => ({ id, kind: 'portal' as const, at: HUB.portals[id], label: TRACK_LABELS[id] }));
  const t = z.track, [ox, oz] = t.offset;
  const out: ZoneMarker[] = Object.keys(t.markers).map(id => ({ id, kind: 'event' as const, at: [t.markers[id][0] + ox, t.markers[id][1] + oz] as Pt, label: { en: id, es: id } }));
  out.push({ id: 'return', kind: 'return', at: [t.return[0] + ox, t.return[1] + oz], label: { en: 'Back to the paddock', es: 'Volver al paddock' } });
  return out;
}
