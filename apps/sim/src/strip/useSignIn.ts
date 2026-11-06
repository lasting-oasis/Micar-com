import React, { useEffect, useRef, useState } from 'react';
import { useGameStore } from '../store';
import { useLang, t } from '../i18n';

// Google and email-link sign-in, shared by the Strip's entry card and the account panel.
const GSI_SRC = 'https://accounts.google.com/gsi/client';
let gsiLoading: Promise<NonNullable<Window['google']>> | null = null;

/** Injects the GIS script once; a failed load may be retried. */
export const loadGsi = (): Promise<NonNullable<Window['google']>> => {
  if (window.google?.accounts?.id) return Promise.resolve(window.google);
  if (gsiLoading) return gsiLoading;
  gsiLoading = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = GSI_SRC; s.async = true;
    s.onload = () => (window.google?.accounts?.id ? resolve(window.google) : reject(new Error('gsi')));
    s.onerror = () => reject(new Error('gsi'));
    document.head.appendChild(s);
  }).catch((e) => { gsiLoading = null; document.querySelector(`script[src="${GSI_SRC}"]`)?.remove(); throw e; }) as Promise<NonNullable<Window['google']>>;
  return gsiLoading;
};

/** Runs `fn` now if a player has joined, else once, when one does. Returns a canceller. */
export const afterJoin = (fn: () => void): (() => void) => {
  if (useGameStore.getState().playerId) { fn(); return () => {}; }
  const stop = useGameStore.subscribe((s) => { if (s.playerId) { stop(); fn(); } });
  return stop;
};

// GIS is initialised once per page (a second initialize() makes Google warn); its callback goes to the hook that last
// started a sign-in.
let gsiInitFor: string | null = null;
let onCredential: ((credential: string) => void) | null = null;

/** Sign in with Google: the credential goes to `linkAccount`. `ensureGuest` joins first when there is no socket yet.
 *  One Tap first; when Google suppresses it (not displayed, or skipped), Google's own button is rendered into
 *  `buttonRef` (`fallback`) with a note to use it. */
export function useGoogleSignIn(ensureGuest?: () => void) {
  const lang = useLang();
  const [note, setNote] = useState('');
  const [fallback, setFallback] = useState(false);
  const buttonRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = buttonRef.current, g = window.google;
    if (!fallback || !el || !g?.accounts?.id) return;
    el.replaceChildren();
    g.accounts.id.renderButton(el, { type: 'standard', theme: 'filled_black', size: 'large', text: 'signin_with', shape: 'rectangular', width: Math.max(200, Math.min(400, el.offsetWidth || 300)) });
  }, [fallback]);

  const start = async () => {
    setNote('');
    const clientId = useGameStore.getState().caps.googleClientId;
    if (!clientId) { setNote(t(lang, 'strip.noGoogle')); return; }
    try {
      const g = await loadGsi();
      onCredential = (credential) => {
        // sign-in links a guest, so join as one first if there is no socket yet (never a second one while it connects)
        if (!useGameStore.getState().socket) ensureGuest?.();
        afterJoin(() => useGameStore.getState().linkAccount({ google: credential }));
      };
      if (gsiInitFor !== clientId) {
        g.accounts.id.initialize({ client_id: clientId, callback: (r) => { if (r?.credential) onCredential?.(r.credential); } });
        gsiInitFor = clientId;
      }
      g.accounts.id.prompt((n) => {
        if (n?.isNotDisplayed?.() || n?.isSkippedMoment?.()) { setNote(t(lang, 'strip.googleButton')); setFallback(true); }
      });
    } catch { setNote(t(lang, 'strip.googleFail')); }
  };
  return { start, note, fallback, buttonRef };
}

/** "Email me a link" (`ensureGuest` is given by the entry card only: it joins as a guest first and holds the card up): the address goes to `requestLink` once a player has joined; frees up after an answer, a refusal, a dead connection or 10 s. */
export function useEmailLink(ensureGuest?: () => void) {
  const lang = useLang();
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');
  const cancel = useRef<(() => void) | null>(null);
  const joined = useGameStore(s => !!s.playerId);
  const connectFailed = useGameStore(s => s.connectFailed);
  const linkSent = useGameStore(s => s.linkSent);
  const driveNotice = useGameStore(s => s.driveNotice);

  useEffect(() => () => { cancel.current?.(); }, []);
  useEffect(() => {
    if (!busy) return;
    if (linkSent || driveNotice) { setBusy(false); return; }
    if (connectFailed && !joined) { setBusy(false); setNote(t(lang, 'strip.joinFail')); return; }
    const timer = setTimeout(() => { setBusy(false); if (!joined) setNote(t(lang, 'strip.joinFail')); }, 10000);
    return () => clearTimeout(timer);
  }, [busy, joined, connectFailed, linkSent, driveNotice, lang]);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const addr = email.trim();
    if (!addr || busy) return;
    setNote(''); setBusy(true);
    useGameStore.setState({ linkSent: false, driveNotice: null });
    if (ensureGuest) useGameStore.getState().setHoldCard(true); // the entry card stays up for the answer instead of dropping into the world
    if (!useGameStore.getState().socket) ensureGuest?.();
    cancel.current?.(); // never two sends waiting on one join
    cancel.current = afterJoin(() => { cancel.current = null; useGameStore.getState().requestLink(addr); });
  };
  return { email, setEmail, submit, busy, note, linkSent };
}
