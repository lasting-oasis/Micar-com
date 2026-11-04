// Shared look for every scene: the site's palette and fonts, paper cards on dark glass,
// and a few motion helpers so every element enters the same way.
import { loadFont } from '@remotion/fonts';
import type { CSSProperties, ReactNode } from 'react';
import { AbsoluteFill, Audio, Sequence, interpolate, spring, staticFile, useCurrentFrame, useVideoConfig } from 'remotion';

export const C = {
  glass: '#1e2329', glassDeep: '#15191e', glassInk: '#e7eaee', glassMuted: '#9aa3ad',
  paper: '#fbfbf8', paper2: '#f1f2ee', ink: '#18202b', ink2: '#4a5564', ink3: '#6b7583', rule: '#c9cdd2',
  blue: '#1f4e9c', blueSoft: '#dbe4f3', gain: '#2e7d4f', loss: '#b23a3a', paint: '#ffd23f', star: '#e0a52a',
};
export const FONT = { sans: 'Barlow, system-ui, sans-serif', cond: '"Barlow Condensed", Barlow, system-ui, sans-serif' };

const fonts: [string, string, string][] = [
  ['Barlow', '400', 'barlow-latin-400-normal.woff2'], ['Barlow', '500', 'barlow-latin-500-normal.woff2'], ['Barlow', '600', 'barlow-latin-600-normal.woff2'],
  ['Barlow Condensed', '500', 'barlow-condensed-latin-500-normal.woff2'], ['Barlow Condensed', '600', 'barlow-condensed-latin-600-normal.woff2'],
  ['Barlow Condensed', '700', 'barlow-condensed-latin-700-normal.woff2'], ['Barlow Condensed', '800', 'barlow-condensed-latin-800-normal.woff2'],
];
export const fontsReady = Promise.all(fonts.map(([family, weight, file]) => loadFont({ family, weight, url: staticFile(`fonts/${file}`) })));

export const usd = (n: number) => '$' + Math.round(n).toLocaleString('en-US');
export const signed = (n: number) => (n >= 0 ? '+' : '−') + usd(Math.abs(n));

/** A spring that starts at `from` frames in; 0→1. */
export function useIn(from: number, opts: { damping?: number; stiffness?: number; mass?: number } = {}) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  return spring({ frame: frame - from, fps, config: { damping: opts.damping ?? 16, stiffness: opts.stiffness ?? 120, mass: opts.mass ?? 0.9 } });
}
/** Linear 0→1 between two frames, clamped. */
export function useRamp(from: number, to: number) {
  const frame = useCurrentFrame();
  return interpolate(frame, [from, to], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
}
export const easeOut = (x: number) => 1 - Math.pow(1 - x, 3);

/** Rises 24px and fades in from `from`. */
export function Rise({ from, children, style, dist = 24 }: { from: number; children: ReactNode; style?: CSSProperties; dist?: number }) {
  const p = useIn(from);
  return <div style={{ opacity: p, transform: `translateY(${(1 - p) * dist}px)`, ...style }}>{children}</div>;
}

export function Glass({ children }: { children: ReactNode }) {
  return (
    <AbsoluteFill style={{ background: `radial-gradient(1200px 800px at 30% 20%, #262c34 0%, ${C.glass} 45%, ${C.glassDeep} 100%)`, color: C.glassInk, fontFamily: FONT.sans }}>
      {children}
    </AbsoluteFill>
  );
}

/** The scene fades in over the first 10 frames and out over the last 8, so cuts never pop. */
export function SceneFade({ children }: { children: ReactNode }) {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  const o = interpolate(frame, [0, 10, durationInFrames - 8, durationInFrames], [0, 1, 1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  return <AbsoluteFill style={{ opacity: o }}>{children}</AbsoluteFill>;
}

export function Paper({ children, style }: { children: ReactNode; style?: CSSProperties }) {
  return <div style={{ background: C.paper, color: C.ink, borderRadius: 10, boxShadow: '0 40px 80px -30px rgba(0,0,0,0.8)', ...style }}>{children}</div>;
}

export function Brand({ style }: { style?: CSSProperties }) {
  return <div style={{ position: 'absolute', top: 44, left: 72, fontFamily: FONT.cond, fontWeight: 600, fontSize: 30, letterSpacing: '-0.01em', color: C.glassInk, ...style }}>Nexus Valuation</div>;
}

/** The windshield-paint headline from the site. Paints on left to right from `from`. */
export function Painted({ lines, from, size = 150, style }: { lines: string[]; from: number; size?: number; style?: CSSProperties }) {
  const p = easeOut(useRamp(from, from + 26));
  const hangs = lines.some((l) => /[¿¡]/.test(l)); // an inverted mark hangs below the line; give the next line room
  return (
    <div style={{ fontFamily: FONT.cond, fontWeight: 800, fontSize: size, lineHeight: hangs ? 1.02 : 0.9, letterSpacing: '-0.01em', textTransform: 'uppercase', color: C.paint, transform: 'rotate(-2deg)', transformOrigin: 'left bottom',
      textShadow: '0 2px 0 #e0b22a, 0 6px 0 rgba(0,0,0,0.35), 0 24px 60px rgba(255,210,63,0.18)', clipPath: `inset(0 ${(1 - p) * 100}% 0 0)`, ...style }}>
      {lines.map((l) => <div key={l}>{l}</div>)}
    </div>
  );
}

/** A sound cue at a frame of the current scene. */
export function Cue({ at, src, volume = 1 }: { at: number; src: string; volume?: number }) {
  return (
    <Sequence from={at} layout="none">
      <Audio src={staticFile(`audio/${src}.wav`)} volume={volume} />
    </Sequence>
  );
}

/** A number counting up to `value`, starting at `from` over `frames`. */
export function Count({ value, from, frames = 26, format = usd, start = 0, style }: { value: number; from: number; frames?: number; format?: (n: number) => string; start?: number; style?: CSSProperties }) {
  const p = easeOut(useRamp(from, from + frames));
  return <span style={{ fontVariantNumeric: 'tabular-nums', ...style }}>{format(start + (value - start) * p)}</span>;
}

export const Check = ({ color = C.blue, size = 20 }: { color?: string; size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12.5l4.5 4.5L19 7" /></svg>
);
export const Star = ({ on, size = 30 }: { on: boolean; size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24"><path d="M12 2.5l2.9 6.2 6.8.8-5 4.7 1.3 6.8L12 17.6 6 21l1.3-6.8-5-4.7 6.8-.8z" fill={on ? C.star : 'none'} stroke={on ? '#c98f12' : C.rule} strokeWidth="1.6" strokeLinejoin="round" /></svg>
);
