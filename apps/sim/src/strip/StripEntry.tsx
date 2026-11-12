import { useEffect, useRef, useState } from 'react';
import { useGameStore, loadSession, testerKeyFor, forgetTester, apiBase } from '../store';
import { useLang, t } from '../i18n';
import { useGoogleSignIn, useEmailLink } from './useSignIn';
import { KEY_FIELD_MAX, NAME_MAX, clipTyped, splitTesterName } from '../world/tester';
import { raceCode, withRace } from '../route';
import { carLabel, raceLabel } from './challengeCopy';

// The Strip's front door (/strip): join as a guest with the starting cash, or sign in. Reads the store only.
// What it may offer (Google, email) comes from GET /api/caps, fetched on mount; init.caps arrives too late for a card that unmounts on join.
// A challenge link (/strip?race=CODE) lands here too: the card says who is challenging, to what, and joining goes on into their room.
const NAME_KEY = 'micar.name';
const readName = () => { try { return localStorage.getItem(NAME_KEY) || ''; } catch { return ''; } };
const writeName = (v: string) => { try { localStorage.setItem(NAME_KEY, v); } catch { /* storage blocked */ } };
/** What a challenge link's room said of itself: still being asked, could not be asked, gone, or the invitation. */
type Invite = null | 'asking' | 'unknown' | 'gone' | { host: string; eventId: string; car: string; full: boolean };
const BTN = 'w-full min-h-[48px] px-4 rounded-lg font-cond font-black italic uppercase tracking-wider text-base transition-all focus:outline-none focus:ring-4 focus:ring-market/30 disabled:opacity-60';

export function StripEntry() {
  const lang = useLang();
  const { connect, loadCaps, setHoldCard } = useGameStore.getState();
  const caps = useGameStore(s => s.caps);
  const joined = useGameStore(s => !!s.playerId);
  const connectFailed = useGameStore(s => s.connectFailed);
  const driveNotice = useGameStore(s => s.driveNotice);
  const elsewhere = useGameStore(s => s.linkedElsewhere);
  const choice = useGameStore(s => s.linkChoice);
  const [name, setName] = useState(readName);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');
  const [, refresh] = useState(0);
  const started = useRef(false);
  // the room a challenge link names; the store joins it once the player is in the Strip (and again after a reconnect)
  const code = useRef(raceCode(window.location.search)).current;
  const [invite, setInvite] = useState<Invite>(code ? 'asking' : null);
  // Tester mode: the owner types the server's key after the name ("Name#key"). The key is sent beside the name, never
  // as part of it, and once the server has taken it this device remembers it for that name. A key the server does not
  // take refuses the join and says why; the next press then joins as an ordinary guest (the saved key is not sent again).
  const refused = useGameStore(s => s.joinRefused);
  const typed = splitTesterName(name);
  const savedKey = typed.key || refused ? undefined : testerKeyFor(typed.name);
  useEffect(() => { if (refused) setBusy(false); }, [refused]);

  // A join that never completes (server down, blocked socket) frees the button again.
  useEffect(() => {
    if (!busy || joined) return;
    if (connectFailed) { setBusy(false); setNote(t(lang, 'strip.joinFail')); return; }
    const timer = setTimeout(() => { setBusy(false); setNote(t(lang, 'strip.joinFail')); }, 10000);
    return () => clearTimeout(timer);
  }, [busy, joined, connectFailed, lang]);

  // On load: a saved session joins straight away; a magic link (#link=<token>) joins as a guest, then links.
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    loadCaps();
    if (code) {
      useGameStore.setState({ raceCode: code }); // before any join: the server's first answer is followed by the room
      fetch(`${apiBase()}/api/race/${code}`).then(async (r) => {
        if (r.status === 404) {
          // the room emptied out, or the server restarted: an ordinary guest card, and the address forgets the room
          setInvite('gone');
          if (useGameStore.getState().raceCode === code) useGameStore.setState({ raceCode: null });
          try { history.replaceState(null, '', withRace(window.location.href, null)); } catch { /* sandboxed */ }
          return;
        }
        const j = r.ok ? await r.json() : null;
        setInvite(j && j.ok === true && typeof j.eventId === 'string' && typeof j.car === 'string'
          ? { host: typeof j.host === 'string' ? j.host : '', eventId: j.eventId, car: j.car, full: Number(j.count) >= Number(j.max) }
          : 'unknown');
      }).catch(() => setInvite('unknown')); // could not ask: joining will find out
    }
    const m = /(?:^|[#&])link=([^&]+)/.exec(window.location.hash);
    if (m) {
      const token = decodeURIComponent(m[1]);
      try { history.replaceState(null, '', window.location.pathname + window.location.search); } catch { /* sandboxed */ }
      setBusy(true);
      setHoldCard(true); // the card stays up for the answer: this tab may only have opened the link for another one
      connect({ mode: 'guest', name: readName() });
      const stop = useGameStore.subscribe((s) => {
        if (s.playerId) { stop(); useGameStore.getState().linkAccount({ magic: token }); }
      });
      return;
    }
    const session = loadSession();
    if (session) { setBusy(true); connect({ mode: 'session', session }); }
  }, [connect, loadCaps, setHoldCard]);

  const race = () => {
    if (joined) { useGameStore.getState().clearDriveNotice(); setHoldCard(false); return; } // an email link is on its way: carry on as the guest already joined
    if (busy) return;
    setNote('');
    const n = typed.name;
    if (typed.key) setName(n); // the key does not stay on screen
    writeName(n);
    setBusy(true);
    const testerKey = typed.key ?? savedKey;
    connect({ mode: 'guest', name: n, ...(testerKey ? { testerKey } : {}) });
  };

  const joinGuest = () => connect({ mode: 'guest', name: typed.name });
  const g = useGoogleSignIn(joinGuest);
  const mail = useEmailLink(joinGuest);
  const challenged = invite !== null && invite !== 'asking' && invite !== 'gone';

  return (
    <div className="h-[100dvh] overflow-y-auto overscroll-contain bg-night text-ink font-sans grid place-items-center px-4 py-8"
      style={{ backgroundImage: 'radial-gradient(ellipse 60% 50% at 50% 20%, #121a2a 0%, #0e1217 70%)' }}>
      <div aria-label={t(lang, 'strip.title')}
        className="rounded-2xl border border-white/10 bg-night-2/90 backdrop-blur-xl shadow-2xl p-6 md:p-7 flex flex-col gap-5 w-full max-w-md">
        <h1 className="font-cond italic font-black uppercase leading-[0.9] tracking-tight text-5xl">
          <span className="text-market">{t(lang, 'strip.title')}</span>
        </h1>
        {challenged && (
          <div role="status" className="rounded-lg border border-market/40 bg-market/10 px-4 py-3">
            <p className="font-cond italic font-black uppercase text-2xl leading-tight text-market break-words">
              {invite !== 'unknown' && invite.host ? t(lang, 'strip.ch.invited').replace('{host}', () => invite.host) : t(lang, 'strip.ch.invitedPlain')}
            </p>
            {invite !== 'unknown' && <p className="font-cond text-lg text-ink">{[raceLabel(invite.eventId), carLabel(invite.car)].filter(Boolean).join(' · ')}</p>}
            {invite !== 'unknown' && invite.full && <p className="mt-1 text-sm text-red-300">{t(lang, 'strip.ch.full')}</p>}
          </div>
        )}
        {invite === 'gone' && <p role="status" className="font-cond text-lg text-red-300">{t(lang, 'strip.ch.gone')}</p>}
        {elsewhere && (
          <div className="flex flex-col gap-3" role="status">
            <p className="font-cond text-market text-xl leading-tight">{t(lang, 'strip.elsewhere')}</p>
            <button type="button" onClick={() => useGameStore.getState().continueHere()} className={`${BTN} bg-transparent text-[#c3cad8] border border-line hover:border-haze`}>
              {t(lang, 'strip.continueHere')}
            </button>
          </div>
        )}
        {choice && !elsewhere && (
          // Enter (and the focused default) signs in here: another tab is signed in only when this one picks it
          <form className="flex flex-col gap-3" onSubmit={(e) => { e.preventDefault(); useGameStore.getState().chooseLinkTarget('here'); }}>
            <p className="font-cond text-ink text-xl leading-tight break-words">{t(lang, 'strip.linkChoice').replace('{email}', choice.email)}</p>
            <button type="submit" autoFocus className={`${BTN} bg-market text-[#0b0d12] hover:brightness-110`}>{t(lang, 'strip.signHere')}</button>
            <button type="button" onClick={() => useGameStore.getState().chooseLinkTarget('requester')} className={`${BTN} bg-transparent text-[#c3cad8] border border-line hover:border-haze`}>
              {t(lang, 'strip.signThatTab')}
            </button>
          </form>
        )}
        {!elsewhere && !choice && <>
        <form className="flex flex-col gap-5" onSubmit={(e) => { e.preventDefault(); race(); }}>
        <label className="flex flex-col gap-2">
          <span className="font-cond font-semibold uppercase tracking-[0.14em] text-xs text-haze">{t(lang, 'strip.nameLabel')}</span>
          <input type="text" autoFocus maxLength={NAME_MAX + 1 + KEY_FIELD_MAX} autoComplete="off" autoCorrect="off" spellCheck={false} value={name} onChange={(e) => setName(clipTyped(e.target.value))}
            className="w-full min-h-[48px] bg-[#0a0d12] border border-[#3a4458] rounded-lg px-4 py-3 font-cond text-lg tracking-wide text-ink focus:outline-none focus:border-market focus:ring-4 focus:ring-market/20 transition-all" />
        </label>
        {savedKey && !joined && (
          <p className="-mt-3 flex items-center justify-between gap-3 text-[13px] text-haze">
            <span>{t(lang, 'strip.testerSaved')}</span>
            <button type="button" onClick={() => { forgetTester(); refresh(x => x + 1); }} className="min-h-[32px] px-2 underline underline-offset-2 hover:text-ink">{t(lang, 'strip.testerForget')}</button>
          </p>
        )}
        <button type="submit" disabled={busy && !joined} className={`${BTN} bg-market text-[#0b0d12] hover:brightness-110`}>
          {busy && !joined ? t(lang, 'strip.joining') : joined ? t(lang, 'strip.continue') : challenged ? t(lang, 'strip.ch.join') : t(lang, 'strip.guest')}
        </button>
        </form>
        {caps.google && (
          <button type="button" onClick={g.start} className={`${BTN} bg-transparent text-[#c3cad8] border border-line hover:border-haze`}>
            {t(lang, 'strip.google')}
          </button>
        )}
        {caps.google && <div ref={g.buttonRef} className={g.fallback ? 'flex justify-center min-h-[44px]' : 'hidden'} />}
        {caps.magic && (mail.linkSent ? (
          <p role="status" className="font-cond text-market text-base">{t(lang, 'strip.linkSent')}</p>
        ) : (
          <form className="flex flex-col gap-2" onSubmit={mail.submit}>
            <input type="email" aria-label={t(lang, 'strip.emailLabel')} placeholder={t(lang, 'strip.emailLabel')} value={mail.email} onChange={(e) => mail.setEmail(e.target.value)}
              className="w-full min-h-[48px] bg-[#0a0d12] border border-[#3a4458] rounded-lg px-4 py-3 text-ink focus:outline-none focus:border-market focus:ring-4 focus:ring-market/20" />
            <button type="submit" disabled={mail.busy} className={`${BTN} bg-transparent text-[#c3cad8] border border-line hover:border-haze`}>
              {t(lang, 'strip.emailLink')}
            </button>
          </form>
        ))}
        {(note || refused || g.note || mail.note || (joined && driveNotice)) && <p role="alert" className="text-sm text-red-300">{note || refused || g.note || mail.note || driveNotice}</p>}
        <p className="text-sm text-haze">{t(lang, 'strip.footnote')}</p>
        <p className="text-[11px] text-ink/50 text-center">{t(lang, 'strip.osm')}</p>
        </>}
      </div>
    </div>
  );
}
