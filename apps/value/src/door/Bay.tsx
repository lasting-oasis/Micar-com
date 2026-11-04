// The bay: a garage at night, a sectional door that rolls into the ceiling, a chrome pedestal
// under a light shaft. The door's five panels pivot about their top edge as they ride the track.
import { useEffect, useRef, type ReactNode } from 'react';
import { t } from '../i18n';

const reduce = () => { try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; } };

type Props = {
  open: boolean;
  /** Fires when the door finishes moving. */
  onSettled?: (open: boolean) => void;
  /** What's on the pedestal. */
  showcase?: ReactNode;
  showcaseClass?: string;
  onInspect?: () => void;
  readout: string;
  readoutSmall: string;
  paint: ReactNode;
  stamp: string;
  stampHit: boolean;
  children?: ReactNode;
};

export function Bay({ open, onSettled, showcase, showcaseClass = '', onInspect, readout, readoutSmall, paint, stamp, stampHit, children }: Props) {
  const stage = useRef<HTMLDivElement>(null);
  const bay = useRef<HTMLDivElement>(null);
  const door = useRef<HTMLDivElement>(null);
  const motes = useRef<HTMLCanvasElement>(null);
  const pos = useRef(0);
  const raf = useRef(0);
  const settled = useRef(onSettled);
  settled.current = onSettled;

  // Door physics: the top edge rides back along the ceiling; the bottom edge follows up the track.
  const setDoor = (v: number) => {
    const d = door.current; if (!d) return;
    const panels = Array.from(d.children) as HTMLElement[];
    const ph = d.clientHeight / panels.length;
    pos.current = v;
    panels.forEach((p, i) => {
      const yi = i * ph, o = v - yi;
      p.style.transform = o <= 0 ? `translateY(${(-v).toFixed(2)}px)`
        : o < ph ? `translateY(${(-yi).toFixed(2)}px) translateZ(${(-o).toFixed(2)}px) rotateX(${((Math.asin(o / ph) * 180) / Math.PI).toFixed(2)}deg)`
        : `translateY(${(-yi).toFixed(2)}px) translateZ(${(-o).toFixed(2)}px) rotateX(90deg)`;
    });
  };
  const sMax = () => { const d = door.current, b = bay.current; if (!d || !b) return 0; const H = d.clientHeight; return H + H / 5 + b.clientWidth * 0.2; };

  useEffect(() => {
    const to = open ? sMax() : 0, dur = open ? 2200 : 1800;
    cancelAnimationFrame(raf.current);
    if (reduce()) { setDoor(to); settled.current?.(open); return; }
    const from = pos.current, t0 = performance.now();
    const ease = (x: number) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
    const step = (now: number) => {
      const p = Math.min(1, (now - t0) / dur);
      setDoor(from + (to - from) * ease(p));
      if (p < 1) raf.current = requestAnimationFrame(step); else settled.current?.(open);
    };
    raf.current = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf.current);
  }, [open]);

  useEffect(() => {
    const onResize = () => setDoor(pos.current > sMax() / 2 ? sMax() : 0);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  // Pointer parallax on the whole stage.
  useEffect(() => {
    const el = stage.current; if (!el || reduce()) return;
    const move = (e: PointerEvent) => { const r = el.getBoundingClientRect(); el.style.setProperty('--px', (((e.clientX - r.left) / r.width) * 2 - 1).toFixed(3)); el.style.setProperty('--py', (((e.clientY - r.top) / r.height) * 2 - 1).toFixed(3)); };
    const leave = () => { el.style.setProperty('--px', '0'); el.style.setProperty('--py', '0'); };
    el.addEventListener('pointermove', move); el.addEventListener('pointerleave', leave);
    return () => { el.removeEventListener('pointermove', move); el.removeEventListener('pointerleave', leave); };
  }, []);

  // Dust in the light shaft while the door is open.
  useEffect(() => {
    const c = motes.current, b = bay.current; if (!c || !b || !open || reduce()) return;
    const ctx = c.getContext('2d'); if (!ctx) return;
    c.width = b.clientWidth; c.height = b.clientHeight;
    const pts = Array.from({ length: 42 }, () => ({ x: Math.random(), y: Math.random(), r: 0.6 + Math.random() * 1.4, vx: (Math.random() - 0.5) * 0.0004, vy: -0.0002 - Math.random() * 0.0004, a: 0.25 + Math.random() * 0.4 }));
    let id = 0;
    const frame = () => {
      ctx.clearRect(0, 0, c.width, c.height);
      for (const p of pts) {
        p.x += p.vx; p.y += p.vy; if (p.y < 0.05) { p.y = 0.95; p.x = 0.3 + Math.random() * 0.4; } if (p.x < 0 || p.x > 1) p.vx *= -1;
        const near = Math.max(0, 1 - Math.abs(p.x - 0.5) * 3);
        ctx.beginPath(); ctx.arc(c.width * p.x, c.height * p.y, p.r, 0, Math.PI * 2); ctx.fillStyle = `rgba(200,220,255,${(p.a * near).toFixed(2)})`; ctx.fill();
      }
      id = requestAnimationFrame(frame);
    };
    id = requestAnimationFrame(frame);
    return () => { cancelAnimationFrame(id); ctx.clearRect(0, 0, c.width, c.height); };
  }, [open]);

  const panel = (i: number) => (
    <div className="panel" style={{ '--i': i } as React.CSSProperties} key={i}><div className="face"><i className="rib" /><div className="paint painted">{paint}</div></div><div className="inside" /></div>
  );

  return (
    <div className="stage" ref={stage}>
      <div className="floor-glow" />
      <div className="bay" ref={bay}>
        <div className="wall back"><i className="tube v l" style={{ '--dl': '.1s' } as React.CSSProperties} /><i className="tube v r" style={{ '--dl': '.35s' } as React.CSSProperties} /><div className="bench" /></div>
        <div className="wall floor"><div className="bayno painted">01</div><div className="spotpool" /></div>
        <div className="wall ceil"><i className="tube h" style={{ '--dl': '.2s' } as React.CSSProperties} /></div>
        <div className="wall left" /><div className="wall right" />
        <div className="door" ref={door} aria-hidden="true">{[0, 1, 2, 3, 4].map(panel)}</div>
        <div className="shaft" />
        <canvas className="motes" ref={motes} />
        <div className="pedestal" />
        <div className={`showcase ${showcaseClass}`} role={showcase && onInspect ? 'button' : undefined} tabIndex={showcase && onInspect ? 0 : undefined}
          aria-label={showcase ? t('Your card. Press Enter to inspect it.') : undefined}
          onClick={showcase ? onInspect : undefined} onKeyDown={showcase && onInspect ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onInspect(); } } : undefined}>
          {showcase}
        </div>
        <div className="bolts l"><i /><i /><i /></div><div className="bolts r"><i /><i /><i /></div>
        <div className="frame"><span className="sign">{t('Bay 01 · MiCar')}</span></div>
        <div className="panel-auth"><span><i />{t('Status')}</span><b>{readout}</b><small>{readoutSmall}</small>{showcase && onInspect && <button type="button" onClick={onInspect}>{t('Inspect the card')}</button>}</div>
      </div>
      <div className={`stamp ${stampHit ? 'hit' : ''}`}>{stamp}</div>
      {showcase && <div className="inspect-hint">{t('tap the card to inspect it')}</div>}
      {children}
    </div>
  );
}
