import { create } from 'zustand';
import { io, Socket } from 'socket.io-client';
import { GameState, ChatMessage } from './types.js';
import { carState, freshStrip, okey, withV, type PartValue, type StripRecord } from './world/data';
import type { Tune } from './world/physics';
import { useDriveUi, type EventReward } from './world/driveUi';

interface StoreState {
  socket: Socket | null;
  gameState: GameState | null;
  playerId: string | null;
  timeOfDay: number;
  chatMessages: ChatMessage[];
  unreadChat: number;
  sendChat: (text: string) => void;
  markChatRead: () => void;
  connect: (name: string, lotScale: 'Small' | 'Medium' | 'Large', careerFocus?: 'dealership' | 'standalone', shopSpecialty?: 'mechanic' | 'body' | 'dual') => void;
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
  buyPart: (partName: string, cost: number) => void;
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
  openGarage: (carId: string) => void;
  closeGarage: () => void;
  // buyPart is taken by the parts counter (partName, cost), so the Garage's actions carry "Strip".
  /** Pay for a Night Tuner part, own it and fit it (optimistic; emits strip_buy_part). */
  buyStripPart: (carId: string, key: string, v: PartValue, price: number) => void;
  /** Fit an owned part (optimistic; emits strip_equip). */
  equipStripPart: (carId: string, key: string, v: PartValue) => void;
  /** Save the dyno tune (optimistic; emits strip_tune). */
  setStripTune: (carId: string, tune: Tune) => void;
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

export const useGameStore = create<StoreState>((set, get) => ({
  socket: null,
  gameState: null,
  playerId: null,
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
  strip: null,
  octane: 0,
  setStrip: (rec) => set({ strip: rec }),
  garageCarId: null,
  openGarage: (carId) => set(s => ({ garageCarId: carId, strip: s.strip ?? freshStrip() })),
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
    set({ socket: null, gameState: null, playerId: null, drivingCarId: null, chatMessages: [], unreadChat: 0, playerPositions: {},
      // Per-session prompts and modal state: left set, they reappear in the next
      // session (the gate keypad at spawn).
      myWorldPos: null, drivingFuel: null, drivingSpeed: 0, gatePrompt: false, activeInteraction: null, driveNotice: null,
      activeInspectionCarId: null, activeInspectionShopType: null, isBankModalOpen: false, isInsuranceModalOpen: false,
      strip: null, octane: 0, garageCarId: null });
  },
  connect: (name, lotScale, careerFocus, shopSpecialty) => {
    const isDev = ['5173', '5174', '5175', '5176', '5177', '5178', '5179'].includes(window.location.port);
    const socketUrl = isDev ? `http://${window.location.hostname}:3000` : window.location.origin;
    const socket = io(socketUrl);
    
    const emitJoin = () => {
        console.log('CLIENT EMITTING JOIN:', { name, lotScale, careerFocus, shopSpecialty });
        socket.emit('join', { name, lotScale, careerFocus, shopSpecialty });
    };

    if (socket.connected) {
        emitJoin();
    } else {
        socket.on('connect', emitJoin);
    }
    
    socket.on('init', (data) => set({ gameState: data.state, playerId: data.id, timeOfDay: data.state.timeOfDay, chatMessages: data.state.chatLog || [], unreadChat: 0, ...mirrorStrip(data.state, data.id) }));
    socket.on('update', (state) => set({ gameState: state, timeOfDay: state.timeOfDay, ...mirrorStrip(state, get().playerId) }));
    socket.on('player_positions', (positions) => set({ playerPositions: positions || {} }));
    socket.on('time_update', (timeOfDay) => set({ timeOfDay }));
    socket.on('refuel_denied', () => set({ driveNotice: 'Not enough cash to refuel.' }));
    socket.on('strip_denied', (d: { reason?: string }) => set({ driveNotice: d?.reason || 'The Strip refused that.' }));
    // The server's answer to finish_event / finish_outrun (Task 11): what the run paid
    socket.on('event_result', (r: EventReward) => useDriveUi.setState({ reward: { cash: r?.cash ?? 0, octane: r?.octane ?? 0, rep: r?.rep ?? 0, stamps: r?.stamps ?? [] } }));
    socket.on('chat', (msg: ChatMessage) => set((s) => {
        const next = [...s.chatMessages, msg];
        if (next.length > 60) next.shift();
        // don't badge the sender for their own message
        const mine = msg.playerId && msg.playerId === get().playerId;
        return { chatMessages: next, unreadChat: mine ? s.unreadChat : s.unreadChat + 1 };
    }));
    set({ socket });
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
  buyPart: (partName, cost) => {
      const socket = get().socket;
      if(socket) socket.emit('buy_part', { partName, cost });
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
