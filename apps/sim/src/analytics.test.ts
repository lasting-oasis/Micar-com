import { describe, expect, it } from 'vitest';
import { ANALYTICS_TOKENS, BEACON_SRC, beaconConfig, countableHost, installAnalytics, validToken } from '@micar/brand/analytics';
import { SITE_URL, WORLD_URL } from '@micar/brand';

describe('visitor analytics', () => {
  it('accepts a Cloudflare token and nothing else', () => {
    expect(validToken('0123456789abcdef0123456789ABCDEF')).toBe(true);
    for (const bad of ['', 'token', '0123456789abcdef', '<script defer src="x"></script>', '0123456789abcdef0123456789abcdeg']) expect(validToken(bad)).toBe(false);
  });
  it('every committed token is empty or valid', () => {
    for (const token of Object.values(ANALYTICS_TOKENS)) expect(token === '' || validToken(token)).toBe(true);
  });
  it('counts the live hosts, not a developer machine', () => {
    expect(countableHost(new URL(SITE_URL).hostname)).toBe(true);
    expect(countableHost(new URL(WORLD_URL).hostname)).toBe(true);
    for (const dev of ['', 'localhost', '127.0.0.1', '192.168.1.20', '[::1]', 'pc.local']) expect(countableHost(dev)).toBe(false);
  });
  it('loads the beacon over https with only the token', () => {
    expect(BEACON_SRC).toBe('https://static.cloudflareinsights.com/beacon.min.js');
    expect(JSON.parse(beaconConfig('0123456789abcdef0123456789abcdef'))).toEqual({ token: '0123456789abcdef0123456789abcdef' });
  });
  it('does nothing where there is no page', () => {
    expect(installAnalytics('world', '0123456789abcdef0123456789abcdef')).toBe(false);
  });
});
