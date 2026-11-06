// The save file: written atomically (a temp file, then a rename), one write at a time, and never overwritten when it
// fails to parse on boot (it is set aside as gameState.json.corrupt-<timestamp> instead). fs is injected for tests.
import path from 'node:path';

export type SaveFs = {
  mkdir(dir: string, opts: { recursive: true }): Promise<unknown>;
  writeFile(file: string, data: string, enc: 'utf8'): Promise<void>;
  rename(from: string, to: string): Promise<void>;
  readFile(file: string, enc: 'utf8'): Promise<string>;
};

/** Writes `data` to `file` so a reader sees the old file or the new one, never half of one. */
export async function writeAtomic(fs: SaveFs, file: string, data: string): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tmp = file + '.tmp';
  await fs.writeFile(tmp, data, 'utf8');
  await fs.rename(tmp, file);
}

export type LoadResult =
  | { kind: 'missing' }
  | { kind: 'loaded'; data: Record<string, unknown> }
  | { kind: 'quarantined'; to: string | null };

/** Reads the save. A missing file is a fresh start; one that cannot be read or parsed is renamed aside (never overwritten
 *  by the next save) and the server starts fresh. `to` is null when even the rename failed. */
export async function loadOrQuarantine(fs: SaveFs, file: string, now: number): Promise<LoadResult> {
  let text: string;
  try {
    text = await fs.readFile(file, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException)?.code === 'ENOENT') return { kind: 'missing' };
    return quarantine(fs, file, now);
  }
  try {
    const data = JSON.parse(text);
    if (data && typeof data === 'object' && !Array.isArray(data)) return { kind: 'loaded', data };
  } catch { /* falls through */ }
  return quarantine(fs, file, now);
}

async function quarantine(fs: SaveFs, file: string, now: number): Promise<LoadResult> {
  const to = `${file}.corrupt-${now}`;
  try { await fs.rename(file, to); return { kind: 'quarantined', to }; } catch { return { kind: 'quarantined', to: null }; }
}

/** One write in flight at a time: a save asked for while one is running marks the state dirty, and exactly one more
 *  write follows it (with the state as it is then). Every returned promise settles once a write that started after it
 *  was asked for has finished. */
export function coalescingSaver(write: () => Promise<void>): { save: () => Promise<void>; idle: () => boolean } {
  let inFlight: Promise<void> | null = null;
  let dirty = false;
  let waiters: Array<() => void> = [];
  const run = (): Promise<void> => {
    const mine = waiters; waiters = [];
    inFlight = write().catch(() => { /* the writer logs its own failures */ }).then(() => {
      inFlight = null;
      for (const w of mine) w();
      if (dirty) { dirty = false; void run(); }
    });
    return inFlight;
  };
  return {
    save: () => new Promise<void>(resolve => {
      waiters.push(resolve);
      if (inFlight) { dirty = true; return; }
      void run();
    }),
    idle: () => !inFlight && !dirty,
  };
}
