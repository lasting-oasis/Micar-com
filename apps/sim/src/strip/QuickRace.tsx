// The counter's Quick race (Part 2): the ten circuits, each with its one quick event and how many are in its quick room
// now; a tap goes into that room, which the server finds or opens (world/race.ts quickEventOf, findQuick). A circuit
// above the player's stage is locked, as in the Races menu. The waiting room (Challenge.tsx) takes over once in.
import { useEffect, useMemo, useState } from 'react';
import { apiBase, useGameStore } from '../store';
import { t, useLang } from '../i18n';
import { useDriveUi } from '../world/driveUi';
import { TRACK_NAMES, stageOf } from '../world/data';
import { Lock } from '../world/RaceMenuScreen';
import { ALERT, CARD, GHOST, PICK, TITLE } from './Challenge';
import { denyKey, quickRows, raceLabel, waitingText } from './challengeCopy';

/** How often the counts are asked for while the card is open. */
const POLL_MS = 5000;

export function QuickRace() {
  const lang = useLang();
  const rep = useGameStore(s => s.strip?.rep ?? 0);
  const room = useGameStore(s => s.race);
  const denied = useGameStore(s => s.raceDenied);
  const rows = useMemo(() => quickRows(stageOf(rep)), [rep]);
  const [waiting, setWaiting] = useState<Record<string, number>>({});
  const [asked, setAsked] = useState<string | null>(null); // the circuit tapped: wait for the room, or for a refusal
  const close = () => useDriveUi.setState({ quickRace: false });
  // in a room now (the server found or opened it): the waiting room takes over
  useEffect(() => { if (room) close(); }, [room]);
  useEffect(() => { if (denied) setAsked(null); }, [denied]);
  // who is waiting where, while the card is open (GET /api/race/quick); offline, the counts stay as they were
  useEffect(() => {
    let live = true;
    const load = async () => {
      try {
        const r = await fetch(`${apiBase()}/api/race/quick`, { cache: 'no-store' });
        const body = await r.json() as { ok?: boolean; waiting?: unknown };
        if (live && body?.ok && body.waiting && typeof body.waiting === 'object') setWaiting(body.waiting as Record<string, number>);
      } catch { /* no answer: try again on the next round */ }
    };
    void load();
    const id = setInterval(load, POLL_MS);
    return () => { live = false; clearInterval(id); };
  }, []);

  const pick = (track: string) => { if (asked) return; setAsked(track); useGameStore.getState().quickRace(track); };

  return (
    <div className={CARD} role="dialog" aria-label={t(lang, 'strip.ch.quickTitle')}>
      <div className={`${TITLE} mb-3`}>{t(lang, 'strip.ch.quickTitle')}</div>
      <div className="flex flex-col gap-1.5 mb-3">
        {rows.map(r => {
          const n = Number(waiting[r.track]) || 0;
          return (
            <button key={r.track} type="button" data-track={r.track} disabled={r.locked || !!asked} aria-pressed={asked === r.track} onClick={() => pick(r.track)}
              className={`${PICK} flex items-center gap-3 disabled:cursor-not-allowed ${r.locked ? 'opacity-55' : ''}`}>
              <span className="flex-1 min-w-0">
                <span className="block font-extrabold text-lg leading-tight truncate">{TRACK_NAMES[r.track as keyof typeof TRACK_NAMES]?.[lang] ?? r.track}</span>
                <span className="block not-italic normal-case font-sans text-[13px] opacity-80 truncate">{raceLabel(r.eventId)}</span>
              </span>
              <span className="flex-none not-italic normal-case font-sans text-[13px] tabular-nums flex items-center gap-1">
                {r.locked ? <><Lock />{t(lang, 'races.stage').replace('{n}', String(r.stage))}</> : waitingText(lang, n)}
              </span>
            </button>
          );
        })}
      </div>
      <div className="sticky -bottom-5 -mx-5 -mb-5 px-5 pb-5 pt-3 bg-night border-t border-market/20">
        {denied && <p role="alert" className={`${ALERT} mb-2`}>{t(lang, denyKey(denied))}</p>}
        <button type="button" onClick={close} className={GHOST}>{t(lang, 'strip.ch.back')}</button>
      </div>
    </div>
  );
}
