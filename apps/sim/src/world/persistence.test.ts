import { describe, it, expect } from 'vitest';
import { coalescingSaver, loadOrQuarantine, writeAtomic, type SaveFs } from './persistence';

/** An in-memory fs that records every call. */
function memFs(files: Record<string, string> = {}, opts: { failRead?: string } = {}) {
  const calls: string[] = [];
  const fs: SaveFs = {
    mkdir: async (d) => { calls.push(`mkdir ${d}`); },
    writeFile: async (f, d) => { calls.push(`write ${f}`); files[f] = d; },
    rename: async (a, b) => {
      calls.push(`rename ${a} ${b}`);
      if (!(a in files)) throw Object.assign(new Error('nope'), { code: 'ENOENT' });
      files[b] = files[a]; delete files[a];
    },
    readFile: async (f) => {
      if (opts.failRead) throw Object.assign(new Error('io'), { code: opts.failRead });
      if (!(f in files)) throw Object.assign(new Error('missing'), { code: 'ENOENT' });
      return files[f];
    },
  };
  return { fs, files, calls };
}

describe('persistence', () => {
  it('writes to a .tmp file and renames it over the save', async () => {
    const m = memFs({ '/d/gameState.json': 'old' });
    await writeAtomic(m.fs, '/d/gameState.json', '{"a":1}');
    expect(m.calls).toEqual(['mkdir /d', 'write /d/gameState.json.tmp', 'rename /d/gameState.json.tmp /d/gameState.json']);
    expect(m.files).toEqual({ '/d/gameState.json': '{"a":1}' });
  });
  it('a missing save is a fresh start; a good one loads', async () => {
    expect(await loadOrQuarantine(memFs().fs, '/d/g.json', 1)).toEqual({ kind: 'missing' });
    expect(await loadOrQuarantine(memFs({ '/d/g.json': '{"day":3}' }).fs, '/d/g.json', 1)).toEqual({ kind: 'loaded', data: { day: 3 } });
  });
  it('a save that does not parse (or is not an object) is set aside, never overwritten', async () => {
    for (const bad of ['{"day":', 'null', '[1]', '7']) {
      const m = memFs({ '/d/g.json': bad });
      expect(await loadOrQuarantine(m.fs, '/d/g.json', 42)).toEqual({ kind: 'quarantined', to: '/d/g.json.corrupt-42' });
      expect(m.files).toEqual({ '/d/g.json.corrupt-42': bad });
    }
  });
  it('a save that cannot be read (not missing) is set aside too', async () => {
    const m = memFs({ '/d/g.json': '{}' }, { failRead: 'EIO' });
    expect(await loadOrQuarantine(m.fs, '/d/g.json', 5)).toEqual({ kind: 'quarantined', to: '/d/g.json.corrupt-5' });
  });
  it('one write at a time: saves asked for during a write coalesce into exactly one more', async () => {
    let writes = 0, running = 0, maxRunning = 0;
    const gates: Array<() => void> = [];
    const saver = coalescingSaver(() => new Promise<void>(res => { writes++; running++; maxRunning = Math.max(maxRunning, running); gates.push(() => { running--; res(); }); }));
    const a = saver.save();
    const b = saver.save(), c = saver.save(), d = saver.save();
    expect(writes).toBe(1);
    let aDone = false, bDone = false;
    void a.then(() => { aDone = true; }); void b.then(() => { bDone = true; });
    gates.shift()!(); await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    expect(aDone).toBe(true); expect(bDone).toBe(false); expect(writes).toBe(2);
    gates.shift()!(); await Promise.all([b, c, d]);
    expect(writes).toBe(2); expect(maxRunning).toBe(1); expect(saver.idle()).toBe(true);
  });
  it('a failed write still frees the saver', async () => {
    let n = 0;
    const saver = coalescingSaver(async () => { n++; if (n === 1) throw new Error('disk'); });
    await saver.save(); await saver.save();
    expect(n).toBe(2);
  });
});
