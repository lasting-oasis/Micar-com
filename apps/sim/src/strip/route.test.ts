import { describe, it, expect } from 'vitest';
import { routeFromLocation } from '../route';

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
});
