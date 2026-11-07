// The Strip's typed data: the hub and ten circuits (exported from Blender). Track files load on demand.
import hubJson from './hub.json';
import tracksJson from './tracks.json';
import { buildRoute, offsetPts, type Pt, type RoadData, type Route } from './routes';

export type { Pt, RoadData };
export type TrackId = string;
export type Bounds = { minX: number; minZ: number; maxX: number; maxZ: number };
export type HubData = {
  version: number; bounds: Bounds;
  spawn: { x: number; z: number; h: number }; exit: { x: number; z: number; r: number };
  rental: { bay: { x: number; z: number; h: number }; cam: { x: number; y: number; z: number }; kiosk: { x: number; z: number } };
  roads: RoadData[]; wander: string; walls: Pt[][]; portals: Record<string, Pt>;
};
export type TrackRoute = { pts: Pt[]; loop: boolean; cps: number[] };
export type TrackData = {
  version: number; id: string; name: string; offset: Pt; bounds: Bounds;
  lobby: { x: number; z: number; h: number }; return: Pt;
  centre: { pts: Pt[]; width: number; loop: boolean };
  routes: Record<string, TrackRoute>; walls: Pt[][]; markers: Record<string, Pt>;
};
export type TracksIndex = { version: number; tracks: { id: string; name: string; offset: Pt; lenM: number; events: string[] }[] };

export const HUB = hubJson as unknown as HubData;
export const TRACKS = (tracksJson as unknown as TracksIndex).tracks;
export const SPAWN = HUB.spawn, EXIT = HUB.exit, RENTAL = HUB.rental, BOUNDS = HUB.bounds;

export const TRACK_LABELS: Record<string, { en: string; es: string }> = {
  spa: { en: 'Ardennes', es: 'Ardenas' }, monza: { en: 'Royal Park', es: 'Parque Real' },
  silverstone: { en: 'Airfield', es: 'Aeródromo' }, suzuka: { en: 'Figure Eight', es: 'Ocho' },
  nurburgring: { en: 'Eifel', es: 'Eifel' }, monaco: { en: 'Harbour', es: 'Puerto' },
  interlagos: { en: 'Lagoons', es: 'Lagunas' }, cota: { en: 'Lone Star', es: 'Estrella Solitaria' },
  laguna: { en: 'Dry Lagoon', es: 'Laguna Seca' }, bathurst: { en: 'The Mountain', es: 'La Montaña' },
};

export function offsetOf(trackId: TrackId): Pt {
  const t = TRACKS.find(k => k.id === trackId); if (!t) throw new Error('unknown track: ' + trackId); return t.offset;
}
export function trackOfEvent(eventId: string): TrackId {
  const t = TRACKS.find(k => k.events.includes(eventId)); if (!t) throw new Error('unknown event: ' + eventId); return t.id;
}

const cache = new Map<TrackId, TrackData>();
const pending = new Map<TrackId, Promise<TrackData>>();
const routeCache = new Map<string, Route>();
let assetBase = '/';
export function setAssetBase(base: string): void { assetBase = base; }
/** Put a track's data in the cache (used by loadTrack and the node reader). */
export function registerTrack(trackId: TrackId, data: TrackData): void {
  cache.set(trackId, data);
  for (const e of TRACKS.find(k => k.id === trackId)?.events ?? []) routeCache.delete(e); // never serve stale routes
}
/** Drop a track from the cache (tests: to exercise a failing load). */
export function forgetTrack(trackId: TrackId): void { cache.delete(trackId); pending.delete(trackId); }
export function trackLoaded(trackId: TrackId): TrackData | undefined { return cache.get(trackId); }
export function loadTrack(trackId: TrackId, fetcher?: (url: string) => Promise<TrackData>): Promise<TrackData> {
  const hit = cache.get(trackId); if (hit) return Promise.resolve(hit);
  let p = pending.get(trackId);
  if (!p) {
    const f = fetcher ?? ((url: string) => fetch(url).then(r => { if (!r.ok) throw new Error(`track ${trackId}: HTTP ${r.status}`); return r.json() as Promise<TrackData>; }));
    p = f(assetBase + 'strip/tracks/' + trackId + '.json').then(d => { registerTrack(trackId, d); pending.delete(trackId); return d; },
      e => { pending.delete(trackId); throw e; });
    pending.set(trackId, p);
  }
  return p;
}
function need(eventId: string): TrackData {
  const id = trackOfEvent(eventId), t = cache.get(id); if (!t) throw new Error('track not loaded: ' + id); return t;
}
export function routeFor(eventId: string): Route {
  const c = routeCache.get(eventId); if (c) return c;
  const t = need(eventId), r = t.routes[eventId]; if (!r) throw new Error('no route: ' + eventId);
  const route = buildRoute(offsetPts(r.pts, t.offset), r.loop, r.cps); routeCache.set(eventId, route); return route;
}
export function markerFor(eventId: string): Pt {
  const t = need(eventId), m = t.markers[eventId]; if (!m) throw new Error('no marker: ' + eventId);
  return [m[0] + t.offset[0], m[1] + t.offset[1]];
}
