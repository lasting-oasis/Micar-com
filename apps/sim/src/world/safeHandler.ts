/** Wraps an event handler so that a throw, or a rejected promise, is handed to `report` and goes no further. */
export function guarded(event: string, handler: (...args: any[]) => unknown, report: (event: string, error: unknown) => void): (...args: any[]) => void {
  return (...args) => {
    try {
      const r = handler(...args);
      if (r && typeof (r as Promise<unknown>).then === 'function') (r as Promise<unknown>).then(undefined, e => report(event, e));
    } catch (e) {
      report(event, e);
    }
  };
}
