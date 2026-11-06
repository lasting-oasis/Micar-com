// The hub's roads as a graph: shortest paths for the GPS, random walks for the wandering traffic (pure geometry).
import { HUB, type Pt, type RoadData } from './district';
import { roadRoute, routePoint } from './routes';

type Edge = { to: number; w: number };
type Graph = { pts: Pt[]; adj: Edge[][] };
let graph: Graph | undefined;
const JUNCTION = 3, STRAIGHT_ON = 0.6;

function roadById(id: string): RoadData {
  const r = HUB.roads.find((x) => x.id === id);
  if (!r) throw new Error(`unknown hub road: ${id}`);
  return r;
}

function build(): Graph {
  const pts: Pt[] = [], owner: number[] = [], adj: Edge[][] = [];
  const link = (a: number, b: number) => {
    if (a === b || adj[a].some((e) => e.to === b)) return;
    const w = Math.hypot(pts[a][0] - pts[b][0], pts[a][1] - pts[b][1]);
    adj[a].push({ to: b, w }); adj[b].push({ to: a, w });
  };
  HUB.roads.forEach((road, ri) => {
    const base = pts.length;
    for (const p of road.pts) { pts.push([p[0], p[1]]); owner.push(ri); adj.push([]); }
    for (let k = 1; k < road.pts.length; k++) link(base + k - 1, base + k);
    if (road.loop && road.pts.length > 2) link(base + road.pts.length - 1, base);
  });
  for (let a = 0; a < pts.length; a++) for (let b = a + 1; b < pts.length; b++) {
    if (owner[a] !== owner[b] && Math.hypot(pts[a][0] - pts[b][0], pts[a][1] - pts[b][1]) <= JUNCTION) link(a, b);
  }
  return { pts, adj };
}
const G = (): Graph => (graph ??= build());

function nearestNode(g: Graph, x: number, z: number): number {
  let best = 0, bd = Infinity;
  for (let i = 0; i < g.pts.length; i++) { const d = (g.pts[i][0] - x) ** 2 + (g.pts[i][1] - z) ** 2; if (d < bd) { bd = d; best = i; } }
  return best;
}

/** Dijkstra along the roads between the road points nearest `from` and `to`; always at least 2 points. */
export function shortestPath(from: Pt, to: Pt): Pt[] {
  const g = G(), n = g.pts.length, s = nearestNode(g, from[0], from[1]), t = nearestNode(g, to[0], to[1]);
  const dist = new Array<number>(n).fill(Infinity), prev = new Array<number>(n).fill(-1), done = new Array<boolean>(n).fill(false);
  dist[s] = 0;
  for (;;) {
    let u = -1, ud = Infinity;
    for (let i = 0; i < n; i++) if (!done[i] && dist[i] < ud) { ud = dist[i]; u = i; }
    if (u < 0 || u === t) break;
    done[u] = true;
    for (const e of g.adj[u]) if (dist[u] + e.w < dist[e.to]) { dist[e.to] = dist[u] + e.w; prev[e.to] = u; }
  }
  const ids: number[] = [];
  if (s === t || prev[t] >= 0) for (let v = t; v >= 0; v = prev[v]) { ids.push(v); if (v === s) break; }
  ids.reverse();
  if (!ids.length) ids.push(s);
  const out = ids.map((i): Pt => [g.pts[i][0], g.pts[i][1]]);
  if (out.length < 2) out.push([out[0][0], out[0][1]]);
  return out;
}

/** Walk on from node cur (arrived from prevNode, heading dir) until `length` m have been added to out. */
function walk(g: Graph, cur: number, prevNode: number, dir: Pt | null, length: number, out: Pt[]): void {
  let got = 0, guard = 0;
  while (got < length && guard++ < 100000) {
    let opts = g.adj[cur].filter((e) => e.to !== prevNode);
    if (!opts.length) opts = g.adj[cur];
    if (!opts.length) break;
    let pick = opts[0];
    if (opts.length > 1) {
      const dx = dir ? dir[0] : 0, dz = dir ? dir[1] : 0;
      const score = (e: Edge) => { const vx = g.pts[e.to][0] - g.pts[cur][0], vz = g.pts[e.to][1] - g.pts[cur][1]; return (vx * dx + vz * dz) / (Math.hypot(vx, vz) || 1); };
      let straight = opts[0];
      for (const e of opts) if (score(e) > score(straight)) straight = e;
      if (!dir || Math.random() < STRAIGHT_ON) pick = straight;
      else { const others = opts.filter((e) => e !== straight); pick = others[Math.floor(Math.random() * others.length)]; }
    }
    const vx = g.pts[pick.to][0] - g.pts[cur][0], vz = g.pts[pick.to][1] - g.pts[cur][1], L = Math.hypot(vx, vz) || 1;
    dir = [vx / L, vz / L]; got += pick.w; prevNode = cur; cur = pick.to;
    out.push([g.pts[cur][0], g.pts[cur][1]]);
  }
}

export function wanderFrom(at: Pt, length: number): Pt[] {
  const g = G(), s = nearestNode(g, at[0], at[1]), out: Pt[] = [[g.pts[s][0], g.pts[s][1]]];
  walk(g, s, -1, null, length, out);
  return out;
}

export function extendWander(path: Pt[], length: number): Pt[] {
  if (!path.length) return [];
  const g = G(), last = path[path.length - 1], cur = nearestNode(g, last[0], last[1]), out = path.slice();
  let prevNode = -1, dir: Pt | null = null;
  if (path.length > 1) {
    const p = path[path.length - 2], vx = last[0] - p[0], vz = last[1] - p[1], L = Math.hypot(vx, vz);
    if (L > 1e-6) { dir = [vx / L, vz / L]; const pn = nearestNode(g, p[0], p[1]); if (pn !== cur) prevNode = pn; }
  }
  walk(g, cur, prevNode, dir, length, out);
  return out;
}

export function pointOnRoad(roadId: string, s: number): Pt {
  const p = routePoint(roadRoute(roadById(roadId)), s);
  return [p.x, p.z];
}
