// What one page downloads in a full race of sixteen, single poses against batched ones (Part 1, Task 6), against a
// running World whose ceiling is sixteen (RACE_ROOM_MAX=16): sixteen guests in one room of the Harbour GP, fifteen of
// them sending a rounded pose every 66 ms (as the page does) down the circuit; the sixteenth, the listener, either asks
// for its poses a tick at a time (BATCH=1: race_ready { batch: true }) or not (BATCH=0), and every websocket frame it
// receives is read raw for SECONDS. Prints a JSON summary: the listener's bytes a second (payload and frame headers),
// and per message.
//   BASE=http://localhost:3123/ BATCH=1 SECONDS=10 node e2e/poses.field.measure.mjs
import { io } from 'socket.io-client';

const BASE = (process.env.BASE || 'http://localhost:3123').replace(/\/$/, '');
const SECONDS = Number(process.env.SECONDS || 10);
const BATCH = process.env.BATCH === '1';
const POSE_S = 0.066;
const roundPose = ([t, x, z, h, v, s, sc]) => { const r = (n, k) => Math.round(n * k) / k; return [Math.round(t), r(x, 100), r(z, 100), r(h, 1000), r(v, 100), r(s, 100), Math.round(sc)]; }; // race.ts roundPose

const client = () => io(BASE, { transports: ['websocket'], forceNew: true, reconnection: false });
const next = (s, ev, pred = () => true, ms = 20000) => new Promise((resolve, reject) => {
  const t = setTimeout(() => { s.off(ev, on); reject(new Error(`no ${ev} in ${ms} ms`)); }, ms);
  const on = (d) => { if (!pred(d)) return; clearTimeout(t); s.off(ev, on); resolve(d); };
  s.on(ev, on);
});
const connected = (s) => new Promise((res, rej) => { if (s.connected) return res(); s.once('connect', res); s.once('connect_error', rej); });
const wsHeader = (payload) => (payload <= 125 ? 2 : payload <= 65535 ? 4 : 10);

// the circuit, to drive the senders down it
const track = await (await fetch(BASE + '/strip/tracks/monaco.json')).json();
const R = track.routes.harbour_gp, off = track.offset;
const pts = R.pts.map(([x, z]) => [x + off[0], z + off[1]]); pts.push(pts[0]);
const cum = [0]; for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
const LAP = cum[cum.length - 1];
const at = (s) => { s = ((s % LAP) + LAP) % LAP; let i = 1; while (i < cum.length - 1 && cum[i] < s) i++; const a = pts[i - 1], b = pts[i], k = (s - cum[i - 1]) / Math.max(1e-6, cum[i] - cum[i - 1]); return { x: a[0] + (b[0] - a[0]) * k, z: a[1] + (b[1] - a[1]) * k, h: Math.atan2(b[0] - a[0], b[1] - a[1]) }; };

const all = Array.from({ length: 16 }, client);
await Promise.all(all.map(connected));
for (const [i, s] of all.entries()) { const init = next(s, 'init'); s.emit('join', { mode: 'guest', name: `Field ${i + 1}` }); await init; }
const [host, ...rest] = all, listener = rest[14];
const made = next(host, 'race_room'); host.emit('race_create', { eventId: 'harbour_gp', car: 'ronin', size: 16 });
const room = await made;
if (room.max !== 16) throw new Error(`this server makes rooms of ${room.max}: start it with RACE_ROOM_MAX=16`);
const full = next(host, 'race_room', r => r.members.length === 16);
for (const s of rest) s.emit('race_join', { code: room.code });
await full;
const racing = next(host, 'race_room', r => r.phase === 'racing');
host.emit('race_start');
await next(host, 'race_room', r => r.phase === 'loading' || r.phase === 'racing');
for (const s of all) s.emit('race_ready', s === listener && BATCH ? { batch: true } : undefined);
await racing;

// the listener's raw frames
const ws = listener.io.engine.transport.ws, frames = [];
ws.on('message', (data) => { const buf = Buffer.isBuffer(data) ? data : Buffer.from(data); frames.push({ bytes: buf.length, ev: (/^42\["([^"]+)"/.exec(buf.toString('utf8')) || [])[1] || 'other' }); });
// fifteen senders (everyone but the listener), each a pose every 66 ms at its own pace
const senders = all.filter(s => s !== listener), t0 = Date.now();
const timers = senders.map((s, k) => { let d = 120 + k * 9, v = 0; return setInterval(() => { v = Math.min(55, v + 4 * POSE_S); d += v * POSE_S; const p = at(d); s.volatile.emit('race_pose', roundPose([Date.now(), p.x + k * 0.3, p.z, p.h, v, d, 0])); }, POSE_S * 1000); });
await new Promise(r => setTimeout(r, SECONDS * 1000));
timers.forEach(clearInterval);
const seconds = (Date.now() - t0) / 1000;
const pick = (ev) => frames.filter(f => f.ev === ev);
const sum = (fs) => fs.reduce((n, f) => n + f.bytes + wsHeader(f.bytes), 0);
const poses = pick(BATCH ? 'race_poses' : 'race_pose');
const out = {
  base: BASE, batched: BATCH, seconds: +seconds.toFixed(1), senders: senders.length,
  messages: poses.length, messagesPerSecond: +(poses.length / seconds).toFixed(1),
  bytesPerMessage: poses.length ? +(poses.reduce((n, f) => n + f.bytes, 0) / poses.length).toFixed(1) : 0,
  downloadBytesPerSecond: Math.round(sum(poses) / seconds), // payloads and their frame headers
  allFramesBytesPerSecond: Math.round(sum(frames) / seconds),
};
for (const s of all) { s.emit('race_leave'); s.close(); }
console.log(JSON.stringify(out, null, 2));
process.exit(0);
