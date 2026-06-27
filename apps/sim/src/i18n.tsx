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
  window.dispatchEvent(new CustomEvent('cds-langchange'));
};

// Re-renders the calling component whenever the language changes.
export const useLang = (): Lang => {
  const [lang, setL] = useState<Lang>(getLang());
  useEffect(() => {
    const h = () => setL(getLang());
    window.addEventListener('cds-langchange', h);
    return () => window.removeEventListener('cds-langchange', h);
  }, []);
  return lang;
};

type Entry = { en: string; es: string };
const DICT: Record<string, Entry> = {
  // ---- Gateway / landing page ----
  'portal.brand': { en: 'AUTO LOGISTICS PORTAL', es: 'PORTAL DE LOGÍSTICA AUTO' },
  'portal.title': { en: 'Automotive Hub', es: 'Centro Automotriz' },
  'portal.subtitle': { en: 'Select an operational workspace. Experience the premium 3D dealership simulator or deploy our real-world reconditioning logistics dashboard.', es: 'Elige un espacio de trabajo. Disfruta el simulador 3D de concesionario o usa nuestro panel de logística de reacondicionamiento del mundo real.' },
  'portal.footer': { en: 'SYSTEM SECURITY CLASSIFICATION: COMMERCIAL SYSTEM • SECURED VIA INTEGRATED SECURE PROTOCOLS', es: 'CLASIFICACIÓN DE SEGURIDAD: SISTEMA COMERCIAL • PROTEGIDO CON PROTOCOLOS SEGUROS INTEGRADOS' },

  'card.game.badge': { en: 'GAME EXPERIENCE', es: 'EXPERIENCIA DE JUEGO' },
  'card.game.title': { en: 'Dealership 3D Simulator', es: 'Simulador 3D de Concesionario' },
  'card.game.desc': { en: 'Step onto the virtual showroom floor. An immersive 3D environment for buying, bidding, restoring, and selling vehicles with advanced financial forecasting.', es: 'Entra al salón de exhibición virtual. Un entorno 3D inmersivo para comprar, pujar, restaurar y vender vehículos con pronóstico financiero avanzado.' },
  'card.game.f1': { en: 'Real-Time 3D Interactive Lot & Canvas', es: 'Lote 3D Interactivo en Tiempo Real' },
  'card.game.f2': { en: 'Live Bidding Auction Mechanics', es: 'Subastas con Pujas en Vivo' },
  'card.game.f3': { en: 'Interactive CRM & DMV Registration Panels', es: 'Paneles Interactivos de CRM y Registro (DMV)' },
  'card.game.f4': { en: 'Staff Hiring & AI Agent Management', es: 'Contratación de Personal y Agentes con IA' },
  'card.game.cta': { en: 'Launch Simulator 3D', es: 'Iniciar Simulador 3D' },

  'card.shop.badge': { en: 'ENTERPRISE TOOL', es: 'HERRAMIENTA EMPRESARIAL' },
  'card.shop.title': { en: 'AutoFlow Pro Bodyshop Suite', es: 'Suite de Taller AutoFlow Pro' },
  'card.shop.desc': { en: 'A standalone reconditioning operations tracker built for professional garages, detail centers, paint shops, and real-world mechanic operations.', es: 'Un gestor independiente de operaciones de reacondicionamiento para talleres profesionales, centros de detallado, talleres de pintura y operaciones mecánicas reales.' },
  'card.shop.f1': { en: "Domino's-Style Live Repair Status Portal", es: 'Portal de Estado de Reparación en Vivo (estilo Domino’s)' },
  'card.shop.f2': { en: '7-Stage Active Shop Pipeline & Board', es: 'Flujo y Tablero de Taller de 7 Etapas' },
  'card.shop.f3': { en: 'Custom Diagnostics & Technician Notes Logging', es: 'Diagnósticos y Notas de Técnicos Personalizadas' },
  'card.shop.f4': { en: 'Dev Operations Permissions Console Controls', es: 'Consola de Permisos y Operaciones' },
  'card.shop.cta': { en: 'Launch Bodyshop Suite', es: 'Iniciar Suite de Taller' },

  'card.mech.badge': { en: 'DIAGNOSTICS TOOL', es: 'HERRAMIENTA DE DIAGNÓSTICO' },
  'card.mech.title': { en: 'MechFlow Pro Diagnostics', es: 'Diagnóstico MechFlow Pro' },
  'card.mech.desc': { en: 'A standalone mechanical diagnostics and engine overhaul suite built for technical garages, dyno tuners, and electrical diagnostics bays.', es: 'Una suite independiente de diagnóstico mecánico y reparación de motores para talleres técnicos, afinación en dinamómetro y diagnóstico eléctrico.' },
  'card.mech.f1': { en: 'Real-Time OBD-II CAN-Bus Terminal Simulator', es: 'Simulador de Terminal OBD-II / CAN-Bus en Vivo' },
  'card.mech.f2': { en: '4-Bay Mechanical Lift Manager & Steppers', es: 'Gestor de 4 Bahías y Elevadores' },
  'card.mech.f3': { en: 'Interactive Fault Code Library Lookup', es: 'Biblioteca Interactiva de Códigos de Falla' },
  'card.mech.f4': { en: 'Pistons, Turbos & Ignition Spares Auditor', es: 'Auditor de Pistones, Turbos y Encendido' },
  'card.mech.cta': { en: 'Launch Diagnostics Suite', es: 'Iniciar Suite de Diagnóstico' },

  'card.platform.badge': { en: 'PUBLIC PLATFORM', es: 'PLATAFORMA PÚBLICA' },
  'card.platform.title': { en: 'RepairFlow Platform', es: 'Plataforma RepairFlow' },
  'card.platform.desc': { en: 'A public standalone shop simulator & process tracking portal where customers query mechanical repair order metrics and view real-time OBD-II visualizers.', es: 'Un portal público de simulación de taller y seguimiento de procesos donde los clientes consultan métricas de órdenes de reparación y visualizadores OBD-II en vivo.' },
  'card.platform.f1': { en: 'Real-Time CAN-Bus Telemetry & SVGs', es: 'Telemetría CAN-Bus en Tiempo Real' },
  'card.platform.f2': { en: 'Live Capacity Indexes & Wait Queues', es: 'Índices de Capacidad y Colas de Espera en Vivo' },
  'card.platform.f3': { en: 'Interactive Fault Code Lookup Terminal', es: 'Terminal Interactiva de Códigos de Falla' },
  'card.platform.f4': { en: 'Operator Bay Manager & Tech Upgrades', es: 'Gestor de Bahías y Mejoras Técnicas' },
  'card.platform.cta': { en: 'Launch RepairFlow Platform', es: 'Iniciar Plataforma RepairFlow' },

  // ---- Pre-game setup screen ----
  'setup.title': { en: 'Used Car Empire', es: 'Imperio de Autos Usados' },
  'setup.subtitle': { en: 'Initialize corporate simulator', es: 'Inicializa el simulador corporativo' },
  'setup.nameLabel': { en: 'Company Operator Name', es: 'Nombre del Operador' },
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
};

export const t = (lang: Lang, key: string): string => DICT[key]?.[lang] ?? key;

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
