// Driving input: keyboard, touch buttons and gamepad, ported from Night Tuner 09-main.js
// (KM, buildInput, the keydown/keyup handlers, the .tb touch buttons, padNav's driving edges).
// The InputMap only reports held keys and one-shot edges; what an edge does (respawn, start an
// event, open the map, cycle the camera...) is the main scene's job. The scene reads `build()` per
// physics step and calls `clearEdges()` after the step that consumed them (Night Tuner cleared
// shiftUp/shiftDn/hop after each 1/120 s step); the other edges it reads once per frame and clears too.
import { NO_INPUT, type Input } from './physics';

/** Night Tuner's KM: physical key -> held control */
export const KM: Readonly<Record<string, string>> = {
  ArrowUp: 'fwd', KeyW: 'fwd', ArrowDown: 'back', KeyS: 'back', ArrowLeft: 'left', KeyA: 'left', ArrowRight: 'right', KeyD: 'right',
  AltLeft: 'nos', AltRight: 'nos', Space: 'hb', KeyH: 'hyd', KeyB: 'look',
  ShiftLeft: 'shiftK', ShiftRight: 'shiftK', ControlLeft: 'ctrlK', ControlRight: 'ctrlK', KeyG: 'lights',
};

/** one-shot keys (not held): code -> edge */
const EDGE_KEYS: Readonly<Record<string, keyof Edges>> = {
  KeyC: 'camera', KeyR: 'reset', KeyJ: 'hop', KeyN: 'horn', KeyX: 'drift', Enter: 'enter', KeyM: 'map', Escape: 'pause', KeyP: 'pause',
};

export type Edges = {
  /** gear up (Shift, RB, ▲ GEAR) / gear down (Ctrl, LB, ▼ GEAR) */
  shiftUp: boolean; shiftDn: boolean;
  /** hydraulic hop (J); `build()` only passes it on when the car has the kit */
  hop: boolean;
  /** R: respawn on the road / the event route */
  reset: boolean;
  /** Enter / pad A: start the event or outrun you are parked at */
  enter: boolean;
  /** M / pad Back: toggle the map */
  map: boolean;
  /** C / pad Y: cycle the camera */
  camera: boolean;
  /** B pressed (hold state is keys.look; the camera's lookBack should follow keys.look) */
  lookBack: boolean;
  /** G pressed (hold state is keys.lights: Night Tuner toggled on a tap under 0.35 s and went to high beams on a longer hold) */
  lights: boolean;
  /** N: horn */
  horn: boolean;
  /** X: toggle free-roam drift mode */
  drift: boolean;
  /** Escape / P / pad Start */
  pause: boolean;
  /** a fresh left / right press (keys, touch or pad d-pad): drag lane change */
  laneL: boolean; laneR: boolean;
};

const freshEdges = (): Edges => ({ shiftUp: false, shiftDn: false, hop: false, reset: false, enter: false, map: false, camera: false, lookBack: false, lights: false, horn: false, drift: false, pause: false, laneL: false, laneR: false });

type Pad = { connected: boolean; axes: readonly number[]; buttons: readonly { pressed: boolean; value: number }[] };
function pad(): Pad | null {
  try {
    const nav = typeof navigator !== 'undefined' ? navigator as Navigator & { getGamepads?: () => (Pad | null)[] } : null;
    const ps = nav && nav.getGamepads ? nav.getGamepads() : [];
    for (const p of ps) if (p && p.connected) return p;
  } catch { /* no gamepads */ }
  return null;
}

const typingTarget = (t: EventTarget | null): boolean => {
  const el = t as HTMLElement | null;
  if (!el || typeof el.tagName !== 'string') return false;
  return el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || !!el.isContentEditable;
};

export class InputMap {
  /** held controls by KM name (fwd, back, left, right, nos, hb, hyd, look, shiftK, ctrlK, lights) */
  keys: Record<string, boolean> = {};
  /** held touch buttons by data-k (left, right, thr, brk, nos, hb) */
  touch: Record<string, boolean> = {};
  edge: Edges = freshEdges();

  private readonly out: Input = { ...NO_INPUT };
  private readonly gpPrev: Record<number, boolean> = {};
  private win: Window | null = null;
  private buttons: { b: HTMLElement; down: (e: PointerEvent) => void; up: () => void }[] = [];

  constructor(private readonly opts: { manual: () => boolean; hydraulics: () => boolean }) {}

  /** Listen for keys on the element's window, and wire any `[data-k]` touch buttons inside `el`. */
  attach(el: HTMLElement): void {
    this.detach();
    this.win = el.ownerDocument?.defaultView ?? null;
    if (this.win) { this.win.addEventListener('keydown', this.onKeyDown); this.win.addEventListener('keyup', this.onKeyUp); this.win.addEventListener('blur', this.releaseAll); }
    el.querySelectorAll<HTMLElement>('[data-k]').forEach(b => {
      const k = b.dataset.k as string;
      const down = (e: PointerEvent) => { e.preventDefault(); try { b.setPointerCapture(e.pointerId); } catch { /* not capturable */ } this.setTouch(k, true); b.classList.toggle('on', k !== 'up' && k !== 'dn'); };
      const up = () => { this.setTouch(k, false); b.classList.remove('on'); };
      b.addEventListener('pointerdown', down);
      for (const n of ['pointerup', 'pointercancel', 'lostpointercapture']) b.addEventListener(n, up);
      this.buttons.push({ b, down, up });
    });
  }

  detach(): void {
    if (this.win) { this.win.removeEventListener('keydown', this.onKeyDown); this.win.removeEventListener('keyup', this.onKeyUp); this.win.removeEventListener('blur', this.releaseAll); }
    for (const { b, down, up } of this.buttons) { b.removeEventListener('pointerdown', down); for (const n of ['pointerup', 'pointercancel', 'lostpointercapture']) b.removeEventListener(n, up); }
    this.buttons = []; this.win = null;
    this.releaseAll();
  }

  /** A touch button changed: `up` / `dn` raise gear edges on press, the rest are held. */
  setTouch(k: string, on: boolean): void {
    if (k === 'up') { if (on) this.edge.shiftUp = true; return; }
    if (k === 'dn') { if (on) this.edge.shiftDn = true; return; }
    if (on && !this.touch[k]) { if (k === 'left') this.edge.laneL = true; if (k === 'right') this.edge.laneR = true; }
    this.touch[k] = on;
  }

  clearEdges(): void { const e = this.edge; e.shiftUp = e.shiftDn = e.hop = e.reset = e.enter = e.map = e.camera = e.lookBack = e.lights = e.horn = e.drift = e.pause = e.laneL = e.laneR = false; }

  /** Release every held key and button (blur, pause). */
  readonly releaseAll = (): void => { for (const k in this.keys) this.keys[k] = false; for (const k in this.touch) this.touch[k] = false; };

  readonly onKeyDown = (e: KeyboardEvent): void => {
    if (typingTarget(e.target)) return;
    const k = KM[e.code];
    if (k) {
      if (!this.keys[k]) {
        this.keys[k] = true;
        if (k === 'shiftK') this.edge.shiftUp = true;
        if (k === 'ctrlK') this.edge.shiftDn = true;
        if (k === 'left') this.edge.laneL = true;
        if (k === 'right') this.edge.laneR = true;
        if (k === 'look') this.edge.lookBack = true;
        if (k === 'lights') this.edge.lights = true;
      }
      e.preventDefault(); return;
    }
    if (e.repeat) return;
    const ed = EDGE_KEYS[e.code];
    if (!ed) return;
    this.edge[ed] = true; e.preventDefault();
  };

  readonly onKeyUp = (e: KeyboardEvent): void => {
    const k = KM[e.code];
    if (k) this.keys[k] = false;
  };

  /** Read the gamepad's one-shot buttons once per frame (Night Tuner's padNav, driving part):
   *  Y camera, RB/LB gears, Back map, A enter, Start pause, d-pad left/right lanes. */
  poll(): void {
    const gp = pad(); if (!gp) return;
    const E = this.edge;
    if (this.padEdge(gp, 3)) E.camera = true;
    if (this.padEdge(gp, 5)) E.shiftUp = true;
    if (this.padEdge(gp, 4)) E.shiftDn = true;
    if (this.padEdge(gp, 8)) E.map = true;
    if (this.padEdge(gp, 0)) E.enter = true;
    if (this.padEdge(gp, 9)) E.pause = true;
    if (this.padEdge(gp, 14)) E.laneL = true;
    if (this.padEdge(gp, 15)) E.laneR = true;
  }
  private padEdge(gp: Pad, i: number): boolean { const p = !!(gp.buttons[i] && gp.buttons[i].pressed), was = !!this.gpPrev[i]; this.gpPrev[i] = p; return p && !was; }

  /** Night Tuner's buildInput. Returns one reused object: copy it if you keep it past the step. */
  build(): Input {
    const I = Object.assign(this.out, NO_INPUT), K = this.keys, T = this.touch, kit = this.opts.hydraulics();
    const hyd = !!(K.hyd && kit);
    I.fwd = (K.fwd && !hyd) || T.thr ? 1 : 0; I.back = (K.back && !hyd) || T.brk ? 1 : 0;
    I.steer = (((K.right && !hyd) || T.right) ? 1 : 0) - (((K.left && !hyd) || T.left) ? 1 : 0);
    I.nos = !!(K.nos || T.nos); I.hb = !!(K.hb || T.hb); I.manual = !!this.opts.manual();
    I.hyd = hyd; I.hydF = !!K.fwd; I.hydR = !!K.back; I.hydL = !!K.left; I.hydRt = !!K.right;
    I.shiftUp = this.edge.shiftUp; I.shiftDn = this.edge.shiftDn; I.hop = this.edge.hop && kit;
    const gp = pad();
    if (gp) {
      const ax = gp.axes[0] || 0; if (Math.abs(ax) > .15) I.steer = Math.sign(ax) * Math.min(1, (Math.abs(ax) - .15) / .85);
      const rt = gp.buttons[7] ? gp.buttons[7].value : 0, lt = gp.buttons[6] ? gp.buttons[6].value : 0;
      if (rt > .05) I.fwd = Math.max(I.fwd, rt); if (lt > .05) I.back = Math.max(I.back, lt);
      if (gp.buttons[0] && gp.buttons[0].pressed) I.nos = true; if (gp.buttons[2] && gp.buttons[2].pressed) I.hb = true;
      if (gp.buttons[14] && gp.buttons[14].pressed) I.steer = -1; if (gp.buttons[15] && gp.buttons[15].pressed) I.steer = 1;
    }
    return I;
  }
}
