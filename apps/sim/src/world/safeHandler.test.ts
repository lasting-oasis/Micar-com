import { describe, it, expect, vi } from 'vitest';
import { guarded, handlerErrorLog } from './safeHandler';

describe('guarded', () => {
  it('calls the handler with the same arguments and returns nothing', () => {
    const h = vi.fn(() => 42), report = vi.fn();
    expect(guarded('e', h, report)(1, 'two', { three: 3 })).toBeUndefined();
    expect(h).toHaveBeenCalledWith(1, 'two', { three: 3 }); expect(report).not.toHaveBeenCalled();
  });
  it('a throwing handler is reported once with the event and the error, and does not throw', () => {
    const err = new Error('boom'), report = vi.fn();
    expect(() => guarded('rent_car', () => { throw err; }, report)(null)).not.toThrow();
    expect(report).toHaveBeenCalledTimes(1); expect(report).toHaveBeenCalledWith('rent_car', err);
  });
  it('a handler whose promise rejects is reported once', async () => {
    const err = new Error('late'), report = vi.fn();
    expect(guarded('e', () => Promise.reject(err), report)()).toBeUndefined();
    await new Promise(r => setTimeout(r, 0));
    expect(report).toHaveBeenCalledTimes(1); expect(report).toHaveBeenCalledWith('e', err);
  });
  it('a handler that works is never reported', async () => {
    const report = vi.fn(); guarded('e', () => undefined, report)(); guarded('e', async () => 1, report)();
    await new Promise(r => setTimeout(r, 0)); expect(report).not.toHaveBeenCalled();
  });
  it('a report that throws does not escape, for a sync throw', () => {
    const report = vi.fn(() => { throw new Error('report broke'); });
    expect(() => guarded('e', () => { throw new Error('boom'); }, report)()).not.toThrow();
    expect(report).toHaveBeenCalledTimes(1);
  });
  it('a report that throws does not escape, for a rejected promise', async () => {
    const seen: unknown[] = [], onUnhandled = (e: unknown) => { seen.push(e); };
    process.on('unhandledRejection', onUnhandled);
    try {
      const report = vi.fn(() => { throw new Error('report broke'); });
      expect(guarded('e', () => Promise.reject(new Error('late')), report)()).toBeUndefined();
      await new Promise(r => setTimeout(r, 10));
      expect(report).toHaveBeenCalledTimes(1); expect(seen).toEqual([]);
    } finally { process.off('unhandledRejection', onUnhandled); }
  });
  it('a handler that throws a value with no prototype reaches report once and nothing escapes', () => {
    const odd = Object.create(null), report = vi.fn((_ev: string, e: unknown) => { handlerErrorLog(_ev, e); });
    expect(() => guarded('e', () => { throw odd; }, report)()).not.toThrow();
    expect(report).toHaveBeenCalledTimes(1); expect(report).toHaveBeenCalledWith('e', odd);
  });
  it('the log line says what failed and where, never the payload', () => {
    expect(handlerErrorLog('e', Object.create(null))).toEqual({ event: 'e', error: '(not an Error)' });
    expect(handlerErrorLog('e', 'plain')).toEqual({ event: 'e', error: 'plain' });
    const err = new Error('boom'); err.stack = 'Error: boom\n    at bayOrder (/app/server.ts:1400:7)\n    at next (x.js:1:1)';
    expect(handlerErrorLog('bay_order', err)).toEqual({ event: 'bay_order', error: 'boom', at: 'at bayOrder (/app/server.ts:1400:7)' });
    const bare = new Error('no stack'); bare.stack = undefined;
    expect(handlerErrorLog('e', bare)).toEqual({ event: 'e', error: 'no stack' });
  });
});
