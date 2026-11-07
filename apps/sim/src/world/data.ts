/* Night Tuner 03-data.js — cars, parts, tuning, events — ported as typed data.
   The car lot becomes body-style archetypes that real cars (carSpecs.ts) are scaled onto;
   the localStorage save becomes StripRecord. Prices are dollars, unchanged. */
import { carParams, simStats, type PerfCfg, type Tune, type VehicleSpec } from './physics';
import { getCarSpec, hasModelSpec, type CarSpec } from '../carSpecs';
import type { TrackId } from './strip/district';

type Tier = PerfCfg['engine'];
const clone = <T>(o: T): T => JSON.parse(JSON.stringify(o)) as T;

/* ---- cars: Night Tuner's lot, the base records for the archetypes ---- */
type Torque = [number, number][];
const CARS = {
  civet: { id: 'civet', name: 'Civet R', drive: 'FWD', mass: 1180, a: 1.08, b: 1.42, h: .5, cd: .32, area: 2.0, redline: 7200, r: .31, fin: 4.3, gears: [3.4, 2.05, 1.42, 1.08, .86, .72],
    tq: [[1000, 135], [2500, 168], [4000, 186], [5500, 184], [6500, 172], [7300, 150]] },
  kanjo: { id: 'kanjo', name: 'Kanjo S', drive: 'FWD', mass: 1020, a: 1.05, b: 1.4, h: .49, cd: .31, area: 1.9, redline: 8100, r: .3, fin: 4.4, gears: [3.5, 2.2, 1.55, 1.2, .98, .82],
    tq: [[1000, 110], [3000, 150], [5000, 170], [6500, 168], [7500, 160], [8200, 140]] },
  ronin: { id: 'ronin', name: 'Ronin GT', drive: 'RWD', mass: 1340, a: 1.28, b: 1.32, h: .48, cd: .33, area: 2.05, redline: 7300, r: .32, fin: 4.0, gears: [3.55, 2.12, 1.5, 1.13, .9, .76],
    tq: [[1000, 175], [2500, 222], [4000, 252], [5500, 258], [6500, 242], [7400, 210]] },
  tsubasa: { id: 'tsubasa', name: 'Tsubasa R4', drive: 'AWD', mass: 1540, a: 1.3, b: 1.33, h: .5, cd: .34, area: 2.1, redline: 7000, r: .32, fin: 3.9, gears: [3.6, 2.2, 1.55, 1.18, .95, .8],
    tq: [[1000, 210], [2500, 270], [4000, 305], [5500, 310], [6500, 290], [7100, 250]] },
  brute: { id: 'brute', name: 'Brute 440', drive: 'RWD', mass: 1720, a: 1.35, b: 1.4, h: .52, cd: .38, area: 2.3, redline: 6200, r: .34, fin: 3.7, gears: [3.0, 1.9, 1.4, 1.0, .8, .66],
    tq: [[1000, 330], [2000, 400], [3500, 440], [4500, 430], [5500, 390], [6300, 330]] },
} satisfies Record<string, VehicleSpec>;

export type BodyStyle = 'sedan' | 'coupe' | 'sports' | 'hatchback' | 'suv' | 'van' | 'truck';
const peak = (tq: Torque) => Math.max(...tq.map(q => q[1]));
const scaleTq = (tq: Torque, k: number): Torque => tq.map(([r, t]) => [r, t * k]);
const arch = (id: BodyStyle, name: string, base: VehicleSpec, over: Partial<VehicleSpec>): VehicleSpec =>
  ({ ...clone(base), ...over, id, name });

export const ARCHETYPES: Record<BodyStyle, VehicleSpec> = {
  hatchback: arch('hatchback', 'Hatchback', CARS.civet, {}),
  coupe: arch('coupe', 'Coupe', CARS.ronin, {}),
  sedan: arch('sedan', 'Sedan', CARS.tsubasa, {}),
  // Kanjo's high-revving torque shape, brought up to Ronin's peak, on Ronin's chassis.
  sports: arch('sports', 'Sports', CARS.ronin, { redline: 8100, tq: scaleTq(CARS.kanjo.tq as Torque, peak(CARS.ronin.tq as Torque) / peak(CARS.kanjo.tq as Torque)) }),
  truck: arch('truck', 'Truck', CARS.brute, { mass: 2300, h: .62, cd: .42, area: 2.9 }),
  suv: arch('suv', 'SUV', CARS.brute, { tq: scaleTq(CARS.brute.tq as Torque, .85), mass: 2000, h: .58, cd: .38, area: 2.7, drive: 'AWD' }),
  van: arch('van', 'Van', CARS.tsubasa, { mass: 1900, h: .6, cd: .36, area: 2.8, drive: 'FWD' }),
};
/** The rental fleet drives on the artifact's own five records. */
export const FLEET_SPECS: Record<'civet' | 'kanjo' | 'ronin' | 'tsubasa' | 'brute', VehicleSpec> = {
  civet: clone<VehicleSpec>(CARS.civet), kanjo: clone<VehicleSpec>(CARS.kanjo), ronin: clone<VehicleSpec>(CARS.ronin), tsubasa: clone<VehicleSpec>(CARS.tsubasa), brute: clone<VehicleSpec>(CARS.brute),
};
const FLEET_NAMES: Record<string, keyof typeof FLEET_SPECS> = { 'Civet R': 'civet', 'Kanjo S': 'kanjo', 'Ronin GT': 'ronin', 'Tsubasa R4': 'tsubasa', 'Brute 440': 'brute' };
export const STYLES = Object.keys(ARCHETYPES) as BodyStyle[];

/* ---- visual parts: v=value, n=name, p=price, d=description; rmax = star-rating weight of the category ---- */
export type VisualCfg = {
  color: string; finish: 'gloss' | 'metallic' | 'pearl' | 'candy' | 'matte';
  rim: 'stock' | 'spoke5' | 'mesh' | 'dish' | 'fan' | 'split'; rimSize: 17 | 18 | 19 | 20; rimColor: string;
  front: 0 | 1 | 2 | 3; rear: 0 | 1 | 2; skirts: 0 | 1 | 2; spoiler: 0 | 1 | 2 | 3 | 4; hood: 0 | 1 | 2 | 3; roof: 0 | 1;
  vinyl: 0 | 1 | 2 | 3 | 4; vinylColor: string; tint: 0 | 1 | 2 | 3; neon: string; lights: string; hydraulics: 0 | 1;
};
export type CarCfg = VisualCfg & { perf: PerfCfg };
export type PartValue = string | number;
export type CatItem = { v: PartValue; n: string; p: number; d?: string; r?: number; stage?: number };
export type Cat = { n: string; cam: string; rmax?: number; flat?: boolean; perf?: boolean; items: CatItem[] };

export const PALETTE: [string, string][] = [['#b9bec5', 'Silver'], ['#c8102e', 'Rosso'], ['#1f4fbf', 'Bayside Blue'], ['#9be02a', 'Lime Rush'], ['#3b1f6b', 'Midnight Purple'], ['#ff6a13', 'Sunset Orange'], ['#e9ecef', 'Pearl White'], ['#3d434b', 'Gunmetal'], ['#0c0c0e', 'Jet Black'], ['#ffd21f', 'Canary'], ['#0f8b8d', 'Teal'], ['#ff2d95', 'Hot Pink'], ['#8c5a2b', 'Bronze'], ['#9fd3ff', 'Ice Blue'], ['#134a32', 'Racing Green'], ['#5a0a14', 'Black Cherry']];
const LI = (arr: [PartValue, string, number?, string?][]): CatItem[] => arr.map(([v, n, p, d]) => ({ v, n, p: p || 0, d }));
export const CATS: Record<string, Cat> = {
  color: { n: 'Paint color', cam: 'top34', rmax: .3, flat: true, items: PALETTE.map(([v, n], i) => ({ v, n, p: i ? 400 : 0 })) },
  finish: { n: 'Paint finish', cam: 'top34', rmax: .6, items: LI([['gloss', 'Gloss', 0, 'Factory clear coat.'], ['metallic', 'Metallic', 600, 'Metal flake under the clear.'], ['pearl', 'Pearl', 900, 'Soft shimmer that shifts with the light.'], ['candy', 'Candy', 1500, 'Deep, wet, mirror-bright.'], ['matte', 'Matte', 1200, 'Flat finish, no reflections.']]) },
  rim: { n: 'Rims', cam: 'wheel', rmax: .8, items: LI([['stock', 'Stock 6-spoke'], ['spoke5', 'Rally 5', 1400], ['mesh', 'Cross Mesh', 2200], ['dish', 'Deep Dish', 2600], ['fan', 'Turbofan', 2000], ['split', 'Split 7', 1800]]) },
  rimSize: { n: 'Rim size', cam: 'wheel', rmax: .4, items: LI([[17, '17 inch'], [18, '18 inch', 600], [19, '19 inch', 1000], [20, '20 inch', 1500]]) },
  rimColor: { n: 'Rim color', cam: 'wheel', rmax: .3, flat: true, items: LI([['#c9ced6', 'Silver'], ['chrome', 'Chrome', 800], ['#141518', 'Gloss black', 500], ['#c9a227', 'Gold', 900], ['#8a5a32', 'Bronze', 700], ['body', 'Body color', 400], ['#f2f2f2', 'White', 500]]) },
  front: { n: 'Front bumper', cam: 'front', rmax: .8, items: LI([[0, 'Stock'], [1, 'Street lip', 900], [2, 'Canards', 1600], [3, 'Wide splitter', 2400]]) },
  rear: { n: 'Rear bumper', cam: 'rear', rmax: .6, items: LI([[0, 'Stock'], [1, 'Diffuser', 1200], [2, 'Race diffuser', 2200]]) },
  skirts: { n: 'Side skirts', cam: 'side', rmax: .5, items: LI([[0, 'Stock'], [1, 'Slim', 700], [2, 'Deep', 1400]]) },
  spoiler: { n: 'Spoiler', cam: 'rear', rmax: .9, items: LI([[0, 'None'], [1, 'Ducktail', 900], [2, 'Low wing', 1500], [3, 'GT wing', 2400], [4, 'Swan neck', 3200]]) },
  hood: { n: 'Hood', cam: 'hood', rmax: .7, items: LI([[0, 'Stock'], [1, 'Ram scoop', 1400], [2, 'Twin vents', 1800], [3, 'Carbon', 2200]]) },
  roof: { n: 'Roof scoop', cam: 'top34', rmax: .3, items: LI([[0, 'None'], [1, 'Roof scoop', 800]]) },
  vinyl: { n: 'Vinyl', cam: 'top34', rmax: .8, items: LI([[0, 'None'], [1, 'Twin stripes', 900], [2, 'Center stripe', 900], [3, 'Side stripe', 700], [4, 'Race number', 600]]) },
  vinylColor: { n: 'Vinyl color', cam: 'top34', rmax: .1, flat: true, items: LI([['#ffffff', 'White'], ['#111111', 'Black', 200], ['#e10600', 'Red', 200], ['#ffd21f', 'Yellow', 200], ['#38d6ff', 'Cyan', 200], ['#9be02a', 'Lime', 200], ['#ff2d95', 'Pink', 200]]) },
  tint: { n: 'Window tint', cam: 'side34', rmax: .3, items: LI([[0, 'Clear'], [1, 'Light', 300], [2, 'Dark', 500], [3, 'Limo', 700]]) },
  neon: { n: 'Underglow', cam: 'low', rmax: .6, flat: true, items: LI([['none', 'None'], ['#22e5ff', 'Cyan', 750], ['#ff2bd6', 'Magenta', 750], ['#7dff3a', 'Lime', 750], ['#ff2a2a', 'Red', 750], ['#8a4dff', 'Purple', 750], ['#ffffff', 'White', 750]]) },
  lights: { n: 'Headlights', cam: 'front', rmax: .3, flat: true, items: LI([['#fff1d6', 'Halogen'], ['#cfe6ff', 'Xenon', 600], ['#ffcf5a', 'Amber', 500]]) },
  hydraulics: { n: 'Hydraulics', cam: 'low', rmax: .7, items: LI([[0, 'None'], [1, 'Hydraulic kit', 2200, 'Hold H and press the arrows to lift each end. J to hop.']]) },
};
for (const k in CATS) { const c = CATS[k], rmax = c.rmax ?? 0; c.items.forEach((it, i) => { it.r = c.flat ? (it.p ? rmax : 0) : rmax * i / Math.max(1, c.items.length - 1); }); }

/* ---- performance parts: 3 tiers, tier unlocks by career stage ---- */
export const PERF: Record<keyof PerfCfg, [name: string, prices: number[], desc: string]> = { engine: ['Engine', [0, 1800, 4800, 9800], 'More torque across the range.'], ecu: ['ECU', [0, 900, 2400, 5200], 'Remapped fuel and timing. Raises the redline.'], turbo: ['Turbo', [0, 2600, 6200, 11500], 'Forced induction. Spools with revs, hits up top.'], trans: ['Transmission', [0, 1400, 3600, 7200], 'Quicker shifts, less drivetrain loss.'], susp: ['Suspension', [0, 1200, 3200, 6400], 'Sharper turn-in, more composure.'], nos: ['Nitrous', [0, 1600, 3800, 7000], 'Bottle and flow. Alt fires it. Refills slowly.'], tires: ['Tires', [0, 900, 2600, 5200], 'More grip for cornering, braking and launches.'], brakes: ['Brakes', [0, 900, 2200, 4400], 'Shorter stops, steadier under braking.'], weight: ['Weight reduction', [0, 1200, 3400, 6800], 'Lighter car: faster everywhere.'] };
export const TIER = ['Stock', 'Street', 'Pro', 'Extreme'], TIER_STAGE = [1, 1, 2, 3];
for (const k in PERF) { const [n, prices, d] = PERF[k as keyof PerfCfg]; CATS['perf.' + k] = { n, cam: 'front34', perf: true, items: prices.map((p, i) => ({ v: i, n: (k === 'turbo' && i === 0 ? 'None' : TIER[i]), p, stage: TIER_STAGE[i], d: i ? d : 'Factory part.' })) }; }

/* ---- dyno tuning sliders (-1..1) ---- */
export const TUNES: { k: keyof Tune; n: string; lo: string; hi: string; d: string }[] = [
  { k: 'turbo', n: 'Turbo', lo: 'Low end', hi: 'High end', d: 'Low end spools fast with less peak boost. High end waits, then hits harder.' },
  { k: 'nitrous', n: 'Nitrous', lo: 'Duration', hi: 'Power', d: 'Trade bottle time for a bigger hit.' },
  { k: 'aero', n: 'Aerodynamics', lo: 'Top speed', hi: 'Downforce', d: 'Downforce adds grip at speed and costs top end.' },
  { k: 'bias', n: 'Brake bias', lo: 'Rear', hi: 'Front', d: 'Rear bias rotates the car under braking. Front bias is stable.' },
  { k: 'ride', n: 'Ride height', lo: 'High', hi: 'Low', d: 'Lower center of gravity: less weight transfer, more grip.' },
  { k: 'stiff', n: 'Suspension', lo: 'Soft', hi: 'Stiff', d: 'Stiff turns in sharper. Soft is calmer when it slides.' },
  { k: 'steer', n: 'Steering', lo: 'Slow', hi: 'Quick', d: 'How much the wheels turn for a given input.' },
  { k: 'gears', n: 'Final drive', lo: 'Acceleration', hi: 'Top speed', d: 'Short gearing accelerates. Long gearing stretches each gear.' },
];
export const TUNE_DEF: Tune = { turbo: 0, nitrous: 0, aero: 0, bias: 0, ride: 0, stiff: 0, steer: 0, gears: 0 };

/* ---- career ---- */
export const STAGE_REP = [0, 400, 1100, 2200, 3800];
export const stageOf = (rep: number): number => { let s = 1; for (let i = 1; i < STAGE_REP.length; i++) if (rep >= STAGE_REP[i]) s = i + 1; return s; };
export const STOCK_CFG: CarCfg = { color: '#b9bec5', finish: 'gloss', rim: 'stock', rimSize: 17, rimColor: '#c9ced6', front: 0, rear: 0, skirts: 0, spoiler: 0, hood: 0, roof: 0, vinyl: 0, vinylColor: '#ffffff', tint: 0, neon: 'none', lights: '#fff1d6', hydraulics: 0, perf: { engine: 0, ecu: 0, turbo: 0, trans: 0, susp: 0, nos: 0, tires: 0, brakes: 0, weight: 0 } };

/* ---- events: routes come from the track library's data (apps/sim/public/strip/tracks/<id>.json, by event id) ---- */
export type EventType = 'sprint' | 'circuit' | 'streetx' | 'drag' | 'drift';
export type EventDef = { id: string; type: EventType; name: string; track: TrackId; loop?: boolean; laps?: number; prize: number; rep: number; stage: number; noTraffic?: true };
export const EVENTS: EventDef[] = [
  { id: 'harbour_gp', type: 'circuit', name: 'Harbour GP', track: 'monaco', loop: true, laps: 2, prize: 1500, rep: 150, stage: 1, noTraffic: true },
  { id: 'lagoons_sprint', type: 'sprint', name: 'Lagoons Sprint', track: 'interlagos', prize: 1400, rep: 140, stage: 1, noTraffic: true },
  { id: 'harbour_drift', type: 'drift', name: 'Harbour Drift', track: 'monaco', prize: 1500, rep: 150, stage: 1, noTraffic: true },
  { id: 'royal_drag', type: 'drag', name: 'Royal Park Quarter', track: 'monza', prize: 1800, rep: 150, stage: 1, noTraffic: true },
  { id: 'drylagoon_x', type: 'streetx', name: 'Dry Lagoon X', track: 'laguna', loop: true, laps: 2, prize: 1300, rep: 130, stage: 1, noTraffic: true },
  { id: 'royal_gp', type: 'circuit', name: 'Royal Park GP', track: 'monza', loop: true, laps: 2, prize: 2200, rep: 220, stage: 2, noTraffic: true },
  { id: 'lagoons_gp', type: 'circuit', name: 'Lagoons GP', track: 'interlagos', loop: true, laps: 3, prize: 2400, rep: 240, stage: 2, noTraffic: true },
  { id: 'airfield_sprint', type: 'sprint', name: 'Airfield Sprint', track: 'silverstone', prize: 2200, rep: 220, stage: 2, noTraffic: true },
  { id: 'figure8_drift', type: 'drift', name: 'Figure Eight Drift', track: 'suzuka', prize: 2400, rep: 220, stage: 2, noTraffic: true },
  { id: 'mountain_drag', type: 'drag', name: 'Mountain Half Mile', track: 'bathurst', prize: 2800, rep: 220, stage: 2, noTraffic: true },
  { id: 'figure8_gp', type: 'circuit', name: 'Figure Eight GP', track: 'suzuka', loop: true, laps: 2, prize: 3000, rep: 300, stage: 3, noTraffic: true },
  { id: 'eifel_gp', type: 'circuit', name: 'Eifel GP', track: 'nurburgring', loop: true, laps: 2, prize: 2800, rep: 280, stage: 3, noTraffic: true },
  { id: 'harbour_x', type: 'streetx', name: 'Harbour X', track: 'monaco', loop: true, laps: 3, prize: 2600, rep: 220, stage: 3, noTraffic: true },
  { id: 'mountain_sprint', type: 'sprint', name: 'Mountain Sprint', track: 'bathurst', prize: 3200, rep: 320, stage: 3, noTraffic: true },
  { id: 'lonestar_gp', type: 'circuit', name: 'Lone Star GP', track: 'cota', loop: true, laps: 2, prize: 3600, rep: 360, stage: 4, noTraffic: true },
  { id: 'airfield_gp', type: 'circuit', name: 'Airfield GP', track: 'silverstone', loop: true, laps: 2, prize: 3600, rep: 360, stage: 4, noTraffic: true },
  { id: 'mountain_drift', type: 'drift', name: 'Mountain Drift', track: 'bathurst', prize: 3400, rep: 300, stage: 4, noTraffic: true },
  { id: 'ardennes_gp', type: 'circuit', name: 'Ardennes GP', track: 'spa', loop: true, laps: 2, prize: 5000, rep: 500, stage: 5, noTraffic: true },
  { id: 'mountain_gp', type: 'circuit', name: 'Mountain GP', track: 'bathurst', loop: true, laps: 2, prize: 4500, rep: 450, stage: 5, noTraffic: true },
  { id: 'ardennes_sprint', type: 'sprint', name: 'Ardennes Sprint', track: 'spa', prize: 4200, rep: 420, stage: 5, noTraffic: true },
];
/** Park names per track, shown on the map and in the HUD. */
export const TRACK_NAMES: Record<TrackId, { en: string; es: string }> = {
  spa: { en: 'Ardennes', es: 'Ardenas' },
  monza: { en: 'Royal Park', es: 'Parque Real' },
  silverstone: { en: 'Airfield', es: 'Aeródromo' },
  suzuka: { en: 'Figure Eight', es: 'Ocho' },
  nurburgring: { en: 'Eifel', es: 'Eifel' },
  monaco: { en: 'Harbour', es: 'Puerto' },
  interlagos: { en: 'Lagoons', es: 'Lagunas' },
  cota: { en: 'Lone Star', es: 'Estrella Solitaria' },
  laguna: { en: 'Dry Lagoon', es: 'Laguna Seca' },
  bathurst: { en: 'The Mountain', es: 'La Montaña' },
};
export const EV_NAME: Record<EventType | 'outrun', string> = { sprint: 'Sprint', circuit: 'Circuit', streetx: 'Street X', drag: 'Drag', drift: 'Drift', outrun: 'Outrun' };
export const EV_COL: Record<EventType | 'outrun', string> = { sprint: '#ffd23f', circuit: '#5fbf86', streetx: '#f3f6fb', drag: '#e0b22a', drift: '#79a6ff', outrun: '#ffffff' };

/* ---- results: Night Tuner's payout table (06-events.js showResults) ---- */
export function prizeFor(ev: EventDef, pos: number, stage: number, style: number, failed: boolean): { cash: number; rep: number; styleBonus: number; octane: number } {
  const mult = 1 + .25 * (stage - 1); let cash = 0, rep = 0;
  if (!failed) { if (pos === 1) { cash = ev.prize * mult; rep = ev.rep; } else if (pos === 2) { cash = ev.prize * mult * .4; rep = ev.rep * .5; } else if (pos === 3) { cash = ev.prize * mult * .2; rep = ev.rep * .25; } }
  cash = Math.round(cash); rep = Math.round(rep);
  const styleBonus = pos === 1 ? Math.round(cash * .05 * style) : 0;
  return { cash, rep, styleBonus, octane: Math.round(25 * rep / 100) };
}

/* ---- strip record (replaces Night Tuner's save) ---- */
export type StripRecord = { rep: number; cars: Record<string, { cfg: CarCfg; tune: Tune; owned: string[] }>; wins: Record<string, number>; best: Record<string, number> };
export const freshStrip = (): StripRecord => ({ rep: 0, cars: {}, wins: {}, best: {} });
/** A copy of the record without wins and bests of events that are not in the library (old grid events). */
export function pruneStrip(rec: StripRecord): StripRecord {
  const ids = new Set(EVENTS.map(e => e.id));
  const keep = (m: Record<string, number>): Record<string, number> => Object.fromEntries(Object.entries(m).filter(([k]) => ids.has(k)));
  return { ...rec, wins: keep(rec.wins), best: keep(rec.best) };
}
export function carState(rec: StripRecord, carId: string): StripRecord['cars'][string] {
  return rec.cars[carId] ??= { cfg: clone(STOCK_CFG), tune: clone(TUNE_DEF), owned: [] };
}

export const getV = (cfg: CarCfg, k: string): PartValue => k.startsWith('perf.') ? cfg.perf[k.slice(5) as keyof PerfCfg] : cfg[k as keyof VisualCfg];
export const withV = (cfg: CarCfg, k: string, v: PartValue): CarCfg => {
  const n = clone(cfg);
  if (k.startsWith('perf.')) n.perf[k.slice(5) as keyof PerfCfg] = v as Tier; else (n as Record<string, unknown>)[k] = v;
  return n;
};
export const okey = (k: string, v: PartValue): string => k + '=' + v;
/** Free parts, the part currently fitted, and bought parts are owned. */
export const isOwned = (cfg: CarCfg, owned: string[], k: string, v: PartValue): boolean => {
  const it = CATS[k]?.items.find(i => i.v === v);
  return (!!it && !it.p) || getV(cfg, k) === v || owned.includes(okey(k, v));
};
export function visualRating(cfg: VisualCfg): number {
  let r = 0;
  for (const k in CATS) { const c = CATS[k]; if (c.perf) continue; const it = c.items.find(i => i.v === cfg[k as keyof VisualCfg]); if (it) r += it.r ?? 0; }
  return Math.min(10, Math.round(r * 10) / 10);
}

/* ---- specs from real cars ---- */
const isStyle = (s: string | undefined): s is BodyStyle => !!s && s in ARCHETYPES;

/** Per-body-style chassis: tire grip multiplier, and a taller centre of gravity for the tall bodies. */
export const STYLE_CHASSIS: Record<BodyStyle, { gripMul: number; h?: number }> = {
  sports: { gripMul: 1.06 }, coupe: { gripMul: 1.02 }, sedan: { gripMul: 1.0 }, hatchback: { gripMul: 1.0 },
  suv: { gripMul: .94, h: .58 }, van: { gripMul: .92, h: .60 }, truck: { gripMul: .90, h: .62 },
};

const stockStats = (s: VehicleSpec) => simStats(carParams(s, STOCK_CFG.perf, TUNE_DEF));

/** Fit an archetype to a real car: its mass and drive, then gearing to its top speed and torque to its 0-60. */
export function fitSpec(base: VehicleSpec, real: CarSpec): VehicleSpec {
  const out: VehicleSpec = { ...clone(base), mass: real.weightLb * 0.4536, drive: real.drive === '4WD' ? 'AWD' : real.drive };
  if (/Hybrid/.test(real.engine)) out.redline = 6000; else if (/V8/.test(real.engine)) out.redline = 6200; else if (/Turbo/.test(real.engine)) out.redline = 6500;
  const baseFin = out.fin, baseTq = clone(base.tq) as Torque;
  const topTarget = real.topSpeedMph * 1.609, t100Target = real.zeroToSixty + 0.3;
  const t100Of = (s: VehicleSpec) => stockStats(s).t100 ?? 1e9;
  // Start the torque at the real horsepower so the gearing fit sees a realistically powered car.
  let lo = 0.1, hi = 6;
  for (let i = 0; i < 12; i++) { const mid = (lo + hi) / 2; if (stockStats({ ...out, tq: scaleTq(baseTq, mid) }).hp < real.hp) lo = mid; else hi = mid; }
  out.tq = scaleTq(baseTq, (lo + hi) / 2);
  /** Smallest torque multiplier that reaches the 0-100 target; a launch is traction-limited past some torque, so a target below that plateau asks for the plateau, not for endless torque. */
  const fitTorque = (s: VehicleSpec): VehicleSpec => {
    const goal = Math.max(t100Target, t100Of({ ...s, tq: scaleTq(baseTq, 8) }) * 1.02);
    let l = 0.1, h = 8;
    for (let i = 0; i < 14; i++) { const mid = (l + h) / 2; if (t100Of({ ...s, tq: scaleTq(baseTq, mid) }) > goal) l = mid; else h = mid; }
    return { ...s, tq: scaleTq(baseTq, (l + h) / 2) };
  };
  // Gearing and torque interact (top speed needs power, launch needs gearing), so fit them twice.
  let fit = out;
  for (let round = 0; round < 2; round++) {
    lo = 0.6; hi = 1.6;
    for (let i = 0; i < 14; i++) { const mid = (lo + hi) / 2; if (stockStats({ ...fit, fin: baseFin * mid }).top < topTarget) hi = mid; else lo = mid; }
    fit = fitTorque({ ...fit, fin: baseFin * (lo + hi) / 2 });
  }
  return fit;
}

/** The body-style archetype (fitted to the real car's 0-60 and top speed when known), with the style's grip and ride height. Fleet cars keep their authored specs. */
export function specFor(car: { make?: string; model?: string; bodyStyle?: string; rental?: boolean }): VehicleSpec {
  const fleet = car.rental ? FLEET_NAMES[`${car.make} ${car.model}`] : undefined;
  if (fleet) return clone(FLEET_SPECS[fleet]);
  const style: BodyStyle = isStyle(car.bodyStyle) ? car.bodyStyle : 'sedan';
  const base = ARCHETYPES[style];
  const out = hasModelSpec(car) ? { ...fitSpec(base, getCarSpec(car, style)), name: `${car.make} ${car.model}` } : clone(base);
  const ch = STYLE_CHASSIS[style];
  out.gripMul = ch.gripMul;
  if (ch.h !== undefined) out.h = ch.h;
  return out;
}
