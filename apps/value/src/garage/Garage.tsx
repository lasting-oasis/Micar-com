// The Garage: the cars parked on this device, as cards, and the page of one of them.
// Nothing here leaves the browser: the cars are kept by garage/store.ts and their files by garage/files.ts.
import { useEffect, useMemo, useRef, useState } from 'react';
import { BODY_CLASSES, BODY_CLASS_LABELS, LEVEL_LABELS, checkIdentity, micarIdFromBytes, normalizeMicarId, ownerSource } from '@micar/engine';
import type { Assembly, BodyClass, Passport, Sourced, VehicleSpec } from '@micar/engine';
import { garageUrl } from '../car/record';
import { Footer } from '../Footer';
import { Strip } from '../Strip';
import { t, tx } from '../i18n';
import '../door.css';
import './garage.css';
import './panels.css';
import { CollectibleCard } from './CollectibleCard';
import { Examples } from './Examples';
import { useFocusBack } from './focus';
import { GradePanel } from './GradePanel';
import { newId, randomBytes, stamp, today as todayOf } from './ids';
import { ModsPanel } from './ModsPanel';
import { Park, type ParkRequest } from './Park';
import { PassportPanel } from './PassportPanel';
import { RacePanel } from './RacePanel';
import { SpecForm } from './SpecForm';
import { StatsPanel } from './StatsPanel';
import { assembleCar, exportGarage, filesOnlyOf, findCar, garageIds, holdingOf, importGarage, ownsCar, park, record, removeCar, replaceSpec, replaceVin, takeUpGarage, transfer, type GarageState, type Restorable } from './store';
import { useFileUrl, useGarage, type GarageHandle } from './useGarage';
import { HOLDING_WORDS, RENAMED_NOTE, TABS, type Tab } from './words';


/** The largest garage or passport file the page will read. */
const MAX_IMPORT_BYTES = 20 * 1024 * 1024;

/** Saves text as a file the owner keeps. */
function download(name: string, text: string) {
  try {
    const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url; a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  } catch { /* a sandboxed frame may refuse downloads */ }
}

function StorageNotice({ g }: { g: GarageHandle }) {
  return (
    <>
      <p className="gar-notice"><span className="marker">{t('on this device')}</span>{t('Saved on this device. Nothing here leaves your browser. Accounts come with phase 1.')}</p>
      {!g.persisted && <p className="gar-note gar-warn" role="status">{t('This browser is not keeping the garage. It works until you close the page: download the garage file to keep it.')}</p>}
      {g.skipped > 0 && <p className="gar-note gar-warn" role="status">{g.skipped === 1 ? t('1 saved car could not be read and was left untouched.') : t('{n} saved cars could not be read and were left untouched.', { n: g.skipped })}</p>}
    </>
  );
}

function CarTile({ passport, g, today }: { passport: Passport; g: GarageHandle; today: string }) {
  const assembly = useMemo(() => assembleCar(passport, today), [passport, today]);
  const photo = useFileUrl(g.files, assembly.card.photoAttachmentId);
  const holding = HOLDING_WORDS[holdingOf(g.state, passport)];
  return (
    <div className="gar-cell">
      <a href={garageUrl(passport.micarId)} aria-label={assembly.card.title}><CollectibleCard card={assembly.card} report={assembly.report} photoUrl={photo} /></a>
      <p className="gar-cap">{assembly.card.title}<small>{assembly.card.subtitle || passport.micarId}{holding === '' ? '' : ` · ${t(holding)}`}</small></p>
    </div>
  );
}

function Home({ g, today }: { g: GarageHandle; today: string }) {
  const [parking, setParking] = useState(false);
  const [message, setMessage] = useState('');
  // A backup that was just brought in and names Garage IDs this browser does not answer to, waiting for a yes or a no.
  const [offered, setOffered] = useState<Restorable | null>(null);
  // It stands only while taking it up would change something: another tab may have taken it up since it was made.
  const offer = offered !== null && takeUpGarage(g.state, offered) !== g.state ? offered : null;
  const mine = garageIds(g.state);
  // A file that gives out an ID this browser already answers to is this garage's own backup, from a browser that answers to more.
  const ownBackup = offer !== null && mine.indexOf(offer.ownerId) !== -1;
  const lacking = offer === null ? '' : [offer.ownerId, ...offer.formerIds].filter((id) => mine.indexOf(id) === -1).join(', ');
  const picker = useRef<HTMLInputElement>(null);
  const parkOpener = useFocusBack(parking);
  const fileOpener = useFocusBack(offer !== null);

  const onPark = (request: ParkRequest): string | null => {
    const id = micarIdFromBytes(randomBytes(8));
    if (!id.ok) return id.reason;
    const result = park(g.latest(), { micarId: id.value, eventId: newId(), snapshotId: newId(), now: stamp(), spec: request.spec, color: request.color, vin: request.vin });
    if (!result.ok) return result.reason;
    g.apply(result.value);
    try { window.location.hash = `#/garage/${id.value}`; } catch { /* no window */ }
    return null;
  };
  const onImport = async (file: File | undefined) => {
    if (!file) return;
    // A garage file is text and small. Anything this large is not one, and is not read.
    if (file.size > MAX_IMPORT_BYTES) { setMessage(t('That file is too large to be a garage or passport file.')); return; }
    try {
      const text = await file.text();
      const result = importGarage(g.latest(), text);
      if (!result.ok) { setMessage(t(result.reason)); return; }
      // A passport file can be megabytes. One this browser has no room to keep would stop it keeping the whole garage.
      if (!g.applyIfKept(result.value.state)) { setMessage(t('That file is too large for this browser to keep, so nothing was brought in.')); return; }
      setMessage(t('{added} added, {updated} updated, {skipped} left out.', { added: result.value.added, updated: result.value.updated, skipped: result.value.skipped }));
      // Bringing a file in never changes this garage's IDs. A backup that names others is offered, and taken up only on a yes.
      setOffered(result.value.restorable);
    } catch { setMessage(t('That file is not a garage export')); }
  };
  const takeUp = (garage: Restorable) => {
    const before = g.latest();
    const after = takeUpGarage(before, garage);
    setOffered(null);
    // Taken up already (in another tab, say): there is nothing to do and nothing to announce.
    if (after === before) return;
    g.apply(after);
    const had = garageIds(before);
    const gained = garageIds(after).filter((id) => had.indexOf(id) === -1).join(', ');
    setMessage(after.ownerId === before.ownerId
      ? t('This browser now answers to {ids} too, and the cars parked under them are yours to write to. It still gives out Garage ID {id}.', { ids: gained, id: after.ownerId })
      : t('This browser now gives out Garage ID {id}, and the cars parked under it are yours to write to. {was} still works here too: a car sent to it will arrive.', { id: after.ownerId, was: before.ownerId }));
  };

  return (
    <>
      <header className="gar-head">
        <h1>{tx('{mi}Car Garage', { mi: <span className="mi">Mi</span> })}</h1>
        <p className="lede">{t('Your cars, as cards.')}</p>
        <StorageNotice g={g} />
        <div className="gar-actions">
          {!parking && <button type="button" className="drip" ref={parkOpener} onClick={() => setParking(true)}>{t('Park a car')}</button>}
          {g.state.passports.length > 0 && <button type="button" className="ghostbtn" onClick={() => download(`micar-garage-${today}.json`, exportGarage(g.state, stamp()))}>{t('Download the garage file')}</button>}
          <button type="button" className="ghostbtn" ref={fileOpener} onClick={() => picker.current?.click()}>{t('Bring in a garage or passport file')}</button>
          <input ref={picker} type="file" accept="application/json,.json" hidden onChange={(e) => { void onImport(e.target.files?.[0]); e.target.value = ''; }} />
        </div>
        {message && <p className="gar-help" role="status">{message}</p>}
        {offer && (
          <div className="gar-note gar-warn" role="group" aria-labelledby="gar-offer">
            <p id="gar-offer" role="status">{ownBackup
              ? t('This file is a backup of this garage from a browser that also answers to {ids}. A car parked under one of those is read-only here until this browser answers to it too. Do that only if the file is yours. The Garage ID you give out stays {mine}.', { ids: lacking, mine: g.state.ownerId })
              : t('This file is the backup of garage {theirs}. Its cars are read-only here unless this browser takes up that Garage ID. Do that only if the garage is yours. Your present Garage ID, {mine}, is kept and goes on receiving cars.', { theirs: offer.ownerId, mine: g.state.ownerId })}</p>
            <div className="gar-btns">
              <button type="button" className="gar-btn primary" onClick={() => takeUp(offer)}>{t('Take up {id}', { id: ownBackup ? lacking : offer.ownerId })}</button>
              <button type="button" className="gar-btn" autoFocus onClick={() => setOffered(null)}>{t('Keep things as they are')}</button>
            </div>
          </div>
        )}
      </header>

      {parking && <section className="gar-sec"><Park today={today} onPark={onPark} onCancel={() => setParking(false)} /></section>}

      <section className="gar-sec" aria-labelledby="gar-yours">
        <h2 id="gar-yours">{t('Your cars')}</h2>
        {g.state.passports.length === 0
          ? <p className="gar-empty">{t('No car parked yet. Park one and it gets a MiCar ID, seven attributes from its specification, a Power Rating, a grade and its first card.')}</p>
          : <div className="gar-grid">{g.state.passports.map((p) => <CarTile key={p.micarId} passport={p} g={g} today={today} />)}</div>}
        <p className="gar-help">{t('Your Garage ID is {id}. Give it to a seller to receive a car.', { id: g.state.ownerId })}</p>
        {g.state.formerIds.length > 0 && <p className="gar-help">{t('This browser also answers to {ids}: a car sent to one of them arrives here.', { ids: g.state.formerIds.join(', ') })}</p>}
      </section>

      <Examples today={today} />
    </>
  );
}

/**
 * The vehicle's own details, corrected after parking: the year, make, model, trim and body. The MiCar ID does not
 * change. Figures that were filled in from the catalogue or the EPA were published for the vehicle as it was named
 * then, so when the name changes they are kept as figures and no longer credited to that source.
 */
function IdentityForm({ spec, today, onChange }: { spec: VehicleSpec; today: string; onChange: (spec: VehicleSpec) => string | null }) {
  const was = spec.identity;
  const [open, setOpen] = useState(false);
  const [year, setYear] = useState(String(was.year));
  const [make, setMake] = useState(was.make);
  const [model, setModel] = useState(was.model);
  const [trim, setTrim] = useState(was.trim);
  const [bodyClass, setBodyClass] = useState<BodyClass>(was.bodyClass);
  const [message, setMessage] = useState('');
  const opener = useFocusBack(open);
  // Opened afresh each time: what was typed and then cancelled is not waiting there the next time.
  const begin = () => { setYear(String(was.year)); setMake(was.make); setModel(was.model); setTrim(was.trim); setBodyClass(was.bodyClass); setMessage(''); setOpen(true); };
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const identity = checkIdentity({ year: Number(year), make, model, trim, bodyClass }, Number(today.slice(0, 4)));
    if (!identity.ok) { setMessage(t('Check the year, make and model.')); return; }
    const next: VehicleSpec = { ...spec, identity: identity.value };
    const renamed = identity.value.year !== was.year || identity.value.make !== was.make || identity.value.model !== was.model || identity.value.trim !== was.trim || identity.value.bodyClass !== was.bodyClass;
    if (renamed) {
      const sheet = next as unknown as Record<string, Sourced<unknown> | null | VehicleSpec['identity']>;
      for (const field of Object.keys(spec) as (keyof VehicleSpec)[]) {
        const cell = spec[field];
        if (field === 'identity' || cell === null) continue;
        const kind = (cell as Sourced<unknown>).source.kind;
        if (kind !== 'owner' && kind !== 'illustrative') sheet[field] = { value: (cell as Sourced<unknown>).value, source: { ...ownerSource(today), note: RENAMED_NOTE } };
      }
    }
    const refused = onChange(next);
    if (refused) { setMessage(t(refused)); return; }
    setMessage(''); setOpen(false);
  };
  if (!open) return <div className="gar-btns"><button type="button" className="gar-btn" ref={opener} onClick={begin}>{t('Correct the year, make, model or trim')}</button></div>;
  return (
    <form className="gar-entry" onSubmit={submit} aria-labelledby="gar-identity-title">
      <h3 id="gar-identity-title">{t('The vehicle')}</h3>
      <div className="gar-form">
        <label>{t('Year')}<input type="number" inputMode="numeric" min={1886} max={Number(today.slice(0, 4)) + 1} value={year} required autoFocus onChange={(e) => setYear(e.target.value)} /></label>
        <label>{t('Make')}<input type="text" value={make} maxLength={60} required onChange={(e) => setMake(e.target.value)} /></label>
        <label>{t('Model')}<input type="text" value={model} maxLength={60} required onChange={(e) => setModel(e.target.value)} /></label>
        <label>{t('Trim')}<input type="text" value={trim} maxLength={80} onChange={(e) => setTrim(e.target.value)} /></label>
        <label>{t('Body')}<select value={bodyClass} onChange={(e) => setBodyClass(e.target.value as BodyClass)}>{BODY_CLASSES.map((b) => <option key={b} value={b}>{t(BODY_CLASS_LABELS[b])}</option>)}</select></label>
      </div>
      <p className="gar-help">{t('The MiCar ID stays the same. Figures filled in from the catalogue or the EPA were published for the vehicle as it was named: if you rename it they are kept, and no longer credited to that source. An identity or a specification a verifier attested is for the vehicle as it stood then.')}</p>
      <div className="gar-btns">
        <button type="submit" className="gar-btn primary">{t('Save')}</button>
        <button type="button" className="gar-btn" onClick={() => setOpen(false)}>{t('Cancel')}</button>
        {message && <span className="gar-err" role="alert">{message}</span>}
      </div>
    </form>
  );
}

const COUNT = /^(\d+) of (\d+)$/;

/**
 * What stands between this car and its next level, in one place, so the journey reads off the page: park it, add
 * photographs and records, reach Documented. The two levels above that take an independent verifier, and say so.
 */
function NextStep({ assembly, mine, onOpen }: { assembly: Assembly; mine: boolean; onOpen: (tab: Tab) => void }) {
  const { next, missing } = assembly.certification;
  if (next === null || missing.length === 0) return null;
  const independent = next === 'verified' || next === 'certified';
  return (
    <section className="gar-next" aria-labelledby="gar-next-title">
      <h2 id="gar-next-title">{t('Next: {level}', { level: t(LEVEL_LABELS[next]) })}</h2>
      <ul className="gar-items">
        {missing.map((r) => {
          const m = COUNT.exec(r.detail);
          return <li key={r.id}><span>{t(r.label)}</span>{m && <output>{t('{n} of {m}', { n: m[1], m: m[2] })}</output>}</li>;
        })}
      </ul>
      {independent
        ? <p className="gar-help">{t('This level takes an independent verifier: an inspector, a shop or a verification provider. None is connected to this site yet, and nothing you upload can stand in for one.')}</p>
        : mine && <div className="gar-btns"><button type="button" className="gar-btn primary" onClick={() => onOpen('Passport')}>{t('Open the passport')}</button><button type="button" className="gar-btn" onClick={() => onOpen('Grade')}>{t('See the grade')}</button></div>}
    </section>
  );
}

/** The id of a tab's button. An id cannot hold a space, or nothing that points at it (the panel's label) finds it. */
export const tabId = (name: Tab): string => `gar-tab-${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;

function CarPage({ passport, g, today }: { passport: Passport; g: GarageHandle; today: string }) {
  const [tab, setTab] = useState<Tab>('Stats');
  const [flipped, setFlipped] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const removeOpener = useFocusBack(confirming);
  const [message, setMessage] = useState('');
  const assembly = useMemo(() => assembleCar(passport, today), [passport, today]);
  const photo = useFileUrl(g.files, assembly.card.photoAttachmentId);
  const mine = ownsCar(g.state, passport);
  const holding = holdingOf(g.state, passport);
  const readOnly = holding === 'transferred'
    ? t('This car has been transferred. Its passport is read-only here. Send the new owner the passport file.')
    : t('This car belongs to another garage, so its passport is read-only here. If that garage is yours, bring its garage file in on the Garage page and take up its Garage ID when asked.');
  // Left and right move between the tabs, as a tab list should.
  const onTabKey = (e: React.KeyboardEvent, name: Tab) => {
    const step = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
    if (step === 0) return;
    e.preventDefault();
    const next = TABS[(TABS.indexOf(name) + step + TABS.length) % TABS.length];
    setTab(next);
    try { document.getElementById(tabId(next))?.focus(); } catch { /* no document */ }
  };

  const commit = (result: { ok: true; value: GarageState } | { ok: false; reason: string }): string | null => {
    if (!result.ok) return result.reason;
    g.apply(result.value);
    return null;
  };
  const onRecord = (event: Record<string, unknown>, reason: string) => commit(record(g.latest(), passport.micarId, event, { now: stamp(), snapshotId: newId(), reason }));
  const remove = () => {
    // The car goes at once; its files follow, in one go, and only the ones no other car here names.
    const before = g.latest();
    const files = filesOnlyOf(before, passport.micarId);
    g.apply(removeCar(before, passport.micarId));
    try { window.location.hash = '#/garage'; } catch { /* no window */ }
    g.files.removeAll(files).catch(() => { /* already gone, or the browser would not open its store */ });
  };

  return (
    <>
      <p><a className="gar-back-link" href={garageUrl()}>← {t('The Garage')}</a></p>
      <div className="gar-car">
        <aside className="gar-side">
          <CollectibleCard card={assembly.card} report={assembly.report} photoUrl={photo} live flipped={flipped} onFlip={() => setFlipped((f) => !f)} />
          <span className="gar-hint">{t('tap the card to turn it over')}</span>
        </aside>
        <div className="gar-main">
          <h1 className="gar-title">{assembly.card.title}{assembly.card.subtitle && <small> {assembly.card.subtitle}</small>}</h1>
          {!g.persisted && <p className="gar-note gar-warn" role="status">{t('This browser is not keeping the garage. It works until you close the page: download the garage file to keep it.')}</p>}
          <NextStep assembly={assembly} mine={mine} onOpen={setTab} />
          <div className="gar-tabs" role="tablist" aria-label={assembly.card.title}>
            {TABS.map((name) => <button type="button" key={name} role="tab" id={tabId(name)} aria-selected={tab === name} aria-controls="gar-tabpanel" tabIndex={tab === name ? 0 : -1} onClick={() => setTab(name)} onKeyDown={(e) => onTabKey(e, name)}>{t(name)}</button>)}
          </div>
          <div id="gar-tabpanel" role="tabpanel" aria-labelledby={tabId(tab)}>
            {tab === 'Stats' && <StatsPanel assembly={assembly} />}
            {tab === 'Grade' && <GradePanel assembly={assembly} passport={passport} />}
            {tab === 'Passport' && (
              <PassportPanel passport={passport} today={today} holding={holding} garageIds={garageIds(g.state)} files={g.files} onRecord={onRecord}
                onVin={(vin) => commit(replaceVin(g.latest(), passport.micarId, vin, { now: stamp(), snapshotId: newId() }))}
                onTransfer={(input) => commit(transfer(g.latest(), passport.micarId, input, { now: stamp() }))}
                onExport={() => download(`micar-passport-${passport.micarId}.json`, exportGarage(g.state, stamp(), passport.micarId))} />
            )}
            {tab === 'Mods' && <ModsPanel passport={passport} assembly={assembly} today={today} canWrite={mine} files={g.files} onRecord={onRecord} />}
            {tab === 'Race' && <RacePanel passport={passport} assembly={assembly} />}
            {tab === 'Spec sheet' && (
              <div className="gar-panel">
                <p className="gar-note">{t('The factory specification of this exact configuration. It is kept as it was entered, each figure with its source; the scores are worked out from it and stored nowhere in it.')}</p>
                <p className={`gar-note ${assembly.specificationAttested || assembly.catalogueSpecification ? 'blue' : ''}`}>{assembly.specificationAttested
                  ? t('An independent verifier has attested this specification as it stands.')
                  : assembly.catalogueSpecification
                    ? t('This sheet is the MiCar reference catalogue’s own, figure for figure: reference data, not verified.')
                    : t('This sheet, and the sources named beside its figures, are this passport’s own account. Nothing on it has been independently verified.')}</p>
                {mine
                  ? <>
                    <IdentityForm spec={passport.spec} today={today} onChange={(spec) => commit(replaceSpec(g.latest(), passport.micarId, spec, { now: stamp(), snapshotId: newId() }))} />
                    <SpecForm spec={passport.spec} today={today} plainSources onChange={(spec) => setMessage(t(commit(replaceSpec(g.latest(), passport.micarId, spec, { now: stamp(), snapshotId: newId() })) ?? ''))} />
                  </>
                  : <p className="gar-help">{readOnly}</p>}
                {message && <p className="gar-err" role="alert">{message}</p>}
              </div>
            )}
          </div>
          <div className="gar-danger">
            {confirming
              ? <span className="gar-btns"><span className="gar-help" role="status">{t('Take this car and its files out of this garage? The passport file keeps its history but not its photographs and receipts: save any of those you want first.')}</span><button type="button" className="gar-btn danger" onClick={remove}>{t('Yes, remove it')}</button><button type="button" className="gar-btn" autoFocus onClick={() => setConfirming(false)}>{t('Cancel')}</button></span>
              : <button type="button" className="gar-btn danger" ref={removeOpener} onClick={() => setConfirming(true)}>{t('Remove from this garage')}</button>}
          </div>
        </div>
      </div>
    </>
  );
}

/**
 * Today on the owner's calendar. The clock is read every time the page is drawn, so the page never asks about a day
 * earlier than the entry it has just written: an entry written a few seconds after midnight is stamped with the new
 * day, and a page still showing yesterday would leave the grade it produced out of the history as "not yet". A page
 * left open and untouched past midnight is drawn again by the timer.
 */
function useToday(): string {
  const day = todayOf();
  const shown = useRef(day);
  shown.current = day;
  const [, redraw] = useState(0);
  useEffect(() => {
    const check = () => { if (todayOf() !== shown.current) redraw((n) => n + 1); };
    const timer = setInterval(check, 30000);
    try { document.addEventListener('visibilitychange', check); } catch { /* no document */ }
    return () => { clearInterval(timer); try { document.removeEventListener('visibilitychange', check); } catch { /* no document */ } };
  }, []);
  return day;
}

export default function Garage({ code }: { code?: string }) {
  const g = useGarage();
  const today = useToday();
  const id = code ? normalizeMicarId(code) ?? code : null;
  const car = id ? findCar(g.state, id) : null;
  return (
    <div className="dp gar">
      <Strip current="garage" />
      <main className="gutter">
        <div className="inner">
          {!id && <Home g={g} today={today} />}
          {id && car && <CarPage key={car.micarId} passport={car} g={g} today={today} />}
          {id && !car && (
            <header className="gar-head">
              <h1>{tx('{mi}Car Garage', { mi: <span className="mi">Mi</span> })}</h1>
              <p className="gar-empty">{t('This garage has no car with that ID.')}</p>
              <p><a className="gar-back-link" href={garageUrl()}>← {t('The Garage')}</a></p>
            </header>
          )}
        </div>
      </main>
      <Footer />
    </div>
  );
}
