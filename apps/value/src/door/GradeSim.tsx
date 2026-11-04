// The grade, on the visitor's own car: move the trail and watch the card go into the case.
import { t } from '../i18n';
import { TIERS, finishOf, gradeOf, type Card, type GradeInputs } from './card';
import { Slab } from './Slab';

const FINISH: Record<string, string> = { raw: 'no case yet', standard: 'matte chrome', blue: 'blue foil', holo: 'holo foil', rainbow: 'rainbow foil' };
const sign = (v: number, unit: string) => `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v)}${unit}`;

export function GradeSim({ card, g, onChange }: { card: Card; g: GradeInputs; onChange: (g: GradeInputs) => void }) {
  const r = gradeOf(g);
  const set = <K extends keyof GradeInputs>(k: K, v: GradeInputs[K]) => onChange({ ...g, [k]: v });
  const presets: [string, Partial<GradeInputs>][] = [
    [t('This car, as it is'), card.g],
    [t('Three entries in'), { entries: 3, months: 1, photo: true }],
    [t('A year on record'), { entries: 12, months: 12, receipts: true, photo: true }],
    [t('Two years, verified'), { entries: 24, months: 24, receipts: true, photo: true, verified: true }],
  ];
  return (
    <div className="sim">
      <div>
        <div className="ctl">
          <label><span>{t('Condition')}</span>
            <select value={g.cond} onChange={(e) => set('cond', e.target.value)}>{['Excellent', 'Good', 'Fair', 'Poor'].map((c) => <option key={c} value={c}>{t(c)}</option>)}</select></label>
          <label><span>{t('Accidents on record')}</span>
            <select value={g.acc} onChange={(e) => set('acc', Number(e.target.value))}><option value={0}>{t('None')}</option><option value={1}>{t('One')}</option><option value={2}>{t('Two or more')}</option></select></label>
          <label><span>{t('Holds value vs its class')} <output>{sign(g.curve, '%')}</output></span><input type="range" min={-12} max={12} step={0.5} value={g.curve} onChange={(e) => set('curve', Number(e.target.value))} /></label>
          <label><span>{t('Miles vs expected')} <output>{sign(g.miles, '%')}</output></span><input type="range" min={-40} max={40} step={1} value={g.miles} onChange={(e) => set('miles', Number(e.target.value))} /></label>
          <label><span>{t('Trail entries')} <output>{g.entries}</output></span><input type="range" min={0} max={24} step={1} value={g.entries} onChange={(e) => set('entries', Number(e.target.value))} /></label>
          <label><span>{t('Months parked')} <output>{g.months}</output></span><input type="range" min={0} max={36} step={1} value={g.months} onChange={(e) => set('months', Number(e.target.value))} /></label>
          <label className="chk"><input type="checkbox" checked={g.receipts} onChange={(e) => set('receipts', e.target.checked)} />{t('Receipts attached to service and mods')}</label>
          <label className="chk"><input type="checkbox" checked={g.photo} onChange={(e) => set('photo', e.target.checked)} />{t('Odometer photo on the last mileage check')}</label>
          <label className="chk"><input type="checkbox" checked={g.verified} onChange={(e) => set('verified', e.target.checked)} />{t('Keyholder: entries verified by MiCar count double')}</label>
        </div>
        <div className="presets"><span>{t('Try:')}</span>{presets.map(([name, p]) => <button type="button" key={name} onClick={() => onChange({ ...card.g, ...p })}>{name}</button>)}</div>
        <div className="formula" style={{ marginTop: 22 }}>
          <b>{r.G.toFixed(2)}</b> = 0.30 × {r.C.toFixed(1)} {t('condition')} + 0.30 × {r.K.toFixed(1)} {t('curve')} + 0.30 × {r.T.toFixed(1)} {t('trail')} + 0.10 × {r.M.toFixed(1)} {t('miles')}<br />
          {t('curve = 6 + 0.4 × (% vs class) · trail = entries/12 × 5 + months/24 × 3 + receipts + photo (verified entries count double) · miles = 5 − (% vs expected)/8')}
        </div>
      </div>
      <div className="result">
        <div className="lab-big">
          <div className={`gg ${r.slabbed ? '' : 'raw'}`}>{r.slabbed ? r.G.toFixed(1) : 'RAW'}</div>
          <div className="tt">
            <b>{r.slabbed ? t(r.name) : t('Ungraded')}</b>
            <span>{r.slabbed ? t('MiCar grade · slabbed · reads {g} on the label', { g: r.G.toFixed(1) }) : t('{n} more entries to slab · would grade {g}', { n: 3 - g.entries, g: r.G.toFixed(1) })}</span>
            <i>{t(FINISH[finishOf(r)])}</i>
          </div>
        </div>
        <div className="bars">
          {([['Condition', r.C], ['Curve', r.K], ['Trail', r.T], ['Miles', r.M]] as [string, number][]).map(([k, v]) => (
            <div className={`bar ${k === 'Trail' ? 'blue' : ''}`} key={k}><span>{t(k)}</span><i><b style={{ width: `${v * 10}%` }} /></i><output>{v.toFixed(1)}</output></div>
          ))}
        </div>
        <div className="tiers">{TIERS.slice(1).map((name, i) => <span key={name} className={r.slabbed && i + 1 === r.tier ? 'on' : ''}>{i + 1} {t(name)}</span>)}</div>
        <Slab card={card} g={g} mini className="sim-slab" />
      </div>
    </div>
  );
}
