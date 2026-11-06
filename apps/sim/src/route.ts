// Which door the URL opens: the world (retail, no portal), the Strip's entry card (/strip), or MiCar Shop
// (/shop or ?app=shop; the old ?app=mechanic|platform links keep working). Pure, so it is testable.
export type View = 'world' | 'shop' | 'strip';
export type ShopTab = 'body' | 'mechanic' | 'tracker';
export const SHOP_TABS: { id: ShopTab; key: string }[] = [{ id: 'body', key: 'shop.tab.body' }, { id: 'mechanic', key: 'shop.tab.mechanic' }, { id: 'tracker', key: 'shop.tab.tracker' }];

export function routeFromLocation(loc: { pathname: string; search: string }): { view: View; tab: ShopTab } {
  const params = new URLSearchParams(loc.search);
  const app = params.get('app');
  const path = loc.pathname.replace(/\/+$/, '');
  const tabParam = params.get('tab') as ShopTab | null;
  if (/\/strip$/.test(path)) return { view: 'strip', tab: 'body' };
  if (/\/shop$/.test(path) || app === 'shop' || app === 'mechanic' || app === 'platform') {
    const tab: ShopTab = app === 'mechanic' ? 'mechanic' : app === 'platform' ? 'tracker' : tabParam && SHOP_TABS.some(t => t.id === tabParam) ? tabParam : 'body';
    return { view: 'shop', tab };
  }
  return { view: 'world', tab: 'body' };
}
