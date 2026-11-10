// The specification sheet as a form. Every figure shows where it came from, and a figure typed here is marked as the
// owner's. A value the engine refuses (out of range, not a number) stays out of the sheet and the reason shows under
// the field: nothing is clipped into range and nothing is filled in for the owner.
import { useState } from 'react';
import { CHOICE_FIELDS, NUMERIC_FIELDS, SOURCE_KIND_LABELS, SPEC_FIELD_LABELS, SPEC_FIELD_UNITS, SPEC_RANGES, TEXT_FIELDS, ownerSource, setSpecField } from '@micar/engine';
import type { NumericSpecField, Sourced, SpecField, VehicleSpec } from '@micar/engine';
import { t } from '../i18n';

/** The sheet in the order a person fills it in. */
export const SPEC_GROUPS: { title: string; fields: SpecField[] }[] = [
  { title: 'Engine and drivetrain', fields: ['powertrain', 'induction', 'engine', 'displacementL', 'cylinders', 'horsepower', 'torqueLbFt', 'transmission', 'transmissionType', 'drivetrain'] },
  { title: 'Performance figures', fields: ['zeroToSixtySec', 'topSpeedMph', 'topSpeedGoverned', 'lateralGripG', 'braking60to0Ft', 'braking70to0Ft'] },
  { title: 'Body and chassis', fields: ['curbWeightLb', 'groundClearanceIn', 'construction', 'suspension', 'suspensionGrade', 'brakes', 'brakeGrade'] },
  { title: 'Fuel economy', fields: ['combinedMpg', 'cityMpg', 'highwayMpg', 'evRangeMiles'] },
  { title: 'Warranty and production', fields: ['warrantyPowertrainMiles', 'warrantyPowertrainYears', 'productionUnits'] },
];

/** What each choice is called on the page. The stored values stay the engine's own words. */
export const CHOICE_LABELS: Record<string, string> = {
  gasoline: 'Gasoline', diesel: 'Diesel', hybrid: 'Hybrid', 'plug-in-hybrid': 'Plug-in hybrid', electric: 'Battery electric',
  natural: 'Naturally aspirated', turbo: 'Turbocharged', 'twin-turbo': 'Twin-turbocharged', 'quad-turbo': 'Quad-turbocharged', supercharged: 'Supercharged', twincharged: 'Turbo and supercharger',
  manual: 'Manual', automatic: 'Automatic', 'dual-clutch': 'Dual-clutch', cvt: 'CVT', ecvt: 'Hybrid e-CVT', 'single-speed': 'Single speed',
  FWD: 'Front-wheel drive', RWD: 'Rear-wheel drive', AWD: 'All-wheel drive', '4WD': 'Four-wheel drive',
  unibody: 'Unibody', 'body-on-frame': 'Body on frame',
  standard: 'Standard', sport: 'Sport-tuned', adaptive: 'Adaptive', offroad: 'Off-road',
  performance: 'Performance brakes', 'carbon-ceramic': 'Carbon-ceramic',
};

const isNumeric = (f: SpecField): f is NumericSpecField => (NUMERIC_FIELDS as readonly string[]).indexOf(f) !== -1;
const isText = (f: SpecField): boolean => (TEXT_FIELDS as readonly string[]).indexOf(f) !== -1;

function SourceChip({ cell }: { cell: Sourced<unknown> | null }) {
  if (!cell) return <span className="gar-chip">{t('not on file')}</span>;
  const s = cell.source;
  const good = s.kind === 'manufacturer' || s.kind === 'agency' || s.kind === 'test';
  const label = <>{t(SOURCE_KIND_LABELS[s.kind])}{s.name ? ` · ${s.name}` : ''}</>;
  return s.url
    ? <a className={`gar-chip ${good ? 'blue' : ''}`} href={s.url} target="_blank" rel="noreferrer" title={s.note}>{label}</a>
    : <span className={`gar-chip ${good ? 'blue' : ''}`} title={s.note}>{label}</span>;
}

type Props = {
  spec: VehicleSpec;
  /** Today, YYYY-MM-DD: stamped on every figure the owner types. */
  today: string;
  onChange: (spec: VehicleSpec) => void;
  /** Leave out groups a caller does not want (the parking form shows the short sheet first). */
  groups?: readonly string[];
};

export function SpecForm({ spec, today, onChange, groups }: Props) {
  // What the owner is typing, per field, and why the last value was refused. The sheet itself only ever holds accepted values.
  const [draft, setDraft] = useState<Partial<Record<SpecField, string>>>({});
  const [refused, setRefused] = useState<Partial<Record<SpecField, string>>>({});

  const commit = (field: SpecField, value: unknown, text?: string) => {
    const { spec: next, issue } = setSpecField(spec, field, value, ownerSource(today));
    setRefused((r) => ({ ...r, [field]: issue ? issue.reason : '' }));
    if (text !== undefined) setDraft((d) => ({ ...d, [field]: issue ? text : undefined }));
    if (!issue) onChange(next);
  };

  const shown = SPEC_GROUPS.filter((g) => !groups || groups.indexOf(g.title) !== -1);
  return (
    <div className="gar-spec">
      {shown.map((group) => (
        <fieldset className="gar-fieldset" key={group.title}>
          <legend>{t(group.title)}</legend>
          <div className="gar-form">
            {group.fields.map((field) => {
              const cell = spec[field] as Sourced<unknown> | null;
              const id = `gar-spec-${field}`;
              const unit = SPEC_FIELD_UNITS[field];
              const problem = refused[field];
              const label = <>{t(SPEC_FIELD_LABELS[field])}{unit ? <small> ({unit})</small> : null}</>;
              if (field === 'topSpeedGoverned') {
                const v = cell === null ? '' : cell.value ? 'yes' : 'no';
                return (
                  <label key={field} htmlFor={id}>{label}
                    <select id={id} value={v} onChange={(e) => commit(field, e.target.value === '' ? null : e.target.value === 'yes')}>
                      <option value="">{t('Not known')}</option><option value="yes">{t('Yes')}</option><option value="no">{t('No')}</option>
                    </select>
                    <SourceChip cell={cell} />
                  </label>
                );
              }
              const choices = (CHOICE_FIELDS as Record<string, readonly string[] | undefined>)[field];
              if (choices) {
                return (
                  <label key={field} htmlFor={id}>{label}
                    <select id={id} value={cell === null ? '' : String(cell.value)} onChange={(e) => commit(field, e.target.value === '' ? null : e.target.value)}>
                      <option value="">{t('Not known')}</option>
                      {choices.map((c) => <option key={c} value={c}>{t(CHOICE_LABELS[c] ?? c)}</option>)}
                    </select>
                    <SourceChip cell={cell} />
                  </label>
                );
              }
              const numeric = isNumeric(field);
              const range = numeric ? SPEC_RANGES[field] : null;
              const value = draft[field] ?? (cell === null ? '' : String(cell.value));
              return (
                <label key={field} htmlFor={id} className={isText(field) ? 'wide' : undefined}>{label}
                  <input id={id} type="text" inputMode={numeric ? 'decimal' : 'text'} autoComplete="off" value={value}
                    aria-invalid={problem ? true : undefined} aria-describedby={problem ? `${id}-err` : undefined}
                    onChange={(e) => setDraft((d) => ({ ...d, [field]: e.target.value }))}
                    onBlur={(e) => { const text = e.target.value.trim(); if (text === (cell === null ? '' : String(cell.value))) { setDraft((d) => ({ ...d, [field]: undefined })); return; } commit(field, text === '' ? null : numeric ? text : text, text); }} />
                  {problem
                    ? <span className="gar-err" id={`${id}-err`}>{range ? t('Enter a number from {lo} to {hi}.', { lo: range[0], hi: range[1] }) : t('That value was not accepted.')}</span>
                    : <SourceChip cell={cell} />}
                </label>
              );
            })}
          </div>
        </fieldset>
      ))}
    </div>
  );
}
