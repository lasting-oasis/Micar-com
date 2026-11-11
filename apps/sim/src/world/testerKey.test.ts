import { describe, it, expect } from 'vitest';
import { ATTEMPTS_GLOBAL, ATTEMPTS_PER_IP, ATTEMPT_WINDOW_MS, GLOBAL_WINDOW_MS, checkTesterKey, configuredTesterKey, isKeyAttempt, newAttemptLog, refusalText, testerKeyMatches } from './testerKey';
import { TESTER_OFF, TESTER_REFUSED } from './tester';

const KEY = 'correct-horse-battery';

describe('the configured key', () => {
  it('is off when unset, blank, shorter than 8 or longer than 128 characters', () => {
    expect(configuredTesterKey(undefined)).toBeNull();
    expect(configuredTesterKey('')).toBeNull();
    expect(configuredTesterKey('   ')).toBeNull();
    expect(configuredTesterKey('short')).toBeNull();
    expect(configuredTesterKey('x'.repeat(129))).toBeNull();
    expect(configuredTesterKey('  ' + KEY + ' ')).toBe(KEY);
  });
  it('matches only the exact key, and nothing at all when tester mode is off', () => {
    expect(testerKeyMatches(KEY, KEY)).toBe(true);
    expect(testerKeyMatches(' ' + KEY + ' ', KEY)).toBe(true); // typed with a stray space
    expect(testerKeyMatches(KEY + 'x', KEY)).toBe(false);
    expect(testerKeyMatches(KEY.slice(0, -1), KEY)).toBe(false);
    expect(testerKeyMatches(KEY.toUpperCase(), KEY)).toBe(false);
    expect(testerKeyMatches('', KEY)).toBe(false);
    expect(testerKeyMatches(undefined, KEY)).toBe(false);
    expect(testerKeyMatches({ toString: () => KEY }, KEY)).toBe(false);
    expect(testerKeyMatches('x'.repeat(5000), KEY)).toBe(false);
    expect(testerKeyMatches(KEY, null)).toBe(false);
    expect(testerKeyMatches('', null)).toBe(false);
  });
});

describe('what counts as a try at the key', () => {
  it('is eight characters or more: a short tail after a name ("Mike#1234") is not a try', () => {
    expect(isKeyAttempt('1234')).toBe(false);
    expect(isKeyAttempt('1234567')).toBe(false);
    expect(isKeyAttempt('  1234567  ')).toBe(false); // spaces do not count
    expect(isKeyAttempt('12345678')).toBe(true);
    expect(isKeyAttempt(KEY)).toBe(true);
    expect(isKeyAttempt('')).toBe(false);
    expect(isKeyAttempt(undefined)).toBe(false);
    expect(isKeyAttempt(12345678)).toBe(false);
  });
});

describe('guessing is rationed', () => {
  const OK = { ok: true }, WRONG = { ok: false, why: 'wrong' };
  it('lets the right key in and forgets that address\'s earlier misses', () => {
    const log = newAttemptLog();
    expect(checkTesterKey('nope', KEY, log, '1.1.1.1', 0)).toEqual(WRONG);
    expect(checkTesterKey(KEY, KEY, log, '1.1.1.1', 1)).toEqual(OK);
    for (let i = 0; i < ATTEMPTS_PER_IP - 1; i++) expect(checkTesterKey('nope', KEY, log, '1.1.1.1', 2 + i)).toEqual(WRONG);
    expect(checkTesterKey(KEY, KEY, log, '1.1.1.1', 50)).toEqual(OK); // still under the limit: the earlier miss was forgotten
  });
  it('after five misses an address is refused even the right key, until ten minutes have passed, and is told how long', () => {
    const log = newAttemptLog();
    for (let i = 0; i < ATTEMPTS_PER_IP; i++) expect(checkTesterKey('nope' + i, KEY, log, '2.2.2.2', i)).toEqual(WRONG);
    // the oldest miss (at 0) leaves the window at ATTEMPT_WINDOW_MS: that is when one more try opens
    expect(checkTesterKey(KEY, KEY, log, '2.2.2.2', 100)).toEqual({ ok: false, why: 'locked', retryMs: ATTEMPT_WINDOW_MS - 100 });
    expect(checkTesterKey(KEY, KEY, log, '3.3.3.3', 100)).toEqual(OK); // another address is not held back
    expect(checkTesterKey(KEY, KEY, log, '2.2.2.2', ATTEMPT_WINDOW_MS - 1)).toEqual({ ok: false, why: 'locked', retryMs: 1 });
    expect(checkTesterKey(KEY, KEY, log, '2.2.2.2', ATTEMPT_WINDOW_MS)).toEqual(OK);
  });
  it('a refused try while locked is not counted, so waiting is enough', () => {
    const log = newAttemptLog();
    for (let i = 0; i < ATTEMPTS_PER_IP; i++) checkTesterKey('nope', KEY, log, '2.2.2.2', i);
    for (let t = 1000; t < ATTEMPT_WINDOW_MS; t += 60_000) expect(checkTesterKey('nope', KEY, log, '2.2.2.2', t).ok).toBe(false);
    expect(log.byIp.get('2.2.2.2')).toHaveLength(ATTEMPTS_PER_IP);
    expect(checkTesterKey(KEY, KEY, log, '2.2.2.2', ATTEMPT_WINDOW_MS + ATTEMPTS_PER_IP)).toEqual(OK);
  });
  it('thirty misses in an hour from anywhere close it to everyone for the rest of that hour', () => {
    const log = newAttemptLog();
    for (let i = 0; i < ATTEMPTS_GLOBAL; i++) expect(checkTesterKey('nope', KEY, log, `10.0.0.${i}`, i)).toEqual(WRONG);
    expect(checkTesterKey(KEY, KEY, log, '9.9.9.9', 1000)).toEqual({ ok: false, why: 'locked', retryMs: GLOBAL_WINDOW_MS - 1000 });
    expect(checkTesterKey(KEY, KEY, log, '9.9.9.9', GLOBAL_WINDOW_MS)).toEqual(OK);
  });
  it('an address locked both ways is told the longer wait', () => {
    const log = newAttemptLog();
    for (let i = 0; i < ATTEMPTS_GLOBAL - ATTEMPTS_PER_IP; i++) checkTesterKey('nope', KEY, log, `10.0.0.${i}`, 0);
    for (let i = 0; i < ATTEMPTS_PER_IP; i++) checkTesterKey('nope', KEY, log, '7.7.7.7', 5000);
    expect(checkTesterKey(KEY, KEY, log, '7.7.7.7', 6000)).toEqual({ ok: false, why: 'locked', retryMs: GLOBAL_WINDOW_MS - 6000 });
  });
  it('with tester mode off nothing is let in and nothing is counted', () => {
    const log = newAttemptLog();
    for (let i = 0; i < 100; i++) expect(checkTesterKey('anything', null, log, '4.4.4.4', i)).toEqual({ ok: false, why: 'off' });
    expect(log.all).toHaveLength(0);
    expect(log.byIp.size).toBe(0);
  });
  it('old misses are dropped, so the log cannot grow without end', () => {
    const log = newAttemptLog();
    for (let i = 0; i < 20; i++) checkTesterKey('nope', KEY, log, `5.5.5.${i}`, i);
    checkTesterKey('nope', KEY, log, '6.6.6.6', GLOBAL_WINDOW_MS + 100);
    expect(log.all).toHaveLength(1);
    expect(log.byIp.size).toBe(1);
  });
});

describe('what a refused tester is told', () => {
  it('names the reason: wrong, switched off, or how many minutes to wait (rounded up, never zero)', () => {
    expect(refusalText({ ok: false, why: 'wrong' })).toBe(TESTER_REFUSED);
    expect(refusalText({ ok: false, why: 'off' })).toBe(TESTER_OFF);
    expect(refusalText({ ok: false, why: 'locked', retryMs: 9 * 60_000 + 1 })).toBe('Too many wrong keys. Try again in 10 minutes.');
    expect(refusalText({ ok: false, why: 'locked', retryMs: 60_000 })).toBe('Too many wrong keys. Try again in 1 minute.');
    expect(refusalText({ ok: false, why: 'locked', retryMs: 1 })).toBe('Too many wrong keys. Try again in 1 minute.');
    expect(refusalText({ ok: false, why: 'locked', retryMs: 59 * 60_000 })).toBe('Too many wrong keys. Try again in 59 minutes.');
  });
  it('never repeats what was typed', () => {
    for (const v of [{ ok: false, why: 'wrong' }, { ok: false, why: 'off' }, { ok: false, why: 'locked', retryMs: 5 }] as const) expect(refusalText(v)).not.toContain(KEY);
  });
});
