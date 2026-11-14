import { describe, expect, it } from 'vitest';
import { healthReport, loadFrom, startLoadSampler } from './health';

const load = { cpuPercent: 12.5, loopDelayP99Ms: 3.2, rssMb: 140 };
const base = { bootedAt: 1_000_000, now: 1_090_000, saveAtBoot: 'loaded' as const, savedAt: 1_060_000, accounts: 3, players: 2, caps: { google: false, magic: true }, load };

describe('healthReport', () => {
  it('reports exactly these nine things and nothing else', () => {
    expect(healthReport(base)).toEqual({ ok: true, bootId: (1_000_000).toString(36), upSeconds: 90, saveAtBoot: 'loaded', savedSecondsAgo: 30, accounts: 3, players: 2, signIn: { google: false, magic: true }, load });
  });
  it('a fresh disk has no save yet', () => {
    const r = healthReport({ ...base, saveAtBoot: 'missing', savedAt: null });
    expect(r.saveAtBoot).toBe('missing');
    expect(r.savedSecondsAgo).toBeNull();
  });
  it('a clock that runs backwards never reports negative time', () => {
    const r = healthReport({ ...base, now: 900_000 });
    expect(r.upSeconds).toBe(0);
    expect(r.savedSecondsAgo).toBe(0);
  });
  it('works out load as a share of one core', () => {
    expect(loadFrom(500_000, 10_000, 4_250_000, 150 * 1048576)).toEqual({ cpuPercent: 5, loopDelayP99Ms: 4.3, rssMb: 150 });
    expect(loadFrom(0, 0, 0, 0)).toEqual({ cpuPercent: 0, loopDelayP99Ms: 0, rssMb: 0 });
  });
  it('the sampler gives real figures once a window has passed', async () => {
    const read = startLoadSampler(100);
    await new Promise((r) => setTimeout(r, 250));
    const l = read();
    for (const v of Object.values(l)) expect(Number.isFinite(v) && v >= 0).toBe(true);
    expect(l.rssMb).toBeGreaterThan(0);
  });
});
