// The strip: the same five doors in the same order on every MiCar surface; the wordmark always goes home.
import { DOORS, KEY_PATH, KEY_RING, SITE_URL, type Door } from '@micar/brand';
import '@micar/brand/strip.css';
import type { ReactNode } from 'react';
import { setLang, t, useLang, type Lang } from './i18n';

export const Key = ({ size = 22 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 26 26" aria-hidden="true" style={{ color: 'var(--mc-paint)', flex: 'none' }}>
    <circle cx={KEY_RING.cx} cy={KEY_RING.cy} r={KEY_RING.r} fill="none" stroke="currentColor" strokeWidth="2.4" />
    <path d={KEY_PATH} fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
  </svg>
);

export function Strip({ current, right }: { current: Door; right?: ReactNode }) {
  const lang = useLang();
  return (
    <div className="mc-strip" role="navigation" aria-label="MiCar">
      <a className="mc-home" href={SITE_URL} aria-current={current === 'home' ? 'page' : undefined}><Key /><span className="mc-wordmark"><span className="mc-mi">Mi</span>Car</span></a>
      <nav className="mc-doors">
        {DOORS.map((d) => <a key={d.id} href={d.href} aria-current={current === d.id ? 'page' : undefined}>{t(d.label)}{d.soon && <em>{t('soon')}</em>}</a>)}
      </nav>
      <div className="mc-right">
        <div className="mc-lang" role="group" aria-label="Language / Idioma">
          {(['en', 'es'] as Lang[]).map((l) => <button key={l} type="button" lang={l} aria-pressed={lang === l} onClick={() => setLang(l)}>{l === 'en' ? 'EN' : 'ESP'}</button>)}
        </div>
        {right}
      </div>
    </div>
  );
}
