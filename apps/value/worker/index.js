// Live comps proxy for Queen City MyCarValue.
//
// Runs on Cloudflare Workers (free plan). Holds the MarketCheck API key so it
// never ships to the browser, answers one question — "what are similar cars
// asking near this ZIP right now?" — and returns only the fields the page
// needs. Each call is triggered by a person clicking the button, which is the
// use MarketCheck's free plan is written for; identical questions are served
// from the edge cache for a short time to stay inside 500 calls a month.
//
// Setup (once):
//   1. marketcheck.com → sign up → copy your API key (free plan: 500 calls/month, 100-mile radius).
//   2. dash.cloudflare.com → Workers & Pages → Create → paste this file.
//   3. Worker → Settings → Variables: secret MARKETCHECK_KEY, plain var ALLOWED_ORIGIN
//      (e.g. https://lasting-oasis.github.io). Deploy and copy the worker URL.
//   4. GitHub repo → Settings → Secrets and variables → Actions → Variables → COMPS_URL = that URL.
//      The next deploy wires the "Pull live comps" button to it.

const CACHE_SECONDS = 3 * 60 * 60;
const MAX_RADIUS = 100;

export default {
  async fetch(request, env, ctx) {
    const origin = request.headers.get('Origin') || '';
    const allowed = !env.ALLOWED_ORIGIN || env.ALLOWED_ORIGIN.split(',').map((s) => s.trim()).includes(origin);
    const cors = {
      'Access-Control-Allow-Origin': allowed ? origin || '*' : 'null',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Vary': 'Origin',
    };
    if (request.method === 'OPTIONS') return new Response(null, { headers: cors });
    if (request.method !== 'GET') return json({ error: 'GET only' }, 405, cors);
    if (!allowed) return json({ error: 'Origin not allowed' }, 403, cors);
    if (!env.MARKETCHECK_KEY) return json({ error: 'MARKETCHECK_KEY is not set on the worker' }, 500, cors);

    const q = new URL(request.url).searchParams;
    const make = clean(q.get('make'), 30);
    const model = clean(q.get('model'), 40);
    const year = Number(q.get('year'));
    const zip = (q.get('zip') || '').trim();
    const radius = Math.min(MAX_RADIUS, Math.max(10, Number(q.get('radius')) || 50));
    if (!make || !model) return json({ error: 'make and model are required' }, 400, cors);
    if (!/^\d{5}$/.test(zip)) return json({ error: 'zip must be 5 digits' }, 400, cors);
    if (!Number.isInteger(year) || year < 1990 || year > 2100) return json({ error: 'year must be a model year' }, 400, cors);

    // Same question in the last few hours → same answer, no new API call.
    const cacheKey = new Request(`https://comps.cache/${encodeURIComponent(make)}/${encodeURIComponent(model)}/${year}/${zip}/${radius}`);
    const cache = caches.default;
    const hit = await cache.match(cacheKey);
    if (hit) {
      const body = await hit.text();
      return new Response(body, { headers: { ...cors, 'Content-Type': 'application/json', 'X-Cache': 'HIT' } });
    }

    const upstream = new URL('https://api.marketcheck.com/v2/search/car/active');
    upstream.search = new URLSearchParams({
      api_key: env.MARKETCHECK_KEY,
      make,
      model: model.split('/')[0].trim(), // "Forte / K4" → "Forte"
      year_range: `${year - 2}-${year + 2}`,
      zip,
      radius: String(radius),
      car_type: 'used',
      rows: '50',
      sort_by: 'dom',
      sort_order: 'desc',
      stats: 'price,miles,dom',
    }).toString();

    let data;
    try {
      const res = await fetch(upstream.toString(), { headers: { Accept: 'application/json' } });
      if (res.status === 429) return json({ error: 'Monthly lookup budget is used up; try next month or paste a listings page instead.' }, 429, cors);
      if (!res.ok) return json({ error: `MarketCheck returned ${res.status}` }, 502, cors);
      data = await res.json();
    } catch (err) {
      return json({ error: `Could not reach MarketCheck: ${err.message}` }, 502, cors);
    }

    const listings = (data.listings || [])
      .map((l) => ({
        price: Number(l.price),
        miles: l.miles === undefined || l.miles === null ? undefined : Number(l.miles),
        year: l.build && l.build.year ? Number(l.build.year) : undefined,
        dom: l.dom === undefined ? undefined : Number(l.dom),
        city: l.dealer ? [l.dealer.city, l.dealer.state].filter(Boolean).join(', ') : undefined,
        title: l.heading,
      }))
      .filter((l) => Number.isFinite(l.price) && l.price >= 1500);

    const out = {
      source: 'MarketCheck',
      fetchedAt: new Date().toISOString(),
      query: { make, model, year, zip, radius },
      count: Number(data.num_found) || listings.length,
      stats: data.stats || null,
      listings,
    };
    const body = JSON.stringify(out);
    ctx.waitUntil(cache.put(cacheKey, new Response(body, { headers: { 'Content-Type': 'application/json', 'Cache-Control': `s-maxage=${CACHE_SECONDS}` } })));
    return new Response(body, { headers: { ...cors, 'Content-Type': 'application/json', 'X-Cache': 'MISS' } });
  },
};

function clean(v, max) { return (v || '').replace(/[^\w .\/-]/g, '').trim().slice(0, max); }
function json(obj, status, headers) {
  return new Response(JSON.stringify(obj), { status, headers: { ...headers, 'Content-Type': 'application/json' } });
}
