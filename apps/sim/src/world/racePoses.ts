/* The batched relay (Part 1, Task 6): every tick, a page that asked for it gets one `race_poses` message with the newest
   pose of each other racer, instead of one `race_pose` per pose. Each racer is named by its grid place (a number of one
   or two digits) instead of its 20-character socket id, and its time counts from the green light (six digits instead
   of thirteen). Measured on a racer's pose, about half the bytes of fifteen single messages. Pure: packing on the
   server, unpacking on the page. */
import { roundPose } from './race';

/** One tick's poses: `[slot, t − goAt, x, z, h, v, s, score]` each, rounded as roundPose rounds them. */
export function packPoses(goAt: number, poses: readonly { slot: number; pose: readonly number[] }[]): number[][] {
  return poses.map(({ slot, pose }) => { const [t, ...rest] = roundPose(pose); return [slot, Math.round(t - goAt), ...rest]; });
}

/** A batch back into race_pose's shape, `[id, t, x, z, h, v, s, score]`, the slot read back to its racer by `idOfSlot`;
 *  an entry that is not eight finite numbers, or whose slot nobody holds, is dropped; anything else is no batch at all. */
export function unpackPoses(msg: unknown, goAt: number, idOfSlot: (slot: number) => string | undefined): [string, number, number, number, number, number, number, number][] {
  const out: [string, number, number, number, number, number, number, number][] = [];
  if (!Array.isArray(msg)) return out;
  for (const e of msg) {
    if (!Array.isArray(e) || e.length !== 8 || !e.every(n => typeof n === 'number' && Number.isFinite(n))) continue;
    const id = idOfSlot(e[0]);
    if (!id) continue;
    const [, dt, x, z, h, v, s, sc] = e as number[];
    out.push([id, goAt + dt, x, z, h, v, s, sc]);
  }
  return out;
}
