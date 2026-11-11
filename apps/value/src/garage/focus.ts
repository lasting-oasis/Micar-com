// Where the keyboard goes when a control replaces itself. A button that opens a form, or asks "are you sure?", is
// taken off the page while the form or the question is up. When that closes, focus would fall back to the top of
// the page, and someone using a keyboard or a screen reader would have to find their place again.
import { useEffect, useRef } from 'react';
import type { RefObject } from 'react';

/**
 * Give the ref this returns to the control that opens something, and say whether that something is open. When it
 * closes, the control gets the keyboard back, but only if nothing else has it: when the button that was pressed has
 * gone from the page, focus has fallen to the body. A question that goes away because the person went back to a
 * field and changed what they typed leaves the keyboard in that field. Nothing is focused when the page first renders.
 */
export function useFocusBack<T extends HTMLElement = HTMLButtonElement>(open: boolean): RefObject<T | null> {
  const opener = useRef<T | null>(null);
  const was = useRef(open);
  useEffect(() => {
    if (was.current && !open) {
      try {
        const held = document.activeElement;
        if (held === null || held === document.body || !document.body.contains(held)) opener.current?.focus();
      } catch { /* no document, or the control has left the page */ }
    }
    was.current = open;
  }, [open]);
  return opener;
}
