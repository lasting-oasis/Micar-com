// The card's shaders, in GLSL ES 1.00 so one source serves WebGL 1 and WebGL 2.
//
// The face follows the recipe in docs/superpowers/specs/2026-11-11-holo-card-back-design.md, the same one the Blender
// preview's materials are built from (tools/blender/build_card.py). Everything the foil does comes from `ht`, the
// part of the half vector between the eye and the key light that lies in the card's own plane: it changes only
// when the card's angle does. There is no clock in here.
//
// No uniform is declared in both a vertex and a fragment shader: the two default to different precisions on some
// phones, and a uniform shared at two precisions does not link.

/** The names card.ts looks up. shaders.test.ts checks them against what the sources declare. */
export const CARD_ATTRIBUTES = ['aPosition', 'aNormal', 'aUv'] as const;
export const CARD_UNIFORMS = [
  'uProjection', 'uModelView', 'uTurn',
  'uArt', 'uPart', 'uKind', 'uRight', 'uUp', 'uLight', 'uSweep', 'uMask', 'uGain', 'uFacet', 'uDetail', 'uAspect',
] as const;
export const SHADOW_ATTRIBUTES = ['aCorner'] as const;
export const SHADOW_UNIFORMS = ['uProjection', 'uCentre', 'uHalf', 'uBox', 'uRadius', 'uBlur', 'uDark'] as const;

export const CARD_VERTEX = `
attribute vec3 aPosition;
attribute vec3 aNormal;
attribute vec2 aUv;
uniform mat4 uProjection;
uniform mat4 uModelView;
uniform mat3 uTurn;          // the card's rotation, for its normals
varying vec3 vView;          // where this point is, seen from the eye
varying vec3 vNormal;
varying vec2 vUv;
void main() {
  vec4 seen = uModelView * vec4(aPosition, 1.0);
  vView = seen.xyz;
  vNormal = uTurn * aNormal;
  vUv = aUv;
  gl_Position = uProjection * seen;
}
`;

export const CARD_FRAGMENT = `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif

uniform sampler2D uArt;      // the artwork, exactly as drawn; row 0 is its top
uniform float uPart;         // 0 the face, 1 the rim, 2 the back
uniform float uKind;         // 0 gloss, 1 holo, 2 rainbow, 3 prismatic
uniform vec3 uRight;         // the card's own right and up, seen from the eye
uniform vec3 uUp;
uniform vec3 uLight;         // toward the key light, fixed to the eye
uniform vec4 uSweep;         // K, S, K2, S2
uniform vec4 uMask;          // m0, m1, cover, metal
uniform vec4 uGain;          // strength, add, mul, sat
uniform vec4 uFacet;         // facets across the card's width, refr, amp, lobe
uniform vec4 uDetail;        // facet edge width, sparkle, grain cells across the width, flake cells across the width
uniform float uAspect;       // the card's height over its width

varying vec3 vView;
varying vec3 vNormal;
varying vec2 vUv;

// The artwork is stored the way screens show it. Light is added in linear terms and encoded once at the end; the
// two functions are exact inverses, so with no light added the artwork comes out as it went in.
vec3 decode(vec3 c) { return pow(c, vec3(2.2)); }
vec3 encode(vec3 c) { return pow(c, vec3(1.0 / 2.2)); }
float luminance(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }

// Hashes without sine (Dave Hoskins): the same on every GPU, which sine-based ones are not.
float hash12(vec2 p) {
  vec3 q = fract(vec3(p.xyx) * 0.1031);
  q += dot(q, q.yzx + 33.33);
  return fract((q.x + q.y) * q.z);
}
vec3 hash32(vec2 p) {
  vec3 q = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973));
  q += dot(q, q.yxz + 33.33);
  return fract((q.xxy + q.yzz) * q.zyx);
}
vec3 hash33(vec3 p) {
  vec3 q = fract(p * vec3(0.1031, 0.1030, 0.0973));
  q += dot(q, q.yxz + 33.33);
  return fract((q.xxy + q.yxx) * q.zyx);
}
float grainNoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash12(i), hash12(i + vec2(1.0, 0.0)), f.x), mix(hash12(i + vec2(0.0, 1.0)), hash12(i + vec2(1.0, 1.0)), f.x), f.y);
}

// A fully bright colour of the given hue.
vec3 spectrum(float hue, float sat) {
  vec3 k = clamp(abs(fract(hue + vec3(0.0, 2.0 / 3.0, 1.0 / 3.0)) * 6.0 - 3.0) - 1.0, 0.0, 1.0);
  return mix(vec3(1.0), k, sat);
}
// A soft brightness band riding on the colour bands.
float band(float phase) {
  float c = 0.5 + 0.5 * cos(3.14159265 * phase);
  return c * c;
}

// A small studio, seen by reflection. The clear coat mirrors it sharply: a key softbox up and to the left (where
// uLight is) and a narrow cooler strip to the right, both with soft edges, in a room that is otherwise black. So
// with the card flat, when neither light is in the mirror, the coat adds nothing and the artwork is untouched.
vec3 studioSharp(vec3 d) {
  vec3 across = normalize(vec3(uLight.z, 0.0, -uLight.x));
  vec3 upward = cross(uLight, across);
  vec2 k = abs(vec2(dot(d, across), dot(d, upward))) / vec2(0.075, 0.12);
  float key = (1.0 - smoothstep(0.35, 1.30, max(k.x, k.y))) * step(0.0, dot(d, uLight));
  vec2 t = abs(vec2(dot(d, vec3(0.799, 0.0, -0.601)), d.y - 0.05)) / vec2(0.045, 0.34);
  float strip = (1.0 - smoothstep(0.40, 1.30, max(t.x, t.y))) * step(0.0, dot(d, vec3(0.600, 0.050, 0.798)));
  return key * vec3(1.0, 0.97, 0.92) * 2.6 + strip * vec3(0.72, 0.84, 1.0) * 1.6;
}
// The same studio out of focus, with a low warm bounce and a dim room: what the rim and the metal under the foil
// throw back.
vec3 studioSoft(vec3 d) {
  float key = pow(max(dot(d, uLight), 0.0), 9.0);
  float strip = pow(max(dot(d, vec3(0.600, 0.050, 0.798)), 0.0), 7.0);
  float bounce = pow(max(dot(d, vec3(0.100, -0.796, 0.597)), 0.0), 4.0);
  vec3 room = mix(vec3(0.016, 0.017, 0.022), vec3(0.085, 0.095, 0.115), smoothstep(-0.6, 0.9, d.y));
  return room + key * vec3(1.0, 0.97, 0.92) * 1.5 + strip * vec3(0.72, 0.84, 1.0) * 0.8 + bounce * vec3(1.0, 0.9, 0.8) * 0.3;
}

vec3 face(vec3 N, vec3 V, vec3 R, float fresnel) {
  vec3 H = normalize(V + uLight);
  vec2 ht = vec2(dot(H, uRight), dot(H, uUp));
  vec2 uv = vec2(vUv.x, 1.0 - vUv.y);            // the recipe's own space: v runs up the card
  vec2 square = uv * vec2(1.0, uAspect);         // the same in equal units both ways

  vec3 art;
  vec3 colour = vec3(0.0);
  float mask = 0.0;
  float intensity = 0.0;
  float grain = (grainNoise(square * uDetail.z) - 0.5) * 0.14;

  if (uKind > 2.5) {
    // Prismatic: a lattice of triangular facets, each tilted its own way.
    vec2 p = square * uFacet.x;
    float b = p.y * 1.1547005;
    float a = p.x - 0.5 * b;
    vec2 f = fract(vec2(a, b));
    float s = f.x + f.y;
    float upper = step(1.0, s);
    vec3 random = hash33(vec3(floor(vec2(a, b)), upper));
    vec2 tilt = (random.xy - 0.5) * 2.0;
    float inLower = min(min(f.x, f.y), 1.0 - s);
    float inUpper = min(min(1.0 - f.x, 1.0 - f.y), s - 1.0);
    float edge = smoothstep(0.0, uDetail.x, mix(inLower, inUpper, upper));
    // The art is seen through each facet a little displaced, its colours pulled slightly apart. The displacement
    // fades to nothing near the card's border, so the frame of the art stays crisp.
    float border = min(min(vUv.x, 1.0 - vUv.x), min(vUv.y, 1.0 - vUv.y) * uAspect);
    vec2 shift = tilt * smoothstep(0.03, 0.10, border) * uFacet.y * vec2(1.0, -1.0 / uAspect);
    art = decode(vec3(texture2D(uArt, vUv + shift * 0.6).r, texture2D(uArt, vUv + shift).g, texture2D(uArt, vUv + shift * 1.4).b));
    vec2 facet = ht - tilt * uFacet.z;
    float lobe = clamp(1.0 - length(facet) / uFacet.w, 0.0, 1.0);
    lobe *= lobe;
    float phase = dot(facet, vec2(0.94, 0.34)) * uSweep.x + dot(uv, vec2(0.7, 0.7)) * uSweep.y + random.z + grain;
    colour = spectrum(fract(phase), uGain.w);
    mask = mix(uMask.z, 1.0, smoothstep(uMask.x, uMask.y, luminance(art)));
    intensity = mask * uGain.x * (0.22 + 0.78 * lobe) * (0.75 + 0.25 * edge) + (1.0 - edge) * mask * 0.16;
  } else {
    art = decode(texture2D(uArt, vUv).rgb);
    if (uKind > 0.5) {
      mask = mix(uMask.z, 1.0, smoothstep(uMask.x, uMask.y, luminance(art)));
      vec2 across = uKind > 1.5 ? vec2(0.75, 0.66) : vec2(0.8, 0.6);
      float phase = dot(ht, vec2(0.94, 0.34)) * uSweep.x + dot(uv, across) * uSweep.y + grain;
      if (uKind > 1.5) {
        // Rainbow: a second set of bands crossing the first.
        float second = dot(ht, vec2(-0.34, 0.94)) * uSweep.z + dot(uv, vec2(-0.6, 0.8)) * uSweep.w + grain + 0.33;
        colour = 0.58 * spectrum(fract(phase), uGain.w) + 0.42 * spectrum(fract(second), uGain.w);
        intensity = mask * uGain.x * (0.55 + 0.45 * band(second));
      } else {
        colour = spectrum(fract(phase), uGain.w);
        intensity = mask * uGain.x * (0.3 + 0.7 * band(phase));
      }
    }
  }

  // The card itself: the artwork, a touch brighter turned toward the light and a touch darker turned away. Flat
  // on, the factor is exactly one.
  vec3 lit = art * (1.0 + 0.35 * (dot(N, uLight) - uLight.z));

  if (uKind > 0.5) {
    // Light off the foil is tinted by the ink over it (mul), plus a share that shows on dark ink too (add).
    lit += colour * (art * uGain.z + uGain.y) * intensity;
    // Sparkle: flakes on three cells in ten, each lit only when the half vector lines up with its own tilt. The
    // tilts are spread around where the half vector sits with the card flat, so every flake has an angle within
    // the card's reach at which it lights.
    vec2 q = square * uDetail.w;
    vec2 cell = floor(q);
    vec3 flake = hash32(cell);
    vec2 centre = 0.5 + (hash32(cell + 71.3).xy - 0.5) * 0.3;
    vec2 atRest = normalize(uLight + vec3(0.0, 0.0, 1.0)).xy;
    float glint = clamp(1.0 - length(ht - atRest - (flake.xy - 0.5) * 0.8) / 0.16, 0.0, 1.0);
    float gate = step(0.70, flake.z) * (1.0 - smoothstep(0.24, 0.36, length(fract(q) - centre)));
    lit += (0.35 * colour + 0.65) * glint * glint * gate * uDetail.y * (0.45 + 0.55 * mask);
    // The bright, foiled parts of the art also throw the studio back like metal.
    lit += studioSoft(R) * art * mask * uMask.w * 0.5;
  }
  // The clear coat over everything: a mirror that strengthens at grazing angles.
  return lit + studioSharp(R) * fresnel;
}

void main() {
  vec3 N = normalize(vNormal);
  vec3 V = normalize(-vView);
  vec3 R = reflect(-V, N);
  float fresnel = 0.04 + 0.96 * pow(1.0 - max(dot(N, V), 0.0), 5.0);
  vec3 colour;
  if (uPart < 0.5) {
    colour = face(N, V, R, fresnel);
  } else if (uPart < 1.5) {
    // The rim: brushed metal, lit by the studio alone.
    colour = vec3(0.80, 0.82, 0.86) * (0.05 + studioSoft(R) * mix(1.0, 1.6, fresnel));
  } else {
    colour = vec3(0.020, 0.022, 0.030) + studioSharp(R) * fresnel;
  }
  gl_FragColor = vec4(encode(clamp(colour, 0.0, 1.0)), 1.0);
}
`;

// The shadow: a soft rounded rectangle on a quad behind the card.
export const SHADOW_VERTEX = `
attribute vec2 aCorner;
uniform mat4 uProjection;
uniform vec3 uCentre;        // where the shadow lies, seen from the eye
uniform vec2 uHalf;          // half the quad's size
varying vec2 vAt;
void main() {
  vAt = aCorner * uHalf;
  gl_Position = uProjection * vec4(uCentre + vec3(vAt, 0.0), 1.0);
}
`;

export const SHADOW_FRAGMENT = `
precision mediump float;
uniform vec2 uBox;           // half the card's size
uniform float uRadius;       // its corner radius
uniform float uBlur;
uniform float uDark;
varying vec2 vAt;
void main() {
  vec2 q = abs(vAt) - (uBox - uRadius);
  float d = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - uRadius;
  gl_FragColor = vec4(0.0, 0.0, 0.0, uDark * (1.0 - smoothstep(-uBlur, uBlur, d)));
}
`;
