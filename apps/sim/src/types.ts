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
  preInspected?: boolean; // NC safety pre-inspection (punch list) completed
  safetyPassed?: boolean; // Passed the NC annual Safety + Emissions inspection (required to retail)
  fuel?: number; // 0-100 gas tank level; all driving burns fuel, refill at a gas station
  isRental?: boolean; // a Speedway rental car — drive/race only, can't be sold or kept
  bodyStyle?: string; // sedan | coupe | hatchback | suv | truck | sports | van — drives the 3D silhouette
};

// Race difficulty tiers — each sets the entry fee, lap count, and finish reward.
export type RaceDifficulty = 'beginner' | 'medium' | 'veteran';
export type RaceTier = { entryFee: number; laps: number; reward: number; label: string; cpuSkill: number };
export const RACE_TIERS: Record<RaceDifficulty, RaceTier> = {
  beginner: { entryFee: 500,  laps: 2, reward: 1400,  label: 'Beginner', cpuSkill: 0.72 },
  medium:   { entryFee: 1500, laps: 3, reward: 4200,  label: 'Medium',   cpuSkill: 0.85 },
  veteran:  { entryFee: 4000, laps: 4, reward: 12000, label: 'Veteran',  cpuSkill: 0.97 },
};
export const FUEL_PRICE_PER_UNIT = 9; // $ per gas unit (full tank from empty ≈ $900)

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
  federalInterestRate: number; // the Fed funds policy rate, e.g. 0.05
  usedCarDemand: number;       // 0.8 (low) to 1.2 (high); responds to rates
  inflation?: number;          // annualized inflation, target ~2%
  primeRate?: number;          // = fed funds + 3.00% (derived)
  priceIndex?: number;         // cumulative inflation multiplier on car values (starts 1.0)
  rateHistory?: number[];      // recent fed funds rate points for the trend chart
};

export type Player = {
  id: string; name: string; money: number;
  inventory: Car[]; lotPosition: { x: number; z: number };
  worldPosition?: { x: number; y: number; z: number; rotation: number; };
  partsInventory: Record<string, number>; // Maps part name to quantity owned
  lotScale: 'Small' | 'Medium' | 'Large';
  marketingTier: 'Craigslist' | 'MetaAds' | 'Autotrader';
  floorPlanDebt: number; floorPlanRate: number; // Daily interest rate for holding cars
  contracts: FinanceContract[]; // F&I loans generated from selling cars to NPCs
  customers: CustomerRecord[]; // CRM database
  employees: { mechanic: boolean; salesperson: boolean; financeManager: boolean; }; // Dealership Staff
  reputation: number; // 0 to 100, affects walk-in rates
  gateCode?: string; // Private 4-digit code to open the lot gate from outside
  shareHoldings?: Record<string, { shares: number; invested: number }>; // Fractional vehicle shares owned (vehicleId -> qty + cost basis)
  insurance?: { liability: boolean; inventory: boolean; gap: boolean }; // active dealer policies
  insuranceLog?: string[]; // recent claim / adverse-event messages (newest first, ~6 kept)
  raceWins?: number; // number of races finished/won at the speedway

  balanceSheet: { 
      totalIncome: number; totalExpenses: number; 
      lastTickIncome: number; lastTickExpense: number; 
  };
};

// A resting peer sell order (limit ask) in a vehicle's order book.
export type ShareOrder = { id: string; sellerId: string; price: number; qty: number; basis: number };

// A vehicle fractionalized into an SPV whose shares trade (MyCar Fractional).
export type FractionalVehicle = {
  id: string;
  year: number; make: string; model: string;
  vin: string;
  mileage: number;
  condition?: 'excellent' | 'good' | 'fair';
  issuerId: string;          // 'platform' or a player id (owns the SPV / treasury)
  underlyingValue: number;   // current market value of the car (drives fundamentals)
  totalShares: number;       // total shares the vehicle is split into
  treasuryShares: number;    // unsold shares still held by the issuer
  dailyYield: number;        // total rental income per day, split across all shares
  volatility: number;        // daily underlying-value sigma
  lastPrice: number;         // last traded price per share
  priceHistory: number[];    // recent per-share price points (~30)
  asks: ShareOrder[];        // peer sell listings (order book)
  status: 'trading' | 'liquidated';
};

// A single line in the multiplayer game chat.
export type ChatMessage = {
  id: string;
  playerId: string; // sender socket id; '' for system messages
  name: string;     // sender display name, or 'System'
  text: string;
  ts: number;       // epoch ms
  system?: boolean; // join/leave and other server notices
};

export type GameState = {
  day: number; // The global simulation time
  timeOfDay: number; // Float 8.0 to 17.0 for daily clock
  players: Record<string, Player>;
  market: Car[];
  junkyard: Car[];
  economy: EconomicState;
  activeWalkIns: Record<string, CustomerAgent[]>; // maps player ID to their current walk-ins
  fractionalMarket: FractionalVehicle[]; // vehicles available as fractional shares
  chatLog?: ChatMessage[]; // recent multiplayer chat (last ~50)
  hostId?: string | null; // The player who can advance the day
};
