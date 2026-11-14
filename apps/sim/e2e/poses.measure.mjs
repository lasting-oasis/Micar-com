// Measures the bytes of one race pose on the wire, sent and relayed, against a running World (BASE, default :3123).
// Two guests go through a challenge as serverWiring.test.ts drives one (join as guest, race_create, race_join,
// race_start, race_ready, then racing); A then sends poses about 15 times a second down the Harbour GP, built like the
// page's sendPose: rounded (ROUND=1, the page since Part 1 Task 5) or with full-precision numbers (ROUND=0, an older
// page). B records every websocket frame it receives, raw (no compression is negotiated). Prints a JSON summary.
//   BASE=http://localhost:3123/ ROUND=1 SECONDS=10 node e2e/poses.measure.mjs
import { io } from 'socket.io-client';

const BASE = (process.env.BASE || 'http://localhost:3123').replace(/\/$/, '');
const SECONDS = Number(process.env.SECONDS || 10);
const ROUND = process.env.ROUND !== '0';
const POSE_S = 0.066; // VanillaThreeScene.tsx POSE_S
const roundPose = ([t, x, z, h, v, s, sc]) => { const r = (n, k) => Math.round(n * k) / k; return [Math.round(t), r(x, 100), r(z, 100), r(h, 1000), r(v, 100), r(s, 100), Math.round(sc)]; }; // race.ts roundPose
const client = () => io(BASE, { transports: ['websocket'], forceNew: true, reconnection: false });
const next = (s, ev, pred = () => true, ms = 15000) => new Promise((resolve, reject) => {
  const t = setTimeout(() => { s.off(ev, on); reject(new Error(`no ${ev} in ${ms} ms`)); }, ms);
  const on = (d) => { if (!pred(d)) return; clearTimeout(t); s.off(ev, on); resolve(d); };
  s.on(ev, on);
});
const connected = (s) => new Promise((res, rej) => { if (s.connected) return res(); s.once('connect', res); s.once('connect_error', rej); });
const join = async (s, msg) => { const init = next(s, 'init'); s.emit('join', msg); return init; };
const roomSeen = (s, pred = () => true) => next(s, 'race_room', pred, 15000);

/** Every frame this socket's websocket receives and sends: payload bytes and the event name (socket.io text frames). */
function tap(s, label) {
  const t = s.io.engine.transport;
  if (t.name !== 'websocket') throw new Error(label + ': transport is ' + t.name);
  const ws = t.ws, rec = { inFrames: [], outFrames: [], ext: ws.extensions, sock: ws._socket };
  const evOf = (str) => { const m = /^4(\d)(?:[^\[]*)\[\s*"([^"]+)"/.exec(str); return m ? m[2] : (str[0] === '2' || str[0] === '3' ? 'ping/pong' : 'other:' + str.slice(0, 3)); };
  ws.on('message', (data, isBinary) => {
    const buf = Buffer.isBuffer(data) ? data : Buffer.from(data);
    const str = isBinary ? '' : buf.toString('utf8');
    rec.inFrames.push({ at: Date.now(), bytes: buf.length, ev: isBinary ? 'binary' : evOf(str), str: str.startsWith('42["race_pose"') ? str : undefined });
  });
  const send = ws.send.bind(ws);
  ws.send = (data, ...rest) => {
    const n = Buffer.byteLength(data);
    rec.outFrames.push({ at: Date.now(), bytes: n, ev: typeof data === 'string' ? evOf(data) : 'binary', str: typeof data === 'string' && data.startsWith('42["race_pose"') ? data : undefined });
    return send(data, ...rest);
  };
  return rec;
}
const wsHeader = (payload, masked) => (payload <= 125 ? 2 : payload <= 65535 ? 4 : 10) + (masked ? 4 : 0);
const stats = (xs) => { const s = [...xs].sort((a, b) => a - b); const sum = s.reduce((a, b) => a + b, 0); return { n: s.length, min: s[0], max: s[s.length - 1], mean: +(sum / Math.max(1, s.length)).toFixed(2), median: s[Math.floor(s.length / 2)] }; };

// A realistic lap: harbour_gp's route (metres, plus the circuit's offset) at 40..60 m/s, full-precision doubles.
const track = await (await fetch(BASE + '/strip/tracks/monaco.json')).json();
const R = track.routes.harbour_gp, off = track.offset;
const pts = R.pts.map(([x, z]) => [x + off[0], z + off[1]]); pts.push(pts[0]);
const cum = [0]; for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
const LAP = cum[cum.length - 1];
const at = (s) => { s = ((s % LAP) + LAP) % LAP; let i = 1; while (i < cum.length - 1 && cum[i] < s) i++; const a = pts[i - 1], b = pts[i], k = (s - cum[i - 1]) / Math.max(1e-6, cum[i] - cum[i - 1]); return { x: a[0] + (b[0] - a[0]) * k, z: a[1] + (b[1] - a[1]) * k, h: Math.atan2(b[0] - a[0], b[1] - a[1]) }; };

const out = { base: BASE, rounded: ROUND, lapM: +LAP.toFixed(1), offset: off };
const a = client(), b = client();
await Promise.all([connected(a), connected(b)]);
const A = tap(a, 'A'), B = tap(b, 'B');
out.extensions = { A: A.ext, B: B.ext }; // '' = no permessage-deflate negotiated
const ai = await join(a, { mode: 'guest', name: 'PoseA' }), bi = await join(b, { mode: 'guest', name: 'PoseB' });
out.ids = { A: ai.id, B: bi.id, idLen: ai.id.length };
// the challenge, as serverWiring.test.ts drives it
const made = roomSeen(a); a.emit('race_create', { eventId: 'royal_drag', car: 'ronin' });
const room = await made; out.room = { code: room.code, eventId: room.eventId };
const two = roomSeen(a, r => r.members.length === 2);
const bJoined = roomSeen(b); b.emit('race_join', { code: room.code }); await bJoined; await two;
const loading = [a, b].map(s => roomSeen(s, r => r.phase === 'loading'));
a.emit('race_start');
await Promise.all(loading);
const going = [a, b].map(s => roomSeen(s, r => r.phase === 'racing'));
for (const s of [a, b]) s.emit('race_ready');
const go = (await Promise.all(going))[0];
out.goAt = go.goAt; out.members = go.members.map(m => m.state);

// A races: a pose every POSE_S, like sendPose (lossy: volatile.emit)
const offsetMs = 0.5; // serverNow() = Date.now() + offset; the offset is a mid-trip estimate and is often a half millisecond
let s = 120.37, v = 0, h0 = 0; const t0 = Date.now(); let sent = 0;
const markIn = B.inFrames.length, markOut = A.outFrames.length, bRead0 = B.sock.bytesRead, aWritten0 = A.sock.bytesWritten;
await new Promise(resolve => {
  const timer = setInterval(() => {
    const el = (Date.now() - t0) / 1000;
    if (el >= SECONDS) { clearInterval(timer); resolve(); return; }
    v = Math.min(58.3, v + 4.1 * POSE_S) + Math.random() * 0.01; s += v * POSE_S;
    const p = at(s), score = Math.round(0);
    const pose = [Date.now() + offsetMs, p.x + Math.random() * 0.3, p.z + Math.random() * 0.3, p.h + (Math.random() - 0.5) * 0.02, v, s, score];
    a.volatile.emit('race_pose', ROUND ? roundPose(pose) : pose); sent++;
  }, POSE_S * 1000);
});
await new Promise(r => setTimeout(r, 500));
const bRead = B.sock.bytesRead - bRead0, aWritten = A.sock.bytesWritten - aWritten0;
const inWin = B.inFrames.slice(markIn), outWin = A.outFrames.slice(markOut);
const poseIn = inWin.filter(f => f.ev === 'race_pose'), poseOut = outWin.filter(f => f.ev === 'race_pose');
const byEv = {}; for (const f of inWin) { const e = byEv[f.ev] ??= { frames: 0, bytes: 0 }; e.frames++; e.bytes += f.bytes; }
const byEvOut = {}; for (const f of outWin) { const e = byEvOut[f.ev] ??= { frames: 0, bytes: 0 }; e.frames++; e.bytes += f.bytes; }
const headerIn = inWin.reduce((n, f) => n + wsHeader(f.bytes, false), 0), headerOut = outWin.reduce((n, f) => n + wsHeader(f.bytes, true), 0);
out.window = { seconds: SECONDS, posesSent: sent, posesRelayed: poseIn.length, ratePerS: +(poseIn.length / SECONDS).toFixed(2) };
out.relayed = {
  payloadBytes: stats(poseIn.map(f => f.bytes)),
  example: poseIn[Math.floor(poseIn.length / 2)]?.str,
  wsHeaderBytes: wsHeader(poseIn[0]?.bytes ?? 0, false),
  decodedArgsJsonBytes: stats(poseIn.map(f => Buffer.byteLength(JSON.stringify(JSON.parse(f.str.slice(2))[1])))),
};
out.sent = {
  payloadBytes: stats(poseOut.map(f => f.bytes)),
  example: poseOut[Math.floor(poseOut.length / 2)]?.str,
  wsHeaderBytes: wsHeader(poseOut[0]?.bytes ?? 0, true),
  argsJsonBytes: stats(poseOut.map(f => Buffer.byteLength(JSON.stringify(JSON.parse(f.str.slice(2))[1])))),
};
// the TCP stream's own byte counters over the same window: the frames' payloads plus their websocket headers
out.tcpCheck = {
  B: { bytesRead: bRead, framesPayload: inWin.reduce((n, f) => n + f.bytes, 0), wsHeaders: headerIn, framesInWindow: inWin.length },
  A: { bytesWritten: aWritten, framesPayload: outWin.reduce((n, f) => n + f.bytes, 0), wsHeaders: headerOut, framesInWindow: outWin.length },
};
out.receivedByEvent = byEv; out.sentByEvent = byEvOut;
// leave the race and the world
a.emit('race_quit'); b.emit('race_quit');
await new Promise(r => setTimeout(r, 300));
a.emit('race_leave'); b.emit('race_leave');
await new Promise(r => setTimeout(r, 300));
a.close(); b.close();
const json = JSON.stringify(out, null, 2);
console.log(json);
process.exit(0);
