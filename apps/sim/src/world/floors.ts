// The server's floor under a Strip finish (rubric F3): the least time an event can honestly take, so that a finish
// faster than it is refused as impossible. Each event's floor is the fastest legal build's run on it, less a stated
// margin: every car a player can drive, every performance part at its top tier, the Garage's sliders at the settings
// that make it quickest, on the physics core and on the old model (still the default, and the server cannot tell
// which a run was driven on). The runs are worked out by scripts/build-floors.ts (src/world/core/floorRuns.ts says
// what each run is) into floors.json, which the server only reads: working them out takes minutes.
import table from './floors.json';
import type { EventDef, EventType } from './data';

/**
 * What the floor keeps under the fastest legal run, as a share of it: 10%. The runs already give every car its nitrous
 * all the way, the widest line inside the walls and both axles of the old model at their friction at once; the margin
 * is for what no run holds: a launch or shift point better than the bench's, a line through a gap in the walls, a
 * slow frame's step, and a physics change made since the table was last worked out (floors.test.ts fails at 3%).
 */
export const FLOOR_MARGIN = 0.1;

/** The fixed average speeds the server held events to before (m/s): still the floor of an event the table has no run for (an outrun, a new event before the table is worked out again). */
export const VMAX: Readonly<Record<EventType, number>> = { drag: 50, sprint: 65, circuit: 65, streetx: 65, drift: 65 };

type Row = { fastest: number; model: string; car: string; tune: Record<string, number>; floor: number };
const ROWS = (table as { events: Record<string, Row> }).events;

/** The fastest legal run on an event and who set it (seconds; 'core' or 'classic'; the car; its sliders), or null when the table has none. */
export function fastestRun(eventId: string): Readonly<Row> | null {
  return Object.prototype.hasOwnProperty.call(ROWS, eventId) ? ROWS[eventId] : null;
}

/** The floor of an event, seconds from the green light: its fastest legal run less FLOOR_MARGIN; `fallback` (distance over the old VMAX) when the table has no run for it. */
export function floorFor(ev: EventDef, fallback: () => number): number {
  const row = fastestRun(ev.id);
  return row !== null && row.floor > 0 ? row.floor : fallback();
}
