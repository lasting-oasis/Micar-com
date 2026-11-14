import { describe, expect, it } from 'vitest';
import { packPoses, unpackPoses } from './racePoses';

const goAt = 1_794_641_786_000;
const ids: Record<number, string> = { 0: 'aaaaaaaaaaaaaaaaaaaa', 3: 'bbbbbbbbbbbbbbbbbbbb', 15: 'cccccccccccccccccccc' };
const idOfSlot = (slot: number) => ids[slot];

describe('poses in one message a tick', () => {
  it('a batch is the race_pose shape again after a round trip', () => {
    const batch = packPoses(goAt, [
      { slot: 3, pose: [goAt + 12_345.4, 16101.7234, 8161.1191, 0.41837, 19.2311, 165.3829, 0] },
      { slot: 15, pose: [goAt + 12_400, 1, 2, 0.5, 30, 100, 7] },
    ]);
    expect(batch).toEqual([[3, 12_345, 16101.72, 8161.12, 0.418, 19.23, 165.38, 0], [15, 12_400, 1, 2, 0.5, 30, 100, 7]]);
    expect(unpackPoses(batch, goAt, idOfSlot)).toEqual([
      [ids[3], goAt + 12_345, 16101.72, 8161.12, 0.418, 19.23, 165.38, 0],
      [ids[15], goAt + 12_400, 1, 2, 0.5, 30, 100, 7],
    ]);
  });
  it('a batch of fifteen rounded poses is about half what fifteen single messages cost', () => {
    const poses = Array.from({ length: 15 }, (_, k) => ({ slot: k, pose: [goAt + 123_456.7, 16101.7234 + k, -8161.1191 - k, 2.41837, 59.2311, 6165.3829, 0] }));
    const batch = '42' + JSON.stringify(['race_poses', packPoses(goAt, poses)]);
    expect(batch.length).toBeLessThanOrEqual(15 * 52 + 32);
    const one = ('42' + JSON.stringify(['race_pose', ['4tp2k6p2vigOE3cXAAAG', goAt + 123_457, 16101.72, -8161.12, 2.418, 59.23, 6165.38, 0]])).length + 2;
    const singles = one * poses.length; // fifteen rounded single messages, each with its 2-byte header
    expect(batch.length + 4).toBeLessThan(singles * 0.6); // header and all
  });
  it('junk in a batch is dropped and the rest kept; a slot nobody holds is dropped', () => {
    const good = [3, 10, 1, 2, 0.5, 30, 100, 0];
    for (const junk of [null, 'x', 42, {}, [[3, 10, 1]], [[3, 10, 1, 2, 0.5, 30, 100, 0, 9]], [['3', 10, 1, 2, 0.5, 30, 100, 0]], [[3, NaN, 1, 2, 0.5, 30, 100, 0]], [[3, 10, 1, 2, Infinity, 30, 100, 0]]])
      expect(unpackPoses(junk, goAt, idOfSlot)).toEqual([]);
    expect(unpackPoses([good, [3, 10, 'x', 2, 0.5, 30, 100, 0], [7, 10, 1, 2, 0.5, 30, 100, 0], [15, 11, 1, 2, 0.5, 30, 100, 0]], goAt, idOfSlot))
      .toEqual([[ids[3], goAt + 10, 1, 2, 0.5, 30, 100, 0], [ids[15], goAt + 11, 1, 2, 0.5, 30, 100, 0]]);
  });
});
