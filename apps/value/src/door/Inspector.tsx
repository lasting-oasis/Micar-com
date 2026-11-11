// Pull the card out and look at it under the light: tilt, flip, UV.
import { useEffect, useRef, useState } from 'react';
import { carName } from '../car/record';
import { usd } from '../car/value';
import { t } from '../i18n';
import { gradeFor, type Card, type GradeInputs } from './card';
import { Categories, Slab } from './Slab';

export function Inspector({ card, g, onClose }: { card: Card; g?: GradeInputs; onClose: () => void }) {
  const [flipped, setFlipped] = useState(false);
  const [uv, setUv] = useState(false);
  const close = useRef<HTMLButtonElement>(null);
  const grade = gradeFor(card, g);
  const gi = g ?? card.g;
  useEffect(() => {
    close.current?.focus();
    const prev = document.body.style.overflow; document.body.style.overflow = 'hidden';
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', key);
    return () => { document.body.style.overflow = prev; document.removeEventListener('keydown', key); };
  }, [onClose]);
  const r = card.r;
  return (
    <div className={`inspector ${uv ? 'uv' : ''}`} role="dialog" aria-modal="true" aria-label={t('Inspect the card')}>
      <div className="ins-back" onClick={onClose} />
      <button type="button" className="ghostbtn ins-close" ref={close} onClick={onClose}>{t('Close')}</button>
      <div className="ins-body">
        <Slab card={card} g={g} flipped={flipped} onFlip={() => setFlipped((f) => !f)} live className="ins-slab" />
        <div className="ins-info">
          <div className="serial">{t('Raw card · not yet in a case')}</div>
          <h3>{carName(r)}</h3>
          <div className="ins-grade"><b>{grade.G.toFixed(1)}</b><span>{t('starting grade')}<small>{t('out of 10')} · {t('no case yet')}</small></span></div>
          <Categories grade={grade} />
          <div className="ins-facts">
            <span>{t('Value now')} <b>{usd(card.value)}</b> · {t('most sell {low} to {high}', { low: usd(card.snap.val.range.low), high: usd(card.snap.val.range.high) })}</span>
            <span>{t(gi.cond)} · {gi.mileage.toLocaleString('en-US')} mi · {gi.accident === 'None' ? t('no accidents on record') : `${t('Accident history')}: ${t(gi.accident)}`}</span>
            <span>{t('Park it in the Garage and its records raise the grade from here.')}</span>
          </div>
          <div className="ins-btns">
            <button type="button" className="ghostbtn" onClick={() => setFlipped((f) => !f)}>{t('Flip the card')}</button>
            <button type="button" className={`ghostbtn ${uv ? 'on' : ''}`} onClick={() => setUv((u) => !u)}>{t('UV light')}</button>
          </div>
          <div className="ins-hint">{t("move to tilt · the QR opens the car's page")}</div>
        </div>
      </div>
    </div>
  );
}
