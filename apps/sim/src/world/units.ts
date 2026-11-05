// The sim renders at 2 world units per metre; physics is SI (metres, seconds, kg).
export const WORLD_PER_M = 2;
export const toWorld = (m: number) => m * WORLD_PER_M;
export const toM = (w: number) => w / WORLD_PER_M;
