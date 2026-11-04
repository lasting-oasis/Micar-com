// After a redeploy, a page that is still open asks for the previous build's
// chunk files, which no longer exist, so opening the game or a tool fails with
// "Failed to fetch dynamically imported module". loadChunk wraps a lazy import()
// and, when it fails, reloads the page once to pick up the current build. Each
// build that reloaded is recorded in sessionStorage, so the page reloads at most
// once per build and a chunk that is missing or unreachable for any other reason
// can't cause a reload loop: the next failure in the same build is thrown as before.

// This module is part of the entry chunk, which embeds the hashed file names of
// all the lazy chunks, so its own file name (and URL) changes with every build
// that changes any chunk: it identifies the build this page is running.
const BUILD = import.meta.url;
const KEY = 'cds.chunkReload';
let reloading = false;

const firstReloadForThisBuild = () => {
  try {
    const reloaded = sessionStorage.getItem(KEY) || '';
    if (reloaded.split(' ').includes(BUILD)) return false;
    sessionStorage.setItem(KEY, `${reloaded} ${BUILD}`.trim());
    return true;
  } catch {
    return false; // storage blocked: no loop guard, so don't reload
  }
};

export function loadChunk<T>(chunk: Promise<T>): Promise<T> {
  return chunk.catch((err) => {
    if (!reloading) {
      // Dev serves source files, not hashed chunks: show the real error there.
      if (import.meta.env.DEV || !firstReloadForThisBuild()) throw err;
      reloading = true;
      window.location.reload();
    }
    return new Promise<T>(() => {}); // keep showing the loading screen until the page reloads
  });
}
