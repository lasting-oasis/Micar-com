import { describe, it, expect } from 'vitest';
import { carParams, simStats } from './world/physics';
import { FLEET_SPECS, STOCK_CFG, TUNE_DEF } from './world/data';
import { getCarSpec } from './carSpecs';

const PAIRS: [keyof typeof FLEET_SPECS, string, string][] = [['civet', 'Civet', 'R'], ['kanjo', 'Kanjo', 'S'], ['ronin', 'Ronin', 'GT'], ['tsubasa', 'Tsubasa', 'R4'], ['brute', 'Brute', '440']];

describe('fleet car panel specs', () => {
  for (const [k, make, model] of PAIRS) it(`${make} ${model} panel matches its physics`, () => {
    const c = getCarSpec({ make, model }); const st = simStats(carParams(FLEET_SPECS[k], STOCK_CFG.perf, TUNE_DEF)); const t100 = st.t100 ?? 99;
    expect(Math.abs(c.hp - st.hp) / st.hp).toBeLessThanOrEqual(0.1);
    expect(Math.abs(c.zeroToSixty - (t100 - 0.3)) / (t100 - 0.3)).toBeLessThanOrEqual(0.1);
  });
});
