// The card back, drawn: a WebGL context on a canvas the host supplies, the model and the artwork it is pointed at,
// a tilt that follows the pointer on a spring, and a loop that draws only while something moves.
//
// The host owns the canvas and its size; this owns everything it puts on it and lets all of it go in destroy(),
// the context included. A canvas whose card was destroyed cannot be given another: use a new canvas for each card.
import { FOILS } from './foils';
import type { FoilId } from './foils';
import { readCardGlb } from './glb';
import type { CardMesh, CardPart } from './glb';
import { createLoop } from './loop';
import { multiply, translation } from './mat';
import { CORNER, KEY_LIGHT, foilUniforms, framing, pose, shadowFor } from './scene';
import { CARD_ATTRIBUTES, CARD_FRAGMENT, CARD_UNIFORMS, CARD_VERTEX, SHADOW_ATTRIBUTES, SHADOW_FRAGMENT, SHADOW_UNIFORMS, SHADOW_VERTEX } from './shaders';
import { REST, settled, step } from './spring';
import type { Angles, Spring } from './spring';
import { tiltTarget, viewport } from './tilt';

export type HoloCardOptions = {
  /** A canvas of its own for this card: three wide to four tall, or taller. Its CSS size is the host's business. */
  canvas: HTMLCanvasElement;
  /** The card model: the .glb tools/blender/export_card.py writes. A data: address is read as it is, with no request. */
  meshUrl: string;
  /** The artwork, best first. The first one the browser can decode is used. */
  artUrls: string[];
  foil: FoilId;
  /**
   * 'capture' takes the whole gesture (touch-action: none): for a view where nothing scrolls behind the card.
   * 'scroll', the default, leaves vertical swipes to the page (touch-action: pan-y); the card returns to flat when
   * the browser takes the gesture.
   */
  touch?: 'capture' | 'scroll';
  /** Draw the card once, flat, and never tilt it. */
  reducedMotion?: boolean;
  /** The most device pixels drawn per CSS pixel. Two, unless said. */
  maxPixelRatio?: number;
  /** Called once if the card cannot be drawn, or stops being drawable. The host shows a still instead. */
  onError?: (error: Error) => void;
};

export type HoloCard = {
  /**
   * Resolves once the first frame is drawn. Rejects if the card cannot be drawn (after onError) or is destroyed
   * first. The host need not listen to it.
   */
  ready: Promise<void>;
  setFoil(foil: FoilId): void;
  /** Tell it the canvas changed size. It also notices by itself where the browser has ResizeObserver. */
  resize(): void;
  /** Stop, let go of everything and hand the context back. Safe at any time, and twice. */
  destroy(): void;
};

// The two context types differ only in overloads this file does not use, so everything is typed as WebGL 1.
type GL = WebGLRenderingContext;
type Program = { program: WebGLProgram; uniforms: Record<string, WebGLUniformLocation | null> };
type Part = { positions: WebGLBuffer; normals: WebGLBuffer; uvs: WebGLBuffer; indices: WebGLBuffer; count: number; type: number };
type Programs = { card: Program; shadow: Program };
type Geometry = { parts: Part[]; quad: WebGLBuffer; texture: WebGLTexture; buffers: WebGLBuffer[] };
/** The model as it is drawn: one unit tall and centred on the origin. */
type Prepared = { parts: CardPart[]; halfWidth: number; widthMm: number; aspect: number };

const LOST_FOR_TOO_LONG = 2000;

let probed: boolean | null = null;

/** Whether this browser can make a WebGL context at all. Asked once; the trial context is handed straight back. */
export function webglAvailable(): boolean {
  if (typeof document === 'undefined') return false;
  if (probed !== null) return probed;
  try {
    const canvas = document.createElement('canvas');
    const gl = (canvas.getContext('webgl2') ?? canvas.getContext('webgl')) as GL | null;
    probed = gl !== null;
    gl?.getExtension('WEBGL_lose_context')?.loseContext();
  } catch {
    probed = false;
  }
  return probed;
}

function compile(gl: GL, type: number, source: string, what: string): WebGLShader {
  const shader = gl.createShader(type);
  if (!shader) throw new Error(`card shader: the ${what} could not be made`);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader) ?? '';
    gl.deleteShader(shader);
    throw new Error(`card shader: the ${what} does not compile: ${log}`);
  }
  return shader;
}

function link(gl: GL, what: string, vertexSource: string, fragmentSource: string, attributes: readonly string[], uniforms: readonly string[]): Program {
  const vertex = compile(gl, gl.VERTEX_SHADER, vertexSource, `${what}'s vertex shader`);
  const fragment = compile(gl, gl.FRAGMENT_SHADER, fragmentSource, `${what}'s fragment shader`);
  const program = gl.createProgram();
  if (!program) throw new Error(`card shader: the ${what}'s program could not be made`);
  gl.attachShader(program, vertex);
  gl.attachShader(program, fragment);
  attributes.forEach((name, index) => gl.bindAttribLocation(program, index, name));
  gl.linkProgram(program);
  gl.deleteShader(vertex);
  gl.deleteShader(fragment);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(program) ?? '';
    gl.deleteProgram(program);
    throw new Error(`card shader: the ${what}'s program does not link: ${log}`);
  }
  const locations: Record<string, WebGLUniformLocation | null> = {};
  for (const name of uniforms) locations[name] = gl.getUniformLocation(program, name);
  return { program, uniforms: locations };
}

/** The model scaled so the card is one unit tall and centred, which is how the camera is set up to see it. */
function prepare(mesh: CardMesh): Prepared {
  const width = mesh.max[0] - mesh.min[0], height = mesh.max[1] - mesh.min[1];
  if (!(width > 0) || !(height > 0)) throw new Error('card model: it has no size');
  const scale = 1 / height;
  const centre = [0, 1, 2].map((axis) => (mesh.min[axis] + mesh.max[axis]) / 2);
  const parts = [mesh.face, mesh.rim, mesh.back].map((part) => {
    const positions = new Float32Array(part.positions.length);
    for (let i = 0; i < positions.length; i++) positions[i] = (part.positions[i] - centre[i % 3]) * scale;
    return { positions, normals: part.normals, uvs: part.uvs, indices: part.indices };
  });
  return { parts, halfWidth: (width * scale) / 2, widthMm: width * 1000, aspect: height / width };
}

/** The bytes carried inside a data: address. A page that holds its files inside itself makes no request for them. */
function carried(url: string): ArrayBuffer {
  const comma = url.indexOf(',');
  let binary: string;
  try {
    if (comma < 0 || !/;base64$/i.test(url.slice(0, comma))) throw new Error('not base64');
    binary = atob(url.slice(comma + 1));
  } catch {
    throw new Error('card model: its data: address could not be read (it must be base64)');
  }
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

async function loadMesh(url: string): Promise<CardMesh> {
  if (/^data:/i.test(url)) return readCardGlb(carried(url));
  let response: Response;
  try {
    response = await fetch(url);
  } catch (error) {
    throw new Error(`card model: ${url} could not be fetched (${error instanceof Error ? error.message : String(error)})`);
  }
  if (!response.ok) throw new Error(`card model: ${url} answered ${response.status}`);
  return readCardGlb(await response.arrayBuffer());
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.crossOrigin = 'anonymous';
    image.decoding = 'async';
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(`cannot decode ${url}`));
    image.src = url;
  });
}

/** The first of these the browser can decode. An older browser fails the AVIF and takes the WebP. */
async function loadArt(urls: string[]): Promise<HTMLImageElement> {
  if (urls.length === 0) throw new Error('card artwork: no address was given for it');
  for (const url of urls) {
    try {
      return await loadImage(url);
    } catch {
      // try the next
    }
  }
  throw new Error(`card artwork: none of ${urls.join(', ')} could be decoded`);
}

const powerOfTwo = (n: number): boolean => n > 0 && (n & (n - 1)) === 0;

export function createHoloCard(options: HoloCardOptions): HoloCard {
  const { canvas } = options;
  const touch = options.touch ?? 'scroll';
  const maxPixelRatio = options.maxPixelRatio ?? 2;

  let foil: FoilId = options.foil;
  let gl: GL | null = null;
  let version: 1 | 2 = 1;
  let programs: Programs | null = null;
  let geometry: Geometry | null = null;
  let model: Prepared | null = null;
  let art: HTMLImageElement | null = null;
  let spring: Spring = REST;
  let target: Angles = { x: 0, y: 0 };
  let pointer: number | null = null;
  let destroyed = false, failed = false, lost = false, drawn = false;
  let lostTimer: ReturnType<typeof setTimeout> | null = null;
  let observer: ResizeObserver | null = null;
  let unlisten: (() => void)[] = [];

  let resolveReady: () => void = () => {};
  let rejectReady: (error: Error) => void = () => {};
  const ready = new Promise<void>((resolve, reject) => { resolveReady = resolve; rejectReady = reject; });
  ready.catch(() => {});       // a host that only passes onError must not see an unhandled rejection

  // 'none' keeps the whole gesture for the card; 'pan-y' lets a vertical swipe scroll the page it sits in.
  canvas.style.touchAction = touch === 'capture' ? 'none' : 'pan-y';

  const loop = createLoop({
    requestFrame: (callback) => requestAnimationFrame(callback),
    cancelFrame: (handle) => cancelAnimationFrame(handle),
    frame: (dt) => {
      try {
        spring = step(spring, target, dt);
        if (draw() && !drawn) { drawn = true; resolveReady(); }
      } catch (error) {
        fail(error);
        return false;
      }
      return !settled(spring, target);
    },
  });

  const dead = (): boolean => destroyed || failed;

  /** Something changed: draw, if there is anything to draw with. */
  function wake(): void {
    if (dead() || lost || !geometry) return;
    loop.wake();
  }

  /** Listens, and remembers how to stop listening. */
  function on<E extends Event>(source: EventTarget, type: string, listener: (event: E) => void): void {
    const heard = listener as EventListener;
    source.addEventListener(type, heard);
    unlisten.push(() => source.removeEventListener(type, heard));
  }

  // ---- building: everything here is made again if the context is lost and comes back ----

  function buildPrograms(context: GL): Programs {
    return {
      card: link(context, 'card', CARD_VERTEX, CARD_FRAGMENT, CARD_ATTRIBUTES, CARD_UNIFORMS),
      shadow: link(context, 'shadow', SHADOW_VERTEX, SHADOW_FRAGMENT, SHADOW_ATTRIBUTES, SHADOW_UNIFORMS),
    };
  }

  function buildGeometry(context: GL, prepared: Prepared, image: HTMLImageElement): Geometry {
    const buffers: WebGLBuffer[] = [];
    const buffer = (kind: number, data: Float32Array | Uint16Array | Uint32Array): WebGLBuffer => {
      const made = context.createBuffer();
      if (!made) throw new Error('card model: a buffer could not be made');
      buffers.push(made);
      context.bindBuffer(kind, made);
      context.bufferData(kind, data, context.STATIC_DRAW);
      return made;
    };
    const parts = prepared.parts.map((part) => {
      const wide = part.indices instanceof Uint32Array;
      if (wide && version === 1 && !context.getExtension('OES_element_index_uint')) throw new Error('card model: it has more vertices than this device can index');
      return {
        positions: buffer(context.ARRAY_BUFFER, part.positions),
        normals: buffer(context.ARRAY_BUFFER, part.normals),
        uvs: buffer(context.ARRAY_BUFFER, part.uvs),
        indices: buffer(context.ELEMENT_ARRAY_BUFFER, part.indices),
        count: part.indices.length,
        type: wide ? context.UNSIGNED_INT : context.UNSIGNED_SHORT,
      };
    });
    const quad = buffer(context.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]));

    // The artwork goes to the GPU exactly as it was decoded: not flipped (row 0 is its top, as the model's UVs
    // expect), not premultiplied, its colours not converted.
    const width = image.naturalWidth || image.width, height = image.naturalHeight || image.height;
    const limit = context.getParameter(context.MAX_TEXTURE_SIZE) as number;
    if (width > limit || height > limit) throw new Error(`card artwork: it is ${width} by ${height} pixels and this device holds ${limit} at most`);
    const texture = context.createTexture();
    if (!texture) throw new Error('card artwork: its texture could not be made');
    context.bindTexture(context.TEXTURE_2D, texture);
    context.pixelStorei(context.UNPACK_FLIP_Y_WEBGL, false);
    context.pixelStorei(context.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    context.pixelStorei(context.UNPACK_COLORSPACE_CONVERSION_WEBGL, context.NONE);
    context.texImage2D(context.TEXTURE_2D, 0, context.RGBA, context.RGBA, context.UNSIGNED_BYTE, image);
    context.texParameteri(context.TEXTURE_2D, context.TEXTURE_WRAP_S, context.CLAMP_TO_EDGE);
    context.texParameteri(context.TEXTURE_2D, context.TEXTURE_WRAP_T, context.CLAMP_TO_EDGE);
    context.texParameteri(context.TEXTURE_2D, context.TEXTURE_MAG_FILTER, context.LINEAR);
    // Smaller copies for when the card is drawn smaller than the artwork, which is most of the time on a phone.
    // WebGL 1 can only make them for sizes that are powers of two, which this artwork's is not.
    if (version === 2 || (powerOfTwo(width) && powerOfTwo(height))) {
      context.generateMipmap(context.TEXTURE_2D);
      context.texParameteri(context.TEXTURE_2D, context.TEXTURE_MIN_FILTER, context.LINEAR_MIPMAP_LINEAR);
    } else {
      context.texParameteri(context.TEXTURE_2D, context.TEXTURE_MIN_FILTER, context.LINEAR);
    }
    return { parts, quad, texture, buffers };
  }

  // ---- drawing ----

  /** Draws the card as it stands. Says whether anything was drawn. */
  function draw(): boolean {
    const context = gl, built = programs, made = geometry, prepared = model;
    if (!context || !built || !made || !prepared || lost) return false;
    const width = context.drawingBufferWidth, height = context.drawingBufferHeight;
    context.viewport(0, 0, width, height);
    context.clearColor(0, 0, 0, 0);
    context.clear(context.COLOR_BUFFER_BIT | context.DEPTH_BUFFER_BIT);

    const { distance, fill, projection } = framing(width / height, 1 / prepared.aspect);
    const turned = pose(spring);
    const modelView = multiply(translation(0, 0, -distance), turned.rotation);

    // the shadow, under everything: black at some opacity, in the premultiplied form the page expects
    const shadow = shadowFor(spring);
    const s = built.shadow.uniforms;
    context.useProgram(built.shadow.program);
    context.disable(context.DEPTH_TEST);
    context.disable(context.CULL_FACE);
    context.enable(context.BLEND);
    context.blendFunc(context.ONE, context.ONE_MINUS_SRC_ALPHA);
    context.bindBuffer(context.ARRAY_BUFFER, made.quad);
    context.enableVertexAttribArray(0);
    context.disableVertexAttribArray(1);
    context.disableVertexAttribArray(2);
    context.vertexAttribPointer(0, 2, context.FLOAT, false, 0, 0);
    context.uniformMatrix4fv(s.uProjection, false, projection);
    context.uniform3fv(s.uCentre, [shadow.x, shadow.y, -distance]);
    context.uniform2fv(s.uHalf, [prepared.halfWidth + 0.2, 0.7]);
    context.uniform2fv(s.uBox, [prepared.halfWidth, 0.5]);
    context.uniform1f(s.uRadius, CORNER * prepared.halfWidth * 2);
    context.uniform1f(s.uBlur, shadow.blur);
    context.uniform1f(s.uDark, shadow.dark);
    context.drawArrays(context.TRIANGLE_STRIP, 0, 4);

    // the card
    const numbers = foilUniforms(FOILS[foil] ?? FOILS.gloss, prepared.widthMm, (fill * height) / prepared.aspect);
    const c = built.card.uniforms;
    context.useProgram(built.card.program);
    context.enable(context.DEPTH_TEST);
    context.depthFunc(context.LEQUAL);
    context.enable(context.CULL_FACE);
    context.cullFace(context.BACK);
    context.disable(context.BLEND);
    context.activeTexture(context.TEXTURE0);
    context.bindTexture(context.TEXTURE_2D, made.texture);
    context.uniformMatrix4fv(c.uProjection, false, projection);
    context.uniformMatrix4fv(c.uModelView, false, modelView);
    context.uniformMatrix3fv(c.uTurn, false, turned.turn);
    context.uniform1i(c.uArt, 0);
    context.uniform1f(c.uKind, numbers.kind);
    context.uniform3fv(c.uRight, turned.right);
    context.uniform3fv(c.uUp, turned.up);
    context.uniform3fv(c.uLight, KEY_LIGHT);
    context.uniform4fv(c.uSweep, numbers.sweep);
    context.uniform4fv(c.uMask, numbers.mask);
    context.uniform4fv(c.uGain, numbers.gain);
    context.uniform4fv(c.uFacet, numbers.facet);
    context.uniform4fv(c.uDetail, numbers.detail);
    context.uniform1f(c.uAspect, prepared.aspect);
    context.enableVertexAttribArray(1);
    context.enableVertexAttribArray(2);
    made.parts.forEach((part, index) => {
      context.uniform1f(c.uPart, index);
      context.bindBuffer(context.ARRAY_BUFFER, part.positions);
      context.vertexAttribPointer(0, 3, context.FLOAT, false, 0, 0);
      context.bindBuffer(context.ARRAY_BUFFER, part.normals);
      context.vertexAttribPointer(1, 3, context.FLOAT, false, 0, 0);
      context.bindBuffer(context.ARRAY_BUFFER, part.uvs);
      context.vertexAttribPointer(2, 2, context.FLOAT, false, 0, 0);
      context.bindBuffer(context.ELEMENT_ARRAY_BUFFER, part.indices);
      context.drawElements(context.TRIANGLES, part.count, part.type, 0);
    });
    return true;
  }

  /** Matches the drawing buffer to the canvas's CSS size. Says whether it changed. */
  function fit(): boolean {
    const ratio = typeof devicePixelRatio === 'number' ? devicePixelRatio : 1;
    const size = viewport(canvas.clientWidth, canvas.clientHeight, ratio, maxPixelRatio);
    if (canvas.width === size.width && canvas.height === size.height) return false;
    canvas.width = size.width;
    canvas.height = size.height;
    return true;
  }

  // ---- the pointer ----

  function aim(event: PointerEvent): void {
    target = tiltTarget(event.clientX, event.clientY, canvas.getBoundingClientRect());
    wake();
  }

  function release(): void {
    pointer = null;
    target = { x: 0, y: 0 };
    wake();
  }

  function listen(): void {
    on(canvas, 'webglcontextlost', (event: Event) => {
      event.preventDefault();          // without this the browser never gives the context back
      lost = true;
      programs = null;
      geometry = null;
      loop.stop();
      lostTimer = setTimeout(() => fail(new Error('the WebGL context was lost and did not come back')), LOST_FOR_TOO_LONG);
    });
    on(canvas, 'webglcontextrestored', () => {
      if (lostTimer !== null) clearTimeout(lostTimer);
      lostTimer = null;
      lost = false;
      try {
        if (gl) programs = buildPrograms(gl);
        if (gl && model && art) geometry = buildGeometry(gl, model, art);
      } catch (error) {
        fail(error);
        return;
      }
      wake();
    });
    if (typeof document !== 'undefined') {
      on(document, 'visibilitychange', () => {
        if (document.visibilityState === 'hidden') loop.stop();
        else wake();
      });
    }
    if (typeof ResizeObserver !== 'undefined') {
      observer = new ResizeObserver(() => handle.resize());
      observer.observe(canvas);
    }
    if (options.reducedMotion) return;

    // A mouse tilts the card wherever it hovers; a finger or a pen only while it is down. One pointer at a time.
    on(canvas, 'pointerdown', (event: PointerEvent) => {
      if (pointer !== null && pointer !== event.pointerId) return;
      pointer = event.pointerId;
      if (touch === 'capture') {
        try {
          canvas.setPointerCapture(event.pointerId);
        } catch {
          // the pointer is already gone; the tilt simply ends when it leaves the canvas
        }
      }
      aim(event);
    });
    on(canvas, 'pointermove', (event: PointerEvent) => {
      const hovering = event.pointerType === 'mouse' && pointer === null;
      if (hovering || pointer === event.pointerId) aim(event);
    });
    on(canvas, 'pointerup', (event: PointerEvent) => {
      if (pointer !== event.pointerId) return;
      if (event.pointerType === 'mouse') pointer = null;      // the mouse is still over the card: keep following it
      else release();
    });
    // The browser took the gesture (to scroll, say), or the pointer went away some other way.
    on(canvas, 'pointercancel', (event: PointerEvent) => { if (pointer === event.pointerId) release(); });
    on(canvas, 'lostpointercapture', (event: PointerEvent) => { if (pointer === event.pointerId) release(); });
    on(canvas, 'pointerleave', (event: PointerEvent) => { if (pointer === null || pointer === event.pointerId) release(); });
    if (typeof window !== 'undefined') on(window, 'blur', () => release());
  }

  // ---- starting, failing, stopping ----

  async function start(): Promise<void> {
    if (destroyed) return;
    const attributes = { alpha: true, antialias: true, depth: true, stencil: false, premultipliedAlpha: true, preserveDrawingBuffer: false };
    let context = canvas.getContext('webgl2', attributes) as GL | null;
    version = 2;
    if (!context) {
      context = canvas.getContext('webgl', attributes) as GL | null;
      version = 1;
    }
    if (!context) throw new Error('WebGL is not available');
    gl = context;
    if (context.isContextLost()) throw new Error("this canvas's WebGL context was already let go: give each card a new canvas");
    listen();

    // the files travel while the shaders compile
    const loading = Promise.all([loadMesh(options.meshUrl), loadArt(options.artUrls)]);
    loading.catch(() => {});
    programs = buildPrograms(context);
    const [mesh, image] = await loading;
    if (dead()) return;
    model = prepare(mesh);
    art = image;
    if (!lost) geometry = buildGeometry(context, model, art);     // if it is lost right now, the restore builds it
    fit();
    wake();
  }

  function teardown(): void {
    loop.stop();
    for (const off of unlisten) off();
    unlisten = [];
    observer?.disconnect();
    observer = null;
    if (lostTimer !== null) clearTimeout(lostTimer);
    lostTimer = null;
    const context = gl;
    gl = null;
    if (!context) return;
    if (!context.isContextLost()) {
      if (programs) { context.deleteProgram(programs.card.program); context.deleteProgram(programs.shadow.program); }
      if (geometry) {
        for (const buffer of geometry.buffers) context.deleteBuffer(buffer);
        context.deleteTexture(geometry.texture);
      }
    }
    programs = null;
    geometry = null;
    // Browsers keep only so many contexts alive. Handing this one back now, instead of waiting for the garbage
    // collector, is what lets the view be opened and closed any number of times.
    context.getExtension('WEBGL_lose_context')?.loseContext();
  }

  function fail(error: unknown): void {
    if (dead()) return;
    failed = true;
    teardown();
    const problem = error instanceof Error ? error : new Error(String(error));
    try {
      options.onError?.(problem);
    } finally {
      rejectReady(problem);
    }
  }

  const handle: HoloCard = {
    ready,
    setFoil(next) {
      if (dead()) return;
      foil = next;
      wake();
    },
    resize() {
      if (dead() || !gl) return;
      if (fit()) wake();
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      teardown();
      rejectReady(new Error('the card was destroyed before it was ready'));
    },
  };

  // Started a moment later, never inside this call: the host always has the handle in its hands before onError can
  // run, and a card that is created and destroyed in one breath never asks for a context at all.
  Promise.resolve().then(start).catch(fail);
  return handle;
}
