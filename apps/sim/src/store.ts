import { create } from 'zustand';
import { io, Socket } from 'socket.io-client';
import { GameState } from './types.js';

interface StoreState {
  socket: Socket | null;
  gameState: GameState | null;
  playerId: string | null;
  timeOfDay: number;
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
  activeInspectionCarId: string | null;
  activeInspectionShopType: 'mechanic' | 'body' | null;
  openInspectionModal: (carId: string, shopType: 'mechanic' | 'body') => void;
  closeInspectionModal: () => void;
  performSpecificRepair: (carId: string, repairId: string) => void;
  
  isBankModalOpen: boolean;
  openBankModal: () => void;
  closeBankModal: () => void;
  payFloorPlan: (amount: number) => void;
  takeTitleLoan: (carId: string) => void;
  activeInteraction: { type: 'bank' | 'auction' | 'car' | 'library'; label: string; carId?: string } | null;
  setActiveInteraction: (interaction: { type: 'bank' | 'auction' | 'car' | 'library'; label: string; carId?: string } | null) => void;

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
}

export const useGameStore = create<StoreState>((set, get) => ({
  socket: null,
  gameState: null,
  playerId: null,
  timeOfDay: 8.0,
  drivingCarId: null,
  setDrivingCarId: (id) => set({ drivingCarId: id }),
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
  disconnect: () => {
    const socket = get().socket;
    if (socket) socket.disconnect();
    set({ socket: null, gameState: null, playerId: null, drivingCarId: null });
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
    
    socket.on('init', (data) => set({ gameState: data.state, playerId: data.id, timeOfDay: data.state.timeOfDay }));
    socket.on('update', (state) => set({ gameState: state }));
    socket.on('time_update', (timeOfDay) => set({ timeOfDay }));
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
