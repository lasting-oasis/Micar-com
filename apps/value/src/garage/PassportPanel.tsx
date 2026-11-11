// The passport: the vehicle's timeline, the form that adds to it, the grade's history, the card's editions, who has
// owned it, and what other people would see. Entries are only ever added. Files go to this browser's own store and
// the passport keeps their name, size and fingerprint; a file moves a claim from declared to documented and no further.
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ATTESTATION_SCOPE_LABELS, EVENT_TYPE_LABELS, EVIDENCE_LABELS, LEVEL_LABELS, MODS, MOD_TIER_NAMES, WEAR_SYSTEMS, WEAR_SYSTEM_LABELS, eventEvidence, maskVin, mileageLog,
  publicPassport, standingOf, supportedHistory, timeline,
} from '@micar/engine';
import type { Attachment, OwnerEventType, Passport, PassportEvent, PhotoSubject, Standing, WearSystem } from '@micar/engine';
import { ACCIDENTS, CONDITIONS, TITLES } from '../engine/data';
import { locale, t } from '../i18n';
import { attachmentKind, checkFile, sha256Hex, type FileStore } from './files';
import { useEntryDate } from './dates';
import { useFocusBack } from './focus';
import { newId, normalizeGarageId, stamp } from './ids';
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
  /** What this garage is to the car. Only its owner can write; a past owner and anyone else can read. */
  holding: 'owner' | 'transferred' | 'other';
  /** Every Garage ID this browser answers to: the one it gives out first. */
  garageIds: string[];
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
  try {
    for (const file of picked) {
      const id = newId();
      await files.put(id, file);
      attachments.push({ id, kind: attachmentKind(file.type, entry), name: file.name, mime: file.type, size: file.size, sha256: await sha256Hex(file) });
    }
  } catch (error) {
    // One file could not be kept (the device is full, say): the ones already kept for this entry are taken back out,
    // so no file is left on the device with no entry pointing at it.
    for (const a of attachments) { try { await files.remove(a.id); } catch { /* already gone */ } }
    throw error;
  }
  return { attachments, refused: '' };
}

/** Keeps the files picked for an entry on this device. Shared with the Mods tab, so both keep files the same way. */
export const keepFiles = store;

/** How many rows of the timeline, the grade history or the public list are drawn at a time. */
const LONG_LIST = 200;
/** How many of an entry's files a row draws before it offers the rest. */
const FILES_IN_A_ROW = 4;

/** How far above the last reading a new one can be before the form asks the owner to look again. */
const ODOMETER_JUMP = 30000;

export const ODOMETER_NOTES = [
  'That is lower than a reading from an earlier day, so it will be recorded as an odometer rollback. A reading can be put right the day it is written, and not after.',
  'That is a long way above the highest reading so far. Check the digits: a reading can be put right the day it is written, and not after.',
  'That is higher than a reading from a later day, so it will be recorded as an odometer rollback. A reading can be put right the day it is written, and not after.',
] as const;

/**
 * What the form says about an odometer reading before it is written, given the day the entry is dated, the readings
 * on the log and today's date. It says exactly what the engine will do. A reading lower than an earlier day's is a
 * rollback. So is a back-dated reading higher than a later day's; an old receipt showing fewer miles than the car
 * has now is not. A reading dated today is read off the odometer after everything already on the passport, whatever
 * dates those entries carry, so it cannot contradict a later day's: a previous owner whose calendar was a day ahead
 * leaves no trap for it. A reading can be put right the day it is written and never after, so a slipped digit is
 * worth catching here.
 */
export function odometerNote(text: string, date: string, readings: readonly { date: string; mileage: number }[], today: string): string {
  const miles = Number(text);
  if (text.trim() === '' || !Number.isFinite(miles) || readings.length === 0) return '';
  if (readings.some((r) => r.date < date && r.mileage > miles)) return ODOMETER_NOTES[0];
  if (date < today && readings.some((r) => r.date > date && r.mileage < miles)) return ODOMETER_NOTES[2];
  let highest = 0;
  for (const r of readings) highest = Math.max(highest, r.mileage);
  return miles > highest + ODOMETER_JUMP ? ODOMETER_NOTES[1] : '';
}

/**
 * The log as the forms read it: with every entry on the passport in view. An entry a previous owner dated a day
 * ahead of this device's calendar is not on the log "as of today" yet, and it is one a back-dated reading can
 * contradict tomorrow.
 */
export function readingsInView(passport: Passport, today: string): { date: string; mileage: number }[] {
  let latest = today;
  for (const e of passport.events) if (e.date > latest) latest = e.date;
  return mileageLog(passport, REGISTRY, latest).readings;
}

function AddEntry({ files, onRecord, readings }: Pick<Props, 'files' | 'onRecord'> & { readings: readonly { date: string; mileage: number }[] }) {
  const [type, setType] = useState<OwnerEventType>('maintenance');
  // Today by the clock at this draw, not the day the tab was opened: see useEntryDate.
  const { today, date, pick: setDate } = useEntryDate();
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
  // What the last press came to. A refusal is drawn, and announced, as one: it must never read like the line that says it worked.
  const [said, setSaid] = useState<{ text: string; refused: boolean }>({ text: '', refused: false });
  const setMessage = (text: string, refused = false) => setSaid({ text, refused });
  const [inputKey, setInputKey] = useState(0);
  const takesFiles = type !== 'mileage' && type !== 'declaration';
  // A reading the form has a warning about is written only on a second, deliberate press: it can be put right today
  // and never after. What was asked about is this exact reading on this exact day; change either and it is asked again.
  const warning = odometerNote(mileage, date, readings, today);
  const reading = `${date}|${mileage}`;
  const [asked, setAsked] = useState('');
  const confirming = warning !== '' && asked === reading;
  // The button that asks is given the keyboard back when the question is withdrawn and when the write is done (it is
  // disabled while the write is under way, and a disabled button cannot take it).
  const opener = useFocusBack(confirming || busy);

  // A file belongs to the entry it was picked for. Choosing another kind of entry starts the files again, so a
  // receipt picked for one thing is never quietly attached to another and counted as its evidence.
  const changeType = (next: OwnerEventType) => { setType(next); setPicked([]); setInputKey((k) => k + 1); setMessage(''); };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    if (warning !== '' && !confirming) { setAsked(reading); setMessage(''); return; }
    setBusy(true); setMessage(''); setAsked('');
    try {
      const entry = type === 'document' ? doc : type === 'photo' || type === 'maintenance' || type === 'repair' || type === 'inspection' ? type : 'other';
      const saved = await store(files, takesFiles ? picked : [], entry);
      if (saved.refused) { setMessage(t(saved.refused), true); return; }
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
        setMessage(t(refused), true);
        return;
      }
      setTitle(''); setNote(''); setPicked([]); setInputKey((k) => k + 1); setMessage(t('Added to the passport.'));
    } catch {
      setMessage(t('That could not be saved on this device.'), true);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="gar-entry" onSubmit={submit} aria-labelledby="gar-entry-title">
      <h3 id="gar-entry-title">{t('Add an entry')}</h3>
      <div className="gar-form">
        <label>{t('What it is')}
          <select value={type} onChange={(e) => changeType(e.target.value as OwnerEventType)}>{ENTRY_TYPES.map((k) => <option key={k} value={k}>{t(EVENT_TYPE_LABELS[k])}</option>)}</select>
        </label>
        <label>{t('Date')}<input type="date" value={date} max={today} required onChange={(e) => { setDate(e.target.value); setAsked(''); }} /></label>
        <label>{t('Odometer')} <small>(mi)</small>
          <input type="number" inputMode="numeric" min={0} max={2000000} step={1} value={mileage} required={type === 'mileage'} aria-describedby="gar-odo-note" onChange={(e) => { setMileage(e.target.value); setAsked(''); }} />
          <span id="gar-odo-note" className="gar-err" role="status">{t(warning)}</span>
        </label>
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
        {takesFiles && (
          <label className="wide">{t('Files')}
            <input key={inputKey} type="file" multiple accept="image/*,application/pdf" onChange={(e) => setPicked(Array.from(e.target.files ?? []).slice(0, 20))} />
            <span className="gar-help">{t('Images and PDFs, up to 25 MB each. They stay on this device.')}</span>
          </label>
        )}
        <label className="gar-check wide"><input type="checkbox" checked={isPublic} onChange={(e) => setIsPublic(e.target.checked)} />{t('Let others see this entry’s title. Its files, note, cost and exact day stay private either way.')}</label>
      </div>
      <div className="gar-btns">
        {confirming
          ? <>
            <span className="gar-help" role="status">{t('Add this reading as it is written? It stays on the passport, and it can be put right today and not after.')}</span>
            <button type="submit" className="gar-btn danger" disabled={busy}>{t('Yes, add it')}</button>
            <button type="button" className="gar-btn" autoFocus onClick={() => setAsked('')}>{t('Go back')}</button>
          </>
          : <button type="submit" className="gar-btn primary" ref={opener} disabled={busy}>{busy ? t('Saving…') : t('Add to the passport')}</button>}
        {said.text !== '' && (said.refused
          ? <span key="refused" className="gar-err" role="alert">{said.text}</span>
          : <span key="done" className="gar-help" role="status">{said.text}</span>)}
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
  const [missing, setMissing] = useState(false);
  // An entry can name twenty files, and a passport five thousand entries: a row draws a few and offers the rest.
  const [allFiles, setAllFiles] = useState(false);
  const shownFiles = allFiles ? event.attachments : event.attachments.slice(0, FILES_IN_A_ROW);
  const rest = event.attachments.length - shownFiles.length;
  // The button that offers the rest leaves the page when it is pressed: the keyboard goes to the first file it revealed.
  const revealed = useRef<HTMLButtonElement | null>(null);
  useEffect(() => { if (allFiles) { try { revealed.current?.focus(); } catch { /* no document */ } } }, [allFiles]);
  const open = async (a: Attachment) => {
    try {
      const blob = await files.get(a.id);
      // The passport holds a file's name and fingerprint; the file itself stays on the device it was added on.
      if (!blob) { setMissing(true); return; }
      setMissing(false);
      const url = URL.createObjectURL(blob);
      window.open(url, '_blank', 'noopener');
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch { setMissing(true); }
  };
  return (
    <div className="row">
      <time dateTime={event.date}>{day(event.date)}</time>
      <span className={`st ${evidence === 'verified' ? 'blue' : ''}`}>{t(EVENT_TYPE_LABELS[event.type])}</span>
      <span className="what">{nameOf(event)}
        <small>
          {[event.mileage !== null ? `${event.mileage.toLocaleString('en-US')} mi` : '', event.note, standingNote].filter(Boolean).join(' · ')}
          {event.attachments.length > 0 && <span className="gar-files">{shownFiles.map((a, i) => <button type="button" key={a.id} ref={i === FILES_IN_A_ROW ? revealed : undefined} onClick={() => open(a)}>{a.name || t('file')}</button>)}{rest > 0 && <button type="button" onClick={() => setAllFiles(true)}>{rest === 1 ? t('1 more file') : t('{n} more files', { n: rest })}</button>}</span>}
          {missing && <span className="gar-err" role="status">{t('That file is not on this device. A passport file carries each file’s name and fingerprint, not the file.')}</span>}
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
          <input type="text" value={vin} maxLength={24} autoComplete="off" autoCapitalize="characters" spellCheck={false} autoFocus aria-describedby="gar-vin-edit-note" onChange={(e) => setVin(e.target.value)} />
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

function Transfer({ files, onTransfer }: Pick<Props, 'files' | 'onTransfer'>) {
  const [to, setTo] = useState('');
  const { today, date, pick: setDate } = useEntryDate();
  const [picked, setPicked] = useState<File[]>([]);
  const [message, setMessage] = useState('');
  // The ID as the engine will store it, once what was typed is a real Garage ID. Null until then.
  const buyer = normalizeGarageId(to);
  const [confirming, setConfirming] = useState(false);
  const opener = useFocusBack(confirming && buyer !== null);
  const ask = (e: React.FormEvent) => {
    e.preventDefault();
    if (buyer === null) { setMessage(t('That is not a Garage ID')); return; }
    setMessage(''); setConfirming(true);
  };
  const send = async () => {
    try {
      const saved = await store(files, picked, 'other');
      if (saved.refused) { setMessage(t(saved.refused)); setConfirming(false); return; }
      const refused = onTransfer({ eventId: newId(), toOwnerId: to.trim(), date, attachments: saved.attachments });
      if (refused) { for (const a of saved.attachments) await files.remove(a.id); setMessage(t(refused)); setConfirming(false); return; }
      setMessage('');
    } catch {
      // The bill of sale could not be kept (the device is full, say). Nothing was handed over.
      setMessage(t('That could not be saved on this device.')); setConfirming(false);
    }
  };
  return (
    <form className="gar-entry" onSubmit={ask}>
      <h3>{t('Transfer to a new owner')}</h3>
      <p className="gar-help">{t('The MiCar ID and the whole history go with the car. Ask the new owner for their Garage ID, transfer, then send them the passport file. After that this garage can read the car but not write to it.')}</p>
      <p className="gar-help">{t('The photographs and receipts stay on this device: the passport file carries their names and fingerprints, not the files. Send the new owner the files you want them to have.')}</p>
      <div className="gar-form">
        <label>{t('New owner’s Garage ID')}
          <input type="text" value={to} required autoComplete="off" autoCapitalize="characters" spellCheck={false} aria-describedby="gar-to-note" onChange={(e) => { setTo(e.target.value); setConfirming(false); setMessage(''); }} />
          <span id="gar-to-note" className={to.trim() !== '' && buyer === null ? 'gar-err' : 'gar-help'}>{to.trim() === '' ? t('It starts with G- and ends with a check character, so a slip is caught.') : buyer === null ? t('That is not a Garage ID') : t('That is a Garage ID.')}</span>
        </label>
        <label>{t('Date')}<input type="date" value={date} max={today} required onChange={(e) => setDate(e.target.value)} /></label>
        <label className="wide">{t('Bill of sale (optional)')}<input type="file" accept="image/*,application/pdf" onChange={(e) => setPicked(Array.from(e.target.files ?? []).slice(0, 5))} /></label>
      </div>
      <div className="gar-btns">
        {confirming && buyer !== null
          ? <>
            <span className="gar-help" role="status">{t('Hand this car to {id}? It cannot be undone: after this, only that garage can write to its passport.', { id: buyer })}</span>
            <button type="button" className="gar-btn danger" onClick={() => { void send(); }}>{t('Yes, transfer it')}</button>
            <button type="button" className="gar-btn" autoFocus onClick={() => setConfirming(false)}>{t('Cancel')}</button>
          </>
          : <button type="submit" className="gar-btn danger" ref={opener}>{t('Transfer the car')}</button>}
        {message && <span className="gar-err" role="alert">{message}</span>}
      </div>
    </form>
  );
}

export function PassportPanel({ passport, today, holding, garageIds, files, onRecord, onVin, onTransfer, onExport }: Props) {
  const canWrite = holding === 'owner';
  const events = useMemo(() => timeline(passport).slice().reverse(), [passport]);
  const standing = useMemo(() => standingOf(passport, REGISTRY, today), [passport, today]);
  const shared = useMemo(() => publicPassport(passport, REGISTRY, today, standing), [passport, today, standing]);
  // Stored grades and editions are shown only when the passport's own record supports them: a file can say anything.
  const history = useMemo(() => supportedHistory(passport, REGISTRY, today), [passport, today]);
  const readings = useMemo(() => readingsInView(passport, today), [passport, today]);
  const [showPublic, setShowPublic] = useState(false);
  const [editingVin, setEditingVin] = useState(false);
  const vinOpener = useFocusBack(editingVin);
  // A long history is drawn a page at a time, newest first, and the rest a page at a time too: a passport can hold
  // thousands of entries and grades, and a file from someone else decides how heavy one press would be.
  const [entryCount, setEntryCount] = useState(LONG_LIST);
  const [gradeCount, setGradeCount] = useState(LONG_LIST);
  const [publicCount, setPublicCount] = useState(LONG_LIST);
  // When the last page is drawn its button leaves the page: the keyboard goes to the list it finished.
  const ledger = useRef<HTMLDivElement>(null);
  const grades = useRef<HTMLDivElement>(null);
  const others = useRef<HTMLUListElement>(null);
  const more = (shown: number, total: number, set: (n: number) => void, list: { current: HTMLElement | null }) => () => {
    set(shown + LONG_LIST);
    if (shown + LONG_LIST >= total) setTimeout(() => list.current?.focus(), 0);
  };
  // An entry just written is always drawn. The list is in order of the entries' own dates, so an old receipt entered
  // today can fall beyond the pages drawn: it is then shown above the list, by itself.
  const written = useRef(passport.events.length);
  const [justAdded, setJustAdded] = useState('');
  useEffect(() => {
    if (passport.events.length > written.current) setJustAdded(passport.events[passport.events.length - 1].id);
    written.current = passport.events.length;
  }, [passport]);
  const drawn = events.slice(0, entryCount);
  const beyond = justAdded === '' || drawn.some((e) => e.id === justAdded) ? null : events.filter((e) => e.id === justAdded)[0] ?? null;
  const publicEvents = useMemo(() => shared.events.slice().reverse(), [shared]);
  // After a hand-over the transfer form is gone: the keyboard goes to the line that says what has happened.
  const notice = useRef<HTMLParagraphElement>(null);
  const held = useRef(holding);
  useEffect(() => {
    if (held.current === 'owner' && holding === 'transferred') notice.current?.focus();
    held.current = holding;
  }, [holding]);
  return (
    <div className="gar-panel">
      <div className="gar-facts">
        <div><small>{t('MiCar ID')}</small><b className="num">{passport.micarId}</b></div>
        <div><small>{t('VIN')}</small><b className="num">{passport.vin ? maskVin(passport.vin) : t('not entered')}</b></div>
        <div><small>{t('Parked')}</small><b>{day(passport.createdAt)}</b></div>
        <div><small>{t('Owners')}</small><b className="num">{passport.owners.length}</b></div>
      </div>
      {holding === 'transferred' && <p className="gar-note gar-warn" ref={notice} tabIndex={-1}>{t('This car has been transferred. Its passport is read-only here. Send the new owner the passport file.')}</p>}
      {holding === 'other' && <p className="gar-note gar-warn">{t('This car belongs to another garage, so its passport is read-only here. If that garage is yours, bring its garage file in on the Garage page and take up its Garage ID when asked.')}</p>}
      <div className="gar-btns">
        <button type="button" className="gar-btn" onClick={onExport}>{t('Download the passport file')}</button>
        <button type="button" className="gar-btn" aria-expanded={showPublic} onClick={() => setShowPublic((v) => !v)}>{showPublic ? t('Hide what others see') : t('What others see')}</button>
        {canWrite && !editingVin && <button type="button" className="gar-btn" ref={vinOpener} onClick={() => setEditingVin(true)}>{passport.vin ? t('Correct the VIN') : t('Enter the VIN')}</button>}
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
          <ul className="gar-list" ref={others} tabIndex={-1} aria-label={t('What others see')}>
            {publicEvents.slice(0, publicCount).map((e, i) => (
              <li key={i}><b>{month(e.month)}</b> · {e.title ? t(e.title) : t(EVENT_TYPE_LABELS[e.type])}{e.scope !== null ? `: ${t(ATTESTATION_SCOPE_LABELS[e.scope])}` : ''}{e.mileage !== null ? ` · ${e.mileage.toLocaleString('en-US')} mi` : ''}{e.verified ? ` · ${t('verified')}` : ''}</li>
            ))}
          </ul>
          {publicEvents.length > publicCount && <div className="gar-btns"><button type="button" className="gar-btn" onClick={more(publicCount, publicEvents.length, setPublicCount, others)}>{t('Show {n} more ({left} not shown)', { n: Math.min(LONG_LIST, publicEvents.length - publicCount), left: publicEvents.length - publicCount })}</button></div>}
        </div>
      )}

      {canWrite && <AddEntry files={files} onRecord={onRecord} readings={readings} />}

      <div>
        <h3>{t('Timeline')}</h3>
        {beyond && <>
          <p className="gar-help" role="status">{t('The entry just added is dated before the ones shown below. Here it is:')}</p>
          <div className="ledger gar-ledger"><Row passport={passport} event={beyond} today={today} files={files} standing={standing} /></div>
        </>}
        <div className="ledger gar-ledger" ref={ledger} tabIndex={-1} aria-label={t('Timeline')}>{drawn.map((e) => <Row key={e.id} passport={passport} event={e} today={today} files={files} standing={standing} />)}</div>
        {events.length > entryCount && <div className="gar-btns"><button type="button" className="gar-btn" onClick={more(entryCount, events.length, setEntryCount, ledger)}>{t('Show {n} more ({left} not shown)', { n: Math.min(LONG_LIST, events.length - entryCount), left: events.length - entryCount })}</button></div>}
      </div>

      <div>
        <h3>{t('Grade history')}</h3>
        <p className="gar-help">{t('Each grade is kept as it stood. History is never rewritten.')}</p>
        {history.unsupported > 0 && <p className="gar-note gar-warn" role="status">{history.unsupported === 1
          ? t('1 earlier grade or edition is not shown: the passport’s record, as it stands now, does not support it.')
          : t('{n} earlier grades or editions are not shown: the passport’s record, as it stands now, does not support them.', { n: history.unsupported })}</p>}
        {history.ahead > 0 && <p className="gar-note" role="status">{history.ahead === 1
          ? t('1 grade or edition is dated after today on this device’s calendar. It shows from that day.')
          : t('{n} grades or editions are dated after today on this device’s calendar. They show from that day.', { n: history.ahead })}</p>}
        <div className="gar-scroll" ref={grades} tabIndex={-1} aria-label={t('Grade history')}>
          <table className="gar-table">
            <thead><tr><th>{t('Date')}</th><th>{t('Why')}</th><th>{t('Level')}</th><th className="num">{t('Overall')}</th><th className="num">{t('Grade')}</th></tr></thead>
            <tbody>
              {history.snapshots.slice(-gradeCount).reverse().map((s) => (
                <tr key={s.id}><td>{day(s.asOf)}</td><td>{t(s.reason)}</td><td>{t(LEVEL_LABELS[s.level])}</td><td className="num">{s.overall.toFixed(1)}</td><td className="num">{s.level === 'registered' ? 'RAW' : s.grade10.toFixed(1)}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
        {history.snapshots.length > gradeCount && <div className="gar-btns"><button type="button" className="gar-btn" onClick={more(gradeCount, history.snapshots.length, setGradeCount, grades)}>{t('Show {n} more ({left} not shown)', { n: Math.min(LONG_LIST, history.snapshots.length - gradeCount), left: history.snapshots.length - gradeCount })}</button></div>}
      </div>

      <div>
        <h3>{t('Card editions')}</h3>
        <p className="gar-help">{t('A new edition is printed at each milestone. Earlier ones stay with the car. The Power rating on an edition is what the spec sheet gave on the day it was printed.')}</p>
        <ul className="gar-list">
          {history.editions.slice().reverse().map((e) => (
            <li key={e.number}><b>{t('Ed. {n}', { n: e.number })}</b> · {t(e.name)} · {day(e.issuedAt)} · {e.powerRating === null ? t('Power rating not complete') : t('Power rating {n}', { n: e.powerRating })}{e.grade10 !== null ? ` · ${t('Grade {n}', { n: e.grade10.toFixed(1) })}` : ''}</li>
          ))}
        </ul>
      </div>

      <div>
        <h3>{t('Ownership')}</h3>
        <ul className="gar-list">
          {passport.owners.map((o, i) => (
            <li key={`${o.ownerId}-${o.from}`}><b>{t('Owner {n}', { n: i + 1 })}</b> · {day(o.from)} – {o.to ? day(o.to) : t('today')}{garageIds.indexOf(o.ownerId) !== -1 ? ` · ${t('this garage')}` : ''}</li>
          ))}
        </ul>
        <p className="gar-help">{t('Your Garage ID is {id}. Give it to a seller to receive a car.', { id: garageIds[0] })}</p>
      </div>

      {canWrite && <Transfer files={files} onTransfer={onTransfer} />}
    </div>
  );
}

/** The local clock, for the page that calls the store. Re-exported so the panels share one source of time. */
export { stamp };
