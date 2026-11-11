// Mods: the modification catalogue as cards. Fitting one writes an entry on the passport and changes this vehicle's
// stats by stated rules, trade-offs included; the preview shows exactly what it would do to this car before it is
// fitted. A modification is declared until a receipt is attached, and counts in ranked play only once verified.
import { useMemo, useState } from 'react';
import { ATTRIBUTE_KEYS, ATTRIBUTE_LABELS, EVENT_TYPE_LABELS, EVIDENCE_LABELS, MODS, MOD_CATEGORIES, MOD_TIER_NAMES, activeModifications, mileageLog, vehicleStats } from '@micar/engine';
import type { ActiveModification, Assembly, InstallQuality, ModCategory, ModTier, Passport } from '@micar/engine';
import { t } from '../i18n';
import type { FileStore } from './files';
import { newId } from './ids';
import { keepFiles, odometerNote } from './PassportPanel';
import { REGISTRY } from './store';

export const INSTALL_LABELS: Record<InstallQuality, string> = { professional: 'A professional shop', owner: 'The owner', unknown: 'Not known' };
export const UPKEEP_LABELS: Record<ActiveModification['upkeep'], string> = { documented: 'Upkeep documented', recent: 'Recently fitted', lapsed: 'No upkeep on record' };
const TIERS: ModTier[] = [1, 2, 3];
const signed = (n: number) => (n > 0 ? `+${n}` : String(n));

type Props = {
  passport: Passport;
  assembly: Assembly;
  today: string;
  canWrite: boolean;
  files: FileStore;
  onRecord: (event: Record<string, unknown>, reason: string) => string | null;
};

export function ModsPanel({ passport, assembly, today, canWrite, files, onRecord }: Props) {
  const [pick, setPick] = useState<{ category: ModCategory; tier: ModTier } | null>(null);
  const [install, setInstall] = useState<InstallQuality>('professional');
  const [date, setDate] = useState(today);
  const [mileage, setMileage] = useState('');
  const [parts, setParts] = useState('');
  const [picked, setPicked] = useState<File[]>([]);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  const [inputKey, setInputKey] = useState(0);
  // A receipt belongs to the modification it was picked for: choosing another card, or cancelling, starts the form again.
  const choose = (next: { category: ModCategory; tier: ModTier } | null) => { setPick(next); setPicked([]); setParts(''); setMileage(''); setInputKey((k) => k + 1); setMessage(''); setAsked(''); };
  // The reading written with a modification goes on the odometer log like any other, so it gets the same warning,
  // and the same second, deliberate press before a reading the form has a warning about is written.
  const readings = useMemo(() => mileageLog(passport, REGISTRY, today).readings, [passport, today]);
  const warning = odometerNote(mileage, date, readings);
  const reading = `${date}|${mileage}`;
  const [asked, setAsked] = useState('');
  const confirming = warning !== '' && asked === reading;

  const fitted = useMemo(() => activeModifications(passport, REGISTRY, today), [passport, today]);
  const { applied, refused } = assembly.modifications;

  // What the picked card would do to this car, worked out by the same engine that scores it once fitted.
  const preview = useMemo(() => {
    if (!pick) return null;
    // Written down after everything already on the passport, as the real entry will be: of two fitted the same day the later one counts.
    const candidate: ActiveModification = { eventId: 'preview', category: pick.category, tier: pick.tier, install, evidence: 'declared', installedOn: date > today ? today : date, recordedAt: '9999-12-31T23:59:59.999Z', installedAtMileage: null, upkeep: 'recent' };
    const after = vehicleStats({ spec: passport.spec, modifications: [...fitted, candidate], condition: assembly.condition }).vehicle;
    const before = assembly.stats.vehicle;
    const deltas = ATTRIBUTE_KEYS.map((k) => ({ k, d: after.scores[k].value !== null && before.scores[k].value !== null ? (after.scores[k].value as number) - (before.scores[k].value as number) : 0 }));
    const rating = after.powerRating !== null && before.powerRating !== null ? after.powerRating - before.powerRating : null;
    return { deltas, rating };
  }, [pick, install, date, today, fitted, passport.spec, assembly]);

  const fit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!pick || busy) return;
    if (warning !== '' && !confirming) { setAsked(reading); setMessage(''); return; }
    setBusy(true); setMessage(''); setAsked('');
    try {
      const kept = await keepFiles(files, picked, 'repair');
      if (kept.refused) { setMessage(t(kept.refused)); return; }
      const attachments = kept.attachments;
      // No title is stored: the timeline names a modification from its category and tier, in the reader's language.
      const no = onRecord({
        id: newId(), type: 'modification', action: 'install', category: pick.category, tier: pick.tier, install, parts: parts.trim(), undoes: null,
        date, mileage: mileage.trim() === '' ? null : Number(mileage), title: '', note: '', attachments, visibility: 'private',
      }, EVENT_TYPE_LABELS.modification);
      if (no) { for (const a of attachments) await files.remove(a.id); setMessage(t(no)); return; }
      choose(null); setMessage(t('Fitted and written on the passport.'));
    } catch {
      setMessage(t('That could not be saved on this device.'));
    } finally {
      setBusy(false);
    }
  };

  const remove = (m: ActiveModification) => {
    const no = onRecord({
      id: newId(), type: 'modification', action: 'remove', category: m.category, tier: m.tier, install: m.install, parts: '', undoes: m.eventId,
      date: today, mileage: null, title: '', note: '', attachments: [], visibility: 'private',
    }, EVENT_TYPE_LABELS.modification);
    setMessage(no ? t(no) : t('Removed and written on the passport.'));
  };

  return (
    <div className="gar-panel">
      <p className="gar-note">{t('A modification changes this vehicle’s stats by stated rules, and it has a cost: more power wears the engine harder, more so when the work is poorly done or not kept up. It is declared until you attach a receipt, and it counts in ranked play only once an independent party has verified it.')}</p>

      <div>
        <h3>{t('Fitted')}</h3>
        {applied.length === 0 && <p className="gar-help">{t('Nothing fitted. This vehicle is stock as far as its passport says.')}</p>}
        <ul className="gar-fitted">
          {applied.map((m) => (
            <li key={m.eventId}>
              <span><b>{t(MODS[m.category].name)} · {t(MOD_TIER_NAMES[m.tier - 1])}</b><small className="gar-help gar-block">{t(INSTALL_LABELS[m.install])} · {t(UPKEEP_LABELS[m.upkeep])}</small></span>
              <span className={`gar-chip ${m.evidence === 'verified' ? 'on' : m.evidence === 'documented' ? 'blue' : ''}`}>{t(EVIDENCE_LABELS[m.evidence])}</span>
              {canWrite && <button type="button" className="gar-btn" onClick={() => remove(m)}>{t('Remove')}</button>}
            </li>
          ))}
        </ul>
        {refused.length > 0 && (
          <ul className="gar-list">
            {refused.map((r) => <li key={r.eventId}><b>{t(MODS[r.category].name)}</b>: {t(r.reason)}</li>)}
          </ul>
        )}
      </div>

      <div>
        <h3>{t('The catalogue')}</h3>
        <div className="gar-mods-grid">
          {MOD_CATEGORIES.map((category) => (
            <article key={category} className={`gar-modcard ${pick?.category === category ? 'on' : ''}`}>
              <h4>{t(MODS[category].name)}</h4>
              <p>{t(MODS[category].summary)}</p>
              <div className="gar-btns" role="group" aria-label={t(MODS[category].name)}>
                {TIERS.map((tier) => (
                  <button type="button" key={tier} className={`gar-btn ${pick?.category === category && pick.tier === tier ? 'primary' : ''}`} aria-pressed={pick?.category === category && pick.tier === tier}
                    onClick={() => choose(pick?.category === category && pick.tier === tier ? null : { category, tier })}>{t(MOD_TIER_NAMES[tier - 1])}</button>
                ))}
              </div>
            </article>
          ))}
        </div>
      </div>

      {pick && preview && (
        <form className="gar-entry" onSubmit={fit} aria-labelledby="gar-fit-title">
          <h3 id="gar-fit-title">{t(MODS[pick.category].name)} · {t(MOD_TIER_NAMES[pick.tier - 1])}</h3>
          <p className="gar-help">{t('What it would do to this vehicle:')}</p>
          <div className="gar-chips">
            {preview.deltas.filter((x) => x.d !== 0).map((x) => <span key={x.k} className={`gar-chip ${x.d > 0 ? 'gain' : 'loss'}`}>{t(ATTRIBUTE_LABELS[x.k])} {signed(x.d)}</span>)}
            {preview.deltas.every((x) => x.d === 0) && <span className="gar-chip">{t('No change to the rated attributes')}</span>}
            {preview.rating !== null && preview.rating !== 0 && <span className="gar-chip on">{t('Power rating')} {signed(preview.rating)}</span>}
          </div>
          {canWrite && <>
            <div className="gar-form">
              <label>{t('Fitted by')}<select value={install} onChange={(e) => setInstall(e.target.value as InstallQuality)}>{(Object.keys(INSTALL_LABELS) as InstallQuality[]).map((k) => <option key={k} value={k}>{t(INSTALL_LABELS[k])}</option>)}</select></label>
              <label>{t('Date')}<input type="date" value={date} max={today} required onChange={(e) => setDate(e.target.value)} /></label>
              <label>{t('Odometer')} <small>(mi)</small><input type="number" inputMode="numeric" min={0} max={2000000} step={1} value={mileage} aria-describedby="gar-fit-odo-note" onChange={(e) => setMileage(e.target.value)} />
                <span id="gar-fit-odo-note" className="gar-err" role="status">{t(warning)}</span>
              </label>
              <label className="wide">{t('Parts')}<input type="text" value={parts} maxLength={200} onChange={(e) => setParts(e.target.value)} /></label>
              <label className="wide">{t('Receipt or dyno sheet')}<input key={inputKey} type="file" multiple accept="image/*,application/pdf" onChange={(e) => setPicked(Array.from(e.target.files ?? []).slice(0, 20))} /><span className="gar-help">{t('With a file the modification is documented. Without one it is declared.')}</span></label>
            </div>
            <div className="gar-btns">
              {confirming
                ? <>
                  <span className="gar-help" role="status">{t('Add this reading as it is written? It stays on the passport, and it can be put right today and not after.')}</span>
                  <button type="submit" className="gar-btn danger" disabled={busy}>{t('Yes, add it')}</button>
                  <button type="button" className="gar-btn" autoFocus onClick={() => setAsked('')}>{t('Go back')}</button>
                </>
                : <><button type="submit" className="gar-btn primary" disabled={busy}>{t('Fit it')}</button><button type="button" className="gar-btn" onClick={() => choose(null)}>{t('Cancel')}</button></>}
            </div>
          </>}
        </form>
      )}
      {message && <p className="gar-help" role="status">{message}</p>}
    </div>
  );
}
