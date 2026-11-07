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
  'setup.or': { en: 'or', es: 'o' },
  'setup.enterStrip': { en: 'Enter the Strip', es: 'Entra al Strip' },
  'setup.enterStripDesc': { en: 'Just race. Rent a car at the lot — no dealership and no account needed.', es: 'Solo corre. Alquila un auto en el lote: sin concesionario y sin cuenta.' },
  'setup.placeGarage': { en: 'The Garage', es: 'El Garaje' },
  'setup.placeGarageDesc': { en: 'Your cards as cars. Where you start. (Opening with Garage accounts.)', es: 'Tus tarjetas como autos. Donde empiezas. (Abre con las cuentas de Garage.)' },
  'setup.placeDealership': { en: 'The Dealership', es: 'El Concesionario' },
  'setup.placeDealershipDesc': { en: 'Buy at auction, recondition, sell. Run a lot or a shop. Playable today.', es: 'Compra en subasta, reacondiciona, vende. Dirige un lote o un taller. Jugable hoy.' },
  'setup.placeStrip': { en: 'The Strip', es: 'La Pista' },
  'setup.placeStripDesc': { en: 'Ten world circuits to scale behind the Speedway gate. Playable today.', es: 'Diez circuitos del mundo a escala real tras la puerta del Speedway. Ya se puede jugar.' },
  'strip.title': { en: 'The Strip', es: 'La Pista' },
  'strip.nameLabel': { en: 'What do we call you?', es: '¿Cómo te llamamos?' },
  'strip.guest': { en: 'Race as guest', es: 'Correr como invitado' },
  'strip.google': { en: 'Sign in with Google', es: 'Entrar con Google' },
  'strip.emailLink': { en: 'Email me a link', es: 'Envíame un enlace' },
  'strip.emailLabel': { en: 'Your email', es: 'Tu correo' },
  'strip.footnote': { en: "A guest's progress lasts until you quit. Make an account to keep it and collect $1,000 a day.", es: 'El progreso de un invitado dura hasta que sales. Crea una cuenta para conservarlo y cobrar $1,000 al día.' },
  'strip.osm': { en: 'Map data © OpenStreetMap contributors (ODbL)', es: 'Datos del mapa © colaboradores de OpenStreetMap (ODbL)' },
  'strip.linkSent': { en: 'Check your email — the link works for 15 minutes.', es: 'Revisa tu correo: el enlace funciona 15 minutos.' },
  'strip.noGoogle': { en: 'Google sign-in is not set up here.', es: 'El acceso con Google no está disponible aquí.' },
  'strip.googleFail': { en: 'Could not reach Google.', es: 'No se pudo conectar con Google.' },
  'strip.joinFail': { en: "Couldn't join the Strip — check your connection and try again.", es: 'No se pudo entrar a La Pista: revisa tu conexión e inténtalo de nuevo.' },
  'strip.continue': { en: 'Race as guest while you wait', es: 'Corre como invitado mientras esperas' },
  'strip.account': { en: 'Account', es: 'Cuenta' },
  'strip.signedGoogle': { en: 'Signed in with Google as {who}', es: 'Sesión con Google como {who}' },
  'strip.signedEmail': { en: 'Signed in with email as {who}', es: 'Sesión con correo como {who}' },
  'strip.yourGoogle': { en: 'your Google account', es: 'tu cuenta de Google' },
  'strip.guestLine': { en: 'Guest — progress lasts until you quit', es: 'Invitado: el progreso dura hasta que sales' },
  'strip.collected': { en: 'Collected today', es: 'Cobrado hoy' },
  'strip.collect': { en: "Collect today's $1,000", es: 'Cobra los $1,000 de hoy' },
  'strip.signOut': { en: 'Sign out', es: 'Cerrar sesión' },
  'strip.close': { en: 'Close', es: 'Cerrar' },
  'strip.accountNudge': { en: 'Make an account to keep your progress and collect $1,000 a day.', es: 'Crea una cuenta para conservar tu progreso y cobrar $1,000 al día.' },
  'strip.replace': { en: 'Your {money} from this session will be replaced by your saved account.', es: 'Tus {money} de esta sesión serán reemplazados por tu cuenta guardada.' },
  'strip.replaceTitle': { en: 'Replace this session?', es: '¿Reemplazar esta sesión?' },
  'strip.confirm': { en: 'Confirm', es: 'Confirmar' },
  'strip.cancel': { en: 'Cancel', es: 'Cancelar' },
  'strip.joining': { en: 'Joining…', es: 'Entrando…' },
  'strip.googleButton': { en: "Google's sign-in pop-up didn't open — use the Google button below.", es: 'La ventana de Google no se abrió: usa el botón de Google de abajo.' },
  'strip.elsewhere': { en: 'Signed in — go back to your game tab', es: 'Sesión iniciada: vuelve a la pestaña de tu juego' },
  'strip.linkChoice': { en: 'A game tab asked to sign in as {email}.', es: 'Una pestaña del juego pidió entrar como {email}.' },
  'strip.signThatTab': { en: 'Sign in that tab', es: 'Iniciar sesión en esa pestaña' },
  'strip.signHere': { en: 'Sign in here', es: 'Iniciar sesión aquí' },
  'strip.continueHere': { en: 'Continue here', es: 'Continuar aquí' },
  'strip.counter': { en: 'Rental counter', es: 'Mostrador de alquiler' },
  'strip.oneEvent': { en: '{price} · one event', es: '{price} · un evento' },
  'strip.counterNudge': { en: 'Make an account for a $1,000 daily allowance', es: 'Crea una cuenta para recibir $1,000 al día' },
  'strip.noMoney': { en: 'Not enough money', es: 'No te alcanza el dinero' },
  'strip.hasRental': { en: 'You already have a rental', es: 'Ya tienes un auto alquilado' },
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
