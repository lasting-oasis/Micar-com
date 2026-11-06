import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useGameStore } from '../store';
import { useDriveUi } from '../world/driveUi';
import { useLang, t } from '../i18n';
import { useGoogleSignIn, useEmailLink } from './useSignIn';

const btn = 'w-full min-h-[44px] rounded-lg px-4 py-2 font-cond font-extrabold uppercase italic';
const ghost = `${btn} border border-market/60 text-market disabled:opacity-60`;
const close = () => useDriveUi.setState({ account: false });

/** Who you are on the Strip: the identity line, today's allowance, and the ways in and out. Opens on `useDriveUi.account`. */
export function AccountPanel() {
  const lang = useLang();
  const open = useDriveUi(s => s.account);
  const lobby = useDriveUi(s => s.lobby); // signing out ends the run: only from the lobby, never mid-drive
  const account = useGameStore(s => s.account);
  const caps = useGameStore(s => s.caps);
  const notice = useGameStore(s => s.driveNotice);
  const google = useGoogleSignIn();
  const mail = useEmailLink();

  // Esc closes the panel and nothing else: captured before the pause menu's Esc sees it
  useEffect(() => {
    if (!open) return;
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); close(); } };
    window.addEventListener('keydown', key, true);
    return () => window.removeEventListener('keydown', key, true);
  }, [open]);
  if (!open) return null;

  const id = account?.identity;
  const identity = !id ? t(lang, 'strip.guestLine')
    : id.kind === 'google' ? t(lang, 'strip.signedGoogle').replace('{who}', (id as { email?: string }).email || t(lang, 'strip.yourGoogle'))
    : t(lang, 'strip.signedEmail').replace('{who}', id.email);

  return createPortal(
    <div className="fixed inset-0 z-[1000] grid place-items-center bg-night/70 p-4 font-sans" onPointerDown={(e) => { if (e.target === e.currentTarget) close(); }}>
      <div className="relative w-[340px] max-w-full max-h-full overflow-y-auto rounded-xl border border-market/40 bg-night p-5 text-white shadow-2xl flex flex-col gap-3" role="dialog" aria-label={t(lang, 'strip.account')}>
        <button type="button" onClick={close} aria-label={t(lang, 'strip.close')} className="absolute right-2 top-2 w-11 h-11 rounded-lg text-white/70 hover:text-market text-xl leading-none">✕</button>
        <div className="font-cond italic font-black uppercase text-3xl text-market leading-none pr-10">{t(lang, 'strip.account')}</div>
        <p className="text-[15px] leading-snug text-white/90 break-words">{identity}</p>

        {account && (account.allowanceToday
          ? <div className={`${btn} border border-white/15 text-white/50 flex items-center`}>{t(lang, 'strip.collected')}</div>
          : <button type="button" onClick={() => useGameStore.getState().claimAllowance()} className={`${btn} bg-market text-night`}>{t(lang, 'strip.collect')}</button>)}

        {!account && (caps.google || caps.magic) && <p className="text-[13px] leading-snug text-haze">{t(lang, 'strip.accountNudge')}</p>}
        {!account && caps.google && <button type="button" onClick={google.start} className={ghost}>{t(lang, 'strip.google')}</button>}
        {!account && caps.magic && (mail.linkSent
          ? <p role="status" className="font-cond text-market text-base">{t(lang, 'strip.linkSent')}</p>
          : (
            <form className="flex flex-col gap-2" onSubmit={mail.submit}>
              <input type="email" aria-label={t(lang, 'strip.emailLabel')} placeholder={t(lang, 'strip.emailLabel')} value={mail.email} onChange={(e) => mail.setEmail(e.target.value)}
                className="w-full min-h-[44px] bg-[#0a0d12] border border-[#3a4458] rounded-lg px-4 py-2 text-ink focus:outline-none focus:border-market" />
              <button type="submit" disabled={mail.busy} className={ghost}>{t(lang, 'strip.emailLink')}</button>
            </form>
          ))}
        {account && lobby && <button type="button" onClick={() => useGameStore.getState().signOut()} className={ghost}>{t(lang, 'strip.signOut')}</button>}

        {(google.note || mail.note || notice) && <p role="alert" className="text-[13px] text-[#ff8a96]">{google.note || mail.note || notice}</p>}
      </div>
    </div>, document.body);
}
