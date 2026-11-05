// The driving HUD's DOM state (banners, the Enter prompt, results, the Strip's pause menu, the
// nitrous vignette), kept apart from the game store: the 3D view writes it only when something
// changes, and the React layer (DriveLayer.tsx) reads it. No three.js here, so App can import it.
import { create } from 'zustand';

export type District = 'town' | 'strip';
export type ResultRow = { name: string; me: boolean; txt: string };
export type ShownResults = { title: string; sub: string; pos: number; failed: string | null; rows: ResultRow[] };
export type EventReward = { cash: number; octane: number; rep: number; stamps: string[] };
/** what a tap on the layer asks the 3D view to do */
export type DriveTap = 'enter' | 'continue' | 'resume' | 'town' | 'restart' | 'quit' | 'pause' | 'reset' | 'map';

/** Night Tuner's controls help line (#help), for the HUD on getting in and the pause menu */
export const HELP: Record<District, string> = {
  strip: '↑↓ drive · ←→ steer · Alt nitrous · Space handbrake · Shift/Ctrl gears · C camera · B look back · G lights · N horn · X drift mode · M map · Enter start event · R reset · Esc menu',
  town: '↑↓ drive · ←→ steer · Alt nitrous · Space handbrake · Shift/Ctrl gears · C camera · B look back · G lights · N horn · Backspace reset · Enter on the gate ring: the Strip',
};

type DriveUi = {
  district: District;
  driving: boolean;
  /** the Enter prompt ('' when none) */
  prompt: string;
  banner: { txt: string; bad: boolean; hold: boolean; id: number } | null;
  results: ShownResults | null;
  reward: EventReward | null;
  paused: boolean;
  /** an event is live (not finished): the pause menu offers Restart and Quit */
  eventLive: boolean;
  /** the gear buttons show: manual transmission, or a drag */
  gears: boolean;
  /** the Strip's full-screen map is open (the phone's buttons change) */
  mapOpen: boolean;
  /** bumped on getting into a car: the help line shows for a few seconds */
  help: number;
  nos: boolean;
  /** a tap on the layer, taken by the 3D view on its next frame */
  tap: DriveTap | null;
  /** a quick race asked for from the Garage, taken by the 3D view on its next frame */
  quick: string | null;
  set(p: Partial<Omit<DriveUi, 'set'>>): void;
};

export const useDriveUi = create<DriveUi>(set => ({
  district: 'town', driving: false, prompt: '', banner: null, results: null, reward: null, paused: false, eventLive: false, gears: false, mapOpen: false, help: 0, nos: false, tap: null, quick: null,
  set: p => set(p),
}));

