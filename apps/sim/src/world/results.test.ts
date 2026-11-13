import { describe, expect, it } from 'vitest';
import { pauseCard, shownResults } from './results';
import { buildRoute } from './strip/routes';
import { RaceTiming } from './strip/timing';
import type { ActiveEvent, EventResults, Standing } from './strip/events';
import { fmtT } from './hud';
import { EVENTS } from './data';

const ev = (id: string) => EVENTS.find(e => e.id === id)!;
const res = (o: Partial<EventResults> = {}): EventResults => ({
  pos: 1, failed: null, type: 'circuit', ev: ev('harbour_gp'), time: 160, score: 0,
  list: [
    { name: 'You', me: true, key: 'me', ft: 160, best: 52.4, gap: null },
    { name: 'Rico', key: 'r0', color: '#f00', ft: 161.25, best: 51.9, gap: 1.25 },
    { name: 'Nadia', key: 'r1', color: '#0f0', ft: 170.5, best: 55, gap: 10.5, estimated: true },
    { name: 'Vince', key: 'r2', ft: null, s: 900, best: null, gap: null },
  ],
  ...o,
});

describe('shownResults', () => {
  it("rows carry time, gap and best lap, and flag the race's fastest lap", () => {
    const r = shownResults(res(), 'en');
    expect(r.rows[0]).toMatchObject({ me: true, txt: fmtT(160), gap: '', best: fmtT(52.4), fastest: false });
    expect(r.rows[1]).toMatchObject({ gap: '+1.25', best: fmtT(51.9), fastest: true, color: '#f00' });
  });

  it('an estimated finish keeps its asterisk; no finish reads DNF', () => {
    const r = shownResults(res(), 'en');
    expect(r.rows[2].txt.endsWith('*')).toBe(true);
    expect(r.rows[3].txt).toBe('DNF');
    expect(r.rows[3].best).toBe('--');
  });

  it('a drift shows scores as today', () => {
    const r = shownResults(res({ type: 'drift', ev: ev('harbour_drift'), list: [{ name: 'You', me: true, score: 12345 }, { name: 'Rico', score: 9000 }] }), 'en');
    expect(r.rows[0].txt).toBe('12,345');
    expect(r.rows[0].best).toBeUndefined();
  });

  it('titles in Spanish', () => {
    expect(shownResults(res(), 'es').title).toBe('Ganaste');
    expect(shownResults(res({ pos: 2 }), 'es').title).toBe('Puesto 2');
    expect(shownResults(res({ pos: 2 }), 'en').title).toBe('2nd place');
  });

  it('pauseCard shows lap, position, last and best, and nothing outside a lap race', () => {
    const r = buildRoute([[0, 0], [0, 400], [300, 400], [300, 0]], true);
    const a = { type: 'circuit', state: 'race', route: r, laps: 3, pLap: 1, ev: ev('harbour_gp'), timing: new RaceTiming(r.len, true), time: 80 } as unknown as ActiveEvent;
    const st: Standing[] = [{ name: 'Rico', key: 'r0' }, { name: 'You', me: true, key: 'me' }, { name: 'A', key: 'r1' }, { name: 'B', key: 'r2' }];
    expect(pauseCard(a, st, 'Honda Civic')).toEqual({ event: ev('harbour_gp').name, lap: '2/3', pos: '2/4', last: '--', best: '--', car: 'Honda Civic' });
    expect(pauseCard({ ...a, type: 'drag' } as ActiveEvent, st, '')).toBeNull();
  });
});
