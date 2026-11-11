import { describe, it, expect, vi } from 'vitest';
import { guarded } from './safeHandler';

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
});
