// The collectible card. The same case and paper label as the home page's slab, with a new face inside:
// the picture, the seven attributes and, on the label, the grade on the left and the Power Rating on the right.
// The back is the grade report. Nothing on it is a price: value belongs to the calculator.
import type { CSSProperties } from 'react';
import { ATTRIBUTE_LABELS, GRADE_CATEGORIES, LEVEL_LABELS, QUALITY_LABELS, RARITY_LABELS } from '@micar/engine';
import type { AttributeKey, BodyClass, CardAttribute, CollectibleCard as CardData, GradeCategoryKey, GradeReport, ModIndicator } from '@micar/engine';
import { useLive } from '../door/Slab';
import { t } from '../i18n';

const BASE = import.meta.env.BASE_URL;

/** The category picture for each body class (the same seven renders the home page uses). */
export const RENDER: Record<BodyClass, string> = {
  sports: 'sports', coupe: 'coupe', sedan: 'sedan', hatchback: 'hatchback', wagon: 'hatchback', suv: 'suv', offroad: 'suv', pickup: 'truck', van: 'van',
};

/** Short names for the modification chips. The words are the catalogue's; the roman numeral is the tier. */
export const MOD_SHORT: Record<ModIndicator['category'], string> = {
  engine: 'Engine', ecu: 'ECU', 'intake-exhaust': 'Intake', turbo: 'Turbo', supercharger: 'Blower', nitrous: 'Nitrous', transmission: 'Trans',
  suspension: 'Susp', tires: 'Tires', brakes: 'Brakes', weight: 'Weight', aero: 'Aero', offroad: 'Off-road', eco: 'Eco',
};
const ROMAN = ['', 'I', 'II', 'III'];

/** Three letters for each attribute, for a card too small to spell them out. */
export const ATTRIBUTE_SHORT: Record<AttributeKey, string> = {
  power: 'PWR', speed: 'SPD', acceleration: 'ACC', handling: 'HDL', durability: 'DUR', reliability: 'REL', efficiency: 'EFF',
};

export const GRADE_CATEGORY_NAMES: Record<GradeCategoryKey, string> = {
  identity: 'Identity', documentation: 'Documentation', condition: 'Condition', originality: 'Originality', verification: 'Verification',
};

export const GRADE_CATEGORY_SHORT: Record<GradeCategoryKey, string> = {
  identity: 'ID', documentation: 'DOC', condition: 'CND', originality: 'ORG', verification: 'VER',
};

type Props = {
  card: CardData;
  /** The grade report for the back face. Example and house cards have none. */
  report?: GradeReport | null;
  /** The owner's photo, already resolved to a URL by the page. */
  photoUrl?: string | null;
  flipped?: boolean;
  onFlip?: () => void;
  live?: boolean;
  mini?: boolean;
  className?: string;
};

const pct = (v: number | null) => `${Math.max(0, Math.min(100, (v ?? 0) / 10))}%`;

function Row({ a }: { a: CardAttribute }) {
  const label = t(ATTRIBUTE_LABELS[a.key]);
  const mark = a.basis === 'estimated' ? '~' : '';
  return (
    <div className={`gar-row ${a.value === null ? 'none' : ''}`} title={a.basis === 'estimated' ? t('Estimated from other figures') : undefined}>
      <span><b>{label}</b><abbr title={label}>{t(ATTRIBUTE_SHORT[a.key])}</abbr></span>
      <i><b style={{ width: pct(a.value) }} />{a.base !== null && a.delta !== 0 && <u style={{ left: pct(a.base) }} />}</i>
      <output className={a.delta > 0 ? 'up' : a.delta < 0 ? 'down' : ''}>{a.value === null ? '—' : `${mark}${a.value}`}</output>
    </div>
  );
}

/** True for a card built from a catalogue entry: it belongs to no one. */
const isHouse = (card: CardData): boolean => !card.illustrative && card.micarId === 'HOUSE';
/** What kind of card this is, where an owner's card says its level: an example and a house card hold no level. */
const standing = (card: CardData): string => (card.illustrative ? t('example') : isHouse(card) ? t('house card') : t(LEVEL_LABELS[card.level]));

function Label({ card }: { card: CardData }) {
  const g = card.grade;
  const rated = card.attributes.filter((a) => a.value !== null).length;
  const rating = card.powerRating ?? card.provisionalRating;
  return (
    <div className="sl-label gar-label">
      <div className="lab-g"><small>{t('MiCar grade')}</small><b>{g.slabbed ? g.grade10.toFixed(1) : 'RAW'}</b><em>{g.slabbed ? t(g.tierName) : t('ungraded')}</em></div>
      <div className="lab-n"><strong>{card.title}</strong><span>{card.subtitle ? `${card.subtitle} · ` : ''}{card.micarId}</span><i>{standing(card)}</i></div>
      <div className="gar-pr"><small>{t('Power rating')}</small><b>{rating === null ? '—' : rating}</b><em>{card.powerRating !== null ? t('of 1000') : t('{n} of 7 rated', { n: rated })}</em></div>
    </div>
  );
}

export function CollectibleCard({ card, report = null, photoUrl = null, flipped = false, onFlip, live = false, mini = false, className = '' }: Props) {
  const ref = useLive(live);
  const style = { '--foil': card.foil } as CSSProperties;
  const toggle = () => onFlip?.();
  const classes = ['slab', 'gar-card', `rar-${card.rarity.tier}`, card.grade.slabbed ? '' : 'raw', flipped ? 'flipped' : '', live ? 'live' : '', mini ? 'mini' : '', className].filter(Boolean).join(' ');
  const sealed = card.level === 'verified' || card.level === 'certified';
  return (
    <div ref={ref} className={classes} style={style}
      role={onFlip ? 'button' : undefined} tabIndex={onFlip ? 0 : undefined}
      aria-label={onFlip ? t('{title}, {kind}. Press Enter to turn the card over.', { title: [card.title, card.subtitle].filter(Boolean).join(' '), kind: standing(card) }) : undefined}
      onClick={onFlip ? toggle : undefined} onKeyDown={onFlip ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); } } : undefined}>
      <div className="slab-in">
        <div className="sl-face front"><div className="acrylic">
          <Label card={card} />
          <div className="art gar-art">
            <img className={`render ${photoUrl ? 'photo' : ''}`} src={photoUrl ?? `${BASE}cars/${RENDER[card.identity.bodyClass]}.webp`} alt="" loading="lazy" />
            <div className="gar-top">
              <span className="gar-rar">{t(RARITY_LABELS[card.rarity.tier])}</span>
              {card.illustrative && <span className="gar-eg">{t('example')}</span>}
              {isHouse(card) && <span className="gar-eg">{t('house card')}</span>}
              {sealed && <span className="seal gar-seal"><span>{t(LEVEL_LABELS[card.level])}</span></span>}
            </div>
            <div className="gar-box">
              {card.attributes.map((a) => <Row key={a.key} a={a} />)}
              <div className="gar-foot">
                <span className="gar-mods">{card.mods.map((m) => <b key={m.category} className={m.evidence}>{t(MOD_SHORT[m.category])} {ROMAN[m.tier]}</b>)}</span>
                <span className="gar-ed">{t('Ed. {n}', { n: card.edition.number })}</span>
              </div>
            </div>
            <div className="foil" /><div className="glare" />
          </div>
          <div className="uvmark">MiCar<br />{t('authentic')}<br />{card.micarId}</div>
        </div></div>
        <div className="sl-face back"><div className="acrylic">
          <Label card={card} />
          <div className="art gar-art gar-back">
            <h4>{t('grade report')}</h4>
            {report ? (
              <div className="gar-box">
                {GRADE_CATEGORIES.map((k) => (
                  <div className="gar-row" key={k}>
                    <span><b>{t(GRADE_CATEGORY_NAMES[k])}</b><abbr title={t(GRADE_CATEGORY_NAMES[k])}>{t(GRADE_CATEGORY_SHORT[k])}</abbr></span>
                    <i><b style={{ width: `${report.categories[k].score}%` }} /></i>
                    <output>{Math.round(report.categories[k].score)}</output>
                  </div>
                ))}
                <p className="gar-line">{t('Overall {n} of 100', { n: report.overall.toFixed(1) })}</p>
              </div>
            ) : (
              <p className="gar-line gar-none">{card.illustrative ? t('An example card. Its values are placeholders, not data about a real car.') : t('A house card from the reference catalogue. It has no owner, so it has no grade.')}</p>
            )}
            <div className="gar-meta">
              <span>{t(QUALITY_LABELS[card.quality])}</span>
              <span>{t(card.edition.name)}</span>
              <span>{card.serial}</span>
              <span>{card.ruleset}</span>
            </div>
            <div className="foil" /><div className="glare" />
          </div>
          <div className="uvmark">MiCar<br />{t('authentic')}<br />{card.micarId}</div>
        </div></div>
      </div>
    </div>
  );
}
