/** Wraps an event handler so that a throw, or a rejected promise, is handed to `report` and goes no further, even when `report` itself throws. */
export function guarded(event: string, handler: (...args: any[]) => unknown, report: (event: string, error: unknown) => void): (...args: any[]) => void {
  const tell = (e: unknown) => { try { report(event, e); } catch { /* nothing escapes the guard */ } };
  return (...args) => {
    try {
      const r = handler(...args);
      if (r && typeof (r as Promise<unknown>).then === 'function') (r as Promise<unknown>).then(undefined, tell);
    } catch (e) {
      tell(e);
    }
  };
}

/** What the server logs for a handler that failed: the event, the error's text and, when it has one, the first stack frame. Never the payload. Never throws. */
export function handlerErrorLog(event: string, error: unknown): { event: string; error: string; at?: string } {
  const text = error instanceof Error ? String(error.message) : typeof error === 'string' ? error : '(not an Error)';
  const stack = error instanceof Error && typeof error.stack === 'string' ? error.stack : '';
  const at = stack.split('\n').map(l => l.trim()).find(l => l.startsWith('at '));
  return at ? { event, error: text, at } : { event, error: text };
}
