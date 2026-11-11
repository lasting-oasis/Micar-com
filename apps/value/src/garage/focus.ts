// Where the keyboard goes when a control replaces itself. A button that opens a form, or asks "are you sure?", is
// taken off the page while the form or the question is up. When that closes, focus would fall back to the top of
// the page, and someone using a keyboard or a screen reader would have to find their place again.
import { useEffect, useRef } from 'react';
import type { RefObject } from 'react';

/**
 * Give the ref this returns to the control that opens something, and say whether that something is open. When it
 * closes, the control gets the keyboard back. Nothing is focused when the page first renders.
 */
export function useFocusBack<T extends HTMLElement = HTMLButtonElement>(open: boolean): RefObject<T | null> {
  const opener = useRef<T | null>(null);
  const was = useRef(open);
  useEffect(() => {
    if (was.current && !open) { try { opener.current?.focus(); } catch { /* it has left the page */ } }
    was.current = open;
  }, [open]);
  return opener;
}
