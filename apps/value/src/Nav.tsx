// Site-wide navigation. Two audiences, two doors: owners and buyers value a car;
// dealers print window sheets. The car page (opened from a QR code) shows both doors
// too, so a buyer who scanned a sheet can go value their own car. On the home page
// neither door is lit; the page itself explains them. The EN/ESP switch sits by the name.
import { Calculator, QrCode, Tag } from 'lucide-react';
import type { ReactNode } from 'react';
import { calculatorUrl, homeUrl, stickerPageUrl } from './car/record';
import { setLang, t, useLang, type Lang } from './i18n';

export type Section = 'home' | 'value' | 'sheet' | 'car';

export function Nav({ active }: { active: Section }) {
  useLang();
  const tabs: { id: Section; href: string; icon: ReactNode; title: string; who: string; whoShort: string }[] = [
    { id: 'value', href: calculatorUrl(), icon: <Calculator size={17} />, title: t('Value a car'), who: t('Owners & buyers · what a used car is worth'), whoShort: t('Owners & buyers') },
    { id: 'sheet', href: stickerPageUrl(), icon: <Tag size={17} />, title: t('Window sheet'), who: t('Dealers · print a sheet with a QR code for a car on the lot'), whoShort: t('Dealers · print with QR code') },
  ];
  return (
    <nav aria-label={t('Site')} className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between" style={{ color: 'var(--glass-ink)' }}>
      <div className="flex items-center justify-between gap-4 sm:justify-start">
        <a href={homeUrl()} className="font-cond text-lg font-semibold tracking-tight hover:underline" style={{ color: 'var(--glass-ink)' }} aria-current={active === 'home' ? 'page' : undefined}>
          Nexus Valuation
          {active === 'car' && <span className="ml-2 inline-flex items-center gap-1 rounded-full px-2 py-0.5 align-middle text-xs font-medium" style={{ background: 'rgba(255,255,255,0.1)', color: 'var(--glass-muted)' }}><QrCode size={12} /> {t('Car page from a window sheet')}</span>}
        </a>
        <LangSwitch />
      </div>
      <div className="grid grid-cols-2 gap-2 rounded-xl p-1" style={{ background: 'rgba(255,255,255,0.06)', boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.1)' }}>
        {tabs.map((tab) => {
          const on = tab.id === active;
          return (
            <a key={tab.id} href={tab.href} aria-current={on ? 'page' : undefined} className="flex items-start gap-2.5 rounded-lg px-3 py-2 transition hover:brightness-110"
              style={on ? { background: 'var(--sticker)', color: 'var(--ink)', boxShadow: '0 6px 16px -8px rgba(0,0,0,0.6)' } : { color: 'var(--glass-ink)' }}>
              <span className="mt-0.5 shrink-0" style={{ color: on ? 'var(--blue)' : 'var(--glass-muted)' }}>{tab.icon}</span>
              <span className="min-w-0">
                <span className="block text-sm font-semibold leading-tight">{tab.title}</span>
                <span className="hidden text-xs leading-snug sm:block" style={{ color: on ? 'var(--ink-3)' : 'var(--glass-muted)' }}>{tab.who}</span>
                <span className="block text-xs leading-snug sm:hidden" style={{ color: on ? 'var(--ink-3)' : 'var(--glass-muted)' }}>{tab.whoShort}</span>
              </span>
            </a>
          );
        })}
      </div>
    </nav>
  );
}

/** EN / ESP. Each button names its language in that language, so it reads right whichever page you're on. */
function LangSwitch() {
  const lang = useLang();
  const opts: [Lang, string, string][] = [['en', 'EN', 'English'], ['es', 'ESP', 'Español']];
  return (
    <div role="group" aria-label="Language / Idioma" className="inline-flex shrink-0 rounded-full p-0.5" style={{ background: 'rgba(255,255,255,0.06)', boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.14)' }}>
      {opts.map(([id, short, name]) => {
        const on = lang === id;
        return (
          <button key={id} type="button" lang={id} title={name} aria-pressed={on} onClick={() => setLang(id)}
            className="rounded-full px-3 py-1 text-xs font-semibold tracking-wide transition hover:brightness-110 focus:outline-none focus-visible:ring-2 focus-visible:ring-white/70"
            style={on ? { background: 'var(--sticker)', color: 'var(--ink)' } : { color: 'var(--glass-muted)' }}>
            {short}<span className="sr-only"> {name}</span>
          </button>
        );
      })}
    </div>
  );
}
