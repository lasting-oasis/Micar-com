import { describe, it, expect } from 'vitest';
import { raceCode, routeFromLocation, withRace } from '../route';

const at = (pathname: string, search = '') => routeFromLocation({ pathname, search });

describe('routeFromLocation', () => {
  it('opens the Strip entry at /strip, with or without a trailing slash', () => {
    expect(at('/strip').view).toBe('strip');
    expect(at('/strip/').view).toBe('strip');
  });
  it('keeps the shop and world doors', () => {
    expect(at('/shop')).toEqual({ view: 'shop', tab: 'body' });
    expect(at('/')).toEqual({ view: 'world', tab: 'body' });
    expect(at('/', '?app=shop').view).toBe('shop');
    expect(at('/', '?app=mechanic')).toEqual({ view: 'shop', tab: 'mechanic' });
    expect(at('/', '?app=platform')).toEqual({ view: 'shop', tab: 'tracker' });
    expect(at('/shop', '?tab=tracker').tab).toBe('tracker');
    expect(at('/shop', '?tab=bogus').tab).toBe('body');
  });
  it('a challenge link is still the Strip entry', () => {
    expect(at('/strip', '?race=K7M2QX').view).toBe('strip');
    expect(at('/strip/', '?race=K7M2QX').view).toBe('strip');
  });
});

describe('the challenge room in the address', () => {
  it('raceCode reads ?race= as people type it, and nothing that could not be a code', () => {
    expect(raceCode('?race=K7M2QX')).toBe('K7M2QX');
    expect(raceCode('?race=k7m-2qx')).toBe('K7M2QX');
    expect(raceCode('?tab=1&race=k7m2qx&x=2')).toBe('K7M2QX');
    for (const none of ['', '?', '?race=', '?race=K7M2Q0', '?race=K7M2Q', '?race=K7M2QXX', '?other=K7M2QX']) expect(raceCode(none)).toBeNull();
  });
  it('withRace sets the code and keeps the rest of the address; null takes it out', () => {
    expect(withRace('https://x.test/strip?tab=1#h', 'K7M2QX')).toBe('https://x.test/strip?tab=1&race=K7M2QX#h');
    expect(withRace('https://x.test/strip', 'K7M2QX')).toBe('https://x.test/strip?race=K7M2QX');
    expect(withRace('https://x.test/strip?race=AAAAAA', 'K7M2QX')).toBe('https://x.test/strip?race=K7M2QX');
    expect(withRace('https://x.test/strip?race=K7M2QX&a=1', null)).toBe('https://x.test/strip?a=1');
    expect(withRace('https://x.test/strip?race=K7M2QX', null)).toBe('https://x.test/strip');
    expect(withRace('https://x.test/strip', null)).toBe('https://x.test/strip');
  });
});
