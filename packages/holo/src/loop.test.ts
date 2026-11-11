import { describe, expect, it } from 'vitest';
import { createLoop } from './loop';
import { REST, settled, step } from './spring';
import type { Angles, Spring } from './spring';

/** A frame clock the test drives by hand, in place of requestAnimationFrame. */
function clock() {
  let id = 0, now = 0, asked = 0;
  const queue = new Map<number, (ms: number) => void>();
  return {
    requestFrame: (cb: (ms: number) => void) => { asked++; queue.set(++id, cb); return id; },
    cancelFrame: (handle: number) => { queue.delete(handle); },
    pending: () => queue.size,
    asked: () => asked,
    tick(ms = 1000 / 60) { now += ms; const due = [...queue.values()]; queue.clear(); for (const cb of due) cb(now); },
  };
}

describe('the draw-on-demand loop', () => {
  it('asks for no frame until it is woken', () => {
    const c = clock();
    const loop = createLoop({ ...c, frame: () => false });
    expect(c.pending()).toBe(0);
    expect(loop.running).toBe(false);
    loop.wake();
    expect(c.pending()).toBe(1);
    expect(loop.running).toBe(true);
  });

  it('draws one frame and asks for no more when the frame says it is done', () => {
    const c = clock(); let frames = 0;
    const loop = createLoop({ ...c, frame: () => { frames++; return false; } });
    loop.wake(); c.tick();
    expect(frames).toBe(1);
    expect(c.pending()).toBe(0);
    expect(loop.running).toBe(false);
    c.tick(); c.tick();
    expect(frames).toBe(1);
    expect(c.asked()).toBe(1);
  });

  it('keeps going while the frame asks for more', () => {
    const c = clock(); let frames = 0;
    const loop = createLoop({ ...c, frame: () => ++frames < 4 });
    loop.wake();
    for (let i = 0; i < 10; i++) c.tick();
    expect(frames).toBe(4);
    expect(c.asked()).toBe(4);
    expect(loop.running).toBe(false);
  });

  it('does not stack requests when woken twice', () => {
    const c = clock(); let frames = 0;
    const loop = createLoop({ ...c, frame: () => { frames++; return false; } });
    loop.wake(); loop.wake(); loop.wake();
    expect(c.pending()).toBe(1);
    c.tick();
    expect(frames).toBe(1);
  });

  it('gives the first frame after a wake a sixtieth of a second and later frames the time that really passed', () => {
    const c = clock(); const dts: number[] = [];
    const loop = createLoop({ ...c, frame: (dt) => { dts.push(dt); return dts.length < 3; } });
    loop.wake(); c.tick(500); c.tick(20); c.tick(40);
    expect(dts[0]).toBeCloseTo(1 / 60, 9);
    expect(dts[1]).toBeCloseTo(0.02, 9);
    expect(dts[2]).toBeCloseTo(0.04, 9);
    // asleep for a long while, then woken: the gap is not handed to the frame as one giant step
    c.tick(60000); loop.wake(); c.tick(16);
    expect(dts[3]).toBeCloseTo(1 / 60, 9);
  });

  it('stops when told to, and cancels the frame it had asked for', () => {
    const c = clock(); let frames = 0;
    const loop = createLoop({ ...c, frame: () => { frames++; return true; } });
    loop.wake(); loop.stop();
    expect(c.pending()).toBe(0);
    expect(loop.running).toBe(false);
    c.tick(); c.tick();
    expect(frames).toBe(0);
    loop.stop();
  });

  it('runs again after a later wake', () => {
    const c = clock(); let frames = 0;
    const loop = createLoop({ ...c, frame: () => { frames++; return false; } });
    loop.wake(); c.tick(); loop.wake(); c.tick();
    expect(frames).toBe(2);
  });

  it('asks for exactly one more frame when woken from inside a frame', () => {
    const c = clock(); let frames = 0;
    const loop = createLoop({ ...c, frame: () => { frames++; if (frames === 1) loop.wake(); return false; } });
    loop.wake(); c.tick();
    expect(c.pending()).toBe(1);
    c.tick(); c.tick();
    expect(frames).toBe(2);
    expect(c.pending()).toBe(0);
  });

  it('is left stopped, not stuck, by a frame that throws', () => {
    const c = clock(); let frames = 0;
    const loop = createLoop({ ...c, frame: () => { frames++; if (frames === 1) throw new Error('lost'); return false; } });
    loop.wake();
    expect(() => c.tick()).toThrow('lost');
    expect(loop.running).toBe(false);
    expect(c.pending()).toBe(0);
    loop.wake(); c.tick();
    expect(frames).toBe(2);
  });

  it('goes back to flat and falls silent when a gesture is taken away', () => {
    // the pointer holds the card at full tilt, then the browser cancels the gesture: the target returns to zero
    const c = clock();
    let spring: Spring = REST, target: Angles = { x: 0.28, y: 0.28 };
    const loop = createLoop({ ...c, frame: (dt) => { spring = step(spring, target, dt); return !settled(spring, target); } });
    loop.wake();
    for (let i = 0; i < 40; i++) c.tick();
    expect(loop.running).toBe(true);
    target = { x: 0, y: 0 }; loop.wake();
    for (let i = 0; i < 240; i++) c.tick();
    expect(spring).toEqual(REST);
    expect(loop.running).toBe(false);
    expect(c.pending()).toBe(0);
    const asked = c.asked();
    for (let i = 0; i < 60; i++) c.tick();
    expect(c.asked()).toBe(asked);
  });
});
