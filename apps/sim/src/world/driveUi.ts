// The driving HUD's DOM state (banners, the Enter prompt, results, the Strip's pause menu, the
// nitrous vignette), kept apart from the game store: the 3D view writes it only when something
// changes, and the React layer (DriveLayer.tsx) reads it. No three.js here, so App can import it.
import { create } from 'zustand';

export type District = 'town' | 'strip';
export type ResultRow = { name: string; me: boolean; txt: string };
export type ShownResults = { title: string; sub: string; pos: number; failed: string | null; rows: ResultRow[] };
export type EventReward = { cash: number; octane: number; rep: number; stamps: string[] };
/** what a tap on the layer asks the 3D view to do */
export type DriveTap = 'enter' | 'continue' | 'resume' | 'town';

type DriveUi = {
  district: District;
  driving: boolean;
  /** the Enter prompt ('' when none) */
  prompt: string;
  banner: { txt: string; bad: boolean; hold: boolean; id: number } | null;
  results: ShownResults | null;
  reward: EventReward | null;
  paused: boolean;
  nos: boolean;
  /** a tap on the layer, taken by the 3D view on its next frame */
  tap: DriveTap | null;
  /** a quick race asked for from the Garage, taken by the 3D view on its next frame */
  quick: string | null;
  set(p: Partial<Omit<DriveUi, 'set'>>): void;
};

export const useDriveUi = create<DriveUi>(set => ({
  district: 'town', driving: false, prompt: '', banner: null, results: null, reward: null, paused: false, nos: false, tap: null, quick: null,
  set: p => set(p),
}));

