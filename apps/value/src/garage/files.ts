// The Garage's files: photographs, receipts and reports, kept in this browser's IndexedDB and nowhere else.
// The passport only ever holds a file's name, type, size and fingerprint; the file itself stays here, private to
// the device. If IndexedDB is missing or blocked (a private window, a sandboxed frame) files live in memory for the
// visit and the page says so. Nothing in this module can send a file anywhere.
import type { AttachmentKind } from '@micar/engine';

export const MAX_FILE_BYTES = 25 * 1024 * 1024;
const DB = 'micar-garage';
const STORE = 'files';

export type FileStore = {
  /** Where files are being kept. 'memory' means they will not survive a reload. */
  kind: 'indexeddb' | 'memory';
  put(id: string, blob: Blob): Promise<void>;
  get(id: string): Promise<Blob | null>;
  remove(id: string): Promise<void>;
  /** Removes many files in one go. An id with no file is passed over. */
  removeAll(ids: readonly string[]): Promise<void>;
};

export function memoryFileStore(): FileStore {
  const files = new Map<string, Blob>();
  return {
    kind: 'memory',
    put: async (id, blob) => { files.set(id, blob); },
    get: async (id) => files.get(id) ?? null,
    remove: async (id) => { files.delete(id); },
    removeAll: async (ids) => { for (const id of ids) files.delete(id); },
  };
}

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB request failed'));
  });
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open(DB, 1);
    open.onupgradeneeded = () => { if (!open.result.objectStoreNames.contains(STORE)) open.result.createObjectStore(STORE); };
    open.onsuccess = () => resolve(open.result);
    open.onerror = () => reject(open.error ?? new Error('IndexedDB could not be opened'));
    open.onblocked = () => reject(new Error('IndexedDB is blocked'));
  });
}

/** Opens the device's file store, or a memory one when the browser will not keep files. Never throws. */
export async function openFileStore(): Promise<FileStore> {
  try {
    if (typeof indexedDB === 'undefined') return memoryFileStore();
    const db = await openDb();
    // Named objects, not after the translator's helpers: the Spanish coverage test reads calls to those as text to translate.
    const objects = (mode: IDBTransactionMode) => db.transaction(STORE, mode).objectStore(STORE);
    return {
      kind: 'indexeddb',
      put: async (id, blob) => { await request(objects('readwrite').put(blob, id)); },
      get: async (id) => {
        const found: unknown = await request(objects('readonly').get(id));
        return found instanceof Blob ? found : null;
      },
      remove: async (id) => { await request(objects('readwrite').delete(id)); },
      // One transaction for the lot: a passport can name a hundred thousand files, and a transaction each would take minutes.
      removeAll: (ids) => new Promise<void>((resolve, reject) => {
        if (ids.length === 0) { resolve(); return; }
        const work = db.transaction(STORE, 'readwrite');
        const store = work.objectStore(STORE);
        for (const id of ids) store.delete(id);
        work.oncomplete = () => resolve();
        work.onerror = () => reject(work.error ?? new Error('IndexedDB transaction failed'));
        work.onabort = () => reject(work.error ?? new Error('IndexedDB transaction was aborted'));
      }),
    };
  } catch {
    return memoryFileStore();
  }
}

export type FileRefusal = 'too-large' | 'not-an-image-or-pdf' | 'empty';

/** Images and PDFs up to 25 MB. Anything else is refused before it is stored. */
export function checkFile(file: { size: number; type: string }): FileRefusal | null {
  if (file.size <= 0) return 'empty';
  if (file.size > MAX_FILE_BYTES) return 'too-large';
  if (!/^image\/(jpeg|png|webp|gif|heic|heif|avif)$/.test(file.type) && file.type !== 'application/pdf') return 'not-an-image-or-pdf';
  return null;
}

/** What a file is, as far as its type and the entry it is attached to can say. */
export function attachmentKind(mime: string, entry: 'photo' | 'maintenance' | 'repair' | 'inspection' | 'title' | 'registration' | 'dyno' | 'other'): AttachmentKind {
  if (entry === 'photo') return 'photo';
  if (entry === 'maintenance') return 'receipt';
  if (entry === 'repair') return 'invoice';
  if (entry === 'inspection') return 'report';
  if (entry === 'title' || entry === 'registration' || entry === 'dyno') return entry;
  return mime.startsWith('image/') ? 'photo' : 'other';
}

/** The file's SHA-256 as 64 hex characters, or null where the browser offers no Web Crypto (plain http, old browsers). */
export async function sha256Hex(blob: Blob): Promise<string | null> {
  try {
    const digest = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
    return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('');
  } catch {
    return null;
  }
}
