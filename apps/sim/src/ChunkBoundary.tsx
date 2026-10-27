import React from 'react';
import { t, getLang } from './i18n';

// Wraps a lazily loaded screen. If it can't be loaded (a chunk still missing after
// loadChunk's one reload, a flaky network) or it crashes while rendering, this shows
// a Reload button in its place. Without it React unmounts the whole app and leaves a
// blank page. (lazy() remembers the failure, so only a reload can try again.)
export class ChunkBoundary extends React.Component<{ children: React.ReactNode; className?: string }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div className={this.props.className ?? 'w-full py-24 grid place-items-center'}>
        <div className="flex flex-col items-center gap-3 text-white/60 text-xs font-black uppercase tracking-widest pointer-events-auto">
          {t(getLang(), 'error.screen')}
          <button onClick={() => window.location.reload()} className="px-4 py-2 rounded-xl border border-white/20 bg-white/10 hover:bg-white/20 text-white">{t(getLang(), 'error.reload')}</button>
        </div>
      </div>
    );
  }
}
