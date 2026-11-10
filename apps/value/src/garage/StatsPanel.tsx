// Stats: the seven attributes three ways. Factory (layer A), this vehicle (layer B: every recorded modification,
// wear and documented repair) and ranked play (factory plus only what an independent verifier has confirmed).
// Every change is itemised with the evidence behind it, and anything not rated says which figures are missing.
import { ATTRIBUTE_BLURBS, ATTRIBUTE_KEYS, ATTRIBUTE_LABELS, BASIS_LABELS, EVIDENCE_LABELS, MODS, MOD_TIER_NAMES, QUALITY_LABELS, SPEC_FIELD_LABELS, WEAR_SYSTEM_LABELS, raceClassOf } from '@micar/engine';
import type { ActiveModification, Assembly, AttributeKey, StatAdjustment, StatLayer, WearSystem } from '@micar/engine';
import { t } from '../i18n';

const signed = (n: number) => (n > 0 ? `+${n}` : String(n));

function Rating({ layer }: { layer: StatLayer }) {
  if (layer.powerRating !== null) return <b className="num">{layer.powerRating}</b>;
  if (layer.provisionalRating !== null) return <span className="num">{layer.provisionalRating} <small>{t('provisional, {n} of 7', { n: layer.rated })}</small></span>;
  return <span>—</span>;
}

function Value({ layer, base, k }: { layer: StatLayer; base: StatLayer; k: AttributeKey }) {
  const v = layer.scores[k].value, b = base.scores[k].value;
  if (v === null) return <span className="gar-none">—</span>;
  const d = b === null ? 0 : v - b;
  return <span className={d > 0 ? 'gar-up' : d < 0 ? 'gar-down' : ''}>{layer.scores[k].basis === 'estimated' ? '~' : ''}{v}{d !== 0 && <small> {signed(d)}</small>}</span>;
}

/** An adjustment's name in the page's language: the engine's label is English, so it is rebuilt from what it refers to. */
function nameOf(a: StatAdjustment, fitted: ActiveModification[]): string {
  if (a.source === 'wear') return `${t(WEAR_SYSTEM_LABELS[a.ref as WearSystem] ?? a.label)} · ${t('wear')}`;
  const mod = fitted.filter((m) => m.eventId === a.ref)[0];
  return mod ? `${t(MODS[mod.category].name)} · ${t(MOD_TIER_NAMES[mod.tier - 1])}` : a.label;
}

function Adjustments({ list, fitted }: { list: StatAdjustment[]; fitted: ActiveModification[] }) {
  if (list.length === 0) return <p className="gar-help">{t('Nothing recorded changes these numbers yet.')}</p>;
  return (
    <ul className="gar-adjust">
      {list.map((a) => (
        <li key={`${a.source}-${a.ref}`}>
          <span className="gar-adjust-what">{nameOf(a, fitted)} <span className={`gar-chip ${a.evidence === 'verified' ? 'on' : a.evidence === 'documented' ? 'blue' : ''}`}>{t(EVIDENCE_LABELS[a.evidence])}</span></span>
          <span className="gar-chips">
            {ATTRIBUTE_KEYS.filter((k) => a.deltas[k]).map((k) => <span key={k} className={`gar-chip ${(a.deltas[k] as number) > 0 ? 'gain' : 'loss'}`}>{t(ATTRIBUTE_LABELS[k])} {signed(a.deltas[k] as number)}</span>)}
          </span>
        </li>
      ))}
    </ul>
  );
}

export function StatsPanel({ assembly }: { assembly: Assembly }) {
  const { stats } = assembly;
  const missing = ATTRIBUTE_KEYS.filter((k) => stats.base.scores[k].missing.length > 0);
  const cls = raceClassOf(stats.base.powerRating);
  return (
    <div className="gar-panel">
      <div className="gar-scroll">
        <table className="gar-table">
          <thead>
            <tr><th>{t('Attribute')}</th><th className="num">{t('Factory')}</th><th className="num">{t('This vehicle')}</th><th className="num">{t('Ranked play')}</th></tr>
          </thead>
          <tbody>
            {ATTRIBUTE_KEYS.map((k) => (
              <tr key={k}>
                <td><b>{t(ATTRIBUTE_LABELS[k])}</b><small className="gar-help gar-block">{t(ATTRIBUTE_BLURBS[k])} · {t(BASIS_LABELS[stats.base.scores[k].basis])}</small></td>
                <td className="num"><Value layer={stats.base} base={stats.base} k={k} /></td>
                <td className="num"><Value layer={stats.vehicle} base={stats.base} k={k} /></td>
                <td className="num"><Value layer={stats.competition} base={stats.base} k={k} /></td>
              </tr>
            ))}
            <tr className="gar-total">
              <td><b>{t('Power rating')}</b><small className="gar-help gar-block">{t('The mean of the seven, weighted equally.')}{cls ? ` · ${t('Class {c}', { c: cls })}` : ''}</small></td>
              <td className="num"><Rating layer={stats.base} /></td>
              <td className="num"><Rating layer={stats.vehicle} /></td>
              <td className="num"><Rating layer={stats.competition} /></td>
            </tr>
          </tbody>
        </table>
      </div>
      <p className="gar-note">{t('Factory is the specification, scored. This vehicle adds what is on its passport: modifications, wear and documented repairs. Ranked play counts only what an independent verifier has confirmed, so nobody gains by overstating their car.')}</p>

      <div>
        <h3>{t('What changes this vehicle')}</h3>
        <Adjustments list={stats.adjustments} fitted={assembly.modifications.applied} />
      </div>

      {missing.length > 0 && (
        <div>
          <h3>{t('What is missing')}</h3>
          <ul className="gar-list">
            {missing.map((k) => (
              <li key={k}><b>{t(ATTRIBUTE_LABELS[k])}</b>: {stats.base.scores[k].missing.map((f) => t(SPEC_FIELD_LABELS[f])).join(', ')}</li>
            ))}
          </ul>
          <p className="gar-help">{t('A missing figure is never invented. Add it on the spec sheet and the score follows.')}</p>
        </div>
      )}

      <p className="gar-help">{t('Data: {quality}. Rules: {rules}.', { quality: t(QUALITY_LABELS[assembly.card.quality]), rules: stats.ruleset })}</p>
    </div>
  );
}
