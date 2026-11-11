// A bare page for the card back: the canvas, the four foils and a readout. It is how the look is tuned (the
// screenshots in the pull request come from it) and what is published privately for a try on a real phone.
//   pnpm --filter @micar/holo demo          serve it
//   pnpm --filter @micar/holo demo:build    build it into packages/holo/dist-demo/index.html, one file
// Every file the card needs is carried inside the page (?inline), so the built page asks the network for nothing.
// ?foil=rainbow starts on that foil. ?still=1 shows the fallback stills instead of the live card.
import { FOIL_IDS, FOIL_LABELS, createHoloCard, webglAvailable } from '../src/index';
import type { FoilId, HoloCard } from '../src/index';
import meshUrl from '../../../apps/value/public/cards/card.glb?inline';
import avifUrl from '../../../apps/value/public/cards/back.avif?inline';
import webpUrl from '../../../apps/value/public/cards/back.webp?inline';
import glossStill from '../../../apps/value/public/cards/back-gloss.webp?inline';
import holoStill from '../../../apps/value/public/cards/back-holo.webp?inline';
import rainbowStill from '../../../apps/value/public/cards/back-rainbow.webp?inline';
import prismaticStill from '../../../apps/value/public/cards/back-prismatic.webp?inline';

const STILLS: Record<FoilId, string> = { gloss: glossStill, holo: holoStill, rainbow: rainbowStill, prismatic: prismaticStill };
const EARNED_BY: Record<FoilId, string> = { gloss: 'Common, Uncommon', holo: 'Rare', rainbow: 'Epic', prismatic: 'Legendary and up' };

const find = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;
const frame = find<HTMLDivElement>('frame'), still = find<HTMLImageElement>('still');
const foils = find<HTMLDivElement>('foils'), hint = find<HTMLParagraphElement>('hint'), readout = find<HTMLParagraphElement>('readout');

const params = new URLSearchParams(location.search);
const asked = params.get('foil');
let foil: FoilId = FOIL_IDS.find((id) => id === asked) ?? 'holo';
let card: HoloCard | null = null;
let canvas: HTMLCanvasElement | null = null;
let problem = '';

// How many frames the page has asked the browser for. It should stop climbing when the card comes to rest.
let frames = 0;
const requestFrame = window.requestAnimationFrame.bind(window);
window.requestAnimationFrame = (callback) => { frames += 1; report(); return requestFrame(callback); };

let version = '';

function report(): void {
  const size = canvas ? `${canvas.width} × ${canvas.height}` : 'still image';
  const context = canvas ? version || 'starting' : 'no WebGL';
  readout.innerHTML = problem
    ? `<span class="problem">${problem.replace(/[<&]/g, ' ')}</span>`
    : `${context} · ${size} · ${window.devicePixelRatio}× screen · <b>${frames}</b> frames asked for`;
}

function showStill(message: string): void {
  problem = message;
  card?.destroy();
  card = null;
  canvas?.remove();
  canvas = null;
  still.src = STILLS[foil];
  still.hidden = false;
  hint.textContent = 'A still picture: the live card could not be drawn here';
  report();
}

function choose(next: FoilId): void {
  foil = next;
  for (const button of Array.from(foils.querySelectorAll('button'))) button.setAttribute('aria-pressed', String(button.dataset.foil === foil));
  if (card) card.setFoil(foil);
  else still.src = STILLS[foil];
}

for (const id of FOIL_IDS) {
  const button = document.createElement('button');
  button.type = 'button';
  button.dataset.foil = id;
  button.innerHTML = `${FOIL_LABELS[id]}<small>${EARNED_BY[id]}</small>`;
  button.addEventListener('click', () => choose(id));
  foils.append(button);
}

if (params.get('still') || !webglAvailable()) {
  showStill(params.get('still') ? '' : 'This browser has no WebGL.');
} else {
  canvas = document.createElement('canvas');
  frame.append(canvas);
  card = createHoloCard({
    canvas, meshUrl, artUrls: [avifUrl, webpUrl], foil, touch: 'capture',
    reducedMotion: window.matchMedia('(prefers-reduced-motion: reduce)').matches,
    onError: (error) => { console.error(error); showStill(error.message); },
  });
  const drawn = canvas;
  // Asked only once the card has its context: asking sooner would make one with settings the card did not choose.
  card.ready.then(() => { version = drawn.getContext('webgl2') ? 'WebGL 2' : 'WebGL 1'; report(); }, () => {});
}
choose(foil);
report();
