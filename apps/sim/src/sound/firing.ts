// From engine facts to a firing table: when each cylinder fires in the 720 degree cycle and which
// bank's pipe gets its pulse. The famous engine sounds are decided here and in the exhaust layout.
import type { EngineFacts } from './facts';

export type FiringEvent = { angle: number; bank: number };

// The cross-plane V8 bank sequence of GM's LS order (1-8-7-2-6-5-4-3). Every valid cross-plane
// order gives each bank the same 90-180-180-270 spacing, so one stands for all.
const CROSS_V8 = [0, 1, 0, 1, 1, 0, 1, 0];

function usualBanks(e: EngineFacts): number[] {
  const n = e.cylinders;
  if (e.layout === 'inline') return new Array<number>(n).fill(0);
  if (e.layout === 'flat' && n === 4) return [0, 0, 1, 1];
  if (e.layout === 'v' && n === 8 && e.crank !== 'flat') return CROSS_V8;
  return Array.from({ length: n }, (_, i) => i % 2);
}

/** One event per cylinder, evenly spaced through 720 degrees, in firing sequence. */
export function firingTable(e: EngineFacts): FiringEvent[] {
  const n = e.cylinders, step = 720 / n;
  const banks = e.firingOrder && e.bankOf && e.layout !== 'inline'
    ? e.firingOrder.map(c => e.bankOf![c - 1] ?? 0)
    : usualBanks(e);
  return banks.map((bank, i) => ({ angle: i * step, bank }));
}

/** The gaps, in crank degrees, between one bank's successive pulses. */
export function bankIntervals(t: FiringEvent[], bank: number): number[] {
  const a = t.filter(e => e.bank === bank).map(e => e.angle);
  return a.map((x, i) => (a[(i + 1) % a.length] - x + 720) % 720 || 720);
}

/** Null when the facts agree with each other; otherwise what is wrong. Catches web firing orders that the stated crank cannot fire. */
export function checkFiring(e: EngineFacts): string | null {
  if (e.firingOrder) {
    const seen = new Set(e.firingOrder);
    if (e.firingOrder.length !== e.cylinders || seen.size !== e.cylinders || e.firingOrder.some(c => c < 1 || c > e.cylinders)) return 'the firing order must name every cylinder once';
  }
  if (e.layout === 'v' && e.cylinders === 8 && e.crank) {
    const gaps = bankIntervals(firingTable(e), 0).sort((a, b) => a - b).join('-');
    if (e.crank === 'cross' && gaps !== '90-180-180-270') return `a cross-plane crank cannot fire this order: one bank gets ${gaps}`;
    if (e.crank === 'flat' && gaps !== '180-180-180-180') return `a flat-plane crank cannot fire this order: one bank gets ${gaps}`;
  }
  return null;
}
