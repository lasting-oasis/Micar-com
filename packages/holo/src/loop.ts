// The draw-on-demand loop. The card is drawn only while something is moving: wake() asks for a frame, each frame
// says whether another is needed, and when one says no the loop falls silent until the next wake. The frame source
// is passed in (requestAnimationFrame in a browser, a hand-driven clock in a test).
export type Loop = {
  /** Something changed: draw. Asks for a frame unless one is already on its way. */
  wake(): void;
  /** Stop now and cancel the frame that was asked for. */
  stop(): void;
  readonly running: boolean;
};

export type LoopOptions = {
  requestFrame: (callback: (timeMs: number) => void) => number;
  cancelFrame: (handle: number) => void;
  /** Draw one frame `dt` seconds after the last. Return true while more frames are needed. */
  frame: (dt: number) => boolean;
};

export function createLoop(options: LoopOptions): Loop {
  let pending: number | null = null;
  let last: number | null = null;
  let running = false;
  let inFrame = false;
  let wokenInFrame = false;

  function tick(timeMs: number): void {
    pending = null;
    // The first frame after a sleep has no "last frame" to measure from: give it one sixtieth of a second, not the
    // whole time the loop was asleep.
    const dt = last === null ? 1 / 60 : Math.max(0, (timeMs - last) / 1000);
    last = timeMs;
    let more = false;
    inFrame = true; wokenInFrame = false;
    try {
      more = options.frame(dt);
    } catch (error) {
      running = false; last = null;
      throw error;
    } finally {
      inFrame = false;
    }
    if (running && (more || wokenInFrame)) pending = options.requestFrame(tick);
    else { running = false; last = null; }
  }

  return {
    wake() {
      if (inFrame) { wokenInFrame = true; return; }
      if (pending !== null) return;
      running = true;
      pending = options.requestFrame(tick);
    },
    stop() {
      if (pending !== null) options.cancelFrame(pending);
      pending = null; running = false; last = null; wokenInFrame = false;
    },
    get running() { return running; },
  };
}
