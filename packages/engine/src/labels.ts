// The engine's words, in plain English, in one place. The engine never translates: each app looks these up in its
// own dictionary (the value app's Spanish coverage test lists these tables so no label ships untranslated).
import type { AttributeBasis, AttributeKey, BodyClass, CertificationLevel, DataQuality, EvidenceLevel, RarityTier } from './types';

export const ATTRIBUTE_LABELS: Record<AttributeKey, string> = {
  power: 'Power', speed: 'Speed', acceleration: 'Acceleration', handling: 'Handling',
  durability: 'Durability', reliability: 'Reliability', efficiency: 'Efficiency',
};

/** What each attribute measures, in one line. */
export const ATTRIBUTE_BLURBS: Record<AttributeKey, string> = {
  power: 'Engine or electric motor performance',
  speed: 'Maximum achievable speed',
  acceleration: 'Ability to gain speed',
  handling: 'Cornering, steering and vehicle control',
  durability: 'Resistance to wear and physical damage',
  reliability: 'Mechanical dependability',
  efficiency: 'Fuel or energy efficiency',
};

export const BASIS_LABELS: Record<AttributeBasis, string> = {
  measured: 'Read from the specification',
  modelled: 'Modelled from the configuration',
  estimated: 'Estimated from other figures',
  illustrative: 'Illustrative value',
  unavailable: 'Not rated: figures missing',
};

export const QUALITY_LABELS: Record<DataQuality | 'verified', string> = {
  illustrative: 'Illustrative example',
  owner: 'Owner-entered data',
  reference: 'Reference data, not verified',
  sourced: 'Sourced data',
  verified: 'Verified data',
};

export const EVIDENCE_LABELS: Record<EvidenceLevel, string> = { declared: 'Declared', documented: 'Documented', verified: 'Verified' };

export const LEVEL_LABELS: Record<CertificationLevel, string> = {
  registered: 'Registered', documented: 'Documented', verified: 'Verified', certified: 'Certified',
};

/** What each certification level means, in one line. */
/** Each certification level prints its own edition of the card. */
export const EDITION_NAMES: Record<CertificationLevel, string> = {
  registered: 'Registration Edition', documented: 'Documented Edition', verified: 'Verified Edition', certified: 'Certified Edition',
};

export const LEVEL_SUMMARIES: Record<CertificationLevel, string> = {
  registered: 'The vehicle is on record with an owner.',
  documented: 'Its identity and history are backed by files the owner attached.',
  verified: 'An independent party has checked its identity, and its mileage or its records.',
  certified: 'An independent inspector has examined the vehicle in person.',
};

export const RARITY_LABELS: Record<RarityTier, string> = {
  common: 'Common', uncommon: 'Uncommon', rare: 'Rare', epic: 'Epic', legendary: 'Legendary', mythic: 'Mythic', 'one-of-one': 'One-of-One',
};

export const BODY_CLASS_LABELS: Record<BodyClass, string> = {
  sports: 'Sports car', coupe: 'Coupe', sedan: 'Sedan', hatchback: 'Hatchback', wagon: 'Wagon',
  suv: 'SUV', offroad: 'Off-road 4x4', pickup: 'Pickup', van: 'Van',
};
