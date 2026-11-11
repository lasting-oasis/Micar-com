// Race: five card races scored from the attributes. The house fields rivals of the same class from the reference
// catalogue. Ranked runs on factory figures plus verified changes only, and only for a car whose specification is
// the catalogue's own or one a verifier attested; free play runs on everything recorded and lets you try a setup of
// modification cards. A race is decided by the cards and a seed, so it can be replayed.
// Nothing here reads the grade, the rarity or a value, and nothing that happens here changes them.
import { useMemo, useState } from 'react';
import {
  ATTRIBUTE_KEYS, ATTRIBUTE_LABELS, CATALOGUE, MODS, MOD_CATEGORIES, MOD_TIER_NAMES, RACE_MODES, RACE_MODE_RULES, SETUP_BUDGET, SETUP_CARDS, baseStats, checkSetup,
  entrantFromLayer, entrantWithSetup, hashString, pickRivals, race, raceClassOf, series,
} from '@micar/engine';
import type { Assembly, Passport, RaceEntrant, RaceMode, RaceResult, SeriesResult } from '@micar/engine';
import { t } from '../i18n';

const nameOf = (spec: Passport['spec']) => `${spec.identity.year} ${spec.identity.make} ${spec.identity.model}${spec.identity.trim ? ` ${spec.identity.trim}` : ''}`;

function Result({ result, me }: { result: RaceResult; me: string }) {
  const weights = RACE_MODE_RULES[result.mode].weights;
  const mine = result.rows.filter((r) => r.id === me)[0];
  return (
    <div className="gar-result" role="status">
      <p className="gar-win">{result.winnerId === null ? t('No race: fewer than two cars could start.') : result.winnerId === me ? t('You won by {n}.', { n: result.margin }) : t('{name} won by {n}.', { name: result.rows[0].name, n: result.margin })}</p>
      <div className="gar-scroll">
        <table className="gar-table">
          <thead><tr><th className="pos">#</th><th>{t('Car')}</th><th className="num">{t('Attributes')}</th><th className="num">{t('Surface')}</th><th className="num">{t('Luck')}</th><th className="num">{t('Score')}</th></tr></thead>
          <tbody>
            {result.rows.map((r) => (
              <tr key={r.id} className={r.id === me ? 'gar-me' : ''}>
                <td className="pos">{r.position}</td><td>{r.name}{r.id === me && <small className="gar-you"> {t('you')}</small>}</td><td className="num">{r.rawScore}</td>
                <td className="num">{r.terrain === 1 ? '—' : `×${r.terrain.toFixed(2)}`}</td><td className="num">{`${r.luck >= 1 ? '+' : ''}${((r.luck - 1) * 100).toFixed(1)}%`}</td><td className="num"><b>{r.score}</b></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {mine && (
        <p className="gar-help">{t('Your score came from:')} {ATTRIBUTE_KEYS.filter((k) => weights[k] !== undefined).map((k) => `${t(ATTRIBUTE_LABELS[k])} ${mine.contributions[k]} (${Math.round((weights[k] as number) * 100)}%)`).join(' · ')}</p>
      )}
      {result.excluded.length > 0 && <ul className="gar-list">{result.excluded.map((x) => <li key={x.id}><b>{x.name}</b>: {t(x.reason)}</li>)}</ul>}
    </div>
  );
}

export function RacePanel({ passport, assembly }: { passport: Passport; assembly: Assembly }) {
  const [mode, setMode] = useState<RaceMode>('drag');
  // A specification its owner typed in is theirs to enjoy in free play. Ranked takes the catalogue's own figures or attested ones.
  const trusted = assembly.specificationAttested || assembly.catalogueSpecification;
  const [ranked, setRanked] = useState(trusted);
  const [setup, setSetup] = useState<string[]>([]);
  const [round, setRound] = useState(0);
  const [result, setResult] = useState<RaceResult | null>(null);
  const [cup, setCup] = useState<SeriesResult | null>(null);

  const name = nameOf(passport.spec);
  const checked = useMemo(() => checkSetup(passport.spec, setup), [passport.spec, setup]);
  const cost = setup.reduce((sum, id) => sum + (SETUP_CARDS.filter((c) => c.id === id)[0]?.cost ?? 0), 0);

  const player: RaceEntrant | null = useMemo(() => {
    // Each layer races on the specification it was scored from, so a lift kit on the passport counts off-road when its layer counts it.
    if (ranked) return entrantFromLayer({ id: passport.micarId, name, spec: assembly.stats.competitionSpec, layer: assembly.stats.competition, basis: 'competition', trusted });
    if (setup.length === 0) return entrantFromLayer({ id: passport.micarId, name, spec: assembly.stats.vehicleSpec, layer: assembly.stats.vehicle, basis: 'vehicle' });
    const built = entrantWithSetup({ id: passport.micarId, name, spec: passport.spec, cardIds: setup });
    return built.ok ? built.value : null;
  }, [ranked, trusted, setup, passport, assembly, name]);
  const barred = ranked && !trusted;

  const pool = useMemo(() => CATALOGUE.map((e) => entrantFromLayer({ id: e.id, name: nameOf(e.spec), spec: e.spec, layer: baseStats(e.spec), basis: 'base', trusted: e.status === 'reference' })), []);
  const seed = (hashString(passport.micarId) + round) >>> 0;
  const rivals = useMemo(() => (player ? pickRivals(player, pool, 3, seed) : []), [player, pool, seed]);
  const cls = raceClassOf(player ? player.powerRating : null);

  const toggle = (id: string) => {
    const card = SETUP_CARDS.filter((c) => c.id === id)[0];
    if (!card) return;
    setResult(null); setCup(null);
    setSetup((s) => (s.indexOf(id) !== -1 ? s.filter((x) => x !== id) : [...s.filter((x) => SETUP_CARDS.filter((c) => c.id === x)[0]?.category !== card.category), id]));
  };
  // The attributes this mode reads that the car has no rating for yet: with any missing it cannot start.
  const lacking = player ? ATTRIBUTE_KEYS.filter((k) => RACE_MODE_RULES[mode].weights[k] !== undefined && player.attributes[k] === null) : [];
  // Left and right move between the modes, as a group of choices should.
  const onModeKey = (e: React.KeyboardEvent, m: RaceMode) => {
    const step = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
    if (step === 0) return;
    e.preventDefault();
    const next = RACE_MODES[(RACE_MODES.indexOf(m) + step + RACE_MODES.length) % RACE_MODES.length];
    setMode(next); setResult(null);
    try { document.getElementById(`gar-mode-${next}`)?.focus(); } catch { /* no document */ }
  };
  const run = () => { if (!player) return; setCup(null); setResult(race(mode, [player, ...rivals], seed, { ranked })); setRound((r) => r + 1); };
  const runSeries = () => { if (!player) return; setResult(null); setCup(series([player, ...rivals], seed, { ranked })); setRound((r) => r + 1); };

  return (
    <div className="gar-panel">
      <div className="gar-modes" role="radiogroup" aria-label={t('Race')}>
        {RACE_MODES.map((m) => (
          <button type="button" key={m} id={`gar-mode-${m}`} role="radio" aria-checked={mode === m} tabIndex={mode === m ? 0 : -1} className={`gar-mode ${mode === m ? 'on' : ''}`} onClick={() => { setMode(m); setResult(null); }} onKeyDown={(e) => onModeKey(e, m)}>
            <b>{t(RACE_MODE_RULES[m].name)}</b>
            <span>{t(RACE_MODE_RULES[m].blurb)}</span>
            <small>{ATTRIBUTE_KEYS.filter((k) => RACE_MODE_RULES[m].weights[k] !== undefined).map((k) => t(ATTRIBUTE_LABELS[k])).join(' · ')}</small>
          </button>
        ))}
      </div>

      <div className="toggle" role="group" aria-label={t('Rules')}>
        <button type="button" className={ranked ? 'on' : ''} aria-pressed={ranked} onClick={() => { setRanked(true); setResult(null); setCup(null); }}>{t('Ranked')}</button>
        <button type="button" className={!ranked ? 'on' : ''} aria-pressed={!ranked} onClick={() => { setRanked(false); setResult(null); setCup(null); }}>{t('Free play')}</button>
      </div>
      <p className="gar-note">{ranked
        ? t('Ranked runs on the factory figures plus only what an independent party has verified, so nobody gains by overstating their car.')
        : t('Free play runs on everything recorded on the passport. Add a setup to try modification cards: a setup runs on the factory specification and never changes your card.')}</p>
      {barred && <p className="gar-err" role="status">{t('This car cannot enter a ranked race yet. Its specification is your own account of it: ranked takes a specification exactly as the MiCar catalogue has it, or one an independent verifier has attested. Free play is open.')}</p>}

      {!ranked && (
        <div>
          <h3>{t('Setup')} <small className="gar-help">{t('{n} of {m} points used', { n: cost, m: SETUP_BUDGET })}</small></h3>
          <div className="gar-setup">
            {MOD_CATEGORIES.map((category) => (
              <div key={category} className="gar-setup-row">
                <span>{t(MODS[category].name)}</span>
                <span className="gar-btns" role="group" aria-label={t(MODS[category].name)}>
                  {SETUP_CARDS.filter((c) => c.category === category).map((c) => (
                    <button type="button" key={c.id} className={`gar-btn ${setup.indexOf(c.id) !== -1 ? 'primary' : ''}`} aria-pressed={setup.indexOf(c.id) !== -1} onClick={() => toggle(c.id)} title={t('{n} points', { n: c.cost })}>{t(MOD_TIER_NAMES[c.tier - 1])}</button>
                  ))}
                </span>
              </div>
            ))}
          </div>
          {!checked.ok && <p className="gar-err" role="alert">{t(checked.reason)}</p>}
        </div>
      )}

      <div>
        <h3>{t('The field')} {cls && <small className="gar-help">{t('Class {c}', { c: cls })}</small>}</h3>
        <ul className="gar-list">
          <li><b>{name}</b> · {player && player.powerRating !== null ? t('Power rating {n}', { n: player.powerRating }) : t('Power rating not complete')} · {t('you')}</li>
          {rivals.map((r) => <li key={r.id}>{r.name} · {r.powerRating !== null ? t('Power rating {n}', { n: r.powerRating }) : t('Power rating not complete')} · {t('house card')}</li>)}
        </ul>
        {rivals.length === 0 && <p className="gar-help">{t('The reference catalogue has no rival for this car yet.')}</p>}
      </div>

      <div className="gar-btns">
        <button type="button" className="drip" disabled={!player || barred || rivals.length === 0 || lacking.length > 0} onClick={run}>{t('Race')}</button>
        <button type="button" className="ghostbtn" disabled={!player || barred || rivals.length === 0} onClick={runSeries}>{t('Run all five')}</button>
      </div>

      {lacking.length > 0 && !barred && <p className="gar-err" role="status">{t('This car cannot start this race yet: it has no rating for {list}. Add the missing figures on the spec sheet.', { list: lacking.map((k) => t(ATTRIBUTE_LABELS[k])).join(', ') })}</p>}
      {result && <Result result={result} me={passport.micarId} />}
      {cup && (
        <div className="gar-result" role="status">
          <p className="gar-win">{cup.championId === null ? t('No series: fewer than two cars could start.') : cup.championId === passport.micarId ? t('You took the series.') : t('{name} took the series.', { name: cup.standings[0].name })}</p>
          <div className="gar-scroll">
            <table className="gar-table">
              <thead><tr><th className="pos">#</th><th>{t('Car')}</th>{cup.races.map((r) => <th key={r.mode} className="num">{t(RACE_MODE_RULES[r.mode].name)}</th>)}<th className="num">{t('Points')}</th></tr></thead>
              <tbody>
                {cup.standings.map((s, i) => (
                  <tr key={s.id} className={s.id === passport.micarId ? 'gar-me' : ''}>
                    <td className="pos">{i + 1}</td><td>{s.name}{s.id === passport.micarId && <small className="gar-you"> {t('you')}</small>}</td>
                    {cup.races.map((r) => <td key={r.mode} className="num">{r.rows.filter((row) => row.id === s.id)[0]?.position ?? '—'}</td>)}
                    <td className="num"><b>{s.points}</b></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
      <p className="gar-help">{t('A race is decided by the cards and the day’s luck (at most 4% either way). It never reads the grade or a value, and winning never changes the grade.')}</p>
    </div>
  );
}
