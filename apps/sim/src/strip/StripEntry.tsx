import React, { useEffect, useRef, useState } from 'react';
import { useGameStore, loadSession } from '../store';
import { useLang, t } from '../i18n';

// The Strip's front door (/strip): join as a guest with the starting cash, or sign in. Reads the store only.
// What it may offer (Google, email) comes from GET /api/caps, fetched on mount; init.caps arrives too late for a card that unmounts on join.
const NAME_KEY = 'micar.name';
const readName = () => { try { return localStorage.getItem(NAME_KEY) || ''; } catch { return ''; } };
const writeName = (v: string) => { try { localStorage.setItem(NAME_KEY, v); } catch { /* storage blocked */ } };
const GSI_SRC = 'https://accounts.google.com/gsi/client';

const loadGsi = () => new Promise<any>((resolve, reject) => {
  const g = (window as any).google;
  if (g?.accounts?.id) return resolve(g);
  const s = document.createElement('script');
  s.src = GSI_SRC; s.async = true;
  s.onload = () => ((window as any).google?.accounts?.id ? resolve((window as any).google) : reject(new Error('gsi')));
  s.onerror = () => reject(new Error('gsi'));
  document.head.appendChild(s);
});

const BTN = 'w-full min-h-[48px] px-4 rounded-lg font-cond font-black italic uppercase tracking-wider text-base transition-all focus:outline-none focus:ring-4 focus:ring-market/30 disabled:opacity-60';

export function StripEntry() {
  const lang = useLang();
  const { connect, requestLink, loadCaps, setHoldCard } = useGameStore.getState();
  const caps = useGameStore(s => s.caps);
  const linkSent = useGameStore(s => s.linkSent);
  const joined = useGameStore(s => !!s.playerId);
  const connectFailed = useGameStore(s => s.connectFailed);
  const driveNotice = useGameStore(s => s.driveNotice);
  const [name, setName] = useState(readName);
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');
  const started = useRef(false);

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
    const m = /(?:^|[#&])link=([^&]+)/.exec(window.location.hash);
    if (m) {
      const token = decodeURIComponent(m[1]);
      try { history.replaceState(null, '', window.location.pathname + window.location.search); } catch { /* sandboxed */ }
      setBusy(true);
      connect({ mode: 'guest', name: readName() });
      const stop = useGameStore.subscribe((s) => {
        if (s.playerId) { stop(); useGameStore.getState().linkAccount({ magic: token }); }
      });
      return;
    }
    const session = loadSession();
    if (session) { setBusy(true); connect({ mode: 'session', session }); }
  }, [connect, loadCaps]);

  const race = () => {
    if (joined) { useGameStore.getState().clearDriveNotice(); setHoldCard(false); return; } // an email link is on its way: carry on as the guest already joined
    if (busy) return;
    const n = name.trim();
    writeName(n);
    setBusy(true);
    connect({ mode: 'guest', name: n });
  };

  const google = async () => {
    setNote('');
    const clientId = useGameStore.getState().caps.googleClientId;
    if (!clientId) { setNote(t(lang, 'strip.noGoogle')); return; }
    try {
      const g = await loadGsi();
      g.accounts.id.initialize({ client_id: clientId, callback: (r: { credential?: string }) => {
        if (!r?.credential) return;
        // sign-in links a guest, so join as one first if we have not
        const go = () => useGameStore.getState().linkAccount({ google: r.credential });
        if (useGameStore.getState().playerId) go();
        else { connect({ mode: 'guest', name: name.trim() }); const stop = useGameStore.subscribe((s) => { if (s.playerId) { stop(); go(); } }); }
      } });
      g.accounts.id.prompt();
    } catch { setNote(t(lang, 'strip.googleFail')); }
  };

  const sendLink = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!email.trim()) return;
    setNote(''); setHoldCard(true); // the card stays up for the answer instead of dropping into the world
    // the link signs a guest in, so the socket must exist first
    if (!useGameStore.getState().socket) connect({ mode: 'guest', name: name.trim() });
    const send = () => requestLink(email.trim());
    if (useGameStore.getState().playerId) send();
    else { const stop = useGameStore.subscribe((s) => { if (s.playerId) { stop(); send(); } }); }
  };

  return (
    <div className="h-[100dvh] overflow-y-auto overscroll-contain bg-night text-ink font-sans grid place-items-center px-4 py-8"
      style={{ backgroundImage: 'radial-gradient(ellipse 60% 50% at 50% 20%, #121a2a 0%, #0e1217 70%)' }}>
      <div aria-label={t(lang, 'strip.title')}
        className="rounded-2xl border border-white/10 bg-night-2/90 backdrop-blur-xl shadow-2xl p-6 md:p-7 flex flex-col gap-5 w-full max-w-md">
        <h1 className="font-cond italic font-black uppercase leading-[0.9] tracking-tight text-5xl">
          <span className="text-market">{t(lang, 'strip.title')}</span>
        </h1>
        <form className="flex flex-col gap-5" onSubmit={(e) => { e.preventDefault(); race(); }}>
        <label className="flex flex-col gap-2">
          <span className="font-cond font-semibold uppercase tracking-[0.14em] text-xs text-haze">{t(lang, 'strip.nameLabel')}</span>
          <input type="text" autoFocus maxLength={24} value={name} onChange={(e) => setName(e.target.value)}
            className="w-full min-h-[48px] bg-[#0a0d12] border border-[#3a4458] rounded-lg px-4 py-3 font-cond text-lg tracking-wide text-ink focus:outline-none focus:border-market focus:ring-4 focus:ring-market/20 transition-all" />
        </label>
        <button type="submit" disabled={busy && !joined} className={`${BTN} bg-market text-[#0b0d12] hover:brightness-110`}>
          {busy && !joined ? t(lang, 'strip.joining') : joined ? t(lang, 'strip.continue') : t(lang, 'strip.guest')}
        </button>
        </form>
        {caps.google && (
          <button type="button" onClick={google} className={`${BTN} bg-transparent text-[#c3cad8] border border-line hover:border-haze`}>
            {t(lang, 'strip.google')}
          </button>
        )}
        {caps.magic && (linkSent ? (
          <p role="status" className="font-cond text-market text-base">{t(lang, 'strip.linkSent')}</p>
        ) : (
          <form className="flex flex-col gap-2" onSubmit={sendLink}>
            <input type="email" aria-label={t(lang, 'strip.emailLabel')} placeholder={t(lang, 'strip.emailLabel')} value={email} onChange={(e) => setEmail(e.target.value)}
              className="w-full min-h-[48px] bg-[#0a0d12] border border-[#3a4458] rounded-lg px-4 py-3 text-ink focus:outline-none focus:border-market focus:ring-4 focus:ring-market/20" />
            <button type="submit" className={`${BTN} bg-transparent text-[#c3cad8] border border-line hover:border-haze`}>
              {t(lang, 'strip.emailLink')}
            </button>
          </form>
        ))}
        {(note || (joined && driveNotice)) && <p role="alert" className="text-sm text-red-300">{note || driveNotice}</p>}
        <p className="text-sm text-haze">{t(lang, 'strip.footnote')}</p>
      </div>
    </div>
  );
}
