// Pull the card out and look at it under the light: tilt, flip, UV.
import { useEffect, useRef, useState } from 'react';
import { carName } from '../car/record';
import { usd } from '../car/value';
import { t } from '../i18n';
import { finishOf, type Card, type GradeInputs, gradeOf } from './card';
import { Slab } from './Slab';

const FINISH: Record<string, string> = { raw: 'no case yet', standard: 'matte chrome', blue: 'blue foil', holo: 'holo foil', rainbow: 'rainbow foil' };

export function Inspector({ card, g, onClose }: { card: Card; g?: GradeInputs; onClose: () => void }) {
  const [flipped, setFlipped] = useState(false);
  const [uv, setUv] = useState(false);
  const close = useRef<HTMLButtonElement>(null);
  const grade = g ? gradeOf(g) : card.grade;
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
          <div className="serial">{grade.slabbed ? t('Slab · sealed today') : t('Raw card · not yet in a case')}</div>
          <h3>{carName(r)}</h3>
          <div className="ins-grade"><b>{grade.slabbed ? grade.G.toFixed(1) : 'RAW'}</b><span>{grade.slabbed ? t(grade.name) : t('ungraded')}<small>{t('MiCar grade')} · {t(FINISH[finishOf(grade)])}</small></span></div>
          <div className="bars">
            {([['Condition', grade.C], ['Curve', grade.K], ['Trail', grade.T], ['Miles', grade.M]] as [string, number][]).map(([k, v]) => (
              <div className={`bar ${k === 'Trail' ? 'blue' : ''}`} key={k}><span>{t(k)}</span><i><b style={{ width: `${v * 10}%` }} /></i><output>{v.toFixed(1)}</output></div>
            ))}
          </div>
          <div className="ins-facts">
            <span>{t('Value now')} <b>{usd(card.value)}</b> · {t('most sell {low} to {high}', { low: usd(card.snap.val.range.low), high: usd(card.snap.val.range.high) })}</span>
            <span>{t('Trail')} <b>{t('{n} entries · {m} months', { n: gi.entries, m: gi.months })}</b>{gi.receipts ? ` · ${t('receipts on file')}` : ''}{gi.photo ? ` · ${t('odometer photos')}` : ''}</span>
            <span>{t(r.condition)} · {r.mileage.toLocaleString('en-US')} mi · {gi.acc ? t('{n} accident on record', { n: gi.acc }) : t('no accidents on record')}</span>
            {!grade.slabbed && <span>{t('{n} more entries put it in the case; it would grade {g}', { n: Math.max(0, 3 - gi.entries), g: grade.G.toFixed(1) })}</span>}
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
