import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { FOIL_IDS } from './foils';

// The files the card back ships with, as they sit in the repository: present, the size they claim to be, and inside
// the budgets the design set (docs/superpowers/specs/2026-11-11-holo-card-back-design.md). And the one file that
// must never change: the owner's artwork.

const read = (path: string): Uint8Array => readFileSync(new URL(`../../../${path}`, import.meta.url));
const shipped = (name: string): Uint8Array => read(`apps/value/public/cards/${name}`);
const text = (bytes: Uint8Array, at: number, length: number): string => String.fromCharCode(...bytes.subarray(at, at + length));

/** Width and height of a WebP, from its header. Says whether it carries transparency. */
function webp(bytes: Uint8Array): { width: number; height: number; alpha: boolean } {
  expect(text(bytes, 0, 4) + text(bytes, 8, 4)).toBe('RIFFWEBP');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const kind = text(bytes, 12, 4);
  if (kind === 'VP8X') {
    const u24 = (at: number): number => bytes[at] | (bytes[at + 1] << 8) | (bytes[at + 2] << 16);
    return { width: u24(24) + 1, height: u24(27) + 1, alpha: (bytes[20] & 0x10) !== 0 };
  }
  if (kind === 'VP8 ') return { width: view.getUint16(26, true) & 0x3fff, height: view.getUint16(28, true) & 0x3fff, alpha: false };
  throw new Error(`a WebP of a kind this test does not read: ${kind}`);
}

/** Width and height of an AVIF, from its image-size box. */
function avif(bytes: Uint8Array): { width: number; height: number } {
  expect(text(bytes, 4, 8)).toBe('ftypavif');
  for (let at = 0; at < Math.min(bytes.length, 4096) - 16; at++) {
    if (text(bytes, at, 4) === 'ispe') {
      const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      return { width: view.getUint32(at + 8), height: view.getUint32(at + 12) };
    }
  }
  throw new Error('no image-size box in the first 4 KB');
}

describe('the master artwork', () => {
  it('is the file the owner supplied, byte for byte', async () => {
    const master = read('assets/cards/micar-card-back.png');
    const copy = new Uint8Array(master.byteLength);
    copy.set(master);
    const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', copy));
    const hex = Array.from(digest, (byte) => byte.toString(16).padStart(2, '0')).join('');
    expect(hex).toBe('5bd441b57e7becbb812469ae4f61eebbea991c59ad955293dee80ce1852c3c95');
    expect(master.byteLength).toBe(4_107_275);
  });
});

describe('what the site ships for the card back', () => {
  it('the model, inside 100 KB', () => {
    const glb = shipped('card.glb');
    expect(text(glb, 0, 4)).toBe('glTF');
    expect(glb.byteLength).toBeLessThanOrEqual(100_000);
  });

  it('the artwork twice, each the master\'s size in pixels and inside 900 KB', () => {
    const first = shipped('back.avif'), second = shipped('back.webp');
    expect(avif(first)).toEqual({ width: 1062, height: 1481 });
    expect(webp(second)).toEqual({ width: 1062, height: 1481, alpha: false });
    expect(first.byteLength).toBeLessThanOrEqual(900_000);
    expect(second.byteLength).toBeLessThanOrEqual(900_000);
  });

  it('a still for every foil: 720 by 960, see-through around the card, inside 150 KB', () => {
    for (const foil of FOIL_IDS) {
      const still = shipped(`back-${foil}.webp`);
      expect(webp(still), foil).toEqual({ width: 720, height: 960, alpha: true });
      expect(still.byteLength, foil).toBeLessThanOrEqual(150_000);
    }
  });

  it('no more than 2 MB in all for a first visit to the inspect view', () => {
    // the model, one artwork and, at worst, one still
    const worst = shipped('card.glb').byteLength + Math.max(shipped('back.avif').byteLength, shipped('back.webp').byteLength) + Math.max(...FOIL_IDS.map((foil) => shipped(`back-${foil}.webp`).byteLength));
    expect(worst).toBeLessThanOrEqual(2_000_000);
  });
});
