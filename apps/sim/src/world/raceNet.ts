/* What the 3D view needs from a challenge room's traffic, kept outside React and the store: fifteen poses a second
   from each other racer must re-render nothing. Two things: the clock the racers share (the server's, as this browser
   measured it), and each other racer's car. */
import { RACE_MAX } from './race';
import { RemoteCar } from './strip/remote';

type Emitter = { emit(ev: string, ...args: unknown[]): unknown };

/** the server's clock minus this browser's, in ms, from the fastest round trip of the last measurement */
let offset = 0;
let bestTrip = Infinity;
let measurement = 0;

/** What one timed round trip says the offset is: the server's answer is taken to come from the middle of the trip. */
export function offsetFrom(sentAt: number, serverAt: number, receivedAt: number): number {
  return serverAt - (sentAt + receivedAt) / 2;
}
export const clockOffset = (): number => offset;
/** Now, on the server's clock: the green light is named on it, and every pose is stamped with it. */
export const serverNow = (): number => Date.now() + offset;

/** Measures this browser's clock against the server's: `probes` timed round trips `gapMs` apart, the fastest one kept
 *  (the less time a trip took, the less its two legs can differ). A new measurement replaces the one before. */
export function syncClock(socket: Emitter, probes = 5, gapMs = 300): void {
  const mine = ++measurement;
  bestTrip = Infinity;
  for (let i = 0; i < probes; i++) setTimeout(() => {
    if (mine !== measurement) return;
    const sentAt = Date.now();
    socket.emit('race_time', (serverAt: unknown) => {
      if (mine !== measurement || typeof serverAt !== 'number' || !Number.isFinite(serverAt)) return;
      const receivedAt = Date.now(), trip = receivedAt - sentAt;
      if (trip < bestTrip) { bestTrip = trip; offset = offsetFrom(sentAt, serverAt, receivedAt); }
    });
  }, i * gapMs);
}

/** The other racers of the race this page is in, by player id. */
export const remotes = new Map<string, RemoteCar>();

/** A pose the server relayed: [id, t, x, z, h, v, s, score]. Anything else is ignored. */
export function takePose(msg: unknown, now: number = serverNow()): void {
  if (!Array.isArray(msg) || msg.length !== 8 || typeof msg[0] !== 'string' || !msg[0]) return;
  for (let i = 1; i < 8; i++) if (typeof msg[i] !== 'number' || !Number.isFinite(msg[i])) return;
  const [id, t, x, z, h, v, s, sc] = msg as [string, number, number, number, number, number, number, number];
  let car = remotes.get(id);
  if (!car) {
    if (remotes.size >= RACE_MAX - 1) return; // a room is four people: there are never more others than three
    car = new RemoteCar(); remotes.set(id, car);
  }
  car.push({ t, x, z, h, v, s, sc }, now);
}

export function dropRemotes(): void { remotes.clear(); }
