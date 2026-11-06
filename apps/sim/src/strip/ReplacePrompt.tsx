import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useGameStore } from '../store';
import { useLang, t, type Lang } from '../i18n';

/** The warning copy: the money a sign-in would replace, with separators and no decimals. */
export const replaceCopy = (money: number, lang: Lang = 'en'): string =>
  t(lang, 'strip.replace').replace('{money}', '$' + Math.round(money).toLocaleString('en-US'));

/** Signing in to an account that already exists replaces this session's run: ask first. Shown whenever the server asked. */
export function ReplacePrompt() {
  const lang = useLang();
  const prompt = useGameStore(s => s.linkPrompt);
  const cancel = () => useGameStore.setState({ linkPrompt: null, pendingLink: null });
  const confirm = () => {
    const { pendingLink, linkAccount } = useGameStore.getState();
    if (pendingLink) linkAccount({ ...pendingLink, confirmReplace: true });
    else cancel();
  };
  useEffect(() => {
    if (!prompt) return;
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); cancel(); } };
    window.addEventListener('keydown', key, true);
    return () => window.removeEventListener('keydown', key, true);
  }, [prompt]);
  if (!prompt) return null;
  return createPortal(
    <div className="fixed inset-0 z-[1100] grid place-items-center bg-night/70 p-4 font-sans" role="alertdialog" aria-modal="true" aria-label={t(lang, 'strip.replaceTitle')}>
      <div className="w-[340px] max-w-full rounded-xl border border-market/40 bg-night p-5 text-white shadow-2xl flex flex-col gap-3">
        <div className="font-cond italic font-black uppercase text-2xl text-market leading-none">{t(lang, 'strip.replaceTitle')}</div>
        <p className="text-[15px] leading-snug text-white/90">{replaceCopy(prompt.money, lang)}</p>
        <button type="button" autoFocus onClick={confirm} className="min-h-[44px] rounded-lg bg-market py-2 font-cond font-extrabold uppercase italic text-night">{t(lang, 'strip.confirm')}</button>
        <button type="button" onClick={cancel} className="min-h-[44px] rounded-lg border border-market/60 py-2 font-cond font-extrabold uppercase italic text-market">{t(lang, 'strip.cancel')}</button>
      </div>
    </div>, document.body);
}
