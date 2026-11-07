#!/usr/bin/env node
// Fetch real circuit centrelines from OpenStreetMap (Overpass) and write
// tools/tracks/data/<id>.json. Map data (c) OpenStreetMap contributors, ODbL 1.0.
//
//   node tools/tracks/fetch_osm_tracks.mjs [id...]   fetch and write
//   node tools/tracks/fetch_osm_tracks.mjs --check   re-validate committed files offline
//
// Options: --raw=<dir>   keep raw Overpass responses there (default: OS temp dir)
//          --cached      reuse a raw response from --raw if present (no network)
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const HERE = dirname(fileURLToPath(import.meta.url));
const DATA = resolve(HERE, 'data');
const ENDPOINTS = ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter'];
const UA = 'micar-tracks/1.0';
const STEP = 3; // resample spacing, metres
const TOL = 0.03; // length tolerance against the published lap
const HINT_MAX = 150; // metres from the start hint to the nearest loop point

// id, name, lapM (published lap, m), dir (race direction seen from above),
// widthM, centre [lat, lon], start [lat, lon] (start/finish hint)
export const TABLE = [
  { id: 'spa', name: 'Ardennes', lapM: 7004, dir: 'cw', widthM: 12, centre: [50.4372, 5.9714], start: [50.4443, 5.9653] },
  { id: 'monza', name: 'Royal Park', lapM: 5793, dir: 'cw', widthM: 12, centre: [45.6156, 9.2811], start: [45.6189, 9.2812], excludeIds: [38168756] },
  { id: 'silverstone', name: 'Airfield', lapM: 5891, dir: 'cw', widthM: 12, centre: [52.0786, -1.0169], start: [52.0787, -1.017] },
  { id: 'suzuka', name: 'Figure Eight', lapM: 5807, dir: 'cw', widthM: 12, centre: [34.8431, 136.541], start: [34.845, 136.5383] },
  { id: 'nurburgring', name: 'Eifel', lapM: 5148, dir: 'cw', widthM: 12, centre: [50.3356, 6.9475], start: [50.3328, 6.9412] },
  {
    id: 'monaco', name: 'Harbour', lapM: 3337, dir: 'cw', widthM: 10, centre: [43.7347, 7.4206], start: [43.7347, 7.4214],
    twoWay: true, // public streets: walk either way (the race runs against the one-way on the pool stretch)
    snapM: 25, // street segments in OSM often stop short of the next one: snap way ends to unconnected ways this far
    attempts: [{
      radius: 1200,
      filter: '["highway"]["name"~"Boulevard Albert 1er|Avenue d\'Ostende|Avenue de Monte-Carlo|Place du Casino|Avenue des Spélugues|Boulevard Louis II|Avenue (J.F.|John F.) Kennedy|Avenue de la Quarantaine|Avenue Princesse Grace|Quai Albert 1er|Boulevard du Larvotto|Tunnel Louis II|Quai Antoine 1er|Quai Chicane|Quai Louis II|Quai des États-Unis|Route de la Piscine|Rascasse|Circuit de Monaco"]',
      keepAll: true, // tunnels stay; the raceway exclusion rules do not apply to streets
    }],
  },
  { id: 'interlagos', name: 'Lagoons', lapM: 4309, dir: 'ccw', widthM: 12, centre: [-23.7036, -46.6997], start: [-23.7013, -46.6968] },
  { id: 'cota', name: 'Lone Star', lapM: 5513, dir: 'ccw', widthM: 12, centre: [30.1328, -97.6411], start: [30.1346, -97.6355] },
  { id: 'laguna', name: 'Dry Lagoon', lapM: 3602, dir: 'ccw', widthM: 11, centre: [36.5841, -121.753], start: [36.5868, -121.7512] },
  {
    id: 'bathurst', name: 'The Mountain', lapM: 6213, dir: 'ccw', widthM: 11, centre: [-33.4422, 149.55], start: [-33.4393, 149.5585],
    attempts: [
      { radius: 3500, filter: '["highway"="raceway"]' },
      { radius: 3500, filter: '["highway"]["alt_name"~"Mount Panorama"]', keepAll: true },
    ],
  },
];

const DEFAULT_ATTEMPT = { radius: 3500, filter: '["highway"="raceway"]' };
const NAME_EXCLUDE = /pit|kart|paddock|support|moto|junior|ex circuito|oval|anello|sopraelevata|variant.*moto/i;

function excluded(way, circuit, attempt) {
  if ((circuit.excludeIds ?? []).includes(way.id)) return 'id';
  if (attempt.keepAll) return null;
  const t = way.tags ?? {};
  if (t.sport === 'karting') return 'karting';
  if (t.historic !== undefined) return 'historic';
  if (t.note === 'draft') return 'draft';
  if (t.access === 'private') return 'private';
  if (t.service !== undefined) return 'service';
  if (t.raceway === 'pit_lane') return 'pit_lane';
  // "Pit Straight" is the start/finish straight, not the pit lane
  if (t.name && NAME_EXCLUDE.test(t.name.replace(/pit straight/i, ''))) return 'name';
  return null;
}

// ---------- projection ----------
export const projector = ([lat0, lon0]) => ({
  x: (lon) => (lon - lon0) * Math.cos((lat0 * Math.PI) / 180) * 111320,
  z: (lat) => -(lat - lat0) * 110540,
});

const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);

function signedArea(pts) {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i], q = pts[(i + 1) % pts.length];
    a += (p[0] * q[1] - q[0] * p[1]) / 2;
  }
  return a;
}

function polyLen(pts, closed) {
  let l = 0;
  for (let i = 0; i + 1 < pts.length; i++) l += dist(pts[i], pts[i + 1]);
  if (closed) l += dist(pts[pts.length - 1], pts[0]);
  return l;
}

// ---------- graph ----------
export function buildGraph(ways, circuit, proj, bidir) {
  const MERGE = 2;
  // nodes: id -> [x, z]; merge ids within 2 m with a grid + union-find
  const pos = new Map();
  const waysUsed = [];
  for (const w of ways) {
    if (!w.nodes || !w.geometry) continue;
    waysUsed.push(w);
    w.nodes.forEach((id, i) => {
      const g = w.geometry[i];
      if (g && !pos.has(id)) pos.set(id, [proj.x(g.lon), proj.z(g.lat)]);
    });
  }
  const parent = new Map([...pos.keys()].map((k) => [k, k]));
  const find = (k) => { while (parent.get(k) !== k) { parent.set(k, parent.get(parent.get(k))); k = parent.get(k); } return k; };
  const grid = new Map();
  for (const [id, p] of pos) {
    const cx = Math.floor(p[0] / MERGE), cz = Math.floor(p[1] / MERGE);
    for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
      for (const o of grid.get(`${cx + dx},${cz + dz}`) ?? []) {
        if (dist(pos.get(o), p) <= MERGE) parent.set(find(id), find(o));
      }
    }
    const key = `${cx},${cz}`;
    if (!grid.has(key)) grid.set(key, []);
    grid.get(key).push(id);
  }
  if (circuit.snapM) {
    // join each way end to the nearest node of another, not yet connected, way
    for (const w of waysUsed) {
      for (const id of [w.nodes[0], w.nodes[w.nodes.length - 1]]) {
        if (!pos.has(id)) continue;
        let best = null, bd = circuit.snapM;
        for (const o of waysUsed) {
          if (o === w) continue;
          for (const m of o.nodes) {
            const d = pos.has(m) ? dist(pos.get(id), pos.get(m)) : Infinity;
            if (d < bd && find(m) !== find(id)) { bd = d; best = m; }
          }
        }
        if (best !== null) parent.set(find(id), find(best));
      }
    }
  }
  const rep = new Map(); // representative id -> position (first seen)
  for (const [id, p] of pos) { const r = find(id); if (!rep.has(r)) rep.set(r, p); }

  const adj = new Map(); // rep -> [{to, len, way}]
  const edges = [];
  const add = (a, b, w) => {
    if (a === b) return;
    const len = dist(rep.get(a), rep.get(b));
    const e = { from: a, to: b, len, way: w.id };
    if (!adj.has(a)) adj.set(a, []);
    adj.get(a).push(e);
    edges.push(e);
  };
  for (const w of waysUsed) {
    const ow = w.tags?.oneway;
    const fwd = ow === 'yes' || ow === 'true' || ow === '1';
    const rev = ow === '-1';
    const both = ow === 'no' || circuit.twoWay || bidir;
    for (let i = 0; i + 1 < w.nodes.length; i++) {
      if (!pos.has(w.nodes[i]) || !pos.has(w.nodes[i + 1])) continue;
      const a = find(w.nodes[i]), b = find(w.nodes[i + 1]);
      if (rev && !both) add(b, a, w);
      else { add(a, b, w); if (both) add(b, a, w); }
    }
  }
  return { rep, adj, edges };
}

function distToSeg(p, a, b) {
  const dx = b[0] - a[0], dz = b[1] - a[1];
  const l2 = dx * dx + dz * dz;
  const t = l2 === 0 ? 0 : Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / l2));
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dz));
}

// Closed loop through the edge nearest the start hint whose length is nearest lapM.
// Plain chains of nodes (two neighbours only) are collapsed into one step so the
// depth-first search only branches at real junctions.
function findLoop(graph, hint, lapM) {
  const { rep, adj, edges } = graph;
  let start = null, bestD = Infinity;
  for (const e of edges) {
    const d = distToSeg(hint, rep.get(e.from), rep.get(e.to));
    if (d < bestD) { bestD = d; start = e; }
  }
  if (!start) throw new Error('no ways kept');

  const nbrs = new Map(); // node -> set of neighbours, either direction
  for (const e of edges) {
    for (const [a, b] of [[e.from, e.to], [e.to, e.from]]) {
      if (!nbrs.has(a)) nbrs.set(a, new Set());
      nbrs.get(a).add(b);
    }
  }
  const through = (n) => n !== start.from && n !== start.to && nbrs.get(n).size === 2;
  const chainCache = new Map();
  const chainsFrom = (node) => {
    if (chainCache.has(node)) return chainCache.get(node);
    const out = [];
    for (const first of adj.get(node) ?? []) {
      const nodes = [node, first.to];
      let len = first.len, prev = node, cur = first.to, ok = true;
      while (through(cur)) {
        const next = (adj.get(cur) ?? []).find((e) => e.to !== prev);
        if (!next) { ok = false; break; } // one-way dead end
        nodes.push(next.to); len += next.len; prev = cur; cur = next.to;
        if (nodes.length > 100000) { ok = false; break; }
      }
      if (ok) out.push({ nodes, len, end: cur });
    }
    chainCache.set(node, out);
    return out;
  };

  const maxLen = lapM * (1 + TOL * 1.5);
  let best = null, bestErr = Infinity, steps = 0;
  const onPath = new Set([start.from, start.to]);
  const path = [start.from, start.to];
  const dfs = (node, len) => {
    if (++steps > 20_000_000) return;
    for (const c of chainsFrom(node)) {
      const nl = len + c.len;
      if (nl + dist(rep.get(c.end), rep.get(start.from)) > maxLen) continue; // cannot get home in time
      if (c.end === start.from) {
        const err = Math.abs(nl - lapM);
        // not a trivial there-and-back along the start edge
        if (err < bestErr && path.length + c.nodes.length - 1 > 3) { bestErr = err; best = [...path, ...c.nodes.slice(1, -1)]; }
        continue;
      }
      if (onPath.has(c.end)) continue;
      const added = c.nodes.slice(1);
      onPath.add(c.end); path.push(...added);
      dfs(c.end, nl);
      onPath.delete(c.end); path.length -= added.length;
    }
  };
  dfs(start.to, start.len);
  if (!best) return { loop: null, steps };
  return { loop: best.map((id) => rep.get(id)), steps, startDist: bestD };
}

// ---------- resample / orient ----------
function arcResample(pts, count) {
  const total = polyLen(pts, true);
  const n = count ?? Math.round(total / STEP);
  const step = total / n;
  const closed = [...pts, pts[0]];
  const out = [];
  let seg = 0, segStart = 0;
  for (let k = 0; k < n; k++) {
    const target = k * step;
    while (seg < closed.length - 2 && segStart + dist(closed[seg], closed[seg + 1]) < target) {
      segStart += dist(closed[seg], closed[seg + 1]);
      seg++;
    }
    const a = closed[seg], b = closed[seg + 1];
    const l = dist(a, b) || 1;
    const t = Math.max(0, Math.min(1, (target - segStart) / l));
    out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
  }
  return { out, total };
}

const minChord = (p) => Math.min(...p.map((q, i) => dist(q, p[(i + 1) % p.length])));

// Resample at equal arc length (STEP). Sharp kinks in the OSM geometry make a 3 m arc
// round a near-reversal have a much shorter chord: relax them (light smoothing, then
// resample again) until every chord is >= 2.3 m. lenM stays the length of the traced loop.
function resample(loopPts) {
  let pts = [loopPts[0]];
  for (let i = 1; i < loopPts.length; i++) if (dist(loopPts[i], pts[pts.length - 1]) > 1e-6) pts.push(loopPts[i]);
  if (dist(pts[0], pts[pts.length - 1]) < 1e-6) pts.pop();
  const lenM = polyLen(pts, true);
  let { out } = arcResample(pts);
  const n0 = out.length; // keep the point count of the traced length
  for (let iter = 0; iter < 40 && minChord(out) < 2.3; iter++) {
    for (let pass = 0; pass < 5; pass++) {
      out = out.map((q, i) => {
        const a = out[(i + out.length - 1) % out.length], b = out[(i + 1) % out.length];
        return [0.25 * a[0] + 0.5 * q[0] + 0.25 * b[0], 0.25 * a[1] + 0.5 * q[1] + 0.25 * b[1]];
      });
    }
    out = arcResample(out, n0).out;
  }
  return { pts: out, lenM };
}

function orient(pts, dir, hintXZ) {
  const a = signedArea(pts);
  const wantNeg = dir === 'cw';
  let out = pts;
  if ((a < 0) !== wantNeg) out = [...pts].reverse();
  let bi = 0, bd = Infinity;
  out.forEach((p, i) => { const d = dist(p, hintXZ); if (d < bd) { bd = d; bi = i; } });
  return { pts: [...out.slice(bi), ...out.slice(0, bi)], hintDist: bd };
}

// ---------- network ----------
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let lastRequest = 0;

async function overpass(ql) {
  let lastErr;
  for (const url of ENDPOINTS) {
    for (let tryN = 0; tryN < 2; tryN++) {
      const wait = lastRequest + 2000 - Date.now();
      if (wait > 0) await sleep(wait);
      lastRequest = Date.now();
      try {
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'User-Agent': UA, 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({ data: ql }).toString(),
        });
        if (!res.ok) throw new Error(`${url} -> HTTP ${res.status}`);
        return await res.text();
      } catch (e) { lastErr = e; await sleep(3000); }
    }
  }
  throw lastErr;
}

async function getRaw(circuit, attempt, i, rawDir, cached) {
  const file = join(rawDir, `${circuit.id}${i ? `-${i}` : ''}.json`);
  if (cached && existsSync(file)) return readFileSync(file, 'utf8');
  const [lat, lon] = circuit.centre;
  const ql = `[out:json][timeout:90];way(around:${attempt.radius},${lat},${lon})${attempt.filter};out body geom;`;
  const text = await overpass(ql);
  mkdirSync(rawDir, { recursive: true });
  writeFileSync(file, text);
  return text;
}

async function build(circuit, rawDir, cached) {
  const attempts = circuit.attempts ?? [DEFAULT_ATTEMPT];
  const proj = projector(circuit.centre);
  const hint = [proj.x(circuit.start[1]), proj.z(circuit.start[0])];
  const log = [];
  for (let i = 0; i < attempts.length; i++) {
    const attempt = attempts[i];
    const text = await getRaw(circuit, attempt, i, rawDir, cached);
    const json = JSON.parse(text); // untrusted data: parse only
    const all = (json.elements ?? []).filter((e) => e.type === 'way');
    const dropped = {};
    const kept = all.filter((w) => {
      const why = excluded(w, circuit, attempt);
      if (why) dropped[why] = (dropped[why] ?? 0) + 1;
      return !why;
    });
    log.push(`attempt ${i}: ${all.length} ways, kept ${kept.length}, dropped ${JSON.stringify(dropped)}`);
    if (!kept.length) continue;
    // directed first (way direction), then either-way as a fallback
    for (const bidir of circuit.twoWay ? [false] : [false, true]) {
      const mode = bidir ? 'either-way' : 'directed';
      const graph = buildGraph(kept, circuit, proj, bidir);
      const { loop, steps } = findLoop(graph, hint, circuit.lapM);
      if (!loop) { log.push(`${mode}: no loop (${steps} steps)`); continue; }
      log.push(`${mode}: ${steps} search steps`);
      const { pts: rs, lenM } = resample(loop);
      const err = Math.abs(lenM - circuit.lapM) / circuit.lapM;
      log.push(`${mode}: loop ${lenM.toFixed(1)} m (${(err * 100).toFixed(2)} %)`);
      if (err > TOL) continue;
      const { pts, hintDist } = orient(rs, circuit.dir, hint);
      if (hintDist > HINT_MAX) throw new Error(`${circuit.id}: start hint is ${hintDist.toFixed(0)} m from the loop; correct the table\n${log.join('\n')}`);
      return {
        log, hintDist,
        out: {
          id: circuit.id, name: circuit.name, source: 'OpenStreetMap', licence: 'ODbL',
          fetchedAt: new Date().toISOString(), lapM: circuit.lapM, lenM: Math.round(lenM * 10) / 10,
          widthM: circuit.widthM, centre: circuit.centre,
          pts: pts.map(([x, z]) => [Math.round(x * 100) / 100, Math.round(z * 100) / 100]),
        },
      };
    }
  }
  throw new Error(`${circuit.id}: no closed loop within ${TOL * 100} % of ${circuit.lapM} m\n${log.join('\n')}`);
}

// ---------- check ----------
export function checkFile(circuit, file) {
  if (!existsSync(file)) return 'missing file';
  const d = JSON.parse(readFileSync(file, 'utf8'));
  const proj = projector(circuit.centre);
  if (d.id !== circuit.id) return 'wrong id';
  if (d.source !== 'OpenStreetMap' || d.licence !== 'ODbL') return 'source/licence';
  if (Number.isNaN(Date.parse(d.fetchedAt))) return 'fetchedAt';
  if (d.lapM !== circuit.lapM) return 'lapM differs from table';
  if (d.widthM !== circuit.widthM) return 'widthM differs from table';
  if (Math.abs(d.lenM - d.lapM) / d.lapM > TOL) return `length ${d.lenM} vs ${d.lapM}`;
  const pts = d.pts;
  if (!Array.isArray(pts) || Math.abs(pts.length - Math.round(d.lenM / STEP)) > 2) return 'point count vs length';
  for (let i = 0; i < pts.length; i++) {
    const s = dist(pts[i], pts[(i + 1) % pts.length]);
    if (s < 2 || s > 4) return `spacing ${s.toFixed(2)} m at point ${i}`;
  }
  const a = signedArea(pts);
  if ((circuit.dir === 'cw') !== (a < 0)) return 'wrong direction';
  const hint = [proj.x(circuit.start[1]), proj.z(circuit.start[0])];
  const hd = dist(pts[0], hint);
  if (hd > HINT_MAX) return `pts[0] is ${hd.toFixed(0)} m from the start hint`;
  return null;
}

async function main() {
  const args = process.argv.slice(2);
  const flags = args.filter((a) => a.startsWith('--'));
  const ids = args.filter((a) => !a.startsWith('--'));
  const rawArg = flags.find((f) => f.startsWith('--raw='));
  const rawDir = rawArg ? resolve(rawArg.slice(6)) : join(tmpdir(), 'micar-osm-raw');
  const chosen = ids.map((id) => {
    const c = TABLE.find((t) => t.id === id);
    if (!c) throw new Error(`unknown circuit ${id}`);
    return c;
  });
  const list = chosen.length ? chosen : TABLE;

  if (flags.includes('--check')) {
    let bad = 0;
    for (const c of list) {
      let why;
      try { why = checkFile(c, join(DATA, `${c.id}.json`)); } catch (e) { why = String(e.message ?? e); }
      if (why) { bad++; console.log(`FAIL ${c.id}: ${why}`); } else console.log(`ok ${c.id}`);
    }
    process.exit(bad ? 1 : 0);
  }

  mkdirSync(DATA, { recursive: true });
  let bad = 0;
  for (const c of list) {
    try {
      const r = await build(c, rawDir, flags.includes('--cached'));
      writeFileSync(join(DATA, `${c.id}.json`), JSON.stringify(r.out));
      console.log(`${c.id}: ${r.log.join(' | ')} -> lenM ${r.out.lenM} (lap ${c.lapM}), ${r.out.pts.length} pts, hint ${r.hintDist.toFixed(0)} m`);
    } catch (e) { bad++; console.error(`FAIL ${c.id}: ${e.message ?? e}`); }
  }
  process.exit(bad ? 1 : 0);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
