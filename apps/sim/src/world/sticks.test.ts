import { afterEach, describe, expect, it } from 'vitest';
import { DEAD, FingerSlot, laneEdge, onSticksReleased, releaseSticks, setSteerStick, shapeAxis, stickToInput, touchSticks } from './sticks';

afterEach(releaseSticks);

describe('stick feel', () => {
  it('nothing inside the dead zone, full travel at the edge, gentle in between', () => {
    expect(shapeAxis(0)).toBe(0);
    expect(shapeAxis(DEAD)).toBe(0);
    expect(shapeAxis(-DEAD * .9)).toBe(0);
    expect(shapeAxis(1, DEAD, 1.8)).toBe(1);
    expect(shapeAxis(-1, DEAD, 1.8)).toBe(-1);
    expect(shapeAxis(2, DEAD, 1.8)).toBe(1);
    const half = shapeAxis(.5, DEAD, 1.8);
    expect(half).toBeGreaterThan(0);
    expect(half).toBeLessThan((.5 - DEAD) / (1 - DEAD)); // below a straight line: less twitchy
    expect(shapeAxis(-.5, DEAD, 1.8)).toBeCloseTo(-half, 12);
    expect(shapeAxis(NaN)).toBe(0);
  });
  it('the gas stick: up is gas, down is brake (then reverse); sideways is not its business', () => {
    expect(stickToInput(0, 1)).toEqual({ steer: 0, fwd: 1, back: 0 });
    expect(stickToInput(0, -1)).toEqual({ steer: 0, fwd: 0, back: 1 });
    expect(stickToInput(0, .05)).toEqual({ steer: 0, fwd: 0, back: 0 });
    expect(stickToInput(-1, 0).steer).toBe(-1);
  });
});

describe('drag lane changes from the steering stick', () => {
  it('a flick fires once, and only again after coming back near the middle', () => {
    let s = laneEdge(.7, true); expect(s).toEqual({ laneL: false, laneR: true, armed: false });
    s = laneEdge(.9, s.armed); expect(s.laneR).toBe(false);
    s = laneEdge(.4, s.armed); expect(s.armed).toBe(false);
    s = laneEdge(.2, s.armed); expect(s.armed).toBe(true);
    s = laneEdge(-.8, s.armed); expect(s).toEqual({ laneL: true, laneR: false, armed: false });
  });
  it('setSteerStick leaves the edges for InputMap to take', () => {
    setSteerStick(.8); setSteerStick(1);
    expect(touchSticks.laneR).toBe(true);
    touchSticks.laneR = false; setSteerStick(.9);
    expect(touchSticks.laneR).toBe(false);
  });
});

describe('a stick never stays held', () => {
  it('a new finger takes the stick even if the last one never reported lifting', () => {
    const f = new FingerSlot();
    f.down(1);
    f.down(2); // finger 1's lift was never seen
    expect(f.owns(2)).toBe(true);
    expect(f.up(1)).toBe(false); // a late lift of the old finger does not let go of the new one
    expect(f.owns(2)).toBe(true);
    expect(f.up(2)).toBe(true);
    expect(f.owns(2)).toBe(false);
    expect(f.clear()).toBe(false);
    f.down(3); expect(f.clear()).toBe(true); expect(f.id).toBeNull();
  });
  it('releasing the input (pause, the tab hidden) tells every stick on screen to let go', () => {
    let told = 0;
    const off = onSticksReleased(() => { told++; });
    setSteerStick(1); touchSticks.gasY = 1;
    releaseSticks();
    expect(told).toBe(1);
    expect(touchSticks.steerX).toBe(0);
    off(); releaseSticks();
    expect(told).toBe(1);
  });
});
