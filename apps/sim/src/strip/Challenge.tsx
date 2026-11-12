// A challenge race's screens in the Strip's lobby: the counter's button, the card that makes a room (a race, a car, a
// link), and the waiting room. They read the store's room (store.ts keeps it as the server last sent it) and send what
// the player asks; the rules are the server's (world/race.ts). The words are in i18n.tsx (challengeCopy.ts lists them).
import { useEffect, useMemo, useRef, useState } from 'react';
import { useGameStore } from '../store';
import { useLang, t } from '../i18n';
import { useDriveUi } from '../world/driveUi';
import { EVENTS, TRACK_NAMES, stageOf } from '../world/data';
import { RENTAL_FLEET } from '../world/rental';
import { RACE_MIN } from '../world/race';
import { carLabel, denyKey, raceLabel, rowsOf, shareUrl } from './challengeCopy';

// the rental counter's card and rows (DriveLayer.tsx), so the lobby's three cards sit in the same place on any screen;
// on a phone these are tall, so they stop short of the right edge, where the lobby's pause button sits
const CARD = 'pointer-events-auto absolute left-4 right-16 bottom-6 md:left-auto md:right-20 md:bottom-auto md:top-24 md:w-[340px] max-h-[calc(100dvh-6rem)] overflow-y-auto overscroll-contain rounded-xl border border-market/40 bg-night/95 p-5 text-white shadow-2xl';
const ROW = 'w-full min-h-[44px] rounded-lg px-4 py-2 font-cond uppercase italic';
const TITLE = 'font-cond italic font-black uppercase text-2xl md:text-3xl leading-none text-market';
const LABEL = 'font-cond font-semibold uppercase tracking-[0.14em] text-xs text-haze';
const SOLID = `${ROW} bg-market text-night font-extrabold text-center disabled:opacity-45 disabled:cursor-not-allowed`;
const GHOST = `${ROW} border border-market/60 text-market font-extrabold text-center enabled:hover:bg-market enabled:hover:text-night disabled:opacity-45 disabled:cursor-not-allowed`;
const PICK = `${ROW} text-left border border-market/60 aria-pressed:bg-market aria-pressed:text-night hover:border-market`;
const ALERT = 'font-sans text-[13px] text-[#ff8a96]';
/** a line with a name in it: the name goes in as it is (a name may hold a "$", which replace() would read as a pattern) */
const fill = (text: string, hole: string, value: string) => text.replace(hole, () => value);

/** The counter's way into a challenge; under it, what the server last said about one (a link to a room that is gone or full). */
export function ChallengeButton() {
  const lang = useLang();
  const denied = useGameStore(s => s.raceDenied);
  return (
    <>
      <button type="button" className={`${SOLID} text-lg`} onClick={() => { useGameStore.setState({ raceDenied: null }); useDriveUi.setState({ challenge: true }); }}>
        {t(lang, 'strip.ch.button')}
      </button>
      {denied && <p role="alert" className={ALERT}>{t(lang, denyKey(denied))}</p>}
    </>
  );
}

/** Pick the race and the car. With no room this makes one (Get the link); in a room it is the host changing what is raced next. */
export function ChallengeSetup() {
  const lang = useLang();
  const rep = useGameStore(s => s.strip?.rep ?? 0);
  const room = useGameStore(s => s.race);
  const denied = useGameStore(s => s.raceDenied);
  const editing = useRef(!!useGameStore.getState().race).current;
  const races = useMemo(() => { const stage = stageOf(rep); return EVENTS.filter(e => e.stage <= stage); }, [rep]);
  const [eventId, setEventId] = useState(room?.eventId ?? races[0]?.id ?? '');
  const [car, setCar] = useState<string>(room?.car ?? 'ronin');
  const [asked, setAsked] = useState(false); // Get the link was pressed: wait for the room, or for a refusal
  const close = () => useDriveUi.setState({ challenge: false });
  useEffect(() => { if (denied) setAsked(false); }, [denied]);
  // the room arrived (made), or went away (while its host was changing the race): this card is done
  useEffect(() => { if (editing ? !room : !!room) close(); }, [editing, room]);

  const submit = () => {
    const st = useGameStore.getState();
    if (editing) { st.setRace(eventId, car); close(); return; } // a refusal, if any, shows in the waiting room
    if (asked) return;
    setAsked(true);
    st.createRace(eventId, car);
  };

  return (
    <div className={CARD} role="dialog" aria-label={t(lang, 'strip.ch.title')}>
      <div className={`${TITLE} mb-3`}>{t(lang, 'strip.ch.title')}</div>
      <div className={`${LABEL} mb-1.5`}>{t(lang, 'strip.ch.pickRace')}</div>
      <div className="flex flex-col gap-1.5 mb-3">
        {races.map(e => (
          <button key={e.id} type="button" aria-pressed={eventId === e.id} onClick={() => setEventId(e.id)} className={PICK}>
            <span className="block font-extrabold text-lg leading-tight">{raceLabel(e.id)}</span>
            <span className="block not-italic normal-case font-sans text-[13px] opacity-80">{TRACK_NAMES[e.track]?.[lang] ?? ''}</span>
          </button>
        ))}
      </div>
      <div className={`${LABEL} mb-1.5`}>{t(lang, 'strip.ch.pickCar')}</div>
      <div className="flex flex-col gap-1.5 mb-3">
        {RENTAL_FLEET.map(f => (
          <button key={f.key} type="button" aria-pressed={car === f.key} onClick={() => setCar(f.key)} className={PICK}>
            <span className="block font-extrabold text-lg leading-tight">{f.make} {f.model}</span>
            <span className="block not-italic normal-case font-sans text-[13px] opacity-80">{t(lang, f.blurb)}</span>
          </button>
        ))}
      </div>
      {/* the two lists are long: the way on stays in reach at the foot of the card */}
      <div className="sticky -bottom-5 -mx-5 -mb-5 px-5 pb-5 pt-3 bg-night border-t border-market/20">
        {denied && <p role="alert" className={`${ALERT} mb-2`}>{t(lang, denyKey(denied))}</p>}
        <div className="flex gap-2">
          <button type="button" onClick={close} className={GHOST}>{t(lang, 'strip.ch.back')}</button>
          <button type="button" onClick={submit} disabled={!eventId || (asked && !editing)} className={SOLID}>{t(lang, editing ? 'strip.ch.save' : 'strip.ch.getLink')}</button>
        </div>
      </div>
    </div>
  );
}

/** The room: its race and car, the link to send, who is here, and (for the host) the start. */
export function WaitingRoom() {
  const lang = useLang();
  const room = useGameStore(s => s.race);
  const me = useGameStore(s => s.playerId) ?? '';
  const denied = useGameStore(s => s.raceDenied);
  const note = useGameStore(s => s.raceNote);
  const [copied, setCopied] = useState(false);
  useEffect(() => { if (!copied) return; const id = setTimeout(() => setCopied(false), 2000); return () => clearTimeout(id); }, [copied]);
  if (!room) return null;

  const url = shareUrl(window.location.origin, room.code);
  const host = room.members.find(m => m.id === room.hostId), iHost = room.hostId === me;
  const racers = room.members.filter(m => m.state !== 'waiting');
  const drift = EVENTS.find(e => e.id === room.eventId)?.type === 'drift';
  const words = { dnf: t(lang, 'strip.ch.dnf'), racing: t(lang, 'strip.ch.racing') };
  const copy = async () => { try { await navigator.clipboard.writeText(url); setCopied(true); } catch { /* blocked here: the field below can still be copied by hand */ } };
  const canShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function';
  const share = async () => {
    try { await navigator.share({ title: 'MiCar', text: fill(t(lang, 'strip.ch.shareText'), '{race}', raceLabel(room.eventId)), url }); }
    catch (e) { if ((e as { name?: string } | null)?.name !== 'AbortError') void copy(); } // closing the share sheet is not a failure
  };
  /** what stands beside a member's name while a race is on: a tick once on the grid, then the time, or that they are out */
  const beside = (id: string): string => {
    const m = racers.find(r => r.id === id);
    if (!m || room.phase === 'open') return '';
    if (room.phase === 'loading') return m.state === 'ready' ? '✓' : '…';
    return rowsOf([m], me, drift, words)[0].txt;
  };

  return (
    <div className={CARD} role="dialog" aria-label={t(lang, 'strip.ch.room')}>
      <div className={`${TITLE} mb-2`}>{t(lang, 'strip.ch.room')}</div>
      <p className="font-cond font-extrabold italic uppercase text-xl leading-tight">{raceLabel(room.eventId)}</p>
      <p className="font-sans text-[13px] text-white/80 mb-3">{carLabel(room.car)}</p>

      <label className="block mb-3">
        <span className={`${LABEL} block mb-1.5`}>{t(lang, 'strip.ch.link')}</span>
        <input type="text" readOnly value={url} aria-label={t(lang, 'strip.ch.link')} onFocus={e => e.currentTarget.select()}
          className="w-full min-h-[44px] bg-[#0a0d12] border border-[#3a4458] rounded-lg px-3 py-2 font-sans text-[13px] text-ink focus:outline-none focus:border-market" />
        <span className="mt-2 flex gap-2">
          {canShare && <button type="button" onClick={share} className={SOLID}>{t(lang, 'strip.ch.share')}</button>}
          <button type="button" onClick={copy} className={canShare ? GHOST : SOLID}>{t(lang, copied ? 'strip.ch.copied' : 'strip.ch.copy')}</button>
        </span>
      </label>

      <ul className="flex flex-col gap-1 mb-3">
        {room.members.map(m => (
          <li key={m.id} className={`flex items-baseline justify-between gap-3 font-cond text-lg ${m.id === me ? 'text-market font-extrabold' : 'text-white/90'}`}>
            <span className="min-w-0 truncate">
              {m.name}
              {m.id === room.hostId && <span className="ml-2 text-xs uppercase tracking-widest text-haze">{t(lang, 'strip.ch.host')}</span>}
              {m.id === me && <span className="ml-2 text-xs uppercase tracking-widest text-haze">{t(lang, 'strip.ch.you')}</span>}
            </span>
            <span className="tabular-nums flex-none">{beside(m.id)}</span>
          </li>
        ))}
      </ul>

      <div className="flex flex-col gap-2" aria-live="polite">
        {room.phase === 'loading' && <p className="font-cond text-lg text-white/90">{fill(fill(t(lang, 'strip.ch.loading'), '{n}', String(racers.filter(m => m.state !== 'loading').length)), '{of}', String(racers.length))}</p>}
        {room.phase === 'racing' && <p className="font-cond text-lg text-white/90">{t(lang, 'strip.ch.inProgress')}</p>}
        {note === 'missed' && <p role="status" className={ALERT}>{t(lang, 'strip.ch.missed')}</p>}
        {room.note === 'called-off' && room.phase === 'open' && <p role="status" className={ALERT}>{t(lang, 'strip.ch.calledOff')}</p>}
        {denied && <p role="alert" className={ALERT}>{t(lang, denyKey(denied))}</p>}
        {room.phase === 'open' && iHost && (
          <>
            <button type="button" disabled={room.members.length < RACE_MIN} onClick={() => useGameStore.getState().startRace()} className={`${SOLID} text-lg`}>{t(lang, 'strip.ch.start')}</button>
            {room.members.length < RACE_MIN && <p className="font-sans text-[13px] text-haze">{t(lang, 'strip.ch.needTwo')}</p>}
            <button type="button" onClick={() => { useGameStore.setState({ raceDenied: null }); useDriveUi.setState({ challenge: true }); }} className={GHOST}>{t(lang, 'strip.ch.change')}</button>
          </>
        )}
        {room.phase === 'open' && !iHost && <p className="font-cond text-lg text-white/90">{fill(t(lang, 'strip.ch.waitingHost'), '{host}', host?.name ?? '')}</p>}
      </div>

      {room.last && room.phase === 'open' && (
        <div className="mt-3">
          <div className={`${LABEL} mb-1`}>{t(lang, 'strip.ch.last')} · {raceLabel(room.last.eventId)}</div>
          <ol className="space-y-0.5">
            {rowsOf(room.last.rows, me, EVENTS.find(e => e.id === room.last!.eventId)?.type === 'drift', words).map((r, i) => (
              <li key={i} className={`flex justify-between gap-3 font-cond text-base ${r.me ? 'text-market font-extrabold' : 'text-white/80'}`}><span className="min-w-0 truncate">{i + 1}. {r.name}</span><span className="tabular-nums flex-none">{r.txt}</span></li>
            ))}
          </ol>
        </div>
      )}

      <button type="button" onClick={() => useGameStore.getState().leaveRace()} className={`${GHOST} mt-3`}>{t(lang, 'strip.ch.leave')}</button>
    </div>
  );
}

/** On the grid before the count: how many are ready, then "Get ready" once the green light is named. */
export function StagingLine() {
  const lang = useLang();
  const staging = useDriveUi(s => s.staging);
  const room = useGameStore(s => s.race);
  if (!staging || !room) return null;
  const racers = room.members.filter(m => m.state === 'loading' || m.state === 'ready' || m.state === 'racing');
  const text = room.phase === 'loading'
    ? fill(fill(t(lang, 'strip.ch.loading'), '{n}', String(racers.filter(m => m.state !== 'loading').length)), '{of}', String(racers.length))
    : t(lang, 'strip.ch.getReady');
  return (
    <div className="absolute left-1/2 top-[28%] -translate-x-1/2 -translate-y-1/2 w-[min(92vw,720px)] text-center">
      <div role="status" className="font-cond italic font-black uppercase tracking-wide text-2xl md:text-4xl text-market drop-shadow-[0_2px_12px_rgba(0,0,0,.8)]">{text}</div>
    </div>
  );
}
