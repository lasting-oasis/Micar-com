import express from 'express';
import { createServer } from 'node:http';
import { Server } from 'socket.io';
import { createServer as createViteServer } from 'vite';
import { GameState, Car, Player, FinanceContract, CustomerAgent, DealProposal, EconomicState } from './src/types.js';
import { MECHANIC_LIB, BODY_LIB } from './src/constants.js';

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, { cors: { origin: '*' } });

let gameState: GameState = { 
    day: 1, 
    timeOfDay: 8.0, 
    players: {}, 
    market: [], 
    junkyard: [],
    economy: {
        federalInterestRate: 0.08,
        usedCarDemand: 1.0
    },
    activeWalkIns: {}
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

const calculateCleanRetail = (make: string, year: number, mileage: number) => {
    const brand = CAR_MAKES.find(m => m.name === make) || CAR_MAKES[0];
    const age = Math.max(0, 2024 - year);
    
    // 12% standard annual depreciation off MSRP
    let cleanRetail = brand.msrp * Math.pow(0.88, age);
    
    // Mileage adjustment (10 cents per mile penalty over average 12k/yr)
    const expectedMileage = age * 12000;
    const mileagePenalty = Math.max(0, mileage - expectedMileage) * 0.10;
    cleanRetail -= mileagePenalty;
    
    return Math.max(2000, cleanRetail); // Absolute minimum clean retail floor
};

// Generate random cars
const generateMarketCars = () => {
    gameState.market = Array(4).fill(0).map((_, i) => {
      const isRebuilt = Math.random() < 0.2; // 20% chance
      const isSalvage = Math.random() < 0.05; // 5% chance
      const titleStatus = isSalvage ? 'Salvage' : (isRebuilt ? 'Rebuilt' : 'Clean');
      
      const year = 2012 + Math.floor(Math.random() * 12);
      const brand = CAR_MAKES[Math.floor(Math.random() * CAR_MAKES.length)];
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
        model: 'Sedan',
        year: year,
        condition: condition,
        bodyCondition: bodyCondition,
        mechanicCondition: mechanicCondition,
        mileage: mileage,
        buyPrice: Math.floor(buyPrice),
        estimatedMMR: Math.floor(mmr),
        psiRevealed: false,
        color: ['#ff0000', '#0000ff', '#10b981', '#ffffff', '#222222'][Math.floor(Math.random()*5)],
        ownerId: null,
        daysOnLot: 0,
        titleStatus: titleStatus,
        activeRepairs: activeRepairs,
        auctionSeller: auctionSeller,
        vin: generateVIN(),
        isRegistered: false
      };
    });
    io.emit('update', gameState);
};

const generateJunkyardCars = () => {
    gameState.junkyard = Array(3).fill(0).map((_, i) => {
      const year = 1995 + Math.floor(Math.random() * 15);
      const makes = ['Toyota', 'Ford', 'Honda', 'Chevrolet', 'Nissan'];
      const make = makes[Math.floor(Math.random() * makes.length)];
      const model = 'Scrap Shell';
      
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
    io.emit('update', gameState);
};

// Economic Tick: 1 Day = 10 Seconds
const economyTick = () => {
    gameState.day += 1;
    gameState.timeOfDay = 8.0;

    // Macro-economy fluctuations
    gameState.economy.federalInterestRate += (Math.random() * 0.01) - 0.005;
    gameState.economy.federalInterestRate = Math.max(0.02, Math.min(0.15, gameState.economy.federalInterestRate)); // 2% to 15% limits
    
    gameState.economy.usedCarDemand += (Math.random() * 0.1) - 0.05;
    gameState.economy.usedCarDemand = Math.max(0.7, Math.min(1.3, gameState.economy.usedCarDemand)); // 70% to 130% baseline
    
    // Process business logic for all players

    Object.values(gameState.players).forEach(p => {
        let dailyIncome = 0;
        let dailyExpense = 0;

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
                                ownerId: p.id
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
        
        // Reputation scales volume
        const repMultiplier = (p.reputation || 50) / 50; 
        let finalVolume = Math.max(0, Math.floor((walkInVolume + Math.floor(Math.random() * 2)) * repMultiplier));
        
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
    });

    if (gameState.day % 6 === 0 || gameState.market.length === 0) {
        generateMarketCars();
        generateJunkyardCars();
    }
    
    io.emit('update', gameState);
};

generateMarketCars();
generateJunkyardCars();

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
    socket.on('join', ({ name, lotScale }) => {
      const playerCount = Object.keys(gameState.players).length;
      const x = (playerCount % 5) * 250;
      const z = Math.floor(playerCount / 5) * -250;

    let initMoney = 25000;
    if (lotScale === 'Medium') initMoney = 75000;
    if (lotScale === 'Large') initMoney = 250000;

    gameState.players[socket.id] = { 
        id: socket.id, 
        name: name || `Dealer_${socket.id.substring(0,4)}`, 
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
        balanceSheet: { totalIncome: 0, totalExpenses: 0, lastTickIncome: 0, lastTickExpense: 0 }
    };
    socket.emit('init', { id: socket.id, state: gameState });
    io.emit('update', gameState);
  });

  socket.on('buy_car', ({ carId, useFinancing }) => {
    const player = gameState.players[socket.id];
    const carIndex = gameState.market.findIndex(c => c.id === carId);
    if(carIndex !== -1 && player && player.inventory.length < 10) {
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
                 x: -40, 
                 z: 15 + (unparkedCount * 6), 
                 r: 0 
            };
            player.inventory.push(car);
            gameState.market.splice(carIndex, 1);
            io.emit('update', gameState);
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
                 x: -40, 
                 z: 15 + (unparkedCount * 6), 
                 r: 0 
            };
            player.inventory.push(car);
            gameState.market.splice(carIndex, 1);
            io.emit('update', gameState);
        }
    }
  });

  socket.on('sync_car_pos', ({ carId, position }) => {
     const player = gameState.players[socket.id];
     if (!player) return;
     const car = player.inventory.find(c => c.id === carId);
     if (car) car.lotPosition = position;
  });

  socket.on('sync_player_pos', (pos) => {
      if (gameState.players[socket.id]) {
          gameState.players[socket.id].worldPosition = pos;
      }
  });

  socket.on('wash_car', (carId) => {
     const player = gameState.players[socket.id];
     if (!player) return;
     const car = player.inventory.find(c => c.id === carId);
     if (car) {
         car.isDirty = false;
         io.emit('update', gameState);
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
         io.emit('update', gameState);
     }
  });

  socket.on('place_on_lot', (carId) => {
     const player = gameState.players[socket.id];
     if (!player) return;
     const car = player.inventory.find(c => c.id === carId);
     if (car && !car.isDirty) {
         car.isProcessed = true;
         io.emit('update', gameState);
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
      
      io.emit('update', gameState);
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
      io.emit('update', gameState);
  });

  socket.on('reject_deal', ({ agentId }) => {
      const player = gameState.players[socket.id];
      if (!player) return;
      const agents = gameState.activeWalkIns[player.id];
      const agent = agents?.find(a => a.id === agentId);
      if (agent) {
          agent.state = 'left';
          agent.activeProposal = undefined;
          io.emit('update', gameState);
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
      if (!car.isRegistered) return; // Cannot sell unregistered cars

      const proposal = agent.activeProposal;
      const dealType = proposal.dealType;
      
      let finalPrincipal = proposal.totalValue;

      if (tradeIn && tradeIn.active) {
          const allowance = tradeIn.tradeValue;
          finalPrincipal = Math.max(0, finalPrincipal - allowance);

          // Add trade in to inventory
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
              ownerId: player.id
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
          // Subprime BHPH Deal: Massive interest, paid over time, high default risk
          const termDays = 30; // 30 game days
          const interestRate = 0.25; // 25% APR equivalent
          const amountFinanced = finalPrincipal - cashProceeds; // Remaining after down-payment
          const totalYield = amountFinanced * (1 + interestRate);
          const dailyPayment = Math.floor(totalYield / termDays);
          
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
      
      io.emit('update', gameState);
  });

  socket.on('end_day', () => {
    economyTick();
  });

  socket.on('toggle_employee', ({ role }) => {
      const player = gameState.players[socket.id];
      if (!player) return;
      if (!player.employees) player.employees = { mechanic: false, salesperson: false, financeManager: false };
      
      player.employees[role as keyof typeof player.employees] = !player.employees[role as keyof typeof player.employees];
      io.emit('update', gameState);
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
      io.emit('update', gameState);
  });

  socket.on('request_inspection', ({ carId }) => {
      const player = gameState.players[socket.id];
      if (!player) return;
      const car = player.inventory.find(c => c.id === carId);
      if (!car || car.titleStatus !== 'Salvage' || car.inspectionStatus === 'Pending') return;

      if (car.bodyCondition >= 95 && car.mechanicCondition >= 95 && player.money >= 250) {
          player.money -= 250;
          player.balanceSheet.totalExpenses += 250;
          player.balanceSheet.lastTickExpense += 250;
          car.inspectionStatus = 'Pending';
          car.inspectionRequestedDay = gameState.day;
          io.emit('update', gameState);
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
          io.emit('update', gameState);
      }
  });

  socket.on('set_marketing_tier', ({ tier }) => {
      const player = gameState.players[socket.id];
      if (player && ['Craigslist', 'MetaAds', 'Autotrader'].includes(tier)) {
          player.marketingTier = tier;
          io.emit('update', gameState);
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

          io.emit('update', gameState);
      }
  });

  socket.on('buy_part', ({ partName, cost }) => {
      const player = gameState.players[socket.id];
      if (player && player.money >= cost) {
          player.money -= cost;
          player.balanceSheet.totalExpenses += cost;
          player.balanceSheet.lastTickExpense += cost;
          player.partsInventory[partName] = (player.partsInventory[partName] || 0) + 1;
          io.emit('update', gameState);
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
          player.inventory.push(car);
          gameState.junkyard.splice(index, 1);
          io.emit('update', gameState);
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
      io.emit('update', gameState);
  });

  socket.on('pay_floor_plan', ({ amount }) => {
      const player = gameState.players[socket.id];
      if (player && player.money >= amount && player.floorPlanDebt > 0) {
          player.money -= amount;
          player.floorPlanDebt = Math.max(0, player.floorPlanDebt - amount);
          
          // Log as financing expense
          player.balanceSheet.totalExpenses += amount;
          player.balanceSheet.lastTickExpense += amount;
          io.emit('update', gameState);
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
          io.emit('update', gameState);
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
          io.emit('update', gameState);
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
          io.emit('update', gameState);
      }
  });

  socket.on('disconnect', () => {
    delete gameState.players[socket.id];
    io.emit('update', gameState);
  });
});

async function startServer() {
    if (process.env.NODE_ENV !== 'production') {
        const vite = await createViteServer({ server: { middlewareMode: true }, appType: 'spa' });
        app.use(vite.middlewares);
    } else {
        app.use(express.static('dist'));
    }

    const port = process.env.PORT || 3000;
    httpServer.listen(Number(port), '0.0.0.0', () => {
        console.log(`Server running on port ${port} with Economic Floor Plan Engine`);
    });
}

startServer();
