// The one Node function this package's tests use: glb.test.ts reads the committed card model from disk.
// Declared here, and nowhere else, so the package needs no @types/node and its library code cannot lean on Node by
// accident: scripts/check.sh type-checks everything against the browser's library only.
declare module 'node:fs' {
  export function readFileSync(path: URL): Uint8Array;
}
