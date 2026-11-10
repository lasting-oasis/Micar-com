// The passport: the vehicle's timeline, the form that adds to it, the grade's history, the card's editions, who has
// owned it, and what other people would see. Entries are only ever added. Files go to this browser's own store and
// the passport keeps their name, size and fingerprint; a file moves a claim from declared to documented and no further.
import { useMemo, useState } from 'react';
import {
  ATTESTATION_SCOPE_LABELS, EVENT_TYPE_LABELS, EVIDENCE_LABELS, LEVEL_LABELS, MODS, MOD_TIER_NAMES, WEAR_SYSTEMS, WEAR_SYSTEM_LABELS, eventEvidence, maskVin, publicPassport, standingOf,
  timeline,
} from '@micar/engine';
import type { Attachment, OwnerEventType, Passport, PassportEvent, PhotoSubject, Standing, WearSystem } from '@micar/engine';
import { ACCIDENTS, CONDITIONS, TITLES } from '../engine/data';
import { locale, t } from '../i18n';
import { attachmentKind, checkFile, sha256Hex, type FileStore } from './files';
import { newId, stamp } from './ids';
import { vinNote } from './Park';
import { REGISTRY } from './store';

/** The entries an owner writes here. Modifications are written from the Mods tab, where their effect shows. */
const ENTRY_TYPES: OwnerEventType[] = ['photo', 'maintenance', 'repair', 'mileage', 'inspection', 'restoration', 'document', 'declaration'];
export const PHOTO_SUBJECT_LABELS: Record<PhotoSubject, string> = {
  exterior: 'Exterior', interior: 'Interior', 'engine-bay': 'Engine bay', undercarriage: 'Undercarriage', 'vin-plate': 'VIN plate', odometer: 'Odometer', damage: 'Damage', other: 'Something else',
};
export const WORK_LABELS = { repair: 'Repaired', replacement: 'Replaced', rebuild: 'Rebuilt' } as const;
export const DOCUMENT_LABELS = { title: 'Title', registration: 'Registration', other: 'Other document' } as const;
export const FILE_REFUSALS = { 'too-large': 'That file is over 25 MB.', 'not-an-image-or-pdf': 'Only images and PDFs can be attached.', empty: 'That file is empty.' } as const;

const day = (iso: string) => {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(locale(), { year: 'numeric', month: 'short', day: 'numeric' });
};
const month = (ym: string) => {
  const [y, m] = ym.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString(locale(), { year: 'numeric', month: 'short' });
};

type Props = {
  passport: Passport;
  today: string;
  /** False once the car has been handed to another owner: the timeline is then read-only here. */
  canWrite: boolean;
  garageId: string;
  files: FileStore;
  onRecord: (event: Record<string, unknown>, reason: string) => string | null;
  /** Sets, corrects or clears the VIN. */
  onVin: (vin: string) => string | null;
  onTransfer: (input: { eventId: string; toOwnerId: string; date: string; attachments: Attachment[] }) => string | null;
  onExport: () => void;
};

async function store(files: FileStore, picked: File[], entry: Parameters<typeof attachmentKind>[1]): Promise<{ attachments: Attachment[]; refused: string }> {
  const attachments: Attachment[] = [];
  for (const file of picked) {
    const no = checkFile(file);
    if (no) return { attachments: [], refused: FILE_REFUSALS[no] };
  }
  for (const file of picked) {
    const id = newId();
    await files.put(id, file);
    attachments.push({ id, kind: attachmentKind(file.type, entry), name: file.name, mime: file.type, size: file.size, sha256: await sha256Hex(file) });
  }
  return { attachments, refused: '' };
}

function AddEntry({ today, files, onRecord }: Pick<Props, 'today' | 'files' | 'onRecord'>) {
  const [type, setType] = useState<OwnerEventType>('maintenance');
  const [date, setDate] = useState(today);
  const [mileage, setMileage] = useState('');
  const [title, setTitle] = useState('');
  const [note, setNote] = useState('');
  const [shop, setShop] = useState('');
  const [cost, setCost] = useState('');
  const [subject, setSubject] = useState<PhotoSubject>('exterior');
  const [system, setSystem] = useState<WearSystem | ''>('');
  const [work, setWork] = useState<keyof typeof WORK_LABELS>('repair');
  const [inspector, setInspector] = useState('');
  const [scope, setScope] = useState('');
  const [oem, setOem] = useState(true);
  const [doc, setDoc] = useState<keyof typeof DOCUMENT_LABELS>('title');
  const [condition, setCondition] = useState('');
  const [accident, setAccident] = useState('');
  const [titleStatus, setTitleStatus] = useState('');
  const [originality, setOriginality] = useState('');
  const [isPublic, setIsPublic] = useState(false);
  const [picked, setPicked] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [inputKey, setInputKey] = useState(0);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true); setMessage('');
    try {
      const entry = type === 'document' ? doc : type === 'photo' || type === 'maintenance' || type === 'repair' || type === 'inspection' ? type : 'other';
      const saved = await store(files, picked, entry);
      if (saved.refused) { setMessage(t(saved.refused)); return; }
      const miles = mileage.trim() === '' ? null : Number(mileage);
      const money = cost.trim() === '' ? null : Number(cost);
      const event: Record<string, unknown> = { id: newId(), type, date, mileage: miles, title: title.trim(), note: note.trim(), attachments: saved.attachments, visibility: isPublic ? 'public' : 'private' };
      if (type === 'photo') event.subject = subject;
      if (type === 'maintenance') { event.shop = shop; event.cost = money; }
      if (type === 'repair') { event.system = system === '' ? null : system; event.work = work; event.shop = shop; event.cost = money; }
      if (type === 'inspection') event.inspector = inspector;
      if (type === 'restoration') { event.scope = scope; event.oemParts = oem; }
      if (type === 'document') event.document = doc;
      if (type === 'declaration') { event.condition = condition || null; event.accident = accident || null; event.titleStatus = titleStatus || null; event.originality = originality || null; }
      const refused = onRecord(event, EVENT_TYPE_LABELS[type]);
      if (refused) {
        // The entry was refused, so the files it would have pointed at are not kept.
        for (const a of saved.attachments) await files.remove(a.id);
        setMessage(t(refused));
        return;
      }
      setTitle(''); setNote(''); setPicked([]); setInputKey((k) => k + 1); setMessage(t('Added to the passport.'));
    } catch {
      setMessage(t('That could not be saved on this device.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="gar-entry" onSubmit={submit} aria-labelledby="gar-entry-title">
      <h3 id="gar-entry-title">{t('Add an entry')}</h3>
      <div className="gar-form">
        <label>{t('What it is')}
          <select value={type} onChange={(e) => setType(e.target.value as OwnerEventType)}>{ENTRY_TYPES.map((k) => <option key={k} value={k}>{t(EVENT_TYPE_LABELS[k])}</option>)}</select>
        </label>
        <label>{t('Date')}<input type="date" value={date} max={today} required onChange={(e) => setDate(e.target.value)} /></label>
        <label>{t('Odometer')} <small>(mi)</small><input type="number" inputMode="numeric" min={0} max={2000000} step={1} value={mileage} required={type === 'mileage'} onChange={(e) => setMileage(e.target.value)} /></label>
        {type === 'photo' && <label>{t('What the photos show')}<select value={subject} onChange={(e) => setSubject(e.target.value as PhotoSubject)}>{(Object.keys(PHOTO_SUBJECT_LABELS) as PhotoSubject[]).map((k) => <option key={k} value={k}>{t(PHOTO_SUBJECT_LABELS[k])}</option>)}</select></label>}
        {type === 'repair' && <>
          <label>{t('System')}<select value={system} onChange={(e) => setSystem(e.target.value as WearSystem | '')}><option value="">{t('Not one system')}</option>{WEAR_SYSTEMS.map((k) => <option key={k} value={k}>{t(WEAR_SYSTEM_LABELS[k])}</option>)}</select></label>
          <label>{t('Work done')}<select value={work} onChange={(e) => setWork(e.target.value as keyof typeof WORK_LABELS)}>{(Object.keys(WORK_LABELS) as (keyof typeof WORK_LABELS)[]).map((k) => <option key={k} value={k}>{t(WORK_LABELS[k])}</option>)}</select></label>
        </>}
        {(type === 'maintenance' || type === 'repair') && <>
          <label>{t('Shop')}<input type="text" value={shop} maxLength={120} onChange={(e) => setShop(e.target.value)} /></label>
          <label>{t('Cost')} <small>($)</small><input type="number" inputMode="decimal" min={0} step="0.01" value={cost} onChange={(e) => setCost(e.target.value)} /></label>
        </>}
        {type === 'inspection' && <label>{t('Inspector')}<input type="text" value={inspector} maxLength={120} onChange={(e) => setInspector(e.target.value)} /></label>}
        {type === 'restoration' && <>
          <label>{t('What was restored')}<input type="text" value={scope} maxLength={200} onChange={(e) => setScope(e.target.value)} /></label>
          <label className="gar-check"><input type="checkbox" checked={oem} onChange={(e) => setOem(e.target.checked)} />{t('Done with original (OEM) parts')}</label>
        </>}
        {type === 'document' && <label>{t('Document')}<select value={doc} onChange={(e) => setDoc(e.target.value as keyof typeof DOCUMENT_LABELS)}>{(Object.keys(DOCUMENT_LABELS) as (keyof typeof DOCUMENT_LABELS)[]).map((k) => <option key={k} value={k}>{t(DOCUMENT_LABELS[k])}</option>)}</select></label>}
        {type === 'declaration' && <>
          <label>{t('Condition')}<select value={condition} onChange={(e) => setCondition(e.target.value)}><option value="">{t('Not stated')}</option>{CONDITIONS.map((c) => <option key={c.name} value={c.name}>{t(c.name)}</option>)}</select></label>
          <label>{t('Accident history')}<select value={accident} onChange={(e) => setAccident(e.target.value)}><option value="">{t('Not stated')}</option>{ACCIDENTS.map((c) => <option key={c.name} value={c.name}>{t(c.name)}</option>)}</select></label>
          <label>{t('Title')}<select value={titleStatus} onChange={(e) => setTitleStatus(e.target.value)}><option value="">{t('Not stated')}</option>{TITLES.map((c) => <option key={c.name} value={c.name}>{t(c.name)}</option>)}</select></label>
          <label>{t('Originality')}<select value={originality} onChange={(e) => setOriginality(e.target.value)}><option value="">{t('Not stated')}</option><option value="stock">{t('Factory stock')}</option><option value="modified">{t('Modified')}</option></select></label>
        </>}
        <label className="wide">{t('Title of the entry')}<input type="text" value={title} maxLength={120} placeholder={t(EVENT_TYPE_LABELS[type])} onChange={(e) => setTitle(e.target.value)} /></label>
        <label className="wide">{t('Note')}<textarea value={note} maxLength={2000} onChange={(e) => setNote(e.target.value)} /></label>
        {type !== 'mileage' && type !== 'declaration' && (
          <label className="wide">{t('Files')}
            <input key={inputKey} type="file" multiple accept="image/*,application/pdf" onChange={(e) => setPicked(Array.from(e.target.files ?? []).slice(0, 20))} />
            <span className="gar-help">{t('Images and PDFs, up to 25 MB each. They stay on this device.')}</span>
          </label>
        )}
        <label className="gar-check wide"><input type="checkbox" checked={isPublic} onChange={(e) => setIsPublic(e.target.checked)} />{t('Let others see this entry’s title. Its files, note, cost and exact day stay private either way.')}</label>
      </div>
      <div className="gar-btns">
        <button type="submit" className="gar-btn primary" disabled={busy}>{busy ? t('Saving…') : t('Add to the passport')}</button>
        {message && <span className="gar-help" role="status">{message}</span>}
      </div>
    </form>
  );
}

/**
 * What a row is called: the owner's title, or the plain name of its kind. An attestation says what was attested and a
 * modification says which one, both worked out here so they read in the page's language.
 */
function nameOf(event: PassportEvent): string {
  if (event.type === 'attestation') return `${t(EVENT_TYPE_LABELS.attestation)}: ${t(ATTESTATION_SCOPE_LABELS[event.attestation.scope])}`;
  // A title the engine wrote itself ("Parked", "Ownership transfer") is the name of the kind, in English: say it in the page's language.
  if (event.title && event.title !== EVENT_TYPE_LABELS[event.type]) return event.title;
  if (event.type === 'modification') return `${t(MODS[event.category].name)} · ${t(MOD_TIER_NAMES[event.tier - 1])} · ${event.action === 'install' ? t('fitted') : t('removed')}`;
  return t(EVENT_TYPE_LABELS[event.type]);
}

function Row({ passport, event, today, files, standing }: { passport: Passport; event: PassportEvent; today: string; files: FileStore; standing: Standing }) {
  const evidence = eventEvidence(passport, event.id, REGISTRY, today, standing);
  // An attestation that does not count says why; a record a verifier withdrew says so. Both stay on the passport.
  const status = event.type === 'attestation' ? standing.statuses.filter((x) => x.eventId === event.id)[0] : undefined;
  const standingNote = status && !status.valid ? t(status.reason) : standing.voided.indexOf(event.id) !== -1 ? t('Withdrawn by a verifier') : '';
  const open = async (a: Attachment) => {
    try {
      const blob = await files.get(a.id);
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      window.open(url, '_blank', 'noopener');
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch { /* the file is not on this device */ }
  };
  return (
    <div className="row">
      <time dateTime={event.date}>{day(event.date)}</time>
      <span className={`st ${evidence === 'verified' ? 'blue' : ''}`}>{t(EVENT_TYPE_LABELS[event.type])}</span>
      <span className="what">{nameOf(event)}
        <small>
          {[event.mileage !== null ? `${event.mileage.toLocaleString('en-US')} mi` : '', event.note, standingNote].filter(Boolean).join(' · ')}
          {event.attachments.length > 0 && <span className="gar-files">{event.attachments.map((a) => <button type="button" key={a.id} onClick={() => open(a)}>{a.name || t('file')}</button>)}</span>}
        </small>
      </span>
      <span className="fx"><small>{t(EVIDENCE_LABELS[evidence])}</small>{event.visibility === 'public' ? <span>{t('title is public')}</span> : <span>{t('private')}</span>}</span>
    </div>
  );
}

/** The VIN, entered or corrected after parking. It is checked as it is typed, kept private, and never part of what others see. */
function VinEditor({ passport, onVin, onDone }: { passport: Passport; onVin: Props['onVin']; onDone: () => void }) {
  const [vin, setVin] = useState(passport.vin);
  const [message, setMessage] = useState('');
  const note = vinNote(vin, passport.spec.identity.year);
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const refused = onVin(vin);
    if (refused) { setMessage(t(refused)); return; }
    onDone();
  };
  return (
    <form className="gar-entry" onSubmit={submit} aria-labelledby="gar-vin-title">
      <h3 id="gar-vin-title">{t('VIN')}</h3>
      <div className="gar-form">
        <label className="wide">{t('VIN')}
          <input type="text" value={vin} maxLength={24} autoComplete="off" autoCapitalize="characters" spellCheck={false} aria-describedby="gar-vin-edit-note" onChange={(e) => setVin(e.target.value)} />
          <span id="gar-vin-edit-note" className={note.tone === 'warn' ? 'gar-err' : 'gar-help'}>{t(note.text)}</span>
        </label>
      </div>
      <p className="gar-help">{t('An identity a verifier has attested is for the VIN as it stood then. Change the VIN and that attestation no longer counts.')}</p>
      <div className="gar-btns">
        <button type="submit" className="gar-btn primary">{t('Save the VIN')}</button>
        <button type="button" className="gar-btn" onClick={onDone}>{t('Cancel')}</button>
        {message && <span className="gar-err" role="alert">{message}</span>}
      </div>
    </form>
  );
}

function Transfer({ today, files, onTransfer }: Pick<Props, 'today' | 'files' | 'onTransfer'>) {
  const [to, setTo] = useState('');
  const [date, setDate] = useState(today);
  const [picked, setPicked] = useState<File[]>([]);
  const [message, setMessage] = useState('');
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const saved = await store(files, picked, 'other');
    if (saved.refused) { setMessage(t(saved.refused)); return; }
    const refused = onTransfer({ eventId: newId(), toOwnerId: to.trim(), date, attachments: saved.attachments });
    if (refused) { for (const a of saved.attachments) await files.remove(a.id); setMessage(t(refused)); return; }
    setMessage('');
  };
  return (
    <form className="gar-entry" onSubmit={submit}>
      <h3>{t('Transfer to a new owner')}</h3>
      <p className="gar-help">{t('The MiCar ID and the whole history go with the car. Ask the new owner for their Garage ID, transfer, then send them the passport file. After that this garage can read the car but not write to it.')}</p>
      <div className="gar-form">
        <label>{t('New owner’s Garage ID')}<input type="text" value={to} required autoComplete="off" spellCheck={false} onChange={(e) => setTo(e.target.value)} /></label>
        <label>{t('Date')}<input type="date" value={date} max={today} required onChange={(e) => setDate(e.target.value)} /></label>
        <label className="wide">{t('Bill of sale (optional)')}<input type="file" accept="image/*,application/pdf" onChange={(e) => setPicked(Array.from(e.target.files ?? []).slice(0, 5))} /></label>
      </div>
      <div className="gar-btns"><button type="submit" className="gar-btn danger">{t('Transfer the car')}</button>{message && <span className="gar-err" role="alert">{message}</span>}</div>
    </form>
  );
}

export function PassportPanel({ passport, today, canWrite, garageId, files, onRecord, onVin, onTransfer, onExport }: Props) {
  const events = useMemo(() => timeline(passport).slice().reverse(), [passport]);
  const standing = useMemo(() => standingOf(passport, REGISTRY, today), [passport, today]);
  const shared = useMemo(() => publicPassport(passport, REGISTRY, today, standing), [passport, today, standing]);
  const [showPublic, setShowPublic] = useState(false);
  const [editingVin, setEditingVin] = useState(false);
  return (
    <div className="gar-panel">
      <div className="gar-facts">
        <div><small>{t('MiCar ID')}</small><b className="num">{passport.micarId}</b></div>
        <div><small>{t('VIN')}</small><b className="num">{passport.vin ? maskVin(passport.vin) : t('not entered')}</b></div>
        <div><small>{t('Parked')}</small><b>{day(passport.createdAt)}</b></div>
        <div><small>{t('Owners')}</small><b className="num">{passport.owners.length}</b></div>
      </div>
      {!canWrite && <p className="gar-note gar-warn">{t('This car has been transferred. Its passport is read-only here. Send the new owner the passport file.')}</p>}
      <div className="gar-btns">
        <button type="button" className="gar-btn" onClick={onExport}>{t('Download the passport file')}</button>
        <button type="button" className="gar-btn" aria-expanded={showPublic} onClick={() => setShowPublic((v) => !v)}>{showPublic ? t('Hide what others see') : t('What others see')}</button>
        {canWrite && !editingVin && <button type="button" className="gar-btn" onClick={() => setEditingVin(true)}>{passport.vin ? t('Correct the VIN') : t('Enter the VIN')}</button>}
      </div>
      {canWrite && editingVin && <VinEditor passport={passport} onVin={onVin} onDone={() => setEditingVin(false)} />}

      {showPublic && (
        <div className="gar-public" aria-label={t('What others see')}>
          <p className="gar-help">{t('This is all anyone else would be shown: no VIN, no names, no files, no notes, no costs, months instead of days, mileage rounded down to the thousand.')}</p>
          <div className="gar-facts">
            <div><small>{t('MiCar ID')}</small><b className="num">{shared.micarId}</b></div>
            <div><small>{t('VIN')}</small><b>{shared.vinOnFile ? t('on file') : t('not on file')}</b></div>
            <div><small>{t('Owners')}</small><b className="num">{shared.ownerCount}</b></div>
            <div><small>{t('Current owner since')}</small><b>{month(shared.currentOwnerSince)}</b></div>
          </div>
          <ul className="gar-list">
            {shared.events.slice().reverse().map((e, i) => (
              <li key={i}><b>{month(e.month)}</b> · {e.title ? t(e.title) : t(EVENT_TYPE_LABELS[e.type])}{e.scope !== null ? `: ${t(ATTESTATION_SCOPE_LABELS[e.scope])}` : ''}{e.mileage !== null ? ` · ${e.mileage.toLocaleString('en-US')} mi` : ''}{e.verified ? ` · ${t('verified')}` : ''}</li>
            ))}
          </ul>
        </div>
      )}

      {canWrite && <AddEntry today={today} files={files} onRecord={onRecord} />}

      <div>
        <h3>{t('Timeline')}</h3>
        <div className="ledger gar-ledger">{events.map((e) => <Row key={e.id} passport={passport} event={e} today={today} files={files} standing={standing} />)}</div>
      </div>

      <div>
        <h3>{t('Grade history')}</h3>
        <p className="gar-help">{t('Each grade is kept as it stood. History is never rewritten.')}</p>
        <div className="gar-scroll">
          <table className="gar-table">
            <thead><tr><th>{t('Date')}</th><th>{t('Why')}</th><th>{t('Level')}</th><th className="num">{t('Overall')}</th><th className="num">{t('Grade')}</th></tr></thead>
            <tbody>
              {passport.snapshots.slice().reverse().map((s) => (
                <tr key={s.id}><td>{day(s.asOf)}</td><td>{t(s.reason)}</td><td>{t(LEVEL_LABELS[s.level])}</td><td className="num">{s.overall.toFixed(1)}</td><td className="num">{s.level === 'registered' ? 'RAW' : s.grade10.toFixed(1)}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div>
        <h3>{t('Card editions')}</h3>
        <p className="gar-help">{t('A new edition is printed at each milestone. Earlier ones stay with the car.')}</p>
        <ul className="gar-list">
          {passport.editions.slice().reverse().map((e) => (
            <li key={e.number}><b>{t('Ed. {n}', { n: e.number })}</b> · {t(e.name)} · {day(e.issuedAt)} · {e.powerRating === null ? t('Power rating not complete') : t('Power rating {n}', { n: e.powerRating })}{e.grade10 !== null ? ` · ${t('Grade {n}', { n: e.grade10.toFixed(1) })}` : ''}</li>
          ))}
        </ul>
      </div>

      <div>
        <h3>{t('Ownership')}</h3>
        <ul className="gar-list">
          {passport.owners.map((o, i) => (
            <li key={`${o.ownerId}-${o.from}`}><b>{t('Owner {n}', { n: i + 1 })}</b> · {day(o.from)} – {o.to ? day(o.to) : t('today')}{o.ownerId === garageId ? ` · ${t('this garage')}` : ''}</li>
          ))}
        </ul>
        <p className="gar-help">{t('Your Garage ID is {id}. Give it to a seller to receive a car.', { id: garageId })}</p>
      </div>

      {canWrite && <Transfer today={today} files={files} onTransfer={onTransfer} />}
    </div>
  );
}

/** The local clock, for the page that calls the store. Re-exported so the panels share one source of time. */
export { stamp };
