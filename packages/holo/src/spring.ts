// The tilt spring. Two axes, each a damped spring pulled toward a target angle: x is pitch, y is yaw, in radians.
// Pure: a step takes a state and returns a new one, so the same motion can be replayed in a test.
export type Angles = { x: number; y: number };
export type Spring = { x: number; y: number; vx: number; vy: number };

const DEGREE = Math.PI / 180;

/**
 * k and c give a damping ratio of 0.77: the card overshoots its target by about two percent and does not ring.
 * It is stepped at 1/120 s however long the frame was, and a frame longer than 1/30 s (a stalled tab, a slow
 * phone) is treated as 1/30 s so the card never jumps. At rest means within restAngle of the target on both axes
 * and slower than restSpeed.
 */
export const SPRING = { k: 170, c: 20, step: 1 / 120, maxFrame: 1 / 30, restAngle: 0.02 * DEGREE, restSpeed: 0.05 * DEGREE } as const;

/** Flat and still. */
export const REST: Spring = { x: 0, y: 0, vx: 0, vy: 0 };

export function settled(s: Spring, target: Angles): boolean {
  return Math.abs(target.x - s.x) <= SPRING.restAngle && Math.abs(target.y - s.y) <= SPRING.restAngle
    && Math.abs(s.vx) <= SPRING.restSpeed && Math.abs(s.vy) <= SPRING.restSpeed;
}

/**
 * The state `dt` seconds later. A state that comes to rest is returned exactly on the target with no speed, so the
 * last frame drawn is the true resting pose. A `dt` that is zero, negative or not a number moves nothing.
 */
export function step(s: Spring, target: Angles, dt: number): Spring {
  if (!(dt > 0)) return { x: s.x, y: s.y, vx: s.vx, vy: s.vy };
  const time = Math.min(dt, SPRING.maxFrame);
  const steps = Math.max(1, Math.ceil(time / SPRING.step - 1e-9));
  const h = time / steps;
  let x = s.x, y = s.y, vx = s.vx, vy = s.vy;
  for (let i = 0; i < steps; i++) {
    vx += (SPRING.k * (target.x - x) - SPRING.c * vx) * h; x += vx * h;
    vy += (SPRING.k * (target.y - y) - SPRING.c * vy) * h; y += vy * h;
  }
  const next = { x, y, vx, vy };
  return settled(next, target) ? { x: target.x, y: target.y, vx: 0, vy: 0 } : next;
}
