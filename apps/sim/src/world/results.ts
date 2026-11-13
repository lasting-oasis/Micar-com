// What the results card shows for a finished event: the title, the event line and a row per car. Lap races
// (circuit, sprint, street X) add the gap to the winner, each car's best lap and the race's fastest lap.
// Pure, so it is tested without the scene.
import { EV_NAME } from './data';
import { fmtT } from './hud';
import { t, type Lang } from '../i18n';
import { usesLights } from './strip/lights';
import type { ActiveEvent, EventResults, Standing } from './strip/events';
import type { ShownResults } from './driveUi';

const ordinal = (n: number) => n + (n % 10 === 1 && n % 100 !== 11 ? 'st' : n % 10 === 2 && n % 100 !== 12 ? 'nd' : n % 10 === 3 && n % 100 !== 13 ? 'rd' : 'th');

export function shownResults(r: EventResults, lang: Lang): ShownResults {
  const laps = usesLights(r.type);
  const bests = r.list.map(p => p.best).filter((b): b is number => b != null && Number.isFinite(b));
  const fastest = bests.length ? Math.min(...bests) : null;
  const title = r.failed ? r.failed : r.pos === 1 ? t(lang, 'res.won') : t(lang, 'res.place').replace('{n}', lang === 'en' ? ordinal(r.pos) : String(r.pos));
  return {
    title, sub: `${EV_NAME[r.type]} · ${r.ev.name}`, pos: r.pos, failed: r.failed,
    rows: r.list.map((p, i) => {
      const txt = r.type === 'drift' ? (p.score ?? 0).toLocaleString('en-US') : p.ft != null ? fmtT(p.ft) + (p.estimated ? '*' : '') : t(lang, 'strip.ch.dnf');
      const name = p.me ? t(lang, 'res.you') : p.name, me = !!p.me;
      if (!laps) return { name, me, txt };
      const gap = i > 0 && p.gap != null && Number.isFinite(p.gap) && p.gap > 0 ? '+' + p.gap.toFixed(2) : '';
      return { name, me, txt, gap, best: p.best != null ? fmtT(p.best) : '--', fastest: fastest != null && p.best === fastest, color: p.color };
    }),
  };
}

/** The pause screen's session card: the event, lap, position, the player's last and best laps, and the car. */
export type PauseCard = { event: string; lap: string; pos: string; last: string; best: string; car: string };
/** null unless a lap race is counting or racing (the card has nothing to say about drag, drift or free roam) */
export function pauseCard(a: ActiveEvent, standings: Standing[], car: string): PauseCard | null {
  if (!usesLights(a.type) || (a.state !== 'count' && a.state !== 'race')) return null;
  const me = standings.findIndex(p => p.me);
  return {
    event: a.ev.name, lap: a.route.loop ? Math.min(a.laps, a.pLap + 1) + '/' + a.laps : '—',
    pos: (me + 1) + '/' + standings.length, last: fmtT(a.timing?.last('me')), best: fmtT(a.timing?.best('me')), car,
  };
}
