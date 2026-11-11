// Words the Garage shows that are not written where they are shown: the tab names, and the reasons a grade snapshot
// or a card edition gives for itself. They live here so the Spanish coverage test can read them.

export const TABS = ['Stats', 'Grade', 'Passport', 'Mods', 'Race', 'Spec sheet'] as const;
export type Tab = (typeof TABS)[number];

/** Why a snapshot was taken, when it was not for an entry (an entry gives its own kind as the reason). */
export const SNAPSHOT_REASONS = { parked: 'Parked', spec: 'Specification updated', vin: 'VIN updated' } as const;

/** What a car's tile says after its name: nothing for this garage's own car, and otherwise why it cannot be written to here. */
export const HOLDING_WORDS: Record<'owner' | 'transferred' | 'other', string> = { owner: '', transferred: 'transferred', other: 'another garage' };

/** The note a figure carries after the vehicle was renamed. It is stored with the figure, so it is written once, here, and translated where it is shown. */
export const RENAMED_NOTE = 'Kept when the vehicle was renamed; no longer credited to its earlier source.';
