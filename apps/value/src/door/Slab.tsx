// The card. Front: the car, the value, the label with the starting grade and a QR that opens the car's page.
// Back: the five categories of that grade, each with where it starts and how it rises, and the value ahead on the
// model's curve. A card on the home page is raw: it goes in a case in the Garage, when its records put it there.
import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { GRADE_CATEGORIES } from '@micar/engine';
import { carPageUrl } from '../car/record';
import { qrSvg } from '../car/qr';
import { usd } from '../car/value';
import { GRADE_CATEGORY_NAMES } from '../garage/CollectibleCard';
import { t } from '../i18n';
import { categoryOf, gradeFor, type Card, type Grade, type GradeInputs } from './card';

const BASE = import.meta.env.BASE_URL;

export function useQr(link: string) {
  const [svg, setSvg] = useState('');
  useEffect(() => { let on = true; qrSvg(link).then((s) => { if (on) setSvg(s); }).catch(() => {}); return () => { on = false; }; }, [link]);
  return svg;
}

/** Tilt and shine follow the pointer; a tap flips the card. */
export function useLive(enabled: boolean) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || !enabled || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const move = (e: PointerEvent) => {
      const r = el.getBoundingClientRect(), x = ((e.clientX - r.left) / r.width) * 100, y = ((e.clientY - r.top) / r.height) * 100;
      el.style.setProperty('--mx', x.toFixed(1)); el.style.setProperty('--my', y.toFixed(1));
      el.style.setProperty('--ry', `${((x - 50) / 4).toFixed(1)}deg`); el.style.setProperty('--rx', `${((50 - y) / 5).toFixed(1)}deg`);
    };
    const leave = () => { el.style.setProperty('--rx', '0deg'); el.style.setProperty('--ry', '0deg'); el.style.setProperty('--mx', '50'); el.style.setProperty('--my', '50'); };
    el.addEventListener('pointermove', move); el.addEventListener('pointerleave', leave);
    return () => { el.removeEventListener('pointermove', move); el.removeEventListener('pointerleave', leave); };
  }, [enabled]);
  return ref;
}

/**
 * The five categories of a starting grade: each with its score out of 100 and, for the ones the home page cannot
 * know, the line that says how it is raised.
 */
export function Categories({ grade }: { grade: Grade }) {
  return (
    <div className="bars cats">
      {GRADE_CATEGORIES.map((k) => {
        const score = grade.report.categories[k].score, note = grade.notes[k];
        return (
          <div className={`bar ${note ? 'blue' : ''}`} key={k}>
            <span>{t(GRADE_CATEGORY_NAMES[k])}</span><i><b style={{ width: `${score}%` }} /></i><output>{Math.round(score)}</output>
            {note && <em>{t(note)}</em>}
          </div>
        );
      })}
    </div>
  );
}

type Props = {
  card: Card;
  /** Grade inputs to show instead of the card's own (the grade section drives this). */
  g?: GradeInputs;
  flipped?: boolean;
  onFlip?: () => void;
  live?: boolean;
  mini?: boolean;
  className?: string;
  serial?: string;
};

export function Slab({ card, g, flipped = false, onFlip, live = false, mini = false, className = '', serial }: Props) {
  const grade = useMemo(() => gradeFor(card, g), [g, card]);
  const link = carPageUrl(card.code);
  const qr = useQr(link);
  const ref = useLive(live);
  const cat = categoryOf(card.r.body);
  // Foil follows a grade a card has earned in its case. A starting grade has none yet.
  const style = { '--foil': 0 } as CSSProperties;
  const toggle = () => onFlip?.();
  return (
    <div ref={ref} className={`slab raw ${flipped ? 'flipped' : ''} ${live ? 'live' : ''} ${mini ? 'mini' : ''} ${className}`} style={style}
      role={onFlip ? 'button' : undefined} tabIndex={onFlip ? 0 : undefined} aria-label={onFlip ? t('The card. Press Enter to flip it.') : undefined}
      onClick={onFlip ? toggle : undefined} onKeyDown={onFlip ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); } } : undefined}>
      <div className="slab-in">
        <div className="sl-face front"><div className="acrylic">
          <Label card={card} grade={grade} qr={qr} serial={serial} />
          <div className="art">
            <img className="render" src={`${BASE}cars/${cat.render}.webp`} alt="" loading="lazy" />
            <div className="tag a">{card.sample ? t('sample card') : t('valued today')}</div>
            <div className="tag b">{t(card.r.condition)} · {card.r.mileage.toLocaleString('en-US')} mi</div>
            <div className="stats"><small>{t('Value now')}</small><b>{usd(card.value)}</b><span>{t('most sell {low} to {high}', { low: usd(card.snap.val.range.low), high: usd(card.snap.val.range.high) })}</span></div>
            <div className="foil" /><div className="glare" />
          </div>
          <div className="uvmark">MiCar<br />{t('authentic')}<br />{serial ?? t('unminted')}</div>
        </div></div>
        <div className="sl-face back"><div className="acrylic">
          <Label card={card} grade={grade} qr={qr} serial={serial} />
          <div className="art chart">
            <h4>{t('starting grade')}</h4>
            <Categories grade={grade} />
            <h4>{t('value ahead')}</h4>
            <div className="chwrap"><Curve card={card} /></div>
            <div className="legend"><span><i style={{ background: 'var(--paint)' }} />{t('your car')}</span><span><i style={{ background: 'var(--haze)', height: 2 }} />{t('expected curve')}</span><span><i style={{ background: 'var(--blue-2)' }} />{t('range')}</span></div>
            <div className="foil" /><div className="glare" />
          </div>
          <div className="uvmark">MiCar<br />{t('authentic')}<br />{serial ?? t('unminted')}</div>
        </div></div>
      </div>
    </div>
  );
}

function Label({ card, grade, qr, serial }: { card: Card; grade: Grade; qr: string; serial?: string }) {
  const r = card.r;
  return (
    <div className="sl-label">
      <div className="lab-g"><small>{t('starting grade')}</small><b>{grade.G.toFixed(1)}</b><em>{t('out of 10')}</em></div>
      <div className="lab-n"><strong>{r.year} {r.model || r.modelText || t(r.body)}</strong><span>{r.trim ? `${r.trim} · ` : ''}{serial ?? t('unminted')}</span><i>{t('scan to see the car')}</i></div>
      <div className="qr" title={t("Scan: opens the car's page")} dangerouslySetInnerHTML={qr ? { __html: qr } : undefined} />
    </div>
  );
}

/** Five years ahead at 12,000 miles a year: the expected line and its band, today marked. */
export function Curve({ card }: { card: Card }) {
  const pts = card.snap.curve;
  const n = pts.length;
  const W = 320, H = 236, pl = 40, pr = 14, pt = 16, pb = 30;
  const lo = Math.min(...pts.map((p) => p.low)) * 0.97, hi = Math.max(...pts.map((p) => p.high)) * 1.03;
  const X = (i: number) => pl + (i * (W - pl - pr)) / (n - 1);
  const Y = (v: number) => pt + ((hi - v) / (hi - lo)) * (H - pt - pb);
  const line = pts.map((p, i) => `${X(i).toFixed(1)},${Y(p.value).toFixed(1)}`).join(' ');
  const band = [...pts.map((p, i) => `${X(i).toFixed(1)},${Y(p.high).toFixed(1)}`), ...pts.map((_, i) => `${X(n - 1 - i).toFixed(1)},${Y(pts[n - 1 - i].low).toFixed(1)}`)].join(' ');
  const k = (v: number) => `$${(v / 1000).toFixed(v < 10000 ? 1 : 0)}k`;
  return (
    <svg className="ch" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={t('Expected value over the next five years')}>
      <g className="grid">{[0, 1, 2, 3].map((j) => { const v = lo + ((hi - lo) * j) / 3; return <g key={j}><line x1={pl} x2={W - pr} y1={Y(v)} y2={Y(v)} /><text x={pl - 4} y={Y(v) + 3} textAnchor="end">{k(v)}</text></g>; })}</g>
      <polygon className="area" points={band} style={{ fill: 'var(--blue-2)', opacity: 0.14 }} />
      <polyline className="curve" points={line} />
      <polyline className="you" points={`${X(0).toFixed(1)},${Y(pts[0].value).toFixed(1)} ${X(0).toFixed(1)},${Y(pts[0].value).toFixed(1)}`} />
      <g className="ev"><circle cx={X(0)} cy={Y(pts[0].value)} r={5} /><text x={X(0) + 6} y={Y(pts[0].value) - 9} textAnchor="start">{t('today').toUpperCase()}</text></g>
      {pts.map((p, i) => <text key={p.year} x={X(i)} y={H - 8} textAnchor="middle">{p.year}</text>)}
    </svg>
  );
}
