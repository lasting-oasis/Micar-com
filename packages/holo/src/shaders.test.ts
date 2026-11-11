import { describe, expect, it } from 'vitest';
import { CARD_ATTRIBUTES, CARD_FRAGMENT, CARD_UNIFORMS, CARD_VERTEX, SHADOW_ATTRIBUTES, SHADOW_FRAGMENT, SHADOW_UNIFORMS, SHADOW_VERTEX } from './shaders';

// GLSL cannot be compiled in vitest; the browser smoke test does that. What can be pinned here is the contract
// between the sources and the renderer: a name card.ts looks up but the shader never declares comes back as a null
// location, and the card silently draws wrong.

function declared(source: string, kind: 'uniform' | 'attribute' | 'varying'): Map<string, string> {
  const found = new Map<string, string>();
  const pattern = new RegExp(`^\\s*${kind}\\s+(?:(?:lowp|mediump|highp)\\s+)?(\\w+)\\s+(\\w+)\\s*;`, 'gm');
  for (const match of source.matchAll(pattern)) found.set(match[2], match[1]);
  return found;
}
const names = (map: Map<string, string>): string[] => [...map.keys()].sort();

const programs = [
  { name: 'card', vertex: CARD_VERTEX, fragment: CARD_FRAGMENT, uniforms: CARD_UNIFORMS as readonly string[], attributes: CARD_ATTRIBUTES as readonly string[] },
  { name: 'shadow', vertex: SHADOW_VERTEX, fragment: SHADOW_FRAGMENT, uniforms: SHADOW_UNIFORMS as readonly string[], attributes: SHADOW_ATTRIBUTES as readonly string[] },
];

describe('the shaders', () => {
  for (const program of programs) {
    describe(program.name, () => {
      it('declares exactly the uniforms the renderer looks up', () => {
        const all = [...names(declared(program.vertex, 'uniform')), ...names(declared(program.fragment, 'uniform'))].sort();
        expect(all).toEqual([...program.uniforms].sort());
      });

      it('declares exactly the attributes the renderer binds, in the vertex shader', () => {
        expect(names(declared(program.vertex, 'attribute'))).toEqual([...program.attributes].sort());
        expect(names(declared(program.fragment, 'attribute'))).toEqual([]);
      });

      it('shares no uniform between its two shaders (they default to different precisions on some phones)', () => {
        const vertex = declared(program.vertex, 'uniform');
        for (const name of declared(program.fragment, 'uniform').keys()) expect(vertex.has(name), name).toBe(false);
      });

      it('hands the fragment shader every varying it reads, with the same type', () => {
        const out = declared(program.vertex, 'varying'), into = declared(program.fragment, 'varying');
        expect(names(into)).toEqual(names(out));
        for (const [name, type] of into) expect(out.get(name), name).toBe(type);
      });

      it('is GLSL ES 1.00, so the one source runs on WebGL 1 and WebGL 2', () => {
        for (const source of [program.vertex, program.fragment]) {
          expect(source).not.toMatch(/#version/);
          expect(source).not.toMatch(/\btexture\s*\(/);          // ES 3.00's name for texture2D
          expect(source).not.toMatch(/\blayout\s*\(/);
          expect(source).not.toMatch(/^\s*(in|out)\s+\w+\s+\w+\s*;/m);
        }
        expect(program.fragment).toMatch(/gl_FragColor/);
        expect(program.fragment).toMatch(/^\s*(#ifdef GL_FRAGMENT_PRECISION_HIGH|precision \w+ float;)/m);
      });

      it('balances its braces and brackets', () => {
        for (const source of [program.vertex, program.fragment]) {
          const code = source.replace(/\/\/.*$/gm, '');
          for (const [open, close] of [['{', '}'], ['(', ')'], ['[', ']']]) {
            expect(code.split(open).length, `${open} in ${program.name}`).toBe(code.split(close).length);
          }
        }
      });
    });
  }

  it('has no clock: nothing the renderer sends is a time, so a still card cannot move', () => {
    for (const name of [...CARD_UNIFORMS, ...SHADOW_UNIFORMS]) expect(name).not.toMatch(/time|clock|frame|tick|phase/i);
  });

  it('reads the artwork once, or three times for the prismatic foil, and nowhere else', () => {
    expect(CARD_FRAGMENT.match(/texture2D\s*\(/g)).toHaveLength(4);
    expect(SHADOW_FRAGMENT).not.toMatch(/texture2D/);
  });

  it('encodes the colour it decoded with the inverse function, so untouched artwork comes out as it went in', () => {
    expect(CARD_FRAGMENT).toMatch(/vec3 decode\(vec3 c\) \{ return pow\(c, vec3\(2\.2\)\); \}/);
    expect(CARD_FRAGMENT).toMatch(/vec3 encode\(vec3 c\) \{ return pow\(c, vec3\(1\.0 \/ 2\.2\)\); \}/);
  });
});
