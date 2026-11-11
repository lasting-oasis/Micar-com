import { describe, expect, it } from 'vitest';
import { InputMap } from './input';
import { DRIFT_KICK_STEPS, releaseSticks, setSteerStick, touchSticks } from './sticks';
import { afterEach } from 'vitest';

describe('InputMap', () => {
  it('builds an input from held keys and edges', () => {
    const im = new InputMap({ manual: () => true, hydraulics: () => false });
    im.keys.fwd = true; im.keys.left = true; im.edge.shiftUp = true;
    const I = im.build();
    expect(I.fwd).toBe(1); expect(I.steer).toBe(-1); expect(I.manual).toBe(true); expect(I.shiftUp).toBe(true);
    im.clearEdges();
    expect(im.build().shiftUp).toBe(false);
  });

  it('touch buttons drive, and gear buttons raise edges instead of holding', () => {
    const im = new InputMap({ manual: () => false, hydraulics: () => false });
    im.setTouch('thr', true); im.setTouch('right', true); im.setTouch('up', true);
    const I = im.build();
    expect(I.fwd).toBe(1); expect(I.steer).toBe(1); expect(I.shiftUp).toBe(true); expect(im.touch.up).toBeUndefined();
    im.setTouch('thr', false);
    expect(im.build().fwd).toBe(0);
  });

  it('gas and a steer button held together drive a turning car; gear presses are edges; releaseAll lets go', () => {
    const im = new InputMap({ manual: () => true, hydraulics: () => false });
    im.setTouch('thr', true); im.setTouch('left', true);
    const I = im.build();
    expect(I.fwd).toBe(1); expect(I.steer).toBe(-1);
    im.clearEdges(); expect(im.build().shiftUp).toBe(false); im.setTouch('up', true); expect(im.build().shiftUp).toBe(true);
    im.clearEdges(); im.setTouch('up', false); im.setTouch('up', true); expect(im.build().shiftUp).toBe(true);
    im.setTouch('brk', true); expect(im.build().back).toBe(1); im.setTouch('brk', false); expect(im.build().back).toBe(0);
    im.releaseAll(); expect(im.touch.thr).toBe(false); expect(im.build().fwd).toBe(0);
  });

  it('a finger slid from one steer button to the other switches the steer, and slid off any button lets go', () => {
    const im = new InputMap({ manual: () => false, hydraulics: () => false });
    im.pointerDown(1, 'left'); expect(im.build().steer).toBe(-1); expect(im.edge.laneL).toBe(true);
    im.pointerMove(1, 'right'); expect(im.build().steer).toBe(1); expect(im.edge.laneR).toBe(true);
    im.pointerMove(1, 'right'); expect(im.build().steer).toBe(1);
    im.pointerMove(1, null); expect(im.build().steer).toBe(0); expect(im.touch.right).toBe(false);
    im.pointerMove(1, 'left'); expect(im.build().steer).toBe(-1); // back onto a button while still down
    im.pointerUp(1); expect(im.build().steer).toBe(0);
    im.pointerMove(1, 'right'); expect(im.build().steer).toBe(0); // a finger that is up presses nothing
  });

  it('two fingers are separate: lifting one never lets go of the other, even on the same button', () => {
    const im = new InputMap({ manual: () => false, hydraulics: () => false });
    im.pointerDown(1, 'thr'); im.pointerDown(2, 'left');
    expect(im.build()).toMatchObject({ fwd: 1, steer: -1 });
    im.pointerUp(2); expect(im.build()).toMatchObject({ fwd: 1, steer: 0 });
    im.pointerDown(3, 'thr'); im.pointerUp(1); expect(im.build().fwd).toBe(1); // finger 3 still holds the gas
    im.pointerUp(3); expect(im.build().fwd).toBe(0);
  });

  it('a gear button fires once per tap and never by sliding onto it; releaseAll forgets every finger', () => {
    const im = new InputMap({ manual: () => true, hydraulics: () => false });
    im.pointerDown(1, 'up'); expect(im.edge.shiftUp).toBe(true); im.clearEdges();
    im.pointerMove(1, 'up'); expect(im.edge.shiftUp).toBe(false);
    im.pointerDown(2, 'thr'); im.pointerMove(2, 'dn'); expect(im.edge.shiftDn).toBe(false); expect(im.build().fwd).toBe(0);
    im.pointerDown(3, 'brk'); im.releaseAll(); expect(im.build().back).toBe(0);
    im.pointerMove(3, 'left'); expect(im.build().steer).toBe(0); // the forgotten finger presses nothing until it is lifted and put down again
  });

  it('hydraulics take the arrows off the car and hop needs the kit', () => {
    let kit = true;
    const im = new InputMap({ manual: () => false, hydraulics: () => kit });
    im.keys.hyd = true; im.keys.fwd = true; im.edge.hop = true;
    let I = im.build();
    expect(I.fwd).toBe(0); expect(I.hyd).toBe(true); expect(I.hydF).toBe(true); expect(I.hop).toBe(true);
    kit = false; I = im.build();
    expect(I.fwd).toBe(1); expect(I.hyd).toBe(false); expect(I.hop).toBe(false);
  });

  it('keyboard events map through Night Tuner keys and raise edges once per press', () => {
    const im = new InputMap({ manual: () => true, hydraulics: () => false });
    const ev = (code: string, repeat = false) => ({ code, repeat, preventDefault() {} }) as unknown as KeyboardEvent;
    im.onKeyDown(ev('ShiftLeft')); im.onKeyDown(ev('ShiftLeft', true));
    expect(im.keys.shiftK).toBe(true); expect(im.edge.shiftUp).toBe(true);
    im.clearEdges(); im.onKeyDown(ev('ShiftLeft', true));
    expect(im.edge.shiftUp).toBe(false);
    im.onKeyDown(ev('KeyC')); im.onKeyDown(ev('KeyR')); im.onKeyDown(ev('Enter')); im.onKeyDown(ev('KeyM'));
    expect(im.edge.camera && im.edge.reset && im.edge.enter && im.edge.map).toBe(true);
    im.onKeyDown(ev('KeyB'));
    expect(im.keys.look).toBe(true);
    im.onKeyUp(ev('KeyB'));
    expect(im.keys.look).toBe(false);
  });

  describe('the phone sticks', () => {
    afterEach(releaseSticks);
    it('drive the same input as the buttons, with the gas stick braking then reversing when pulled', () => {
      const im = new InputMap({ manual: () => false, hydraulics: () => false });
      setSteerStick(-1); touchSticks.gasY = 1;
      expect(im.build()).toMatchObject({ steer: -1, fwd: 1, back: 0 });
      touchSticks.gasY = -1; expect(im.build()).toMatchObject({ fwd: 0, back: 1 });
      setSteerStick(0); touchSticks.gasY = 0; expect(im.build()).toMatchObject({ steer: 0, fwd: 0, back: 0 });
    });
    it('a key still wins over a stick that is barely moved', () => {
      const im = new InputMap({ manual: () => false, hydraulics: () => false });
      im.keys.right = true; setSteerStick(-.3);
      expect(im.build().steer).toBe(1);
    });
    it('pressing Drift pulls the hand brake for 0.3 s, holding it keeps drift mode, NOS is held', () => {
      const im = new InputMap({ manual: () => false, hydraulics: () => false });
      touchSticks.drift = true; touchSticks.nos = true;
      let hb = 0; for (let i = 0; i < DRIFT_KICK_STEPS + 10; i++) { const I = im.build(); if (I.hb) hb++; expect(I.nos).toBe(true); }
      expect(hb).toBe(DRIFT_KICK_STEPS);
      expect(im.driftHeld()).toBe(true);
      touchSticks.drift = false; im.build(); touchSticks.drift = true;
      expect(im.build().hb).toBe(true); // a fresh press pulls it again
    });
    it('a flick of the steering stick changes a drag lane once; releaseAll lets go of everything', () => {
      const im = new InputMap({ manual: () => false, hydraulics: () => false });
      touchSticks.shiftUp = true; expect(im.build().shiftUp).toBe(true); expect(touchSticks.shiftUp).toBe(false);
      im.clearEdges(); expect(im.build().shiftUp).toBe(false);
      setSteerStick(.9); im.build(); expect(im.edge.laneR).toBe(true);
      im.clearEdges(); setSteerStick(1); im.build(); expect(im.edge.laneR).toBe(false);
      touchSticks.gasY = 1; touchSticks.drift = true; im.releaseAll();
      expect(im.build()).toMatchObject({ steer: 0, fwd: 0, hb: false });
      expect(im.driftHeld()).toBe(false);
    });
  });
});
