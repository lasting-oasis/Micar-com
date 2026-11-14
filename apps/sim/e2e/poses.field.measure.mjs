// What one page downloads in a full race of sixteen, single poses against batched ones (Part 1, Task 6), against a
// running World whose ceiling is sixteen (RACE_ROOM_MAX=16): sixteen guests in one room of the Harbour GP, fifteen of
// them sending a rounded pose every 66 ms (as the page does) down the circuit; the sixteenth, the listener, either asks
// for its poses a tick at a time (BATCH=1: race_ready { batch: true }) or not (BATCH=0), and every websocket frame it
// receives is read raw for SECONDS. Prints a JSON summary: the poses each sender sent a second, the listener's messages
// a second and poses in each, its bytes a second (payload and frame headers), and how old a pose is when it arrives.
// The senders keep a fixed schedule, a pose due every 66 ms from the start: a timer that fires late is followed by one
// that fires early (Windows' timers tick about every 15 ms; setInterval(66) sent 13.7 a second there, not 15.2). The
// server's own tick, setInterval(66), is not corrected: on this PC it runs at about 13.8 a second, so for BATCH=1 the
// summary also gives the download at the 15.2 ticks a second it is set for (arithmetic: bytes a message × 1000/66).
//   BASE=http://localhost:3123/ BATCH=1 SECONDS=10 node e2e/poses.field.measure.mjs
import { io } from 'socket.io-client';

const BASE = (process.env.BASE || 'http://localhost:3123').replace(/\/$/, '');
const SECONDS = Number(process.env.SECONDS || 10);
const BATCH = process.env.BATCH === '1';
const POSE_MS = 66, GAP_MS = 41; // the page's pose interval; the server drops a pose within 40 ms of the last (POSE_GAP_MS)
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
const goAt = (await racing).goAt;

// the listener's raw frames: bytes, event, how many poses each carries, and each pose's age on arrival (the senders
// stamp a pose with this PC's clock as they send it; a batched pose's time counts from the green)
const ws = listener.io.engine.transport.ws, frames = [], ages = [];
ws.on('message', (data) => {
  const now = Date.now(), buf = Buffer.isBuffer(data) ? data : Buffer.from(data), text = buf.toString('utf8');
  const ev = (/^42\["([^"]+)"/.exec(text) || [])[1] || 'other';
  let poses = 0;
  if (ev === 'race_poses') { const batch = JSON.parse(text.slice(2))[1]; poses = batch.length; for (const e of batch) ages.push(now - (goAt + e[1])); }
  else if (ev === 'race_pose') { poses = 1; ages.push(now - JSON.parse(text.slice(2))[1][1]); }
  frames.push({ bytes: buf.length, ev, poses });
});
const pct = (xs, q) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.min(s.length - 1, Math.floor(q * s.length))] : 0; };
// fifteen senders (everyone but the listener), each a pose due every 66 ms from its start, never two within GAP_MS
const senders = all.filter(s => s !== listener), t0 = Date.now(), sent = senders.map(() => 0);
let running = true;
senders.forEach((s, k) => {
  let d = 120 + k * 9, v = 0, n = 0;
  const start = t0 + k * 4; // staggered a little, as fifteen phones would be
  const send = () => {
    if (!running) return;
    v = Math.min(55, v + 4 * POSE_MS / 1000); d += v * POSE_MS / 1000; const p = at(d);
    s.volatile.emit('race_pose', roundPose([Date.now(), p.x + k * 0.3, p.z, p.h, v, d, 0])); sent[k]++;
    n++; setTimeout(send, Math.max(GAP_MS, start + n * POSE_MS - Date.now()));
  };
  setTimeout(send, start - Date.now());
});
await new Promise(r => setTimeout(r, SECONDS * 1000));
running = false;
const seconds = (Date.now() - t0) / 1000;
const pick = (ev) => frames.filter(f => f.ev === ev);
const sum = (fs) => fs.reduce((n, f) => n + f.bytes + wsHeader(f.bytes), 0);
const poses = pick(BATCH ? 'race_poses' : 'race_pose');
const bytesPerMessage = poses.length ? poses.reduce((n, f) => n + f.bytes, 0) / poses.length : 0;
const out = {
  base: BASE, batched: BATCH, seconds: +seconds.toFixed(1), senders: senders.length,
  posesSentPerSecondEach: +(sent.reduce((a, b) => a + b, 0) / senders.length / seconds).toFixed(2),
  messages: poses.length, messagesPerSecond: +(poses.length / seconds).toFixed(1),
  posesPerMessage: poses.length ? +(poses.reduce((n, f) => n + f.poses, 0) / poses.length).toFixed(2) : 0,
  posesReceivedPerSecond: +(poses.reduce((n, f) => n + f.poses, 0) / seconds).toFixed(1),
  bytesPerMessage: +bytesPerMessage.toFixed(1),
  downloadBytesPerSecond: Math.round(sum(poses) / seconds), // payloads and their frame headers
  allFramesBytesPerSecond: Math.round(sum(frames) / seconds),
  poseAgeMs: { median: pct(ages, 0.5), p95: pct(ages, 0.95), max: pct(ages, 1) }, // sent to received, on one PC: no network in it
};
// the server's tick is setInterval(66): at the 1000/66 ticks a second it is set for, each tick one message of this size
if (BATCH) out.downloadAtSetTickBytesPerSecond = Math.round((bytesPerMessage + wsHeader(Math.round(bytesPerMessage))) * 1000 / POSE_MS);
for (const s of all) { s.emit('race_leave'); s.close(); }
console.log(JSON.stringify(out, null, 2));
process.exit(0);
