// The five doors, in the order they appear on every MiCar surface, and where each one goes.
// Plain data: each app renders it with its own React (the apps pin different majors), sharing only this and strip.css.
export const SITE_URL = 'https://lasting-oasis.github.io/Micar-com/';
export const WORLD_URL = 'https://micar-sim.onrender.com/';
export const SHOP_URL = `${WORLD_URL}shop`;

export type Door = 'home' | 'value' | 'garage' | 'world' | 'dealers' | 'shops';
export const DOORS: { id: Door; label: string; href: string; soon?: boolean }[] = [
  { id: 'value', label: 'Value a car', href: `${SITE_URL}#/value` },
  { id: 'garage', label: 'Garage', href: `${SITE_URL}#/garage` },
  { id: 'world', label: 'World', href: WORLD_URL },
  { id: 'dealers', label: 'For dealers', href: `${SITE_URL}#/sticker` },
  { id: 'shops', label: 'For shops', href: SHOP_URL },
];

/** The key, as SVG path data for a 26×26 box (stroke 2.4, round caps). */
export const KEY_RING = { cx: 8.5, cy: 8.5, r: 5.5 };
export const KEY_PATH = 'M12.5 12.5 L23 23 M19 19 L22 16 M16 16 L19 13';

/** The strip's markup as a string, for static pages (the tuner) that have no React. */
export function stripHtml(current: Door, t: (en: string) => string = (s) => s): string {
  const doors = DOORS.map((d) => `<a href="${d.href}"${current === d.id ? ' aria-current="page"' : ''}>${t(d.label)}${d.soon ? `<em>${t('soon')}</em>` : ''}</a>`).join('');
  return `<div class="mc-strip" role="navigation" aria-label="MiCar"><a class="mc-home" href="${SITE_URL}"${current === 'home' ? ' aria-current="page"' : ''}><svg width="22" height="22" viewBox="0 0 26 26" aria-hidden="true" style="color:var(--mc-paint);flex:none"><circle cx="${KEY_RING.cx}" cy="${KEY_RING.cy}" r="${KEY_RING.r}" fill="none" stroke="currentColor" stroke-width="2.4"/><path d="${KEY_PATH}" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/></svg><span class="mc-wordmark"><span class="mc-mi">Mi</span>Car</span></a><nav class="mc-doors">${doors}</nav><div class="mc-right"></div></div>`;
}
