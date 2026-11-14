import { describe, expect, it } from 'vitest';
import { LIMITS, isLocalBase, parseSteps, percentile, verdict, type StepResult } from './loadStats';

const good: StepResult = { size: 16, rooms: 1, posesExpected: 1000, posesReceived: 995, delayMs: { p50: 3, p95: 12, p99: 30 }, baselineRttMs: 2,
  server: { cpuPercent: 20, loopDelayP99Ms: 8, rssMb: 160 }, harnessLoopP99Ms: 5 };

describe('load test arithmetic', () => {
  it('reads steps, and refuses anything else', () => {
    expect(parseSteps('4x1, 16x2')).toEqual([{ size: 4, rooms: 1 }, { size: 16, rooms: 2 }]);
    for (const bad of ['', '4x0', '1x4', '17x1', '4x21', '4*1', '4x1,,8x1', 'x']) expect(parseSteps(bad)).toBeNull();
  });
  it('takes percentiles by nearest rank', () => {
    expect(percentile([5, 1, 3, 2, 4], 50)).toBe(3);
    expect(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 95)).toBe(10);
    expect(percentile([], 50)).toBeNull();
  });
  it('knows a server on this PC from the live one', () => {
    expect(['http://localhost:3123/', 'http://127.0.0.1:5000', 'http://[::1]:80/'].every(isLocalBase)).toBe(true);
    expect(['https://micar-sim.onrender.com/', 'http://localhost.example.com/', 'not a url'].some(isLocalBase)).toBe(false);
  });
  it('passes a step within every limit, and says whether it fits the $7 instance', () => {
    expect(verdict(good, 'local')).toEqual({ pass: true, fits7: true, reasons: [] });
    expect(verdict({ ...good, server: { ...good.server!, cpuPercent: 30 } }, 'local')).toMatchObject({ pass: true, fits7: false });
    expect(verdict({ ...good, server: { ...good.server!, cpuPercent: 40 } }, 'remote')).toMatchObject({ pass: false, fits7: false });
  });
  it('fails a step for each broken limit, and never judges the server when this computer was the bottleneck', () => {
    expect(verdict({ ...good, posesReceived: 980 }, 'local').pass).toBe(false);
    expect(verdict({ ...good, delayMs: { ...good.delayMs, p95: 2 + LIMITS.addedDelayP95Ms + 1 } }, 'local').pass).toBe(false);
    expect(verdict({ ...good, server: { ...good.server!, loopDelayP99Ms: 51 } }, 'local').pass).toBe(false);
    expect(verdict({ ...good, server: null }, 'local')).toMatchObject({ pass: false, fits7: null });
    const busy = verdict({ ...good, harnessLoopP99Ms: 26 }, 'local');
    expect(busy).toMatchObject({ pass: false, fits7: null });
    expect(busy.reasons).toHaveLength(1);
  });
  it('never passes a step in which no position was sent', () => {
    expect(verdict({ ...good, posesExpected: 0, posesReceived: 0 }, 'local').pass).toBe(false);
  });
});
