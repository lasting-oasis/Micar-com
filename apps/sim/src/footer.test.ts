import { describe, expect, it } from 'vitest';
import { FOOTER_COLUMNS } from '@micar/brand/footer';
import { routeFromLocation } from './route';

describe('footer', () => {
  it('World links reach their views', () => {
    const href = (id: string) => FOOTER_COLUMNS.flatMap((c) => c.links).find((l) => l.id === id)!.href;
    for (const id of ['world', 'strip', 'shop']) {
      const u = new URL(href(id));
      expect(routeFromLocation({ pathname: u.pathname, search: u.search }).view, id).toBe(id);
    }
  });
});
