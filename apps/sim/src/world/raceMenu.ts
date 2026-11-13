/* The race menu's model (RaceMenu.tsx draws it): the circuits in tracks.json order with their country and a line
   about each, what the circuit and event cards show (in the player's language and units), the first circuit to
   show, the keys, and whether an event can start. Pure: the screen and tests share it. */
import tracksJson from './strip/tracks.json';
import { EVENTS, EV_COL, TRACK_NAMES, stageOf, type EventDef, type EventType, type StripRecord } from './data';
import type { TrackId } from './strip/district';
import { t, type Lang } from '../i18n';

/** src/world/strip/circuitMaps.json (tools/blender/circuit_maps.py): outlines in game metres, from the start line */
export type CircuitMaps = {
  version: 1;
  circuits: Record<string, { len: number; pts: [number, number][]; sectors: [number, number]; corners: [number, number, number, number][] }>;
  events: Record<string, { loop: boolean; pts: [number, number][] }>;
};
type L2 = { en: string; es: string };
type Units = 'kmh' | 'mph';

/** The ten circuits in tracks.json order: the country each is in (MiCar names its layout) and a line about it. */
export const CIRCUITS: { id: TrackId; cc: string; country: L2; blurb: L2 }[] = [
  { id: 'spa', cc: 'BE', country: { en: 'Belgium', es: 'Bélgica' },
    blurb: { en: 'Long and fast: a hairpin at the start, flat-out curves through the forest and a tight chicane to finish.', es: 'Largo y rápido: una horquilla al salir, curvas a fondo por el bosque y una chicana cerrada al final.' } },
  { id: 'monza', cc: 'IT', country: { en: 'Italy', es: 'Italia' },
    blurb: { en: 'The fastest of them all: long straights through the park, broken by tight chicanes.', es: 'El más rápido de todos: largas rectas por el parque, cortadas por chicanas cerradas.' } },
  { id: 'silverstone', cc: 'GB', country: { en: 'United Kingdom', es: 'Reino Unido' },
    blurb: { en: 'An old airfield: quick sweepers, a flat-out run of esses and long straights between them.', es: 'Un antiguo aeródromo: curvas rápidas, unas eses a fondo y largas rectas entre ellas.' } },
  { id: 'suzuka', cc: 'JP', country: { en: 'Japan', es: 'Japón' },
    blurb: { en: 'The figure eight: winding esses, a hairpin and a bridge over its own track.', es: 'El ocho: eses enlazadas, una horquilla y un puente sobre su propia pista.' } },
  { id: 'nurburgring', cc: 'DE', country: { en: 'Germany', es: 'Alemania' },
    blurb: { en: 'Modern and technical: a tight first corner, a flowing middle and a fast final chicane.', es: 'Moderno y técnico: una primera curva cerrada, un tramo fluido y una chicana final rápida.' } },
  { id: 'monaco', cc: 'MC', country: { en: 'Monaco', es: 'Mónaco' },
    blurb: { en: 'Narrow streets by the sea: walls close by, a tight hairpin and no room for mistakes.', es: 'Calles estrechas junto al mar: muros cerca, una horquilla cerrada y ningún margen de error.' } },
  { id: 'interlagos', cc: 'BR', country: { en: 'Brazil', es: 'Brasil' },
    blurb: { en: 'Anticlockwise and short: a tricky first corner, a twisty middle and a long run to the line.', es: 'Antihorario y corto: una primera curva complicada, un tramo revirado y una larga recta a la meta.' } },
  { id: 'cota', cc: 'US', country: { en: 'United States', es: 'Estados Unidos' },
    blurb: { en: 'A wide first corner, quick esses and a long back straight to set up the passes.', es: 'Una primera curva amplia, eses rápidas y una larga recta trasera para preparar los adelantamientos.' } },
  { id: 'laguna', cc: 'US', country: { en: 'United States', es: 'Estados Unidos' },
    blurb: { en: 'Short and busy: corner after corner, and barely a straight to rest on.', es: 'Corto y exigente: curva tras curva, y apenas una recta para descansar.' } },
  { id: 'bathurst', cc: 'AU', country: { en: 'Australia', es: 'Australia' },
    blurb: { en: 'Tight walls through a twisting middle section, then flat out down the long straight.', es: 'Muros cerrados en un tramo central revirado y luego a fondo por la larga recta.' } },
];

const INDEX = tracksJson.tracks as unknown as { id: string; lenM: number; events: string[]; routeLenM: Record<string, number> }[];
export const eventsOf = (id: TrackId): EventDef[] => EVENTS.filter(e => e.track === id);
const locked = (ev: EventDef, rec: StripRecord) => ev.stage > stageOf(rec.rep);

/** a time in seconds as the race HUD and the results card show it: m:ss.hh from a minute, else seconds to the
 *  hundredth; rounded once to the hundredth, so 119.997 reads 2:00.00 (never 1:60.00) */
export const fmtTime = (s: number): string => {
  const c = Math.round(s * 100), m = Math.floor(c / 6000), r = (c - m * 6000) / 100;
  return m ? `${m}:${r.toFixed(2).padStart(5, '0')}` : r.toFixed(2);
};
const dist = (m: number, units: Units): string => units === 'mph' ? (m / 1609.344).toFixed(1) + ' mi' : (m / 1000).toFixed(1) + ' km';
const money = (n: number) => '$' + Math.round(n).toLocaleString('en-US');

export type CircuitView = { id: TrackId; n: number; of: number; name: string; country: string; cc: string; blurb: string; length: string; corners: number; events: number; best: string | null; locked: boolean };
export function circuitView(id: TrackId, lang: Lang, rec: StripRecord, units: Units, maps: CircuitMaps): CircuitView {
  const i = CIRCUITS.findIndex(c => c.id === id), c = CIRCUITS[i], evs = eventsOf(id);
  const bests = evs.filter(e => e.loop && rec.best[e.id] != null).map(e => rec.best[e.id]);
  return {
    id, n: i + 1, of: CIRCUITS.length, name: TRACK_NAMES[id as keyof typeof TRACK_NAMES][lang], country: c.country[lang], cc: c.cc, blurb: c.blurb[lang],
    length: dist(INDEX.find(x => x.id === id)!.lenM, units), corners: maps.circuits[id]?.corners.length ?? 0, events: evs.length,
    best: bests.length ? fmtTime(Math.min(...bests)) : null, locked: evs.every(e => locked(e, rec)),
  };
}

export type EventView = { id: string; type: EventType; name: string; col: string; detail: string; prize: string; best: string | null; locked: boolean; stage: number };
export function eventViews(id: TrackId, lang: Lang, rec: StripRecord, units: Units): EventView[] {
  const lens = INDEX.find(x => x.id === id)!.routeLenM;
  return eventsOf(id).map(e => {
    const len = lens[e.id] ?? 0;
    const detail = e.type === 'drag'
      ? (units === 'mph' ? (len > 600 ? '1/2 mi' : '1/4 mi') : Math.round(len) + ' m')
      : e.loop && e.laps ? `${e.laps} ${t(lang, e.laps === 1 ? 'races.lap' : 'races.laps')} · ${dist(len, units)}` : dist(len, units);
    return { id: e.id, type: e.type, name: e.name, col: EV_COL[e.type], detail, prize: money(e.prize), best: rec.best[e.id] != null ? fmtTime(rec.best[e.id]) : null, locked: locked(e, rec), stage: e.stage };
  });
}

/** The circuit to show first: the one last raced, else the first with an unwon unlocked lapped event, else the first. */
export function firstCircuit(rec: StripRecord, lastEventId?: string | null): TrackId {
  const last = lastEventId ? EVENTS.find(e => e.id === lastEventId) : undefined;
  if (last) return last.track;
  const open = CIRCUITS.find(c => eventsOf(c.id).some(e => e.loop && !locked(e, rec) && !(rec.wins[e.id] > 0)));
  return (open ?? CIRCUITS[0]).id;
}

export type MenuState = { step: 'circuit' | 'event'; circuit: number; event: number };
export type MenuKey = 'left' | 'right' | 'up' | 'down' | 'enter' | 'back';
export type MenuAction = { kind: 'state'; state: MenuState } | { kind: 'close' } | { kind: 'start'; eventId: string };
/** One key: arrows move (wrapping), Enter goes from a circuit to its events and starts an event, Esc steps back. */
export function menuKey(s: MenuState, k: MenuKey, count: (circuit: number) => number): MenuAction {
  const N = CIRCUITS.length, st = (o: Partial<MenuState>): MenuAction => ({ kind: 'state', state: { ...s, ...o } });
  if (s.step === 'circuit') {
    if (k === 'left') return st({ circuit: (s.circuit - 1 + N) % N });
    if (k === 'right') return st({ circuit: (s.circuit + 1) % N });
    if (k === 'enter') return st({ step: 'event', event: 0 });
    if (k === 'back') return { kind: 'close' };
    return st({});
  }
  const n = Math.max(1, count(s.circuit));
  if (k === 'left' || k === 'up') return st({ event: (s.event - 1 + n) % n });
  if (k === 'right' || k === 'down') return st({ event: (s.event + 1) % n });
  if (k === 'enter') return { kind: 'start', eventId: eventsOf(CIRCUITS[s.circuit].id)[s.event].id };
  return st({ step: 'circuit', event: 0 });
}

/** Whether the event can start now: not locked by stage, and a car to race in. */
export function startAction(ev: EventDef, rec: StripRecord, canDrive: boolean): 'start' | 'locked' | 'needCar' {
  if (locked(ev, rec)) return 'locked';
  return canDrive ? 'start' : 'needCar';
}

const BY_KEY: Record<string, MenuKey> = { ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down', Enter: 'enter', Escape: 'back', Backspace: 'back' };
const BY_CODE: Record<string, MenuKey> = { KeyA: 'left', KeyD: 'right', KeyW: 'up', KeyS: 'down' };
/** A keydown while the menu is open. The menu is modal: no keydown but T (the game's key, which closes it) reaches
 *  the game (`stop`). The browser's default is taken (`prevent`) for the menu's own keys and for those the game would
 *  have taken itself (Space would click a button behind the menu, Tab would move behind it, Alt would open the
 *  browser's menu bar on Windows, a letter could start Find); not for the browser's shortcuts or F-keys. `down`
 *  holds the keys pressed since it opened: a repeat counts only for one of them (a steering key held while opening
 *  must not spin the cards), and Enter and Esc never repeat. Keyups are not the menu's: they reach the game, so a key
 *  held when it opened is let go. */
export function menuKeydown(e: { key: string; code: string; repeat: boolean; ctrlKey?: boolean; metaKey?: boolean }, down: Set<string>): { stop: boolean; prevent: boolean; key?: MenuKey } {
  if (e.code === 'KeyT') return { stop: false, prevent: false };
  const k = BY_KEY[e.key] ?? BY_CODE[e.code];
  if (!k) return { stop: true, prevent: !e.ctrlKey && !e.metaKey && (e.key.length === 1 || e.key === 'Tab' || e.key === 'Alt') };
  if (e.repeat) { if (k === 'enter' || k === 'back' || !down.has(e.code)) return { stop: true, prevent: true }; }
  else down.add(e.code);
  return { stop: true, prevent: true, key: k };
}

/** A bar across a line at its first point (the start line), `half` long each side; a loop's line runs in from its last point. */
export function startBar(P: [number, number][], loop: boolean, half: number): { x1: number; y1: number; x2: number; y2: number } {
  const a = loop ? P[P.length - 1] : P[0], b = P[1], tx = b[0] - a[0], tz = b[1] - a[1], l = Math.hypot(tx, tz) || 1;
  return { x1: P[0][0] - (tz / l) * half, y1: P[0][1] + (tx / l) * half, x2: P[0][0] + (tz / l) * half, y2: P[0][1] - (tx / l) * half };
}

/** Map units per screen pixel for a vw x vh view fitted ("meet") into a bw x bh box: the tighter side decides.
 *  Before the box is measured, a 600 px map is assumed. */
export const unitsPerPx = (vw: number, vh: number, bw: number, bh: number): number => bw > 0 && bh > 0 ? Math.max(vw / bw, vh / bh) : Math.max(vw, vh) / 600;

/** A corner number's radius in screen pixels for a circuit drawn `diagPx` across (its points' diagonal): at most 1.5%
 *  of it, as circuit_maps.py keeps labels 3% of the diagonal apart, so two never overlap; at most 10 px; 0 (not
 *  drawn) below 5.5 px, too small to read. */
export const labelRadiusPx = (diagPx: number): number => { const r = Math.min(10, 0.015 * diagPx); return r < 5.5 ? 0 : r; };

/** What keeps the race menu shut (T does nothing, the Race button hides): the Garage, the pause menu, a results card,
 *  the full map, a live event or one still loading its circuit, an outrun, a challenge (its race, its card, its room). */
export type RacesGate = { garage: boolean; paused: boolean; results: boolean; map: boolean; event: boolean; starting: boolean; outrun: boolean; netRace: boolean; counter: boolean; challenge: boolean; room: boolean };
export const racesAllowed = (g: RacesGate): boolean => !(g.garage || g.paused || g.results || g.map || g.event || g.starting || g.outrun || g.netRace || g.counter || g.challenge || g.room);
