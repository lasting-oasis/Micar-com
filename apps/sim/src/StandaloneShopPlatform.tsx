import React, { useState, useEffect, useRef } from 'react';
import { 
  Activity, Wrench, ShieldCheck, Plus, Play, ChevronRight, Clock, Trash2, 
  Users, Gauge, Terminal, CheckCircle2, Sparkles 
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { useGameStore } from './store';

// Defect types for standalone shop simulation
const STANDALONE_DEFECTS = {
  'P0302': { code: 'P0302', label: 'Cylinder 2 Misfire', type: 'mechanic', desc: 'Active cylinder 2 spark plug or ignition coil failure.', icon: '⚡' },
  'P0700': { code: 'P0700', label: 'Gearbox Sync Wear', type: 'mechanic', desc: 'Transmission gear grinding or solenoid valve alignment failure.', icon: '⚙️' },
  'P0011': { code: 'P0011', label: 'VVT Timing Over-Advanced', type: 'mechanic', desc: 'Camshaft actuator misalignment or timing chain tension loss.', icon: '⏱️' },
  'P0171': { code: 'P0171', label: 'System Too Lean', type: 'mechanic', desc: 'Excess air ingestion or secondary fuel delivery failure.', icon: '⛽' },
  'P0420': { code: 'P0420', label: 'Catalytic Failure', type: 'mechanic', desc: 'Exhaust toxic gas emissions exceeding environmental thresholds.', icon: '💨' },
  'B-DENT': { code: 'B-DENT', label: 'Quarter Panel Dent', type: 'body', desc: 'Significant structural dent on rear quarter panel chassis.', icon: '🔨' },
  'B-PAINT': { code: 'B-PAINT', label: 'Clear Coat Sun Fade', type: 'body', desc: 'Paint clear coat peeling or fading due to climate exposure.', icon: '🎨' },
  'B-RUST': { code: 'B-RUST', label: 'Sill Plate Rust Corrosion', type: 'body', desc: 'Oxygenated steel corrosion along chassis frame sill plates.', icon: '⚠️' }
};

interface ShopJob {
  roId: string;
  customerName: string;
  vehicle: string;
  vin: string;
  defectCode: keyof typeof STANDALONE_DEFECTS;
  stage: number; // 0: Intake, 1: Diagnostics, 2: Repair, 3: QC, 4: Ready
  progress: number; // 0 to 100 within stage
  techAssigned: string;
  logs: string[];
  realCarId?: string;      // links this job to a real inventory vehicle
  realFaultIds?: string[]; // the real fault ids to repair when the order completes
  insurance?: boolean;     // DRP / insurance-company job — pays a premium
}

interface SimulatedShop {
  id: string;
  name: string;
  type: 'mechanic' | 'body' | 'dual';
  capacity: number;
  techTier: 'Junior' | 'Senior' | 'Master';
  hourlyRate: number;
  activeJobs: ShopJob[];
  waitQueue: Omit<ShopJob, 'stage' | 'progress' | 'techAssigned' | 'logs'>[];
  revenue: number;
}

export default function StandaloneShopPlatform() {
  const { playerId, gameState } = useGameStore();
  const me = gameState?.players[playerId || ''];

  const [activeView, setActiveView] = useState<'directory' | 'operator' | 'tracker'>('directory');
  const [selectedShopId, setSelectedShopId] = useState<string>('shop-1');
  const [searchRo, setSearchRo] = useState<string>('');
  const [trackerJob, setTrackerJob] = useState<ShopJob | null>(null);

  // Shop Creator States
  const [newShopName, setNewShopName] = useState('');
  const [newShopType, setNewShopType] = useState<'mechanic' | 'body' | 'dual'>('mechanic');
  const [newShopCap, setNewShopCap] = useState<number>(4);
  const [showCreator, setShowCreator] = useState(false);
  const [showVehiclePicker, setShowVehiclePicker] = useState(false);

  // Initial State setup
  const [shops, setShops] = useState<SimulatedShop[]>([]);
  const hasInitialized = useRef(false);

  // Initialize standard shops + dynamic player shop
  useEffect(() => {
    if (hasInitialized.current) return;
    
    const initialShops: SimulatedShop[] = [
      {
        id: 'shop-1',
        name: 'Apex Precision Mechanical',
        type: 'mechanic',
        capacity: 4,
        techTier: 'Master',
        hourlyRate: 125,
        activeJobs: [
          {
            roId: 'RO-5001',
            customerName: 'Marcus Miller',
            vehicle: '2019 Chevrolet Corvette C8',
            vin: '1G1YB2D47L510901A',
            defectCode: 'P0302',
            stage: 2,
            progress: 35,
            techAssigned: 'Marcus A.',
            logs: [
              '[12:00] Vehicle clocked in at mechanical intake bay.',
              '[12:01] Connection established to CAN-Bus module.',
              '[12:02] Flagged fault code P0302 Cylinder 2 Misfire.',
              '[12:04] Spark plug removed. Worn electrode detected. Swapping cylinder parts...'
            ]
          },
          {
            roId: 'RO-5002',
            customerName: 'Sarah Jenkins',
            vehicle: '2018 Ford Mustang GT',
            vin: '1FA6P8CF3J519280B',
            defectCode: 'P0700',
            stage: 1,
            progress: 80,
            techAssigned: 'Dave K.',
            logs: [
              '[12:05] Vehicle entered lift bay 2.',
              '[12:06] Initiating dashboard systems scanner check.',
              '[12:07] Transmission pressure solenoid mismatch flag P0700 active.'
            ]
          }
        ],
        waitQueue: [
          {
            roId: 'RO-5003',
            customerName: 'William Vance',
            vehicle: '2022 BMW M3 Competition',
            vin: 'WBA5R1C00N518330C',
            defectCode: 'P0011'
          }
        ],
        revenue: 1250
      },
      {
        id: 'shop-2',
        name: 'ProCoat Custom Paint & Body',
        type: 'body',
        capacity: 4,
        techTier: 'Senior',
        hourlyRate: 110,
        activeJobs: [
          {
            roId: 'RO-7001',
            customerName: 'David Chang',
            vehicle: '2021 Toyota Supra GR',
            vin: 'JTDBZ4DB3M19028A1',
            defectCode: 'B-DENT',
            stage: 3,
            progress: 15,
            techAssigned: 'Hector G.',
            logs: [
              '[11:45] Check-in bumper and quarter panels.',
              '[11:46] Sanding down paint overlay surface.',
              '[11:55] Structural puller service applied to restore frame geometry.'
            ]
          }
        ],
        waitQueue: [
          {
            roId: 'RO-7002',
            customerName: 'Emma Watson',
            vehicle: '2015 Honda Civic Coupe',
            vin: '1HGCP2F81F19028B2',
            defectCode: 'B-PAINT'
          }
        ],
        revenue: 980
      }
    ];

    // If the player starts as a Standalone Shop Operator, register their personal shop!
    if (me && (me as any).isStandaloneOperator) {
      const spec = (me as any).shopSpecialty || 'dual';
      const name = me.name || 'Your Service Center';
      const startingCapital = me.money;

      initialShops.unshift({
        id: 'shop-player',
        name: `${name} (Your Shop)`,
        type: spec,
        capacity: spec === 'dual' ? 4 : 2,
        techTier: 'Junior',
        hourlyRate: spec === 'mechanic' ? 120 : spec === 'body' ? 100 : 130,
        activeJobs: [],
        waitQueue: [],
        revenue: startingCapital
      });
      setSelectedShopId('shop-player');
    }

    setShops(initialShops);
    hasInitialized.current = true;
  }, [me]);

  // Background Simulator Engine Loop
  useEffect(() => {
    const interval = setInterval(() => {
      setShops(prevShops => 
        prevShops.map(shop => {
          let updatedActive = [...shop.activeJobs];
          let updatedQueue = [...shop.waitQueue];

          // 1. Advance progress for all active jobs
          updatedActive = updatedActive.map(job => {
            let nextProgress = job.progress + (shop.techTier === 'Master' ? 12 : shop.techTier === 'Senior' ? 8 : 5);
            let nextStage = job.stage;
            let logs = [...job.logs];

            if (nextProgress >= 100) {
              if (job.stage < 4) {
                nextStage += 1;
                nextProgress = 0;
                
                // Add log updates depending on the stage transition
                if (nextStage === 1) {
                  logs.push(`[LOG] Initiating electronic system OBD-II scanner modules check.`);
                } else if (nextStage === 2) {
                  logs.push(`[LOG] Commencing disassembly. Swapping replacement parts.`);
                } else if (nextStage === 3) {
                  logs.push(`[LOG] Reassembly complete. Placing vehicle on road dyno for QC.`);
                } else if (nextStage === 4) {
                  logs.push(`[LOG] All parameters green. Customer notified vehicle is ready.`);
                }
              } else {
                nextProgress = 100; // Cap at Ready
              }
            }

            return {
              ...job,
              progress: nextProgress,
              stage: nextStage,
              logs
            };
          });

          // 2. Auto-Intake from Queue to Active Bays if capacity allows
          while (updatedActive.length < shop.capacity && updatedQueue.length > 0) {
            const nextInQueue = updatedQueue.shift();
            if (nextInQueue) {
              updatedActive.push({
                ...nextInQueue,
                stage: 0,
                progress: 0,
                techAssigned: ['Marcus A.', 'Hector G.', 'Dave K.', 'Tyler S.'][Math.floor(Math.random() * 4)],
                logs: [`[LOG] Vehicle intakes check-in. RO created: ${nextInQueue.roId}.`]
              });
            }
          }

          // 3. Auto-Simulate incoming NPC bookings (15% chance per tick)
          if (Math.random() < 0.15 && updatedQueue.length < 5) {
            const roIndex = 8000 + Math.floor(Math.random() * 1000);
            const clients = ['Alice Vance', 'Robert Carter', 'Sophia Lin', 'Thomas Miller', 'Liam O\'Connor'];
            const cars = ['2017 Toyota Supra', '2016 Ford Sedan', '2020 Honda Civic', '2021 BMW Coupe', '2019 Chevrolet Sedan'];
            const chars = '0123456789ABCDEFGH';
            let vin = '1HG';
            for (let i = 0; i < 14; i++) vin += chars[Math.floor(Math.random() * chars.length)];

            // Filter defects based on shop type specialty
            let possibleDefects = Object.keys(STANDALONE_DEFECTS) as (keyof typeof STANDALONE_DEFECTS)[];
            if (shop.type === 'mechanic') {
              possibleDefects = possibleDefects.filter(k => STANDALONE_DEFECTS[k].type === 'mechanic');
            } else if (shop.type === 'body') {
              possibleDefects = possibleDefects.filter(k => STANDALONE_DEFECTS[k].type === 'body');
            }

            const defect = possibleDefects[Math.floor(Math.random() * possibleDefects.length)];
            const isInsurance = Math.random() < 0.3; // the insurance company feeds DRP collision work

            updatedQueue.push({
              roId: `RO-${roIndex}`,
              customerName: isInsurance ? 'Insurance Claim (DRP)' : clients[Math.floor(Math.random() * clients.length)],
              vehicle: cars[Math.floor(Math.random() * cars.length)],
              vin: vin,
              defectCode: defect,
              insurance: isInsurance
            });
          }

          return {
            ...shop,
            activeJobs: updatedActive,
            waitQueue: updatedQueue
          };
        })
      );
    }, 3000);

    return () => clearInterval(interval);
  }, [shops]);

  // Sync tracker lookup data if viewing a car in real time
  useEffect(() => {
    if (activeView === 'tracker' && trackerJob) {
      const activeShop = shops.find(s => s.activeJobs.some(j => j.roId === trackerJob.roId));
      if (activeShop) {
        const live = activeShop.activeJobs.find(j => j.roId === trackerJob.roId);
        if (live) setTrackerJob(live);
      }
    }
  }, [shops, activeView, trackerJob]);

  // Handle registering a new shop
  const handleRegisterShop = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newShopName) return;

    const newShop: SimulatedShop = {
      id: `shop-${Date.now()}`,
      name: newShopName,
      type: newShopType,
      capacity: newShopCap,
      techTier: 'Junior',
      hourlyRate: newShopType === 'mechanic' ? 120 : newShopType === 'body' ? 100 : 135,
      activeJobs: [],
      waitQueue: [],
      revenue: 0
    };

    setShops([...shops, newShop]);
    setNewShopName('');
    setShowCreator(false);
  };

  // Simulate intake drop-off manually
  const triggerManualIntake = (shopId: string) => {
    setShops(prevShops =>
      prevShops.map(shop => {
        if (shop.id !== shopId) return shop;

        const roIndex = 8000 + Math.floor(Math.random() * 1000);
        const clients = ['Robert Downey', 'Clara Smith', 'Jacob Cross', 'Sophia Turner'];
        const cars = ['2020 Corvette C8', '2019 Mustang GT', '2022 BMW M3', '2021 Supra GR'];
        const possibleDefects = Object.keys(STANDALONE_DEFECTS) as (keyof typeof STANDALONE_DEFECTS)[];
        const defect = possibleDefects[Math.floor(Math.random() * possibleDefects.length)];

        const newJob = {
          roId: `RO-${roIndex}`,
          customerName: clients[Math.floor(Math.random() * clients.length)],
          vehicle: cars[Math.floor(Math.random() * cars.length)],
          vin: `1FA6P8CF${roIndex}90280A`,
          defectCode: defect
        };

        return {
          ...shop,
          waitQueue: [...shop.waitQueue, newJob]
        };
      })
    );
  };

  // Manually drop one of the player's REAL inventory vehicles into a shop's pipeline.
  const intakeRealVehicle = (shopId: string, car: any) => {
    const faults = car.activeRepairs || [];
    const faultIds = faults.map((f: any) => f.id);
    const firstType = faults[0]?.type || 'mechanic';
    const defect: keyof typeof STANDALONE_DEFECTS = firstType === 'body' ? 'B-DENT' : 'P0302';
    setShops(prevShops =>
      prevShops.map(shop => {
        if (shop.id !== shopId) return shop;
        // Don't intake the same vehicle twice
        const already = [...shop.activeJobs, ...shop.waitQueue].some((j: any) => j.realCarId === car.id);
        if (already) return shop;
        return {
          ...shop,
          waitQueue: [...shop.waitQueue, {
            roId: `RO-${(car.vin || '').slice(-5).toUpperCase() || Math.floor(Math.random() * 99999)}`,
            customerName: `${me?.name || 'You'} (Your Vehicle)`,
            vehicle: `${car.year} ${car.make} ${car.model}`,
            vin: car.vin,
            defectCode: defect,
            realCarId: car.id,
            realFaultIds: faultIds
          }]
        };
      })
    );
    setShowVehiclePicker(false);
  };

  // Complete Order and cash out
  const cashOutJob = (shopId: string, roId: string) => {
    setShops(prevShops =>
      prevShops.map(shop => {
        if (shop.id !== shopId) return shop;

        const target = shop.activeJobs.find(j => j.roId === roId);
        if (!target) return shop;

        // Real player vehicle: actually repair it server-side (bills the player per fault)
        if (target.realCarId) {
          const socket = useGameStore.getState().socket;
          if (socket) {
            (target.realFaultIds || []).forEach(fid =>
              socket.emit('perform_specific_repair', { carId: target.realCarId, repairId: fid })
            );
          }
          return { ...shop, activeJobs: shop.activeJobs.filter(j => j.roId !== roId) };
        }

        const base = STANDALONE_DEFECTS[target.defectCode].type === 'mechanic' ? 850 : 600;
        const payout = Math.floor(base * (target.insurance ? 1.6 : 1)); // insurance/DRP jobs pay a premium

        // If it's the player's personal shop, sync the balance payout to their core wallet as well!
        if (shop.id === 'shop-player') {
          const socket = useGameStore.getState().socket;
          if (socket) {
            socket.emit('add_standalone_revenue', { amount: Math.floor(payout * 0.35) }); // Cash out 35% to main wallet
          }
        }

        return {
          ...shop,
          activeJobs: shop.activeJobs.filter(j => j.roId !== roId),
          revenue: shop.revenue + payout
        };
      })
    );
  };

  // Step repair stage forward manually
  const advanceStageManually = (shopId: string, roId: string) => {
    setShops(prevShops =>
      prevShops.map(shop => {
        if (shop.id !== shopId) return shop;

        return {
          ...shop,
          activeJobs: shop.activeJobs.map(job => {
            if (job.roId !== roId) return job;
            let nextStage = Math.min(4, job.stage + 1);
            let logs = [...job.logs];
            logs.push(`[LOG] Operator override: advanced vehicle stage to ${nextStage}.`);
            return {
              ...job,
              stage: nextStage,
              progress: 0,
              logs
            };
          })
        };
      })
    );
  };

  // Upgrade technician level
  const upgradeTech = (shopId: string) => {
    setShops(prevShops =>
      prevShops.map(shop => {
        if (shop.id !== shopId) return shop;

        const current = shop.techTier;
        const next = current === 'Junior' ? 'Senior' : 'Master';
        const cost = current === 'Junior' ? 5000 : 15000;

        if (shop.id === 'shop-player') {
          // Verify player has enough funds
          if (shop.revenue < cost) return shop;
        }

        return {
          ...shop,
          techTier: next,
          revenue: shop.revenue - cost
        };
      })
    );
  };

  // Pizza Tracker search
  const handleTrackerSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (!searchRo) return;

    // Search active jobs in all shops
    let found: ShopJob | null = null;
    for (const shop of shops) {
      const match = shop.activeJobs.find(j => j.roId === searchRo || j.vin === searchRo);
      if (match) {
        found = match;
        break;
      }
    }

    if (found) {
      setTrackerJob(found);
    } else {
      alert("No active Repair Order or VIN matches found on the database.");
    }
  };

  const selectedShop = shops.find(s => s.id === selectedShopId) || shops[0];

  return (
    <div className="bg-[#0b0c10]/95 border border-white/10 rounded-3xl p-4 md:p-6 shadow-2xl flex flex-col w-full h-full max-w-full text-white pointer-events-auto overflow-y-auto scrollbar-none pb-24 animate-in fade-in zoom-in-95">
      
      {/* Brand Header */}
      <header className="border-b border-white/10 pb-4 mb-6 flex flex-col md:flex-row justify-between items-start md:items-center gap-4 shrink-0 text-left">
        <div className="flex items-center gap-3">
          <div className="bg-gradient-to-r from-emerald-500 to-teal-600 p-2.5 rounded-xl border border-emerald-400/40 shadow-[0_0_15px_rgba(16,185,129,0.3)]">
            <Activity className="w-6 h-6 text-white" />
          </div>
          <div>
            <h1 className="text-xl font-black tracking-wider uppercase text-white flex items-center gap-2">
              RepairFlow Platform
              <span className="bg-emerald-500/10 text-emerald-400 text-[8px] px-2 py-0.5 rounded border border-emerald-500/20 font-mono tracking-widest uppercase font-black animate-pulse">
                Real-Time Sim
              </span>
            </h1>
            <p className="text-xs text-gray-400 font-mono">Public Busyness & Process Diagnostic Telemetry</p>
          </div>
        </div>

        {/* Tab Selection */}
        <div className="flex gap-2">
          <button
            onClick={() => setActiveView('directory')}
            className={`px-4 py-2 rounded-xl text-xs font-black uppercase tracking-wider border transition-all cursor-pointer ${activeView === 'directory' ? 'bg-emerald-500 text-black border-emerald-500 shadow-lg' : 'bg-white/5 border-white/10 text-gray-400 hover:bg-white/10'}`}
          >
            🏢 Shop Directory
          </button>
          <button
            onClick={() => setActiveView('operator')}
            className={`px-4 py-2 rounded-xl text-xs font-black uppercase tracking-wider border transition-all cursor-pointer ${activeView === 'operator' ? 'bg-emerald-500 text-black border-emerald-500 shadow-lg' : 'bg-white/5 border-white/10 text-gray-400 hover:bg-white/10'}`}
          >
            🔧 Operator Panel
          </button>
          <button
            onClick={() => {
              setActiveView('tracker');
              // Pre-select first active job to show tracker instantly
              const firstShop = shops.find(s => s.activeJobs.length > 0);
              if (firstShop && firstShop.activeJobs.length > 0) {
                setTrackerJob(firstShop.activeJobs[0]);
              }
            }}
            className={`px-4 py-2 rounded-xl text-xs font-black uppercase tracking-wider border transition-all cursor-pointer ${activeView === 'tracker' ? 'bg-emerald-500 text-black border-emerald-500 shadow-lg' : 'bg-white/5 border-white/10 text-gray-400 hover:bg-white/10'}`}
          >
            ⏱️ Customer Tracker
          </button>
        </div>
      </header>

      {/* Main View Router */}
      <div className="flex-grow">

        {/* VIEW 1: DIRECTORY */}
        {activeView === 'directory' && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-6 text-left">
            <div className="flex justify-between items-center bg-white/5 p-4 rounded-2xl border border-white/10">
              <div>
                <h2 className="text-lg font-black uppercase tracking-wider text-white">Platform Shop Directory</h2>
                <p className="text-xs text-gray-400 font-mono">Live capacity and busyness parameters across all local service centers</p>
              </div>
              <button
                onClick={() => setShowCreator(prev => !prev)}
                className="bg-emerald-500 hover:bg-emerald-400 text-black px-4 py-2 rounded-xl text-xs font-black uppercase tracking-widest transition-all shadow-md flex items-center gap-1.5 cursor-pointer"
              >
                <Plus size={14} /> Register Standalone Shop
              </button>
            </div>

            {/* Shop Creator Overlay Modal */}
            <AnimatePresence>
              {showCreator && (
                <motion.div
                  initial={{ opacity: 0, y: -20 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -20 }}
                  className="bg-black/40 border border-white/10 p-5 rounded-2xl flex flex-col gap-4"
                >
                  <h3 className="text-sm font-black uppercase tracking-widest text-emerald-400 border-b border-white/10 pb-2">Create New Standalone Shop</h3>
                  <form onSubmit={handleRegisterShop} className="grid grid-cols-1 md:grid-cols-4 gap-4 items-end">
                    <div className="flex flex-col gap-1.5 md:col-span-2">
                      <label className="text-[10px] text-gray-400 uppercase tracking-widest font-black">Shop / Brand Name</label>
                      <input
                        type="text"
                        className="bg-black/50 border border-white/20 rounded-xl px-3 py-2 text-xs text-white focus:border-emerald-500 focus:outline-none"
                        placeholder="e.g. Precision Transmission Pros"
                        value={newShopName}
                        onChange={e => setNewShopName(e.target.value)}
                        required
                      />
                    </div>
                    <div className="flex flex-col gap-1.5">
                      <label className="text-[10px] text-gray-400 uppercase tracking-widest font-black">Service Specialty</label>
                      <select
                        value={newShopType}
                        onChange={e => setNewShopType(e.target.value as any)}
                        className="bg-black border border-white/20 rounded-xl px-3 py-2 text-xs text-white cursor-pointer focus:outline-none focus:border-emerald-500"
                      >
                        <option value="mechanic">Mechanical Diagnostics</option>
                        <option value="body">Collision & Custom Paint</option>
                        <option value="dual">Full Service Center</option>
                      </select>
                    </div>
                    <div className="flex flex-col gap-1.5">
                      <label className="text-[10px] text-gray-400 uppercase tracking-widest font-black">Lift Bays Capacity</label>
                      <select
                        value={newShopCap}
                        onChange={e => setNewShopCap(parseInt(e.target.value))}
                        className="bg-black border border-white/20 rounded-xl px-3 py-2 text-xs text-white cursor-pointer focus:outline-none focus:border-emerald-500"
                      >
                        <option value={2}>2 Lift Bays</option>
                        <option value={4}>4 Lift Bays</option>
                        <option value={6}>6 Lift Bays</option>
                      </select>
                    </div>
                    <div className="md:col-span-4 flex gap-2 justify-end">
                      <button
                        type="submit"
                        className="bg-emerald-500 text-black px-6 py-2 rounded-xl text-xs font-black uppercase tracking-widest hover:bg-emerald-400 transition-colors cursor-pointer"
                      >
                        Register Shop
                      </button>
                      <button
                        type="button"
                        onClick={() => setShowCreator(false)}
                        className="bg-white/10 hover:bg-white/20 px-6 py-2 rounded-xl text-xs font-black uppercase tracking-widest transition-colors cursor-pointer"
                      >
                        Cancel
                      </button>
                    </div>
                  </form>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Grid directory */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {shops.map(shop => {
                const totalActive = shop.activeJobs.length;
                const totalQueue = shop.waitQueue.length;
                const loadPercent = Math.round((totalActive / shop.capacity) * 100);

                let loadStatus = 'Idle';
                let loadColor = 'text-green-400 bg-green-500/10 border-green-500/20';
                if (loadPercent > 90) {
                  loadStatus = 'AT CAPACITY';
                  loadColor = 'text-red-400 bg-red-500/10 border-red-500/20 animate-pulse';
                } else if (loadPercent > 70) {
                  loadStatus = 'Busy';
                  loadColor = 'text-orange-400 bg-orange-500/10 border-orange-500/20';
                } else if (loadPercent > 30) {
                  loadStatus = 'Moderate';
                  loadColor = 'text-yellow-400 bg-yellow-500/10 border-yellow-500/20';
                } else if (loadPercent > 0) {
                  loadStatus = 'Light Load';
                  loadColor = 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20';
                }

                return (
                  <div 
                    key={shop.id} 
                    onClick={() => { setSelectedShopId(shop.id); setActiveView('operator'); }}
                    className="bg-white/5 border border-white/10 rounded-2xl p-5 hover:border-emerald-500/30 transition-all cursor-pointer group flex flex-col justify-between min-h-[180px] shadow-lg relative overflow-hidden"
                  >
                    <div>
                      <div className="flex justify-between items-start mb-2">
                        <span className={`text-[8.5px] font-mono px-2 py-0.5 rounded border uppercase font-black tracking-widest ${loadColor}`}>
                          {loadStatus}
                        </span>
                        <span className="text-[10px] text-gray-500 font-mono uppercase">Rate: ${shop.hourlyRate}/hr</span>
                      </div>
                      <h3 className="font-black text-white text-base group-hover:text-emerald-400 transition-colors uppercase tracking-wider">{shop.name}</h3>
                      <p className="text-xs text-gray-400 uppercase tracking-widest mt-1">Specialty: {shop.type === 'dual' ? 'Dual Diagnostics & Body' : shop.type}</p>
                    </div>

                    <div className="mt-4 pt-4 border-t border-white/5 flex justify-between items-end">
                      <div className="flex flex-col gap-1">
                        <span className="text-[9px] text-gray-500 uppercase tracking-widest font-black">Lift Bays Load</span>
                        <div className="flex items-center gap-1.5">
                          <Gauge size={14} className="text-emerald-400" />
                          <span className="text-sm font-bold text-white">{totalActive} / {shop.capacity} Active</span>
                        </div>
                      </div>
                      <div className="text-right">
                        <span className="text-[9px] text-gray-500 uppercase tracking-widest font-black block">Wait Queue</span>
                        <span className="text-sm font-bold text-gray-300">{totalQueue} Vehicles</span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </motion.div>
        )}

        {/* VIEW 2: OPERATOR CONSOLE */}
        {activeView === 'operator' && selectedShop && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-6 text-left">
            
            {/* Selector list at top */}
            <div className="flex flex-wrap gap-2 border-b border-white/10 pb-4">
              {shops.map(s => (
                <button
                  key={s.id}
                  onClick={() => setSelectedShopId(s.id)}
                  className={`px-3 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-widest border transition-all cursor-pointer ${selectedShopId === s.id ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500' : 'bg-white/5 border-white/5 text-gray-400 hover:bg-white/10'}`}
                >
                  {s.name}
                </button>
              ))}
            </div>

            {/* Quick Metrics */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <div className="bg-white/5 border border-white/10 p-4 rounded-xl flex items-center gap-4">
                <Wrench className="text-emerald-400 w-8 h-8 shrink-0" />
                <div>
                  <span className="text-[10px] text-gray-400 uppercase tracking-widest font-black block">Active Lifts</span>
                  <span className="text-xl font-bold">{selectedShop.activeJobs.length} / {selectedShop.capacity} Lifts</span>
                </div>
              </div>
              <div className="bg-white/5 border border-white/10 p-4 rounded-xl flex items-center gap-4">
                <Clock className="text-blue-400 w-8 h-8 shrink-0" />
                <div>
                  <span className="text-[10px] text-gray-400 uppercase tracking-widest font-black block">Wait Queue</span>
                  <span className="text-xl font-bold">{selectedShop.waitQueue.length} Vehicles</span>
                </div>
              </div>
              <div className="bg-white/5 border border-white/10 p-4 rounded-xl flex items-center gap-4">
                <Users className="text-yellow-400 w-8 h-8 shrink-0" />
                <div>
                  <span className="text-[10px] text-gray-400 uppercase tracking-widest font-black block">Technicians Tier</span>
                  <span className="text-xl font-bold">{selectedShop.techTier} Level</span>
                </div>
              </div>
              <div className="bg-white/5 border border-white/10 p-4 rounded-xl flex items-center gap-4">
                <ShieldCheck className="text-emerald-400 w-8 h-8 shrink-0" />
                <div>
                  <span className="text-[10px] text-gray-400 uppercase tracking-widest font-black block">Sim Revenue</span>
                  <span className="text-xl font-bold text-emerald-400">${selectedShop.revenue.toLocaleString()}</span>
                </div>
              </div>
            </div>

            {/* Operator Control Card */}
            <div className="bg-gradient-to-r from-emerald-500/10 via-transparent to-transparent border border-white/10 p-5 rounded-2xl flex flex-col md:flex-row items-center justify-between gap-6">
              <div className="space-y-1">
                <h3 className="text-lg font-black uppercase tracking-wider text-white">Operator Command Center</h3>
                <p className="text-xs text-gray-400 font-medium">Trigger manual NPC check-ins or upgrade staff levels using simulated service revenue.</p>
              </div>
              <div className="flex gap-2 w-full md:w-auto shrink-0">
                <button
                  onClick={() => setShowVehiclePicker(true)}
                  disabled={selectedShop.waitQueue.length >= 6}
                  className="flex-1 md:flex-initial px-4 py-2.5 bg-blue-500 hover:bg-blue-400 text-black text-xs font-black uppercase tracking-widest rounded-xl transition-all shadow-[0_0_10px_rgba(59,130,246,0.3)] disabled:opacity-40 flex items-center justify-center gap-1.5 cursor-pointer"
                >
                  <Plus size={14} /> Add My Vehicle
                </button>
                <button
                  onClick={() => triggerManualIntake(selectedShop.id)}
                  disabled={selectedShop.waitQueue.length >= 6}
                  className="flex-1 md:flex-initial px-4 py-2.5 bg-emerald-500 hover:bg-emerald-400 text-black text-xs font-black uppercase tracking-widest rounded-xl transition-all shadow-[0_0_10px_rgba(16,185,129,0.3)] disabled:opacity-40 flex items-center justify-center gap-1.5 cursor-pointer"
                >
                  <Plus size={14} /> NPC Intake Drop-off
                </button>
                {selectedShop.techTier !== 'Master' && (
                  <button
                    onClick={() => upgradeTech(selectedShop.id)}
                    disabled={selectedShop.id === 'shop-player' && selectedShop.revenue < (selectedShop.techTier === 'Junior' ? 5000 : 15000)}
                    className="flex-1 md:flex-initial px-4 py-2.5 bg-white/5 border border-white/10 hover:bg-white/10 text-white text-xs font-black uppercase tracking-widest rounded-xl transition-all flex items-center justify-center gap-1.5 cursor-pointer"
                  >
                    <Sparkles size={14} className="text-yellow-400 animate-pulse" />
                    Upgrade Tech (${selectedShop.techTier === 'Junior' ? '5K' : '15K'})
                  </button>
                )}
              </div>
            </div>

            {/* My Vehicle picker */}
            {showVehiclePicker && (
              <div className="fixed inset-0 z-[200] bg-black/80 backdrop-blur-sm flex items-center justify-center p-4" onClick={() => setShowVehiclePicker(false)}>
                <div className="bg-[#0a0a0a] border border-blue-500/40 rounded-2xl p-5 w-full max-w-md max-h-[80vh] overflow-auto" onClick={e => e.stopPropagation()}>
                  <div className="flex items-center justify-between mb-2">
                    <h3 className="text-white font-black uppercase tracking-widest text-sm">Drop a Vehicle at {selectedShop.name}</h3>
                    <button onClick={() => setShowVehiclePicker(false)} className="text-gray-500 hover:text-white">✕</button>
                  </div>
                  <p className="text-[11px] text-gray-400 mb-3">Pick one of your inventory vehicles with open faults. The shop runs it through the bay; you're billed the repair cost when you hit <strong>Complete &amp; Cash Out</strong>.</p>
                  <div className="flex flex-col gap-2">
                    {(me?.inventory || []).filter((c: any) => (c.activeRepairs?.length || 0) > 0).map((c: any) => (
                      <button key={c.id} onClick={() => intakeRealVehicle(selectedShop.id, c)}
                        className="text-left bg-white/5 hover:bg-blue-500/10 border border-white/10 hover:border-blue-500/40 rounded-xl px-4 py-3 flex justify-between items-center transition-all">
                        <div>
                          <div className="text-white font-bold text-sm">{c.year} {c.make} {c.model}</div>
                          <div className="text-[10px] text-gray-500 font-mono">{c.vin}</div>
                        </div>
                        <span className="text-[10px] font-black uppercase text-amber-400 bg-amber-500/10 border border-amber-500/30 px-2 py-0.5 rounded shrink-0">{c.activeRepairs.length} faults</span>
                      </button>
                    ))}
                    {(me?.inventory || []).filter((c: any) => (c.activeRepairs?.length || 0) > 0).length === 0 && (
                      <div className="text-center text-gray-500 italic py-6 text-sm">No inventory vehicles need repair. Buy a car at the auction first.</div>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* Active Lifts Board */}
            <div className="space-y-4">
              <h3 className="text-sm font-black uppercase tracking-widest text-emerald-400 border-b border-white/5 pb-2">Active Service Bays</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {selectedShop.activeJobs.map(job => (
                  <div key={job.roId} className="bg-white/5 border border-white/10 rounded-2xl p-5 flex flex-col gap-4 relative overflow-hidden">
                    <div className="flex justify-between items-start border-b border-white/10 pb-3">
                      <div>
                        <span className="text-[9px] font-mono font-black text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-2 py-0.5 rounded">
                          {job.roId}
                        </span>
                        {job.realCarId && <span className="ml-1.5 text-[9px] font-mono font-black text-blue-300 bg-blue-500/20 border border-blue-500/40 px-2 py-0.5 rounded">YOUR CAR</span>}
                        <h4 className="font-black text-white text-base mt-2">{job.vehicle}</h4>
                        <span className="text-xs text-gray-400">Client: {job.customerName}</span>
                      </div>
                      <span className="text-xs text-gray-400 font-mono">Tech: {job.techAssigned}</span>
                    </div>

                    {/* Progress */}
                    <div className="flex flex-col gap-1.5">
                      <div className="flex justify-between text-[9.5px] uppercase font-mono tracking-widest text-gray-400">
                        <span>
                          Stage {job.stage + 1}: {['Intake Check', 'Diagnostics', 'Active Repair', 'QC Test', 'Ready'][job.stage]}
                        </span>
                        <span className="text-emerald-400 font-bold">{job.progress}%</span>
                      </div>
                      <div className="w-full h-1.5 bg-black/40 rounded-full overflow-hidden border border-white/5">
                        <div 
                          className="h-full bg-gradient-to-r from-blue-500 to-emerald-400 rounded-full transition-all duration-300 shadow-[0_0_8px_#10b981]"
                          style={{ width: `${job.progress}%` }}
                        />
                      </div>
                    </div>

                    {/* Diagnostic Defect Info */}
                    <div className="bg-black/30 border border-white/5 p-3 rounded-xl flex items-center justify-between text-xs">
                      <div>
                        <span className="text-[9px] text-gray-400 uppercase tracking-widest font-black block">Diagnostic Diagnosis</span>
                        <strong className="text-white text-sm mt-0.5 flex items-center gap-1.5">
                          <span>{STANDALONE_DEFECTS[job.defectCode]?.icon}</span>
                          <span>{STANDALONE_DEFECTS[job.defectCode]?.label} ({STANDALONE_DEFECTS[job.defectCode]?.code})</span>
                        </strong>
                      </div>
                      <button
                        onClick={() => {
                          setTrackerJob(job);
                          setActiveView('tracker');
                        }}
                        className="text-emerald-400 hover:text-emerald-300 font-bold uppercase text-[10px] tracking-wider hover:underline flex items-center gap-0.5 cursor-pointer"
                      >
                        Track Live <ChevronRight size={12} />
                      </button>
                    </div>

                    {/* Actions */}
                    <div className="flex gap-2 mt-2 pt-2 border-t border-white/5 justify-end">
                      {job.stage < 4 ? (
                        <button
                          onClick={() => advanceStageManually(selectedShop.id, job.roId)}
                          className="bg-emerald-500/10 hover:bg-emerald-500 text-emerald-400 hover:text-black border border-emerald-500/20 px-4 py-2 rounded-xl text-xs font-black uppercase tracking-widest transition-all flex items-center gap-1 cursor-pointer"
                        >
                          <Play size={12} /> Advance Stage
                        </button>
                      ) : (
                        <button
                          onClick={() => cashOutJob(selectedShop.id, job.roId)}
                          className="bg-success text-black px-4 py-2 rounded-xl text-xs font-black uppercase tracking-widest hover:bg-green-400 transition-all flex items-center gap-1 cursor-pointer"
                        >
                          <CheckCircle2 size={12} /> Complete & Cash Out
                        </button>
                      )}
                    </div>
                  </div>
                ))}

                {selectedShop.activeJobs.length === 0 && (
                  <div className="col-span-2 text-center text-gray-500 py-12 italic border border-dashed border-white/10 rounded-2xl">
                    All lift bays are currently empty. Click "NPC Intake Drop-off" or wait for customers!
                  </div>
                )}
              </div>
            </div>

            {/* Waiting Queue List */}
            <div className="bg-white/5 border border-white/10 rounded-2xl p-5 space-y-4">
              <h3 className="text-sm font-black uppercase tracking-widest text-emerald-400 border-b border-white/5 pb-2">Platform Waiting Queue</h3>
              <div className="flex flex-col gap-2 max-h-[250px] overflow-y-auto pr-2 scrollbar-thin">
                {selectedShop.waitQueue.map(item => (
                  <div key={item.roId} className="bg-black/30 border border-white/5 px-4 py-3 rounded-xl flex justify-between items-center group hover:border-emerald-500/30 transition-all">
                    <div className="flex items-center gap-4 text-left">
                      <Clock className="text-gray-500" size={16} />
                      <div>
                        <span className="text-[10px] text-gray-500 font-mono uppercase block">{item.roId}</span>
                        <strong className="text-sm text-white block mt-0.5">{item.customerName} - {item.vehicle}</strong>
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="text-[10px] font-mono bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 px-2 py-0.5 rounded">
                        {STANDALONE_DEFECTS[item.defectCode]?.label}
                      </span>
                      <button
                        onClick={() => {
                          setShops(prevShops =>
                            prevShops.map(shop => {
                              if (shop.id !== selectedShop.id) return shop;
                              return {
                                ...shop,
                                waitQueue: shop.waitQueue.filter(q => q.roId !== item.roId)
                              };
                            })
                          );
                        }}
                        className="text-red-400 hover:text-red-500 p-2 cursor-pointer"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>
                ))}

                {selectedShop.waitQueue.length === 0 && (
                  <div className="text-center text-gray-500 italic py-6 text-sm">
                    Wait queue is empty.
                  </div>
                )}
              </div>
            </div>

          </motion.div>
        )}

        {/* VIEW 3: PIZZA TRACKER LOOKUP PORTAL */}
        {activeView === 'tracker' && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="grid grid-cols-1 lg:grid-cols-3 gap-6 text-left">
            
            {/* Left Column: RO selector search */}
            <div className="flex flex-col gap-4">
              <h3 className="text-xs font-black uppercase tracking-widest text-emerald-400 border-b border-white/10 pb-2">Public Process Lookup</h3>
              <form onSubmit={handleTrackerSearch} className="flex gap-2">
                <input
                  type="text"
                  placeholder="Enter Repair Order (RO-5001) or VIN..."
                  className="flex-grow bg-black/60 border border-white/10 rounded-xl px-3 py-2.5 text-xs text-white focus:outline-none focus:border-emerald-500"
                  value={searchRo}
                  onChange={e => setSearchRo(e.target.value)}
                />
                <button
                  type="submit"
                  className="bg-emerald-500 hover:bg-emerald-400 text-black px-4 rounded-xl text-xs font-black uppercase tracking-widest transition-all cursor-pointer"
                >
                  Search
                </button>
              </form>

              {/* Selector dropdown of active simulation jobs */}
              <div className="bg-white/5 border border-white/10 p-4 rounded-2xl flex flex-col gap-3">
                <span className="text-[10px] text-gray-400 uppercase tracking-widest font-black block">Active Platform Bookings</span>
                <div className="flex flex-col gap-2 max-h-[40vh] overflow-y-auto pr-2 scrollbar-thin">
                  {shops.flatMap(s => s.activeJobs).map(job => (
                    <div
                      key={job.roId}
                      onClick={() => setTrackerJob(job)}
                      className={`p-3 rounded-xl border-2 cursor-pointer transition-all flex justify-between items-center ${trackerJob?.roId === job.roId ? 'border-emerald-500 bg-emerald-500/10' : 'border-white/5 bg-black/40 hover:border-white/20'}`}
                    >
                      <div className="flex flex-col gap-0.5">
                        <span className="font-bold text-xs text-white block">{job.vehicle}</span>
                        <span className="text-[9px] text-gray-400 font-mono uppercase block">{job.roId} | Tech: {job.techAssigned}</span>
                      </div>
                      <ChevronRight size={14} className={trackerJob?.roId === job.roId ? 'text-emerald-400' : 'text-gray-500'} />
                    </div>
                  ))}
                  {shops.flatMap(s => s.activeJobs).length === 0 && (
                    <div className="text-center italic text-gray-500 text-xs py-6">No vehicles currently active in platform shops.</div>
                  )}
                </div>
              </div>
            </div>

            {/* Middle Column & Right Column: Tracker Results */}
            {trackerJob ? (
              <div className="lg:col-span-2 grid grid-cols-1 md:grid-cols-2 gap-6 animate-in fade-in slide-in-from-bottom-3 duration-500">
                
                {/* Visual Piston Cylinder / Gearbox / Camshaft / Paint visualizer */}
                <div className="flex flex-col gap-4">
                  <h3 className="text-xs font-black uppercase tracking-widest text-emerald-400 border-b border-white/10 pb-2">Live Diagnostic Telemetry</h3>
                  <div className="bg-black/60 border border-emerald-500/20 p-5 rounded-2xl shadow-2xl flex flex-col gap-4 relative min-h-[300px]">
                    <div className="absolute top-3 left-1/2 -translate-x-1/2 flex items-center gap-1.5 text-[9px] font-mono tracking-widest text-emerald-500 bg-black/60 px-3 py-1 rounded-full border border-emerald-950">
                      <span className="w-1.5 h-1.5 bg-emerald-400 rounded-full animate-ping"></span>
                      <span>DIAG FEED ACTIVE</span>
                    </div>

                    <div className="flex-grow flex items-center justify-center bg-black/30 border border-white/5 rounded-xl p-4 relative overflow-hidden h-[220px]">
                      
                      {/* V8 Piston Cylinder Block Misfire visual (P0302) */}
                      {trackerJob.defectCode === 'P0302' && (
                        <svg viewBox="0 0 200 150" className="w-full h-full max-h-[160px]">
                          <path d="M 40 40 L 160 40 L 180 120 L 20 120 Z" fill="none" stroke="#374151" strokeWidth="3" />
                          <rect x="80" y="120" width="40" height="20" fill="none" stroke="#374151" strokeWidth="3" />
                          <line x1="55" y1="50" x2="35" y2="90" stroke="#ef4444" strokeWidth="10" strokeLinecap="round" className="animate-pulse" />
                          <text x="35" y="45" fill="#9ca3af" fontSize="8" fontFamily="monospace">CYL 1-4</text>
                          <line x1="145" y1="50" x2="165" y2="90" stroke="#10b981" strokeWidth="10" strokeLinecap="round" />
                          <text x="145" y="45" fill="#9ca3af" fontSize="8" fontFamily="monospace">CYL 5-8</text>
                          <circle cx="100" cy="100" r="15" fill="none" stroke="#4b5563" strokeWidth="3" />
                          <circle cx="100" cy="100" r="4" fill="#9ca3af" />
                          <g className="animate-bounce">
                            <path d="M 30 70 L 40 60 L 45 75 L 55 65 L 45 85 L 35 75 Z" fill="#f59e0b" />
                            <text x="5" y="70" fill="#ef4444" fontSize="7" fontWeight="bold" fontFamily="sans-serif">MISFIRE!</text>
                          </g>
                        </svg>
                      )}

                      {/* Transmission Gearbox Sync Wear visual (P0700) */}
                      {trackerJob.defectCode === 'P0700' && (
                        <svg viewBox="0 0 200 150" className="w-full h-full max-h-[160px]">
                          <style>{`
                            @keyframes stand-gear-cw {
                              0% { transform: rotate(0deg); }
                              100% { transform: rotate(360deg); }
                            }
                            @keyframes stand-gear-ccw {
                              0% { transform: rotate(0deg); }
                              100% { transform: rotate(-360deg); }
                            }
                            .s-gear-cw { transform-origin: 65px 75px; animation: stand-gear-cw 4s linear infinite; }
                            .s-gear-ccw { transform-origin: 135px 75px; animation: stand-gear-ccw 4s linear infinite; }
                          `}</style>
                          <rect x="20" y="45" width="160" height="60" rx="10" fill="none" stroke="#374151" strokeWidth="2" />
                          <line x1="10" y1="75" x2="190" y2="75" stroke="#4b5563" strokeWidth="4" />
                          <g className="s-gear-cw">
                            <circle cx="65" cy="75" r="30" fill="none" stroke="#10b981" strokeWidth="4" strokeDasharray="6 4" />
                            <circle cx="65" cy="75" r="15" fill="none" stroke="#4b5563" strokeWidth="2" />
                            <circle cx="65" cy="75" r="4" fill="#9ca3af" />
                          </g>
                          <g className="s-gear-ccw">
                            <circle cx="135" cy="75" r="30" fill="none" stroke="#ef4444" strokeWidth="4" strokeDasharray="6 4" className="animate-pulse" />
                            <circle cx="135" cy="75" r="15" fill="none" stroke="#4b5563" strokeWidth="2" />
                            <circle cx="135" cy="75" r="4" fill="#9ca3af" />
                          </g>
                          <g className="animate-bounce">
                            <circle cx="100" cy="75" r="10" fill="#f59e0b" opacity="0.8" />
                            <text x="100" y="79" fill="#000" fontSize="10" fontWeight="bold" textAnchor="middle">⚡</text>
                            <text x="100" y="125" fill="#ef4444" fontSize="8" fontWeight="black" fontFamily="monospace" textAnchor="middle">GEAR CLASH!</text>
                          </g>
                        </svg>
                      )}

                      {/* Camshaft Timing Over-Advanced visual (P0011) */}
                      {trackerJob.defectCode === 'P0011' && (
                        <svg viewBox="0 0 200 150" className="w-full h-full max-h-[160px]">
                          <style>{`
                            @keyframes stand-pulley-spin {
                              0% { transform: rotate(0deg); }
                              100% { transform: rotate(360deg); }
                            }
                            .s-pulley-l { transform-origin: 65px 45px; animation: stand-pulley-spin 6s linear infinite; }
                            .s-pulley-r { transform-origin: 135px 45px; animation: stand-pulley-spin 6s linear infinite; }
                            .s-pulley-crank { transform-origin: 100px 105px; animation: stand-pulley-spin 3s linear infinite; }
                          `}</style>
                          <path d="M 65 15 L 135 15 A 30 30 0 0 1 165 45 L 125 105 A 25 25 0 0 1 75 105 L 35 45 A 30 30 0 0 1 65 15 Z" fill="none" stroke="#f59e0b" strokeWidth="3" strokeDasharray="3 3" />
                          <g className="s-pulley-l">
                            <circle cx="65" cy="45" r="22" fill="none" stroke="#10b981" strokeWidth="4" />
                            <line x1="65" y1="23" x2="65" y2="67" stroke="#4b5563" strokeWidth="2" />
                            <line x1="43" y1="45" x2="87" y2="45" stroke="#4b5563" strokeWidth="2" />
                            <circle cx="65" cy="45" r="4" fill="#9ca3af" />
                          </g>
                          <g className="s-pulley-r">
                            <circle cx="135" cy="45" r="22" fill="none" stroke="#ef4444" strokeWidth="4" className="animate-pulse" />
                            <line x1="135" y1="23" x2="135" y2="67" stroke="#4b5563" strokeWidth="2" />
                            <line x1="113" y1="45" x2="157" y2="45" stroke="#4b5563" strokeWidth="2" />
                            <circle cx="135" cy="45" r="4" fill="#9ca3af" />
                          </g>
                          <g className="s-pulley-crank">
                            <circle cx="100" cy="105" r="15" fill="none" stroke="#10b981" strokeWidth="4" />
                            <circle cx="100" cy="105" r="4" fill="#9ca3af" />
                          </g>
                          <g className="animate-bounce">
                            <text x="100" y="140" fill="#ef4444" fontSize="8" fontWeight="black" fontFamily="monospace" textAnchor="middle">TIMING MISALIGNED!</text>
                          </g>
                        </svg>
                      )}

                      {/* Gas Exhaust / System Lean visual (P0171 / P0420) */}
                      {(trackerJob.defectCode === 'P0171' || trackerJob.defectCode === 'P0420') && (
                        <svg viewBox="0 0 200 150" className="w-full h-full max-h-[160px]">
                          <path d="M 20 40 L 70 40 L 100 75 L 180 75" fill="none" stroke={trackerJob.defectCode === 'P0171' ? '#f59e0b' : '#10b981'} strokeWidth="8" className={trackerJob.defectCode === 'P0171' ? 'animate-pulse' : ''} />
                          <rect x="100" y="60" width="50" height="30" rx="5" fill="none" stroke={trackerJob.defectCode === 'P0420' ? '#ef4444' : '#4b5563'} strokeWidth="3" className={trackerJob.defectCode === 'P0420' ? 'animate-pulse' : ''} />
                          <text x="125" y="78" fill="#9ca3af" fontSize="6" textAnchor="middle" fontFamily="monospace">CATALYTIC</text>
                          {trackerJob.defectCode === 'P0171' && (
                            <g className="animate-pulse">
                              <circle cx="60" cy="40" r="12" fill="#eab308" opacity="0.3" />
                              <text x="60" y="115" fill="#eab308" fontSize="8" fontWeight="bold" fontFamily="monospace" textAnchor="middle">SYSTEM LEAN (GAS EXP)</text>
                            </g>
                          )}
                          {trackerJob.defectCode === 'P0420' && (
                            <g className="animate-pulse">
                              <circle cx="125" cy="75" r="16" fill="#ef4444" opacity="0.3" />
                              <text x="125" y="115" fill="#ef4444" fontSize="8" fontWeight="bold" fontFamily="monospace" textAnchor="middle">EMISSIONS FAIL</text>
                            </g>
                          )}
                        </svg>
                      )}

                      {/* Body Shop Specialty Visualizer (B-DENT, B-PAINT, B-RUST) */}
                      {STANDALONE_DEFECTS[trackerJob.defectCode]?.type === 'body' && (
                        <svg viewBox="0 0 200 150" className="w-full h-full max-h-[160px]">
                          <path d="M 20 75 Q 50 35 100 35 Q 150 35 180 75 L 180 110 L 20 110 Z" fill="none" stroke="#4b5563" strokeWidth="2.5" />
                          <circle cx="50" cy="110" r="18" fill="none" stroke="#374151" strokeWidth="3" />
                          <circle cx="150" cy="110" r="18" fill="none" stroke="#374151" strokeWidth="3" />
                          {trackerJob.defectCode === 'B-DENT' && (
                            <g className="animate-pulse">
                              <path d="M 120 40 L 130 35 L 140 50 L 130 55 Z" fill="#ef4444" />
                              <text x="100" y="25" fill="#ef4444" fontSize="8" fontWeight="bold" fontFamily="sans-serif" textAnchor="middle">DENT DEFECT</text>
                            </g>
                          )}
                          {trackerJob.defectCode === 'B-PAINT' && (
                            <g className="animate-pulse">
                              <circle cx="100" cy="45" r="14" fill="#f59e0b" opacity="0.4" />
                              <text x="100" y="25" fill="#f59e0b" fontSize="8" fontWeight="bold" fontFamily="sans-serif" textAnchor="middle">PAINT FADING</text>
                            </g>
                          )}
                          {trackerJob.defectCode === 'B-RUST' && (
                            <g className="animate-pulse">
                              <rect x="30" y="100" width="40" height="8" fill="#eab308" opacity="0.6" />
                              <text x="100" y="25" fill="#eab308" fontSize="8" fontWeight="bold" fontFamily="sans-serif" textAnchor="middle">RUST FLAKES</text>
                            </g>
                          )}
                        </svg>
                      )}

                    </div>
                  </div>
                </div>

                {/* Vertical Stage Progress Tracking Bar ("Pizza Tracker") */}
                <div className="flex flex-col gap-4">
                  <h3 className="text-xs font-black uppercase tracking-widest text-emerald-400 border-b border-white/10 pb-2">Vehicle Repair Tracker</h3>
                  <div className="bg-white/5 border border-white/10 p-5 rounded-2xl flex flex-col gap-6 relative">
                    
                    {/* Live Tracker Stage Loops */}
                    <div className="relative pl-8 space-y-6">
                      
                      {/* Central vertical connecting tracking bar */}
                      <div className="absolute top-2.5 bottom-2.5 left-3 w-0.5 bg-white/10">
                        <div 
                          className="w-full bg-gradient-to-b from-blue-500 to-emerald-400 transition-all duration-500" 
                          style={{ height: `${(trackerJob.stage / 4) * 100}%` }}
                        />
                      </div>

                      {['Vehicle Intake & Check', 'OBD Diagnostics Scan', 'Active Repair & Install', 'Quality Control Road Audits', 'Ready for pickup'].map((label, idx) => {
                        const isDone = idx < trackerJob.stage;
                        const isActive = idx === trackerJob.stage;

                        let dotStyle = 'bg-black border-white/20';
                        if (isDone) dotStyle = 'bg-emerald-500 border-emerald-400 shadow-[0_0_10px_#10b981]';
                        else if (isActive) dotStyle = 'bg-blue-500 border-blue-400 shadow-[0_0_10px_#3b82f6] animate-pulse';

                        return (
                          <div key={idx} className="relative flex items-start gap-4">
                            <span className={`absolute left-[-26px] top-1.5 w-4 h-4 rounded-full border-2 transition-all duration-300 z-10 ${dotStyle}`}></span>
                            <div className="text-left">
                              <h4 className={`text-xs font-black uppercase tracking-wider ${isActive ? 'text-blue-400 font-black' : isDone ? 'text-emerald-400' : 'text-gray-500'}`}>
                                {idx + 1}. {label}
                              </h4>
                              {isActive && (
                                <motion.span 
                                  initial={{ opacity: 0 }} 
                                  animate={{ opacity: 1 }} 
                                  className="text-[9.5px] text-blue-300 font-mono font-bold uppercase tracking-widest block mt-0.5"
                                >
                                  • Current Active Stage ({trackerJob.progress}% progress)
                                </motion.span>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>

                    {/* Live Action Feed Logs */}
                    <div className="flex flex-col gap-1.5 mt-2 border-t border-white/5 pt-4">
                      <span className="text-[10px] text-gray-500 uppercase tracking-widest font-black flex items-center gap-1.5">
                        <Terminal size={12} className="text-emerald-400" /> Technical Action Logs Feed
                      </span>
                      <div className="bg-[#050508] border border-white/5 p-3.5 rounded-xl min-h-[90px] max-h-[120px] overflow-y-auto text-[9.5px] font-mono text-emerald-400 leading-normal scrollbar-none">
                        {trackerJob.logs.map((log, i) => (
                          <div key={i} className="mb-1">{log}</div>
                        ))}
                      </div>
                    </div>

                  </div>
                </div>

              </div>
            ) : (
              <div className="lg:col-span-2 text-center text-gray-500 py-16 italic border border-dashed border-white/10 rounded-2xl flex flex-col items-center justify-center gap-2">
                <Clock className="w-12 h-12 text-gray-600 animate-pulse" />
                <span>Search an active RO-ID or choose a vehicle from the active directory to query processes...</span>
              </div>
            )}

          </motion.div>
        )}

      </div>
    </div>
  );
}
