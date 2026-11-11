// The few 4 x 4 matrices the card needs. Column-major, the order WebGL takes them in, as plain arrays of sixteen
// numbers (uniformMatrix4fv accepts those, and the arithmetic stays in double precision until it is uploaded).
export type Mat4 = number[];

const identity = (): Mat4 => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

/** A perspective projection looking down -z. An aspect that is zero, negative or not a number is taken as square. */
export function perspective(fovY: number, aspect: number, near: number, far: number): Mat4 {
  const a = aspect > 0 && Number.isFinite(aspect) ? aspect : 1;
  const f = 1 / Math.tan(fovY / 2);
  const m = identity();
  m[0] = f / a; m[5] = f; m[10] = (far + near) / (near - far); m[11] = -1; m[14] = (2 * far * near) / (near - far); m[15] = 0;
  return m;
}

export function translation(x: number, y: number, z: number): Mat4 {
  const m = identity();
  m[12] = x; m[13] = y; m[14] = z;
  return m;
}

/** a · b: the matrix that applies b first, then a. */
export function multiply(a: Mat4, b: Mat4): Mat4 {
  const m: Mat4 = new Array<number>(16);
  for (let col = 0; col < 4; col++) {
    for (let row = 0; row < 4; row++) {
      m[col * 4 + row] = a[row] * b[col * 4] + a[4 + row] * b[col * 4 + 1] + a[8 + row] * b[col * 4 + 2] + a[12 + row] * b[col * 4 + 3];
    }
  }
  return m;
}

/**
 * The card's turn: pitch about x first, then yaw about y. With +z toward the viewer, a positive yaw moves the right
 * edge away and a negative pitch moves the top away.
 */
export function rotationYX(yaw: number, pitch: number): Mat4 {
  const cy = Math.cos(yaw), sy = Math.sin(yaw), cx = Math.cos(pitch), sx = Math.sin(pitch);
  const ry: Mat4 = [cy, 0, -sy, 0, 0, 1, 0, 0, sy, 0, cy, 0, 0, 0, 0, 1];
  const rx: Mat4 = [1, 0, 0, 0, 0, cx, sx, 0, 0, -sx, cx, 0, 0, 0, 0, 1];
  return multiply(ry, rx);
}

/** Where a point lands, after the divide by w. */
export function transformPoint(m: Mat4, p: readonly [number, number, number]): [number, number, number] {
  const w = m[3] * p[0] + m[7] * p[1] + m[11] * p[2] + m[15];
  return [
    (m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12]) / w,
    (m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13]) / w,
    (m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14]) / w,
  ];
}

/** How far back the camera sits for something one unit tall to fill `fill` of the picture's height. */
export function distanceToFill(fovY: number, fill: number): number {
  return 1 / (2 * fill * Math.tan(fovY / 2));
}
