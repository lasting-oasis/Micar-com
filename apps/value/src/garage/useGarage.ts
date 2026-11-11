// The Garage's state in React: loaded once from this browser, saved on every change, with the device's file store
// beside it. The screens call the actions in store.ts and hand the result to apply().
import { useEffect, useMemo, useRef, useState } from 'react';
import { memoryFileStore, openFileStore, type FileStore } from './files';
import { newOwnerId } from './ids';
import { GARAGE_KEY, keepGarage, loadGarage, saveGarage, type GarageState, type GarageStorage } from './store';

function browserStorage(): GarageStorage | null {
  try { return window.localStorage; } catch { return null; }
}

export type GarageHandle = {
  /** The garage as this render sees it. */
  state: GarageState;
  /** The garage as it is right now. An action that finishes after an await (a file being stored) builds on this, not on a render's copy. */
  latest: () => GarageState;
  /** Saved cars that could not be read when the page opened. */
  skipped: number;
  /** False when this browser is not keeping the garage. True until that is known, so the warning never flashes. */
  persisted: boolean;
  /**
   * Makes a change, and returns false when it was not made. A browser that has been keeping the garage and has no
   * room for the change is left exactly as it was: what the page shows is always what is saved, and the cars already
   * here go on being saved. A browser that is not keeping the garage at all takes the change in memory, and the page
   * says so (`persisted`). The caller says what happened beside the control that was pressed.
   */
  apply: (next: GarageState) => boolean;
  files: FileStore;
};

export function useGarage(): GarageHandle {
  const loaded = useMemo(() => loadGarage(browserStorage(), newOwnerId), []);
  const [state, setState] = useState(loaded.state);
  const [persisted, setPersisted] = useState(loaded.persisted);
  const [files, setFiles] = useState<FileStore>(() => memoryFileStore());
  const [filesKnown, setFilesKnown] = useState(false);
  const first = useRef(true);
  const now = useRef(loaded.state);
  // Whether the last save was kept, as it is right now: an action that finishes after an await reads this, not a render's copy.
  const kept = useRef(loaded.persisted);

  // Keep the new garage's id from the first visit on, and open the device's file store.
  useEffect(() => {
    if (first.current) { first.current = false; kept.current = saveGarage(browserStorage(), loaded.state); setPersisted(kept.current); }
    let on = true;
    openFileStore().then((store) => { if (on) setFiles(store); }).catch(() => { /* the memory store stays */ }).then(() => { if (on) setFilesKnown(true); });
    return () => { on = false; };
  }, [loaded]);

  // Another tab of this site saved the garage: take up what it wrote, so two tabs never overwrite each other's cars.
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key !== GARAGE_KEY || e.newValue === null) return;
      const again = loadGarage(browserStorage(), () => now.current.ownerId);
      if (again.skipped > 0) return;
      now.current = again.state;
      setState(again.state);
    };
    try { window.addEventListener('storage', onStorage); } catch { return undefined; }
    return () => { try { window.removeEventListener('storage', onStorage); } catch { /* no window */ } };
  }, []);

  const apply = (next: GarageState): boolean => {
    const how = keepGarage(browserStorage(), next, kept.current);
    if (how === 'refused') return false;
    now.current = next; setState(next);
    kept.current = how === 'saved'; setPersisted(kept.current);
    return true;
  };
  return { state, latest: () => now.current, skipped: loaded.skipped, persisted: persisted && (!filesKnown || files.kind === 'indexeddb'), apply, files };
}

/** An object URL for a stored file, made when asked for and released when no longer shown. Null until it is ready or when the file is gone. */
export function useFileUrl(files: FileStore, id: string | null): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!id) { setUrl(null); return; }
    let on = true, made: string | null = null;
    files.get(id).then((blob) => {
      if (!on || !blob) return;
      made = URL.createObjectURL(blob);
      setUrl(made);
    }).catch(() => { /* the card falls back to the category picture */ });
    return () => { on = false; if (made) URL.revokeObjectURL(made); setUrl(null); };
  }, [files, id]);
  return url;
}
