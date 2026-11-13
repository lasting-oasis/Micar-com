import type { PauseCard } from './results';
// The driving HUD's DOM state (banners, the Enter prompt, results, the Strip's pause menu, the
// nitrous vignette), kept apart from the game store: the 3D view writes it only when something
// changes, and the React layer (DriveLayer.tsx) reads it. No three.js here, so App can import it.
import { create } from 'zustand';

export type District = 'town' | 'strip';
/** lap races add `gap` (to the winner), `best` (lap), `fastest` (the race's fastest lap) and the car's paint `color` */
export type ResultRow = { name: string; me: boolean; txt: string; gap?: string; best?: string; fastest?: boolean; color?: string };
/** `pending`: a challenge race the others are still driving: the rows fill in, and Continue waits for the race to close */
export type ShownResults = { title: string; sub: string; pos: number; failed: string | null; rows: ResultRow[]; pending?: boolean };
export type EventReward = { cash: number; octane: number; rep: number; stamps: string[] };
/** the Strip's stamps (payout.ts awards them), by name, for the results card */
export const STAMP_NAME: Readonly<Record<string, string>> = { 'strip:first-win': 'First win', 'strip:drag': 'Drag winner', 'strip:drift': 'Drift winner', 'strip:outrun': 'Outrun' };
export const stampName = (id: string): string => STAMP_NAME[id] ?? id.replace(/^strip:/, '').replace(/-/g, ' ');
/** what a tap on the layer asks the 3D view to do */
export type DriveTap = 'enter' | 'continue' | 'again' | 'resume' | 'town' | 'restart' | 'quit' | 'pause' | 'reset' | 'map' | 'signout' | 'garage' | 'swapcar' | 'races';

/** Night Tuner's controls help line (#help), for the HUD on getting in and the pause menu */
export const HELP: Record<District, string> = {
  strip: '↑↓ drive · ←→ steer · Alt nitrous · Space handbrake · Shift/Ctrl gears · C camera · B look back · G lights · N horn · X drift mode · M map · T races · Enter start event · R reset · Esc menu',
  town: '↑↓ drive · ←→ steer · Alt nitrous · Space handbrake · Shift/Ctrl gears · C camera · B look back · G lights · N horn · Backspace reset · Enter on the gate ring: the Strip',
};

type DriveUi = {
  district: District;
  driving: boolean;
  /** the Enter prompt ('' when none) */
  prompt: string;
  banner: { txt: string; bad: boolean; hold: boolean; id: number } | null;
  results: ShownResults | null;
  /** the pause screen's session card during a lap race (set when the race pauses) */
  session: PauseCard | null;
  reward: EventReward | null;
  paused: boolean;
  /** an event is live (not finished): the pause menu offers Restart and Quit */
  eventLive: boolean;
  /** the gear buttons show: manual transmission, or a drag */
  gears: boolean;
  /** the Strip's full-screen map is open (the phone's buttons change) */
  mapOpen: boolean;
  /** px from the top the HUD's arrow clears: the bottom of App's car panel (DriveLayer measures it) */
  topInset: number;
  /** the car panel's left and right edges (page px), 0 when not measured */
  topPanelL: number;
  topPanelR: number;
  /** bumped on getting into a car: the help line shows for a few seconds */
  help: number;
  nos: boolean;
  /** a tap on the layer, taken by the 3D view on its next frame */
  tap: DriveTap | null;
  /** a quick race asked for from the Garage, taken by the 3D view on its next frame */
  quick: string | null;
  /** the car the Garage was left on (Drive, a quick race): the 3D view drives it, swapping cars if it is not the one driven */
  driveCar: string | null;
  /** the Strip's rental lobby: no car, the camera on the bay (a guest's "on foot") */
  lobby: boolean;
  /** the rental counter menu is open (in the lobby) */
  counter: boolean;
  /** the Account panel is asked for (Task 5 draws it) */
  account: boolean;
  /** a rental went back: the money on hand after the payout, for the results card (null: none) */
  returned: number | null;
  /** the challenge card is open in the lobby: making a room, or (in one) the host changing its race */
  challenge: boolean;
  /** the live event is a challenge race (the other cars are people): no restart */
  netRace: boolean;
  /** on the grid of a challenge, the count not begun: the others are still loading, or the green light is seconds off */
  staging: boolean;
  /** the race menu is open (RaceMenu.tsx): the car holds still and the game's keys wait */
  racesOpen: boolean;
  /** the event last raced (the race menu opens on its circuit) */
  lastEvent: string | null;
  set(p: Partial<Omit<DriveUi, 'set'>>): void;
};

export const useDriveUi = create<DriveUi>(set => ({
  district: 'town', driving: false, session: null, prompt: '', banner: null, results: null, reward: null, paused: false, eventLive: false, gears: false, mapOpen: false, topInset: 0, topPanelL: 0, topPanelR: 0, help: 0, nos: false, tap: null, quick: null, driveCar: null, lobby: false, counter: false, account: false, returned: null, challenge: false, netRace: false, staging: false, racesOpen: false, lastEvent: null,
  set: p => set(p),
}));

