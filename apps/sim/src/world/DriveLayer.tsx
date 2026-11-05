// The driving HUD's DOM layers, over the 3D view: the HUD canvas (world/hud.ts draws into it), the
// nitrous vignette and banners under App's panels; the Enter prompt (tappable), the event results,
// the Strip's pause menu and the touch buttons InputMap wires by their data-k (nitrous, handbrake;
// the D-pad drives) above App's controls. Both are portals on <body>: the 3D view's own box is a
// stacking context under App's UI, which would take their taps.
import { forwardRef, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useDriveUi, type DriveTap } from './driveUi';

const tap = (t: DriveTap) => useDriveUi.setState({ tap: t });
// App's phone layout (its isMobile): the D-pad drives, these add nitrous and the hand brake
const phoneLayout = () => typeof window !== 'undefined' && (window.innerWidth <= 1024 || /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) || 'ontouchstart' in window || navigator.maxTouchPoints > 0);

const Btn = ({ k, label }: { k: string; label: string }) => (
  <button data-k={k} className="w-16 h-16 rounded-full border-2 border-market/60 bg-night/70 text-market font-cond font-extrabold italic text-xs uppercase select-none touch-none [&.on]:bg-market [&.on]:text-night pointer-events-auto">{label}</button>
);

export const DriveLayer = forwardRef<HTMLDivElement, { canvasRef: React.RefObject<HTMLCanvasElement> }>(({ canvasRef }, rootRef) => {
  const driving = useDriveUi(s => s.driving);
  const district = useDriveUi(s => s.district);
  const prompt = useDriveUi(s => s.prompt);
  const banner = useDriveUi(s => s.banner);
  const results = useDriveUi(s => s.results);
  const reward = useDriveUi(s => s.reward);
  const paused = useDriveUi(s => s.paused);
  const nos = useDriveUi(s => s.nos);
  const [touch, setTouch] = useState(phoneLayout);
  useEffect(() => { const f = () => setTouch(phoneLayout()); window.addEventListener('resize', f); return () => window.removeEventListener('resize', f); }, []);
  // a banner that does not hold fades after 1.6 s
  const [shownBanner, setShownBanner] = useState(banner);
  useEffect(() => {
    setShownBanner(banner);
    if (!banner || banner.hold) return;
    const t = setTimeout(() => setShownBanner(b => (b && b.id === banner.id ? null : b)), 1600);
    return () => clearTimeout(t);
  }, [banner]);
  useEffect(() => { if (!reward || results) return; const t = setTimeout(() => useDriveUi.setState({ reward: null }), 4500); return () => clearTimeout(t); }, [reward, results]);

  const show = driving || !!results;
  return (
    <>
      {createPortal(
        <div className="fixed inset-0 z-[920] pointer-events-none overflow-hidden font-sans" style={{ display: show ? undefined : 'none' }}>
          {/* starts under the top bar (the MiCar link, the menu buttons) */}
          <canvas ref={canvasRef} className="absolute left-0 right-0 bottom-0 top-16 w-full h-[calc(100%-4rem)]" />
          <div className="absolute inset-0 transition-opacity duration-300" style={{ opacity: nos ? .9 : 0, background: 'radial-gradient(ellipse at center, transparent 55%, rgba(121,166,255,.35) 100%)' }} />
          {shownBanner && shownBanner.txt && (
            <div className="absolute left-1/2 top-[28%] -translate-x-1/2 -translate-y-1/2 text-center">
              <div className={`font-cond italic font-black uppercase tracking-wide drop-shadow-[0_2px_12px_rgba(0,0,0,.8)] ${shownBanner.txt.length < 4 ? 'text-8xl' : 'text-4xl md:text-5xl'} ${shownBanner.bad ? 'text-[#ff5a6a]' : 'text-market'}`}>{shownBanner.txt}</div>
            </div>
          )}
        </div>, document.body)}
      {createPortal(
        <div ref={rootRef} className="fixed inset-0 z-[995] pointer-events-none overflow-hidden font-sans" style={{ display: show ? undefined : 'none' }}>
          {prompt && !results && (
            <button onClick={() => tap('enter')} className="pointer-events-auto absolute left-1/2 -translate-x-1/2 bottom-44 md:bottom-36 px-5 py-2 rounded-lg bg-night/85 border border-market/60 text-market font-cond font-extrabold italic uppercase tracking-wider text-lg shadow-lg">
              {prompt}
            </button>
          )}

          {reward && !results && (
            <div className="absolute left-1/2 -translate-x-1/2 top-24 px-5 py-2 rounded-lg bg-night/90 border border-market/50 text-white font-cond font-bold text-lg">
              {reward.cash > 0 ? <span className="text-market">+${reward.cash.toLocaleString('en-US')}</span> : 'No prize'}
              {reward.octane > 0 && <span className="ml-3 text-[#79a6ff]">+{reward.octane} Octane</span>}
              {reward.rep > 0 && <span className="ml-3 text-white/70">+{reward.rep} REP</span>}
            </div>
          )}

          {results && (
            <div className="pointer-events-auto absolute inset-0 grid place-items-center bg-night/60 p-4">
              <div className="w-[320px] max-w-full rounded-xl border border-market/40 bg-night p-5 text-white shadow-2xl">
                <div className="font-cond italic font-black uppercase text-3xl text-market">{results.title}</div>
                <div className="text-xs text-white/50 mb-3 uppercase tracking-widest">{results.sub}</div>
                <ol className="space-y-1 mb-3">
                  {results.rows.map((r, i) => (
                    <li key={i} className={`flex justify-between font-cond text-lg ${r.me ? 'text-market font-extrabold' : 'text-white/80'}`}><span>{i + 1}. {r.name}</span><span className="tabular-nums">{r.txt}</span></li>
                  ))}
                </ol>
                {reward && (
                  <div className="font-cond text-lg mb-3">
                    {reward.cash > 0 ? <span className="text-market font-extrabold">+${reward.cash.toLocaleString('en-US')}</span> : <span className="text-white/50">No prize</span>}
                    {reward.octane > 0 && <span className="ml-3 text-[#79a6ff]">+{reward.octane} Octane</span>}
                    {reward.stamps.length > 0 && <span className="ml-3 text-white/70">Stamp!</span>}
                  </div>
                )}
                <button onClick={() => tap('continue')} className="w-full rounded-lg bg-market py-2 font-cond font-extrabold uppercase italic text-night">Continue [Enter]</button>
              </div>
            </div>
          )}

          {paused && district === 'strip' && !results && (
            <div className="pointer-events-auto absolute inset-0 grid place-items-center bg-night/60">
              <div className="w-[260px] rounded-xl border border-market/40 bg-night p-5 flex flex-col gap-2">
                <div className="font-cond italic font-black uppercase text-3xl text-market mb-1">Paused</div>
                <button onClick={() => tap('resume')} className="rounded-lg bg-market py-2 font-cond font-extrabold uppercase italic text-night">Resume</button>
                <button onClick={() => tap('town')} className="rounded-lg border border-market/60 py-2 font-cond font-extrabold uppercase italic text-market">Back to town</button>
              </div>
            </div>
          )}

          <div className="absolute left-6 bottom-44 flex gap-3" style={{ display: touch && driving ? undefined : 'none' }}>
            <Btn k="nos" label="NOS" />
            <Btn k="hb" label="E-brake" />
          </div>
        </div>, document.body)}
    </>
  );
});
DriveLayer.displayName = 'DriveLayer';
