import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { readCardGlb } from './glb';
import type { CardPart } from './glb';

// ---- test utilities: take a glb apart, change it, put it back together ----

type Doc = {
  extensionsRequired?: string[];
  nodes: { mesh?: number; name?: string; translation?: number[] }[];
  materials: { name: string }[];
  meshes: { primitives: { attributes: Record<string, number>; indices?: number; material: number; mode?: number }[] }[];
  accessors: { bufferView: number; byteOffset?: number; componentType: number; count: number; type: string; sparse?: object }[];
  bufferViews: { buffer: number; byteOffset: number; byteLength: number; byteStride?: number }[];
  buffers: { byteLength: number; uri?: string }[];
};

const MAGIC = 0x46546c67, JSON_CHUNK = 0x4e4f534a, BIN_CHUNK = 0x004e4942;

function unpack(buffer: ArrayBuffer): { doc: Doc; bin: Uint8Array } {
  const view = new DataView(buffer);
  const jsonLength = view.getUint32(12, true);
  const doc = JSON.parse(new TextDecoder().decode(new Uint8Array(buffer, 20, jsonLength))) as Doc;
  const binLength = view.getUint32(20 + jsonLength, true);
  return { doc, bin: new Uint8Array(buffer.slice(28 + jsonLength, 28 + jsonLength + binLength)) };
}

function pack(doc: Doc | string, bin: Uint8Array | null, header: { magic?: number; version?: number } = {}): ArrayBuffer {
  let text = typeof doc === 'string' ? doc : JSON.stringify(doc);
  while (text.length % 4) text += ' ';
  const json = new TextEncoder().encode(text);
  const binLength = bin ? Math.ceil(bin.length / 4) * 4 : 0;
  const total = 12 + 8 + json.length + (bin ? 8 + binLength : 0);
  const out = new Uint8Array(total);
  const view = new DataView(out.buffer);
  view.setUint32(0, header.magic ?? MAGIC, true);
  view.setUint32(4, header.version ?? 2, true);
  view.setUint32(8, total, true);
  view.setUint32(12, json.length, true);
  view.setUint32(16, JSON_CHUNK, true);
  out.set(json, 20);
  if (bin) {
    view.setUint32(20 + json.length, binLength, true);
    view.setUint32(24 + json.length, BIN_CHUNK, true);
    out.set(bin, 28 + json.length);
  }
  return out.buffer;
}

const file = readFileSync(new URL('../../../apps/value/public/cards/card.glb', import.meta.url));
/** The committed model, a fresh copy each time. */
function committed(): ArrayBuffer {
  const copy = new Uint8Array(file.byteLength);
  copy.set(file);
  return copy.buffer;
}
/** The committed model after one change to its JSON or its binary. */
function changed(edit: (doc: Doc, bin: Uint8Array) => void): ArrayBuffer {
  const { doc, bin } = unpack(committed());
  edit(doc, bin);
  return pack(doc, bin);
}

/** Bytes written little-endian into a buffer that grows. */
function writer() {
  let bytes = new Uint8Array(1024);
  let view = new DataView(bytes.buffer);
  let length = 0;
  const room = (n: number) => {
    if (length + n <= bytes.length) return;
    const grown = new Uint8Array(Math.max(bytes.length * 2, length + n));
    grown.set(bytes);
    bytes = grown;
    view = new DataView(bytes.buffer);
  };
  return {
    get length() { return length; },
    f32(...values: number[]) { room(values.length * 4); for (const v of values) { view.setFloat32(length, v, true); length += 4; } },
    u16(...values: number[]) { room(values.length * 2); for (const v of values) { view.setUint16(length, v, true); length += 2; } },
    u32(...values: number[]) { room(values.length * 4); for (const v of values) { view.setUint32(length, v, true); length += 4; } },
    pad() { room(4); while (length % 4) length += 1; },
    done: () => bytes.slice(0, length),
  };
}

const SQUARE = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
const SQUARE_UVS = [[0, 1], [1, 1], [1, 0], [0, 0]];

/**
 * A model of three squares, one per part, at z = 0, -0.5 and -1: small enough to check number by number.
 * `interleaved` stores each part's positions, normals and UVs in one strided buffer view; `spare` adds that many
 * unused vertices to the face, and one more triangle that reaches the last of them.
 */
function squares(options: { interleaved?: boolean; indexType?: 5123 | 5125; spare?: number } = {}): { doc: Doc; bin: Uint8Array } {
  const indexType = options.indexType ?? 5123;
  const w = writer();
  const doc: Doc = {
    nodes: [{ mesh: 0, name: 'Squares' }],
    materials: [{ name: 'Test Face' }, { name: 'test rim' }, { name: 'TEST BACK' }],
    meshes: [{ primitives: [] }],
    accessors: [],
    bufferViews: [],
    buffers: [{ byteLength: 0 }],
  };
  const view = (byteOffset: number, byteLength: number, byteStride?: number) =>
    doc.bufferViews.push(byteStride ? { buffer: 0, byteOffset, byteLength, byteStride } : { buffer: 0, byteOffset, byteLength }) - 1;
  const accessor = (bufferView: number, componentType: number, count: number, type: string, byteOffset?: number) =>
    doc.accessors.push(byteOffset === undefined ? { bufferView, componentType, count, type } : { bufferView, byteOffset, componentType, count, type }) - 1;

  [0, -0.5, -1].forEach((z, part) => {
    const nz = part === 2 ? -1 : 1;
    const spare = part === 0 ? options.spare ?? 0 : 0;
    const count = 4 + spare;
    const corner = (i: number) => (i < 4 ? SQUARE[i] : [0, 0]);
    const uv = (i: number) => (i < 4 ? SQUARE_UVS[i] : [0.5, 0.5]);
    let attributes: Record<string, number>;
    if (options.interleaved) {
      const start = w.length;
      for (let i = 0; i < count; i++) w.f32(corner(i)[0], corner(i)[1], z, 0, 0, nz, uv(i)[0], uv(i)[1]);
      const v = view(start, count * 32, 32);
      attributes = { POSITION: accessor(v, 5126, count, 'VEC3', 0), NORMAL: accessor(v, 5126, count, 'VEC3', 12), TEXCOORD_0: accessor(v, 5126, count, 'VEC2', 24) };
    } else {
      let start = w.length;
      for (let i = 0; i < count; i++) w.f32(corner(i)[0], corner(i)[1], z);
      const positions = accessor(view(start, count * 12), 5126, count, 'VEC3');
      start = w.length;
      for (let i = 0; i < count; i++) w.f32(0, 0, nz);
      const normals = accessor(view(start, count * 12), 5126, count, 'VEC3');
      start = w.length;
      for (let i = 0; i < count; i++) w.f32(uv(i)[0], uv(i)[1]);
      attributes = { POSITION: positions, NORMAL: normals, TEXCOORD_0: accessor(view(start, count * 8), 5126, count, 'VEC2') };
    }
    const indices = spare ? [0, 1, 2, 0, 2, 3, 0, 1, count - 1] : [0, 1, 2, 0, 2, 3];
    const start = w.length;
    if (indexType === 5123) w.u16(...indices); else w.u32(...indices);
    const indexAccessor = accessor(view(start, w.length - start), indexType, indices.length, 'SCALAR');
    w.pad();
    doc.meshes[0].primitives.push({ attributes, indices: indexAccessor, material: part });
  });
  const bin = w.done();
  doc.buffers[0].byteLength = bin.length;
  return { doc, bin };
}

const parts = (mesh: { face: CardPart; rim: CardPart; back: CardPart }): [string, CardPart][] => [['face', mesh.face], ['rim', mesh.rim], ['back', mesh.back]];

// ---- the model the site ships ----

describe('the committed card model', () => {
  const mesh = readCardGlb(committed());

  it('has three parts whose arrays agree with each other', () => {
    for (const [name, part] of parts(mesh)) {
      const vertices = part.positions.length / 3;
      expect(Number.isInteger(vertices), name).toBe(true);
      expect(vertices, name).toBeGreaterThan(3);
      expect(part.normals.length, name).toBe(vertices * 3);
      expect(part.uvs.length, name).toBe(vertices * 2);
      expect(part.indices.length % 3, name).toBe(0);
      expect(part.indices.length, name).toBeGreaterThan(0);
      expect(Math.max(...part.indices), name).toBeLessThan(vertices);
    }
  });

  it('is a card: 63 by 87.86 by 1 mm, centred, its front at z = 0', () => {
    const size = [0.063, 0.08786, 0.001];
    for (let axis = 0; axis < 3; axis++) {
      const measured = mesh.max[axis] - mesh.min[axis];
      expect(Math.abs(measured - size[axis]) / size[axis]).toBeLessThan(0.005);
    }
    expect(mesh.max[0]).toBeCloseTo(0.0315, 5);
    expect(mesh.min[0]).toBeCloseTo(-0.0315, 5);
    expect(mesh.max[1]).toBeCloseTo(-mesh.min[1], 6);
    expect(mesh.max[2]).toBeCloseTo(0, 7);
    expect(mesh.min[2]).toBeCloseTo(-0.001, 7);
  });

  it('faces +Z: the flat of the face looks straight out, and its bevelled border still leans forward', () => {
    const { positions, normals } = mesh.face;
    let flat = 0;
    for (let i = 0; i < positions.length / 3; i++) {
      const nz = normals[i * 3 + 2];
      expect(nz).toBeGreaterThan(0.8);
      if (positions[i * 3 + 2] > -1e-6) { expect(nz).toBeGreaterThan(0.999); flat += 1; }
    }
    expect(flat).toBeGreaterThanOrEqual(positions.length / 6);     // at least half of the face is the flat
    for (let i = 0; i < mesh.back.normals.length / 3; i++) expect(mesh.back.normals[i * 3 + 2]).toBeLessThan(-0.4);
  });

  it('maps the artwork the right way up and the right way round', () => {
    const { positions, uvs } = mesh.face;
    const vertices = positions.length / 3;
    const extreme = (axis: number, sign: number) => {
      let best = 0;
      for (let i = 1; i < vertices; i++) if (sign * positions[i * 3 + axis] > sign * positions[best * 3 + axis]) best = i;
      return { u: uvs[best * 2], v: uvs[best * 2 + 1] };
    };
    expect(extreme(1, 1).v).toBeLessThan(0.1);        // the top of the card reads the top row of the image (glTF v = 0)
    expect(extreme(1, -1).v).toBeGreaterThan(0.9);
    expect(extreme(0, -1).u).toBeLessThan(0.1);       // the left of the card reads the left of the image
    expect(extreme(0, 1).u).toBeGreaterThan(0.9);
  });

  it('shows the whole artwork: the face reaches within half a percent of every edge of the image', () => {
    const { uvs } = mesh.face;
    let minU = 1, maxU = 0, minV = 1, maxV = 0;
    for (let i = 0; i < uvs.length; i += 2) {
      minU = Math.min(minU, uvs[i]); maxU = Math.max(maxU, uvs[i]);
      minV = Math.min(minV, uvs[i + 1]); maxV = Math.max(maxV, uvs[i + 1]);
    }
    expect(minU).toBeGreaterThanOrEqual(0); expect(minU).toBeLessThan(0.005);
    expect(maxU).toBeLessThanOrEqual(1); expect(maxU).toBeGreaterThan(0.995);
    expect(minV).toBeGreaterThanOrEqual(0); expect(minV).toBeLessThan(0.005);
    expect(maxV).toBeLessThanOrEqual(1); expect(maxV).toBeGreaterThan(0.995);
  });

  it('does not stretch the artwork: a millimetre across reads as much of the image as a millimetre up', () => {
    // the card's shape is the image's shape (1062 x 1481), so u per metre across times the width equals v per metre up times the height
    const { positions, uvs } = mesh.face;
    const flat: number[] = [];
    for (let i = 0; i < positions.length / 3; i++) if (positions[i * 3 + 2] > -1e-6) flat.push(i);
    for (const i of flat) {
      expect(uvs[i * 2]).toBeCloseTo(positions[i * 3] / 0.063 + 0.5, 3);
      expect(uvs[i * 2 + 1]).toBeCloseTo(0.5 - positions[i * 3 + 1] / (0.063 * 1481 / 1062), 3);
    }
  });

  it('has unit normals', () => {
    for (const [name, part] of parts(mesh)) {
      for (let i = 0; i < part.normals.length; i += 3) {
        expect(Math.hypot(part.normals[i], part.normals[i + 1], part.normals[i + 2]), name).toBeCloseTo(1, 3);
      }
    }
  });

  it('winds its triangles the way their normals face', () => {
    for (const [name, part] of parts(mesh)) {
      const p = part.positions, n = part.normals;
      for (let t = 0; t < part.indices.length; t += 3) {
        const [a, b, c] = [part.indices[t] * 3, part.indices[t + 1] * 3, part.indices[t + 2] * 3];
        const ux = p[b] - p[a], uy = p[b + 1] - p[a + 1], uz = p[b + 2] - p[a + 2];
        const vx = p[c] - p[a], vy = p[c + 1] - p[a + 1], vz = p[c + 2] - p[a + 2];
        const gx = uy * vz - uz * vy, gy = uz * vx - ux * vz, gz = ux * vy - uy * vx;
        const along = gx * (n[a] + n[b] + n[c]) + gy * (n[a + 1] + n[b + 1] + n[c + 1]) + gz * (n[a + 2] + n[b + 2] + n[c + 2]);
        expect(along, `${name} triangle ${t / 3}`).toBeGreaterThan(0);
      }
    }
  });

  it('hands back arrays of its own, not views of the file', () => {
    const buffer = committed();
    const read = readCardGlb(buffer);
    const before = Array.from(read.face.positions.slice(0, 6));
    new Uint8Array(buffer).fill(0);
    expect(Array.from(read.face.positions.slice(0, 6))).toEqual(before);
  });
});

// ---- any other file ----

describe('readCardGlb', () => {
  it('reads positions, normals, UVs and triangles number for number', () => {
    const { doc, bin } = squares();
    const mesh = readCardGlb(pack(doc, bin));
    expect(Array.from(mesh.face.positions)).toEqual([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0]);
    expect(Array.from(mesh.face.normals)).toEqual([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1]);
    expect(Array.from(mesh.face.uvs)).toEqual([0, 1, 1, 1, 1, 0, 0, 0]);
    expect(Array.from(mesh.face.indices)).toEqual([0, 1, 2, 0, 2, 3]);
    expect(Array.from(mesh.rim.positions.slice(0, 3))).toEqual([-1, -1, -0.5]);
    expect(Array.from(mesh.back.normals.slice(0, 3))).toEqual([0, 0, -1]);
    expect(mesh.min).toEqual([-1, -1, -1]);
    expect(mesh.max).toEqual([1, 1, 0]);
  });

  it('finds the parts by their material names, whatever the case and the order', () => {
    const { doc, bin } = squares();
    doc.materials = [{ name: 'card BACK.001' }, { name: 'Card Face' }, { name: 'The Rim' }];
    const mesh = readCardGlb(pack(doc, bin));
    expect(mesh.back.positions[2]).toBe(0);       // the first square, at z = 0, is now called the back
    expect(mesh.face.positions[2]).toBe(-0.5);
    expect(mesh.rim.positions[2]).toBe(-1);
  });

  it('reads a strided buffer view through its stride and the accessors\' offsets', () => {
    const packed = squares();
    const strided = squares({ interleaved: true });
    const a = readCardGlb(pack(packed.doc, packed.bin));
    const b = readCardGlb(pack(strided.doc, strided.bin));
    for (const name of ['face', 'rim', 'back'] as const) {
      expect(Array.from(b[name].positions)).toEqual(Array.from(a[name].positions));
      expect(Array.from(b[name].normals)).toEqual(Array.from(a[name].normals));
      expect(Array.from(b[name].uvs)).toEqual(Array.from(a[name].uvs));
      expect(Array.from(b[name].indices)).toEqual(Array.from(a[name].indices));
    }
  });

  it('hands back 16-bit indices whenever a part is small enough, whatever the file stored', () => {
    const { doc, bin } = squares({ indexType: 5125 });
    const mesh = readCardGlb(pack(doc, bin));
    expect(mesh.face.indices).toBeInstanceOf(Uint16Array);
    expect(Array.from(mesh.face.indices)).toEqual([0, 1, 2, 0, 2, 3]);
  });

  it('keeps 32-bit indices for a part with more than 65,536 vertices', () => {
    const { doc, bin } = squares({ indexType: 5125, spare: 65_533 });       // 65,537 vertices: the last is number 65,536
    const mesh = readCardGlb(pack(doc, bin));
    expect(mesh.face.positions.length).toBe(65_537 * 3);
    expect(mesh.face.indices).toBeInstanceOf(Uint32Array);
    expect(mesh.face.indices[8]).toBe(65_536);
    expect(mesh.rim.indices).toBeInstanceOf(Uint16Array);
  });

  it('reads a file that has more bytes after the glb than the glb says it has', () => {
    const { doc, bin } = squares();
    const glb = new Uint8Array(pack(doc, bin));
    const longer = new Uint8Array(glb.length + 64);
    longer.set(glb);
    expect(readCardGlb(longer.buffer).face.indices.length).toBe(6);
  });

  describe('refuses what it cannot read, and says why', () => {
    const refusals: [string, () => ArrayBuffer, RegExp][] = [
      ['a file of four bytes', () => new ArrayBuffer(4), /too short/],
      ['an empty file', () => new ArrayBuffer(0), /too short/],
      ['a file that is not a glb', () => new ArrayBuffer(64), /not a glb/],
      ['a glb of version 1', () => pack(squares().doc, squares().bin, { version: 1 }), /version 1/],
      ['a file cut off part way', () => committed().slice(0, 1000), /cut short/],
      ['JSON that does not parse', () => pack('{"asset": ', squares().bin), /JSON/],
      ['JSON that is not an object', () => pack('[1, 2]', squares().bin), /JSON/],
      ['a model with no binary chunk', () => pack(squares().doc, null), /binary chunk/],
      ['a Draco-compressed model', () => changed((doc) => { doc.extensionsRequired = ['KHR_draco_mesh_compression']; }), /Draco/],
      ['a model that needs another extension', () => changed((doc) => { doc.extensionsRequired = ['EXT_meshopt_compression']; }), /EXT_meshopt_compression/],
      ['a model with no rim', () => changed((doc) => { doc.meshes[0].primitives.splice(1, 1); }), /no rim/],
      ['a model with no meshes at all', () => changed((doc) => { doc.meshes = []; }), /no face/],
      ['a part it does not know', () => changed((doc) => { doc.materials[1].name = 'MiCar Card Slab'; }), /"MiCar Card Slab"/],
      ['a part with no material', () => changed((doc) => { doc.meshes[0].primitives[1].material = 7; }), /no material name/],
      ['two parts with the same role', () => changed((doc) => { doc.materials[1].name = 'Second Face'; }), /two parts.*face/],
      ['an accessor that runs past its buffer view', () => changed((doc) => { doc.accessors[0].count = 100_000; }), /accessor 0 is out of range/],
      ['a buffer view that runs past the binary chunk', () => changed((doc) => { doc.bufferViews[0].byteLength = 1e9; }), /out of range/],
      ['an accessor that points at no buffer view', () => changed((doc) => { doc.accessors[0].bufferView = 99; }), /accessor 0 .*buffer view/],
      ['a part that points at no accessor', () => changed((doc) => { doc.meshes[0].primitives[0].attributes.POSITION = 99; }), /accessor 99/],
      ['a stride smaller than its element', () => changed((doc) => { doc.bufferViews[0].byteStride = 4; }), /out of range/],
      ['a negative count', () => changed((doc) => { doc.accessors[0].count = -3; }), /out of range/],
      ['an index that points past the vertices', () => changed((doc, bin) => { new DataView(bin.buffer).setUint16(doc.bufferViews[3].byteOffset, 9999, true); }), /face.*index/],
      ['normals that do not match the positions', () => changed((doc) => { doc.accessors[1].count = 100; }), /face.*100 normals.*136/],
      ['UVs that do not match the positions', () => changed((doc) => { doc.accessors[2].count = 100; }), /face.*100 UVs.*136/],
      ['positions stored as shorts', () => changed((doc) => { doc.accessors[0].componentType = 5123; }), /component type 5123/],
      ['indices stored as bytes', () => changed((doc) => { doc.accessors[3].componentType = 5121; }), /component type 5121/],
      ['UVs with three components', () => changed((doc) => { doc.accessors[2].type = 'VEC3'; }), /VEC2/],
      ['a card that was moved', () => changed((doc) => { doc.nodes[0].translation = [0, 0.1, 0]; }), /transform/],
      ['lines instead of triangles', () => changed((doc) => { doc.meshes[0].primitives[0].mode = 1; }), /triangles/],
      ['a part with no indices', () => changed((doc) => { delete doc.meshes[0].primitives[0].indices; }), /no indices/],
      ['indices that are not whole triangles', () => changed((doc) => { doc.accessors[3].count = 605; }), /triangles/],
      ['a part with no normals', () => changed((doc) => { delete doc.meshes[0].primitives[2].attributes.NORMAL; }), /back.*NORMAL/],
      ['a sparse accessor', () => changed((doc) => { doc.accessors[0].sparse = {}; }), /sparse/],
      ['a position that is not a number', () => changed((doc, bin) => { new DataView(bin.buffer).setFloat32(doc.bufferViews[0].byteOffset, Number.NaN, true); }), /face.*not a number/],
      ['data kept in a separate file', () => changed((doc) => { doc.buffers[0].uri = 'card.bin'; }), /separate file/],
    ];
    for (const [what, make, message] of refusals) {
      it(what, () => {
        expect(() => readCardGlb(make())).toThrow(message);
      });
    }

    it('always says it is the card model that is wrong', () => {
      expect(() => readCardGlb(new ArrayBuffer(4))).toThrow(/^card model: /);
    });
  });
});
