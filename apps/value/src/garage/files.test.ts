import { describe, expect, it } from 'vitest';
import { MAX_FILE_BYTES, attachmentKind, checkFile, memoryFileStore, openFileStore, sha256Hex } from './files';

describe('the file store', () => {
  it('falls back to memory where the browser keeps no files (this test runs with no IndexedDB)', async () => {
    const store = await openFileStore();
    expect(store.kind).toBe('memory');
  });

  it('keeps, returns and removes a file by id', async () => {
    const store = memoryFileStore();
    const blob = new Blob(['receipt'], { type: 'application/pdf' });
    await store.put('A1', blob);
    expect(await store.get('A1')).toBe(blob);
    expect(await store.get('missing')).toBeNull();
    await store.remove('A1');
    expect(await store.get('A1')).toBeNull();
  });

  it('removes many at once, and passes over an id with no file', async () => {
    const store = memoryFileStore();
    for (const fileId of ['A', 'B', 'C']) await store.put(fileId, new Blob([fileId]));
    await store.removeAll(['A', 'missing', 'C']);
    expect([await store.get('A'), await store.get('C')]).toEqual([null, null]);
    expect(await store.get('B')).not.toBeNull();
    await store.removeAll([]);
    expect(await store.get('B')).not.toBeNull();
  });
});

describe('checkFile', () => {
  it('takes images and PDFs up to 25 MB', () => {
    expect(checkFile({ size: 1200, type: 'image/jpeg' })).toBeNull();
    expect(checkFile({ size: MAX_FILE_BYTES, type: 'application/pdf' })).toBeNull();
    expect(checkFile({ size: 5000, type: 'image/heic' })).toBeNull();
  });

  it('refuses anything else, with the reason', () => {
    expect(checkFile({ size: MAX_FILE_BYTES + 1, type: 'image/png' })).toBe('too-large');
    expect(checkFile({ size: 0, type: 'image/png' })).toBe('empty');
    expect(checkFile({ size: 10, type: 'text/html' })).toBe('not-an-image-or-pdf');
    expect(checkFile({ size: 10, type: 'image/svg+xml' })).toBe('not-an-image-or-pdf');
    expect(checkFile({ size: 10, type: '' })).toBe('not-an-image-or-pdf');
  });
});

describe('attachmentKind', () => {
  it('names a file by the entry it is attached to', () => {
    expect(attachmentKind('image/jpeg', 'photo')).toBe('photo');
    expect(attachmentKind('application/pdf', 'maintenance')).toBe('receipt');
    expect(attachmentKind('image/jpeg', 'repair')).toBe('invoice');
    expect(attachmentKind('application/pdf', 'inspection')).toBe('report');
    expect(attachmentKind('application/pdf', 'title')).toBe('title');
    expect(attachmentKind('image/png', 'other')).toBe('photo');
    expect(attachmentKind('application/pdf', 'other')).toBe('other');
  });
});

describe('sha256Hex', () => {
  it('fingerprints a file the same way every time', async () => {
    const a = await sha256Hex(new Blob(['abc']));
    expect(a).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    expect(await sha256Hex(new Blob(['abc']))).toBe(a);
  });
});
