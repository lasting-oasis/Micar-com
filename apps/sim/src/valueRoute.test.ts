// The /api/v1/value handler over real HTTP, in this process: server.ts mounts valueRoute() exactly as here. A
// valuation that throws cannot be provoked from outside the server, so this mounts the same handler with one that
// does, and checks the 500 a caller would get: never cached, CORS still open, a plain message, the error logged
// on the server and not leaked in the body.
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import express from 'express';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { valueRoute } from './valueRoute';

let server: Server;
let base = '';
const calls: string[] = [];

beforeAll(async () => {
  const app = express();
  app.get('/api/v1/value', valueRoute());                                  // the real valuation
  app.get('/broken/value', valueRoute((q) => { calls.push(q.toString()); throw new Error('engine exploded: secret detail'); }));
  await new Promise<void>((r) => { server = app.listen(0, '127.0.0.1', () => r()); });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((r) => server.close(() => r())));

describe('valueRoute', () => {
  it('a valuation that throws is a 500: not cached, CORS open, a plain message, logged but not leaked', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const r = await fetch(`${base}/broken/value?id=honda-civic&year=2019&trim=Si?&mileage=60000`);
    expect(r.status).toBe(500);
    expect(r.headers.get('cache-control')).toBe('no-store');
    expect(r.headers.get('access-control-allow-origin')).toBe('*');
    expect(r.headers.get('content-type')).toMatch(/^application\/json/);
    const body = await r.json() as { ok: boolean; errors: Record<string, string> };
    expect(body).toEqual({ ok: false, errors: { server: 'The valuation failed. Try again, or open the calculator.' } });
    expect(JSON.stringify(body)).not.toContain('secret detail');
    expect(log).toHaveBeenCalledWith('value api', expect.any(Error));
    expect(calls).toEqual(['id=honda-civic&year=2019&trim=Si%3F&mileage=60000']);   // it got the whole query, '?' included
    log.mockRestore();
  });

  it('a valuation that answers is passed through with its status, CORS open and cacheable for an hour', async () => {
    const ok = await fetch(`${base}/api/v1/value?id=honda-civic&year=2019&mileage=60000`);
    expect(ok.status).toBe(200);
    expect(ok.headers.get('cache-control')).toBe('public, max-age=3600');
    expect(ok.headers.get('access-control-allow-origin')).toBe('*');
    expect(((await ok.json()) as { ok: boolean }).ok).toBe(true);
    const no = await fetch(`${base}/api/v1/value?id=nope&year=2019`);
    expect(no.status).toBe(404);
    expect(no.headers.get('cache-control')).toBe('public, max-age=3600');
  });
});
