// Site-wide navigation. Two audiences, two doors: owners and buyers value a car;
// dealers print window sheets. The car page (opened from a QR code) shows both doors
// too, so a buyer who scanned a sheet can go value their own car. On the home page
// neither door is lit; the page itself explains them. The EN/ESP switch sits by the name.
import { Calculator, QrCode, Tag } from 'lucide-react';
import type { ReactNode } from 'react';
import { calculatorUrl, stickerPageUrl } from './car/record';
import { t, useLang } from './i18n';
import { Strip } from './Strip';

export type Section = 'home' | 'value' | 'sheet' | 'car';

export function Nav({ active }: { active: Section }) {
  useLang();
  const tabs: { id: Section; href: string; icon: ReactNode; title: string; who: string; whoShort: string }[] = [
    { id: 'value', href: calculatorUrl(), icon: <Calculator size={17} />, title: t('Value a car'), who: t('Owners & buyers · what a used car is worth'), whoShort: t('Owners & buyers') },
    { id: 'sheet', href: stickerPageUrl(), icon: <Tag size={17} />, title: t('Window sheet'), who: t('Dealers · print a sheet with a QR code for a car on the lot'), whoShort: t('Dealers · print with QR code') },
  ];
  return (
    <>
    <Strip current={active === 'sheet' ? 'dealers' : 'value'} />
    <nav aria-label={t('Site')} className="mb-6 mt-4 flex flex-col gap-3 sm:flex-row sm:items-center" style={{ color: 'var(--glass-ink)' }}>
      {active === 'car' && <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium" style={{ background: 'rgba(255,255,255,0.1)', color: 'var(--glass-muted)' }}><QrCode size={12} /> {t('Car page from a window sheet')}</span>}
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
    </>
  );
}
