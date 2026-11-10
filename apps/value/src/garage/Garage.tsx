// The Garage: the cars parked on this device, as cards, and the page of one of them.
// Nothing here leaves the browser: the cars are kept by garage/store.ts and their files by garage/files.ts.
import { Footer } from '../Footer';
import { Strip } from '../Strip';
import { t, tx } from '../i18n';
import '../door.css';
import './garage.css';
import { Examples } from './Examples';

export default function Garage({ code }: { code?: string }) {
  return (
    <div className="dp gar" data-car={code ?? ''}>
      <Strip current="garage" />
      <main className="gutter">
        <div className="inner">
          <header className="gar-head">
            <h1>{tx('{mi}Car Garage', { mi: <span className="mi">Mi</span> })}</h1>
            <p className="lede">{t('Your cars, as cards.')}</p>
            <p className="gar-notice"><span className="marker">{t('on this device')}</span>{t('Saved on this device. Nothing here leaves your browser. Accounts come with phase 1.')}</p>
          </header>
          <Examples />
        </div>
      </main>
      <Footer />
    </div>
  );
}
