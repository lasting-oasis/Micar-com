import { describe, expect, it } from 'vitest';
import tracksJson from './strip/tracks.json';
import maps from './strip/circuitMaps.json';
import { EVENTS, freshStrip, STAGE_REP, type StripRecord } from './data';
import { CIRCUITS, circuitView, eventViews, firstCircuit, fmtTime, labelRadiusPx, menuKey, menuKeydown, startAction, startBar, unitsPerPx, type CircuitMaps, type MenuState } from './raceMenu';

const M = maps as unknown as CircuitMaps;
const rec = (o: Partial<StripRecord> = {}): StripRecord => ({ ...freshStrip(), ...o });
const ids = tracksJson.tracks.map(t => t.id);

describe('the race menu: circuits', () => {
  it('lists the ten circuits in tracks.json order, each with a country and a line about it in both languages', () => {
    expect(CIRCUITS.map(c => c.id)).toEqual(ids);
    for (const c of CIRCUITS) {
      expect(c.cc).toMatch(/^[A-Z]{2}$/);
      for (const l of ['en', 'es'] as const) { expect(c.country[l].length).toBeGreaterThan(2); expect(c.blurb[l].length).toBeGreaterThan(30); }
    }
  });

  it('shows a circuit with its MiCar name, place in the list, length in the player units, corners, events and best', () => {
    const r = rec({ rep: 1e9, best: { ardennes_gp: 161.3 } });          // every stage open
    const v = circuitView('spa', 'en', r, 'kmh', M);
    expect(v).toMatchObject({ id: 'spa', n: 1, of: 10, name: 'Ardennes', country: 'Belgium', cc: 'BE', length: '7.0 km', events: 2, best: '2:41.3', locked: false });
    expect(v.corners).toBe(M.circuits.spa.corners.length);
    expect(circuitView('spa', 'es', r, 'mph', M)).toMatchObject({ name: 'Ardenas', country: 'Bélgica', length: '4.3 mi' });
    expect(circuitView('monza', 'en', rec(), 'kmh', M).best).toBeNull();
  });

  it('locks a circuit only when every one of its events is locked', () => {
    const stages = (t: string) => EVENTS.filter(e => e.track === t).map(e => e.stage);
    const t = ids.find(id => Math.min(...stages(id)) > 1)!;            // a circuit with no stage-1 event
    expect(t).toBeTruthy();
    expect(circuitView(t as never, 'en', rec(), 'kmh', M).locked).toBe(true);
    expect(circuitView(t as never, 'en', rec({ rep: 1e9 }), 'kmh', M).locked).toBe(false);
  });

  it('opens on the circuit last raced, else the first with an unwon unlocked lapped event, else the first', () => {
    expect(firstCircuit(rec(), 'figure8_gp')).toBe('suzuka');
    const first = CIRCUITS.find(c => EVENTS.some(e => e.track === c.id && e.loop && e.stage <= 1))!.id;
    expect(firstCircuit(rec())).toBe(first);
    const allWon = rec({ rep: 1e9, wins: Object.fromEntries(EVENTS.map(e => [e.id, 1])) });
    expect(firstCircuit(allWon)).toBe(ids[0]);
  });
});

describe('the race menu: events', () => {
  it("lists a circuit's events with type colour, laps or length, prize, best and lock", () => {
    const evs = eventViews('monaco', 'en', rec({ best: { harbour_gp: 95.42 } }), 'kmh');
    expect(evs.map(e => e.id).sort()).toEqual(['harbour_drift', 'harbour_gp', 'harbour_x']);
    const gp = evs.find(e => e.id === 'harbour_gp')!;
    expect(gp).toMatchObject({ name: 'Harbour GP', type: 'circuit', prize: '$1,500', best: '1:35.4', locked: false });
    expect(gp.detail).toMatch(/^2 laps · 3\.\d km$/);
    expect(eventViews('monaco', 'es', rec(), 'kmh').find(e => e.id === 'harbour_gp')!.detail).toMatch(/^2 vueltas · 3\.\d km$/);
    const drag = eventViews('monza', 'en', rec(), 'mph').find(e => e.type === 'drag')!;
    expect(drag.detail).toMatch(/mi$/);
    const locked = EVENTS.find(e => e.stage > 1)!;
    const v = eventViews(locked.track, 'en', rec(), 'kmh').find(e => e.id === locked.id)!;
    expect(v).toMatchObject({ locked: true, stage: locked.stage });
  });

  it('starts an unlocked event with a car, refuses a locked one or one without a car', () => {
    const open = EVENTS.find(e => e.stage === 1)!, closed = EVENTS.find(e => e.stage > 1)!;
    expect(startAction(open, rec(), true)).toBe('start');
    expect(startAction(open, rec(), false)).toBe('needCar');
    expect(startAction(closed, rec(), true)).toBe('locked');
    expect(startAction(closed, rec({ rep: STAGE_REP[closed.stage - 1] }), true)).toBe('start');
  });

  it('times read m:ss.s, and seconds alone under a minute', () => {
    expect(fmtTime(161.34)).toBe('2:41.3');
    expect(fmtTime(59.94)).toBe('59.94');
    expect(fmtTime(12.8)).toBe('12.80');
  });
});

describe('the race menu: keys', () => {
  const n = (c: number) => EVENTS.filter(e => e.track === CIRCUITS[c].id).length;
  const at = (s: MenuState, ...keys: Parameters<typeof menuKey>[1][]) => {
    let st: MenuState | string = s;
    for (const k of keys) { const a = menuKey(st as MenuState, k, n); if (a.kind !== 'state') return a.kind === 'start' ? 'start:' + a.eventId : a.kind; st = a.state; }
    return st;
  };
  it('arrows move between circuits (wrapping), Enter opens its events, Enter again starts, Esc steps back then closes', () => {
    const s0: MenuState = { step: 'circuit', circuit: 0, event: 0 };
    expect(at(s0, 'left')).toEqual({ step: 'circuit', circuit: 9, event: 0 });
    expect(at(s0, 'right', 'right')).toEqual({ step: 'circuit', circuit: 2, event: 0 });
    const ev = at(s0, 'enter') as MenuState;
    expect(ev.step).toBe('event');
    const evs = EVENTS.filter(e => e.track === CIRCUITS[0].id);
    expect(at(s0, 'enter', 'right', 'enter')).toBe('start:' + evs[(ev.event + 1) % evs.length].id);
    expect(at(s0, 'enter', 'back')).toEqual({ step: 'circuit', circuit: 0, event: 0 });
    expect(at(s0, 'back')).toBe('close');
  });
});

describe('the race menu: the keyboard while it is open', () => {
  const kd = (key: string, code: string, repeat = false) => ({ key, code, repeat });
  it('lets T through to the game (it closes the menu) and keeps every other key from the game', () => {
    const down = new Set<string>();
    expect(menuKeydown(kd('t', 'KeyT'), down)).toEqual({ stop: false, prevent: false });
    expect(menuKeydown(kd('e', 'KeyE'), down)).toEqual({ stop: true, prevent: false });      // E would leave the car
    expect(menuKeydown(kd('m', 'KeyM'), down)).toEqual({ stop: true, prevent: false });
    expect(menuKeydown(kd('Shift', 'ShiftLeft'), down)).toEqual({ stop: true, prevent: false });
  });
  it('reads the arrows, WASD, Enter, Esc and Backspace as the menu keys', () => {
    const k = (key: string, code: string) => menuKeydown(kd(key, code), new Set()).key;
    expect([k('ArrowLeft', 'ArrowLeft'), k('ArrowRight', 'ArrowRight'), k('ArrowUp', 'ArrowUp'), k('ArrowDown', 'ArrowDown')]).toEqual(['left', 'right', 'up', 'down']);
    expect([k('a', 'KeyA'), k('d', 'KeyD'), k('w', 'KeyW'), k('s', 'KeyS')]).toEqual(['left', 'right', 'up', 'down']);
    expect([k('Enter', 'Enter'), k('Enter', 'NumpadEnter'), k('Escape', 'Escape'), k('Backspace', 'Backspace')]).toEqual(['enter', 'enter', 'back', 'back']);
    expect(menuKeydown(kd('ArrowLeft', 'ArrowLeft'), new Set())).toMatchObject({ stop: true, prevent: true });
  });
  it('ignores the repeats of a key held down before it opened, and never repeats Enter or Esc', () => {
    const down = new Set<string>();
    expect(menuKeydown(kd('ArrowLeft', 'ArrowLeft', true), down).key).toBeUndefined();   // steering held while opening
    expect(menuKeydown(kd('ArrowRight', 'ArrowRight'), down).key).toBe('right');
    expect(menuKeydown(kd('ArrowRight', 'ArrowRight', true), down).key).toBe('right');   // held here: it scrolls
    expect(menuKeydown(kd('Enter', 'Enter'), down).key).toBe('enter');
    expect(menuKeydown(kd('Enter', 'Enter', true), down)).toEqual({ stop: true, prevent: true });  // a held Enter starts nothing
    expect(menuKeydown(kd('Escape', 'Escape', true), down).key).toBeUndefined();
  });
});

describe('the race menu: drawing the map', () => {
  it('puts the start bar across the line at its first point, half its length each side', () => {
    const b = startBar([[0, 0], [10, 0], [10, 10], [0, 10]], true, 5);           // a loop: the line runs along x at its start
    expect(Math.hypot(b.x2 - b.x1, b.y2 - b.y1)).toBeCloseTo(10);
    expect((b.x1 + b.x2) / 2).toBeCloseTo(0); expect((b.y1 + b.y2) / 2).toBeCloseTo(0);
    const open = startBar([[0, 0], [0, 10], [0, 20]], false, 3);                    // a sprint going north: the bar runs east-west
    expect(open.y1).toBeCloseTo(0); expect(open.y2).toBeCloseTo(0); expect(Math.abs(open.x2 - open.x1)).toBeCloseTo(6);
  });
  it('sizes the corner numbers so neighbours never overlap (the data keeps them 3% of the diagonal apart), hiding them when too small to read', () => {
    expect(labelRadiusPx(1200)).toBe(10);                                            // capped
    expect(labelRadiusPx(500)).toBeCloseTo(7.5);                                     // 15 px across = 3% of 500 px
    expect(2 * labelRadiusPx(560)).toBeLessThanOrEqual(0.03 * 560 + 1e-9);
    expect(labelRadiusPx(300)).toBe(0);                                              // 4.5 px: not drawn
  });
  it('sizes labels in screen pixels by the box side that fits the map (a wide short box is limited by its height)', () => {
    expect(unitsPerPx(1000, 500, 500, 250)).toBeCloseTo(2);
    expect(unitsPerPx(1000, 500, 2000, 250)).toBeCloseTo(2);                         // height-bound: 500 units over 250 px
    expect(unitsPerPx(1000, 500, 250, 1000)).toBeCloseTo(4);                         // width-bound
    expect(unitsPerPx(1000, 500, 0, 0)).toBeGreaterThan(0);                          // not measured yet
  });
});
