// The Garage's bench runs off the page's thread (garageBench.ts): a car and build in, its core figures out. Two bench
// runs take a second or two; here they never hold up a frame.
import { computeGarage, type GarageCar } from './garageBench';
import type { PerfCfg, Tune } from '../physics';

type Ask = { id: number; car: GarageCar; perf: PerfCfg; tune: Tune };
const scope = self as unknown as { onmessage: ((e: MessageEvent<Ask>) => void) | null; postMessage(message: unknown): void };

scope.onmessage = (e) => {
  const { id, car, perf, tune } = e.data;
  scope.postMessage({ id, garage: computeGarage(car, perf, tune) });
};
