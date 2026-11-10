// Words the Garage shows that are not written where they are shown: the tab names, and the reasons a grade snapshot
// or a card edition gives for itself. They live here so the Spanish coverage test can read them.

export const TABS = ['Stats', 'Grade', 'Passport', 'Mods', 'Race', 'Spec sheet'] as const;
export type Tab = (typeof TABS)[number];

/** Why a snapshot was taken, when it was not for an entry (an entry gives its own kind as the reason). */
export const SNAPSHOT_REASONS = { parked: 'Parked', spec: 'Specification updated', vin: 'VIN updated' } as const;
