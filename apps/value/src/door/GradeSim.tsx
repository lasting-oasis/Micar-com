// The grade, on the visitor's own car: the five categories of the MiCar grade, where each one starts from what this
// page is told, and what raises it. The page is told the car's condition and its miles; everything else the grade
// reads is kept in the Garage.
import { GRADE_CATEGORIES, GRADE_WEIGHTS } from '@micar/engine';
import { garageUrl } from '../car/record';
import { ACCIDENTS, CONDITIONS } from '../engine/data';
import { GRADE_CATEGORY_NAMES } from '../garage/CollectibleCard';
import { t } from '../i18n';
import { TIERS, gradeFor, type Card, type GradeInputs } from './card';
import { Categories, Slab } from './Slab';

export function GradeSim({ card, g, onChange }: { card: Card; g: GradeInputs; onChange: (g: GradeInputs) => void }) {
  const grade = gradeFor(card, g);
  const set = <K extends keyof GradeInputs>(k: K, v: GradeInputs[K]) => onChange({ ...g, [k]: v });
  const parts = GRADE_CATEGORIES.map((k) => `${GRADE_WEIGHTS[k].toFixed(2)} × ${grade.report.categories[k].score} ${t(GRADE_CATEGORY_NAMES[k]).toLowerCase()}`).join(' + ');
  return (
    <div className="sim">
      <div>
        <div className="ctl">
          <label><span>{t('Condition')}</span>
            <select value={g.cond} onChange={(e) => set('cond', e.target.value)}>{CONDITIONS.map((c) => <option key={c.name} value={c.name}>{t(c.name)}</option>)}</select></label>
          <label><span>{t('Accident history')}</span>
            <select value={g.accident} onChange={(e) => set('accident', e.target.value)}>{ACCIDENTS.map((a) => <option key={a.name} value={a.name}>{t(a.name)}</option>)}</select></label>
        </div>
        <p className="sim-note">{t('That is all this page is told about the car, and your own word on its condition counts up to 60. The other categories read its VIN, its papers, its photographs and its records. Those are kept in the Garage.')}</p>
        <div className="formula" style={{ marginTop: 22 }}>
          <b>{(grade.report.overall / 10).toFixed(2)}</b> = ({parts}) ÷ 10<br />
          {t('each category is scored 0 to 100 on its own · the same five the Garage grades by · a card reads RAW there until its records take it to Documented')}
        </div>
        <div className="presets"><a className="ghostbtn" href={garageUrl()}>{t('Park it in the Garage')}</a></div>
      </div>
      <div className="result">
        <div className="lab-big">
          <div className="gg">{grade.G.toFixed(1)}</div>
          <div className="tt">
            <b>{t('starting grade')}</b>
            <span>{t('out of 10 · from the condition and the miles you typed')}</span>
            <i>{t('no case yet')}</i>
          </div>
        </div>
        <Categories grade={grade} />
        <div className="tiers">{TIERS.slice(1).map((name, i) => <span key={name}>{i + 1} {t(name)}</span>)}</div>
        <Slab card={card} g={g} mini className="sim-slab" />
      </div>
    </div>
  );
}
