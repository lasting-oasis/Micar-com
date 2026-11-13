import { DATA_CREDIT, FOOTER_COLUMNS, FOOTER_ESTIMATES, FOOTER_SOON, footerCopyright } from '@micar/brand/footer';
import { useLang } from './i18n';

export function Footer() {
  const lang = useLang();
  const year = new Date().getFullYear();
  return (
    <footer className="mc-foot">
      <div className="mc-foot-in">
        <div className="mc-foot-cols">
          {FOOTER_COLUMNS.map((col) => (
            <div className="mc-foot-col" key={col.id}>
              <p className="mc-foot-h">{col.title[lang]}</p>
              {col.blurb && <p className="mc-foot-blurb">{col.blurb[lang]}</p>}
              <div className="mc-foot-links">
                {col.links.map((l) => (
                  <a key={l.id} href={l.href} {...(l.external ? { target: '_blank', rel: 'noreferrer' } : {})}>
                    {l.label[lang]}
                    {l.soon && <em>{FOOTER_SOON[lang]}</em>}
                  </a>
                ))}
              </div>
            </div>
          ))}
        </div>
        <div className="mc-foot-legal">
          <span>{footerCopyright(year)}</span>
          <span>{FOOTER_ESTIMATES[lang]}</span>
          <a className="mc-foot-credit" href={DATA_CREDIT.href} target="_blank" rel="noreferrer" lang="en">{DATA_CREDIT.label}</a>
        </div>
      </div>
    </footer>
  );
}
