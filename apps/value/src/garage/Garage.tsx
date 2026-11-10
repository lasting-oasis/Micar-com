// The Garage: the cars parked on this device, as cards, and the page of one of them.
// Nothing here leaves the browser: the cars are kept by garage/store.ts and their files by garage/files.ts.
import { useMemo, useRef, useState } from 'react';
import { micarIdFromBytes, normalizeMicarId } from '@micar/engine';
import type { Passport } from '@micar/engine';
import { garageUrl } from '../car/record';
import { Footer } from '../Footer';
import { Strip } from '../Strip';
import { t, tx } from '../i18n';
import '../door.css';
import './garage.css';
import './panels.css';
import { CollectibleCard } from './CollectibleCard';
import { Examples } from './Examples';
import { GradePanel } from './GradePanel';
import { newId, randomBytes, stamp, today as todayOf } from './ids';
import { ModsPanel } from './ModsPanel';
import { Park, type ParkRequest } from './Park';
import { PassportPanel } from './PassportPanel';
import { RacePanel } from './RacePanel';
import { SpecForm } from './SpecForm';
import { StatsPanel } from './StatsPanel';
import { assembleCar, exportGarage, findCar, importGarage, ownsCar, park, record, removeCar, replaceSpec, transfer, type GarageState } from './store';
import { useFileUrl, useGarage, type GarageHandle } from './useGarage';
import { TABS, type Tab } from './words';


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
  return (
    <div className="gar-cell">
      <a href={garageUrl(passport.micarId)} aria-label={assembly.card.title}><CollectibleCard card={assembly.card} report={assembly.report} photoUrl={photo} /></a>
      <p className="gar-cap">{assembly.card.title}<small>{assembly.card.subtitle || passport.micarId}{ownsCar(g.state, passport) ? '' : ` · ${t('transferred')}`}</small></p>
    </div>
  );
}

function Home({ g, today }: { g: GarageHandle; today: string }) {
  const [parking, setParking] = useState(false);
  const [message, setMessage] = useState('');
  const picker = useRef<HTMLInputElement>(null);

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
    try {
      const text = await file.text();
      const result = importGarage(g.latest(), text);
      if (!result.ok) { setMessage(t(result.reason)); return; }
      g.apply(result.value.state);
      setMessage(t('{added} added, {updated} updated, {skipped} left out.', { added: result.value.added, updated: result.value.updated, skipped: result.value.skipped }));
    } catch { setMessage(t('That file is not a garage export')); }
  };

  return (
    <>
      <header className="gar-head">
        <h1>{tx('{mi}Car Garage', { mi: <span className="mi">Mi</span> })}</h1>
        <p className="lede">{t('Your cars, as cards.')}</p>
        <StorageNotice g={g} />
        <div className="gar-actions">
          {!parking && <button type="button" className="drip" onClick={() => setParking(true)}>{t('Park a car')}</button>}
          {g.state.passports.length > 0 && <button type="button" className="ghostbtn" onClick={() => download(`micar-garage-${today}.json`, exportGarage(g.state, stamp()))}>{t('Download the garage file')}</button>}
          <button type="button" className="ghostbtn" onClick={() => picker.current?.click()}>{t('Bring in a garage or passport file')}</button>
          <input ref={picker} type="file" accept="application/json,.json" hidden onChange={(e) => { void onImport(e.target.files?.[0]); e.target.value = ''; }} />
        </div>
        {message && <p className="gar-help" role="status">{message}</p>}
      </header>

      {parking && <section className="gar-sec"><Park today={today} onPark={onPark} onCancel={() => setParking(false)} /></section>}

      <section className="gar-sec" aria-labelledby="gar-yours">
        <h2 id="gar-yours">{t('Your cars')}</h2>
        {g.state.passports.length === 0
          ? <p className="gar-empty">{t('No car parked yet. Park one and it gets a MiCar ID, seven attributes from its specification, a Power Rating, a grade and its first card.')}</p>
          : <div className="gar-grid">{g.state.passports.map((p) => <CarTile key={p.micarId} passport={p} g={g} today={today} />)}</div>}
        <p className="gar-help">{t('Your Garage ID is {id}. Give it to a seller to receive a car.', { id: g.state.ownerId })}</p>
      </section>

      <Examples today={today} />
    </>
  );
}

function CarPage({ passport, g, today }: { passport: Passport; g: GarageHandle; today: string }) {
  const [tab, setTab] = useState<Tab>('Stats');
  const [flipped, setFlipped] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [message, setMessage] = useState('');
  const assembly = useMemo(() => assembleCar(passport, today), [passport, today]);
  const photo = useFileUrl(g.files, assembly.card.photoAttachmentId);
  const mine = ownsCar(g.state, passport);

  const commit = (result: { ok: true; value: GarageState } | { ok: false; reason: string }): string | null => {
    if (!result.ok) return result.reason;
    g.apply(result.value);
    return null;
  };
  const onRecord = (event: Record<string, unknown>, reason: string) => commit(record(g.latest(), passport.micarId, event, { now: stamp(), snapshotId: newId(), reason }));
  const remove = async () => {
    for (const e of passport.events) for (const a of e.attachments) { try { await g.files.remove(a.id); } catch { /* already gone */ } }
    g.apply(removeCar(g.latest(), passport.micarId));
    try { window.location.hash = '#/garage'; } catch { /* no window */ }
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
          <div className="gar-tabs" role="tablist" aria-label={assembly.card.title}>
            {TABS.map((name) => <button type="button" key={name} role="tab" id={`gar-tab-${name}`} aria-selected={tab === name} aria-controls="gar-tabpanel" onClick={() => setTab(name)}>{t(name)}</button>)}
          </div>
          <div id="gar-tabpanel" role="tabpanel" aria-labelledby={`gar-tab-${tab}`}>
            {tab === 'Stats' && <StatsPanel assembly={assembly} />}
            {tab === 'Grade' && <GradePanel assembly={assembly} passport={passport} />}
            {tab === 'Passport' && (
              <PassportPanel passport={passport} today={today} canWrite={mine} garageId={g.state.ownerId} files={g.files} onRecord={onRecord}
                onTransfer={(input) => commit(transfer(g.latest(), passport.micarId, input, { now: stamp() }))}
                onExport={() => download(`micar-passport-${passport.micarId}.json`, exportGarage(g.state, stamp(), passport.micarId))} />
            )}
            {tab === 'Mods' && <ModsPanel passport={passport} assembly={assembly} today={today} canWrite={mine} files={g.files} onRecord={onRecord} />}
            {tab === 'Race' && <RacePanel passport={passport} assembly={assembly} />}
            {tab === 'Spec sheet' && (
              <div className="gar-panel">
                <p className="gar-note">{t('The factory specification of this exact configuration. It is kept as it was entered, each figure with its source; the scores are worked out from it and stored nowhere in it.')}</p>
                {mine
                  ? <SpecForm spec={passport.spec} today={today} onChange={(spec) => setMessage(t(commit(replaceSpec(g.latest(), passport.micarId, spec, { now: stamp(), snapshotId: newId() })) ?? ''))} />
                  : <p className="gar-help">{t('This car has been transferred. Its passport is read-only here. Send the new owner the passport file.')}</p>}
                {message && <p className="gar-err" role="alert">{message}</p>}
              </div>
            )}
          </div>
          <div className="gar-danger">
            {confirming
              ? <span className="gar-btns"><span className="gar-help">{t('Take this car and its files out of this garage? Download its passport file first if you want to keep it.')}</span><button type="button" className="gar-btn danger" onClick={() => { void remove(); }}>{t('Yes, remove it')}</button><button type="button" className="gar-btn" onClick={() => setConfirming(false)}>{t('Cancel')}</button></span>
              : <button type="button" className="gar-btn danger" onClick={() => setConfirming(true)}>{t('Remove from this garage')}</button>}
          </div>
        </div>
      </div>
    </>
  );
}

export default function Garage({ code }: { code?: string }) {
  const g = useGarage();
  const today = useMemo(() => todayOf(), []);
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
