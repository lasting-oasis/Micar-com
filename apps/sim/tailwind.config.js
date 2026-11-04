/** @type {import('tailwindcss').Config} */
// Colours come from packages/brand/src/tokens.ts (kept inline here because Tailwind 3 loads this file without the workspace).
// `market` is the game's accent, used on every button, border and glow: it is MiCar's windshield yellow.
// `blue` is remapped to brushed steel, `cyan` to the fluorescent tube blue; emerald stays as money and success.
const steel = { 50: '#f3f6fb', 100: '#e4e9f1', 200: '#cfd6e1', 300: '#aeb8c8', 400: '#8a95a8', 500: '#6b7486', 600: '#525b6d', 700: '#3a4150', 800: '#262d37', 900: '#161b22', 950: '#0e1217' };
const paint = { 50: '#fff9e0', 100: '#fff1b3', 200: '#ffe680', 300: '#ffdc4d', 400: '#ffd23f', 500: '#ffd23f', 600: '#e0b22a', 700: '#b88f1c', 800: '#8a6a12', 900: '#5c460a', 950: '#2e2305' };
const tube = { 50: '#eef3ff', 100: '#dbe6ff', 200: '#bcd6ff', 300: '#9bbcff', 400: '#79a6ff', 500: '#3d7bff', 600: '#2f63d6', 700: '#254dab', 800: '#1d3b82', 900: '#162c5e', 950: '#0d1a38' };
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        background: '#0e1217',
        night: { DEFAULT: '#0e1217', 2: '#161b22' },
        line: '#262d37',
        ink: '#e7eaee',
        haze: '#9aa3ad',
        paper: '#fbfbf8',
        success: '#10b981',
        market: '#ffd23f',
        paint,
        steel,
        blue: steel,
        cyan: tube,
        sky: tube,
        warning: '#ef4444',
      },
      fontFamily: {
        sans: ['Barlow', 'Helvetica Neue', 'Arial', 'sans-serif'],
        cond: ['Barlow Condensed', 'Arial Narrow', 'Impact', 'sans-serif'],
        marker: ['Permanent Marker', 'cursive'],
        mono: ['Barlow Condensed', 'ui-monospace', 'monospace'],
      },
    },
  },
  plugins: [],
}
