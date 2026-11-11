// The phone's stick controls (docs/superpowers/plans/2026-11-11-mobile-sticks.md): a steering stick whose knob is a
// wheel, an up-and-down gas stick, hold buttons for Drift and NOS, and the gear buttons when gears are shown. Each
// stick or button follows one finger from the moment it lands until it lifts or the browser takes it back, and writes
// into `touchSticks`, which InputMap reads. Moves change the DOM directly: no React render per touch.
import { useEffect, useRef } from 'react';
import { releaseSticks, setSteerStick, touchSticks } from './sticks';

/** degrees the drawn wheel turns at full lock */
const WHEEL_MAX = 180;
const stickBox = 'relative w-[140px] h-[140px] rounded-full border border-white/15 bg-night/40 touch-none select-none pointer-events-auto';

function useStick(onMove: (x: number, y: number) => void) {
  const pad = useRef<HTMLDivElement>(null), knob = useRef<HTMLDivElement>(null);
  const cb = useRef(onMove); cb.current = onMove; // a new render never re-wires the stick (that would drop a thumb)
  useEffect(() => {
    const el = pad.current!, k = knob.current!;
    let pid: number | null = null, cx = 0, cy = 0;
    const put = (x: number, y: number) => {
      const r = el.offsetWidth / 2 - 10;
      k.style.transform = `translate(${x * r}px, ${-y * r}px)`;
      cb.current(x, y);
    };
    const move = (e: PointerEvent) => {
      if (e.pointerId !== pid) return;
      const r = el.offsetWidth / 2 - 10;
      let x = (e.clientX - cx) / r, y = -(e.clientY - cy) / r;
      const m = Math.hypot(x, y); if (m > 1) { x /= m; y /= m; }
      put(x, y);
    };
    const down = (e: PointerEvent) => {
      e.preventDefault();
      if (pid !== null) return;
      pid = e.pointerId;
      try { el.setPointerCapture(pid); } catch { /* not capturable */ }
      const b = el.getBoundingClientRect(); cx = b.left + b.width / 2; cy = b.top + b.height / 2;
      el.dataset.on = '1'; move(e);
    };
    const up = (e: PointerEvent) => { if (e.pointerId !== pid) return; pid = null; delete el.dataset.on; put(0, 0); };
    const menu = (e: Event) => e.preventDefault();
    el.addEventListener('pointerdown', down); el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up); el.addEventListener('contextmenu', menu);
    return () => {
      el.removeEventListener('pointerdown', down); el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up); el.removeEventListener('pointercancel', up); el.removeEventListener('contextmenu', menu);
      put(0, 0);
    };
  }, []);
  return { pad, knob };
}

/** a button that is on while a finger is on it */
function Hold({ label, aria, set, className }: { label: string; aria: string; set: (on: boolean) => void; className: string }) {
  const ref = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const el = ref.current!;
    let pid: number | null = null;
    const down = (e: PointerEvent) => { e.preventDefault(); if (pid !== null) return; pid = e.pointerId; try { el.setPointerCapture(pid); } catch { /* not capturable */ } el.dataset.on = '1'; set(true); };
    const up = (e: PointerEvent) => { if (e.pointerId !== pid) return; pid = null; delete el.dataset.on; set(false); };
    const menu = (e: Event) => e.preventDefault();
    el.addEventListener('pointerdown', down); el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up); el.addEventListener('contextmenu', menu);
    return () => { el.removeEventListener('pointerdown', down); el.removeEventListener('pointerup', up); el.removeEventListener('pointercancel', up); el.removeEventListener('contextmenu', menu); set(false); };
  }, [set]);
  return <button ref={ref} type="button" aria-label={aria} className={`h-14 rounded-2xl border-2 border-market/60 bg-night/70 text-market font-cond font-extrabold italic text-lg uppercase select-none touch-none pointer-events-auto data-[on]:bg-market data-[on]:text-night ${className}`}>{label}</button>;
}

/** a one-shot tap (a gear) */
const Tap = ({ label, aria, onTap }: { label: string; aria: string; onTap: () => void }) => (
  <button type="button" aria-label={aria} onPointerDown={e => { e.preventDefault(); onTap(); }} onContextMenu={e => e.preventDefault()}
    className="w-14 h-12 rounded-xl border-2 border-market/60 bg-night/70 text-market font-cond font-extrabold italic text-sm uppercase select-none touch-none pointer-events-auto active:bg-market active:text-night">{label}</button>
);

const steerMove = (x: number) => { setSteerStick(x); };
const gasMove = (_x: number, y: number) => { touchSticks.gasY = y; };
const setDrift = (on: boolean) => { touchSticks.drift = on; };
const setNos = (on: boolean) => { touchSticks.nos = on; };

export function TouchSticks({ gears }: { gears: boolean }) {
  const wheel = useRef<HTMLDivElement>(null);
  const steer = useStick((x) => { steerMove(x); if (wheel.current) wheel.current.style.transform = `rotate(${x * WHEEL_MAX}deg)`; });
  // the gas stick moves only up and down: its knob stays on the line, its sideways travel is never read
  const gas = useStick((_x, y) => { gasMove(0, y); if (gas.knob.current) gas.knob.current.style.transform = `translate(0px, ${-y * ((gas.pad.current?.offsetWidth ?? 140) / 2 - 10)}px)`; });
  useEffect(() => () => releaseSticks(), []);
  const bottom = { bottom: 'calc(24px + env(safe-area-inset-bottom, 0px))' };
  return (
    <>
      <div className="fixed flex flex-col items-start gap-3" style={{ ...bottom, left: 'max(20px, calc(env(safe-area-inset-left, 0px) + 12px))' }}>
        {gears && (
          <div className="flex gap-2.5">
            <Tap label="▼ Gear" aria="Shift down" onTap={() => { touchSticks.shiftDn = true; }} />
            <Tap label="▲ Gear" aria="Shift up" onTap={() => { touchSticks.shiftUp = true; }} />
          </div>
        )}
        <div ref={steer.pad} className={stickBox} role="slider" aria-label="Steering">
          <div ref={steer.knob} className="absolute left-1/2 top-1/2 -ml-[30px] -mt-[30px] w-[60px] h-[60px] rounded-full bg-night border-2 border-white/80 shadow-lg will-change-transform">
            <div ref={wheel} className="absolute inset-1">
              <svg viewBox="0 0 64 64" aria-hidden="true" className="w-full h-full block">
                <circle cx="32" cy="32" r="27" fill="none" stroke="currentColor" strokeWidth="5" className="text-white/90" />
                <path d="M8 34 Q32 26 56 34" fill="none" stroke="currentColor" strokeWidth="5" className="text-white/90" />
                <path d="M32 31 L32 58" stroke="currentColor" strokeWidth="5" className="text-white/90" />
                <circle cx="32" cy="32" r="6" fill="currentColor" className="text-night" stroke="white" strokeWidth="3" />
                <rect x="29.5" y="4" width="5" height="7" rx="1.5" fill="currentColor" className="text-market" />
              </svg>
            </div>
          </div>
        </div>
      </div>
      <div className="fixed flex flex-col items-end gap-3" style={{ ...bottom, right: 'max(20px, calc(env(safe-area-inset-right, 0px) + 12px))' }}>
        <div className="flex gap-2.5 w-[140px]">
          <Hold label="NOS" aria="Nitrous (hold)" set={setNos} className="flex-1" />
          <Hold label="Drift" aria="Drift (hold)" set={setDrift} className="flex-[1.35]" />
        </div>
        <div ref={gas.pad} className={stickBox} role="slider" aria-label="Gas and brake">
          <div className="absolute left-1/2 top-3 bottom-3 -ml-[11px] w-[22px] rounded-full bg-white/10" />
          <span className="absolute top-2 inset-x-0 text-center text-[11px] font-semibold text-white/50">GAS</span>
          <span className="absolute bottom-2 inset-x-0 text-center text-[11px] font-semibold text-white/50">BRAKE / R</span>
          <div ref={gas.knob} className="absolute left-1/2 top-1/2 -ml-[30px] -mt-[30px] w-[60px] h-[60px] rounded-full bg-night border-2 border-white/80 shadow-lg will-change-transform" />
        </div>
      </div>
    </>
  );
}
