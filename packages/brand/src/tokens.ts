// The same tokens as tokens.css, for Tailwind configs and three.js materials.
export const colors = {
  night: '#0e1217', night2: '#161b22', line: '#262d37', ink: '#e7eaee', haze: '#9aa3ad',
  paint: '#ffd23f', paint2: '#e0b22a', tube: '#3d7bff', tube2: '#79a6ff',
  chromeHi: '#f3f6fb', chromeLo: '#5d6678', paper: '#fbfbf8', paperInk: '#18202b', gain: '#5fbf86', loss: '#e07878',
} as const;
/** A grey-blue scale that reads as brushed steel: replaces generic blue scales in Tailwind configs. */
export const steel = { 50: '#f3f6fb', 100: '#e4e9f1', 200: '#cfd6e1', 300: '#aeb8c8', 400: '#8a95a8', 500: '#6b7486', 600: '#525b6d', 700: '#3a4150', 800: '#262d37', 900: '#161b22', 950: '#0e1217' } as const;
/** The accent as a scale, so `paint-400`-style classes resolve to the yellow and its shades. */
export const paint = { 50: '#fff9e0', 100: '#fff1b3', 200: '#ffe680', 300: '#ffdc4d', 400: '#ffd23f', 500: '#ffd23f', 600: '#e0b22a', 700: '#b88f1c', 800: '#8a6a12', 900: '#5c460a', 950: '#2e2305' } as const;
export const fonts = { cond: ['Barlow Condensed', 'Arial Narrow', 'Impact', 'sans-serif'], body: ['Barlow', 'Helvetica Neue', 'Arial', 'sans-serif'], marker: ['Permanent Marker', 'cursive'] } as const;
export const FONTS_URL = 'https://fonts.googleapis.com/css2?family=Barlow:wght@400;500;600;700&family=Barlow+Condensed:ital,wght@0,500;0,600;0,700;0,800;1,700;1,800;1,900&family=Permanent+Marker&display=swap';
