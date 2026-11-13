// The driving HUD's DOM layers, over the 3D view: the HUD canvas (world/hud.ts draws into it), the
// nitrous vignette and banners under App's panels; the Enter prompt (tappable), the event results,
// the Strip's pause menu and the touch buttons InputMap wires by their data-k (nitrous, handbrake;
// the D-pad drives) above App's controls. Both are portals on <body>: the 3D view's own box is a
// stacking context under App's UI, which would take their taps.
import { forwardRef, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { HELP, stampName, useDriveUi, type DriveTap } from './driveUi';
import { useGameStore } from '../store';
import { AccountPanel } from '../strip/AccountPanel';
import { ReplacePrompt } from '../strip/ReplacePrompt';
import { RENTAL_FLEET, canRent, isVisitor } from './rental';
import { TEST_CARS } from './tester';
import { useLang, t } from '../i18n';
import { TouchSticks } from './TouchSticks';
import { getOptions } from './options';
import { ChallengeButton, ChallengeSetup, StagingLine, WaitingRoom } from '../strip/Challenge';

const tap = (t: DriveTap) => useDriveUi.setState({ tap: t });
// App's phone layout (its isMobile): the D-pad drives (its ◀ ▶ taps change a drag's lane), these add
// nitrous, the hand brake, the gears (manual or a drag), and in the Strip pause, reset and the map
const phoneLayout = () => typeof window !== 'undefined' && (window.innerWidth <= 1024 || /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) || 'ontouchstart' in window || navigator.maxTouchPoints > 0);

const Btn = ({ k, label, hidden }: { k: string; label: string; hidden?: boolean }) => (
  <button data-k={k} aria-label={label} className="w-[68px] h-[68px] rounded-full border-2 border-market/60 bg-night/70 text-market font-cond font-extrabold italic text-xs uppercase select-none touch-none [&.on]:bg-market [&.on]:text-night pointer-events-auto" style={{ display: hidden ? 'none' : undefined }}>{label}</button>
);
/** a small square tap button (48 px): pause, reset, map, set GPS */
const TapBtn = ({ t, label, aria, hidden }: { t: DriveTap; label: string; aria: string; hidden?: boolean }) => (
  <button type="button" aria-label={aria} onPointerDown={e => { e.preventDefault(); tap(t); }} className="w-12 h-12 rounded-lg border-2 border-market/60 bg-night/70 text-market font-cond font-extrabold italic text-sm uppercase select-none touch-none active:bg-market active:text-night pointer-events-auto" style={{ display: hidden ? 'none' : undefined }}>{label}</button>
);

const money = (n: number) => '$' + Math.round(n).toLocaleString('en-US');
const rowBtn = 'w-full min-h-[44px] rounded-lg px-4 py-2 text-left font-cond uppercase italic';

/** The Strip's rental counter (the lobby): the fleet, the allowance, the way to an account. */
function Counter() {
  const lang = useLang();
  const me = useGameStore(s => (s.playerId ? s.gameState?.players[s.playerId] : undefined));
  const account = useGameStore(s => s.account);
  const notice = useGameStore(s => s.driveNotice);
  // a rent in flight: the buttons stay disabled until the server answers (the next update, or a refusal)
  const [pending, setPending] = useState(false);
  useEffect(() => { setPending(false); }, [me, notice]);
  if (!me) return null;
  const ok = canRent(me);
  const broke = !account && !ok.ok && ok.reason === 'Not enough money';
  // Tester mode (the server's tester key): every car on the list, kept until it is swapped
  if (me.tester) {
    const makes = [...new Set(TEST_CARS.map(c => (c.fleet ? '' : c.make)))];
    return (
      // a long list: on a phone it stops short of the right edge, where the lobby's pause button sits
      <div className="pointer-events-auto absolute left-4 right-16 bottom-6 md:left-auto md:right-20 md:bottom-auto md:top-24 md:w-[340px] max-h-[calc(100dvh-6rem)] overflow-y-auto overscroll-contain rounded-xl border border-market/40 bg-night/95 p-5 text-white shadow-2xl" role="dialog" aria-label={t(lang, 'strip.counter')}>
        <div className="flex items-baseline justify-between gap-4 mb-2">
          <div className="font-cond italic font-black uppercase text-2xl md:text-3xl leading-none text-market">{t(lang, 'strip.counter')}</div>
          <div className="font-cond font-bold text-lg tabular-nums">{money(me.money)}</div>
        </div>
        <p className="font-sans text-[13px] text-white/80 mb-3">{t(lang, 'strip.testerLine')}</p>
        <div className="flex flex-col gap-2 mb-3"><ChallengeButton /></div>
        {makes.map(make => (
          <div key={make || 'fleet'} className="mb-3">
            <div className="font-cond font-semibold uppercase tracking-[0.14em] text-xs text-haze mb-1.5">{make || t(lang, 'strip.fleet')}</div>
            <div className="flex flex-col gap-1.5">
              {TEST_CARS.filter(c => (c.fleet ? '' : c.make) === make).map(c => (
                <button key={`${c.make} ${c.model}`} type="button" disabled={pending} onClick={() => { setPending(true); useGameStore.getState().takeTestCar(c.make, c.model); }}
                  className={`${rowBtn} flex items-center gap-3 border border-market/60 enabled:hover:bg-market enabled:hover:text-night disabled:opacity-45 disabled:cursor-not-allowed`}>
                  <span className="w-4 h-4 rounded-full border border-white/30 flex-none" style={{ background: c.color }} aria-hidden="true" />
                  <span className="flex-1 min-w-0 font-extrabold text-lg leading-tight truncate">{c.make} {c.model}</span>
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
    );
  }
  return (
    <div className="pointer-events-auto absolute inset-x-4 bottom-6 md:inset-x-auto md:left-auto md:right-20 md:bottom-auto md:top-24 md:w-[340px] max-h-[calc(100dvh-6rem)] overflow-y-auto rounded-xl border border-market/40 bg-night/95 p-5 text-white shadow-2xl" role="dialog" aria-label={t(lang, 'strip.counter')}>
      <div className="flex items-baseline justify-between gap-4 mb-3">
        <div className="font-cond italic font-black uppercase text-2xl md:text-3xl leading-none text-market">{t(lang, 'strip.counter')}</div>
        <div className="font-cond font-bold text-lg tabular-nums">{money(me.money)}</div>
      </div>
      <div className="flex flex-col gap-2">
        <ChallengeButton />
        {RENTAL_FLEET.map(f => (
          <button key={f.key} type="button" disabled={!canRent(me, f.key).ok || pending} onClick={() => { setPending(true); useGameStore.getState().rentCar(f.key); }}
            className={`${rowBtn} flex items-center gap-3 border border-market/60 enabled:hover:bg-market enabled:hover:text-night disabled:opacity-45 disabled:cursor-not-allowed`}>
            <span className="w-4 h-4 rounded-full border border-white/30 flex-none" style={{ background: f.color }} aria-hidden="true" />
            <span className="flex-1 min-w-0">
              <span className="block font-extrabold text-lg leading-tight truncate">{f.make} {f.model}</span>
              <span className="block not-italic normal-case font-sans text-[13px] text-white/80">{t(lang, f.blurb)}</span>
              <span className="block not-italic normal-case font-sans text-[13px] text-haze">{t(lang, 'strip.oneEvent').replace('{price}', money(f.price))}</span>
            </span>
          </button>
        ))}
        {!ok.ok && <p className="font-sans text-[13px] text-[#ff8a96]">{t(lang, ok.reason === 'Not enough money' ? 'strip.noMoney' : 'strip.hasRental')}</p>}
        {account && (account.allowanceToday
          ? <div className={`${rowBtn} border border-white/15 text-white/50 font-bold`}>{t(lang, 'strip.collected')}</div>
          : <button type="button" onClick={() => useGameStore.getState().claimAllowance()} className={`${rowBtn} bg-market text-night font-extrabold`}>{t(lang, 'strip.collect')}</button>)}
        {broke && <button type="button" onClick={() => useDriveUi.setState({ account: true })} className={`${rowBtn} bg-market text-night font-extrabold normal-case not-italic font-sans text-[15px]`}>{t(lang, 'strip.counterNudge')}</button>}
      </div>
    </div>
  );
}

export const DriveLayer = forwardRef<HTMLDivElement, { canvasRef: React.RefObject<HTMLCanvasElement> }>(({ canvasRef }, rootRef) => {
  const driving = useDriveUi(s => s.driving);
  const district = useDriveUi(s => s.district);
  const prompt = useDriveUi(s => s.prompt);
  const banner = useDriveUi(s => s.banner);
  const results = useDriveUi(s => s.results);
  const reward = useDriveUi(s => s.reward);
  const paused = useDriveUi(s => s.paused);
  const session = useDriveUi(s => s.session);
  const eventLive = useDriveUi(s => s.eventLive);
  const help = useDriveUi(s => s.help);
  // Night Tuner's #help: the controls line for 8 s on getting in (and in the pause menu)
  const [helpOn, setHelpOn] = useState(false);
  useEffect(() => { if (!help) return; setHelpOn(true); const t = setTimeout(() => setHelpOn(false), 8000); return () => clearTimeout(t); }, [help]);
  const nos = useDriveUi(s => s.nos);
  const gears = useDriveUi(s => s.gears);
  const mapOpen = useDriveUi(s => s.mapOpen);
  const lobby = useDriveUi(s => s.lobby);
  const counter = useDriveUi(s => s.counter);
  const returned = useDriveUi(s => s.returned);
  // a challenge race: its card in the lobby (making a room, or the host changing the race), the room, no restart
  const challenge = useDriveUi(s => s.challenge);
  const netRace = useDriveUi(s => s.netRace);
  const inRoom = useGameStore(s => !!s.race);
  const lang = useLang();
  // a Strip visitor (a guest or an account holder) has no town to go back to; an account holder can sign out
  const visitor = useGameStore(s => isVisitor(s.playerId ? s.gameState?.players[s.playerId] : undefined));
  const signedIn = useGameStore(s => !!s.account);
  const tester = useGameStore(s => !!(s.playerId && s.gameState?.players[s.playerId]?.tester));
  // App's car panel sits at the top centre: the HUD's arrow drops below its bottom edge (topInset)
  useEffect(() => {
    if (!driving) { if (useDriveUi.getState().topInset) useDriveUi.setState({ topInset: 0 }); return; }
    let el: Element | null = null, ro: ResizeObserver | null = null;
    const measure = () => {
      const e = document.querySelector('[data-car-panel]');
      if (e !== el) { ro?.disconnect(); el = e; if (e && typeof ResizeObserver !== 'undefined') { ro = new ResizeObserver(measure); ro.observe(e); } }
      const b = e?.getBoundingClientRect(), v = b ? Math.max(0, Math.round(b.bottom - 8)) : 0, l = b ? Math.round(b.left) : 0, r = b ? Math.round(b.right) : 0;
      const u = useDriveUi.getState();
      if (v !== u.topInset || l !== u.topPanelL || r !== u.topPanelR) useDriveUi.setState({ topInset: v, topPanelL: l, topPanelR: r });
    };
    measure();
    const iv = setInterval(measure, 500);
    return () => { clearInterval(iv); ro?.disconnect(); };
  }, [driving]);
  const [touch, setTouch] = useState(phoneLayout);
  const sticks = getOptions().controls === 'sticks';
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

  const show = driving || !!results || lobby;
  return (
    <>
      {createPortal(
        <div className="fixed inset-0 z-[920] pointer-events-none overflow-hidden font-sans" style={{ display: show ? undefined : 'none' }}>
          {/* starts under the top bar (the MiCar link, the menu buttons) */}
          <canvas ref={canvasRef} className="absolute left-0 right-0 bottom-0 top-16 w-full h-[calc(100%-4rem)]" />
          <div className="absolute inset-0 transition-opacity duration-300" style={{ opacity: nos ? .9 : 0, background: 'radial-gradient(ellipse at center, transparent 55%, rgba(121,166,255,.35) 100%)' }} />
          <div className="absolute left-1/2 top-[76px] -translate-x-1/2 max-w-[calc(100vw-32px)] truncate whitespace-nowrap px-4 py-2 bg-night/75 border border-market/30 font-sans font-semibold text-[13px] text-haze transition-opacity duration-700" style={{ opacity: helpOn && driving && !paused && !results ? 1 : 0 }}>{HELP[district]}</div>
          <StagingLine />
          {shownBanner && shownBanner.txt && (
            <div className="absolute left-1/2 top-[28%] -translate-x-1/2 -translate-y-1/2 w-[min(92vw,720px)] text-center">
              <div className={`inline-block max-w-full px-6 py-1.5 rounded-lg bg-night/80 border border-line border-l-4 ${shownBanner.bad ? 'border-l-[#ff5a6a]' : 'border-l-market'} font-cond italic font-black uppercase tracking-wide drop-shadow-[0_2px_12px_rgba(0,0,0,.8)] ${shownBanner.txt.length < 4 ? 'text-8xl' : shownBanner.txt.length > 22 ? 'text-2xl md:text-4xl' : 'text-4xl md:text-5xl'} ${shownBanner.bad ? 'text-[#ff5a6a]' : 'text-market'}`}>{shownBanner.txt}</div>
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
            <div className="absolute left-1/2 -translate-x-1/2 top-24 px-5 py-2 rounded-lg bg-night/90 border border-line border-l-4 border-l-market text-white font-cond font-bold text-lg">
              {reward.cash > 0 ? <span className="text-market">+${reward.cash.toLocaleString('en-US')}</span> : 'No prize'}
              {reward.octane > 0 && <span className="ml-3 text-[#79a6ff]">+{reward.octane} Octane</span>}
              {reward.rep > 0 && <span className="ml-3 text-white/70">+{reward.rep} REP</span>}
            </div>
          )}

          {results && (
            <div className="pointer-events-auto absolute inset-0 grid place-items-center bg-night/60 p-4">
              <div className={`${results.rows.some(r => r.best !== undefined) ? 'w-[min(520px,100%)]' : 'w-[320px] max-w-full'} max-h-[calc(100vh-32px)] overflow-y-auto rounded-xl border border-line bg-night/95 p-5 text-white shadow-2xl`}>
                <div className="h-1 w-14 bg-market mb-3" />
                <div className="font-cond italic font-black uppercase text-3xl text-market">{results.title}</div>
                <div className="text-xs text-haze mb-3 uppercase tracking-widest">{results.sub}</div>
                {results.rows.some(r => r.best !== undefined) ? (
                  /* a lap race: the classification, gaps to the winner, best laps (the race's fastest in purple) */
                  <table className="w-full mb-3 font-cond text-base tabular-nums border-collapse">
                    <thead><tr className="font-sans text-[11px] uppercase tracking-widest text-haze"><th className="text-left font-semibold w-7 pb-1">#</th><th className="text-left font-semibold pb-1">{t(lang, 'res.driver')}</th><th className="text-right font-semibold pb-1">{t(lang, 'res.time')}</th><th className="text-right font-semibold pb-1">{t(lang, 'res.best')}</th></tr></thead>
                    <tbody>
                      {results.rows.map((r, i) => (
                        <tr key={i} className={r.me ? 'bg-market text-night font-extrabold' : 'text-white/85 border-t border-line'}>
                          <td className="pl-1 py-1">{i + 1}</td>
                          <td className="py-1"><span className="inline-block w-1 h-4 mr-2 align-[-2px]" style={{ background: r.me ? '#0e1217' : r.color ?? '#9aa3ad' }} />{r.name}</td>
                          <td className="text-right py-1">{i === 0 || !r.gap ? r.txt : r.gap + (r.txt.endsWith('*') ? '*' : '')}</td>
                          <td className={`text-right pr-1 py-1 ${r.fastest && !r.me ? 'text-[#b25cff]' : ''}`}>{r.best}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : (
                  <ol className="space-y-1 mb-3">
                    {results.rows.map((r, i) => (
                      <li key={i} className={`flex justify-between font-cond text-lg ${r.me ? 'text-market font-extrabold' : 'text-white/80'}`}><span>{i + 1}. {r.name}</span><span className="tabular-nums">{r.txt}</span></li>
                    ))}
                  </ol>
                )}
                {reward && (
                  <div className="font-cond text-lg mb-3">
                    {reward.cash > 0 ? <span className="text-market font-extrabold">+${reward.cash.toLocaleString('en-US')}</span> : <span className="text-white/50">{t(lang, 'res.noPrize')}</span>}
                    {reward.octane > 0 && <span className="ml-3 text-[#79a6ff]">+{reward.octane} Octane</span>}
                    {reward.stamps.length > 0 && <span className="ml-3 text-white/70">Stamp{reward.stamps.length > 1 ? 's' : ''}: {reward.stamps.map(stampName).join(', ')}</span>}
                  </div>
                )}
                {returned !== null && <div className="font-cond text-lg mb-3 text-white/80">Rental returned — {money(returned)} on hand</div>}
                {results.pending
                  ? <div role="status" className="w-full min-h-[44px] rounded-lg border border-market/40 py-2 text-center font-cond font-extrabold uppercase italic text-market">{t(lang, 'strip.ch.waitOthers')}</div>
                  : <div className="flex gap-2">
                      {district === 'strip' && !netRace && returned === null && <button onClick={() => tap('again')} className="flex-1 min-h-[44px] rounded-lg border border-market/60 py-2 font-cond font-extrabold uppercase italic text-market">{t(lang, 'res.again')}</button>}
                      <button onClick={() => tap('continue')} className="flex-1 min-h-[44px] rounded-lg bg-market py-2 font-cond font-extrabold uppercase italic text-night">{t(lang, 'res.continue')} [Enter]</button>
                    </div>}
              </div>
            </div>
          )}

          {paused && district === 'strip' && !results && (
            <div className="pointer-events-auto absolute inset-0 grid place-items-center overflow-y-auto bg-night/60 p-4 backdrop-blur-[3px]">
              <div className="flex flex-col sm:flex-row items-stretch gap-3 max-w-[calc(100vw-32px)]">
              <div className="w-[300px] max-w-full rounded-xl border border-line bg-night/95 p-5 flex flex-col gap-2">
                <div className="h-1 w-14 bg-market" />
                <div className="font-cond italic font-black uppercase text-3xl text-market mb-1">{t(lang, 'pause.title')}</div>
                <button onClick={() => tap('resume')} className="min-h-[44px] rounded-lg bg-market py-2 font-cond font-extrabold uppercase italic text-night">{t(lang, 'pause.resume')}</button>
                {eventLive && !netRace && <button onClick={() => tap('restart')} className="min-h-[44px] rounded-lg border border-market/60 py-2 font-cond font-extrabold uppercase italic text-market">{t(lang, 'pause.restart')}</button>}
                {eventLive && <button onClick={() => tap('quit')} className="min-h-[44px] rounded-lg border border-market/60 py-2 font-cond font-extrabold uppercase italic text-market">{t(lang, 'pause.quit')}</button>}
                {tester && !lobby && !eventLive && <button onClick={() => tap('garage')} className="min-h-[44px] rounded-lg border border-market/60 py-2 font-cond font-extrabold uppercase italic text-market">Garage</button>}
                {tester && !lobby && !eventLive && <button onClick={() => tap('swapcar')} className="min-h-[44px] rounded-lg border border-market/60 py-2 font-cond font-extrabold uppercase italic text-market">Swap car</button>}
                {!visitor && <button onClick={() => tap('town')} className="min-h-[44px] rounded-lg border border-market/60 py-2 font-cond font-extrabold uppercase italic text-market">Back to town</button>}
                {visitor && <button onClick={() => useDriveUi.setState({ account: true })} className="min-h-[44px] rounded-lg border border-market/60 py-2 font-cond font-extrabold uppercase italic text-market">Account</button>}
                {visitor && lobby && signedIn && <button onClick={() => tap('signout')} className="min-h-[44px] rounded-lg border border-market/60 py-2 font-cond font-extrabold uppercase italic text-market">Sign out</button>}
                {!lobby && <p className="mt-2 text-[12px] leading-snug text-haze">{HELP.strip}</p>}
              </div>
              {session && eventLive && (
                /* the race so far: lap, position, last and best laps, the car */
                <div className="w-[300px] sm:w-[240px] max-w-full rounded-xl border border-line bg-night/95 p-5">
                  <div className="text-[11px] uppercase tracking-widest text-haze mb-3">{session.event}</div>
                  <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 font-cond text-lg tabular-nums">
                    {([['pause.lap', session.lap], ['pause.pos', session.pos], ['pause.last', session.last], ['pause.best', session.best], ['pause.car', session.car]] as const).map(([k, v]) => (
                      <div key={k} className="contents"><dt className="font-sans text-[11px] uppercase tracking-widest text-haze self-center">{t(lang, k)}</dt><dd className={`text-right font-extrabold italic ${k === 'pause.best' ? 'text-[#79a6ff]' : 'text-white'} truncate`}>{v}</dd></div>
                    ))}
                  </dl>
                </div>
              )}
              </div>
            </div>
          )}

          {lobby && counter && !results && !paused && (challenge ? <ChallengeSetup /> : inRoom ? <WaitingRoom /> : <Counter />)}
          {/* the lobby's pause button (Esc on a keyboard) */}
          <div className="absolute right-3 top-[38%]" style={{ display: touch && lobby && !results && !paused ? undefined : 'none' }}>
            <TapBtn t="pause" label="II" aria="Pause" />
          </div>

          {/* always mounted (InputMap wires the [data-k] buttons once, on getting in): shown and hidden by style */}
          {/* the stick layout (the default) or the old buttons, chosen in the Garage's options */}
          {touch && driving && !results && sticks && <TouchSticks gears={gears} />}
          <div className="fixed left-4 bottom-6 flex gap-2.5 touch-none select-none" style={{ display: touch && driving && !results && !sticks ? 'flex' : 'none', paddingBottom: 'env(safe-area-inset-bottom)' }}>
            <Btn k="left" label="◀" />
            <Btn k="right" label="▶" />
          </div>
          <div className="fixed right-4 bottom-6 grid grid-cols-2 gap-2.5 touch-none select-none" style={{ display: touch && driving && !results && !sticks ? 'grid' : 'none', paddingBottom: 'env(safe-area-inset-bottom)' }}>
            <Btn k="dn" label="▼ Gear" hidden={!gears} />
            <Btn k="up" label="▲ Gear" hidden={!gears} />
            <Btn k="nos" label="NOS" />
            <Btn k="hb" label="E-brk" />
            <Btn k="brk" label="Brake" />
            <Btn k="thr" label="Gas" />
          </div>
          {/* pause, reset and map in a row across the top right, clear of the thumbs */}
          <div className="fixed flex flex-row gap-3" style={{ top: 'calc(16px + env(safe-area-inset-top, 0px))', right: 'max(16px, calc(env(safe-area-inset-right, 0px) + 8px))', display: touch && driving && !results && !paused ? undefined : 'none' }}>
            <TapBtn t="pause" label="II" aria="Pause" hidden={district !== 'strip' || mapOpen} />
            <TapBtn t="reset" label="R" aria="Reset the car" hidden={mapOpen} />
            <TapBtn t="map" label="Map" aria="Map" hidden={district !== 'strip' || (eventLive && !mapOpen)} />
            <TapBtn t="enter" label="GPS" aria="Set GPS" hidden={!mapOpen} />
          </div>
        </div>, document.body)}
      <AccountPanel />
      <ReplacePrompt />
    </>
  );
});
DriveLayer.displayName = 'DriveLayer';
