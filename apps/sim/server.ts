import express from 'express';
import { createServer } from 'node:http';
import { Server } from 'socket.io';
import fs from 'node:fs/promises';
import path from 'node:path';
import { GameState, Car, Player, FinanceContract, CustomerAgent, DealProposal, EconomicState, FractionalVehicle, RACE_TIERS, RaceDifficulty, FUEL_PRICE_PER_UNIT } from './src/types.js';
import { MECHANIC_LIB, BODY_LIB } from './src/constants.js';

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, { cors: { origin: '*' } });

const DATA_FILE = path.join(process.cwd(), 'data', 'gameState.json');

// Current in-world model year — derived rather than hardcoded so valuations and
// generated vehicle ages stay correct over time.
const CURRENT_YEAR = new Date().getFullYear();

// --- North Carolina inspection rules (the lot is in Mecklenburg County) ------
const SAFETY_FEE = 13.6;     // NC annual safety inspection fee
const EMISSIONS_FEE = 30;    // NC OBD-II emissions fee (Mecklenburg is an emissions county)
// Vehicles in the 3 newest model years AND under 70k miles are exempt from emissions.
const emissionsRequired = (car: Car) => !((CURRENT_YEAR - car.year) <= 2 && car.mileage < 70000);

// Validate & clamp position payloads coming from clients. Rejects anything that
// isn't a finite x/z so a malicious or buggy client can't inject NaN / Infinity
// or teleport meshes thousands of units off the map.
const sanitizePosition = (pos: any) => {
    if (!pos || typeof pos !== 'object') return null;
    const isNum = (n: any) => typeof n === 'number' && Number.isFinite(n);
    if (!isNum(pos.x) || !isNum(pos.z)) return null;
    const clamp = (n: number) => Math.max(-2000, Math.min(2000, n));
    const out: any = { x: clamp(pos.x), z: clamp(pos.z) };
    if (isNum(pos.y)) out.y = clamp(pos.y);
    if (isNum(pos.r)) out.r = pos.r;               // car heading
    if (isNum(pos.rotation)) out.rotation = pos.rotation; // avatar heading
    return out;
};

async function saveGameState() {
    try {
        await fs.mkdir(path.dirname(DATA_FILE), { recursive: true });
        await fs.writeFile(DATA_FILE, JSON.stringify(gameState), 'utf8');
    } catch (err) {
        console.error('Failed to save game state:', err);
    }
}

async function loadGameState() {
    try {
        const data = await fs.readFile(DATA_FILE, 'utf8');
        const parsed = JSON.parse(data);
        if (parsed) {
            gameState = { ...gameState, ...parsed };
            // Players are keyed by socket id, which is regenerated on every new
            // connection — so persisted players can never be reclaimed by anyone.
            // Keeping them just litters the world with un-ownable ghost lots (whose
            // gates never open for you) and inflates the join lot-count, which is how
            // a reconnecting player ends up spawned on a stale lot they can't exit.
            // Drop them so every fresh server process starts with no ghosts.
            gameState.players = {};
            // clear active walk-ins as they may be stale or have broken timeout state
            gameState.activeWalkIns = {};
            // start each server process with a fresh chat (sender ids are dead anyway)
            gameState.chatLog = [];
            // The persisted hostId is a socket id from a previous server process and
            // is dead after any restart. Leaving it set means line ~717 never hands
            // host to a live player, so end_day (and the whole economy) can never
            // advance. Clear it so the first player to join claims host.
            gameState.hostId = null;
            // ensure the fractional share market exists even for older saves
            if (!gameState.fractionalMarket || gameState.fractionalMarket.length === 0) {
                gameState.fractionalMarket = seedFractionalMarket();
            }
            // Migrate older economy saves that predate the Fed engine so the
            // readout panel shows real values immediately (not UI fallbacks).
            const e: any = gameState.economy || {};
            if (typeof e.federalInterestRate !== 'number') e.federalInterestRate = 0.05;
            if (typeof e.usedCarDemand !== 'number') e.usedCarDemand = 1.0;
            if (typeof e.inflation !== 'number') e.inflation = 0.025;
            if (typeof e.primeRate !== 'number') e.primeRate = e.federalInterestRate + 0.03;
            if (typeof e.priceIndex !== 'number') e.priceIndex = 1.0;
            if (!Array.isArray(e.rateHistory)) e.rateHistory = [];
            gameState.economy = e;
        }
    } catch (err) {
        console.log('No previous game state found or error reading, starting fresh.');
    }
}

setInterval(saveGameState, 15000);

// Live race entries: socket id -> the difficulty they paid into and when they started.
// Used to validate finish_race payouts so a client can't claim a reward it didn't earn.
const activeRaces = new Map<string, { difficulty: string; startedAt: number }>();
// Per-socket cooldown so item boxes can't be spammed for free rewards.
const lastBoxAt = new Map<string, number>();

// Timestamp of the last accepted end_day, used to throttle host day-advances.
let lastEndDayAt = 0;

function broadcastState(io: Server, state: GameState) {
    const sockets = io.sockets.sockets;
    for (const [id, socket] of sockets) {
        // Build a per-recipient view WITHOUT deep-cloning the whole state. The
        // recipient's own player and the shared market data are passed by
        // reference (socket.io serializes a snapshot); only OTHER players are
        // shallow-copied to strip private fields.
        const players: Record<string, any> = {};
        for (const pid in state.players) {
            const p = state.players[pid] as any;
            if (pid === id) {
                players[pid] = p;
            } else {
                players[pid] = {
                    ...p,
                    money: 0,
                    contracts: [],
                    customers: [],
                    balanceSheet: { totalIncome: 0, totalExpenses: 0, lastTickIncome: 0, lastTickExpense: 0 },
                    floorPlanDebt: 0,
                    gateCode: undefined,   // never reveal another player's gate code
                    shareHoldings: {},     // portfolios are private
                    inventory: p.inventory ? p.inventory.map((c: any) => ({ ...c, buyPrice: 0 })) : []
                };
            }
        }
        const myWalkIns = state.activeWalkIns?.[id];
        socket.emit('update', {
            ...state,
            players,
            activeWalkIns: myWalkIns ? { [id]: myWalkIns } : {}
        });
    }
}

let gameState: GameState = { 
    day: 1, 
    timeOfDay: 8.0, 
    players: {}, 
    market: [], 
    junkyard: [],
    economy: {
        federalInterestRate: 0.05,
        usedCarDemand: 1.0,
        inflation: 0.025,
        primeRate: 0.08,
        priceIndex: 1.0,
        rateHistory: []
    },
    activeWalkIns: {},
    fractionalMarket: [],
    chatLog: []
};

// --- Game chat ---------------------------------------------------------------
// Broadcast a chat line to everyone and keep a short rolling history so players
// who join later see the recent conversation (delivered via the `init` state).
function pushChat(io: Server, msg: { id: string; playerId: string; name: string; text: string; ts: number; system?: boolean }) {
    if (!gameState.chatLog) gameState.chatLog = [];
    gameState.chatLog.push(msg);
    if (gameState.chatLog.length > 50) gameState.chatLog.shift();
    io.emit('chat', msg);
}

// --- MyCar Fractional: SPV-backed vehicles whose shares trade ----------------
const MM_SPREAD = 0.03; // platform market-maker spread around the fundamental price
const round2 = (n: number) => Math.round(n * 100) / 100;

const seedFractionalMarket = (): FractionalVehicle[] => {
    const seeds: Array<[number, string, string, number, number, number, FractionalVehicle['condition']]> = [
        // year, make, model, underlyingValue, mileage, volatility, condition
        [2020, 'Toyota', 'Camry',     18500, 45000, 0.018, 'excellent'],
        [2019, 'Honda',  'Civic',     16200, 52000, 0.020, 'good'],
        [2021, 'Tesla',  'Model 3',   42000, 28000, 0.045, 'excellent'],
        [2018, 'Ford',   'F-150',     24500, 78000, 0.025, 'fair'],
        [2020, 'BMW',    '3 Series',  35000, 38000, 0.038, 'excellent'],
        [2019, 'Chevrolet', 'Silverado', 26800, 62000, 0.028, 'good'],
        [2021, 'Mazda',  'CX-5',      28000, 22000, 0.022, 'excellent'],
        [2017, 'Audi',   'A4',        21500, 85000, 0.040, 'fair'],
        [2020, 'Hyundai','Elantra',   15800, 41000, 0.020, 'good'],
    ];
    return seeds.map(([year, make, model, value, mileage, volatility, condition], i) => {
        const fundamental = value / 1000;
        const history: number[] = [];
        let p = fundamental;
        for (let d = 0; d < 30; d++) {
            p = Math.max(fundamental * 0.6, p * (1 + (Math.random() * 2 - 1) * volatility));
            history.push(round2(p));
        }
        history.push(round2(fundamental));
        return {
            id: `frac-${i}`,
            year, make, model, vin: generateVIN(), mileage, condition,
            issuerId: 'platform',
            underlyingValue: value,
            totalShares: 1000,
            treasuryShares: 1000,
            dailyYield: Math.round(value * 0.0006), // ~0.06%/day rental income across all shares
            volatility,
            lastPrice: round2(fundamental),
            priceHistory: history.slice(-30),
            asks: [],
            status: 'trading'
        };
    });
};

// Each day: drift underlying car values, mark prices, and pay rental-yield dividends.
const tickFractionalMarket = () => {
    gameState.fractionalMarket.forEach(v => {
        if (v.status !== 'trading') return;
        const drift = (Math.random() * 2 - 1) * v.volatility - 0.001; // slight daily depreciation bias
        v.underlyingValue = Math.max(500, v.underlyingValue * (1 + drift));
        const fundamental = v.underlyingValue / v.totalShares;
        v.lastPrice = v.lastPrice + (fundamental - v.lastPrice) * 0.5; // mark toward fundamentals
        v.priceHistory.push(round2(fundamental));
        if (v.priceHistory.length > 30) v.priceHistory.shift();
    });
    // Distribute daily rental-yield dividends to every shareholder.
    Object.values(gameState.players).forEach(p => {
        if (!p.shareHoldings) return;
        let div = 0;
        for (const vid in p.shareHoldings) {
            const v = gameState.fractionalMarket.find(f => f.id === vid);
            if (v && v.status === 'trading' && v.totalShares > 0) {
                div += (p.shareHoldings[vid].shares / v.totalShares) * v.dailyYield;
            }
        }
        if (div > 0) {
            p.money += div;
            p.balanceSheet.totalIncome += div;
            p.balanceSheet.lastTickIncome += div;
        }
    });
};

const generateRepairs = (issueCount: number, type: 'mechanic' | 'body') => {
    let condition = 100;
    const repairs: any[] = [];
    const lib = type === 'mechanic' ? MECHANIC_LIB : BODY_LIB;
    for (let j = 0; j < issueCount; j++) {
        const issue = lib[Math.floor(Math.random() * lib.length)];
        repairs.push({
            id: `rep-${type.substring(0, 1)}-${Date.now()}-${Math.floor(Math.random()*1000)}`,
            name: issue.name,
            partName: issue.partName,
            type,
            cost: issue.cost,
            conditionImpact: issue.impact
        });
        condition -= issue.impact;
    }
    return { condition: Math.max(0, condition), repairs };
};

// Per-owner gate access code, generated once when a player connects and stored
// on their account so it persists with the saved game state.
const generateGateCode = () => String(Math.floor(1000 + Math.random() * 9000));

const generateVIN = () => {
    const chars = '0123456789ABCDEFGHJKLMNPRSTUVWXYZ';
    let vin = '1'; // US built
    for (let i = 0; i < 16; i++) {
        vin += chars[Math.floor(Math.random() * chars.length)];
    }
    return vin;
};

const CAR_MAKES = [
    { name: 'Toyota', msrp: 26000 },
    { name: 'Ford', msrp: 24000 },
    { name: 'Honda', msrp: 25000 },
    { name: 'Chevy', msrp: 23000 },
    { name: 'BMW', msrp: 45000 }
];

// Real model line-ups per make, each tagged with the body style that drives its
// 3D silhouette. The generator picks a make, then a random model from it, so the
// auction shows specific models across varied styles instead of identical sedans.
const CAR_CATALOG: Record<string, { model: string; style: string }[]> = {
    Toyota: [
        { model: 'Camry', style: 'sedan' }, { model: 'Corolla', style: 'sedan' },
        { model: 'RAV4', style: 'suv' }, { model: 'Tacoma', style: 'truck' },
        { model: 'Tundra', style: 'truck' }, { model: 'Prius', style: 'hatchback' },
        { model: 'Sienna', style: 'van' }, { model: 'Supra', style: 'sports' },
    ],
    Ford: [
        { model: 'F-150', style: 'truck' }, { model: 'Ranger', style: 'truck' },
        { model: 'Mustang', style: 'sports' }, { model: 'Explorer', style: 'suv' },
        { model: 'Escape', style: 'suv' }, { model: 'Focus', style: 'hatchback' },
        { model: 'Fusion', style: 'sedan' },
    ],
    Honda: [
        { model: 'Civic', style: 'sedan' }, { model: 'Accord', style: 'sedan' },
        { model: 'CR-V', style: 'suv' }, { model: 'Pilot', style: 'suv' },
        { model: 'Odyssey', style: 'van' }, { model: 'Fit', style: 'hatchback' },
        { model: 'Ridgeline', style: 'truck' },
    ],
    Chevy: [
        { model: 'Silverado', style: 'truck' }, { model: 'Colorado', style: 'truck' },
        { model: 'Camaro', style: 'sports' }, { model: 'Corvette', style: 'sports' },
        { model: 'Equinox', style: 'suv' }, { model: 'Tahoe', style: 'suv' },
        { model: 'Malibu', style: 'sedan' },
    ],
    BMW: [
        { model: '3 Series', style: 'sedan' }, { model: '5 Series', style: 'sedan' },
        { model: 'X5', style: 'suv' }, { model: 'X3', style: 'suv' },
        { model: 'M4', style: 'coupe' }, { model: '4 Series', style: 'coupe' },
        { model: 'Z4', style: 'sports' },
    ],
};

// Wide, realistic automotive paint palette.
const CAR_COLORS = ['#b91c1c', '#1d4ed8', '#15803d', '#f8fafc', '#0f172a', '#64748b', '#0e7490', '#7c3aed', '#ea580c', '#facc15', '#0d9488', '#9f1239', '#374151', '#c2410c', '#a16207', '#1e3a8a', '#0891b2', '#4d7c0f', '#7e22ce', '#b45309'];

const pickModel = (makeName: string) => {
    const list = CAR_CATALOG[makeName] || CAR_CATALOG['Toyota'];
    return list[Math.floor(Math.random() * list.length)];
};
const pickColor = () => CAR_COLORS[Math.floor(Math.random() * CAR_COLORS.length)];

const calculateCleanRetail = (make: string, year: number, mileage: number) => {
    const brand = CAR_MAKES.find(m => m.name === make) || CAR_MAKES[0];
    const age = Math.max(0, CURRENT_YEAR - year);
    
    // 12% standard annual depreciation off MSRP
    let cleanRetail = brand.msrp * Math.pow(0.88, age);
    
    // Mileage adjustment (10 cents per mile penalty over average 12k/yr)
    const expectedMileage = age * 12000;
    const mileagePenalty = Math.max(0, mileage - expectedMileage) * 0.10;
    cleanRetail -= mileagePenalty;

    // Inflation: the macro price index lifts all values over time (and consistently
    // across buying and selling, since every valuation flows through here).
    const priceIndex = (gameState.economy && gameState.economy.priceIndex) || 1;
    return Math.max(2000, cleanRetail) * priceIndex; // Absolute minimum clean retail floor
};

// Generate random cars
const generateMarketCars = () => {
    gameState.market = Array(4).fill(0).map((_, i) => {
      const isRebuilt = Math.random() < 0.2; // 20% chance
      const isSalvage = Math.random() < 0.05; // 5% chance
      const titleStatus = isSalvage ? 'Salvage' : (isRebuilt ? 'Rebuilt' : 'Clean');
      
      const year = CURRENT_YEAR - 13 + Math.floor(Math.random() * 12); // last ~13 model years
      const brand = CAR_MAKES[Math.floor(Math.random() * CAR_MAKES.length)];
      const picked = pickModel(brand.name);
      const conditionRoll = Math.random();
      let conditionTier = 'bad';
      if (conditionRoll > 0.43 && conditionRoll <= 0.83) conditionTier = 'medium';
      else if (conditionRoll > 0.83) conditionTier = 'mint';

      let numMechIssues = 0;
      let numBodyIssues = 0;
      if (conditionTier === 'mint') {
           numMechIssues = Math.random() > 0.5 ? 1 : 0;
           numBodyIssues = 0; 
      } else if (conditionTier === 'medium') {
           numMechIssues = 1 + Math.floor(Math.random() * 2);
           numBodyIssues = Math.random() > 0.5 ? 1 : 0;
      } else {
           numMechIssues = 2 + Math.floor(Math.random() * 2);
           numBodyIssues = 1 + Math.floor(Math.random() * 2);
      }

      if (titleStatus === 'Salvage') { numMechIssues += 2; numBodyIssues += 2; }
      else if (titleStatus === 'Rebuilt') { numMechIssues += 1; numBodyIssues += 1; }

      const mechGen = generateRepairs(numMechIssues, 'mechanic');
      const bodyGen = generateRepairs(numBodyIssues, 'body');

      const mechanicCondition = mechGen.condition;
      const bodyCondition = bodyGen.condition;
      const condition = Math.floor((mechanicCondition + bodyCondition) / 2);
      const activeRepairs = [...mechGen.repairs, ...bodyGen.repairs];

      const mileage = 30000 + Math.floor(Math.random() * 90000);
      
      // --- DETERMINISTIC VALUATION ENGINE ---
      const cleanRetail = calculateCleanRetail(brand.name, year, mileage);

      // Wholesale MMR is typically ~80% of Clean Retail
      let mmr = cleanRetail * 0.80; 

      if (titleStatus === 'Salvage') mmr = mmr * 0.35; // 35% Junkyard Base
      else if (titleStatus === 'Rebuilt') mmr = mmr * 0.65; // 65% Rebuilt Title

      if (mmr < 800) mmr = 800; // Hard floor absolute scrap value

      // Calculate final Buy Price based on physical flaws vs MMR baseline
      const damagePenalty = (100 - condition) / 100;
      let buyPrice = mmr * (1 - (damagePenalty * 0.7)); // Up to 70% discount off MMR for severely damaged cars!
      if (buyPrice < 500) buyPrice = 500;

      let auctionSeller = 'Private Seller';
      if (titleStatus === 'Salvage') {
          const insurers = ['Geico Insurance', 'State Farm', 'Allstate', 'Progressive', 'Liberty Mutual'];
          auctionSeller = insurers[Math.floor(Math.random() * insurers.length)];
      } else if (titleStatus === 'Rebuilt') {
          auctionSeller = 'Local Dealership';
      } else {
          const sellers = ['Private Seller', 'Bank Repossession', 'Rental Fleet', 'Private Seller'];
          auctionSeller = sellers[Math.floor(Math.random() * sellers.length)];
      }

      return {
        id: `car-${Date.now()}-${i}`,
        make: brand.name,
        model: picked.model,
        bodyStyle: picked.style,
        year: year,
        condition: condition,
        bodyCondition: bodyCondition,
        mechanicCondition: mechanicCondition,
        mileage: mileage,
        buyPrice: Math.floor(buyPrice),
        estimatedMMR: Math.floor(mmr),
        psiRevealed: false,
        color: pickColor(),
        ownerId: null,
        daysOnLot: 0,
        titleStatus: titleStatus,
        activeRepairs: activeRepairs,
        auctionSeller: auctionSeller,
        vin: generateVIN(),
        isRegistered: false
      };
    });
    broadcastState(io, gameState);
};

const generateJunkyardCars = () => {
    gameState.junkyard = Array(3).fill(0).map((_, i) => {
      const year = CURRENT_YEAR - 31 + Math.floor(Math.random() * 15); // old scrap shells
      const makes = ['Toyota', 'Ford', 'Honda', 'Chevrolet', 'Nissan'];
      const make = makes[Math.floor(Math.random() * makes.length)];
      const model = 'Scrap Shell';
      const junkStyles = ['sedan', 'suv', 'truck', 'coupe', 'hatchback', 'van'];
      const bodyStyle = junkStyles[Math.floor(Math.random() * junkStyles.length)];

      const mechanicIssues = 5 + Math.floor(Math.random() * 3);
      const bodyIssues = 5 + Math.floor(Math.random() * 3);
      
      const mechGen = generateRepairs(mechanicIssues, 'mechanic');
      const bodyGen = generateRepairs(bodyIssues, 'body');
      const activeRepairs = [...mechGen.repairs, ...bodyGen.repairs];
      
      const mileage = 150000 + Math.floor(Math.random() * 100000);
      const cleanRetail = calculateCleanRetail(make, year, mileage);
      let mmr = cleanRetail * 0.80 * 0.35; // Salvage base
      if (mmr < 800) mmr = 800;
      
      const damagePenalty = (100 - Math.floor((mechGen.condition + bodyGen.condition) / 2)) / 100;
      let buyPrice = mmr * (1 - (damagePenalty * 0.8)); // 80% discount for junkyard scrap
      if (buyPrice < 300) buyPrice = 300; // Super cheap
      
      return {
        id: `junk-${Date.now()}-${i}`,
        make,
        model,
        bodyStyle,
        year,
        condition: Math.floor((mechGen.condition + bodyGen.condition) / 2),
        bodyCondition: bodyGen.condition,
        mechanicCondition: mechGen.condition,
        mileage: mileage,
        buyPrice: Math.floor(buyPrice),
        estimatedMMR: Math.floor(mmr),
        psiRevealed: true, // Always revealed in junkyard
        color: 'Rusted Scrap',
        ownerId: null,
        daysOnLot: 0,
        titleStatus: 'Salvage',
        activeRepairs,
        auctionSeller: 'Local Junkyard',
        vin: generateVIN(),
        isRegistered: false
      };
    });
    broadcastState(io, gameState);
};

// --- Dealer insurance: premiums + a gentle adverse-event engine --------------
const INS_LIABILITY_PREMIUM = 40;      // per day
const INS_INVENTORY_RATE = 0.0006;     // per day, of inventory value (chosen policy)
const INS_FORCE_PLACED_RATE = 0.0018;  // per day, lender force-placed (~3x)
const INS_DEDUCTIBLE = 500;
const INS_LIAB_DEDUCTIBLE = 1000;
const INS_EVENT_CHANCE = 0.035;        // ~once every ~28 game days (gentle)

const logInsurance = (p: Player, msg: string) => {
    if (!p.insuranceLog) p.insuranceLog = [];
    p.insuranceLog.unshift(msg);
    if (p.insuranceLog.length > 6) p.insuranceLog.length = 6;
};

const processInsurance = (p: Player) => {
    if (!p.insurance) p.insurance = { liability: false, inventory: false, gap: false };
    const invValue = p.inventory.reduce((s, c) => s + (c.buyPrice || 0), 0);
    const leveraged = p.floorPlanDebt > 0;
    const forcePlaced = leveraged && !p.insurance.inventory; // lender buys coverage on your behalf
    const inventoryCovered = p.insurance.inventory || forcePlaced;

    // Premiums
    let premium = 0;
    if (p.insurance.liability) premium += INS_LIABILITY_PREMIUM;
    if (p.insurance.inventory) premium += Math.max(25, Math.floor(invValue * INS_INVENTORY_RATE));
    else if (forcePlaced) premium += Math.max(80, Math.floor(invValue * INS_FORCE_PLACED_RATE));
    if (premium > 0) {
        p.money -= premium;
        p.balanceSheet.totalExpenses += premium;
        p.balanceSheet.lastTickExpense += premium;
        if (forcePlaced) logInsurance(p, `Lender force-placed inventory insurance ($${premium.toLocaleString()}/day) — you're leveraged & uninsured. Buy your own policy to save.`);
    }

    // Gentle adverse event
    if (Math.random() >= INS_EVENT_CHANCE) return;
    const roll = Math.random();
    const payClaim = (bill: number, label: string) => {
        const payout = Math.max(0, Math.floor(bill - INS_DEDUCTIBLE));
        p.money += payout; p.balanceSheet.totalIncome += payout; p.balanceSheet.lastTickIncome += payout;
        logInsurance(p, `${label} Claim paid $${payout.toLocaleString()} (− $${INS_DEDUCTIBLE} deductible).`);
    };

    if (roll < 0.30) {
        const victims = p.inventory.filter(() => Math.random() < 0.5).slice(0, 3);
        if (victims.length === 0) return;
        let bill = 0;
        victims.forEach(c => {
            const dmg = 15 + Math.floor(Math.random() * 25);
            c.bodyCondition = Math.max(5, c.bodyCondition - dmg);
            c.condition = Math.floor((c.bodyCondition + c.mechanicCondition) / 2);
            bill += dmg * 40;
        });
        if (inventoryCovered) payClaim(bill, `Hailstorm hit ${victims.length} vehicle(s).`);
        else logInsurance(p, `Hailstorm damaged ${victims.length} vehicle(s) — UNINSURED, ~$${bill.toLocaleString()} in damage.`);
    } else if (roll < 0.55) {
        if (p.inventory.length === 0) return;
        const car = p.inventory.splice(Math.floor(Math.random() * p.inventory.length), 1)[0];
        const val = car.buyPrice || 0;
        if (inventoryCovered) payClaim(val, `Theft: a ${car.year} ${car.make} was stolen.`);
        else {
            logInsurance(p, `Theft: a ${car.year} ${car.make} ($${val.toLocaleString()}) was stolen — UNINSURED, total loss.`);
            if (leveraged) { p.money -= 250; p.balanceSheet.totalExpenses += 250; p.balanceSheet.lastTickExpense += 250; }
        }
    } else if (roll < 0.75) {
        if (p.inventory.length === 0) return;
        const car = p.inventory[Math.floor(Math.random() * p.inventory.length)];
        const dmg = 20 + Math.floor(Math.random() * 30);
        car.bodyCondition = Math.max(5, car.bodyCondition - dmg);
        car.mechanicCondition = Math.max(5, car.mechanicCondition - Math.floor(dmg / 2));
        car.condition = Math.floor((car.bodyCondition + car.mechanicCondition) / 2);
        const bill = dmg * 60;
        if (inventoryCovered) payClaim(bill, `Lot accident damaged a ${car.year} ${car.make}.`);
        else logInsurance(p, `Lot accident damaged a ${car.year} ${car.make} — UNINSURED, ~$${bill.toLocaleString()}.`);
    } else if (roll < 0.85) {
        if (p.inventory.length === 0) return;
        const car = p.inventory.splice(Math.floor(Math.random() * p.inventory.length), 1)[0];
        const val = car.buyPrice || 0;
        if (inventoryCovered) payClaim(val, `Fire destroyed a ${car.year} ${car.make}.`);
        else logInsurance(p, `Fire destroyed a ${car.year} ${car.make} ($${val.toLocaleString()}) — UNINSURED, total loss.`);
    } else {
        const claim = 2000 + Math.floor(Math.random() * 6000);
        if (p.insurance.liability) {
            p.money -= INS_LIAB_DEDUCTIBLE; p.balanceSheet.totalExpenses += INS_LIAB_DEDUCTIBLE; p.balanceSheet.lastTickExpense += INS_LIAB_DEDUCTIBLE;
            logInsurance(p, `Liability claim ($${claim.toLocaleString()}) — covered; you paid the $${INS_LIAB_DEDUCTIBLE} deductible.`);
        } else {
            p.money -= claim; p.balanceSheet.totalExpenses += claim; p.balanceSheet.lastTickExpense += claim;
            logInsurance(p, `Liability claim — UNINSURED. Paid $${claim.toLocaleString()} out of pocket.`);
        }
    }
};

// Economic Tick: 1 Day = 10 Seconds
const economyTick = () => {
    gameState.day += 1;
    gameState.timeOfDay = 8.0;

    // --- Macro engine: a simplified Fed reaction that creates a real business cycle.
    const e = gameState.economy as any;
    if (typeof e.inflation !== 'number') e.inflation = 0.025;
    if (typeof e.priceIndex !== 'number') e.priceIndex = 1.0;
    if (!Array.isArray(e.rateHistory)) e.rateHistory = [];
    const demandGap = e.usedCarDemand - 1.0;
    // 1. Inflation: hot demand pushes it up, high rates pull it down, mean-reverts toward ~2%.
    e.inflation += demandGap * 0.010 - (e.federalInterestRate - 0.025) * 0.020 + (0.02 - e.inflation) * 0.05 + (Math.random() * 0.004 - 0.002);
    e.inflation = Math.max(-0.01, Math.min(0.12, e.inflation));
    // 2. Fed reaction (Taylor-rule-ish), eased toward gradually like real 25bps moves.
    const targetRate = Math.max(0, Math.min(0.18, 0.025 + 1.5 * (e.inflation - 0.02) + 0.5 * demandGap));
    e.federalInterestRate += (targetRate - e.federalInterestRate) * 0.25;
    e.federalInterestRate = Math.max(0.0, Math.min(0.18, e.federalInterestRate));
    // 3. Demand responds to rates (tight money cools buyers), mean-reverting toward 1.0.
    e.usedCarDemand += -(e.federalInterestRate - 0.025) * 0.08 + (1.0 - e.usedCarDemand) * 0.05 + (Math.random() * 0.04 - 0.02);
    e.usedCarDemand = Math.max(0.6, Math.min(1.4, e.usedCarDemand));
    // 4. Derived: prime = fed funds + 3%; inflation compounds car values via the price index.
    e.primeRate = e.federalInterestRate + 0.03;
    e.priceIndex = e.priceIndex * (1 + e.inflation * 0.02);
    e.rateHistory.push(Math.round(e.federalInterestRate * 10000) / 10000);
    if (e.rateHistory.length > 30) e.rateHistory.shift();
    // Dealer floor-plan financing tracks SOFR(≈fed funds) + a ~3% spread (as the game's daily rate).
    const macroFloorRate = 0.0015 + (e.federalInterestRate + 0.03) * 0.035;

    // Process business logic for all players

    Object.values(gameState.players).forEach(p => {
        let dailyIncome = 0;
        let dailyExpense = 0;

        // Floor-plan carrying rate now tracks the Fed (SOFR + spread), so a hiking cycle costs you more.
        p.floorPlanRate = macroFloorRate;

        // 1. Calculate Dealership Overhead proportionate to the day of the month (Daily Prorated)
        // Small: $3,000/mo ($100/day)
        // Medium: $15,000/mo ($500/day)
        // Large: $36,000/mo ($1200/day)
        let overhead = 0;
        if (p.lotScale === 'Small') overhead = 100;
        else if (p.lotScale === 'Medium') overhead = 500;
        else if (p.lotScale === 'Large') overhead = 1200;

        // Add daily payroll for hired staff
        let payroll = 0;
        if (p.employees?.mechanic) payroll += 500;
        if (p.employees?.salesperson) payroll += 400;
        if (p.employees?.financeManager) payroll += 800;

        dailyExpense += overhead + payroll;

        // 1b. Calculate Floor Plan Debt Interest (Carrying Costs)
        if (p.floorPlanDebt > 0) {
            const interest = Math.floor(p.floorPlanDebt * p.floorPlanRate);
            dailyExpense += interest;
        }

        // 2. Calculate Payouts and Subprime Risk from NPC Financing Contracts (Passive Income)
        p.contracts = p.contracts.filter(contract => {
            if (contract.daysRemaining > 0) {
                if (contract.repoStatus === 'Pending') {
                    // Check if repo agent finished (takes 2 days)
                    if (contract.repoRequestedDay && gameState.day - contract.repoRequestedDay >= 2) {
                        // Recover vehicle! Track customer info and put the degraded vehicle back on lot
                        const customer = p.customers.find(c => c.id === contract.customerId);
                        if (customer) {
                            const mechGen = generateRepairs(2 + Math.floor(Math.random()*3), 'mechanic');
                            const bodyGen = generateRepairs(2 + Math.floor(Math.random()*3), 'body');
                            const unparkedCount = p.inventory.filter(c => !c.isProcessed).length;
                            p.inventory.push({
                                id: contract.carId + '_repo',
                                vin: customer.carInfo.vin,
                                make: customer.carInfo.make,
                                model: customer.carInfo.model,
                                year: customer.carInfo.year,
                                color: 'Repo Gray',
                                mileage: 150000 + Math.floor(Math.random() * 20000), // added mileage
                                buyPrice: 0, // Repo'd back to our inventory
                                titleStatus: 'Clean', // Assuming original was clean
                                condition: Math.floor((mechGen.condition + bodyGen.condition) / 2),
                                bodyCondition: bodyGen.condition,
                                mechanicCondition: mechGen.condition,
                                activeRepairs: [...mechGen.repairs, ...bodyGen.repairs],
                                daysOnLot: 0,
                                isRegistered: true, // Repo is still in player's name
                                ownerId: p.id,
                                lotPosition: {
                                     x: p.lotPosition.x - 40,
                                     z: p.lotPosition.z + 15 + (unparkedCount * 6),
                                     r: 0
                                }
                            });
                        }
                        return false; // Contract voided upon recovery
                    }
                    return true;
                }

                if (contract.isDelinquent) {
                    return true; // No payments come in while delinquent!
                }

                // Calculate base delinquency chance (2%)
                let delinquencyChance = 0.02;
                // If F&I Manager is hired, default chance drops drastically (0.5%)
                if (p.employees?.financeManager) delinquencyChance = 0.005;

                if (Math.random() < delinquencyChance) {
                    contract.isDelinquent = true;
                    return true;
                }

                // Collect payment!
                dailyIncome += contract.dailyPayment;
                contract.daysRemaining -= 1;
                return true; // keep contract open
            }
            return false; // contract completed
        });

        // 3. Increment days on lot for inventory and process pending DMV inspections
        p.inventory.forEach(car => {
            car.daysOnLot += 1;
            if (car.inspectionStatus === 'Pending' && car.inspectionRequestedDay) {
                if (gameState.day - car.inspectionRequestedDay >= 2) {
                    car.inspectionStatus = 'Passed';
                    car.titleStatus = 'Rebuilt';
                }
            }
        });

        // 4. Process Marketing Budget and generate walk-in offers (NEW DEEPMIND AI)
        let adSpend = 0;
        let walkInVolume = 1; // Base 1 walk-in
        if (p.marketingTier === 'MetaAds') {
            adSpend = 100;
            walkInVolume = 2;
        } else if (p.marketingTier === 'Autotrader') {
            adSpend = 300;
            walkInVolume = 3;
        }
        
        // Reputation scales volume; used-car demand (driven by the Fed/rates) scales it too.
        const repMultiplier = (p.reputation || 50) / 50;
        const demandMultiplier = gameState.economy.usedCarDemand;
        let finalVolume = Math.max(0, Math.floor((walkInVolume + Math.floor(Math.random() * 2)) * repMultiplier * demandMultiplier));
        
        dailyExpense += adSpend;

        // Generate the Customer Agents
        if (!gameState.activeWalkIns[p.id]) gameState.activeWalkIns[p.id] = [];
        
        // Clear out people who left
        gameState.activeWalkIns[p.id] = gameState.activeWalkIns[p.id].filter(agent => agent.state !== 'left');

        const firstNames = ['John', 'Jane', 'Mike', 'Sarah', 'Will', 'Emma', 'Dave', 'Olivia', 'James', 'Ava', 'Chris', 'Amanda'];
        for (let i = 0; i < finalVolume; i++) {
            const budget = 3000 + Math.floor(Math.random() * 20000); // 3k to 23k cash budget
            const name = firstNames[Math.floor(Math.random() * firstNames.length)] + ' ' + String.fromCharCode(65 + Math.floor(Math.random() * 26)) + '.';
            const creditScore = 400 + Math.floor(Math.random() * 420); // 400 to 820
            
            gameState.activeWalkIns[p.id].push({
                id: `agt-${Date.now()}-${i}`,
                name,
                budget,
                creditScore,
                monthlyIncome: 2000 + Math.floor(Math.random() * 6000),
                knowledge: Math.floor(Math.random() * 100),
                desperation: Math.floor(Math.random() * 100),
                needs: {
                    maxMileage: 100000 + Math.floor(Math.random() * 100000),
                    minCondition: 40 + Math.floor(Math.random() * 40)
                },
                state: 'browsing',
                patience: 3
            });
        }


        // Update player balance sheet
        p.money = Math.floor(p.money + dailyIncome - dailyExpense);
        p.balanceSheet.lastTickIncome = dailyIncome;
        p.balanceSheet.lastTickExpense = dailyExpense;
        p.balanceSheet.totalIncome += dailyIncome;
        p.balanceSheet.totalExpenses += dailyExpense;

        // Insurance premiums + the gentle adverse-event engine
        processInsurance(p);
    });

    if (gameState.day % 6 === 0 || gameState.market.length === 0) {
        generateMarketCars();
        generateJunkyardCars();
    }

    tickFractionalMarket(); // drift values, mark prices, pay dividends

    broadcastState(io, gameState);
};

generateMarketCars();
generateJunkyardCars();
if (!gameState.fractionalMarket || gameState.fractionalMarket.length === 0) {
    gameState.fractionalMarket = seedFractionalMarket();
}

// Intraday Engine Clock (1 hour = 30 real seconds => 1 in-game minute = 0.5s)
// Ticks every 1 second, advancing timeOfDay by ~ 0.0333 hours
setInterval(() => {
    // Only increment time if it's during working hours (extended to 20.0 / 8 PM for night shift)
    if (gameState.timeOfDay < 20.0) {
        // 1 hour / 30 seconds = 0.0333 hours per second
        gameState.timeOfDay += (1.0 / 30.0);
        
        // If we hit closing time, cap at 20.0
        if (gameState.timeOfDay >= 20.0) {
            gameState.timeOfDay = 20.0;
        }
        
        // Broadcast the time update to all clients to keep sun/clocks synced perfectly
        io.emit('time_update', gameState.timeOfDay);
    }
}, 1000);

io.on('connection', (socket) => {
    socket.on('join', ({ name, lotScale, careerFocus, shopSpecialty }) => {
      console.log('--- PLAYER JOIN ---', { name, lotScale, careerFocus, shopSpecialty });
      if (!gameState.hostId) {
          gameState.hostId = socket.id;
      }
      const playerCount = Object.keys(gameState.players).length;
      let x = (playerCount % 5) * 250;
      let z = Math.floor(playerCount / 5) * -250;

      let initMoney = 25000;
      let isStandalone = careerFocus === 'standalone';
      console.log('isStandalone determined as:', isStandalone);

      if (isStandalone) {
        x = 50;
        z = 350;
        if (shopSpecialty === 'mechanic') initMoney = 45000;
        else if (shopSpecialty === 'body') initMoney = 35000;
        else initMoney = 95000; // dual
      } else {
        if (lotScale === 'Medium') initMoney = 75000;
        if (lotScale === 'Large') initMoney = 250000;
      }

      gameState.players[socket.id] = { 
        id: socket.id, 
        name: name || (isStandalone ? `Shop_${socket.id.substring(0,4)}` : `Dealer_${socket.id.substring(0,4)}`), 
        money: initMoney, 
        inventory: [], 
        lotPosition: { x, z },
        lotScale: lotScale || 'Small',
        marketingTier: 'Craigslist',
        floorPlanDebt: 0,
        floorPlanRate: 0.005, // 0.5% daily interest on borrowed capital
        contracts: [],
        customers: [],
        employees: { mechanic: false, salesperson: false, financeManager: false },
        partsInventory: {},
        balanceSheet: { totalIncome: 0, totalExpenses: 0, lastTickIncome: 0, lastTickExpense: 0 },
        gateCode: generateGateCode(),
        shareHoldings: {},
        insurance: { liability: false, inventory: false, gap: false },
        insuranceLog: [],
        // Standalone properties
        isStandaloneOperator: isStandalone,
        shopSpecialty: isStandalone ? (shopSpecialty || 'dual') : undefined
      } as any;
      socket.emit('init', { id: socket.id, state: gameState });
      broadcastState(io, gameState);
      const joinedName = gameState.players[socket.id].name;
      pushChat(io, { id: `${Date.now()}-j`, playerId: '', name: 'System', text: `${joinedName} entered the world`, ts: Date.now(), system: true });
    });

  socket.on('chat_message', ({ text }) => {
    const player = gameState.players[socket.id];
    if (!player) return;
    const clean = String(text || '').replace(/\s+/g, ' ').trim().slice(0, 200);
    if (!clean) return;
    pushChat(io, { id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, playerId: socket.id, name: player.name, text: clean, ts: Date.now() });
  });

  socket.on('buy_car', ({ carId, useFinancing }) => {
    const player = gameState.players[socket.id];
    const carIndex = gameState.market.findIndex(c => c.id === carId);
    const limit = player ? (player.lotScale === 'Small' ? 10 : player.lotScale === 'Medium' ? 25 : 50) : 10;
    if(carIndex !== -1 && player && player.inventory.length < limit) {
        const car = gameState.market[carIndex];
        
        if (useFinancing) {
            // Pay using Floor Plan Credit Line + $300 Transport Fee
            player.floorPlanDebt += car.buyPrice;
            player.money -= 300; // Transport fee must be paid in cash!
            player.balanceSheet.totalExpenses += 300;
            car.ownerId = player.id;
            car.daysOnLot = 0;
            car.isDirty = true;
            car.isProcessed = false;
            // Spawn inside the red Drop-Off Zone lined up neatly
            const unparkedCount = player.inventory.filter(c => !c.isProcessed).length;
            car.lotPosition = { 
                 x: player.lotPosition.x - 40, 
                 z: player.lotPosition.z + 15 + (unparkedCount * 6), 
                 r: 0 
            };
            player.inventory.push(car);
            gameState.market.splice(carIndex, 1);
            broadcastState(io, gameState);
        } else if (player.money >= car.buyPrice) {
            // Pay Cash + $300 Auto-Delivery Fee
            player.money -= (car.buyPrice + 300);
            player.balanceSheet.totalExpenses += 300;
            car.ownerId = player.id;
            car.daysOnLot = 0;
            car.isDirty = true;
            car.isProcessed = false;
            // Spawn inside the red Drop-Off Zone lined up neatly
            const unparkedCount = player.inventory.filter(c => !c.isProcessed).length;
            car.lotPosition = { 
                 x: player.lotPosition.x - 40, 
                 z: player.lotPosition.z + 15 + (unparkedCount * 6), 
                 r: 0 
            };
            player.inventory.push(car);
            gameState.market.splice(carIndex, 1);
            broadcastState(io, gameState);
        }
    }
  });

  socket.on('sync_car_pos', ({ carId, position }) => {
     const player = gameState.players[socket.id];
     if (!player) return;
     const clean = sanitizePosition(position);
     if (!clean) return;
     const car = player.inventory.find(c => c.id === carId);
     if (car) car.lotPosition = clean as any;
  });

  socket.on('sync_player_pos', (pos) => {
      const clean = sanitizePosition(pos);
      if (gameState.players[socket.id] && clean) {
          gameState.players[socket.id].worldPosition = clean as any;
      }
  });

  // --- Fuel & racing ---------------------------------------------------------
  // Driving is simulated client-side, so fuel burn is client-authoritative: the
  // client streams the tank level down as it drives. We persist it silently (no
  // broadcast) to avoid spamming the whole room every second.
  socket.on('consume_fuel', ({ carId, fuel }) => {
      const player = gameState.players[socket.id];
      if (!player) return;
      const car = player.inventory.find(c => c.id === carId);
      if (car && typeof fuel === 'number') car.fuel = Math.max(0, Math.min(100, fuel));
  });

  socket.on('refuel', ({ carId, delivery }) => {
      const player = gameState.players[socket.id];
      if (!player) return;
      const car = player.inventory.find(c => c.id === carId);
      if (!car) return;
      const current = car.fuel ?? 100;
      const needed = 100 - current;
      if (needed <= 0.5) return; // already full
      const cost = Math.ceil(needed * FUEL_PRICE_PER_UNIT) + (delivery ? 300 : 0); // roadside delivery surcharge
      if (player.money < cost) { socket.emit('refuel_denied'); return; }
      player.money -= cost;
      player.balanceSheet.totalExpenses += cost;
      player.balanceSheet.lastTickExpense += cost;
      car.fuel = 100;
      broadcastState(io, gameState);
  });

  socket.on('rent_race_car', () => {
      const player = gameState.players[socket.id];
      if (!player) return;
      if (player.inventory.some((c: any) => c.isRental)) { socket.emit('rental_denied', { reason: 'active' }); return; }
      const RENTAL_FEE = 1500;
      if (player.money < RENTAL_FEE) { socket.emit('rental_denied', { reason: 'funds', fee: RENTAL_FEE }); return; }
      player.money -= RENTAL_FEE;
      player.balanceSheet.totalExpenses += RENTAL_FEE;
      player.balanceSheet.lastTickExpense += RENTAL_FEE;
      const colors = ['#ef4444', '#3b82f6', '#22c55e', '#eab308', '#a855f7', '#f97316'];
      const rental: any = {
          id: 'rental-' + socket.id + '-' + Date.now(),
          make: 'Speedway', model: 'Rental GT', year: 2026, bodyStyle: 'sports',
          condition: 100, bodyCondition: 100, mechanicCondition: 100, mileage: 1000,
          buyPrice: 0, color: colors[Math.floor(Math.random() * colors.length)],
          ownerId: player.id, daysOnLot: 0, titleStatus: 'Clean',
          vin: 'RENTAL' + Math.random().toString(36).slice(2, 10).toUpperCase(),
          fuel: 100, isRental: true, isProcessed: true, isRegistered: false, // unregistered → can't be sold through the dealer flow
          lotPosition: { x: 0, z: 1710, r: 0 } // in the speedway paddock by the rental kiosk
      };
      player.inventory.push(rental);
      socket.emit('rental_ready', { carId: rental.id });
      broadcastState(io, gameState);
  });

  socket.on('return_rental', () => {
      const player = gameState.players[socket.id];
      if (!player) return;
      const before = player.inventory.length;
      player.inventory = player.inventory.filter((c: any) => !c.isRental);
      if (player.inventory.length !== before) broadcastState(io, gameState);
  });

  socket.on('hit_item_box', () => {
      const player = gameState.players[socket.id];
      if (!player) return;
      if (!activeRaces.has(socket.id)) return; // item boxes are a race-only mechanic
      const now = Date.now();
      const last = lastBoxAt.get(socket.id) || 0;
      if (now - last < 1100) return; // anti-spam
      lastBoxAt.set(socket.id, now);
      // Random Mario-Kart item — a racing advantage, NOT cash (keeps money out of the economy).
      const pool = ['mushroom', 'mushroom', 'mushroom', 'triple_mushroom', 'banana', 'banana', 'green_shell', 'green_shell', 'star'];
      const item = pool[Math.floor(Math.random() * pool.length)];
      socket.emit('item_box_reward', { item });
  });

  socket.on('enter_race', ({ difficulty }) => {
      const player = gameState.players[socket.id];
      if (!player) return;
      const tier = RACE_TIERS[difficulty as RaceDifficulty];
      if (!tier) return;
      if (player.money < tier.entryFee) { socket.emit('race_denied', { reason: 'funds', entryFee: tier.entryFee }); return; }
      player.money -= tier.entryFee;
      player.balanceSheet.totalExpenses += tier.entryFee;
      player.balanceSheet.lastTickExpense += tier.entryFee;
      activeRaces.set(socket.id, { difficulty, startedAt: Date.now() });
      socket.emit('race_started', { difficulty, laps: tier.laps, entryFee: tier.entryFee, reward: tier.reward, cpuSkill: tier.cpuSkill });
      broadcastState(io, gameState);
  });

  socket.on('finish_race', ({ difficulty, totalMs, laps, placed }) => {
      const player = gameState.players[socket.id];
      if (!player) return;
      const ar = activeRaces.get(socket.id);
      if (!ar || ar.difficulty !== difficulty) return; // must have a live entry for this race
      const tier = RACE_TIERS[difficulty as RaceDifficulty];
      if (!tier) return;
      if (typeof laps !== 'number' || laps < tier.laps) return; // didn't finish — keep the entry live
      const minMs = tier.laps * 8000;     // a lap can't realistically be under 8s
      const maxMs = tier.laps * 180000;   // a "finish" slower than 3min/lap is abandoned
      const realElapsed = Date.now() - ar.startedAt;
      if (typeof totalMs !== 'number' || totalMs < minMs || totalMs > maxMs) return;
      if (realElapsed < minMs - 1000) return; // can't physically have finished that fast — ignore, entry stays live
      activeRaces.delete(socket.id); // validated finish — consume the entry now
      // v1: finishing the time-trial pays the tier reward (1st place by default).
      // Stage 2 will scale the payout by finishing position against the CPU field.
      const place = typeof placed === 'number' ? placed : 1;
      const factor = place <= 1 ? 1 : place === 2 ? 0.5 : place === 3 ? 0.25 : 0;
      const reward = Math.round(tier.reward * factor);
      if (reward > 0) {
          player.money += reward;
          player.balanceSheet.totalIncome += reward;
          player.balanceSheet.lastTickIncome += reward;
      }
      player.raceWins = (player.raceWins || 0) + (place <= 1 ? 1 : 0);
      socket.emit('race_payout', { reward, place, difficulty, totalMs });
      broadcastState(io, gameState);
  });

  socket.on('wash_car', (carId) => {
     const player = gameState.players[socket.id];
     if (!player) return;
     const car = player.inventory.find(c => c.id === carId);
     if (car) {
         car.isDirty = false;
         broadcastState(io, gameState);
     }
  });

  socket.on('repair_engine', (carId) => {
     const player = gameState.players[socket.id];
     if (!player) return;
     const car = player.inventory.find(c => c.id === carId);
     if (car && player.money >= 500 && car.mechanicCondition < 100) {
         player.money -= 500;
         car.mechanicCondition = 100;
         car.condition = Math.floor((car.mechanicCondition + car.bodyCondition) / 2);
         broadcastState(io, gameState);
     }
  });

  socket.on('place_on_lot', (carId) => {
     const player = gameState.players[socket.id];
     if (!player) return;
     const car = player.inventory.find(c => c.id === carId);
     if (car && !car.isDirty) {
         car.isProcessed = true;
         broadcastState(io, gameState);
     }
  });

  socket.on('propose_deal', ({ agentId, carId }) => {
      const player = gameState.players[socket.id];
      if (!player) return;
      
      const agents = gameState.activeWalkIns[player.id];
      const agent = agents?.find(a => a.id === agentId);
      const car = player.inventory.find(c => c.id === carId);
      
      if (!agent || !car || agent.state !== 'browsing') return;
      
      agent.carId = car.id;
      agent.state = 'negotiating';
      
      // Calculate proposal
      let cleanRetail = calculateCleanRetail(car.make, car.year, car.mileage);
      if (car.titleStatus === 'Salvage') cleanRetail *= 0.40;
      else if (car.titleStatus === 'Rebuilt') cleanRetail *= 0.70;

      // Agent Knowledge Penalty
      const damagePenalty = (100 - car.condition) / 100;
      let knowledgeFactor = agent.knowledge / 100; // 1.0 means they see all damage, 0 means they ignore it
      let perceivedValue = cleanRetail * (1 - (damagePenalty * 0.5 * knowledgeFactor));
      
      // Desperation Bonus
      perceivedValue = perceivedValue * (1 + (agent.desperation / 100 * 0.2)); // Up to 20% overpay
      
      // Base Deal Structure
      let dealType: 'cash'|'bank'|'inhouse' = 'cash';
      let downPayment = perceivedValue;
      let monthlyPayment = 0;
      let months = 0;
      let totalValue = perceivedValue;
      
      if (agent.budget >= perceivedValue) {
          dealType = 'cash';
      } else if (agent.creditScore > 650) {
          dealType = 'bank';
          downPayment = agent.budget * 0.5; // put half down
          totalValue = perceivedValue;
      } else {
          dealType = 'inhouse';
          downPayment = agent.budget;
          months = 30; // game days actually
          monthlyPayment = Math.floor((perceivedValue - downPayment) * 1.25 / months);
          totalValue = downPayment + (monthlyPayment * months);
      }
      
      agent.activeProposal = {
          id: `deal-${Date.now()}`,
          carId: car.id,
          agentId: agent.id,
          dealType,
          downPayment: Math.floor(downPayment),
          monthlyPayment,
          months,
          totalValue: Math.floor(totalValue)
      };
      
      broadcastState(io, gameState);
  });

  socket.on('counter_offer', ({ agentId, newTotalValue }) => {
      const player = gameState.players[socket.id];
      if (!player) return;
      const agents = gameState.activeWalkIns[player.id];
      const agent = agents?.find(a => a.id === agentId);
      if (!agent || !agent.activeProposal) return;
      
      agent.patience -= 1;
      if (agent.patience <= 0) {
          agent.state = 'left';
          agent.activeProposal = undefined;
      } else {
          // If the counter offer is within 10% of their original offer + desperation leeway, they accept
          const originalOffer = agent.activeProposal.totalValue;
          const acceptableCounter = originalOffer * (1 + (agent.desperation / 100 * 0.15));
          
          if (newTotalValue <= acceptableCounter) {
              // They accept the counter! Update proposal
              agent.activeProposal.totalValue = newTotalValue;
              if (agent.activeProposal.dealType === 'inhouse') {
                  const down = agent.activeProposal.downPayment;
                  agent.activeProposal.monthlyPayment = Math.floor((newTotalValue - down) * 1.25 / agent.activeProposal.months);
              }
          } else {
              // They reject the counter and stick to their last offer, but patience is lost
          }
      }
      broadcastState(io, gameState);
  });

  socket.on('reject_deal', ({ agentId }) => {
      const player = gameState.players[socket.id];
      if (!player) return;
      const agents = gameState.activeWalkIns[player.id];
      const agent = agents?.find(a => a.id === agentId);
      if (agent) {
          agent.state = 'left';
          agent.activeProposal = undefined;
          broadcastState(io, gameState);
      }
  });

  socket.on('finalize_deal', ({ carId, agentId, tradeIn }) => {
      const player = gameState.players[socket.id];
      if (!player) return;
      
      const agents = gameState.activeWalkIns[player.id];
      const agent = agents?.find(a => a.id === agentId);
      if (!agent || !agent.activeProposal) return;
      
      const carIndex = player.inventory.findIndex(c => c.id === carId);
      if (carIndex === -1) return;
      
      const car = player.inventory[carIndex];
      if (!car.isRegistered) return; // Cannot sell untitled/unregistered cars
      if (!car.safetyPassed) return; // NC: must pass safety + emissions inspection before retail sale
      if (car.titleStatus === 'Salvage') return; // a salvage car must be rebuilt before it can be sold

      const proposal = agent.activeProposal;
      const dealType = proposal.dealType;
      
      let finalPrincipal = proposal.totalValue;

      if (tradeIn && tradeIn.active) {
          const allowance = tradeIn.tradeValue;
          finalPrincipal = Math.max(0, finalPrincipal - allowance);

          const unparkedCount = player.inventory.filter(c => !c.isProcessed).length;
          player.inventory.push({
              id: `trd-${Date.now()}`,
              vin: generateVIN(),
              make: tradeIn.make,
              model: tradeIn.model,
              year: tradeIn.year,
              condition: 30 + Math.floor(Math.random() * 50),
              bodyCondition: 30 + Math.floor(Math.random() * 50),
              mechanicCondition: 30 + Math.floor(Math.random() * 50),
              titleStatus: 'Clean',
              daysOnLot: 0,
              color: 'Trade-In Silver',
              buyPrice: allowance,
              mileage: 120000 + Math.floor(Math.random() * 80000),
              isRegistered: false,
              ownerId: player.id,
              lotPosition: {
                   x: player.lotPosition.x - 40,
                   z: player.lotPosition.z + 15 + (unparkedCount * 6),
                   r: 0
              }
          });
      }

      let cashProceeds = 0;
      if (dealType === 'cash') cashProceeds = proposal.downPayment; // For cash, downPayment is full price
      else if (dealType === 'bank') {
          if (car.titleStatus === 'Salvage') return; // Bank auto-reject
          cashProceeds = proposal.totalValue * 1.05; // Includes 5% Bank Dealer Reserve bonus
      }
      else if (dealType === 'inhouse') {
          cashProceeds = proposal.downPayment; // Just the customer cash down-payment
      }

      // Salesperson negotiation bonus (10% more proceeds on Cash and Bank deals)
      if (player.employees?.salesperson && (dealType === 'cash' || dealType === 'bank')) {
          cashProceeds = Math.floor(cashProceeds * 1.10);
      }

      // All payouts receive their calculated cash immediately
      player.money += cashProceeds;
      player.balanceSheet.totalIncome += cashProceeds;
      player.balanceSheet.lastTickIncome += cashProceeds;
      
      // Generate a random customer and save to CRM database
      const firstNames = ['John', 'Jane', 'Michael', 'Sarah', 'William', 'Emma', 'David', 'Olivia', 'James', 'Ava'];
      const lastNames = ['Smith', 'Johnson', 'Williams', 'Jones', 'Brown', 'Davis', 'Miller', 'Wilson', 'Moore', 'Taylor'];
      const customerName = `${firstNames[Math.floor(Math.random() * firstNames.length)]} ${lastNames[Math.floor(Math.random() * lastNames.length)]}`;
      const customerPhone = `(${Math.floor(200 + Math.random() * 800)}) 555-${Math.floor(1000 + Math.random() * 9000)}`;
      const customerId = `cust-${Date.now()}`;

      if (dealType === 'inhouse') {
          // Subprime BHPH Deal: priced at prime + a subprime margin, so the yield
          // (and the customer's payment) rises and falls with the Fed.
          const termDays = 30; // 30 game days
          const interestRate = (gameState.economy.primeRate || 0.08) + 0.14; // ~25% at a 5% Fed funds rate
          const amountFinanced = finalPrincipal - cashProceeds; // Remaining after down-payment
          const totalYield = amountFinanced * (1 + interestRate);
          const dailyPayment = Math.floor(totalYield / termDays);

          // GAP product (F&I): if you carry GAP coverage, sell it on the BHPH deal for fee income.
          if (player.insurance?.gap) {
              const gapFee = 300;
              player.money += gapFee;
              player.balanceSheet.totalIncome += gapFee;
              player.balanceSheet.lastTickIncome += gapFee;
          }

          player.contracts.push({
              id: `contract-${Date.now()}`,
              customerId: customerId,
              carId: car.id,
              principal: amountFinanced, // Real financed amount
              interestRate: interestRate,
              totalYield: Math.floor(totalYield),
              daysRemaining: termDays,
              totalDays: termDays,
              dailyPayment: dailyPayment
          });
      }
      
      player.customers.push({
          id: customerId,
          name: customerName,
          phone: customerPhone,
          dealType: dealType,
          originalCost: car.buyPrice,
          purchasePrice: cashProceeds,
          carInfo: {
              year: car.year,
              make: car.make,
              model: car.model,
              vin: car.vin
          },
          purchaseDay: gameState.day
      });

      // If the player bought this car using the Floor Plan, they must pay it off when sold!
      if (player.floorPlanDebt >= car.buyPrice) {
          player.floorPlanDebt -= car.buyPrice;
          player.money -= car.buyPrice; // Pay off bank instantly regardless of deal structure
      }

      // Remove car from inventory
      player.inventory.splice(carIndex, 1);
      
      // Adjust Reputation based on Car Condition vs Agent Knowledge
      if (car.condition < 70 && agent.knowledge < 50) {
          // Sold a lemon to a naive buyer
          player.reputation = Math.max(0, (player.reputation || 50) - 10);
      } else if (car.condition >= 90) {
          player.reputation = Math.min(100, (player.reputation || 50) + 5);
      }
      
      agent.state = 'left';
      
      broadcastState(io, gameState);
  });

  socket.on('end_day', () => {
    if (socket.id === gameState.hostId) {
        // Throttle: the host should not be able to fast-forward the economy by
        // spamming end_day. Allow at most one advance every 2 seconds.
        const now = Date.now();
        if (now - lastEndDayAt < 2000) return;
        lastEndDayAt = now;
        economyTick();
        saveGameState();
    }
  });

  socket.on('toggle_employee', ({ role }) => {
      const player = gameState.players[socket.id];
      if (!player) return;
      if (!player.employees) player.employees = { mechanic: false, salesperson: false, financeManager: false };
      
      player.employees[role as keyof typeof player.employees] = !player.employees[role as keyof typeof player.employees];
      broadcastState(io, gameState);
  });

  socket.on('upgrade_lot', () => {
      const player = gameState.players[socket.id];
      if (!player) return;
      
      if (player.lotScale === 'Small' && player.money >= 50000) {
          player.money -= 50000;
          player.lotScale = 'Medium';
      } else if (player.lotScale === 'Medium' && player.money >= 150000) {
          player.money -= 150000;
          player.lotScale = 'Large';
      }
      broadcastState(io, gameState);
  });

  socket.on('request_inspection', ({ carId }) => {
      const player = gameState.players[socket.id];
      if (!player) return;
      const car = player.inventory.find(c => c.id === carId);
      if (!car || car.titleStatus !== 'Salvage' || car.inspectionStatus === 'Pending') return;
      if (!car.safetyPassed) return; // NC: must clear safety + emissions before a rebuilt retitle

      if (car.bodyCondition >= 95 && car.mechanicCondition >= 95 && player.money >= 250) {
          player.money -= 250;
          player.balanceSheet.totalExpenses += 250;
          player.balanceSheet.lastTickExpense += 250;
          car.inspectionStatus = 'Pending';
          car.inspectionRequestedDay = gameState.day;
          broadcastState(io, gameState);
      }
  });

  socket.on('order_repo', ({ contractId }) => {
      const player = gameState.players[socket.id];
      if (!player) return;
      const contract = player.contracts.find(c => c.id === contractId);
      if (!contract || !contract.isDelinquent || contract.repoStatus === 'Pending') return;

      const repoCost = 400;
      if (player.money >= repoCost) {
          player.money -= repoCost;
          player.balanceSheet.totalExpenses += repoCost;
          player.balanceSheet.lastTickExpense += repoCost;
          contract.repoStatus = 'Pending';
          contract.repoRequestedDay = gameState.day;
          broadcastState(io, gameState);
      }
  });

  socket.on('set_marketing_tier', ({ tier }) => {
      const player = gameState.players[socket.id];
      if (player && ['Craigslist', 'MetaAds', 'Autotrader'].includes(tier)) {
          player.marketingTier = tier;
          broadcastState(io, gameState);
      }
  });

  socket.on('perform_specific_repair', ({ carId, repairId }) => {
      const player = gameState.players[socket.id];
      if (!player) return;
      const car = player.inventory.find(c => c.id === carId);
      if (!car || !car.activeRepairs) return;

      const issueIdx = car.activeRepairs.findIndex((r: any) => r.id === repairId);
      if (issueIdx === -1) return;

      const issue = car.activeRepairs[issueIdx];

      const hasPart = (player.partsInventory[issue.partName] || 0) > 0;
      let cost = hasPart ? 0 : issue.cost;

      // Master Mechanic reduces cash cost by 20%
      if (player.employees?.mechanic && cost > 0) {
          cost = Math.floor(cost * 0.8);
      }

      if (player.money >= cost) {
          if (hasPart) {
              player.partsInventory[issue.partName] -= 1;
          } else {
              player.money -= cost;
              player.balanceSheet.totalExpenses += cost;
              player.balanceSheet.lastTickExpense += cost;
          }

          // 15% chance for a repair to fail UNLESS you have a Master Mechanic
          const failChance = player.employees?.mechanic ? 0 : 0.15;
          if (Math.random() > failChance) {
              // Success!
              if (issue.type === 'body') {
                  car.bodyCondition = Math.min(100, car.bodyCondition + issue.conditionImpact);
              } else {
                  car.mechanicCondition = Math.min(100, car.mechanicCondition + issue.conditionImpact);
              }
              
              car.condition = Math.floor((car.bodyCondition + car.mechanicCondition) / 2);
              car.activeRepairs.splice(issueIdx, 1);
          } else {
              // Failure! The money/part is consumed but the repair stays active.
              // Optional: Send a notification event, but for now it just fails silently in state.
          }

          broadcastState(io, gameState);
      }
  });

  socket.on('buy_part', ({ partName, cost }) => {
      const player = gameState.players[socket.id];
      if (player && player.money >= cost) {
          player.money -= cost;
          player.balanceSheet.totalExpenses += cost;
          player.balanceSheet.lastTickExpense += cost;
          player.partsInventory[partName] = (player.partsInventory[partName] || 0) + 1;
          broadcastState(io, gameState);
      }
  });

  socket.on('buy_scrap_car', (carId) => {
      const player = gameState.players[socket.id];
      if (!player) return;
      const index = gameState.junkyard.findIndex(c => c.id === carId);
      if (index === -1) return;
      
      const car = gameState.junkyard[index];
      if (player.money >= car.buyPrice) {
          player.money -= car.buyPrice;
          player.balanceSheet.totalExpenses += car.buyPrice;
          player.balanceSheet.lastTickExpense += car.buyPrice;
          car.ownerId = player.id;
          const unparkedCount = player.inventory.filter(c => !c.isProcessed).length;
          car.lotPosition = { 
               x: player.lotPosition.x - 40, 
               z: player.lotPosition.z + 15 + (unparkedCount * 6), 
               r: 0 
          };
          player.inventory.push(car);
          gameState.junkyard.splice(index, 1);
          broadcastState(io, gameState);
      }
  });

  socket.on('scrap_car', (carId) => {
      const player = gameState.players[socket.id];
      if (!player) return;
      
      const carIndex = player.inventory.findIndex(c => c.id === carId);
      if (carIndex === -1) return;
      
      // Scrap Value
      const scrapValue = 500;
      player.money += scrapValue;
      player.balanceSheet.totalIncome += scrapValue;
      player.balanceSheet.lastTickIncome += scrapValue;
      
      // Grant 3 to 6 random parts
      const numParts = 3 + Math.floor(Math.random() * 4);
      for(let i=0; i<numParts; i++) {
          const isBody = Math.random() > 0.5;
          const lib = isBody ? BODY_LIB : MECHANIC_LIB;
          const randomPart = lib[Math.floor(Math.random() * lib.length)].partName;
          player.partsInventory[randomPart] = (player.partsInventory[randomPart] || 0) + 1;
      }
      
      player.inventory.splice(carIndex, 1);
      broadcastState(io, gameState);
  });

  socket.on('pay_floor_plan', ({ amount }) => {
      const player = gameState.players[socket.id];
      if (player && player.money >= amount && player.floorPlanDebt > 0) {
          player.money -= amount;
          player.floorPlanDebt = Math.max(0, player.floorPlanDebt - amount);
          
          // Log as financing expense
          player.balanceSheet.totalExpenses += amount;
          player.balanceSheet.lastTickExpense += amount;
          broadcastState(io, gameState);
      }
  });

  socket.on('take_title_loan', ({ carId }) => {
      const player = gameState.players[socket.id];
      if (!player) return;
      const car = player.inventory.find((c: any) => c.id === carId);
      if (car && !car.isLienActive && !car.isProcessed) {
          // Calculate max collateral value precisely as 80% LTV of extrapolated retail!
          const mechanicImpact = car.mechanicCondition / 100;
          const bodyImpact = car.bodyCondition / 100;
          const accidentPenalty = car.accidents > 0 ? 0.70 : 1.0;
          const mileagePenalty = Math.max(0.3, 1.0 - (car.mileage / 300000));
          
          let marketVal = (car.basePrice || car.buyPrice) * mechanicImpact * bodyImpact * accidentPenalty * mileagePenalty;
          
          let maxAdvance = marketVal * 0.8; // 80% Loan to Value
          
          // Special Program Modifiers
          if (car.accidents === 0 || typeof car.accidents === 'undefined') maxAdvance += 2000;
          if (car.mileage < 50000) maxAdvance += 500;
          if (car.bodyCondition > 90 && car.mechanicCondition > 90) maxAdvance += 1500;
          if (car.titleStatus === 'Salvage') maxAdvance -= 5000; 

          maxAdvance = Math.floor(Math.max(100, maxAdvance));

          car.isLienActive = true;
          player.money += maxAdvance;
          // Apply origination fee 5% mapped into Floor Plan Debt
          player.floorPlanDebt += (maxAdvance * 1.05);

          player.balanceSheet.totalIncome += maxAdvance;
          player.balanceSheet.lastTickIncome += maxAdvance;
          broadcastState(io, gameState);
      }
  });

  socket.on('buy_psi', (carId) => {
      const player = gameState.players[socket.id];
      if (!player) return;
      const index = gameState.market.findIndex(c => c.id === carId);
      if (index === -1) return;
      
      const car = gameState.market[index];
      if (!car.psiRevealed && player.money >= 250) {
          player.money -= 250;
          player.balanceSheet.totalExpenses += 250;
          player.balanceSheet.lastTickExpense += 250;
          car.psiRevealed = true;
          broadcastState(io, gameState);
      }
  });

  socket.on('register_vehicle', (carId) => {
      const player = gameState.players[socket.id];
      if (!player) return;
      const car = player.inventory.find(c => c.id === carId);
      if (car && !car.isRegistered && player.money >= 150) {
          player.money -= 150;
          player.balanceSheet.totalExpenses += 150;
          player.balanceSheet.lastTickExpense += 150;
          car.isRegistered = true;
          broadcastState(io, gameState);
      }
  });

  // NC Step 1 — dealer safety pre-inspection (free): reveals the punch list.
  socket.on('pre_inspect', ({ carId }) => {
      const player = gameState.players[socket.id];
      if (!player) return;
      const car = player.inventory.find(c => c.id === carId);
      if (car && !car.preInspected) {
          car.preInspected = true;
          broadcastState(io, gameState);
      }
  });

  // NC Step 2 — official Safety + Emissions inspection. Fee is charged whether it
  // passes or fails (a failed inspection still costs the station visit).
  socket.on('final_inspect', ({ carId }) => {
      const player = gameState.players[socket.id];
      if (!player) return;
      const car = player.inventory.find(c => c.id === carId);
      if (!car || !car.preInspected || car.safetyPassed) return;
      const fee = SAFETY_FEE + (emissionsRequired(car) ? EMISSIONS_FEE : 0);
      if (player.money < fee) return;
      player.money -= fee;
      player.balanceSheet.totalExpenses += fee;
      player.balanceSheet.lastTickExpense += fee;
      // NC safety pass: brakes/steering/mechanical sound (>=70) and structurally safe body (>=50)
      if (car.mechanicCondition >= 70 && car.bodyCondition >= 50) {
          car.safetyPassed = true;
      }
      broadcastState(io, gameState);
  });

  // Market BUY — fills from the cheapest peer asks first, then the platform
  // market-maker (treasury) at the fundamental + spread.
  socket.on('buy_shares', ({ vehicleId, quantity }) => {
      const player = gameState.players[socket.id];
      if (!player) return;
      const v = gameState.fractionalMarket.find(f => f.id === vehicleId);
      let qty = Math.floor(Number(quantity));
      if (!v || v.status !== 'trading' || !Number.isFinite(qty) || qty <= 0) return;
      const fundamental = v.underlyingValue / v.totalShares;
      const mmAsk = fundamental * (1 + MM_SPREAD);
      if (!player.shareHoldings) player.shareHoldings = {};
      const h = player.shareHoldings[vehicleId] || { shares: 0, invested: 0 };
      let lastFill = v.lastPrice;
      let guard = 0;
      while (qty > 0 && guard++ < 5000) {
          v.asks.sort((a, b) => a.price - b.price);
          const bestAsk = v.asks[0];
          const useAsk = !!bestAsk && bestAsk.price <= mmAsk && bestAsk.sellerId !== player.id;
          const unitPrice = useAsk ? bestAsk!.price : mmAsk;
          const available = useAsk ? bestAsk!.qty : v.treasuryShares;
          if (available <= 0) { if (useAsk) { v.asks.shift(); continue; } else break; }
          if (player.money < unitPrice) break;
          const n = Math.min(qty, available, Math.floor(player.money / unitPrice));
          if (n <= 0) break;
          const cost = n * unitPrice;
          player.money -= cost;
          h.shares += n; h.invested += cost;
          lastFill = unitPrice;
          if (useAsk) {
              const seller = gameState.players[bestAsk!.sellerId];
              if (seller) { seller.money += cost; seller.balanceSheet.totalIncome += cost; seller.balanceSheet.lastTickIncome += cost; }
              bestAsk!.basis = bestAsk!.basis * (1 - n / bestAsk!.qty);
              bestAsk!.qty -= n;
              if (bestAsk!.qty <= 0) v.asks.shift();
          } else {
              v.treasuryShares -= n;
              if (v.issuerId !== 'platform') {
                  const issuer = gameState.players[v.issuerId];
                  if (issuer) { issuer.money += cost; issuer.balanceSheet.totalIncome += cost; issuer.balanceSheet.lastTickIncome += cost; }
              }
          }
          qty -= n;
      }
      player.shareHoldings[vehicleId] = h;
      if (h.shares <= 0 && h.invested <= 0) delete player.shareHoldings[vehicleId];
      v.lastPrice = lastFill;
      v.priceHistory.push(round2(lastFill));
      if (v.priceHistory.length > 30) v.priceHistory.shift();
      broadcastState(io, gameState);
  });

  // Market SELL — instant liquidity to the platform market-maker at fundamental - spread.
  socket.on('sell_shares', ({ vehicleId, quantity }) => {
      const player = gameState.players[socket.id];
      if (!player || !player.shareHoldings) return;
      const v = gameState.fractionalMarket.find(f => f.id === vehicleId);
      const h = player.shareHoldings[vehicleId];
      const qty = Math.floor(Number(quantity));
      if (!v || v.status !== 'trading' || !h || !Number.isFinite(qty) || qty <= 0 || qty > h.shares) return;
      const fundamental = v.underlyingValue / v.totalShares;
      const mmBid = fundamental * (1 - MM_SPREAD);
      const proceeds = qty * mmBid;
      h.invested -= (h.invested / h.shares) * qty;
      h.shares -= qty;
      if (h.shares <= 0) delete player.shareHoldings[vehicleId];
      player.money += proceeds;
      player.balanceSheet.totalIncome += proceeds;
      player.balanceSheet.lastTickIncome += proceeds;
      v.treasuryShares += qty; // market-maker absorbs into treasury
      v.lastPrice = mmBid;
      v.priceHistory.push(round2(mmBid));
      if (v.priceHistory.length > 30) v.priceHistory.shift();
      broadcastState(io, gameState);
  });

  // Post a peer sell listing (limit ask) — shares are escrowed out of holdings.
  socket.on('list_shares', ({ vehicleId, quantity, price }) => {
      const player = gameState.players[socket.id];
      if (!player || !player.shareHoldings) return;
      const v = gameState.fractionalMarket.find(f => f.id === vehicleId);
      const h = player.shareHoldings[vehicleId];
      const qty = Math.floor(Number(quantity));
      const px = Number(price);
      if (!v || v.status !== 'trading' || !h || !Number.isFinite(qty) || qty <= 0 || qty > h.shares || !Number.isFinite(px) || px <= 0) return;
      const basis = (h.invested / h.shares) * qty;
      h.shares -= qty; h.invested -= basis;
      if (h.shares <= 0) delete player.shareHoldings[vehicleId];
      v.asks.push({ id: `ask-${Date.now()}-${Math.floor(Math.random() * 1000)}`, sellerId: player.id, price: px, qty, basis });
      broadcastState(io, gameState);
  });

  // Cancel one of your own listings — shares return to your holdings.
  socket.on('cancel_listing', ({ vehicleId, orderId }) => {
      const player = gameState.players[socket.id];
      if (!player) return;
      const v = gameState.fractionalMarket.find(f => f.id === vehicleId);
      if (!v) return;
      const idx = v.asks.findIndex(a => a.id === orderId && a.sellerId === player.id);
      if (idx === -1) return;
      const ask = v.asks[idx];
      if (!player.shareHoldings) player.shareHoldings = {};
      const h = player.shareHoldings[vehicleId] || { shares: 0, invested: 0 };
      h.shares += ask.qty; h.invested += ask.basis;
      player.shareHoldings[vehicleId] = h;
      v.asks.splice(idx, 1);
      broadcastState(io, gameState);
  });

  // Fractionalize one of your own lot vehicles into a new SPV. You become the
  // issuer and hold all treasury shares; selling them raises cash.
  socket.on('fractionalize_car', ({ carId, shares }) => {
      const player = gameState.players[socket.id];
      if (!player) return;
      const idx = player.inventory.findIndex(c => c.id === carId);
      if (idx === -1) return;
      const car = player.inventory[idx];
      const totalShares = Math.max(100, Math.min(10000, Math.floor(Number(shares)) || 1000));
      const value = Math.max(500, car.estimatedMMR || car.buyPrice || 5000);
      player.inventory.splice(idx, 1);
      const fundamental = value / totalShares;
      gameState.fractionalMarket.push({
          id: `frac-${player.id.substring(0, 4)}-${Date.now()}`,
          year: car.year, make: car.make, model: car.model, vin: car.vin, mileage: car.mileage,
          condition: undefined,
          issuerId: player.id,
          underlyingValue: value,
          totalShares,
          treasuryShares: totalShares,
          dailyYield: Math.round(value * 0.0006),
          volatility: 0.03,
          lastPrice: round2(fundamental),
          priceHistory: Array(20).fill(round2(fundamental)),
          asks: [],
          status: 'trading'
      });
      broadcastState(io, gameState);
  });

  // Liquidate an SPV you issued — the car is sold and every shareholder is paid
  // their proportional cut of the underlying value.
  socket.on('liquidate_vehicle', ({ vehicleId }) => {
      const player = gameState.players[socket.id];
      if (!player) return;
      const v = gameState.fractionalMarket.find(f => f.id === vehicleId);
      if (!v || v.issuerId !== player.id || v.status !== 'trading') return;
      const perShare = v.underlyingValue / v.totalShares;
      // pay shareholders
      Object.values(gameState.players).forEach(p => {
          const h = p.shareHoldings?.[vehicleId];
          if (h && h.shares > 0) {
              const payout = h.shares * perShare;
              p.money += payout; p.balanceSheet.totalIncome += payout; p.balanceSheet.lastTickIncome += payout;
              delete p.shareHoldings![vehicleId];
          }
      });
      // pay shares parked in open listings back to their sellers
      v.asks.forEach(a => {
          const seller = gameState.players[a.sellerId];
          if (seller) { const payout = a.qty * perShare; seller.money += payout; seller.balanceSheet.totalIncome += payout; seller.balanceSheet.lastTickIncome += payout; }
      });
      // issuer keeps the value of unsold treasury shares
      const issuerPayout = v.treasuryShares * perShare;
      player.money += issuerPayout; player.balanceSheet.totalIncome += issuerPayout; player.balanceSheet.lastTickIncome += issuerPayout;
      v.status = 'liquidated';
      gameState.fractionalMarket = gameState.fractionalMarket.filter(f => f.id !== vehicleId);
      broadcastState(io, gameState);
  });

  socket.on('buy_insurance', ({ type }) => {
      const player = gameState.players[socket.id];
      if (!player) return;
      if (!player.insurance) player.insurance = { liability: false, inventory: false, gap: false };
      if (type === 'liability' || type === 'inventory' || type === 'gap') {
          player.insurance[type] = true;
          broadcastState(io, gameState);
      }
  });

  socket.on('cancel_insurance', ({ type }) => {
      const player = gameState.players[socket.id];
      if (!player || !player.insurance) return;
      if (type === 'liability' || type === 'inventory' || type === 'gap') {
          player.insurance[type] = false;
          broadcastState(io, gameState);
      }
  });

  socket.on('disconnect', () => {
    activeRaces.delete(socket.id);
    lastBoxAt.delete(socket.id);
    const leaving = gameState.players[socket.id];
    delete gameState.players[socket.id];
    if (gameState.hostId === socket.id) {
        const remainingPlayers = Object.keys(gameState.players);
        gameState.hostId = remainingPlayers.length > 0 ? remainingPlayers[0] : null;
    }
    if (leaving) {
        pushChat(io, { id: `${Date.now()}-l`, playerId: '', name: 'System', text: `${leaving.name} left the world`, ts: Date.now(), system: true });
    }
    broadcastState(io, gameState);
  });
});

async function startServer() {
    await loadGameState();

    if (process.env.NODE_ENV !== 'production') {
        const { createServer: createViteServer } = await import('vite');
        const vite = await createViteServer({ server: { middlewareMode: true }, appType: 'spa' });
        app.use(vite.middlewares);
    } else {
        const distDir = path.join(process.cwd(), 'dist');
        app.use(express.static(distDir));
        // SPA fallback: serve index.html for any non-asset route so refreshes /
        // deep links don't 404. (socket.io traffic is handled before Express.)
        app.get('*', (_req, res) => {
            res.sendFile(path.join(distDir, 'index.html'));
        });
    }

    const port = process.env.PORT || 3000;
    httpServer.listen(Number(port), '0.0.0.0', () => {
        console.log(`Server running on port ${port} with Economic Floor Plan Engine`);
    });
}

startServer();
