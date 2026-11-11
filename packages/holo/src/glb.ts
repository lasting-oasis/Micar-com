// Reads the card model Blender exports (tools/blender/export_card.py): a binary glTF holding three parts, the face,
// the rim and the back, each with positions, normals, UVs and triangles. This is a reader for that one kind of
// file, not for glTF at large: anything it does not expect is refused with a message that says what is wrong, so a
// bad export shows the card's still instead of a broken card.

export type CardPart = { positions: Float32Array; normals: Float32Array; uvs: Float32Array; indices: Uint16Array | Uint32Array };
export type CardMesh = { face: CardPart; rim: CardPart; back: CardPart; min: [number, number, number]; max: [number, number, number] };

const MAGIC = 0x46546c67;          // "glTF"
const JSON_CHUNK = 0x4e4f534a;     // "JSON"
const BIN_CHUNK = 0x004e4942;      // "BIN\0"
const FLOAT = 5126, UNSIGNED_SHORT = 5123, UNSIGNED_INT = 5125, TRIANGLES = 4;
const WIDTHS: Record<string, number> = { SCALAR: 1, VEC2: 2, VEC3: 3 };
const PARTS = ['face', 'rim', 'back'] as const;
type PartName = (typeof PARTS)[number];

type Accessor = { bufferView?: number; byteOffset?: number; componentType?: number; count?: number; type?: string; sparse?: unknown };
type BufferView = { buffer?: number; byteOffset?: number; byteLength?: number; byteStride?: number };
type Primitive = { attributes?: Record<string, number>; indices?: number; material?: number; mode?: number };
type Gltf = {
  extensionsRequired?: string[];
  accessors?: Accessor[];
  bufferViews?: BufferView[];
  buffers?: { uri?: string }[];
  materials?: { name?: string }[];
  meshes?: { primitives?: Primitive[] }[];
  nodes?: { name?: string; mesh?: number; translation?: unknown; rotation?: unknown; scale?: unknown; matrix?: unknown }[];
};

function fail(message: string): never {
  throw new Error(`card model: ${message}`);
}

const whole = (n: unknown): n is number => typeof n === 'number' && Number.isInteger(n) && n >= 0;

/** The model's three parts, as arrays of their own. Throws an Error that says what is wrong with the file. */
export function readCardGlb(buffer: ArrayBuffer): CardMesh {
  if (buffer.byteLength < 20) fail(`the file is too short to be a glb (${buffer.byteLength} bytes)`);
  const file = new DataView(buffer);
  if (file.getUint32(0, true) !== MAGIC) fail('not a glb file');
  const version = file.getUint32(4, true);
  if (version !== 2) fail(`glb version ${version} is not supported (this reads version 2)`);
  const length = file.getUint32(8, true);
  if (length > buffer.byteLength) fail(`the file is cut short: it says ${length} bytes and has ${buffer.byteLength}`);

  // the chunks: JSON first, then the binary one
  let gltf: Gltf | null = null;
  let bin: DataView | null = null;
  for (let offset = 12; offset + 8 <= length;) {
    const size = file.getUint32(offset, true), kind = file.getUint32(offset + 4, true), start = offset + 8;
    if (start + size > length) fail('a chunk runs past the end of the file');
    if (!gltf) {
      if (kind !== JSON_CHUNK) fail('its first chunk is not JSON');
      gltf = parse(new Uint8Array(buffer, start, size));
    } else if (kind === BIN_CHUNK && !bin) {
      bin = new DataView(buffer, start, size);
    }
    offset = start + size;
  }
  if (!gltf) fail('it has no JSON chunk');
  if (!bin) fail('it has no binary chunk');
  const doc: Gltf = gltf, data: DataView = bin;

  for (const extension of doc.extensionsRequired ?? []) {
    if (extension === 'KHR_draco_mesh_compression') fail('Draco-compressed models are not supported; export without compression');
    fail(`it needs the extension ${extension}, which this does not read`);
  }
  if (doc.buffers?.[0]?.uri !== undefined) fail('its data is kept in a separate file; this reads the binary chunk only');
  for (const node of doc.nodes ?? []) {
    if (node.mesh !== undefined && (node.translation || node.rotation || node.scale || node.matrix)) {
      fail(`the object "${node.name ?? ''}" carries a transform; apply it in Blender before exporting`);
    }
  }

  /** Where an accessor's first element starts in the binary chunk, and the step from one element to the next. */
  function span(index: number, elementBytes: number): { start: number; stride: number; count: number } {
    const accessor = doc.accessors?.[index];
    if (!accessor) fail(`a part points at accessor ${index}, which the file does not have`);
    if (accessor.sparse !== undefined) fail(`accessor ${index} is sparse, which this does not read`);
    const view = whole(accessor.bufferView) ? doc.bufferViews?.[accessor.bufferView] : undefined;
    if (!view) fail(`accessor ${index} points at no buffer view`);
    if ((view.buffer ?? 0) !== 0) fail(`accessor ${index} reads a buffer other than the binary chunk`);
    const viewStart = view.byteOffset ?? 0, viewLength = view.byteLength, count = accessor.count;
    const stride = view.byteStride ?? elementBytes;
    const start = viewStart + (accessor.byteOffset ?? 0);
    if (!whole(viewStart) || !whole(viewLength) || !whole(count) || !whole(start) || !whole(stride) || stride < elementBytes) {
      fail(`accessor ${index} is out of range`);
    }
    const end = count === 0 ? start : start + (count - 1) * stride + elementBytes;
    if (end > viewStart + viewLength || viewStart + viewLength > data.byteLength) fail(`accessor ${index} is out of range`);
    return { start, stride, count };
  }

  function floats(index: number, type: 'VEC2' | 'VEC3', what: string): Float32Array {
    const accessor = doc.accessors?.[index];
    if (accessor && accessor.componentType !== FLOAT) fail(`${what} are stored with component type ${accessor.componentType}; this reads 32-bit floats (${FLOAT})`);
    if (accessor && accessor.type !== type) fail(`${what} are ${accessor.type}, not ${type}`);
    const width = WIDTHS[type];
    const { start, stride, count } = span(index, width * 4);
    const out = new Float32Array(count * width);
    for (let i = 0; i < count; i++) {
      for (let c = 0; c < width; c++) out[i * width + c] = data.getFloat32(start + i * stride + c * 4, true);
    }
    for (let i = 0; i < out.length; i++) {
      if (!Number.isFinite(out[i])) fail(`${what} hold a value that is not a number`);
    }
    return out;
  }

  function triangles(index: number, vertices: number, part: PartName): Uint16Array | Uint32Array {
    const accessor = doc.accessors?.[index];
    const kind = accessor?.componentType;
    if (accessor && kind !== UNSIGNED_SHORT && kind !== UNSIGNED_INT) {
      fail(`the ${part}'s indices are stored with component type ${kind}; this reads ${UNSIGNED_SHORT} and ${UNSIGNED_INT}`);
    }
    if (accessor && accessor.type !== 'SCALAR') fail(`the ${part}'s indices are ${accessor.type}, not SCALAR`);
    const bytes = kind === UNSIGNED_INT ? 4 : 2;
    const { start, stride, count } = span(index, bytes);
    if (count === 0 || count % 3 !== 0) fail(`the ${part}'s ${count} indices do not make whole triangles`);
    const out = vertices <= 65_536 ? new Uint16Array(count) : new Uint32Array(count);
    for (let i = 0; i < count; i++) {
      const value = bytes === 4 ? data.getUint32(start + i * stride, true) : data.getUint16(start + i * stride, true);
      if (value >= vertices) fail(`the ${part} has an index (${value}) that points past its ${vertices} vertices`);
      out[i] = value;
    }
    return out;
  }

  const found: Partial<Record<PartName, CardPart>> = {};
  for (const mesh of doc.meshes ?? []) {
    for (const primitive of mesh.primitives ?? []) {
      const name = whole(primitive.material) ? doc.materials?.[primitive.material]?.name : undefined;
      if (!name) fail('a part has no material name to tell it by');
      const lower = name.toLowerCase();
      const part = PARTS.find((p) => lower.includes(p));
      if (!part) fail(`the part "${name}" is not one this knows: it looks for face, rim and back in the material's name`);
      if (found[part]) fail(`two parts are named as the ${part}`);
      if ((primitive.mode ?? TRIANGLES) !== TRIANGLES) fail(`the ${part} is not drawn as triangles (mode ${primitive.mode})`);
      const attributes = primitive.attributes ?? {};
      for (const attribute of ['POSITION', 'NORMAL', 'TEXCOORD_0']) {
        if (!whole(attributes[attribute])) fail(`the ${part} has no ${attribute}`);
      }
      if (!whole(primitive.indices)) fail(`the ${part} has no indices`);
      const positions = floats(attributes.POSITION, 'VEC3', `the ${part}'s positions`);
      const normals = floats(attributes.NORMAL, 'VEC3', `the ${part}'s normals`);
      const uvs = floats(attributes.TEXCOORD_0, 'VEC2', `the ${part}'s UVs`);
      const vertices = positions.length / 3;
      if (normals.length !== vertices * 3) fail(`the ${part} has ${normals.length / 3} normals for ${vertices} positions`);
      if (uvs.length !== vertices * 2) fail(`the ${part} has ${uvs.length / 2} UVs for ${vertices} positions`);
      found[part] = { positions, normals, uvs, indices: triangles(primitive.indices, vertices, part) };
    }
  }
  const { face, rim, back } = found;
  if (!face) fail('it has no face');
  if (!rim) fail('it has no rim');
  if (!back) fail('it has no back');

  const min: [number, number, number] = [Infinity, Infinity, Infinity];
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  for (const part of [face, rim, back]) {
    for (let i = 0; i < part.positions.length; i++) {
      const axis = i % 3, value = part.positions[i];
      if (value < min[axis]) min[axis] = value;
      if (value > max[axis]) max[axis] = value;
    }
  }
  return { face, rim, back, min, max };
}

function parse(bytes: Uint8Array): Gltf {
  let value: unknown;
  try {
    value = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    fail('its JSON does not parse');
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) fail('its JSON is not a glTF document');
  return value as Gltf;
}
