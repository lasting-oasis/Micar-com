import { describe, expect, it } from 'vitest';
import { canonicalJson, clamp, clipText, daysBetween, hashString, idFromBytes, sha256Text, interpolate, isIsoDate, isIsoTimestamp, monthsBetween, mulberry32, numberIn, round1, score1000, yearsBetween } from './util';

describe('numbers and text', () => {
  it('keeps a value inside its range', () => {
    expect(clamp(5, 0, 3)).toBe(3);
    expect(clamp(-1, 0, 3)).toBe(0);
    expect(clamp(2, 0, 3)).toBe(2);
    expect(round1(7.449)).toBe(7.4);
  });

  it('refuses a number outside its range instead of clipping it', () => {
    expect(numberIn(600, 1, 5000)).toBe(600);
    expect(numberIn(0, 1, 5000)).toBeNull();
    expect(numberIn(60000, 1, 5000)).toBeNull();
    expect(numberIn(Number.NaN, 1, 5000)).toBeNull();
    expect(numberIn('600', 1, 5000)).toBeNull();
  });

  it('cleans text from anything', () => {
    expect(clipText('  oil\tchange\n ', 20)).toBe('oil change');
    expect(clipText('abcdef', 3)).toBe('abc');
    expect(clipText(42, 10)).toBe('');
    expect(clipText(null, 10)).toBe('');
  });
});

describe('scoring tables', () => {
  const rising = [[0, 0], [100, 400], [200, 500]] as const;
  const falling = [[2, 1000], [4, 800], [10, 200]] as const;

  it('draws straight lines between anchors and stays flat beyond them', () => {
    expect(interpolate(50, rising)).toBe(200);
    expect(interpolate(150, rising)).toBe(450);
    expect(interpolate(-5, rising)).toBe(0);
    expect(interpolate(999, rising)).toBe(500);
  });

  it('reads a table where less is better', () => {
    expect(interpolate(3, falling)).toBe(900);
    expect(interpolate(1, falling)).toBe(1000);
    expect(interpolate(30, falling)).toBe(200);
  });

  it('never lets a better figure score lower', () => {
    let last = -1;
    for (let x = 0; x <= 250; x += 5) {
      const s = score1000(x, rising);
      expect(s).toBeGreaterThanOrEqual(last);
      last = s;
    }
  });

  it('returns whole scores from 0 to 1000', () => {
    expect(score1000(33, rising)).toBe(132);
    expect(score1000(5, [[0, -50], [10, 2000]])).toBe(975);
    expect(score1000(10, [[0, -50], [10, 2000]])).toBe(1000);
    expect(score1000(0, [[0, -50], [10, 2000]])).toBe(0);
    expect(interpolate(1, [])).toBe(0);
  });
});

describe('chance', () => {
  it('gives the same run for the same seed and a different run for another', () => {
    const a = mulberry32(42), b = mulberry32(42), c = mulberry32(43);
    const ra = [a(), a(), a()], rb = [b(), b(), b()], rc = [c(), c(), c()];
    expect(ra).toEqual(rb);
    expect(ra).not.toEqual(rc);
    for (const v of ra) { expect(v).toBeGreaterThanOrEqual(0); expect(v).toBeLessThan(1); }
  });

  it('hashes text to a stable unsigned seed', () => {
    expect(hashString('MC-0000')).toBe(hashString('MC-0000'));
    expect(hashString('MC-0000')).not.toBe(hashString('MC-0001'));
    expect(hashString('')).toBe(0x811c9dc5);
    expect(hashString('drag')).toBeGreaterThanOrEqual(0);
  });
});

describe('dates', () => {
  it('accepts only real days', () => {
    expect(isIsoDate('2026-11-10')).toBe(true);
    expect(isIsoDate('2024-02-29')).toBe(true);
    expect(isIsoDate('2026-02-29')).toBe(false);
    expect(isIsoDate('2026-13-01')).toBe(false);
    expect(isIsoDate('11/10/2026')).toBe(false);
    expect(isIsoDate(20261110)).toBe(false);
  });

  it('accepts timestamps Date can read', () => {
    expect(isIsoTimestamp('2026-11-10T14:03:00.000Z')).toBe(true);
    expect(isIsoTimestamp('2026-11-10')).toBe(false);
    expect(isIsoTimestamp('2026-02-30T00:00:00.000Z')).toBe(false);
    expect(isIsoTimestamp('2026-11-10Tnonsense-here')).toBe(false);
  });

  it('counts days, months and years between two days', () => {
    expect(daysBetween('2026-01-01', '2026-01-31')).toBe(30);
    expect(daysBetween('2026-01-31', '2026-01-01')).toBe(-30);
    expect(daysBetween('2026-01-01T23:59:00.000Z', '2026-01-02T00:01:00.000Z')).toBe(1);
    expect(monthsBetween('2024-11-10', '2026-11-10')).toBe(24);
    expect(monthsBetween('2024-11-10', '2026-11-09')).toBe(23);
    expect(monthsBetween('2026-11-10', '2026-11-10')).toBe(0);
    expect(yearsBetween('2020-01-01', '2026-01-01')).toBeCloseTo(6, 1);
  });
});

describe('ids', () => {
  it('writes bytes in an alphabet with no look-alike letters', () => {
    const id = idFromBytes([0, 255, 16, 32, 64, 128, 1, 2, 3, 4]);
    expect(id).toHaveLength(16);
    expect(id).toMatch(/^[0-9A-HJKMNP-TV-Z]+$/);
    expect(idFromBytes([0, 255, 16, 32, 64, 128, 1, 2, 3, 4])).toBe(id);
    expect(idFromBytes([1])).toHaveLength(2);
    expect(idFromBytes([])).toBe('');
  });
});

describe('cleaning text twice', () => {
  it('changes nothing the second time, so stored text reads back exactly', () => {
    const cases = ['a'.repeat(1999) + ' tail that goes past the cut', 'x'.repeat(119) + ' y', 'c'.repeat(39) + ' red', '  padded  ', 'tab\tand\nnewline', 'short'];
    for (const text of cases) {
      for (const max of [40, 120, 2000]) {
        const once = clipText(text, max);
        expect(clipText(once, max), `${text.slice(0, 12)} at ${max}`).toBe(once);
        expect(once.length).toBeLessThanOrEqual(max);
        expect(once).toBe(once.trim());
      }
    }
    // The cut that used to leave a trailing space.
    expect(clipText('x'.repeat(119) + ' y', 120)).toBe('x'.repeat(119));
  });

  it('never leaves half of a character at the cut', () => {
    const car = '\u{1F697}';
    const cut = clipText('ab' + car + car, 5);
    expect(cut).toBe('ab' + car);
    expect(clipText('abc' + car, 4)).toBe('abc');
    expect(clipText('a\ud800b', 10)).toBe('ab');
  });
});

describe('timestamps', () => {
  it('are one form only: a real day, a real time and a Z', () => {
    for (const good of ['2026-11-10T14:03:00.000Z', '2026-11-10T00:00:00Z', '2024-02-29T23:59:59.9Z']) expect(isIsoTimestamp(good), good).toBe(true);
    for (const bad of [
      '2026-11-10T14:03:00.000+14:00', '2026-11-10T24:00:00.000Z', '2026-11-10T14:60:00.000Z', '2026-11-10T14:03:00.000Z junk', '2026-11-10 14:03:00.000Z', '2026-11-10T14:03:00.000',
      '2026-02-30T10:00:00.000Z', '2026-11-10T14:03Z', '2026-11-10T14:03:00.0000Z', 20261110, null,
    ]) expect(isIsoTimestamp(bad), String(bad)).toBe(false);
  });
});

describe('canonical text', () => {
  it('is the same whatever order an object was built in', () => {
    expect(canonicalJson({ b: 1, a: [2, { d: null, c: 'x' }] })).toBe('{"a":[2,{"c":"x","d":null}],"b":1}');
    expect(canonicalJson({ a: [2, { c: 'x', d: null }], b: 1 })).toBe(canonicalJson({ b: 1, a: [2, { d: null, c: 'x' }] }));
    expect(canonicalJson([3, 1, 2])).toBe('[3,1,2]');
    expect(canonicalJson('a "quoted" word')).toBe(JSON.stringify('a "quoted" word'));
  });

  it('leaves out what is undefined in an object and writes null for what has no text', () => {
    expect(canonicalJson({ a: undefined, b: 1 })).toBe('{"b":1}');
    expect(canonicalJson([undefined, () => 1, Symbol('s'), NaN, Infinity])).toBe('[null,null,null,null,null]');
    expect(canonicalJson(undefined)).toBe('null');
    expect(canonicalJson(null)).toBe('null');
    expect(canonicalJson(BigInt(12))).toBe('"12"');
    expect(canonicalJson(true)).toBe('true');
    expect(canonicalJson(1.5)).toBe('1.5');
  });
});

describe('SHA-256', () => {
  it('gives the published answers', () => {
    expect(sha256Text('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    expect(sha256Text('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    expect(sha256Text('abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq')).toBe('248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1');
  });

  // The expected digests below were taken from Node's own SHA-256 (crypto.createHash) for the same UTF-8 text.
  it('is right at every length around a block edge', () => {
    const edges: [number, string][] = [
    [1, '2d711642b726b04401627ca9fbac32f5c8530fb1903cc4db02258717921a4881'],
    [55, 'd5e285683cd4efc02d021a5c62014694958901005d6f71e89e0989fac77e4072'],
    [56, '04c26261370ee7541549d16dee320c723e3fd14671e66a099afe0a377c16888e'],
    [57, 'ae14a2563ccf969d99aca69ce6bb74981f734bbf9f655f73b8f06db68cab5217'],
    [63, '75220b47218278e656f2013bb8f0c455a25eaf01e86c64924e9d48d89776d6f2'],
    [64, '7ce100971f64e7001e8fe5a51973ecdfe1ced42befe7ee8d5fd6219506b5393c'],
    [65, '9537c5fdf120482f7d58d25e9ed583f52c02b4e304ea814db1633ad565aed7e9'],
    [119, '000b48d4edf0fa7bee3c6236ecd2785baa5db4eeb8bb54341b029e0d9fa5fb0c'],
    [120, '13f05a0b594787f5ecd315edc96141bd3243203d1b7d4f0836f37308b276ba98'],
    [121, '79072a47bfaa54e6057a9ee21e0dea64b9edbfd160c4ccadbb657e64b6d22ee4'],
    [128, '24da1b81d0b16df6428eee73c69fcb2a93c76bc6df706f0c6670fe6bfe800464'],
    [200, 'aa20c23e3201834050679e1d88941b9a6fed0557c9a705cb2c315e2e63fd486d'],
    ];
    for (const [n, digest] of edges) expect(sha256Text('x'.repeat(n)), `length ${n}`).toBe(digest);
  });

  it('reads text beyond ASCII as UTF-8, and a long text block after block', () => {
    expect(sha256Text('é')).toBe('4a99557e4033c3539de2eb65472017cad5f9557f7a0625a09f1c3f6e2ba69c4c');
    expect(sha256Text('Ñandú')).toBe('2e823ea625a614e261b34c3376b0a68821f2cb65940e552f0731194f67b65ff4');
    expect(sha256Text('日本語のテキスト')).toBe('d4192d3b01dfa9f5b08388f13e5c7492e3cfdc5611bf8c77784dc97523f03efb');
    expect(sha256Text('a\u{1F697}b')).toBe('6a031b2a51380dfc15be1ec9d5b4b1a535dd8059d8de1aeac84ffce1cc7e6ae1');
    expect(sha256Text('€'.repeat(300))).toBe('f0bfafb140a383bca3267b4f3d12a61e619b8f3f3f51a3db3e4a45b11c2f70b8');
    expect(sha256Text('tab\tand\nnewline')).toBe('aafbff9baa38102842d3570e76017e82538b0df7af0f2713f9dbd45189e53ede');
    expect(sha256Text(JSON.stringify({ vin: '1M8GDM9AXKP042788', year: 2019 }))).toBe('dd2811b78008cda418e990ce418fe45f2e7c53fcfd3eeb740022081611e70546');
    expect(sha256Text('The quick brown fox jumps over the lazy dog. '.repeat(2000))).toBe('9d06cf6f06bb443f9d68b585be0e11b1b6886a1893ce123db578218033a9ea39');
  });

  it('writes a lone surrogate the way every encoder does, and never throws', () => {
    expect(sha256Text('a\ud800b')).toBe('05087813392efc16fe8ff448920c6328e53af865df39419436659d9ffda90f7b');
    expect(sha256Text('a\ud800b')).toBe(sha256Text('a\ufffdb'));
    expect(sha256Text('\udc00')).toBe('83d544ccc223c057d2bf80d3f2a32982c32c3c0db8e2674820da5064783fb097');
  });

  it('changes completely when one character does', () => {
    const a = sha256Text('{"horsepower":158}'), b = sha256Text('{"horsepower":159}');
    let same = 0;
    for (let i = 0; i < 64; i++) if (a[i] === b[i]) same += 1;
    expect(same).toBeLessThan(20);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });
});
