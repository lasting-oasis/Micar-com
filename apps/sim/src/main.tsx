import React, { useState, useEffect, lazy, Suspense } from 'react'
import ReactDOM from 'react-dom/client'
import { loadChunk } from './loadChunk'
import { ChunkBoundary } from './ChunkBoundary'
// Each app is downloaded only when opened, so the launchpad (and each tool)
// loads without pulling in the whole 3D game and every ERP screen up front.
// loadChunk reloads the page once if a chunk is gone after a redeploy;
// ChunkBoundary shows a Reload button if a screen still can't load.
const App = lazy(() => loadChunk(import('./App.tsx')))
const ShopManagement = lazy(() => loadChunk(import('./ShopManagement.tsx')))
const MechanicManagement = lazy(() => loadChunk(import('./MechanicManagement.tsx')))
const StandaloneShopPlatform = lazy(() => loadChunk(import('./StandaloneShopPlatform.tsx')))
const Loading = () => (
  <div className="w-full py-24 grid place-items-center text-white/40 text-xs font-black uppercase tracking-widest">{t(useLang(), 'loading.default')}</div>
)
import './index.css'
import { useLang, t, LangToggle, getLang } from './i18n'
// Global error catcher.
// - Development: full-screen overlay with message, source and stack (as before).
// - Production: a small dismissable notice, so a harmless error (often from a
//   browser extension) no longer takes over the whole screen mid-game.
// Error text is inserted with textContent, never as HTML.
const isOwnScript = (filename?: string) => !filename || filename.startsWith(window.location.origin);
const el = (tag: string, style: string, text?: string) => {
    const node = document.createElement(tag);
    node.style.cssText = style;
    if (text !== undefined) node.textContent = text;
    return node;
};
const showDevErrorOverlay = (event: ErrorEvent) => {
    document.getElementById('debug-error-overlay')?.remove();
    const box = el('div', 'position: fixed; inset: 0; background: rgba(15, 23, 42, 0.98); color: #f87171; font-family: monospace; font-size: 13px; padding: 24px; z-index: 999999; overflow: auto; display: flex; flex-direction: column; gap: 16px; border: 4px solid #ef4444; pointer-events: auto;');
    box.id = 'debug-error-overlay';
    box.appendChild(el('h2', 'color: #ef4444; font-size: 18px; font-weight: 900; margin: 0; border-bottom: 2px solid #ef4444; padding-bottom: 8px;', '⚠️ CRITICAL RUNTIME CRASH CAPTURED'));
    const section = (label: string, body: string, pre = false) => {
        const wrap = el('div', 'background: rgba(0,0,0,0.5); padding: 12px; border-radius: 8px; border: 1px solid rgba(239, 68, 68, 0.2);' + (pre ? ' flex-grow: 1;' : ''));
        wrap.appendChild(el('strong', 'color: #ffffff; display: block; margin-bottom: 4px;', label));
        wrap.appendChild(el(pre ? 'pre' : 'div', pre ? 'margin: 0; white-space: pre-wrap; word-break: break-all; line-height: 1.4; color: #fca5a5;' : '', body));
        box.appendChild(wrap);
    };
    section('Message:', event.message || 'Unknown unhandled error');
    section('Source:', `${event.filename || 'unknown'}:${event.lineno || 0}:${event.colno || 0}`);
    section('Stack Trace:', event.error?.stack || 'No stack trace available', true);
    const close = el('button', 'align-self: flex-end; padding: 10px 20px; background: #ef4444; color: white; border: none; border-radius: 8px; font-weight: bold; cursor: pointer;', 'Close Overlay');
    close.onclick = () => box.remove();
    box.appendChild(close);
    document.body.appendChild(box);
};
const showProdErrorNotice = () => {
    if (document.getElementById('error-notice')) return; // one at a time
    const note = el('div', 'position: fixed; left: 50%; bottom: 24px; transform: translateX(-50%); z-index: 999999; display: flex; align-items: center; gap: 12px; padding: 10px 14px; background: rgba(15,23,42,0.95); color: #fecaca; border: 1px solid rgba(239,68,68,0.5); border-radius: 12px; font: 600 12px system-ui, sans-serif; box-shadow: 0 8px 24px rgba(0,0,0,0.4); pointer-events: auto;', t(getLang(), 'error.notice'));
    note.id = 'error-notice';
    note.setAttribute('role', 'alert');
    const dismiss = el('button', 'background: none; border: none; color: #f87171; font: 800 14px system-ui; cursor: pointer; padding: 0 2px;', '✕');
    dismiss.setAttribute('aria-label', t(getLang(), 'error.dismiss'));
    dismiss.onclick = () => note.remove();
    note.appendChild(dismiss);
    document.body.appendChild(note);
    setTimeout(() => note.remove(), 12000);
};
window.addEventListener('error', (event) => {
    if (!isOwnScript(event.filename)) return; // browser extensions, third-party scripts
    if (!event.error && event.message === 'Script error.') return; // same, when the browser hides the source (cross-origin script)
    console.error(event.error || event.message);
    if (import.meta.env.DEV) showDevErrorOverlay(event);
    else showProdErrorNotice();
});

// Two doors, by audience. Retail: the world opens straight away (no portal).
// Commercial: /shop (or ?app=shop) is MiCar Shop, one screen with the body shop, the mechanic bay and the
// customer tracker as tabs. The old ?app=game|shop|mechanic|platform links keep working.
type View = 'world' | 'shop';
type ShopTab = 'body' | 'mechanic' | 'tracker';
const HOME_URL = 'https://lasting-oasis.github.io/Micar-com/';
const TABS: { id: ShopTab; key: string }[] = [{ id: 'body', key: 'shop.tab.body' }, { id: 'mechanic', key: 'shop.tab.mechanic' }, { id: 'tracker', key: 'shop.tab.tracker' }];

function routeFromLocation(): { view: View; tab: ShopTab } {
  const params = new URLSearchParams(window.location.search);
  const app = params.get('app');
  const path = window.location.pathname.replace(/\/+$/, '');
  const tabParam = params.get('tab') as ShopTab | null;
  if (/\/shop$/.test(path) || app === 'shop' || app === 'mechanic' || app === 'platform') {
    const tab: ShopTab = app === 'mechanic' ? 'mechanic' : app === 'platform' ? 'tracker' : tabParam && TABS.some(t => t.id === tabParam) ? tabParam : 'body';
    return { view: 'shop', tab };
  }
  return { view: 'world', tab: 'body' };
}

function GatewayPortal() {
  const [route, setRoute] = useState(routeFromLocation);
  const lang = useLang();

  useEffect(() => {
    const onChange = () => setRoute(routeFromLocation());
    window.addEventListener('popstate', onChange);
    return () => window.removeEventListener('popstate', onChange);
  }, []);

  // The world wants a locked full-screen viewport (dvh, so mobile browser chrome doesn't push the HUD
  // off-screen); MiCar Shop scrolls like a normal page.
  useEffect(() => {
    const rootEl = document.getElementById('root');
    if (!rootEl) return;
    if (route.view === 'world') {
      document.body.style.overflow = 'hidden';
      rootEl.style.height = '100dvh'; rootEl.style.width = '100%'; rootEl.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = 'auto';
      rootEl.style.height = 'auto'; rootEl.style.minHeight = '100vh'; rootEl.style.width = '100%'; rootEl.style.overflow = 'visible';
    }
  }, [route.view]);

  const selectTab = (tab: ShopTab) => {
    try {
      const url = new URL(window.location.href);
      url.searchParams.set('tab', tab); url.searchParams.delete('app');
      window.history.pushState({}, '', url.toString());
    } catch (e) { console.warn('History pushState blocked by iframe/sandbox:', e); }
    setRoute({ view: 'shop', tab });
  };

  if (route.view === 'world') {
    return (
      <div className="relative w-full h-[100dvh] overflow-hidden bg-[#0c0d12]">
        {/* A way back to the MiCar home; short on phones so it fits beside the top-right [graphics][Menu] buttons */}
        <a href={HOME_URL} className="absolute top-4 left-4 z-[9999] px-3 py-2 bg-black/60 border border-white/20 hover:border-[#ffd23f]/60 rounded-xl hover:bg-black/95 text-xs font-black uppercase tracking-widest text-white transition-all duration-300 flex items-center gap-1.5 shadow-[0_4px_20px_rgba(0,0,0,0.5)] pointer-events-auto">
          <span className="text-[#ffd23f] normal-case">Mi</span><span className="normal-case">Car</span>
        </a>
        <ChunkBoundary><Suspense fallback={<Loading />}><App /></Suspense></ChunkBoundary>
      </div>
    );
  }

  return (
    <div className="relative min-h-screen bg-[#0e1217] text-white flex flex-col font-sans select-none overflow-x-hidden">
      <div className="absolute top-0 left-0 right-0 h-[380px] bg-gradient-to-b from-[#ffd23f]/10 via-[#ffd23f]/[0.02] to-transparent pointer-events-none z-0" />
      <header className="relative z-10 w-full max-w-7xl mx-auto px-4 md:px-8 py-5 flex flex-wrap gap-4 justify-between items-center border-b border-white/5">
        <div className="flex items-center gap-3">
          <a href={HOME_URL} className="text-xl font-black italic uppercase tracking-tight"><span className="text-[#ffd23f] normal-case">Mi</span><span className="normal-case">Car</span> <span className="text-sm font-bold tracking-[0.2em] text-gray-400">{t(lang, 'shop.brand')}</span></a>
        </div>
        <nav className="flex items-center gap-1 rounded-xl bg-white/5 p-1" aria-label={t(lang, 'shop.brand')}>
          {TABS.map(tab => (
            <button key={tab.id} type="button" onClick={() => selectTab(tab.id)} aria-current={route.tab === tab.id ? 'page' : undefined}
              className={`px-4 py-2 rounded-lg text-xs font-black uppercase tracking-widest transition-all ${route.tab === tab.id ? 'bg-[#ffd23f] text-[#0b0d12]' : 'text-gray-400 hover:text-white'}`}>
              {t(lang, tab.key)}
            </button>
          ))}
        </nav>
        <div className="flex items-center gap-3">
          <a href={window.location.pathname.replace(/\/shop\/?$/, '/')} className="text-[10px] font-mono tracking-widest text-gray-400 hover:text-white uppercase">{t(lang, 'shop.world')}</a>
          <LangToggle />
        </div>
      </header>
      <main className="relative z-10 flex-grow w-full max-w-7xl mx-auto px-4 md:px-8 py-6 flex items-center justify-center">
        <ChunkBoundary><Suspense fallback={<Loading />}>
          {route.tab === 'body' ? <ShopManagement /> : route.tab === 'mechanic' ? <MechanicManagement /> : <StandaloneShopPlatform />}
        </Suspense></ChunkBoundary>
      </main>
      <footer className="relative z-10 py-5 text-center border-t border-white/5 text-[9px] text-gray-500 font-mono tracking-widest uppercase">
        {t(lang, 'shop.footer')}
      </footer>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <GatewayPortal />
  </React.StrictMode>,
)
