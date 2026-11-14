// The position format, the districts and the timing of who hears whom (docs/superpowers/specs/2026-11-14-world-data-diet-design.md).
import { describe, expect, it } from 'vitest';
import { GATE_RETURN } from '../scene/world/gateSpot';
import { WORLD_PER_M as W } from './units';
import { PositionRelay, decodePositions, districtOf, encodeEntry, keepOnly, mergePositions, periodMs, relayed, type NetPos } from './netPositions';

const near = (a: number | undefined, b: number, tol: number) => expect(Math.abs((a ?? NaN) - b)).toBeLessThanOrEqual(tol);
const gate: NetPos = { x: GATE_RETURN.x, y: 0, z: GATE_RETURN.z, rotation: GATE_RETURN.rotY, district: 'strip' };
const town = (x: number, z: number, rotation = 0, y = 0): NetPos => ({ x, y, z, rotation, district: 'town' });
/** A player in the Strip at (x, z) metres, as the server relays it: the gate spot, with the Strip pose. */
const inStrip = (xm: number, zm: number, rotation = 0): NetPos => relayed(gate, { x: xm * W, y: 0, z: zm * W, rotation, district: 'strip' })!;

type World = Map<string, { n: number; pos: NetPos }>;
const world = (players: Record<string, NetPos>): World => new Map(Object.entries(players).map(([id, pos], k) => [id, { n: k + 1, pos }]));
const idOf = (w: World) => (n: number) => [...w].find(([, v]) => v.n === n)?.[0];
/** The ids in a flat list of entries, in order. */
const got = (flat: number[] | undefined, w: World) => Object.keys(decodePositions(flat ?? [], idOf(w)));

describe('the position format', () => {
  it('round-trips the three kinds', () => {
    const t = town(123.456, -987.654, 1.2345, 0.374);
    const s = inStrip(8123.4, -55.5, -2.5);
    const bare: NetPos = { x: -140, y: 0, z: 60, rotation: 0, district: 'strip' }; // a guest before its first Strip pose
    const flat = [...encodeEntry(1, t), ...encodeEntry(2, s), ...encodeEntry(3, bare)];
    expect(flat.every(Number.isInteger)).toBe(true);
    const out = decodePositions(JSON.parse(JSON.stringify(flat)), (n) => ['a', 'b', 'c'][n - 1]);
    expect(out.a.district).toBe('town'); expect(out.a.stripPosition).toBeUndefined();
    near(out.a.x, 123.456, 0.05); near(out.a.z, -987.654, 0.05); near(out.a.y, 0.374, 0.005); near(out.a.rotation, 1.2345, 0.005);
    // in the Strip: the town sees the gate spot, the Strip sees the pose
    expect(out.b).toMatchObject({ x: GATE_RETURN.x, y: 0, z: GATE_RETURN.z, rotation: GATE_RETURN.rotY, district: 'strip' });
    near(out.b.stripPosition?.x, 8123.4 * W, 0.05); near(out.b.stripPosition?.z, -55.5 * W, 0.05); near(out.b.stripPosition?.rotation, -2.5, 0.005);
    expect(out.b.stripPosition?.y).toBe(0);
    expect(out.c).toMatchObject({ x: -140, y: 0, z: 60, rotation: 0, district: 'strip' }); expect(out.c.stripPosition).toBeUndefined();
  });

  it('is short: a player in the hub takes about 21 characters', () => {
    expect(JSON.stringify(encodeEntry(57, inStrip(-287.65, 143.21, -1.57))).length).toBeLessThanOrEqual(24);
  });

  it('wraps headings into (-π, π]', () => {
    const out = decodePositions(encodeEntry(1, town(0, 0, 7)), () => 'a');
    near(out.a.rotation, 7 - 2 * Math.PI, 0.005);
    near(decodePositions(encodeEntry(1, town(0, 0, -7)), () => 'a').a.rotation, -7 + 2 * Math.PI, 0.005);
  });

  it('reads a missing height or heading as 0, as the page does today', () => {
    const out = decodePositions(encodeEntry(1, { x: 5, z: 6, district: 'town' }), () => 'a');
    expect(out.a).toEqual({ x: 5, y: 0, z: 6, rotation: 0, district: 'town' });
  });

  it('skips what it cannot read, and never throws', () => {
    const f = (n: number) => (n === 1 ? 'a' : n === 2 ? 'b' : undefined);
    expect(decodePositions('x', f)).toEqual({});
    expect(decodePositions(undefined, f)).toEqual({});
    expect(decodePositions([5, 1, 2], f)).toEqual({}); // truncated: a Strip pose needs three numbers
    expect(decodePositions([4.5, 1, 2, 3, 4], f)).toEqual({});
    expect(decodePositions([7, 1, 2, 3, 4], f)).toEqual({}); // kind 3 does not exist
    const two = [...encodeEntry(9, town(1, 1)), ...encodeEntry(2, town(2, 2))]; // an unknown player, then a known one
    expect(Object.keys(decodePositions(two, f))).toEqual(['b']);
  });
});

describe("the page's side", () => {
  it('merges a pos message by the short numbers on the records, and keeps the rest', () => {
    const kept = { a: town(1, 1), b: town(2, 2) };
    const players = { a: { n: 4 }, b: { n: 5 }, c: { n: 6 } };
    const next = mergePositions(kept, [...encodeEntry(5, town(20, 20)), ...encodeEntry(6, inStrip(3, 4))], players);
    expect(next).not.toBe(kept);
    expect(next.a).toBe(kept.a);
    expect(next.b).toMatchObject({ x: 20, z: 20, district: 'town' });
    expect(next.c.stripPosition).toMatchObject({ x: 3 * W, z: 4 * W });
    expect(kept.b).toMatchObject({ x: 2, z: 2 }); // the kept object is not changed in place
  });

  it('changes nothing for a message about nobody it knows', () => {
    const kept = { a: town(1, 1) };
    expect(mergePositions(kept, encodeEntry(9, town(5, 5)), { a: { n: 4 } })).toBe(kept);
    expect(mergePositions(kept, 'junk', { a: { n: 4 } })).toBe(kept);
    expect(mergePositions(kept, encodeEntry(4, town(5, 5)), undefined)).toBe(kept);
  });

  it('changes nothing for a message that repeats what it has (the reliable copy after a stop)', () => {
    const players = { a: { n: 4 }, b: { n: 5 } };
    const once = mergePositions({}, [...encodeEntry(4, town(1.25, 2.5, 0.5)), ...encodeEntry(5, inStrip(3, 4, 1))], players);
    const again = mergePositions(once, [...encodeEntry(4, town(1.25, 2.5, 0.5)), ...encodeEntry(5, inStrip(3, 4, 1))], players);
    expect(again).toBe(once);
    const moved = mergePositions(once, [...encodeEntry(4, town(1.25, 2.5, 0.5)), ...encodeEntry(5, inStrip(3, 5, 1))], players);
    expect(moved).not.toBe(once);
    expect(moved.a).toBe(once.a); // the one that did not move keeps its object
    expect(moved.b.stripPosition?.z).toBe(5 * W);
  });

  it('drops the positions of players who have gone, and only then makes a new object', () => {
    const kept = { a: town(1, 1), b: town(2, 2) };
    expect(keepOnly(kept, { a: {}, b: {} })).toBe(kept);
    expect(keepOnly(kept, { a: {} })).toEqual({ a: kept.a });
    expect(keepOnly(kept, undefined)).toEqual({});
  });
});

describe('districts', () => {
  it('places Strip players on the 8 km grid, and the town apart', () => {
    expect(districtOf(inStrip(0, 30))).toBe('strip:0,0'); // the hub's spawn
    expect(districtOf(inStrip(8000 - 481, -826))).toBe('strip:1,0'); // Spa's lobby
    expect(districtOf(inStrip(16000 + 731, 16000 - 330))).toBe('strip:2,2'); // Bathurst's lobby
    expect(districtOf(inStrip(-290, -150))).toBe('strip:0,0'); // a corner of the hub
    expect(districtOf(town(500, -900))).toBe('town');
    expect(districtOf({ x: -140, y: 0, z: 60, district: 'strip' })).toBe('strip:0,0'); // a guest with no Strip pose yet, at the rental bay
    expect(districtOf({ x: 3, z: 4 })).toBe('town'); // no district: the town, as the page reads it
  });
});

describe('how often', () => {
  it('follows the table: the 20 nearest within 200 m, 400 m, the district, elsewhere', () => {
    expect(periodMs(true, 0, 10)).toBe(100);
    expect(periodMs(true, 19, 199)).toBe(100);
    expect(periodMs(true, 20, 50)).toBe(500);
    expect(periodMs(true, 0, 250)).toBe(500);
    expect(periodMs(true, 0, 600)).toBe(1000);
    expect(periodMs(false, 0, 0)).toBe(5000);
  });
});

describe('the relay', () => {
  it('sends first contact and stops reliably, and moves as moving updates', () => {
    const r = new PositionRelay();
    const w = world({ a: inStrip(0, 0), b: inStrip(10, 0) });
    let out = r.tick(0, w, ['a', 'b']);
    expect(got(out.get('a')?.sure, w)).toEqual(['b']); expect(out.get('a')?.moving).toEqual([]);
    expect(got(out.get('b')?.sure, w)).toEqual(['a']);
    for (let t = 100; t <= 1000; t += 100) { // b drives; a stands still
      w.get('b')!.pos = inStrip(10 + t / 10, 0);
      out = r.tick(t, w, ['a', 'b']);
      expect(got(out.get('a')?.moving, w)).toEqual(['b']);
      expect(out.get('b')).toBeUndefined();
    }
    // b stops at 1000: nothing until 300 ms have passed, then its last position once, reliably
    expect(r.tick(1100, w, ['a', 'b']).get('a')).toBeUndefined();
    expect(r.tick(1200, w, ['a', 'b']).get('a')).toBeUndefined();
    out = r.tick(1300, w, ['a', 'b']);
    expect(got(out.get('a')?.sure, w)).toEqual(['b']); expect(out.get('a')?.moving).toEqual([]);
    near(decodePositions(out.get('a')!.sure, idOf(w)).b.stripPosition?.x, 110 * W, 0.05);
    expect(r.tick(1400, w, ['a', 'b']).get('a')).toBeUndefined();
  });

  it('repairs a dropped moving update: the stopped position comes again, reliably', () => {
    const r = new PositionRelay();
    const w = world({ a: inStrip(0, 0), b: inStrip(700, 0) }); // far: once a second
    r.tick(0, w, ['a']);
    w.get('b')!.pos = inStrip(701, 0);
    const lost = r.tick(1000, w, ['a']).get('a'); // this moving copy never arrives
    expect(got(lost?.moving, w)).toEqual(['b']);
    expect(r.tick(1100, w, ['a']).get('a')).toBeUndefined();
    expect(r.tick(1200, w, ['a']).get('a')).toBeUndefined();
    expect(got(r.tick(1300, w, ['a']).get('a')?.sure, w)).toEqual(['b']);
  });

  it('hears near players every tick, the rest of the district less often, other districts rarely', () => {
    const r = new PositionRelay();
    const w = world({ me: inStrip(0, 0), near: inStrip(100, 0), mid: inStrip(300, 0), far: inStrip(700, 0), away: inStrip(8000, 0) });
    const count: Record<string, number> = { near: 0, mid: 0, far: 0, away: 0 };
    for (let t = 0; t < 10_000; t += 100) {
      const step = t / 100 * 0.5; // everyone drives half a metre a tick
      w.get('near')!.pos = inStrip(100, step); w.get('mid')!.pos = inStrip(300, step);
      w.get('far')!.pos = inStrip(700, step); w.get('away')!.pos = inStrip(8000, step);
      const out = r.tick(t, w, ['me']).get('me');
      for (const id of [...got(out?.moving, w), ...got(out?.sure, w)]) count[id]++;
    }
    expect(count.near).toBe(100);
    expect(count.mid).toBeGreaterThanOrEqual(19); expect(count.mid).toBeLessThanOrEqual(21);
    expect(count.far).toBeGreaterThanOrEqual(9); expect(count.far).toBeLessThanOrEqual(11);
    expect(count.away).toBeGreaterThanOrEqual(2); expect(count.away).toBeLessThanOrEqual(3);
  });

  it('keeps the full rate for the 20 nearest: the 21st and 22nd come twice a second', () => {
    const players: Record<string, NetPos> = { me: inStrip(0, 0) };
    for (let i = 0; i < 22; i++) players['p' + i] = inStrip(2 + i * 4, 0); // all within 100 m
    const w = world(players), r = new PositionRelay();
    r.tick(0, w, ['me']);
    const count: Record<string, number> = {};
    for (let t = 100; t <= 1000; t += 100) {
      for (let i = 0; i < 22; i++) w.get('p' + i)!.pos = inStrip(2 + i * 4, t / 100);
      for (const id of got(r.tick(t, w, ['me']).get('me')?.moving, w)) count[id] = (count[id] ?? 0) + 1;
    }
    for (let i = 0; i < 20; i++) expect(count['p' + i]).toBe(10);
    expect(count.p20).toBe(2); expect(count.p21).toBe(2);
  });

  it('sends a change of district at once, reliably, to everyone', () => {
    const r = new PositionRelay();
    const w = world({ a: inStrip(0, 0), b: inStrip(700, 0), c: inStrip(8000, 0) });
    r.tick(0, w, ['a', 'c']);
    w.get('b')!.pos = inStrip(701, 0);
    r.tick(100, w, ['a', 'c']);
    w.get('b')!.pos = inStrip(8010, 0); // b goes to Spa, where c is
    const out = r.tick(200, w, ['a', 'c']);
    expect(got(out.get('a')?.sure, w)).toEqual(['b']);
    expect(got(out.get('c')?.sure, w)).toEqual(['b']);
  });

  it('never sends a player its own position; forget and forgetRecipient', () => {
    const r = new PositionRelay();
    const w = world({ a: inStrip(0, 0), b: inStrip(5, 0) });
    let out = r.tick(0, w, ['a', 'b']);
    expect(got(out.get('a')?.sure, w)).not.toContain('a');
    // b leaves: nobody hears of it, and it is sent nothing
    r.forget('b'); w.delete('b');
    w.get('a')!.pos = inStrip(1, 0);
    out = r.tick(100, w, ['a']);
    expect(out.get('b')).toBeUndefined(); expect(out.get('a')).toBeUndefined();
    // a's page starts again from nothing (a new init): it is sent everyone again, reliably
    w.set('c', { n: 9, pos: inStrip(20, 0) });
    r.tick(200, w, ['a']);
    r.forgetRecipient('a');
    expect(got(r.tick(300, w, ['a']).get('a')?.sure, w)).toEqual(['c']);
  });

  it('a player with no position of its own yet still hears everyone once, then the far rate', () => {
    expect(relayed(undefined, undefined)).toBeUndefined();
    expect(relayed(undefined, { x: 1, z: 2, district: 'strip' })).toBeUndefined();
    const r = new PositionRelay();
    const w = world({ b: inStrip(5, 0) }); // the recipient, a dealer who has not sent a position, is not in the world
    expect(got(r.tick(0, w, ['dealer']).get('dealer')?.sure, w)).toEqual(['b']);
    let sends = 0;
    for (let t = 100; t < 6000; t += 100) {
      w.get('b')!.pos = inStrip(5 + t / 100, 0);
      sends += got(r.tick(t, w, ['dealer']).get('dealer')?.moving, w).length;
    }
    expect(sends).toBe(1); // at 5000 ms
  });
});
