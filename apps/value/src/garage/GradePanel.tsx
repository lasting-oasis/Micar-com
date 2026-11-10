// The grade: five parts from 0 to 100, the number on the label, and the certification ladder with what unlocks the
// next level. Nothing here reads a stat: a fast car and a slow one with the same paperwork get the same grade.
import {
  CERTIFICATION_LEVELS, EDITION_NAMES, GRADE_CATEGORIES, GRADE_CATEGORY_LABELS, GRADE_WEIGHTS, LEVEL_LABELS, LEVEL_SUMMARIES, RARITY_FACTOR_LABELS, RARITY_LABELS, SCARCITY_UNBACKED,
  TIER_NAMES, buildNumberCounts,
} from '@micar/engine';
import type { Assembly, Passport, RarityFactor } from '@micar/engine';
import { t } from '../i18n';

const COUNT = /^(\d+) of (\d+)$/;

/** What stands behind one line of the rarity score, in the page's language: the engine's own sentence is English. */
function rarityDetail(factor: RarityFactor, assembly: Assembly, passport: Passport): string {
  const { report, certification, specificationAttested, asOf } = assembly;
  if (factor.id === 'scarcity') {
    const units = passport.spec.productionUnits;
    if (units === null) return t('No build number on file');
    return buildNumberCounts(units, specificationAttested) ? t('{n} built', { n: units.value.toLocaleString('en-US') }) : t(SCARCITY_UNBACKED);
  }
  if (factor.id === 'age') return t('{n} years since the model year', { n: Math.max(0, Number(asOf.slice(0, 4)) - passport.spec.identity.year) });
  if (factor.id === 'provenance') return t(EDITION_NAMES[certification.level]);
  return t('Originality {a}, condition {b}', { a: Math.round(report.categories.originality.score), b: Math.round(report.categories.condition.score) });
}

export function GradePanel({ assembly, passport }: { assembly: Assembly; passport: Passport }) {
  const { report, certification, card, rarity } = assembly;
  const at = CERTIFICATION_LEVELS.indexOf(certification.level);
  return (
    <div className="gar-panel">
      <div className="lab-big">
        <div className={`gg ${card.grade.slabbed ? '' : 'raw'}`}>{card.grade.slabbed ? report.grade10.toFixed(1) : 'RAW'}</div>
        <div className="tt">
          <b>{card.grade.slabbed ? t(report.tierName) : t('ungraded')}</b>
          <span>{t('Overall {n} of 100', { n: report.overall.toFixed(1) })} · {t(LEVEL_LABELS[certification.level])}</span>
          <i>{card.grade.slabbed ? t('the grade is free, for everyone') : t('three documented records put it in the case')}</i>
        </div>
      </div>

      <div className="bars">
        {GRADE_CATEGORIES.map((k) => {
          const c = report.categories[k];
          return (
            <details className="gar-cat" key={k}>
              <summary>
                <div className={`bar ${k === 'verification' ? 'blue' : ''}`}><span>{t(GRADE_CATEGORY_LABELS[k])}</span><i><b style={{ width: `${c.score}%` }} /></i><output>{Math.round(c.score)}</output></div>
              </summary>
              <ul className="gar-items">
                {c.items.map((it) => (
                  <li key={it.id} className={it.met ? 'met' : ''}>
                    <span>{t(it.label)}</span>
                    {it.max !== 0 || it.points !== 0 ? <output className="num">{it.points}{it.max > 0 ? ` / ${it.max}` : ''}</output> : <output>{it.met ? t('yes') : t('no')}</output>}
                  </li>
                ))}
              </ul>
              {c.capReason && <p className="gar-help">{t(c.capReason)}</p>}
              <p className="gar-help">{t('Counts for {n}% of the grade.', { n: Math.round(GRADE_WEIGHTS[k] * 100) })}</p>
            </details>
          );
        })}
      </div>

      {report.discrepancies.length > 0 && (
        <div className="gar-note gar-warn">
          {report.discrepancies.map((d) => <p key={d.id}>{t(d.detail)}</p>)}
        </div>
      )}

      <div>
        <h3>{t('Certification')}</h3>
        <ol className="gar-ladder">
          {CERTIFICATION_LEVELS.map((level, i) => (
            <li key={level} className={i <= at ? 'on' : ''} aria-current={i === at ? 'step' : undefined}>
              <b>{t(LEVEL_LABELS[level])}</b>
              <span>{t(LEVEL_SUMMARIES[level])}</span>
              <ul className="gar-items">
                {certification.requirements.filter((r) => r.level === level).map((r) => {
                  const m = COUNT.exec(r.detail);
                  return (
                    <li key={r.id} className={r.met ? 'met' : ''}>
                      <span>{t(r.label)}</span>
                      <output>{r.met ? t('yes') : m ? t('{n} of {m}', { n: m[1], m: m[2] }) : t('no')}</output>
                    </li>
                  );
                })}
              </ul>
            </li>
          ))}
        </ol>
        <p className="gar-note blue">{t('Verified and Certified need an independent party: an inspector, a shop or a verification provider. Uploading a photo or a receipt documents a claim; it never verifies one. No verifier is connected to this site yet.')}</p>
      </div>

      <div>
        <h3>{t('Rarity')} <small className="gar-help">{t(RARITY_LABELS[rarity.tier])} · {t('{n} points', { n: rarity.score })}</small></h3>
        <ul className="gar-items">
          {rarity.factors.map((f) => (
            <li key={f.id} className={f.points > 0 ? 'met' : ''}>
              <span>{t(RARITY_FACTOR_LABELS[f.id])}<small className="gar-help gar-block">{rarityDetail(f, assembly, passport)}</small></span>
              <output className="num">{f.points} / {f.max}</output>
            </li>
          ))}
        </ul>
        <p className="gar-help">{t('Rarity is how collectible the car is: how many were built, its age, how far it is certified and how well it is preserved. It never reads a stat, so a slow car can be rare and a fast one common. One of One takes a published build of exactly one, or a verifier’s word.')}</p>
      </div>

      <div>
        <h3>{t('The ten tiers')}</h3>
        <div className="tiers">{TIER_NAMES.slice(1).map((name, i) => <span key={name} className={card.grade.slabbed && report.tier === i + 1 ? 'on' : ''}>{i + 1} · {t(name)}</span>)}</div>
        <p className="gar-help">{t('The number on the label is the overall score divided by ten. Formula: {formula}.', { formula: report.formula })}</p>
      </div>
    </div>
  );
}
