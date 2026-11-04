import { useEffect, useState } from 'react';

// Lightweight EN/ES internationalization for the landing page + pre-game setup.
// Persisted in localStorage; components re-render on change via a window event.
export type Lang = 'en' | 'es';
const KEY = 'cds_lang';

export const getLang = (): Lang => {
  try { return localStorage.getItem(KEY) === 'es' ? 'es' : 'en'; } catch { return 'en'; }
};
export const setLang = (l: Lang) => {
  try { localStorage.setItem(KEY, l); } catch { /* ignore */ }
  window.dispatchEvent(new CustomEvent('micar-langchange'));
};

// Re-renders the calling component whenever the language changes.
export const useLang = (): Lang => {
  const [lang, setL] = useState<Lang>(getLang());
  useEffect(() => {
    const h = () => setL(getLang());
    window.addEventListener('micar-langchange', h);
    return () => window.removeEventListener('micar-langchange', h);
  }, []);
  return lang;
};

type Entry = { en: string; es: string };
const DICT: Record<string, Entry> = {
  // ---- Gateway / landing page ----





  // ---- Pre-game setup screen ----
  'setup.title': { en: 'MiCar World', es: 'MiCar World' },
  'setup.subtitle': { en: 'Learn the car business without paying for your mistakes', es: 'Aprende el negocio de los autos sin pagar por tus errores' },
  'setup.nameLabel': { en: 'Your name on the door', es: 'Tu nombre en la puerta' },
  'setup.namePlaceholder': { en: 'e.g. Apex Corporate', es: 'ej. Apex Corporate' },
  'setup.careerPath': { en: 'Select Career Path', es: 'Elige tu Carrera' },
  'setup.dealership': { en: '💼 Dealership', es: '💼 Concesionario' },
  'setup.mechanicShop': { en: '🔧 Mechanic Shop', es: '🔧 Taller Mecánico' },
  'setup.bodyShop': { en: '🎨 Paint & Body Shop', es: '🎨 Taller de Pintura y Chapa' },
  'setup.dual': { en: '⚡ Dual Specialty', es: '⚡ Especialidad Doble' },
  'setup.dealerTier': { en: 'Select Dealership Tier', es: 'Elige el Nivel del Concesionario' },
  'setup.small': { en: 'Small ($25K)', es: 'Pequeño ($25K)' },
  'setup.med': { en: 'Med ($75K)', es: 'Mediano ($75K)' },
  'setup.large': { en: 'Large ($250K)', es: 'Grande ($250K)' },
  'setup.shopLogistics': { en: 'Shop Starting Logistics', es: 'Recursos Iniciales del Taller' },
  'setup.specialtyLbl': { en: 'Specialty:', es: 'Especialidad:' },
  'setup.startingCapital': { en: 'Starting Capital:', es: 'Capital Inicial:' },
  'setup.intakeCapacity': { en: 'Intake Capacity:', es: 'Capacidad de Servicio:' },
  'setup.mechanicSpecialty': { en: 'Mechanic Specialty', es: 'Especialidad Mecánica' },
  'setup.bodySpecialty': { en: 'Paint & Body Specialty', es: 'Pintura y Chapa' },
  'setup.dualCenter': { en: 'Dual-Service Center', es: 'Centro de Servicio Doble' },
  'setup.cash45': { en: '$45,000 Cash', es: '$45,000 en Efectivo' },
  'setup.cash35': { en: '$35,000 Cash', es: '$35,000 en Efectivo' },
  'setup.cash95': { en: '$95,000 Cash', es: '$95,000 en Efectivo' },
  'setup.capMech': { en: '2 Lifts & Diagnostics', es: '2 Elevadores y Diagnóstico' },
  'setup.capBody': { en: '2 Lifts & Paint Mixer', es: '2 Elevadores y Mezclador' },
  'setup.capDual': { en: '4 Lifts & Full Suite', es: '4 Elevadores y Suite Completa' },
  'setup.firstTime': { en: 'First Time Playing?', es: '¿Primera Vez Jugando?' },
  'setup.showGuide': { en: 'Show Guide', es: 'Ver Guía' },
  'setup.optOut': { en: 'Opt Out', es: 'Omitir' },
  'setup.establish': { en: 'Establish Connection', es: 'Establecer Conexión' },

  // ---- In-game graphics quality button ----
  'graphics.high': { en: 'Graphics: high', es: 'Gráficos: alto' },
  'graphics.low': { en: 'Graphics: low', es: 'Gráficos: bajo' },
  'graphics.highShort': { en: 'HQ', es: 'Alto' },
  'graphics.lowShort': { en: 'LQ', es: 'Bajo' },
  'graphics.toHigh': { en: 'Switch to high graphics', es: 'Cambiar a gráficos altos' },
  'graphics.toLow': { en: 'Switch to low graphics', es: 'Cambiar a gráficos bajos' },
  'graphics.highAria': { en: 'Graphics quality: high. Switch to low.', es: 'Gráficos: alto. Cambiar a bajo.' },
  'graphics.lowAria': { en: 'Graphics quality: low. Switch to high.', es: 'Gráficos: bajo. Cambiar a alto.' },

  // ---- Loading screens & error notice ----
  'shop.brand': { en: 'Shop', es: 'Shop' },
  'shop.tab.body': { en: 'Body shop', es: 'Carrocería' },
  'shop.tab.mechanic': { en: 'Mechanic', es: 'Mecánica' },
  'shop.tab.tracker': { en: 'Customer tracker', es: 'Seguimiento para clientes' },
  'shop.world': { en: 'MiCar World', es: 'MiCar World' },
  'shop.footer': { en: 'MiCar Shop · the same job catalog as the garage in MiCar World · a finished job is a trail entry on the card', es: 'MiCar Shop · el mismo catálogo de trabajos que el garaje de MiCar World · un trabajo terminado es una entrada en el historial de la tarjeta' },
  'loading.default': { en: 'Loading…', es: 'Cargando…' },
  'loading.world': { en: 'Loading 3D world…', es: 'Cargando mundo 3D…' },
  'error.notice': { en: 'Something went wrong. If the game stops responding, reload the page.', es: 'Algo salió mal. Si el juego deja de responder, recarga la página.' },
  'error.dismiss': { en: 'Dismiss', es: 'Cerrar' },
  'error.screen': { en: "Couldn't load this screen.", es: 'No se pudo cargar esta pantalla.' },
  'error.reload': { en: 'Reload', es: 'Recargar' },
};

export const t = (lang: Lang, key: string): string => DICT[key]?.[lang] ?? key;

// The brand is always written "MiCar", even inside an all-caps heading: wrap it so the
// heading's uppercase styling leaves it alone ("MiCar DEALER SIMULATOR").
export const withBrand = (text: string) =>
  text.split(/(MiCar)/).map((part, i) => part === 'MiCar' ? <span key={i} className="normal-case">MiCar</span> : part);

// EN | ES pill toggle, usable on any dark screen.
export const LangToggle = ({ className = '' }: { className?: string }) => {
  const lang = useLang();
  return (
    <div className={`inline-flex items-center rounded-full border border-white/15 bg-black/50 backdrop-blur-md overflow-hidden text-[10px] font-black uppercase tracking-widest shadow-lg ${className}`}>
      {(['en', 'es'] as Lang[]).map(l => (
        <button key={l} type="button" onClick={() => setLang(l)}
          className={`px-3 py-1.5 transition-colors ${lang === l ? 'bg-cyan-400 text-black' : 'text-gray-300 hover:text-white'}`}>
          {l === 'en' ? '🇺🇸 EN' : '🇪🇸 ES'}
        </button>
      ))}
    </div>
  );
};
