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
  'setup.eyebrow': { en: 'a town you can drive in', es: 'un pueblo donde se maneja' },
  'setup.world': { en: 'World', es: 'World' },
  'setup.business': { en: 'Your business', es: 'Tu negocio' },
  'setup.more': { en: 'More options', es: 'Más opciones' },
  'setup.free': { en: 'free to play · mistakes cost Octane, not money', es: 'gratis · los errores cuestan Octane, no dinero' },
  'setup.placeGarage': { en: 'The Garage', es: 'El Garaje' },
  'setup.placeGarageDesc': { en: 'Your cards as cars. Where you start. (Opening with Garage accounts.)', es: 'Tus tarjetas como autos. Donde empiezas. (Abre con las cuentas de Garage.)' },
  'setup.placeDealership': { en: 'The Dealership', es: 'El Concesionario' },
  'setup.placeDealershipDesc': { en: 'Buy at auction, recondition, sell. Run a lot or a shop. Playable today.', es: 'Compra en subasta, reacondiciona, vende. Dirige un lote o un taller. Jugable hoy.' },
  'setup.placeStrip': { en: 'The Strip', es: 'La Pista' },
  'setup.placeStripDesc': { en: 'Six kinds of race in the night city behind the Speedway gate. Playable today.', es: 'Seis tipos de carrera en la ciudad nocturna tras la puerta del Speedway. Ya se puede jugar.' },
  'setup.namePlaceholder': { en: 'e.g. Queen City Motors', es: 'ej. Queen City Motors' },
  'setup.careerPath': { en: 'Select Career Path', es: 'Elige tu Carrera' },
  'setup.dealership': { en: 'Dealership', es: 'Concesionario' },
  'setup.mechanicShop': { en: 'Mechanic shop', es: 'Taller mecánico' },
  'setup.bodyShop': { en: 'Body shop', es: 'Taller de carrocería' },
  'setup.dual': { en: 'Both', es: 'Ambos' },
  'setup.dealerTier': { en: 'Starting size', es: 'Tamaño inicial' },
  'setup.small': { en: 'Small · $25K', es: 'Pequeño · $25K' },
  'setup.med': { en: 'Medium · $75K', es: 'Mediano · $75K' },
  'setup.large': { en: 'Large · $250K', es: 'Grande · $250K' },
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
  'setup.showGuide': { en: 'Show me around when I arrive', es: 'Muéstrame el lugar al llegar' },
  'setup.optOut': { en: 'Opt Out', es: 'Omitir' },
  'setup.establish': { en: 'Enter', es: 'Entrar' },

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
  'shop.tag': { en: 'for real shops · the back office of your shop in MiCar World', es: 'para talleres reales · la oficina de tu taller en MiCar World' },
  'strip.value': { en: 'Value a car', es: 'Valor de un auto' },
  'strip.garage': { en: 'Garage', es: 'Garaje' },
  'strip.world': { en: 'World', es: 'World' },
  'strip.dealers': { en: 'For dealers', es: 'Para concesionarios' },
  'strip.shops': { en: 'For shops', es: 'Para talleres' },
  'strip.soon': { en: 'soon', es: 'pronto' },
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
