// GET /api/v1/value: the MiCar calculator's engine as JSON, for agents and other sites (GitHub Pages can't run code).
// Read-only and keyless; documented at https://lasting-oasis.github.io/Micar-com/api/v1/openapi.json. server.ts mounts
// valueRoute(); the valuation itself is apps/value/src/api/valueApi.ts. `run` is only swapped in tests, to reach the
// failure branch, which no request from outside can.
import type { Request, Response } from 'express';
import { cacheControlFor, queryOf, valueQuery, type ApiResponse } from '../../value/src/api/valueApi.ts';

export function valueRoute(run: (q: URLSearchParams) => ApiResponse = valueQuery) {
  return (req: Request, res: Response) => {
    res.set('Access-Control-Allow-Origin', '*');
    try {
      const out = run(queryOf(req.originalUrl));                 // the whole query, a literal '?' in a value included
      res.set('Cache-Control', cacheControlFor(out.status));
      res.status(out.status).json(out.body);
    } catch (e) {
      console.error('value api', e);                             // logged here; the caller gets a plain message
      res.set('Cache-Control', cacheControlFor(500));           // never cache a failure
      res.status(500).json({ ok: false, errors: { server: 'The valuation failed. Try again, or open the calculator.' } });
    }
  };
}
