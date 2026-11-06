// Node-only track reader (tests, server). Kept apart from district.ts so the client bundle never pulls fs.
import fs from 'node:fs';
import path from 'node:path';
import { registerTrack, type TrackData, type TrackId } from './district';

let trackDir = path.resolve(process.cwd(), 'public/strip/tracks');
export function setTrackDir(dir: string): void { trackDir = dir; }
export function readTrackSync(trackId: TrackId): TrackData {
  const data = JSON.parse(fs.readFileSync(path.join(trackDir, trackId + '.json'), 'utf8')) as TrackData;
  registerTrack(trackId, data); return data;
}
