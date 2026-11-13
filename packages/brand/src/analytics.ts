// Visitor counts for every MiCar surface: Cloudflare Web Analytics (no cookies, nothing stored on the visitor's device, no consent banner).
// One token per hostname, pasted here once. A token is public (it ships in the page), so it is committed, not a secret.
// An empty token means that surface is not counted: nothing is loaded.
//
// Where to get one: dash.cloudflare.com → Analytics & Logs → Web Analytics → Add a site → the hostname below → copy the token from the snippet.
//   door:  lasting-oasis.github.io  (the Pages site: the door, Value, the car pages, the Garage)
//   world: micar-sim.onrender.com   (MiCar World, the Strip, MiCar Shop)
// The door's pages are hash routes (#/value, #/c/…), which Cloudflare does not split out: the door counts as one page.
export const ANALYTICS_TOKENS = {
  door: '',
  world: '',
} as const;

export type AnalyticsSite = keyof typeof ANALYTICS_TOKENS;

export const BEACON_SRC = 'https://static.cloudflareinsights.com/beacon.min.js';
const BEACON_ID = 'mc-analytics';

/** Cloudflare tokens are 32 hex characters; anything else (a pasted snippet, a typo) loads nothing. */
export function validToken(token: string): boolean {
  return /^[0-9a-f]{32}$/i.test(token);
}

/** Count real visits only: not the developer's machine, not a preview on a private address. */
export function countableHost(hostname: string): boolean {
  if (!hostname || hostname === 'localhost' || hostname.endsWith('.local')) return false;
  if (/^\[?[0-9a-f:.]+\]?$/i.test(hostname)) return false; // IPv4 and IPv6 literals
  return true;
}

/** The value of the script's data-cf-beacon attribute. */
export function beaconConfig(token: string): string {
  return JSON.stringify({ token });
}

/** Adds the beacon to the page, once. Safe to call anywhere: it does nothing without a token, off the web, or on a dev host. */
export function installAnalytics(site: AnalyticsSite, token: string = ANALYTICS_TOKENS[site]): boolean {
  if (typeof document === 'undefined' || typeof window === 'undefined') return false;
  if (!validToken(token) || !countableHost(window.location.hostname)) return false;
  if (document.getElementById(BEACON_ID)) return false;
  const script = document.createElement('script');
  script.id = BEACON_ID;
  script.defer = true;
  script.src = BEACON_SRC;
  script.setAttribute('data-cf-beacon', beaconConfig(token));
  document.head.appendChild(script);
  return true;
}
