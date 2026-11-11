import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createHoloCard, webglAvailable } from './card';
import type { HoloCardOptions } from './card';
import { pose } from './scene';
import { MAX_TILT, tiltTarget } from './tilt';

// There is no WebGL in vitest, so the card is run against a stand-in for the browser: a canvas, a GL context that
// records what it is sent, a frame clock driven by hand, fetch and Image. What is pinned is what the card does to
// them: when it draws, when it stops, what it listens to and what it lets go of. What the picture looks like is
// the browser smoke test's business (apps/value/e2e/card-back.smoke.mjs).

const model = readFileSync(new URL('../../../apps/value/public/cards/card.glb', import.meta.url));
const RECT = { left: 0, top: 0, width: 300, height: 400 };
const IDENTITY = [1, 0, 0, 0, 1, 0, 0, 0, 1];

type Listener = (event: unknown) => void;
function listeners() {
  const map = new Map<string, Set<Listener>>();
  return {
    addEventListener(type: string, fn: Listener) {
      const set = map.get(type) ?? new Set<Listener>();
      map.set(type, set);
      set.add(fn);
    },
    removeEventListener(type: string, fn: Listener) { map.get(type)?.delete(fn); },
    fire(type: string, event: unknown = {}) { for (const fn of [...(map.get(type) ?? [])]) fn(event); },
    count: () => [...map.values()].reduce((n, set) => n + set.size, 0),
  };
}

type WorldOptions = {
  /** The kinds of context the canvas can give. Both, unless said. */
  contexts?: string[];
  /** What the server answers for the model. */
  status?: number;
  /** The bytes it answers with. The committed model, unless said. */
  body?: Uint8Array;
  /** Which artwork the browser can decode. All of it, unless said. */
  decodes?: (src: string) => boolean;
  ratio?: number;
  compiles?: boolean;
  links?: boolean;
  log?: string;
  lost?: boolean;
};

function world(options: WorldOptions = {}) {
  const canvasEvents = listeners(), documentEvents = listeners(), windowEvents = listeners();
  const calls: { name: string; args: unknown[] }[] = [];
  const sent: Record<string, unknown> = {};          // the last value sent to each uniform, by name
  const gpu = { lost: options.lost ?? false, compiles: options.compiles ?? true, links: options.links ?? true };
  const count = (name: string): number => calls.filter((call) => call.name === name).length;

  const canvas = {
    width: 300, height: 150, clientWidth: 300, clientHeight: 400,
    style: {} as Record<string, string>,
    ...canvasEvents,
    getContext: vi.fn((kind: string) => ((options.contexts ?? ['webgl2', 'webgl']).includes(kind) ? gl : null)),
    getBoundingClientRect: () => RECT,
    setPointerCapture: vi.fn(),
    releasePointerCapture: vi.fn(),
  };

  const answers: Record<string, (...args: unknown[]) => unknown> = {
    createShader: () => ({}), createProgram: () => ({}), createBuffer: () => ({}), createTexture: () => ({}),
    getShaderParameter: () => gpu.compiles, getProgramParameter: () => gpu.links,
    getShaderInfoLog: () => options.log ?? '', getProgramInfoLog: () => options.log ?? '',
    getUniformLocation: (_program, name) => ({ name }),
    getAttribLocation: (_program, name) => ['aPosition', 'aNormal', 'aUv', 'aCorner'].indexOf(name as string),
    getParameter: () => 4096,
    isContextLost: () => gpu.lost,
    getExtension: (name) => (name === 'WEBGL_lose_context' ? { loseContext: () => { calls.push({ name: 'loseContext', args: [] }); gpu.lost = true; } } : null),
  };
  // Every constant is its own name (gl.TRIANGLES is 'TRIANGLES'), every function records its call.
  const gl: unknown = new Proxy({}, {
    get(_target, key) {
      if (typeof key !== 'string' || key === 'then') return undefined;
      if (key === 'drawingBufferWidth') return canvas.width;
      if (key === 'drawingBufferHeight') return canvas.height;
      if (/^[A-Z][A-Z0-9_]*$/.test(key)) return key;
      return (...args: unknown[]) => {
        calls.push({ name: key, args });
        if (key.startsWith('uniform')) sent[(args[0] as { name: string }).name] = key.includes('Matrix') ? args[2] : args.slice(1);
        return answers[key]?.(...args);
      };
    },
  });

  // the frame clock
  let now = 0, handle = 0;
  const queue = new Map<number, (ms: number) => void>();
  const frames = {
    pending: () => queue.size,
    run(n = 1) {
      for (let i = 0; i < n; i++) {
        now += 1000 / 60;
        const due = [...queue.values()];
        queue.clear();
        for (const callback of due) callback(now);
      }
    },
    /** Runs frames until none is asked for. Says how many ran. */
    untilIdle() {
      let ran = 0;
      while (queue.size > 0 && ran < 2000) { frames.run(); ran += 1; }
      return ran;
    },
  };
  vi.stubGlobal('requestAnimationFrame', (callback: (ms: number) => void) => { queue.set(++handle, callback); return handle; });
  vi.stubGlobal('cancelAnimationFrame', (h: number) => { queue.delete(h); });

  const status = options.status ?? 200;
  const body = options.body ?? model;
  const fetched: string[] = [];
  vi.stubGlobal('fetch', async (url: string) => {
    fetched.push(url);
    const copy = new Uint8Array(body.byteLength);
    copy.set(body);
    return { ok: status >= 200 && status < 300, status, arrayBuffer: async () => copy.buffer };
  });

  const images: { src: string }[] = [];
  const decodes = options.decodes ?? (() => true);
  vi.stubGlobal('Image', class {
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    crossOrigin = '';
    decoding = '';
    width = 1062;
    height = 1481;
    naturalWidth = 1062;
    naturalHeight = 1481;
    address = '';
    get src() { return this.address; }
    set src(value: string) {
      this.address = value;
      images.push(this);
      queueMicrotask(() => (decodes(value) ? this.onload?.() : this.onerror?.()));
    }
  });

  const observers: { trigger(): void; connected: boolean }[] = [];
  vi.stubGlobal('ResizeObserver', class {
    connected = false;
    callback: () => void;
    constructor(callback: () => void) { this.callback = callback; observers.push(this); }
    observe() { this.connected = true; }
    disconnect() { this.connected = false; }
    trigger() { if (this.connected) this.callback(); }
  });

  const page = { ...documentEvents, visibilityState: 'visible' };
  vi.stubGlobal('document', page);
  vi.stubGlobal('window', windowEvents);
  vi.stubGlobal('devicePixelRatio', options.ratio ?? 1);

  return { canvas, canvasEvents, documentEvents, windowEvents, page, calls, count, sent, gpu, frames, fetched, images, observers };
}

/** Lets everything that is waiting on a promise run. */
const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

async function started(options: WorldOptions = {}, card: Partial<HoloCardOptions> = {}) {
  const w = world(options);
  const errors: Error[] = [];
  const handle = createHoloCard({
    canvas: w.canvas as unknown as HTMLCanvasElement,
    meshUrl: '/cards/card.glb', artUrls: ['/cards/back.avif', '/cards/back.webp'], foil: 'holo',
    onError: (error) => errors.push(error),
    ...card,
  });
  await settle();
  return { ...w, card: handle, errors };
}

/** Started, with its first frame drawn. */
async function resting(options: WorldOptions = {}, card: Partial<HoloCardOptions> = {}) {
  const w = await started(options, card);
  w.frames.untilIdle();
  await w.card.ready;
  return w;
}

const mouse = (clientX: number, clientY: number) => ({ pointerId: 1, pointerType: 'mouse', clientX, clientY });
const finger = (clientX: number, clientY: number, pointerId = 7) => ({ pointerId, pointerType: 'touch', clientX, clientY });
const turn = (sent: Record<string, unknown>): number[] => Array.from(sent.uTurn as ArrayLike<number>);
function expectTurn(sent: Record<string, unknown>, expected: number[]): void {
  const actual = turn(sent);
  expect(actual).toHaveLength(9);
  for (let i = 0; i < 9; i++) expect(actual[i]).toBeCloseTo(expected[i], 5);
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('webglAvailable', () => {
  it('says no where there is no document', () => {
    expect(webglAvailable()).toBe(false);
  });

  it('says no where a canvas gives no context', async () => {
    vi.resetModules();
    const fresh = await import('./card.ts');
    vi.stubGlobal('document', { createElement: () => ({ getContext: () => null }) });
    expect(fresh.webglAvailable()).toBe(false);
  });

  it('says yes where a canvas gives one, hands the trial context back, and asks only once', async () => {
    vi.resetModules();
    const fresh = await import('./card.ts');
    const w = world();
    const createElement = vi.fn(() => w.canvas);
    vi.stubGlobal('document', { createElement });
    expect(fresh.webglAvailable()).toBe(true);
    expect(w.count('loseContext')).toBe(1);
    expect(fresh.webglAvailable()).toBe(true);
    expect(createElement).toHaveBeenCalledTimes(1);
  });
});

describe('starting', () => {
  it('draws one frame when it is ready, and asks for no more', async () => {
    const w = await started();
    expect(w.errors).toEqual([]);
    expect(w.frames.pending()).toBe(1);
    expect(w.count('drawElements')).toBe(0);
    w.frames.run();
    expect(w.count('drawElements')).toBe(3);         // the face, the rim, the back
    expect(w.count('drawArrays')).toBe(1);           // the shadow
    expect(w.frames.pending()).toBe(0);
    expectTurn(w.sent, IDENTITY);
  });

  it('resolves ready only once that first frame is drawn', async () => {
    const w = await started();
    let ready = false;
    void w.card.ready.then(() => { ready = true; });
    await settle();
    expect(ready).toBe(false);
    w.frames.run();
    await settle();
    expect(ready).toBe(true);
  });

  it('fetches the model it was given', async () => {
    const w = await started();
    expect(w.fetched).toEqual(['/cards/card.glb']);
  });

  it('asks for WebGL 2 first and settles for WebGL 1', async () => {
    const two = await resting();
    expect(two.canvas.getContext.mock.calls.map((call) => call[0])).toEqual(['webgl2']);
    vi.unstubAllGlobals();
    const one = await resting({ contexts: ['webgl'] });
    expect(one.canvas.getContext.mock.calls.map((call) => call[0])).toEqual(['webgl2', 'webgl']);
    expect(one.errors).toEqual([]);
    expect(one.count('drawElements')).toBe(3);
  });

  it('gives the artwork mipmaps under WebGL 2, and none under WebGL 1 where its size does not allow them', async () => {
    const two = await resting();
    expect(two.count('generateMipmap')).toBe(1);
    vi.unstubAllGlobals();
    const one = await resting({ contexts: ['webgl'] });
    expect(one.count('generateMipmap')).toBe(0);
    const filters = one.calls.filter((call) => call.name === 'texParameteri' && call.args[1] === 'TEXTURE_MIN_FILTER');
    expect(filters.map((call) => call.args[2])).toEqual(['LINEAR']);
  });

  it('uploads the artwork as it is: not flipped, not premultiplied, its colours not converted', async () => {
    const w = await resting();
    const stores = w.calls.filter((call) => call.name === 'pixelStorei').map((call) => call.args);
    expect(stores).toContainEqual(['UNPACK_FLIP_Y_WEBGL', false]);
    expect(stores).toContainEqual(['UNPACK_PREMULTIPLY_ALPHA_WEBGL', false]);
    expect(stores).toContainEqual(['UNPACK_COLORSPACE_CONVERSION_WEBGL', 'NONE']);
    const upload = w.calls.find((call) => call.name === 'texImage2D');
    expect((upload?.args[5] as { src: string }).src).toBe('/cards/back.avif');
  });

  it('uses the first artwork the browser can decode, and asks for no other', async () => {
    const first = await resting();
    expect(first.images.map((image) => image.src)).toEqual(['/cards/back.avif']);
    vi.unstubAllGlobals();
    const second = await resting({ decodes: (src) => src.endsWith('.webp') });
    expect(second.images.map((image) => image.src)).toEqual(['/cards/back.avif', '/cards/back.webp']);
    const upload = second.calls.find((call) => call.name === 'texImage2D');
    expect((upload?.args[5] as { src: string }).src).toBe('/cards/back.webp');
    expect(second.errors).toEqual([]);
  });

  it('sizes its drawing to the canvas at the device\'s pixel ratio, capped at two', async () => {
    const w = await resting({ ratio: 3 });
    expect([w.canvas.width, w.canvas.height]).toEqual([600, 800]);
    const viewports = w.calls.filter((call) => call.name === 'viewport');
    expect(viewports[viewports.length - 1].args).toEqual([0, 0, 600, 800]);
    vi.unstubAllGlobals();
    const capped = await resting({ ratio: 3 }, { maxPixelRatio: 1 });
    expect([capped.canvas.width, capped.canvas.height]).toEqual([300, 400]);
  });

  it('sends the foil it was given', async () => {
    const w = await resting({}, { foil: 'rainbow' });
    expect(w.sent.uKind).toEqual([2]);
    expect(Array.from((w.sent.uSweep as number[][])[0])).toEqual([6.5, 2.6, 5.0, 1.9]);
  });
});

describe('tilting', () => {
  it('tilts toward the mouse, comes to rest at that angle, and then stops drawing', async () => {
    const w = await resting();
    w.canvasEvents.fire('pointermove', mouse(225, 100));
    expect(w.frames.pending()).toBe(1);
    const ran = w.frames.untilIdle();
    expect(ran).toBeGreaterThan(10);
    expect(ran).toBeLessThan(200);
    expectTurn(w.sent, pose(tiltTarget(225, 100, RECT)).turn);
    expect(w.frames.pending()).toBe(0);
    expect(turn(w.sent)).not.toEqual(IDENTITY);
  });

  it('returns flat when the mouse leaves', async () => {
    const w = await resting();
    w.canvasEvents.fire('pointermove', mouse(300, 0));
    w.frames.untilIdle();
    w.canvasEvents.fire('pointerleave', mouse(400, 0));
    expect(w.frames.pending()).toBe(1);
    w.frames.untilIdle();
    expectTurn(w.sent, IDENTITY);
  });

  it('tilts under a finger only while it is down', async () => {
    const w = await resting();
    w.canvasEvents.fire('pointermove', finger(300, 200));
    expect(w.frames.pending()).toBe(0);
    w.canvasEvents.fire('pointerdown', finger(300, 200));
    w.frames.untilIdle();
    expectTurn(w.sent, pose({ x: 0, y: MAX_TILT }).turn);
    w.canvasEvents.fire('pointermove', finger(0, 200));
    w.frames.untilIdle();
    expectTurn(w.sent, pose({ x: 0, y: -MAX_TILT }).turn);
    w.canvasEvents.fire('pointerup', finger(0, 200));
    w.frames.untilIdle();
    expectTurn(w.sent, IDENTITY);
    w.canvasEvents.fire('pointermove', finger(300, 200));
    expect(w.frames.pending()).toBe(0);
  });

  it('returns flat when the browser cancels the touch, and stops drawing', async () => {
    const w = await resting();
    w.canvasEvents.fire('pointerdown', finger(300, 0));
    w.frames.run(5);
    w.canvasEvents.fire('pointercancel', finger(300, 0));
    w.frames.untilIdle();
    expectTurn(w.sent, IDENTITY);
    expect(w.frames.pending()).toBe(0);
  });

  it('returns flat when the finger slides off the card, where the page keeps the right to scroll', async () => {
    const w = await resting();                       // scroll mode: the pointer is not captured, so it can leave
    w.canvasEvents.fire('pointerdown', finger(300, 0));
    w.frames.untilIdle();
    w.canvasEvents.fire('pointerleave', finger(340, -20));
    w.frames.untilIdle();
    expectTurn(w.sent, IDENTITY);
    w.canvasEvents.fire('pointermove', finger(150, 200));          // and it does not pick the tilt up again by itself
    expect(w.frames.pending()).toBe(0);
  });

  it('does not let a second finger leaving end the first finger\'s tilt', async () => {
    const w = await resting();
    w.canvasEvents.fire('pointerdown', finger(300, 0, 1));
    w.frames.untilIdle();
    w.canvasEvents.fire('pointerleave', finger(10, 10, 2));
    w.frames.untilIdle();
    expectTurn(w.sent, pose(tiltTarget(300, 0, RECT)).turn);
  });

  it('follows the first finger and ignores a second', async () => {
    const w = await resting();
    w.canvasEvents.fire('pointerdown', finger(225, 100, 1));
    w.canvasEvents.fire('pointerdown', finger(0, 400, 2));
    w.canvasEvents.fire('pointermove', finger(10, 390, 2));
    w.frames.untilIdle();
    expectTurn(w.sent, pose(tiltTarget(225, 100, RECT)).turn);
    w.canvasEvents.fire('pointerup', finger(10, 390, 2));
    w.frames.untilIdle();
    expectTurn(w.sent, pose(tiltTarget(225, 100, RECT)).turn);
    w.canvasEvents.fire('pointerup', finger(225, 100, 1));
    w.frames.untilIdle();
    expectTurn(w.sent, IDENTITY);
  });

  it('keeps the gesture to itself in capture mode', async () => {
    const w = await resting({}, { touch: 'capture' });
    expect(w.canvas.style.touchAction).toBe('none');
    w.canvasEvents.fire('pointerdown', finger(300, 200));
    expect(w.canvas.setPointerCapture).toHaveBeenCalledWith(7);
  });

  it('leaves vertical swipes to the page in scroll mode, which is the default', async () => {
    const w = await resting();
    expect(w.canvas.style.touchAction).toBe('pan-y');
    w.canvasEvents.fire('pointerdown', finger(300, 200));
    expect(w.canvas.setPointerCapture).not.toHaveBeenCalled();
  });

  it('survives a browser that refuses the capture', async () => {
    const w = await resting({}, { touch: 'capture' });
    w.canvas.setPointerCapture.mockImplementation(() => { throw new Error('InvalidPointerId'); });
    w.canvasEvents.fire('pointerdown', finger(300, 200));
    w.frames.untilIdle();
    expectTurn(w.sent, pose({ x: 0, y: MAX_TILT }).turn);
    expect(w.errors).toEqual([]);
  });

  it('returns flat when the capture is lost some other way', async () => {
    const w = await resting({}, { touch: 'capture' });
    w.canvasEvents.fire('pointerdown', finger(300, 200));
    w.frames.untilIdle();
    w.canvasEvents.fire('lostpointercapture', finger(300, 200));
    w.frames.untilIdle();
    expectTurn(w.sent, IDENTITY);
  });

  it('lets go of the tilt when the window loses focus', async () => {
    const w = await resting();
    w.canvasEvents.fire('pointermove', mouse(300, 0));
    w.frames.untilIdle();
    w.windowEvents.fire('blur');
    w.frames.untilIdle();
    expectTurn(w.sent, IDENTITY);
  });

  it('stays flat for a canvas that has no size', async () => {
    const w = await resting();
    w.canvas.getBoundingClientRect = () => ({ left: 0, top: 0, width: 0, height: 0 });
    w.canvasEvents.fire('pointermove', mouse(50, 50));
    w.frames.untilIdle();
    expectTurn(w.sent, IDENTITY);
  });

  it('does not tilt at all with reduced motion: one frame, flat', async () => {
    const w = await resting({}, { reducedMotion: true });
    expect(w.count('drawElements')).toBe(3);
    w.canvasEvents.fire('pointermove', mouse(300, 0));
    w.canvasEvents.fire('pointerdown', finger(300, 0));
    expect(w.frames.pending()).toBe(0);
    expectTurn(w.sent, IDENTITY);
  });
});

describe('redrawing', () => {
  it('draws one frame with the new foil when it is changed', async () => {
    const w = await resting();
    expect(w.sent.uKind).toEqual([1]);
    w.card.setFoil('prismatic');
    expect(w.frames.pending()).toBe(1);
    w.frames.run();
    expect(w.sent.uKind).toEqual([3]);
    expect(w.frames.pending()).toBe(0);
    expect(w.count('createProgram')).toBe(2);        // nothing was rebuilt for it
  });

  it('takes a foil it has never heard of as gloss', async () => {
    const w = await resting();
    w.card.setFoil('chrome' as never);
    w.frames.untilIdle();
    expect(w.sent.uKind).toEqual([0]);
    expect(w.errors).toEqual([]);
  });

  it('draws one frame at the new size when the canvas changes size', async () => {
    const w = await resting();
    w.canvas.clientWidth = 150; w.canvas.clientHeight = 200;
    w.card.resize();
    expect([w.canvas.width, w.canvas.height]).toEqual([150, 200]);
    expect(w.frames.pending()).toBe(1);
    w.frames.run();
    const viewports = w.calls.filter((call) => call.name === 'viewport');
    expect(viewports[viewports.length - 1].args).toEqual([0, 0, 150, 200]);
    expect(w.frames.pending()).toBe(0);
  });

  it('notices the canvas changing size by itself', async () => {
    const w = await resting();
    w.canvas.clientWidth = 600; w.canvas.clientHeight = 800;
    w.observers[0].trigger();
    expect([w.canvas.width, w.canvas.height]).toEqual([600, 800]);
    expect(w.frames.pending()).toBe(1);
  });

  it('asks for no frame when a resize changes nothing', async () => {
    const w = await resting();
    w.card.resize();
    expect(w.frames.pending()).toBe(0);
  });

  it('keeps a canvas with no size at one pixel and goes on working', async () => {
    const w = await resting();
    w.canvas.clientWidth = 0; w.canvas.clientHeight = 0;
    w.card.resize();
    w.frames.untilIdle();
    expect([w.canvas.width, w.canvas.height]).toEqual([1, 1]);
    expect(w.errors).toEqual([]);
    for (const value of Array.from(w.sent.uProjection as ArrayLike<number>)) expect(Number.isFinite(value)).toBe(true);
  });

  it('stops while the tab is hidden and picks up where it was when it is shown again', async () => {
    const w = await resting();
    w.canvasEvents.fire('pointermove', mouse(300, 0));
    w.frames.run(3);
    expect(w.frames.pending()).toBe(1);
    w.page.visibilityState = 'hidden';
    w.documentEvents.fire('visibilitychange');
    expect(w.frames.pending()).toBe(0);
    w.page.visibilityState = 'visible';
    w.documentEvents.fire('visibilitychange');
    expect(w.frames.pending()).toBe(1);
    w.frames.untilIdle();
    expectTurn(w.sent, pose(tiltTarget(300, 0, RECT)).turn);
  });
});

describe('going wrong', () => {
  async function failing(options: WorldOptions, message: RegExp, card: Partial<HoloCardOptions> = {}) {
    const w = await started(options, card);
    w.frames.untilIdle();
    await expect(w.card.ready).rejects.toThrow(message);
    expect(w.errors).toHaveLength(1);
    expect(w.errors[0].message).toMatch(message);
    expect(w.frames.pending()).toBe(0);
    expect(w.count('drawElements')).toBe(0);
    expect(w.canvasEvents.count() + w.documentEvents.count() + w.windowEvents.count()).toBe(0);
    return w;
  }

  it('reports a failure through onError and rejects ready when the canvas gives no context', async () => {
    // the brief's own case, with the barest canvas there could be
    const canvas = { getContext: () => null, style: {}, addEventListener() {}, removeEventListener() {}, getBoundingClientRect: () => ({ left: 0, top: 0, width: 0, height: 0 }) } as unknown as HTMLCanvasElement;
    const seen: Error[] = [];
    const card = createHoloCard({ canvas, meshUrl: 'x', artUrls: ['y'], foil: 'holo', onError: (error) => seen.push(error) });
    await expect(card.ready).rejects.toThrow(/WebGL/);
    expect(seen).toHaveLength(1);
    card.destroy();
    card.destroy();
  });

  it('no WebGL at all', async () => {
    const w = await failing({ contexts: [] }, /WebGL is not available/);
    expect(w.fetched).toEqual([]);                  // nothing is downloaded for a card that cannot be drawn
  });

  it('a model the server does not have', async () => {
    const w = await failing({ status: 404 }, /card\.glb.*404/);
    expect(w.count('loseContext')).toBe(1);         // the context goes back to the browser
  });

  it('a model that is not the card', async () => {
    await failing({ body: new Uint8Array(64) }, /card model: not a glb/);
  });

  it('artwork the browser cannot decode in any of its forms', async () => {
    const w = await failing({ decodes: () => false }, /artwork.*back\.avif.*back\.webp/);
    expect(w.images).toHaveLength(2);
  });

  it('no artwork to try', async () => {
    await failing({}, /artwork/, { artUrls: [] });
  });

  it('a shader that does not compile, with what the driver said', async () => {
    await failing({ compiles: false, log: 'ERROR: 0:12: syntax error' }, /does not compile.*0:12: syntax error/);
  });

  it('a program that does not link', async () => {
    await failing({ links: false, log: 'varyings do not match' }, /does not link.*varyings do not match/);
  });

  it('a canvas whose context was already let go', async () => {
    await failing({ lost: true }, /new canvas/);
  });

  it('artwork larger than the device can hold', async () => {
    const w = world();
    vi.stubGlobal('Image', class {
      onload: (() => void) | null = null;
      width = 8192; height = 8192; naturalWidth = 8192; naturalHeight = 8192;
      set src(_value: string) { queueMicrotask(() => this.onload?.()); }
    });
    const errors: Error[] = [];
    const card = createHoloCard({ canvas: w.canvas as unknown as HTMLCanvasElement, meshUrl: 'm', artUrls: ['a'], foil: 'holo', onError: (error) => errors.push(error) });
    await expect(card.ready).rejects.toThrow(/8192.*4096/);
    expect(errors).toHaveLength(1);
  });

  it('stops drawing when the context is lost, and rebuilds and redraws when it comes back', async () => {
    const w = await resting();
    const drawn = w.count('drawElements');
    const lost = { preventDefault: vi.fn() };
    w.gpu.lost = true;
    w.canvasEvents.fire('webglcontextlost', lost);
    expect(lost.preventDefault).toHaveBeenCalled();           // without it the browser never gives the context back
    w.canvasEvents.fire('pointermove', mouse(300, 0));
    w.card.setFoil('rainbow');
    expect(w.frames.pending()).toBe(0);                       // the loop is stopped, not just drawing nothing
    w.frames.untilIdle();
    expect(w.count('drawElements')).toBe(drawn);
    w.gpu.lost = false;
    w.canvasEvents.fire('webglcontextrestored');
    expect(w.frames.pending()).toBe(1);
    w.frames.untilIdle();
    expect(w.count('createProgram')).toBe(4);                 // both programs, built again
    expect(w.count('texImage2D')).toBe(2);                    // and the artwork uploaded again, without a second download
    expect(w.images).toHaveLength(1);
    expect(w.count('drawElements')).toBeGreaterThan(drawn);
    expect(w.sent.uKind).toEqual([2]);
    expect(w.errors).toEqual([]);
  });

  it('reports a context that stays lost for two seconds', async () => {
    const w = await resting();
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    w.gpu.lost = true;
    w.canvasEvents.fire('webglcontextlost', { preventDefault() {} });
    vi.advanceTimersByTime(1900);
    expect(w.errors).toEqual([]);
    vi.advanceTimersByTime(200);
    expect(w.errors).toHaveLength(1);
    expect(w.errors[0].message).toMatch(/lost/);
    expect(w.canvasEvents.count()).toBe(0);
  });

  it('does not report a context that comes back within two seconds', async () => {
    const w = await resting();
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    w.gpu.lost = true;
    w.canvasEvents.fire('webglcontextlost', { preventDefault() {} });
    vi.advanceTimersByTime(1500);
    w.gpu.lost = false;
    w.canvasEvents.fire('webglcontextrestored');
    vi.advanceTimersByTime(5000);
    expect(w.errors).toEqual([]);
  });

  it('tells the host once, whatever else happens afterwards', async () => {
    const w = await failing({ status: 500 }, /500/);
    w.canvasEvents.fire('webglcontextlost', { preventDefault() {} });
    w.card.setFoil('rainbow');
    w.card.resize();
    await settle();
    expect(w.errors).toHaveLength(1);
  });

  it('does not need the host to pass onError', async () => {
    const w = world({ contexts: [] });
    const card = createHoloCard({ canvas: w.canvas as unknown as HTMLCanvasElement, meshUrl: 'm', artUrls: ['a'], foil: 'holo' });
    await expect(card.ready).rejects.toThrow(/WebGL/);
  });

  it('does not need the host to listen to ready: a failure nobody awaits is not an unhandled rejection', async () => {
    // vitest fails the run on an unhandled rejection, so this test is the settle() and nothing else
    const w = world({ contexts: [] });
    const errors: Error[] = [];
    createHoloCard({ canvas: w.canvas as unknown as HTMLCanvasElement, meshUrl: 'm', artUrls: ['a'], foil: 'holo', onError: (error) => errors.push(error) });
    await settle();
    expect(errors).toHaveLength(1);
  });
});

describe('destroy', () => {
  it('removes every listener, stops the loop, frees what it made and hands the context back', async () => {
    const w = await resting();
    expect(w.canvasEvents.count()).toBeGreaterThan(5);
    expect(w.documentEvents.count()).toBe(1);
    expect(w.windowEvents.count()).toBe(1);
    w.canvasEvents.fire('pointermove', mouse(300, 0));
    expect(w.frames.pending()).toBe(1);
    w.card.destroy();
    expect(w.frames.pending()).toBe(0);
    expect(w.canvasEvents.count()).toBe(0);
    expect(w.documentEvents.count()).toBe(0);
    expect(w.windowEvents.count()).toBe(0);
    expect(w.observers[0].connected).toBe(false);
    expect(w.count('deleteProgram')).toBe(2);
    expect(w.count('deleteTexture')).toBe(1);
    expect(w.count('deleteBuffer')).toBe(w.count('createBuffer'));
    expect(w.count('loseContext')).toBe(1);
  });

  it('is safe twice, and nothing it is told afterwards does anything', async () => {
    const w = await resting();
    w.card.destroy();
    const before = w.calls.length;
    w.card.destroy();
    w.card.setFoil('rainbow');
    w.card.resize();
    w.canvasEvents.fire('pointermove', mouse(300, 0));
    w.documentEvents.fire('visibilitychange');
    await settle();
    expect(w.calls.length).toBe(before);
    expect(w.frames.pending()).toBe(0);
    expect(w.errors).toEqual([]);
  });

  it('before the card has started: no context is asked for, nothing is fetched, no error is reported', async () => {
    const w = world();
    const errors: Error[] = [];
    const card = createHoloCard({ canvas: w.canvas as unknown as HTMLCanvasElement, meshUrl: 'm', artUrls: ['a'], foil: 'holo', onError: (error) => errors.push(error) });
    card.destroy();
    await expect(card.ready).rejects.toThrow(/destroyed/);
    await settle();
    expect(w.canvas.getContext).not.toHaveBeenCalled();
    expect(w.fetched).toEqual([]);
    expect(errors).toEqual([]);
    expect(w.frames.pending()).toBe(0);
  });

  it('while the files are still on their way: nothing is drawn, the context goes back, no error is reported', async () => {
    const w = world();
    const errors: Error[] = [];
    const card = createHoloCard({ canvas: w.canvas as unknown as HTMLCanvasElement, meshUrl: 'm', artUrls: ['a'], foil: 'holo', onError: (error) => errors.push(error) });
    await Promise.resolve();
    await Promise.resolve();
    expect(w.canvas.getContext).toHaveBeenCalled();
    card.destroy();
    await expect(card.ready).rejects.toThrow(/destroyed/);
    await settle();
    w.frames.untilIdle();
    expect(w.count('drawElements')).toBe(0);
    expect(w.count('loseContext')).toBe(1);
    expect(errors).toEqual([]);
    expect(w.canvasEvents.count() + w.documentEvents.count() + w.windowEvents.count()).toBe(0);
  });

  it('opened and closed ten times over, hands back every context it took', async () => {
    for (let i = 0; i < 10; i++) {
      const w = await resting();
      w.card.destroy();
      expect(w.count('loseContext')).toBe(1);
      vi.unstubAllGlobals();
    }
  });
});
