// Every shared type of the engine, in one place, so each module (and each app) speaks the same words.
// Three layers describe a vehicle and they never mix:
//   A. base stats        the factory specification of the exact configuration, scored
//   B. vehicle stats     that base after this vehicle's modifications, wear and documented repairs
//   C. the MiCar grade   identity, paperwork, condition, originality and verification: never performance
// Nothing here knows about prices. Market value lives in the value app and no type in this file carries one.

/** The result of an operation that can be refused. A refusal carries a plain reason and changes nothing. */
export type Result<T> = { ok: true; value: T } | { ok: false; reason: string };

/* ---------------------------------------------------------------- attributes ---- */

/** The seven attributes, in the order every card prints them. Each is an integer from 0 to 1000. */
export const ATTRIBUTE_KEYS = ['power', 'speed', 'acceleration', 'handling', 'durability', 'reliability', 'efficiency'] as const;
export type AttributeKey = (typeof ATTRIBUTE_KEYS)[number];
export type Attributes = Record<AttributeKey, number>;
/** Attributes where a value can be missing: a specification nobody has supplied is never invented. */
export type MaybeAttributes = Record<AttributeKey, number | null>;

/* ---------------------------------------------------------------- provenance ---- */

/**
 * Where a figure came from.
 * manufacturer  the maker's own site, brochure, press kit or manual
 * agency        a government body (the EPA's fuel-economy data)
 * test          an independent instrumented test (a magazine's measured 0-60 or skidpad)
 * reference     a secondary listing nobody has checked against a primary document
 * owner         typed in by the vehicle's owner
 * illustrative  a placeholder for demonstration, not data about a real vehicle
 */
export type SourceKind = 'manufacturer' | 'agency' | 'test' | 'reference' | 'owner' | 'illustrative';
export type Source = {
  kind: SourceKind;
  /** Who published it: "Nissan USA", "EPA fueleconomy.gov", "Car and Driver". */
  name?: string;
  url?: string;
  /** The day the source was read, YYYY-MM-DD. */
  asOf?: string;
  note?: string;
};
/** A value together with its source. A specification field is one of these, or null when nobody has supplied it. */
export type Sourced<T> = { value: T; source: Source };

/**
 * The weakest source behind a set of figures, from worst to best:
 * illustrative < owner < reference < sourced (manufacturer, agency or test).
 * 'verified' is granted only by an independent verifier's attestation and never by the data itself.
 */
export type DataQuality = 'illustrative' | 'owner' | 'reference' | 'sourced';

/* ------------------------------------------------------------- specification ---- */

export const BODY_CLASSES = ['sports', 'coupe', 'sedan', 'hatchback', 'wagon', 'suv', 'offroad', 'pickup', 'van'] as const;
/** The vehicle's class. 'offroad' is a body-on-frame 4x4 utility; 'sports' is a purpose-built sports car. */
export type BodyClass = (typeof BODY_CLASSES)[number];
export type Drivetrain = 'FWD' | 'RWD' | 'AWD' | '4WD';
export type Powertrain = 'gasoline' | 'diesel' | 'hybrid' | 'plug-in-hybrid' | 'electric';
/** Forced induction on a combustion engine. Left null for an electric powertrain. */
export type Induction = 'natural' | 'turbo' | 'twin-turbo' | 'quad-turbo' | 'supercharged' | 'twincharged';
export type TransmissionType = 'manual' | 'automatic' | 'dual-clutch' | 'cvt' | 'ecvt' | 'single-speed';
export type Construction = 'unibody' | 'body-on-frame';
export type SuspensionGrade = 'standard' | 'sport' | 'adaptive' | 'offroad';
export type BrakeGrade = 'standard' | 'performance' | 'carbon-ceramic';

export type VehicleIdentity = { year: number; make: string; model: string; trim: string; bodyClass: BodyClass };

/**
 * The factory specification of one exact configuration (year, make, model, trim, engine).
 * This is the original data. Scores are computed from it and stored nowhere in it.
 * Every field carries its source, and a field nobody has supplied is null.
 */
export type VehicleSpec = {
  identity: VehicleIdentity;
  /** Engine or motor in words: "3.8L twin-turbo V6", "single permanent-magnet motor". */
  engine: Sourced<string> | null;
  powertrain: Sourced<Powertrain> | null;
  induction: Sourced<Induction> | null;
  displacementL: Sourced<number> | null;
  cylinders: Sourced<number> | null;
  horsepower: Sourced<number> | null;
  torqueLbFt: Sourced<number> | null;
  /** Transmission in words: "6-speed dual-clutch". */
  transmission: Sourced<string> | null;
  transmissionType: Sourced<TransmissionType> | null;
  drivetrain: Sourced<Drivetrain> | null;
  curbWeightLb: Sourced<number> | null;
  zeroToSixtySec: Sourced<number> | null;
  topSpeedMph: Sourced<number> | null;
  /** True when the top speed is an electronic limit rather than what the power allows. */
  topSpeedGoverned: Sourced<boolean> | null;
  /** EPA combined fuel economy in MPG, or MPGe for an electric powertrain. */
  combinedMpg: Sourced<number> | null;
  cityMpg: Sourced<number> | null;
  highwayMpg: Sourced<number> | null;
  evRangeMiles: Sourced<number> | null;
  /** Measured lateral grip on a skidpad, in g. */
  lateralGripG: Sourced<number> | null;
  /** Measured stopping distances. Stored and shown; not scored in ruleset v1. */
  braking60to0Ft: Sourced<number> | null;
  braking70to0Ft: Sourced<number> | null;
  groundClearanceIn: Sourced<number> | null;
  construction: Sourced<Construction> | null;
  /** Factory suspension in words: "double wishbone front, multi-link rear". */
  suspension: Sourced<string> | null;
  suspensionGrade: Sourced<SuspensionGrade> | null;
  /** Factory brakes in words: "410 mm carbon-ceramic front, 390 mm rear". */
  brakes: Sourced<string> | null;
  brakeGrade: Sourced<BrakeGrade> | null;
  warrantyPowertrainMiles: Sourced<number> | null;
  warrantyPowertrainYears: Sourced<number> | null;
  /** Units built, when the maker published a build number. */
  productionUnits: Sourced<number> | null;
};
export type SpecField = Exclude<keyof VehicleSpec, 'identity'>;

/** A catalogue entry: a specification with a stable id and a plain statement of how far it can be trusted. */
export type CatalogueEntry = {
  id: string;
  spec: VehicleSpec;
  /** 'reference': gathered from public sources and not checked against a primary document. 'illustrative': a placeholder. */
  status: 'reference' | 'illustrative';
  /** The day the entry was gathered, YYYY-MM-DD. */
  asOf: string;
  note: string;
};

/** A demonstration vehicle whose seven values were typed in as placeholders. Never data about a real car. */
export type ExampleVehicle = { id: string; identity: VehicleIdentity; attributes: Attributes; note: string };

/* -------------------------------------------------------------------- scores ---- */

/**
 * How an attribute's score was reached.
 * measured      read from a specification figure (horsepower and torque, top speed, 0-60, skidpad grip, EPA economy)
 * modelled      computed from the configuration by a documented model (durability and reliability always; handling when no skidpad figure exists)
 * estimated     a missing figure was estimated from other figures (top speed from power and class, 0-60 from weight and power)
 * illustrative  a placeholder value typed in for demonstration
 * unavailable   the inputs are missing and nothing was invented: value is null
 */
export type AttributeBasis = 'measured' | 'modelled' | 'estimated' | 'illustrative' | 'unavailable';
export type AttributeScore = {
  /** 0..1000, or null when unavailable. */
  value: number | null;
  basis: AttributeBasis;
  /** The quantity the score was read from, in its own unit: 564.3 (output index), 205 (mph), 2.9 (s), 1.08 (g), 650 (points), 18 (mpg). */
  metric: number | null;
  metricUnit: string;
  /** Specification fields that fed the score. */
  inputs: SpecField[];
  /** Specification fields that would enable the score or make it firmer. */
  missing: SpecField[];
  /** The weakest source among the inputs, or null when there were none. */
  quality: DataQuality | null;
};
export type AttributeScores = Record<AttributeKey, AttributeScore>;

/** One layer of stats: seven scores and the rating made from them. */
export type StatLayer = {
  scores: AttributeScores;
  /** The Power Rating. Null until all seven attributes have a value. */
  powerRating: number | null;
  /** The same weighted mean over the attributes that do have a value; null when none has. Always shown as provisional. */
  provisionalRating: number | null;
  /** How many of the seven have a value. */
  rated: number;
};

/* ------------------------------------------------------------------ evidence ---- */

/**
 * How much stands behind a claim about a vehicle.
 * declared    the owner says so
 * documented  the owner attached a receipt, a photo or a report
 * verified    an independent verifier attested it
 * Uploading something moves a claim to 'documented' and never further.
 */
export type EvidenceLevel = 'declared' | 'documented' | 'verified';
export const EVIDENCE_ORDER: readonly EvidenceLevel[] = ['declared', 'documented', 'verified'];

/* ------------------------------------------------------------- modifications ---- */

export const MOD_CATEGORIES = [
  'engine', 'ecu', 'intake-exhaust', 'turbo', 'supercharger', 'nitrous', 'transmission',
  'suspension', 'tires', 'brakes', 'weight', 'aero', 'offroad', 'eco',
] as const;
export type ModCategory = (typeof MOD_CATEGORIES)[number];
/** 1 Street, 2 Pro, 3 Extreme: the same three tiers the world's Garage sells. */
export type ModTier = 1 | 2 | 3;
export type InstallQuality = 'professional' | 'owner' | 'unknown';

/** A modification currently on the vehicle, as the passport records it. */
export type ActiveModification = {
  /** The passport event that installed it. */
  eventId: string;
  category: ModCategory;
  tier: ModTier;
  install: InstallQuality;
  evidence: EvidenceLevel;
  /** YYYY-MM-DD */
  installedOn: string;
  installedAtMileage: number | null;
  /**
   * How the modification has been looked after, which scales what it costs in reliability and durability.
   * documented  a maintenance record with a file attached exists after the install and within the last 12 months
   * recent      installed within the last 12 months, so no upkeep is due yet
   * lapsed      neither
   */
  upkeep: 'documented' | 'recent' | 'lapsed';
};

/* ----------------------------------------------------------------- condition ---- */

export const WEAR_SYSTEMS = ['engine', 'transmission', 'suspension', 'brakes', 'tires', 'body', 'battery'] as const;
export type WearSystem = (typeof WEAR_SYSTEMS)[number];
/** The value app's own words for condition, accident history and title, kept verbatim so the two never drift. */
export type ConditionBand = 'Excellent' | 'Good' | 'Fair' | 'Poor';
export type AccidentHistory = 'None' | 'Minor' | 'Major';
export type TitleStatus = 'Clean' | 'Rebuilt' | 'Salvage';

export type SystemWear = {
  system: WearSystem;
  /** 0 (as new) to 1 (worn out). */
  wear: number;
  /** modelled: from miles and years since new or since a documented replacement. inspected: an inspector's reading. unknown: nothing to go on, so no penalty is applied. */
  basis: 'modelled' | 'inspected' | 'unknown';
  evidence: EvidenceLevel | null;
  /** Odometer and date the system was last new: null means since the vehicle was built. */
  sinceMileage: number | null;
  sinceDate: string | null;
};
/** What the condition engine needs to know about one vehicle on one day. The passport module derives it; anything else can too. */
export type ConditionInputs = {
  /** YYYY-MM-DD */
  asOf: string;
  modelYear: number;
  powertrain: Powertrain | null;
  /** The latest odometer reading and how well it is evidenced. */
  mileage: { value: number; evidence: EvidenceLevel } | null;
  /** Replacements and rebuilds on record, in any order. Only those at 'documented' or better reset a system's wear. */
  replacements: { system: WearSystem; date: string; mileage: number | null; evidence: EvidenceLevel }[];
  /** Inspectors' readings from valid attestations: wear per system, 0..1. */
  inspections: { date: string; systems: Partial<Record<WearSystem, number>> }[];
  accident: AccidentHistory | null;
  titleStatus: TitleStatus | null;
};
export type ConditionState = {
  /** YYYY-MM-DD */
  asOf: string;
  mileage: number | null;
  mileageEvidence: EvidenceLevel | null;
  systems: Record<WearSystem, SystemWear>;
};

/* --------------------------------------------------------------------- stats ---- */

/** One itemised change between the base layer and a later one. */
export type StatAdjustment = {
  source: 'modification' | 'wear';
  /** The modification's install event id, or the wear system's name. */
  ref: string;
  /** English label: "Turbo · Pro", "Engine wear". Apps translate it. */
  label: string;
  evidence: EvidenceLevel;
  /** Points, signed. */
  deltas: Partial<Record<AttributeKey, number>>;
};
export type VehicleStats = {
  ruleset: string;
  /** A. The factory specification, scored. */
  base: StatLayer;
  /** B. This vehicle: base, every recorded modification, modelled and inspected wear, documented repairs. */
  vehicle: StatLayer;
  /** What ranked play uses: base, plus only what an independent verifier attested. Declared and uploaded claims never move it. */
  competition: StatLayer;
  adjustments: StatAdjustment[];
  competitionAdjustments: StatAdjustment[];
};

/* ---------------------------------------------------------------- the passport ---- */

export type AttachmentKind = 'photo' | 'receipt' | 'invoice' | 'report' | 'title' | 'registration' | 'dyno' | 'other';
/** What the passport knows about a file. The file itself stays with the host app and never enters the engine. */
export type Attachment = { id: string; kind: AttachmentKind; name: string; mime: string; size: number; sha256: string | null };
export type PhotoSubject = 'exterior' | 'interior' | 'engine-bay' | 'undercarriage' | 'vin-plate' | 'odometer' | 'damage' | 'other';

export type VerifierKind = 'inspector' | 'shop' | 'provider' | 'micar';
export type AttestationScope = 'identity' | 'mileage' | 'documentation' | 'condition' | 'originality' | 'modification' | 'specification' | 'one-of-one';
/** An independent party allowed to attest. The host app supplies the list; the engine never trusts a verifier it was not given. */
export type Verifier = { id: string; kind: VerifierKind; name: string; active: boolean; scopes: AttestationScope[] };
/**
 * Checks a verifier's signature over the exact text `attestationPayload` builds. The host supplies it, and it answers
 * at once: a host whose cryptography is asynchronous checks ahead of time and answers from what it found.
 */
export type SignatureCheck = (payload: string, signature: string, verifier: Verifier) => boolean;
export type VerifierRegistry = {
  verifiers: Verifier[];
  /**
   * When present, an attestation counts only if it carries a signature this accepts. When absent, the host is vouching
   * for where the passport is kept: that nobody but a verifier could have written an attestation into it.
   */
  checkSignature?: SignatureCheck;
};
/** A verifier's statement about one vehicle. The only thing that can raise evidence to 'verified'. */
export type Attestation = {
  id: string;
  verifierId: string;
  scope: AttestationScope;
  /** The day the check was made, YYYY-MM-DD. */
  date: string;
  inPerson: boolean;
  /** scope 'condition': the inspector's overall score, 0..100. */
  conditionScore: number | null;
  /** scope 'condition': wear per system, 0..1, for the systems the inspector looked at. */
  systems: Partial<Record<WearSystem, number>> | null;
  /** scope 'mileage': the odometer reading. */
  mileage: number | null;
  /** scopes 'documentation' and 'modification': the event ids the verifier confirmed. */
  events: string[];
  note: string;
  /**
   * A fingerprint of what was attested as it stood when the attestation was recorded: the VIN and the year, make and
   * model for 'identity' and 'one-of-one'; the whole specification for 'specification'; null for the other scopes.
   * The engine writes it. When the passport no longer matches it, the attestation stops counting.
   */
  subject: string | null;
  /** The verifier's signature over `attestationPayload`. The engine stores it; the registry's checker judges it. */
  signature: string | null;
};

export type EventBase = {
  id: string;
  /** The day it happened, YYYY-MM-DD. */
  date: string;
  /** When it was written down, ISO timestamp. */
  recordedAt: string;
  /** Who wrote it: an owner id or a verifier id. */
  by: string;
  /** Odometer reading that day, when known. */
  mileage: number | null;
  title: string;
  note: string;
  attachments: Attachment[];
  /** Private by default. A public event still never shows its files, its note or who wrote it. */
  visibility: 'private' | 'public';
};
export type PassportEvent =
  | (EventBase & { type: 'registered' })
  | (EventBase & { type: 'photo'; subject: PhotoSubject })
  | (EventBase & { type: 'maintenance'; shop: string; cost: number | null })
  | (EventBase & { type: 'repair'; system: WearSystem | null; work: 'repair' | 'replacement' | 'rebuild'; shop: string; cost: number | null })
  | (EventBase & { type: 'mileage' })
  | (EventBase & { type: 'inspection'; inspector: string })
  | (EventBase & { type: 'modification'; action: 'install' | 'remove'; category: ModCategory; tier: ModTier; install: InstallQuality; parts: string; undoes: string | null })
  | (EventBase & { type: 'restoration'; scope: string; oemParts: boolean })
  | (EventBase & { type: 'document'; document: 'title' | 'registration' | 'other' })
  | (EventBase & { type: 'declaration'; condition: ConditionBand | null; accident: AccidentHistory | null; titleStatus: TitleStatus | null; originality: 'stock' | 'modified' | null })
  | (EventBase & { type: 'transfer'; from: string; to: string })
  | (EventBase & { type: 'attestation'; attestation: Attestation })
  | (EventBase & { type: 'void'; target: string; reason: string; attestationId: string });
export type PassportEventType = PassportEvent['type'];
/** The event types an owner may write. Attestations and voids come only from verifiers. */
export const OWNER_EVENT_TYPES = ['photo', 'maintenance', 'repair', 'mileage', 'inspection', 'modification', 'restoration', 'document', 'declaration'] as const;
export type OwnerEventType = (typeof OWNER_EVENT_TYPES)[number];

export type OwnershipPeriod = { ownerId: string; from: string; to: string | null };

/* ------------------------------------------------------------------ the grade ---- */

export const GRADE_CATEGORIES = ['identity', 'documentation', 'condition', 'originality', 'verification'] as const;
export type GradeCategoryKey = (typeof GRADE_CATEGORIES)[number];
export type GradeItem = { id: string; label: string; points: number; max: number; met: boolean };
export type CategoryScore = {
  key: GradeCategoryKey;
  /** 0..100 */
  score: number;
  /** The ceiling in force, when evidence short of verification caps the category; null when nothing caps it. */
  cap: number | null;
  capReason: string;
  items: GradeItem[];
};
export type DiscrepancyId = 'vin-check-digit' | 'vin-year-mismatch' | 'odometer-rollback' | 'voided-record';
export type Discrepancy = { id: DiscrepancyId; detail: string };
export type GradeReport = {
  formula: string;
  /** YYYY-MM-DD */
  asOf: string;
  categories: Record<GradeCategoryKey, CategoryScore>;
  /** 0..100, one decimal. */
  overall: number;
  /** The number on the label: overall / 10, one decimal, never below 1.0. */
  grade10: number;
  /** 1..10, with the tier names the home page already uses. */
  tier: number;
  tierName: string;
  discrepancies: Discrepancy[];
};

export const CERTIFICATION_LEVELS = ['registered', 'documented', 'verified', 'certified'] as const;
export type CertificationLevel = (typeof CERTIFICATION_LEVELS)[number];
export type Requirement = { id: string; level: CertificationLevel; label: string; met: boolean; detail: string };
export type CertificationResult = {
  level: CertificationLevel;
  requirements: Requirement[];
  /** The level after this one, or null at the top. */
  next: CertificationLevel | null;
  /** The unmet requirements of the next level. */
  missing: Requirement[];
};

/** A grade as it stood on one day. Snapshots are appended and never rewritten. */
export type GradeSnapshot = {
  id: string;
  /** ISO timestamp */
  at: string;
  /** YYYY-MM-DD */
  asOf: string;
  reason: string;
  formula: string;
  overall: number;
  grade10: number;
  tier: number;
  categories: Record<GradeCategoryKey, number>;
  level: CertificationLevel;
  /** How many events the passport held when the snapshot was taken. */
  events: number;
};

/* ------------------------------------------------------------------- the card ---- */

export const RARITY_TIERS = ['common', 'uncommon', 'rare', 'epic', 'legendary', 'mythic', 'one-of-one'] as const;
export type RarityTier = (typeof RARITY_TIERS)[number];
/** The finishes the slab already has. Foil follows the grade and is never for sale. */
export type CardFinish = 'raw' | 'standard' | 'blue' | 'holo' | 'rainbow';
export type RarityFactor = { id: 'scarcity' | 'age' | 'provenance' | 'preservation'; label: string; points: number; max: number; detail: string };
export type Rarity = { tier: RarityTier; score: number; factors: RarityFactor[] };

/** One printing of a vehicle's card. A new edition is issued at each milestone; earlier ones stay in the passport. */
export type CardEdition = {
  number: number;
  name: string;
  /** ISO timestamp */
  issuedAt: string;
  level: CertificationLevel;
  rarity: RarityTier;
  finish: CardFinish;
  grade10: number | null;
  powerRating: number | null;
  attributes: MaybeAttributes;
  reason: string;
};

export type Passport = {
  schema: 1;
  /** The vehicle's MiCar identity. Random, never derived from the VIN, and unchanged when the owner changes. */
  micarId: string;
  /** ISO timestamp */
  createdAt: string;
  /** A. The factory specification with its sources. */
  spec: VehicleSpec;
  color: string;
  /** Private. Never part of a public view. '' when the owner has not entered it. */
  vin: string;
  owners: OwnershipPeriod[];
  /** Append-only. */
  events: PassportEvent[];
  /** Append-only. */
  snapshots: GradeSnapshot[];
  /** Append-only. */
  editions: CardEdition[];
};

/** What anyone may see of an event: no files, no note, no author, no cost, no shop, the day blurred to its month. */
export type PublicEvent = {
  type: PassportEventType;
  /** YYYY-MM */
  month: string;
  /** The owner's title when the event is public; a generic title for its type otherwise. */
  title: string;
  /** Rounded down to the thousand. */
  mileage: number | null;
  /** How many files of each kind stand behind it. */
  attachments: Partial<Record<AttachmentKind, number>>;
  verified: boolean;
  /** For an attestation, what was attested (and nothing of what it said); null for every other entry. */
  scope: AttestationScope | null;
};
/** A grade snapshot as anyone may see it: the month, not the day, and no id or reason that could point at a private entry. */
export type PublicSnapshot = {
  /** YYYY-MM */
  month: string;
  formula: string;
  overall: number;
  grade10: number;
  tier: number;
  categories: Record<GradeCategoryKey, number>;
  level: CertificationLevel;
};
/** A card edition as anyone may see it. */
export type PublicEdition = {
  number: number;
  name: string;
  /** YYYY-MM */
  month: string;
  level: CertificationLevel;
  rarity: RarityTier;
  finish: CardFinish;
  grade10: number | null;
  powerRating: number | null;
  attributes: MaybeAttributes;
};
export type PublicPassport = {
  micarId: string;
  /** YYYY-MM */
  createdMonth: string;
  identity: VehicleIdentity;
  color: string;
  vinOnFile: boolean;
  ownerCount: number;
  /** YYYY-MM */
  currentOwnerSince: string;
  events: PublicEvent[];
  snapshots: PublicSnapshot[];
  editions: PublicEdition[];
};

export type CardAttribute = { key: AttributeKey; value: number | null; base: number | null; delta: number; basis: AttributeBasis };
export type ModIndicator = { category: ModCategory; tier: ModTier; evidence: EvidenceLevel };
/** Everything a card prints. No price and no market value: those belong to the value engine. */
export type CollectibleCard = {
  micarId: string;
  /** The identity plus the edition: "MC-7K2D-93QX-41TB · E2". */
  serial: string;
  identity: VehicleIdentity;
  /** "2024 Nissan GT-R" */
  title: string;
  /** "NISMO" */
  subtitle: string;
  color: string;
  /** The owner's photo to show, when the passport has one. The host resolves the file. */
  photoAttachmentId: string | null;
  powerRating: number | null;
  provisionalRating: number | null;
  /** Always seven, in ATTRIBUTE_KEYS order. */
  attributes: CardAttribute[];
  /** Which layer the attributes show. */
  statsBasis: 'base' | 'vehicle';
  level: CertificationLevel;
  grade: { overall: number; grade10: number; tier: number; tierName: string; slabbed: boolean };
  rarity: Rarity;
  edition: { number: number; name: string; issuedAt: string };
  mods: ModIndicator[];
  finish: CardFinish;
  /** 0..1, the slab's existing --foil. */
  foil: number;
  quality: DataQuality | 'verified';
  /** True for a demonstration card whose values are placeholders. */
  illustrative: boolean;
  ruleset: string;
};

/* ------------------------------------------------------------------- the game ---- */

export const RACE_MODES = ['drag', 'circuit', 'endurance', 'economy', 'offroad'] as const;
export type RaceMode = (typeof RACE_MODES)[number];
/** Which stats a race entry runs on. Ranked play accepts 'base' and 'competition' only. */
export type StatsBasis = 'base' | 'competition' | 'vehicle' | 'setup';
export type RaceEntrant = {
  id: string;
  name: string;
  attributes: MaybeAttributes;
  powerRating: number | null;
  bodyClass: BodyClass;
  drivetrain: Drivetrain | null;
  groundClearanceIn: number | null;
  basis: StatsBasis;
  /**
   * True when the specification behind the stats can be trusted by a stranger: it is the catalogue's own, or an
   * independent verifier attested it. A specification an owner typed in is theirs to enjoy and never ranked.
   */
  trusted: boolean;
};
export type RaceRow = {
  id: string;
  name: string;
  position: number;
  /** The final score: attributes by the mode's weights, times terrain, times the day's luck. */
  score: number;
  /** Before luck. */
  rawScore: number;
  /** The multiplier for surface and configuration; 1 outside off-road. */
  terrain: number;
  /** The day's luck as a multiplier, from the seed. */
  luck: number;
  /** Points each attribute contributed to rawScore before terrain. */
  contributions: Partial<Record<AttributeKey, number>>;
};
export type RaceResult = {
  mode: RaceMode;
  seed: number;
  rows: RaceRow[];
  winnerId: string | null;
  /** Winner's score minus second place's; 0 with fewer than two finishers. */
  margin: number;
  /** Entrants that could not start, and why. */
  excluded: { id: string; name: string; reason: string }[];
};
