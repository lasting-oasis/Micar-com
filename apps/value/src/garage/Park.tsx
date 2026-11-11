// Parking a car: the vehicle, its specification, then its first card. The specification can start from the
// reference catalogue (marked as reference data, not verified) or from the EPA's own record of the model year
// (marked as agency data); anything else the owner types, and it is marked as theirs. The preview scores the sheet
// as it fills in and names what is still missing. Nothing is sent anywhere.
import { useEffect, useMemo, useState } from 'react';
import {
  ATTRIBUTE_KEYS, ATTRIBUTE_LABELS, BODY_CLASSES, BODY_CLASS_LABELS, SPEC_FIELD_LABELS, baseStats, bodyClassFromValueBody, checkIdentity, checkVin, emptySpec, findCatalogue,
  normalizeVin, vinMatchesYear,
} from '@micar/engine';
import type { BodyClass, CatalogueEntry, VehicleSpec } from '@micar/engine';
import { MAKES, SEGMENT_LABELS } from '../engine/data';
import { describeEpaConfig, epaConfigsFor, epaFields, epaSource, loadEpaFile, type EpaFile } from '../engine/epaConfigs';
import { findModel, modelsForMake } from '../engine/models';
import { stickerFor, trimChoices } from '../engine/stickers';
import { t } from '../i18n';
import { SpecForm } from './SpecForm';

export type ParkRequest = { spec: VehicleSpec; color: string; vin: string };
type Props = { today: string; onPark: (request: ParkRequest) => string | null; onCancel: () => void };

const NOT_LISTED = '__not_listed__';
/** The fields the EPA's record of a configuration can fill. */
const EPA_FIELDS = ['displacementL', 'cylinders', 'transmission', 'transmissionType', 'drivetrain', 'powertrain'] as const;

/** Everything the page can say about a VIN, for the Spanish coverage test. */
export const VIN_NOTES = [
  'Optional. Private: never shown, never shared.', 'A VIN has 17 letters and digits, never I, O or Q.', 'Shorter than 17 characters: accepted for a vehicle built before 1981.',
  'A vehicle from 1981 or later has a VIN of 17 characters. This one is shorter.',
  'The check digit does not match. Look for a typo.', 'This VIN is coded for another model year.', 'Well formed.',
] as const;

/** What the page says about a VIN as it is typed. */
export function vinNote(vin: string, year: number): { text: string; tone: 'help' | 'ok' | 'warn' } {
  const v = normalizeVin(vin);
  if (v === '') return { text: 'Optional. Private: never shown, never shared.', tone: 'help' };
  const check = checkVin(v);
  if (check.format === 'invalid') return { text: 'A VIN has 17 letters and digits, never I, O or Q.', tone: 'warn' };
  // The short form existed only before the 17-character standard. On a later car it is a VIN with characters missing.
  if (check.format === 'pre-1981') {
    return year < 1981
      ? { text: 'Shorter than 17 characters: accepted for a vehicle built before 1981.', tone: 'help' }
      : { text: 'A vehicle from 1981 or later has a VIN of 17 characters. This one is shorter.', tone: 'warn' };
  }
  if (check.checkDigit === 'invalid') return { text: 'The check digit does not match. Look for a typo.', tone: 'warn' };
  if (vinMatchesYear(v, year) === false) return { text: 'This VIN is coded for another model year.', tone: 'warn' };
  return { text: 'Well formed.', tone: 'ok' };
}

/** Which fills have put figures on the sheet. Both can be there at once: an EPA pick is laid over a catalogue fill. */
export type Fills = { catalogue: boolean; epa: boolean };
export const NO_FILLS: Fills = { catalogue: false, epa: false };

/** The fills on the sheet after one more. A catalogue fill replaces the whole sheet, the EPA's fields with it; an EPA pick is laid over whatever is there. */
export const fillsAfter = (fills: Fills, filled: 'catalogue' | 'epa'): Fills => (filled === 'catalogue' ? { catalogue: true, epa: false } : { ...fills, epa: true });

/**
 * Whether a change to what the car is makes the figures on the sheet another car's, so the sheet has to start again.
 * The catalogue's figures are for one trim and one body of one model year; the EPA's are for the model and the year.
 * So a new trim or body starts the sheet again whenever catalogue figures are on it (whichever fill came last), and
 * a new make, model or year whenever any fill is.
 */
export function startsOver(fills: Fills, change: 'trim' | 'body' | 'make' | 'model' | 'year'): boolean {
  return change === 'trim' || change === 'body' ? fills.catalogue : fills.catalogue || fills.epa;
}

export function Park({ today, onPark, onCancel }: Props) {
  const thisYear = Number(today.slice(0, 4));
  const [year, setYear] = useState(String(thisYear - 3));
  const [make, setMake] = useState('Honda');
  const [makeText, setMakeText] = useState('');
  const [model, setModel] = useState('Civic');
  const [modelText, setModelText] = useState('');
  const [trim, setTrim] = useState('');
  const [bodyClass, setBodyClass] = useState<BodyClass>('sedan');
  const [color, setColor] = useState('');
  const [vin, setVin] = useState('');
  const [fields, setFields] = useState<VehicleSpec>(() => emptySpec({ year: thisYear - 3, make: 'Honda', model: 'Civic', trim: '', bodyClass: 'sedan' }));
  const [fills, setFills] = useState<Fills>(NO_FILLS);
  // Which of the EPA's configurations is chosen: '' until one is, and again whenever the sheet starts over.
  const [epaPick, setEpaPick] = useState('');
  const [epa, setEpa] = useState<EpaFile | null>(null);
  const [error, setError] = useState('');

  useEffect(() => { let on = true; loadEpaFile().then((f) => { if (on) setEpa(f); }); return () => { on = false; }; }, []);

  const listed = make !== 'Other';
  const models = useMemo(() => (listed ? modelsForMake(make) : []), [listed, make]);
  const makeName = listed ? make : makeText;
  const modelName = listed && model !== NOT_LISTED ? model : modelText;
  const y = Number(year);
  const sticker = listed && model !== NOT_LISTED ? stickerFor(make, model, y) : undefined;
  const trims = sticker ? trimChoices(sticker.year) : [];

  const spec = useMemo<VehicleSpec | null>(() => {
    const identity = checkIdentity({ year: y, make: makeName, model: modelName, trim, bodyClass }, thisYear);
    return identity.ok ? { ...fields, identity: identity.value } : null;
  }, [fields, y, makeName, modelName, trim, bodyClass, thisYear]);
  const matches: CatalogueEntry[] = useMemo(() => (makeName && modelName ? findCatalogue({ year: y, make: makeName, model: modelName }) : []), [y, makeName, modelName]);
  const configs = useMemo(() => (epa && listed && model !== NOT_LISTED ? epaConfigsFor(epa, make, model, y) : []), [epa, listed, make, model, y]);
  const preview = useMemo(() => (spec ? baseStats(spec) : null), [spec]);
  const note = vinNote(vin, y);

  // A different car is a different sheet: start it empty again.
  const reset = (bc: BodyClass = bodyClass) => { setFields(emptySpec({ year: y, make: makeName, model: modelName, trim: '', bodyClass: bc })); setFills(NO_FILLS); setEpaPick(''); };
  // The catalogue's figures are for one trim and one body; the EPA's are for the model. Change what a fill was for
  // and its figures, with the sources named beside them, would be describing another car: the sheet starts again.
  const changeTrim = (text: string) => { setTrim(text); if (startsOver(fills, 'trim')) reset(); };
  const changeBody = (bc: BodyClass) => { setBodyClass(bc); if (startsOver(fills, 'body')) reset(bc); };
  const changeMakeText = (text: string) => { setMakeText(text); if (startsOver(fills, 'make')) reset(); };
  const changeModelText = (text: string) => { setModelText(text); if (startsOver(fills, 'model')) reset(); };
  const pickMake = (name: string) => {
    setMake(name);
    const first = name === 'Other' ? undefined : modelsForMake(name)[0];
    setModel(first ? first.model : NOT_LISTED);
    setTrim('');
    const bc = first ? bodyClassFromValueBody(first.body) : bodyClass;
    setBodyClass(bc);
    reset(bc);
  };
  const pickModel = (name: string) => {
    setModel(name);
    setTrim('');
    const info = name === NOT_LISTED ? undefined : findModel(make, name);
    const bc = info ? bodyClassFromValueBody(info.body) : bodyClass;
    setBodyClass(bc);
    reset(bc);
  };

  // Figures filled in from the catalogue or the EPA belong to the model year they were filled for: another year starts a clean sheet.
  const pickYear = (text: string) => {
    setYear(text);
    setEpaPick('');
    if (startsOver(fills, 'year')) { setFields(emptySpec({ year: Number(text), make: makeName, model: modelName, trim: '', bodyClass })); setFills(NO_FILLS); }
  };

  const fillFromCatalogue = (entry: CatalogueEntry) => {
    setFields(entry.spec);
    setTrim(entry.spec.identity.trim);
    setBodyClass(entry.spec.identity.bodyClass);
    setFills((f) => fillsAfter(f, 'catalogue'));
    // The catalogue's sheet replaced whatever an EPA record had put there, so no configuration is chosen any more.
    setEpaPick('');
  };
  const fillFromEpa = (index: number) => {
    if (!epa || !configs[index]) return;
    const source = epaSource(epa);
    setFields((f) => {
      // A second choice replaces the first: whatever an EPA record put on the sheet comes off before the new one goes
      // on, so nothing one configuration settled is left standing, under the EPA's name, on another.
      const cleared: Record<string, unknown> = { ...f };
      for (const field of EPA_FIELDS) {
        const cell = f[field];
        if (cell !== null && cell.source.kind === 'agency') cleared[field] = null;
      }
      return { ...(cleared as VehicleSpec), ...epaFields(configs[index], source) };
    });
    setFills((f) => fillsAfter(f, 'epa'));
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!spec) { setError(t('Fill in the year, make and model first.')); return; }
    const refused = onPark({ spec, color: color.trim(), vin: normalizeVin(vin) });
    setError(refused ? t(refused) : '');
  };

  return (
    <form className="gar-park" onSubmit={submit} aria-labelledby="gar-park-title">
      <h2 id="gar-park-title">{t('Park a car')}</h2>

      <fieldset className="gar-fieldset">
        <legend>{t('1 · The vehicle')}</legend>
        <div className="gar-form">
          <label>{t('Year')}<input type="number" inputMode="numeric" min={1886} max={thisYear + 1} value={year} onChange={(e) => pickYear(e.target.value)} /></label>
          <label>{t('Make')}
            <select value={make} onChange={(e) => pickMake(e.target.value)}>
              {Object.entries(SEGMENT_LABELS).map(([seg, label]) => <optgroup key={seg} label={t(label as string)}>{MAKES.filter((m) => m.segment === seg).map((m) => <option key={m.name} value={m.name}>{m.name === 'Other' ? t('Other') : m.name}</option>)}</optgroup>)}
            </select>
          </label>
          {!listed && <label>{t('Make name')}<input type="text" value={makeText} maxLength={60} onChange={(e) => changeMakeText(e.target.value)} /></label>}
          {listed && (
            <label>{t('Model')}
              <select value={model} onChange={(e) => pickModel(e.target.value)}>
                {models.map((m) => <option key={m.model} value={m.model}>{m.model}</option>)}
                <option value={NOT_LISTED}>{t('Not listed')}</option>
              </select>
            </label>
          )}
          {(!listed || model === NOT_LISTED) && <label>{t('Model name')}<input type="text" value={modelText} maxLength={60} onChange={(e) => changeModelText(e.target.value)} /></label>}
          <label>{t('Trim')}
            {trims.length > 0
              ? <select value={trim} onChange={(e) => changeTrim(e.target.value)}><option value="">{t('Not known')}</option>{trims.map((tr) => <option key={tr.trim} value={tr.trim}>{tr.trim}</option>)}{trim && !trims.some((tr) => tr.trim === trim) && <option value={trim}>{trim}</option>}</select>
              : <input type="text" value={trim} maxLength={80} onChange={(e) => changeTrim(e.target.value)} />}
          </label>
          <label>{t('Body')}
            <select value={bodyClass} onChange={(e) => changeBody(e.target.value as BodyClass)}>{BODY_CLASSES.map((b) => <option key={b} value={b}>{t(BODY_CLASS_LABELS[b])}</option>)}</select>
          </label>
          <label>{t('Colour')}<input type="text" value={color} maxLength={40} onChange={(e) => setColor(e.target.value)} /></label>
          <label className="wide">{t('VIN')}
            <input type="text" value={vin} maxLength={24} autoComplete="off" autoCapitalize="characters" spellCheck={false} aria-describedby="gar-vin-note" onChange={(e) => setVin(e.target.value)} />
            <span id="gar-vin-note" className={note.tone === 'warn' ? 'gar-err' : 'gar-help'}>{t(note.text)}</span>
          </label>
        </div>
      </fieldset>

      <fieldset className="gar-fieldset">
        <legend>{t('2 · The specification')}</legend>
        {matches.length > 0 && (
          <div className="gar-start">
            <p>{t('The reference catalogue has this vehicle. Its figures come from public sources and have not been verified.')}</p>
            <div className="gar-btns">{matches.map((m) => <button type="button" key={m.id} className="gar-btn" onClick={() => fillFromCatalogue(m)}>{t('Use the reference specification')}{m.spec.identity.trim ? ` · ${m.spec.identity.trim}` : ''}</button>)}</div>
          </div>
        )}
        {configs.length > 0 && (
          <div className="gar-start">
            <label className="gar-field">{t('How the EPA lists this model year')}
              <select className="gar-input" value={epaPick} onChange={(e) => { setEpaPick(e.target.value); if (e.target.value !== '') fillFromEpa(Number(e.target.value)); }}>
                <option value="">{t('Pick the one that matches the car')}</option>
                {configs.map((c, i) => <option key={i} value={i}>{describeEpaConfig(c)}</option>)}
              </select>
            </label>
            <p className="gar-help">{t('From the EPA’s vehicle file. It fills the engine size, cylinders, transmission, drive and fuel. Power, weight and the rest are yours to add.')}</p>
          </div>
        )}
        {fills.catalogue && <p className="gar-note">{t('Filled from the reference catalogue: reference data, not verified. Correct anything you know better.')}</p>}
        {fills.epa && <p className="gar-note blue">{t('Filled from the EPA’s record of this model year.')}</p>}
        <SpecForm spec={spec ?? fields} today={today} onChange={(next) => setFields(next)} />
      </fieldset>

      <fieldset className="gar-fieldset">
        <legend>{t('3 · The card it will get')}</legend>
        {preview && (
          <div className="gar-preview">
            <div className="lab-big">
              <div className={`gg ${preview.powerRating === null ? 'raw' : ''}`}>{preview.powerRating ?? preview.provisionalRating ?? '—'}</div>
              <div className="tt">
                <b>{t('Power rating')}</b>
                <span>{preview.powerRating !== null ? t('all seven attributes rated') : t('{n} of 7 rated', { n: preview.rated })}</span>
                <i>{preview.powerRating !== null ? t('from the specification') : t('add the missing figures to finish it')}</i>
              </div>
            </div>
            <div className="bars">
              {ATTRIBUTE_KEYS.map((k) => {
                const s = preview.scores[k];
                return (
                  <div className="bar" key={k}>
                    <span>{t(ATTRIBUTE_LABELS[k])}</span>
                    <i><b style={{ width: `${(s.value ?? 0) / 10}%` }} /></i>
                    <output title={s.missing.length ? s.missing.map((f) => t(SPEC_FIELD_LABELS[f])).join(', ') : undefined}>{s.value === null ? '—' : `${s.basis === 'estimated' ? '~' : ''}${s.value}`}</output>
                  </div>
                );
              })}
            </div>
            <p className="gar-help">{t('A dash means the figures for that attribute are missing. A ~ means it was estimated from other figures. Nothing is invented.')}</p>
          </div>
        )}
        {error && <p className="gar-err" role="alert">{error}</p>}
        <div className="gar-btns">
          <button type="submit" className="drip">{t('Park it')}</button>
          <button type="button" className="ghostbtn" onClick={onCancel}>{t('Cancel')}</button>
        </div>
      </fieldset>
    </form>
  );
}
