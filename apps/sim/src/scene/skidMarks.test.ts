import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { SkidMarks } from './skidMarks';

const alphas = (m: SkidMarks): number[] => {
  const mesh = m.mesh, a = mesh.geometry.getAttribute('color') as THREE.BufferAttribute, out: number[] = [];
  for (let i = 0; i < a.count; i++) out.push(a.getW(i));
  return out;
};

describe('SkidMarks', () => {
  it('lay 401 times keeps 400 quads live and draws 400 quads', () => {
    const m = new SkidMarks(new THREE.Scene());
    for (let i = 0; i < 401; i++) m.lay(i, 0, 0, .55);
    expect(m.count).toBe(400);
    expect(m.mesh.geometry.drawRange.count).toBe(400 * 6);
  });
  it('fade(10) takes every alpha to 0', () => {
    const m = new SkidMarks(new THREE.Scene());
    for (let i = 0; i < 10; i++) m.lay(i, 0, .3, .55);
    expect(Math.max(...alphas(m))).toBeCloseTo(.55);
    m.fade(10);
    expect(alphas(m).every(a => a === 0)).toBe(true);
  });
  it('clear resets count to 0', () => {
    const m = new SkidMarks(new THREE.Scene());
    m.lay(0, 0, 0, .5); m.lay(1, 0, 0, .5);
    expect(m.count).toBe(2);
    m.clear();
    expect(m.count).toBe(0);
    expect(m.mesh.geometry.drawRange.count).toBe(0);
  });
});
