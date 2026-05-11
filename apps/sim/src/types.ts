export type RepairDef = {
  id: string; // unique instance ID for this specific repair on a specific car
  name: string;
  partName: string;
  type: 'body' | 'mechanic';
  cost: number;
  conditionImpact: number;
};

export type Car = {
  id: string; make: string; model: string; year: number;
  condition: number; bodyCondition: number; mechanicCondition: number; mileage: number; buyPrice: number;
  color: string; ownerId: string | null; daysOnLot: number;
  titleStatus: 'Clean' | 'Rebuilt' | 'Salvage';
  inspectionStatus?: 'None' | 'Pending' | 'Passed';
  inspectionRequestedDay?: number;
  hasOffer?: boolean;
  isDirty?: boolean;
  isProcessed?: boolean; // Farm sim mechanic
  lotPosition?: { x: number, z: number, r: number }; // True physical sandbox persistence
  activeRepairs?: RepairDef[]; // Diagnostic specific defects
  psiRevealed?: boolean; // Mask condition if not paid for PSI
  estimatedMMR?: number; // Pre-calculated baseline determinism
  auctionSeller?: string; // e.g. 'Geico Insurance', 'State Farm', 'Private Seller'
  vin: string; // Realistic 17-char VIN
  isRegistered?: boolean; // True if player has paid DMV to register the vehicle
};

export type FinanceContract = {
  id: string; customerId: string; carId: string; principal: number; 
  interestRate: number; totalYield: number;
  daysRemaining: number; totalDays: number; dailyPayment: number;
  isDelinquent?: boolean;
  repoStatus?: 'None' | 'Pending' | 'Recovered';
  repoRequestedDay?: number;
};

export type CustomerRecord = {
  id: string;
  name: string;
  phone: string;
  dealType: 'cash' | 'bank' | 'inhouse';
  originalCost: number;
  purchasePrice: number;
  carInfo: { year: number; make: string; model: string; vin: string; };
  purchaseDay: number;
};

export type DealProposal = {
  id: string;
  carId: string;
  agentId: string;
  dealType: 'cash' | 'bank' | 'inhouse';
  downPayment: number;
  monthlyPayment: number;
  months: number;
  totalValue: number;
};

export type CustomerAgent = {
  id: string;
  name: string;
  budget: number;
  creditScore: number;
  monthlyIncome: number;
  knowledge: number; // 0 to 100, ability to spot mechanical flaws
  desperation: number; // 0 to 100, urgency to buy
  needs: {
    preferredMake?: string;
    maxMileage: number;
    minCondition: number;
  };
  state: 'browsing' | 'negotiating' | 'left';
  activeProposal?: DealProposal;
  patience: number; // decreases on counter-offers
  carId?: string; // Car they are currently interested in
};

export type EconomicState = {
  federalInterestRate: number; // e.g. 0.05 to 0.12
  usedCarDemand: number; // e.g. 0.8 (low) to 1.2 (high)
};

export type Player = {
  id: string; name: string; money: number;
  inventory: Car[]; lotPosition: { x: number; z: number };
  partsInventory: Record<string, number>; // Maps part name to quantity owned
  lotScale: 'Small' | 'Medium' | 'Large';
  marketingTier: 'Craigslist' | 'MetaAds' | 'Autotrader';
  floorPlanDebt: number; floorPlanRate: number; // Daily interest rate for holding cars
  contracts: FinanceContract[]; // F&I loans generated from selling cars to NPCs
  customers: CustomerRecord[]; // CRM database
  employees: { mechanic: boolean; salesperson: boolean; financeManager: boolean; }; // Dealership Staff
  reputation: number; // 0 to 100, affects walk-in rates

  balanceSheet: { 
      totalIncome: number; totalExpenses: number; 
      lastTickIncome: number; lastTickExpense: number; 
  };
};

export type GameState = {
  day: number; // The global simulation time
  timeOfDay: number; // Float 8.0 to 17.0 for daily clock
  players: Record<string, Player>;
  market: Car[];
  junkyard: Car[];
  economy: EconomicState;
  activeWalkIns: Record<string, CustomerAgent[]>; // maps player ID to their current walk-ins

};
