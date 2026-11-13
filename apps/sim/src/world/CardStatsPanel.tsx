// The seven attributes of a car's MiCar card, on the owned-car tile in the lot. Factory figures for the model from
// the world's car table, scored by the same engine the Garage on the site uses. Plain flex rows on purpose: the
// smoke test counts the Garage's twelve-column stat bars, and these must not be mistaken for them.
import { useMemo } from 'react';
import { ATTRIBUTE_KEYS } from '@micar/engine';
import type { AttributeKey } from '@micar/engine';
import { t, useLang } from '../i18n';
import { hasModelSpec } from '../carSpecs';
import { cardStatsFor } from './cardStats';

const LABEL: Record<AttributeKey, string> = {
  power: 'card.power', speed: 'card.speed', acceleration: 'card.acceleration', handling: 'card.handling',
  durability: 'card.durability', reliability: 'card.reliability', efficiency: 'card.efficiency',
};

export function CardStats({ car }: { car: { year?: number; make?: string; model?: string; bodyStyle?: string } }) {
  const lang = useLang();
  const { year, make, model, bodyStyle } = car;
  const layer = useMemo(() => cardStatsFor({ year, make, model, bodyStyle }), [year, make, model, bodyStyle]);
  const rating = layer.powerRating ?? layer.provisionalRating;
  // A car with no row of its own in the table (a junkyard shell) is scored from its body style's stand-in. Those are
  // not anyone's factory figures, and the panel says so instead of presenting them as the model's.
  const standIn = !hasModelSpec({ make, model });
  return (
    <div className="mt-2 rounded border border-white/10 bg-black/30 px-2.5 py-2" data-card-stats data-card-stand-in={standIn ? 'true' : undefined}>
      <div className="flex items-baseline justify-between gap-2 font-cond text-[10px] font-bold uppercase tracking-widest text-haze">
        <span>{t(lang, standIn ? 'card.titleStandIn' : 'card.title')}</span>
        <span>
          {t(lang, 'card.rating')} <b className="text-base font-extrabold italic tabular-nums text-market">{rating ?? '—'}</b>
          {layer.powerRating === null && <span className="ml-1 font-semibold normal-case tracking-normal">{t(lang, 'card.provisional').replace('{n}', String(layer.rated))}</span>}
        </span>
      </div>
      <div className="mt-1.5 flex flex-col gap-1">
        {ATTRIBUTE_KEYS.map(k => {
          const s = layer.scores[k];
          return (
            <div key={k} className="flex items-center gap-2 font-cond text-[10px] font-semibold uppercase tracking-wider text-gray-300">
              <span className="w-[5.5rem] shrink-0 truncate">{t(lang, LABEL[k])}</span>
              <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/10"><span className="block h-full rounded-full bg-market" style={{ width: `${(s.value ?? 0) / 10}%` }} /></span>
              <span className="w-8 shrink-0 text-right tabular-nums text-white" title={s.value === null ? t(lang, 'card.unrated') : undefined}>{s.value === null ? '—' : `${s.basis === 'estimated' ? '~' : ''}${s.value}`}</span>
            </div>
          );
        })}
      </div>
      <p className="mt-1.5 text-[9px] leading-snug text-gray-500">{t(lang, standIn ? 'card.noteStandIn' : 'card.note')}</p>
    </div>
  );
}
