import { create } from 'zustand';
import { io, Socket } from 'socket.io-client';
import { GameState, ChatMessage } from './types.js';
import { carState, freshStrip, okey, withV, type PartValue, type StripRecord } from './world/data';
import type { Tune } from './world/physics';
import { useDriveUi, type EventReward } from './world/driveUi';
import type { Identity } from './world/accounts';
import { isRental } from './world/rental';
import type { Tab } from './bay/slots';
import { isWorkOrder, type Door, type OrderLine, type WorkOrder } from './bay/order';
import { routeFromLocation, withRace } from './route';
import type { DenyWhy, RoomView } from './world/race';
import { dropRemotes, syncClock, takePose } from './world/raceNet';

// How a visitor joins: as a Strip guest, with a saved session token, or the original dealer/shop setup.
export type ConnectOpts =
  | { mode: 'guest'; name: string; testerKey?: string } // testerKey: what the owner typed after their name ("Name#key")
  | { mode: 'session'; session: string }
  | { mode: 'dealer'; name: string; lotScale: 'Small' | 'Medium' | 'Large'; careerFocus?: 'dealership' | 'standalone'; shopSpecialty?: 'mechanic' | 'body' | 'dual' };
export type AccountView = { id: string; identity: Identity; allowanceToday: boolean };
export type Caps = { google: boolean; googleClientId: string | null; magic: boolean };
export const NO_CAPS: Caps = { google: false, googleClientId: null, magic: false };
/** Whether an init is for another account than the one the store had (by id; no account on both sides is the same). */
export const accountChanged = (before?: { id?: string } | null, after?: { id?: string } | null): boolean => (before?.id ?? null) !== (after?.id ?? null);
export type LinkPayload = { google?: string; magic?: string; confirmReplace?: boolean; target?: 'requester' | 'here' };

// The signed-in session token lives in localStorage; every access is in a try/catch (blocked storage = guest only).
export const SESSION_KEY = 'micar.session';
const readSession = (): string | null => { try { return localStorage.getItem(SESSION_KEY); } catch { return null; } };
const writeSession = (v: string | null) => { try { if (v === null) localStorage.removeItem(SESSION_KEY); else localStorage.setItem(SESSION_KEY, v); } catch { /* storage blocked: this page only */ } };
export const loadSession = readSession;

// A tester key the server accepted is kept on this device with the name it was typed after, so that name gets in again
// without retyping it. Kept when the server takes it and dropped when the server calls it wrong (never before the
// answer); every access is in a try/catch.
export const TESTER_STORE = 'micar.tester';
const readTester = (): { name: string; key: string } | null => {
  try { const j = JSON.parse(localStorage.getItem(TESTER_STORE) || 'null'); return j && typeof j.name === 'string' && typeof j.key === 'string' && j.key ? { name: j.name, key: j.key } : null; } catch { return null; }
};
const writeTester = (v: { name: string; key: string } | null) => { try { if (v) localStorage.setItem(TESTER_STORE, JSON.stringify(v)); else localStorage.removeItem(TESTER_STORE); } catch { /* storage blocked: this page only */ } };
/** The saved tester key for this name on this device, if there is one (names compare without case). */
export const testerKeyFor = (name: string): string | undefined => { const t = readTester(); return t && t.name.toLowerCase() === name.trim().toLowerCase() ? t.key : undefined; };
export const forgetTester = () => writeTester(null);

/** Where the server answers plain requests: this origin, or port 3000 when the page runs under the Vite dev server. */
export const apiBase = (): string => {
  const isDev = ['5173', '5174', '5175', '5176', '5177', '5178', '5179'].includes(window.location.port);
  return isDev ? `http://${window.location.hostname}:3000` : '';
};


interface StoreState {
  socket: Socket | null;
  gameState: GameState | null;
  playerId: string | null;
  timeOfDay: number;
  chatMessages: ChatMessage[];
  unreadChat: number;
  sendChat: (text: string) => void;
  markChatRead: () => void;
  connect: (opts: ConnectOpts) => void;
  // Accounts and rentals (the Strip): what the server said in init / account_linked
  caps: Caps;
  holdCard: boolean;                      // keep the Strip entry card up after joining (an email link is on its way)
  setHoldCard: (v: boolean) => void;
  loadCaps: () => Promise<void>;
  account: AccountView | null;
  linkPrompt: { money: number } | null;   // the saved run a link would replace (Task 5 draws the confirm)
  pendingLink: LinkPayload | null;        // the payload to resend with confirmReplace: true
  linkSent: boolean;
  connectFailed: boolean;
  /** why the server refused the join from the Strip's entry card (a tester key it did not take); cleared by the next join */
  joinRefused: string | null;
  rentCar: (key: string) => void;
  /** tester mode: take a car from the test list (it replaces the one held), or give the held one back */
  takeTestCar: (make: string, model: string) => void;
  returnTestCar: () => void;
  requestLink: (email: string) => void;
  linkAccount: (payload: LinkPayload) => void;
  claimAllowance: () => void;
  signOut: () => void;
  /** A magic link opened in this tab signed in the game tab that asked for it (account_linked_elsewhere). */
  linkedElsewhere: { session: string | null } | null;
  /** "Continue here": rejoin this tab's socket on the session (the server then supersedes the game tab). */
  continueHere: () => void;
  /** A magic link opened here was asked for by another game tab (link_choice): this tab picks where it signs in. */
  linkChoice: { email: string } | null;
  chooseLinkTarget: (target: 'requester' | 'here') => void;
  disconnect: () => void;
  buyCar: (id: string, useFinancing: boolean) => void;
  buyPsi: (carId: string) => void;
  proposeDeal: (agentId: string, carId: string) => void;
  counterOffer: (agentId: string, newTotalValue: number) => void;
  rejectDeal: (agentId: string) => void;
  finalizeDeal: (carId: string, agentId: string, tradeIn?: any) => void;
  repairCar: (id: string, shopType: 'body' | 'mechanic') => void;
  washCar: (id: string) => void;
  placeOnLot: (id: string) => void;
  requestInspection: (id: string) => void;
  preInspect: (id: string) => void;
  finalInspect: (id: string) => void;
  registerVehicle: (id: string) => void;
  buyPart: (partName: string) => void;
  scrapCar: (carId: string) => void;
  buyScrapCar: (carId: string) => void;
  orderRepo: (id: string) => void;
  setMarketingTier: (tier: 'Craigslist' | 'MetaAds' | 'Autotrader') => void;
  upgradeLot: () => void;
  endDay: () => void;
  toggleEmployee: (role: 'mechanic' | 'salesperson' | 'financeManager') => void;
  drivingCarId: string | null;
  setDrivingCarId: (id: string | null) => void;

  // Fuel
  myWorldPos: { x: number; z: number } | null; // the local player's live world position, for a GPS that follows instantly
  // Other players' live positions, relayed by the server ~10x/sec (kept out of
  // gameState so the whole UI doesn't re-render on every movement packet).
  /** live positions; a player in the Strip is at the gate spot (district 'strip') with their Strip pose in stripPosition */
  playerPositions: Record<string, { x: number; y?: number; z: number; rotation?: number; district?: 'town' | 'strip'; stripPosition?: { x: number; y?: number; z: number; rotation?: number } }>;
  // 3D graphics level: 'low' turns off shadows and renders at 1x resolution.
  graphicsQuality: 'high' | 'low';
  setGraphicsQuality: (q: 'high' | 'low') => void;
  // The phone menu is open over the 3D view: on Low the world is then drawn
  // only ~10x a second while nothing moves the camera (VanillaThreeScene).
  menuCoversWorld: boolean;
  setMenuCoversWorld: (v: boolean) => void;
  setMyWorldPos: (p: { x: number; z: number }) => void;
  drivingFuel: number | null; // live tank level of the car being driven (0-100), for the HUD gauge
  setDrivingFuel: (fuel: number | null) => void;
  drivingSpeed: number; // live speed of the car being driven, mph (updated with the fuel gauge, 5x/s)
  consumeFuel: (carId: string, fuel: number) => void;
  refuel: (carId: string, delivery?: boolean) => void;

  // A short notice over the driving HUD (e.g. a refuel the bank refused)
  driveNotice: string | null;
  clearDriveNotice: () => void;
  activeInspectionCarId: string | null;
  activeInspectionShopType: 'mechanic' | 'body' | null;
  openInspectionModal: (carId: string, shopType: 'mechanic' | 'body') => void;
  closeInspectionModal: () => void;
  performSpecificRepair: (carId: string, repairId: string) => void;
  
  isBankModalOpen: boolean;
  openBankModal: () => void;
  closeBankModal: () => void;
  isInsuranceModalOpen: boolean;
  openInsuranceModal: () => void;
  closeInsuranceModal: () => void;
  payFloorPlan: (amount: number) => void;
  takeTitleLoan: (carId: string) => void;
  activeInteraction: { type: 'bank' | 'auction' | 'car' | 'library' | 'insurance'; label: string; carId?: string } | null;
  setActiveInteraction: (interaction: { type: 'bank' | 'auction' | 'car' | 'library' | 'insurance'; label: string; carId?: string } | null) => void;

  gatePrompt: boolean; // true when the player is outside their locked gate and must enter the code
  setGatePrompt: (visible: boolean) => void;

  buyShares: (vehicleId: string, quantity: number) => void;
  sellShares: (vehicleId: string, quantity: number) => void;
  listShares: (vehicleId: string, quantity: number, price: number) => void;
  cancelListing: (vehicleId: string, orderId: string) => void;
  fractionalizeCar: (carId: string, shares: number) => void;
  liquidateVehicle: (vehicleId: string) => void;
  buyInsurance: (type: 'liability' | 'inventory' | 'gap') => void;
  cancelInsurance: (type: 'liability' | 'inventory' | 'gap') => void;

  // The Strip / the Garage (Night Tuner). strip and octane mirror gameState.players[me] when the
  // server sends them; until then they live here (freshStrip / 0).
  strip: StripRecord | null;
  octane: number;
  setStrip: (rec: StripRecord) => void;
  garageCarId: string | null;       // the Garage overlay is open on this inventory car
  openGarage: (carId: string, tab?: Tab) => void;
  bayTab: Tab;                      // the tab the bay screen is on
  orderPending: boolean;            // a bay_order is out and unanswered
  lastOrder: WorkOrder | null;      // the server's last bay_result
  placeOrder: (carId: string, door: Door, lines: OrderLine[], quote: number) => void;
  clearLastOrder: () => void;
  closeGarage: () => void;
  // buyPart is taken by the parts counter (partName), so the Garage's actions carry "Strip".
  /** Pay for a Night Tuner part, own it and fit it (optimistic; emits strip_buy_part). */
  buyStripPart: (carId: string, key: string, v: PartValue, price: number) => void;
  /** Fit an owned part (optimistic; emits strip_equip). */
  equipStripPart: (carId: string, key: string, v: PartValue) => void;
  /** Save the dyno tune (optimistic; emits strip_tune). */
  setStripTune: (carId: string, tune: Tune) => void;

  // A challenge race (world/race.ts): the room this page is in, as the server last sent it.
  race: RoomView | null;
  /** the room this page means to be in (from a link, or made here): joined again after every reconnect, and shown in the address */
  raceCode: string | null;
  /** the server's last refusal, until the next thing asked of the room */
  raceDenied: DenyWhy | null;
  /** 'missed': a race went without this page (it was still loading at the start) */
  raceNote: 'missed' | null;
  createRace: (eventId: string, car: string) => void;
  joinRace: (code: string) => void;
  setRace: (eventId: string, car: string) => void;
  startRace: () => void;
  leaveRace: () => void;
}

const cloneJ = <T,>(o: T): T => JSON.parse(JSON.stringify(o)) as T;
/** The strip record with `carId`'s state changed by `f` (a copy: the store's old record is left alone). */
function editStripCar(rec: StripRecord | null, carId: string, f: (c: StripRecord['cars'][string]) => void): StripRecord {
  const next = cloneJ(rec ?? freshStrip());
  f(carState(next, carId));
  return next;
}
/** strip / octane from the local player in a server state, when it carries them. */
function mirrorStrip(state: GameState | null | undefined, id: string | null): Partial<Pick<StoreState, 'strip' | 'octane'>> {
  const p = state && id ? (state.players[id] as unknown as { strip?: StripRecord; octane?: number } | undefined) : undefined;
  const out: Partial<Pick<StoreState, 'strip' | 'octane'>> = {};
  if (p?.strip) out.strip = p.strip;
  if (typeof p?.octane === 'number') out.octane = p.octane;
  return out;
}

// Saved graphics choice, or a sensible default: low on phones/tablets.
function loadGraphicsQuality(): 'high' | 'low' {
  try {
    const saved = localStorage.getItem('cds.graphics');
    if (saved === 'high' || saved === 'low') return saved;
  } catch { /* storage blocked */ }
  const touchOnly = typeof window !== 'undefined' && window.matchMedia?.('(pointer: coarse)').matches;
  return touchOnly ? 'low' : 'high';
}

// Low graphics also drops the HUD's frosted-glass blur and endless pulse
// animations (html.gfx-low in index.css): over the 3D view the browser has to
// re-blur whatever is behind each blurred panel on every frame, because the
// world under it changes every frame — a big cost on phones.
function reflectGraphicsQuality(q: 'high' | 'low') {
  if (typeof document !== 'undefined') document.documentElement.classList.toggle('gfx-low', q === 'low');
}
const initialGraphicsQuality = loadGraphicsQuality();
reflectGraphicsQuality(initialGraphicsQuality);

/** The page's address follows its room (?race=CODE), on /strip only: a reload comes back to the room. */
function showRace(code: string | null): void {
  try {
    if (typeof window === 'undefined' || routeFromLocation(window.location).view !== 'strip') return;
    const next = withRace(window.location.href, code);
    if (next !== window.location.href) window.history.replaceState(null, '', next);
  } catch { /* sandboxed: the room is still joined, a reload just forgets it */ }
}
/** Out of the room, for this page: nothing of it is kept. */
function forgetRace(): void {
  useGameStore.setState({ race: null, raceCode: null, raceDenied: null, raceNote: null });
  dropRemotes();
  showRace(null);
}

/** What the store does with a challenge room's messages. `connect` registers these on the socket, and calls onInit
 *  whenever the server has (re)made this socket's player: the server then knows the socket from nothing, room included. */
export function raceHandlers(socket: { emit(ev: string, ...args: unknown[]): unknown }) {
  return {
    race_room(view: RoomView): void {
      if (!view || typeof view !== 'object' || typeof view.code !== 'string' || !Array.isArray(view.members)) return;
      const st = useGameStore.getState(), prev = st.race && st.race.code === view.code ? st.race : null, me = st.playerId;
      const was = prev?.members.find(m => m.id === me)?.state, now = view.members.find(m => m.id === me)?.state;
      let raceNote = st.raceNote;
      if (view.phase === 'loading') raceNote = null;
      else if (prev && was === 'loading' && now === 'waiting' && view.phase === 'racing' && prev.raceNo === view.raceNo) raceNote = 'missed';
      // the green light is named on the server's clock: measure ours against it on coming in, and again at each start
      if (!prev || (view.phase === 'loading' && prev.phase !== 'loading')) syncClock(socket);
      if (!prev || prev.raceNo !== view.raceNo) dropRemotes(); // another race: the other racers' old poses mean nothing
      useGameStore.setState({ race: view, raceCode: view.code, raceDenied: null, raceNote });
      showRace(view.code);
    },
    race_denied(d: { why?: DenyWhy } | null | undefined): void {
      const why: DenyWhy = d && typeof d.why === 'string' ? d.why : 'state';
      if (why === 'gone' || why === 'full') forgetRace(); // there is no room to be in
      useGameStore.setState({ raceDenied: why });
    },
    race_pose(msg: unknown): void { takePose(msg); },
    onInit(): void {
      const code = useGameStore.getState().raceCode;
      useGameStore.setState({ race: null, raceNote: null });
      dropRemotes();
      if (code) socket.emit('race_join', { code });
    },
  };
}

/** How long a pending bay order waits for the server before the bay lets go of it. */
export const ORDER_TIMEOUT_MS = 10_000;
let orderTimer: ReturnType<typeof setTimeout> | null = null;

export const useGameStore = create<StoreState>((set, get) => ({
  socket: null,
  gameState: null,
  playerId: null,
  caps: NO_CAPS,
  holdCard: false,
  setHoldCard: (v) => set({ holdCard: v }),
  loadCaps: async () => {
    try {
      const r = await fetch(`${apiBase()}/api/caps`);
      if (r.ok) { const c = await r.json(); set({ caps: { google: !!c.google, googleClientId: typeof c.googleClientId === 'string' ? c.googleClientId : null, magic: !!c.magic } }); }
    } catch { /* offline or no endpoint: guest only */ }
  },
  account: null,
  linkPrompt: null,
  pendingLink: null,
  linkSent: false,
  connectFailed: false,
  joinRefused: null,
  linkedElsewhere: null,
  linkChoice: null,
  timeOfDay: 8.0,
  chatMessages: [],
  unreadChat: 0,
  sendChat: (text) => {
      const socket = get().socket;
      const t = (text || '').trim();
      if (socket && t) socket.emit('chat_message', { text: t });
  },
  markChatRead: () => { if (get().unreadChat !== 0) set({ unreadChat: 0 }); },
  drivingCarId: null,
  setDrivingCarId: (id) => set({ drivingCarId: id }),

  myWorldPos: null,
  setMyWorldPos: (p) => set({ myWorldPos: p }),
  playerPositions: {},
  graphicsQuality: initialGraphicsQuality,
  setGraphicsQuality: (q) => {
    try { localStorage.setItem('cds.graphics', q); } catch { /* storage blocked */ }
    reflectGraphicsQuality(q);
    set({ graphicsQuality: q });
  },
  menuCoversWorld: false,
  setMenuCoversWorld: (v) => { if (get().menuCoversWorld !== v) set({ menuCoversWorld: v }); },
  drivingFuel: null,
  setDrivingFuel: (fuel) => set({ drivingFuel: fuel }),
  drivingSpeed: 0,
  consumeFuel: (carId, fuel) => {
    const s = get().socket; if (s) s.emit('consume_fuel', { carId, fuel });
    // The server stores it without sending a state update, so keep our copy of the tank in step
    // (in place: nothing on screen shows it, so there is nothing to re-render). A stale copy made
    // the 3D view take burnt fuel for a refuel and refill the tank on getting back in.
    const st = get(); const car = st.gameState?.players[st.playerId || '']?.inventory.find(c => c.id === carId);
    if (car) car.fuel = fuel;
  },
  refuel: (carId, delivery) => { const s = get().socket; if (s) s.emit('refuel', { carId, delivery: !!delivery }); },

  driveNotice: null,
  clearDriveNotice: () => set({ driveNotice: null }),
  activeInspectionCarId: null,
  activeInspectionShopType: null,
  openInspectionModal: (carId, shopType) => set({ activeInspectionCarId: carId, activeInspectionShopType: shopType }),
  closeInspectionModal: () => set({ activeInspectionCarId: null, activeInspectionShopType: null }),
  performSpecificRepair: (carId, repairId) => {
      const socket = get().socket;
      if (socket) socket.emit('perform_specific_repair', { carId, repairId });
  },
  
  isBankModalOpen: false,
  openBankModal: () => set({ isBankModalOpen: true }),
  closeBankModal: () => set({ isBankModalOpen: false }),
  isInsuranceModalOpen: false,
  openInsuranceModal: () => set({ isInsuranceModalOpen: true }),
  closeInsuranceModal: () => set({ isInsuranceModalOpen: false }),
  payFloorPlan: (amount) => {
      const socket = get().socket;
      if (socket) socket.emit('pay_floor_plan', { amount });
  },
  takeTitleLoan: (carId) => {
      const socket = get().socket;
      if (socket) socket.emit('take_title_loan', { carId });
  },
  activeInteraction: null,
  setActiveInteraction: (interaction) => set({ activeInteraction: interaction }),
  gatePrompt: false,
  setGatePrompt: (visible) => { if (get().gatePrompt !== visible) set({ gatePrompt: visible }); },
  buyShares: (vehicleId, quantity) => {
      const socket = get().socket;
      if (socket) socket.emit('buy_shares', { vehicleId, quantity });
  },
  sellShares: (vehicleId, quantity) => {
      const socket = get().socket;
      if (socket) socket.emit('sell_shares', { vehicleId, quantity });
  },
  listShares: (vehicleId, quantity, price) => {
      const socket = get().socket;
      if (socket) socket.emit('list_shares', { vehicleId, quantity, price });
  },
  cancelListing: (vehicleId, orderId) => {
      const socket = get().socket;
      if (socket) socket.emit('cancel_listing', { vehicleId, orderId });
  },
  fractionalizeCar: (carId, shares) => {
      const socket = get().socket;
      if (socket) socket.emit('fractionalize_car', { carId, shares });
  },
  liquidateVehicle: (vehicleId) => {
      const socket = get().socket;
      if (socket) socket.emit('liquidate_vehicle', { vehicleId });
  },
  buyInsurance: (type) => {
      const socket = get().socket;
      if (socket) socket.emit('buy_insurance', { type });
  },
  cancelInsurance: (type) => {
      const socket = get().socket;
      if (socket) socket.emit('cancel_insurance', { type });
  },
  race: null,
  raceCode: null,
  raceDenied: null,
  raceNote: null,
  createRace: (eventId, car) => { set({ raceDenied: null }); get().socket?.emit('race_create', { eventId, car }); },
  // before the player is in (a link just opened) this only remembers the room: the 'init' that follows joins it
  joinRace: (code) => { set({ raceCode: code, raceDenied: null }); const s = get(); if (s.socket && s.playerId) s.socket.emit('race_join', { code }); },
  setRace: (eventId, car) => { set({ raceDenied: null }); get().socket?.emit('race_set', { eventId, car }); },
  startRace: () => { set({ raceDenied: null }); get().socket?.emit('race_start'); },
  leaveRace: () => { get().socket?.emit('race_leave'); forgetRace(); },
  strip: null,
  octane: 0,
  setStrip: (rec) => set({ strip: rec }),
  garageCarId: null,
  bayTab: 'custom',
  orderPending: false,
  lastOrder: null,
  // the server changes the money and the build; this only sends, once at a time
  placeOrder: (carId, door, lines, quote) => {
      const s = get(); if (!s.socket || s.orderPending) return;
      s.socket.emit('bay_order', { carId, door, lines, quote });
      set({ orderPending: true });
      // a reply that never comes must not leave ordering stuck; a new order replaces the old timer
      if (orderTimer) clearTimeout(orderTimer);
      orderTimer = setTimeout(() => { orderTimer = null; set({ orderPending: false }); }, ORDER_TIMEOUT_MS);
  },
  clearLastOrder: () => set({ lastOrder: null }),
  openGarage: (carId, tab) => {
      // a rental is stock for one event: the Garage never opens on it
      const s = get(), car = s.playerId ? s.gameState?.players[s.playerId]?.inventory.find(c => c.id === carId) : undefined;
      if (isRental(car)) return;
      set({ garageCarId: carId, bayTab: tab ?? 'custom', strip: s.strip ?? freshStrip() });
  },
  closeGarage: () => set({ garageCarId: null }),
  buyStripPart: (carId, key, v, price) => {
      const me0 = get().playerId ? get().gameState?.players[get().playerId!] : undefined;
      if (!me0 || me0.money < price) return; // can't afford it: no emit, nothing changes
      const s = get().socket; if (s) s.emit('strip_buy_part', { carId, key, v, price });
      const st = get(), id = st.playerId, gs = st.gameState, me = gs && id ? gs.players[id] : undefined;
      const strip = editStripCar(st.strip, carId, c => { const o = okey(key, v); if (!c.owned.includes(o)) c.owned.push(o); c.cfg = withV(c.cfg, key, v); });
      if (gs && id && me) set({ strip, gameState: { ...gs, players: { ...gs.players, [id]: { ...me, money: me.money - price } } } });
      else set({ strip });
  },
  equipStripPart: (carId, key, v) => {
      const s = get().socket; if (s) s.emit('strip_equip', { carId, key, v });
      set(st => ({ strip: editStripCar(st.strip, carId, c => { c.cfg = withV(c.cfg, key, v); }) }));
  },
  setStripTune: (carId, tune) => {
      const s = get().socket; if (s) s.emit('strip_tune', { carId, tune });
      set(st => ({ strip: editStripCar(st.strip, carId, c => { c.tune = cloneJ(tune); }) }));
  },
  disconnect: () => {
    const socket = get().socket;
    if (socket) socket.disconnect();
    set({ socket: null, gameState: null, playerId: null, account: null, linkPrompt: null, pendingLink: null, linkSent: false, holdCard: false, linkedElsewhere: null, linkChoice: null, joinRefused: null, drivingCarId: null, chatMessages: [], unreadChat: 0, playerPositions: {},
      // Per-session prompts and modal state: left set, they reappear in the next
      // session (the gate keypad at spawn).
      myWorldPos: null, drivingFuel: null, drivingSpeed: 0, gatePrompt: false, activeInteraction: null, driveNotice: null,
      activeInspectionCarId: null, activeInspectionShopType: null, isBankModalOpen: false, isInsuranceModalOpen: false,
      strip: null, octane: 0, garageCarId: null, bayTab: 'custom', orderPending: false, lastOrder: null });
    forgetRace();
  },
  connect: (opts) => {
    const isDev = ['5173', '5174', '5175', '5176', '5177', '5178', '5179'].includes(window.location.port);
    const socketUrl = isDev ? `http://${window.location.hostname}:3000` : window.location.origin;
    const socket = io(socketUrl);
    const race = raceHandlers(socket);
    set({ joinRefused: null });

    // A linked player who reconnects rejoins on the saved session, not as the guest the socket first joined as.
    let viaSession = opts.mode === 'session', joins = 0;
    // the tester key this connection joins with; dropped for good once the server has refused it
    let testerKey = opts.mode === 'guest' ? opts.testerKey : undefined;
    const emitJoin = () => {
        const saved = joins++ > 0 && get().account ? readSession() : null;
        viaSession = !!saved || opts.mode === 'session';
        if (saved) socket.emit('join', { mode: 'session', session: saved });
        else if (opts.mode === 'guest') socket.emit('join', { mode: 'guest', name: opts.name, ...(testerKey ? { testerKey } : {}) });
        else if (opts.mode === 'session') socket.emit('join', { session: opts.session });
        else {
            const { name, lotScale, careerFocus, shopSpecialty } = opts;
            console.log('CLIENT EMITTING JOIN:', { name, lotScale, careerFocus, shopSpecialty });
            socket.emit('join', { name, lotScale, careerFocus, shopSpecialty });
        }
    };

    if (socket.connected) {
        emitJoin();
    } else {
        socket.on('connect', emitJoin);
    }
    
    socket.on('init', (data) => {
        // A session join that comes back without an account means the server fell back to a guest: the token is dead
        if (viaSession && !data.account) writeSession(null);
        // a tester key is kept with its name only once the server has taken it
        if (opts.mode === 'guest' && testerKey && !viaSession && data.state?.players?.[data.id]?.tester) writeTester({ name: opts.name, key: testerKey });
        // sign_out answers with a fresh guest init: the old token is spent
        // another account's bay state never carries over, even from a bay_result that arrived after a sign-out; a reconnect keeps it
        if (accountChanged(get().account, data.account)) set({ bayTab: 'custom', orderPending: false, lastOrder: null });
        set({ caps: data.caps ? { ...NO_CAPS, ...data.caps } : get().caps, account: data.account || null, linkPrompt: null, pendingLink: null });
        set({ gameState: data.state, playerId: data.id, timeOfDay: data.state.timeOfDay, chatMessages: data.state.chatLog || [], unreadChat: 0, ...mirrorStrip(data.state, data.id) });
        race.onInit(); // the server made this socket's player anew: back into the challenge room this page was in, if any
    });
    socket.on('race_room', race.race_room);
    socket.on('race_denied', race.race_denied);
    socket.on('race_pose', race.race_pose);
    // The server did not take the tester key, so it did not join us. A key it calls wrong is no longer worth keeping.
    // From the entry card: stop, and let the card say why (its button then joins as an ordinary guest). After a dropped
    // connection, with the world already up: carry on as an ordinary guest, and say why in the world.
    socket.on('join_refused', (d: { why?: string; reason?: string }) => {
        const reason = typeof d?.reason === 'string' && d.reason ? d.reason : 'The Strip refused that.';
        if (d?.why === 'wrong' && testerKey && readTester()?.key === testerKey) writeTester(null);
        testerKey = undefined;
        if (get().playerId) { set({ driveNotice: reason }); emitJoin(); return; }
        socket.disconnect();
        if (get().socket === socket) set({ socket: null });
        set({ joinRefused: reason });
    });
    socket.on('account_linked', (d: { account: AccountView; session?: string }) => {
        if (typeof d?.session === 'string') writeSession(d.session);
        // signed in (maybe by a link opened in another tab): the entry card, if held for the email, gives way to the world
        set({ account: d.account, linkPrompt: null, pendingLink: null, holdCard: false, linkSent: false, linkChoice: null });
    });
    // the prompt shows in the world (the entry card gives way); a link clicked in another tab comes with its token, for Confirm
    socket.on('account_replace_prompt', (d: { money: number; magic?: string }) => set({ linkPrompt: { money: d?.money ?? 0 }, driveNotice: null, holdCard: false,
        ...(typeof d?.magic === 'string' ? { pendingLink: { magic: d.magic } } : {}) }));
    socket.on('account_linked_elsewhere', (d: { session?: string | null }) => set({ linkedElsewhere: { session: typeof d?.session === 'string' ? d.session : null }, holdCard: true, linkPrompt: null, pendingLink: null, linkChoice: null }));
    // the link is held (pendingLink) until this tab picks: "Sign in that tab" or "Sign in here"
    socket.on('link_choice', (d: { email?: string }) => set({ linkChoice: { email: typeof d?.email === 'string' ? d.email : '' }, holdCard: true, driveNotice: null }));
    socket.on('link_sent', () => set({ linkSent: true }));
    socket.on('update', (state) => set({ gameState: state, timeOfDay: state.timeOfDay, ...mirrorStrip(state, get().playerId) }));
    socket.on('player_positions', (positions) => set({ playerPositions: positions || {} }));
    socket.on('time_update', (timeOfDay) => set({ timeOfDay }));
    socket.on('refuel_denied', () => set({ driveNotice: 'Not enough cash to refuel.' }));
    socket.on('strip_denied', (d: { reason?: string }) => set({ driveNotice: d?.reason || 'The Strip refused that.', orderPending: false }));
    socket.on('bay_result', (d: { order?: unknown }) => set(isWorkOrder(d?.order) ? { lastOrder: d.order, orderPending: false } : { orderPending: false }));
    // The server's answer to finish_event / finish_outrun (Task 11): what the run paid
    socket.on('event_result', (r: EventReward) => useDriveUi.setState({ reward: { cash: r?.cash ?? 0, octane: r?.octane ?? 0, rep: r?.rep ?? 0, stamps: r?.stamps ?? [] } }));
    socket.on('chat', (msg: ChatMessage) => set((s) => {
        const next = [...s.chatMessages, msg];
        if (next.length > 60) next.shift();
        // don't badge the sender for their own message
        const mine = msg.playerId && msg.playerId === get().playerId;
        return { chatMessages: next, unreadChat: mine ? s.unreadChat : s.unreadChat + 1 };
    }));
    socket.on('connect_error', () => set({ connectFailed: true }));
    socket.on('connect', () => set({ connectFailed: false, orderPending: false }));
    set({ socket });
  },
  rentCar: (key) => { const s = get().socket; if (s) s.emit('rent_car', { key }); },
  takeTestCar: (make, model) => { const s = get().socket; if (s) s.emit('test_car', { make, model }); },
  returnTestCar: () => { const s = get().socket; if (s) s.emit('test_car_return'); },
  requestLink: (email) => { const s = get().socket; if (s) s.emit('request_link', { email }); set({ linkSent: false }); },
  linkAccount: (payload) => {
      const s = get().socket; if (!s) return;
      // kept so the confirm prompt can resend it with confirmReplace: true
      set({ pendingLink: payload });
      s.emit('link_account', payload);
  },
  claimAllowance: () => { const s = get().socket; if (s) s.emit('claim_allowance', {}); },
  chooseLinkTarget: (target) => {
      const { pendingLink, linkAccount } = get();
      set({ linkChoice: null });
      if (pendingLink?.magic) linkAccount({ magic: pendingLink.magic, target });
  },
  continueHere: () => {
      const s = get().socket;
      const session = get().linkedElsewhere?.session ?? readSession();
      set({ linkedElsewhere: null, holdCard: false });
      if (!s || !session) return; // nothing to sign in with: carry on as this tab's guest
      writeSession(session);
      s.emit('join', { mode: 'session', session });
  },
  signOut: () => {
      set({ bayTab: 'custom', orderPending: false, lastOrder: null });
      const s = get().socket; if (!s) return;
      writeSession(null);
      s.emit('sign_out', {});
  },
  buyCar: (id, useFinancing) => {
      const socket = get().socket;
      if(socket) socket.emit('buy_car', { carId: id, useFinancing });
  },
  buyPsi: (carId) => {
      const socket = get().socket;
      if(socket) socket.emit('buy_psi', carId);
  },
  proposeDeal: (agentId, carId) => {
      const socket = get().socket;
      if(socket) socket.emit('propose_deal', { agentId, carId });
  },
  counterOffer: (agentId, newTotalValue) => {
      const socket = get().socket;
      if(socket) socket.emit('counter_offer', { agentId, newTotalValue });
  },
  rejectDeal: (agentId) => {
      const socket = get().socket;
      if(socket) socket.emit('reject_deal', { agentId });
  },
  finalizeDeal: (carId, agentId, tradeIn) => {
      const socket = get().socket;
      if(socket) socket.emit('finalize_deal', { carId, agentId, tradeIn });
  },
  washCar: (id) => {
      const socket = get().socket;
      if(socket) socket.emit('wash_car', id);
  },
  placeOnLot: (id) => {
      const socket = get().socket;
      if(socket) socket.emit('place_on_lot', id);
  },
  repairCar: (id, shopType) => {
      // Deprecated in favor of performSpecificRepair UI flow
      const socket = get().socket;
      if(socket) socket.emit('repair_car', { carId: id, shopType });
  },
  requestInspection: (id) => {
      const socket = get().socket;
      if(socket) socket.emit('request_inspection', { carId: id });
  },
  preInspect: (id) => {
      const socket = get().socket;
      if(socket) socket.emit('pre_inspect', { carId: id });
  },
  finalInspect: (id) => {
      const socket = get().socket;
      if(socket) socket.emit('final_inspect', { carId: id });
  },
  registerVehicle: (id) => {
      const socket = get().socket;
      if(socket) socket.emit('register_vehicle', id);
  },
  buyPart: (partName) => {
      const socket = get().socket;
      if(socket) socket.emit('buy_part', { partName });
  },
  scrapCar: (id) => {
      const socket = get().socket;
      if(socket) socket.emit('scrap_car', id);
  },
  buyScrapCar: (id) => {
      const socket = get().socket;
      if(socket) socket.emit('buy_scrap_car', id);
  },
  orderRepo: (id) => {
      const socket = get().socket;
      if(socket) socket.emit('order_repo', { contractId: id });
  },
  setMarketingTier: (tier) => {
      const socket = get().socket;
      if(socket) socket.emit('set_marketing_tier', { tier });
  },
  upgradeLot: () => {
      const socket = get().socket;
      if(socket) socket.emit('upgrade_lot');
  },
  endDay: () => {
      const socket = get().socket;
      if(socket) socket.emit('end_day');
  },
  toggleEmployee: (role) => {
      const socket = get().socket;
      if(socket) socket.emit('toggle_employee', { role });
  }
}));
