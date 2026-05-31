import React, { useEffect, useState, useMemo } from 'react';
import { useGameStore } from './store';
import { VanillaThreeScene } from './VanillaThreeScene';
import { Wallet, LogIn, ShoppingCart, Activity, Clock, TrendingUp, TrendingDown, DollarSign, Users, FileText, Wrench, Trash2, ChevronLeft, ChevronRight, BookOpen, HelpCircle, Car, Menu, Gamepad2, Sparkles } from 'lucide-react';
import { MECHANIC_LIB, BODY_LIB } from './constants';
import { motion, AnimatePresence } from 'framer-motion';
import StandaloneShopPlatform from './StandaloneShopPlatform';
import ShopManagement from './ShopManagement';


const LiveMap = ({ gameState, playerId, isMobile }: { gameState: any, playerId: string, isMobile?: boolean }) => {
  const size = isMobile ? 50 : 100;
  const mapScale = isMobile ? 0.125 : 0.25; // 400x400 map world mapping
  const mapCenter = isMobile ? 25 : 50;
  
  return (
    <div className={`fixed rounded-xl border border-white/20 bg-black/60 backdrop-blur-md overflow-hidden z-[999] pointer-events-none transition-all duration-300 ${isMobile ? 'bottom-28 right-8 w-[50px] h-[50px]' : 'bottom-6 right-8 w-[100px] h-[100px]'}`}>
       <div className="absolute inset-0 opacity-20" style={{ backgroundImage: 'linear-gradient(#fff 1px, transparent 1px), linear-gradient(90deg, #fff 1px, transparent 1px)', backgroundSize: isMobile ? '5px 5px' : '10px 10px' }}></div>
       {Object.values(gameState.players).map((p: any) => {
          if (!p.worldPosition) return null;
          const x = Math.max(0, Math.min(size, mapCenter + p.worldPosition.x * mapScale));
          const z = Math.max(0, Math.min(size, mapCenter + p.worldPosition.z * mapScale));
          const isMe = p.id === playerId;
          return (
             <div key={p.id} className="absolute transform -translate-x-1/2 -translate-y-1/2 flex flex-col items-center transition-all duration-200" style={{ left: `${x}px`, top: `${z}px` }}>
                <div className={`rounded-full shadow-[0_0_10px_rgba(255,255,255,0.8)] ${isMobile ? 'w-1 h-1' : 'w-2 h-2'} ${isMe ? 'bg-blue-400' : 'bg-orange-500'}`}></div>
                {!isMobile && <span className="text-[7px] font-bold text-white mt-0.5 uppercase tracking-widest">{p.name.substring(0,4)}</span>}
             </div>
          )
       })}
       {!isMobile && <div className="absolute bottom-0.5 left-1.5 text-[7px] text-white/50 font-black uppercase">GPS</div>}
    </div>
  );
};

const ConditionDisplay = ({ car, expandedCarId, setExpandedCarId, buyPsi, money }: { car: any, expandedCarId: string | null, setExpandedCarId: (id: string | null) => void, buyPsi?: (id: string) => void, money?: number }) => {
  const isExpanded = expandedCarId === car.id;
  const getProgressColor = (val: number) => val > 75 ? 'bg-green-500' : val > 40 ? 'bg-yellow-500' : 'bg-red-500';

  const getBodyDiagnostics = (val: number) => {
    if (val > 80) return "Exterior is clean. No noticeable dents or scratches.";
    if (val > 50) return "Minor cosmetic issues. Some scratches and a door ding.";
    if (val > 30) return "Paint fading. Deep scratches and visible rust forming.";
    return "Severe frame damage. Major dents on multiple panels.";
  };

  const getMechDiagnostics = (val: number) => {
    if (val > 80) return "Engine idles smoothly. Transmission shifts perfectly.";
    if (val > 50) return "Idles rough. Delayed response on acceleration.";
    if (val > 30) return "Check engine light is on. Clunking noises from suspension.";
    return "Engine misfires heavily. Transmission slipping dangerously.";
  };

  // Only mask the display if this is the auction block (buyPsi is passed) AND they haven't paid for it.
  if (!car.psiRevealed && buyPsi) {
    return (
      <div className="flex flex-col gap-1 w-full my-1 relative">
        <div className="flex items-center gap-2 p-1 rounded relative border border-red-500/10">
          <span className="text-[10px] uppercase font-bold text-red-500 w-8 shrink-0 animate-pulse">???</span>
          <div className="flex-grow bg-red-900/30 rounded-full h-2 relative overflow-hidden border border-red-500/50">
            <div className="h-full rounded-full transition-all duration-1000 bg-red-600 w-full animate-pulse" />
          </div>
          <span className="text-[10px] font-bold text-red-500 w-8 text-right animate-pulse">???</span>
        </div>
        {isExpanded ? (
          <div className="flex flex-col gap-2 overflow-hidden px-1 pb-2 border-l-2 border-red-500/50 ml-1 mt-1 pl-2 mb-2 bg-red-500/5 rounded -ml-1">
            <span className="text-[9px] text-red-400 font-bold uppercase text-center block mt-1 tracking-widest">
              Diagnostics Locked
            </span>
            <span className="text-[8px] text-red-300 text-center leading-tight">
              Vehicle may suffer from catastrophic mechanical failure or structural frame damage. Bidding without inspection is highly risky!
            </span>
            <button
              onClick={(e) => { e.stopPropagation(); buyPsi && buyPsi(car.id); }}
              disabled={(money || 0) < 250}
              className="mt-1 w-full bg-red-500/80 text-white border border-red-500 text-[10px] font-bold rounded flex justify-center items-center py-1.5 uppercase hover:bg-red-500 hover:scale-[1.02] transition-all disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer"
            >
              Order PSI Report ($250)
            </button>
            <div className="flex justify-center -mt-1"><span onClick={(e) => { e.stopPropagation(); setExpandedCarId(null); }} className="text-[8px] text-red-400/50 hover:text-red-400 cursor-pointer pt-1 uppercase">Close</span></div>
          </div>
        ) : (
          <div className="flex justify-center mt-1">
            <span
              onClick={(e) => { e.stopPropagation(); setExpandedCarId(car.id); }}
              className="text-[8px] text-red-400/80 hover:text-red-300 cursor-pointer uppercase tracking-widest bg-red-500/10 px-2 py-0.5 rounded border border-red-500/20"
            >
              Click For Warning
            </span>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1 w-full my-1 relative">
      <div
        className="flex items-center gap-2 cursor-pointer group hover:bg-market/10 p-1 rounded transition-colors relative"
        onClick={() => setExpandedCarId(isExpanded ? null : car.id)}
      >
        <span className="text-[10px] uppercase font-bold text-gray-400 group-hover:text-market transition-colors w-8 shrink-0">COND</span>
        <div className="flex-grow bg-black/50 rounded-full h-2 relative overflow-hidden border border-white/10 group-hover:border-market/30 transition-colors">
          <div className={`h-full rounded-full transition-all duration-1000 ${getProgressColor(car.condition)}`} style={{ width: `${car.condition}%` }} />
        </div>
        <span className="text-[10px] font-bold text-white w-8 text-right">{Math.floor(car.condition)}%</span>
        {!isExpanded && <div className="absolute left-1/2 -top-3 -translate-x-1/2 text-[7px] bg-market text-black px-1.5 rounded-full font-bold uppercase tracking-widest opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">Click to Inspect</div>}
      </div>

      <AnimatePresence>
        {isExpanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="flex flex-col gap-2 overflow-hidden px-1 pb-2 border-l-2 border-market/50 ml-1 mt-1 pl-2 mb-2"
          >
            <div className="flex justify-between items-end mb-1 mt-1">
              <span className="text-[10px] uppercase font-black text-market tracking-widest">Diagnostic Report</span>
              <span className="text-[8px] text-market/50 uppercase break-all">SCAN-{car.id.slice(0, 8)}</span>
            </div>

            <div className="flex flex-col gap-1">
              <div className="flex items-center gap-2">
                <span className="text-[9px] uppercase font-bold text-gray-500 w-8 shrink-0">BODY</span>
                <div className="flex-grow bg-black/30 rounded-full h-1.5 relative overflow-hidden border border-white/5">
                  <div className={`h-full rounded-full transition-all duration-1000 bg-blue-400`} style={{ width: `${car.bodyCondition}%` }} />
                </div>
                <span className="text-[9px] font-bold text-gray-400 w-8 text-right">{Math.floor(car.bodyCondition)}%</span>
              </div>
              <div className="text-[9px] text-blue-300/80 italic leading-tight">"{getBodyDiagnostics(car.bodyCondition)}"</div>
            </div>

            <div className="flex flex-col gap-1 mt-1">
              <div className="flex items-center gap-2">
                <span className="text-[9px] uppercase font-bold text-gray-500 w-8 shrink-0">MECH</span>
                <div className="flex-grow bg-black/30 rounded-full h-1.5 relative overflow-hidden border border-white/5">
                  <div className={`h-full rounded-full transition-all duration-1000 bg-purple-400`} style={{ width: `${car.mechanicCondition}%` }} />
                </div>
                <span className="text-[9px] font-bold text-gray-400 w-8 text-right">{Math.floor(car.mechanicCondition)}%</span>
              </div>
              <div className="text-[9px] text-purple-300/80 italic leading-tight">"{getMechDiagnostics(car.mechanicCondition)}"</div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

const AuctionCarCard = ({ car, me, buyCar, buyPsi, expandedCarId, setExpandedCarId, isAuctionOpen }: any) => {
  const [isFlipped, setIsFlipped] = useState(false);

  // Randomly generate some detailed info based on the car's intrinsic attributes
  const prevOwners = Math.max(1, Math.floor((100 - car.condition) / 20));
  const accidents = car.bodyCondition < 40 ? '2 Major' : car.bodyCondition < 70 ? '1 Minor' : 'None Reported';
  const serviceRecords = Math.floor(car.mechanicCondition / 10);
  const marketDemand = car.buyPrice > 4000 ? 'High' : car.buyPrice > 2000 ? 'Moderate' : 'Low';

  return (
    <motion.div
      initial={{ opacity: 0, height: 0 }}
      animate={{ opacity: 1, height: 'auto' }}
      exit={{ opacity: 0, scale: 0.9 }}
      className="relative [perspective:1000px] w-full shrink-0 h-auto min-h-[160px]"
    >
      <div
        className={`w-full h-full transition-all duration-700 [transform-style:preserve-3d] ${isFlipped ? '[transform:rotateY(180deg)]' : ''}`}
      >
        {/* FRONT */}
        <div
          onClick={() => setIsFlipped(true)}
          className={`bg-white/5 border border-white/10 rounded-xl p-4 flex flex-col gap-3 group hover:border-market/50 transition-colors cursor-pointer [backface-visibility:hidden] ${isFlipped ? 'opacity-0 pointer-events-none absolute inset-0' : ''}`}
        >
          <div className="absolute top-2 right-2 text-gray-500 hover:text-white z-10 p-2">
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"></circle><path d="M12 16v-4"></path><path d="M12 8h.01"></path></svg>
          </div>
          <div className="flex justify-between items-start">
            <div>
              <div className="font-bold text-white group-hover:text-market transition-colors">
                <div className="flex items-center gap-2">
                  {car.year} {car.make} {car.model}
                  {car.titleStatus !== 'Clean' && (
                    <span className={`text-[10px] px-1.5 py-0.5 rounded uppercase font-black ${car.titleStatus === 'Salvage' ? 'bg-red-500/20 text-red-400 border border-red-500/50' : 'bg-orange-500/20 text-orange-400 border border-orange-500/50'}`}>
                      {car.titleStatus}
                    </span>
                  )}
                </div>
              </div>
              <div className="text-[10px] text-gray-500 font-mono mt-1 mb-1 tracking-widest">{car.vin} | {car.mileage.toLocaleString()} mi</div>
              <ConditionDisplay car={car} expandedCarId={expandedCarId} setExpandedCarId={setExpandedCarId} buyPsi={buyPsi} money={me?.money} />
            </div>
            <div className="text-success font-bold mt-1 mr-5">${car.buyPrice.toLocaleString()}</div>
          </div>
          <div className="grid grid-cols-2 gap-2 mt-2">
            <button
              onClick={(e) => { e.stopPropagation(); if (!isFlipped) buyCar(car.id, false); }}
              disabled={!isAuctionOpen || me.money < (car.buyPrice + 300) || me.inventory.length >= (me.lotScale === 'Small' ? 10 : me.lotScale === 'Medium' ? 25 : 50)}
              className="bg-success text-black text-[10px] font-bold rounded py-1.5 uppercase hover:bg-green-400 disabled:opacity-30 disabled:cursor-not-allowed flex flex-col items-center leading-tight"
            >
              <span>{isAuctionOpen ? "Pay Cash" : "Closed"}</span>
              {isAuctionOpen && <span className="text-[8px] opacity-75">+ $300 Transport</span>}
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); if (!isFlipped) buyCar(car.id, true); }}
              disabled={!isAuctionOpen || me.money < 300 || me.inventory.length >= (me.lotScale === 'Small' ? 10 : me.lotScale === 'Medium' ? 25 : 50)}
              className="bg-transparent border border-market text-market text-[10px] font-bold rounded py-1.5 uppercase hover:bg-market hover:text-black disabled:opacity-30 disabled:cursor-not-allowed flex flex-col items-center leading-tight"
            >
              <span>{isAuctionOpen ? "Floor Plan" : "Closed"}</span>
              {isAuctionOpen && <span className="text-[8px] opacity-75">+ $300 Transport</span>}
            </button>
          </div>
        </div>

        {/* BACK */}
        <div
          onClick={() => setIsFlipped(false)}
          className={`absolute inset-0 bg-black/95 border border-market rounded-xl p-4 overflow-y-auto text-[10px] text-gray-300 [transform:rotateY(180deg)] [backface-visibility:hidden] cursor-pointer scrollbar-thin scrollbar-thumb-white/10 scrollbar-track-transparent flex flex-col gap-2 ${!isFlipped ? 'opacity-0 pointer-events-none' : ''}`}
        >
          <h4 className="font-bold text-market text-[10px] uppercase tracking-widest sticky top-0 bg-black/95 pb-2 z-10 flex justify-between items-center">
            Valuation Metrics
            <span className="text-white hover:text-red-500 text-xs">✕</span>
          </h4>

          <div className="bg-white/10 p-2 rounded border border-white/10 grid grid-cols-2 gap-2 mb-2">
            <div className="col-span-2"><span className="text-gray-500">Source / Seller:</span> <span className="text-white font-bold">{car.auctionSeller || 'Private Seller'}</span></div>
            <div><span className="text-gray-500">Prev Owners:</span> <span className="text-white font-bold">{prevOwners}</span></div>
            <div><span className="text-gray-500">Accidents:</span> <span className="text-white font-bold">{accidents}</span></div>
            <div><span className="text-gray-500">Service Recs:</span> <span className="text-white font-bold">{serviceRecords}</span></div>
            <div><span className="text-gray-500">Market Demand:</span> <span className="text-white font-bold">{marketDemand}</span></div>
          </div>

          <div className="bg-market/10 border border-market/50 p-2 rounded mb-2">
            <div className="flex justify-between items-center mb-1">
              <span className="text-[10px] text-market/80 tracking-widest uppercase font-bold">Estimated MMR</span>
              <span className="text-xs text-market font-black h-font">${car.estimatedMMR?.toLocaleString() || '---'}</span>
            </div>
            <p className="text-[8px] text-market/70 leading-tight">Deterministic wholesale value calculated using aggregate depreciation curves and 3-stage rebuild base (35% Salvage / 65% Rebuilt / 120% OEM MSRP).</p>
          </div>

          <div className="hidden md:block space-y-2 pb-2">
            <p>Car value is primarily determined by mileage, overall condition (mechanical and cosmetic), year/make/model, and market demand, with vehicle history (accidents/maintenance) and location playing significant roles. High-demand vehicles like SUVs hold value better, while higher mileage and lower-tier trims decrease it.</p>
            <p className="font-bold text-white uppercase mt-2">Ray Catena of Freehold +4</p>
            <p><strong className="text-market">Mileage & Age:</strong> Generally, the higher the mileage, the lower the value, as it correlates with wear and tear. Cars lose value rapidly in the first few years, making age a major factor.</p>
            <p><strong className="text-market">Vehicle Condition:</strong> Includes both mechanical reliability and cosmetic shape (interior rips, exterior dents/rust). A well-maintained vehicle with service records commands a higher price.</p>
            <p><strong className="text-market">Market Demand & Location:</strong> Local demand affects prices; for example, AWD vehicles may hold higher value in northern climates. Seasonal trends also affect prices for certain vehicles.</p>
            <p><strong className="text-market">Make, Model, and Reputation:</strong> Brands known for durability (e.g., Toyota, Honda) typically have higher resale values.</p>
            <p><strong className="text-market">Accident History:</strong> Vehicles with a clean Carfax or similar report are worth more than those with documented structural damage or major accidents.</p>
            <p><strong className="text-market">Trim Level & Features:</strong> Higher trims, special packages, and premium features (e.g., leather seats, advanced safety, entertainment systems) increase value.</p>
            <p><strong className="text-market">Color and Personalization:</strong> Common, popular colors (black, white, silver) are usually easier to sell, while personalized modifications (aftermarket performance parts) can often reduce, rather than increase, the market value.</p>
          </div>
        </div>
      </div>
    </motion.div>
  );
};

const InspectionModal = () => {
  const { activeInspectionCarId, activeInspectionShopType, closeInspectionModal, performSpecificRepair, gameState, playerId } = useGameStore();
  if (!activeInspectionCarId || !gameState || !playerId) return null;

  const me = gameState.players[playerId];
  if (!me) return null;

  const car = me.inventory.find(c => c.id === activeInspectionCarId);
  if (!car) return null;

  const relevantRepairs = (car.activeRepairs || []).filter(r => r.type === activeInspectionShopType);

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        className="fixed inset-0 bg-black/80 backdrop-blur-sm z-[100] flex items-center justify-center p-4 pointer-events-auto"
      >
        <motion.div
          initial={{ scale: 0.9, y: 20 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.9, y: 20 }}
          className={`bg-[#0a0a0a] border ${activeInspectionShopType === 'mechanic' ? 'border-purple-500/50' : 'border-blue-500/50'} p-6 rounded-xl max-w-lg w-full flex flex-col gap-4 shadow-2xl relative`}
        >
          <button onClick={closeInspectionModal} className="absolute top-4 right-4 text-gray-500 hover:text-white transition-colors">✕</button>

          <div>
            <h2 className={`text-2xl font-black uppercase tracking-widest ${activeInspectionShopType === 'mechanic' ? 'text-purple-400' : 'text-blue-400'}`}>
              {activeInspectionShopType === 'mechanic' ? 'Mechanical Inspection' : 'Body Inspection'}
            </h2>
            <p className="text-sm text-gray-400 font-mono mt-1">Vehicle: {car.year} {car.make} {car.model} | SCAN-{car.id.slice(0, 8)}</p>
          </div>

          <div className="flex items-center gap-4 bg-white/5 p-3 rounded border border-white/10">
            <div className="flex-1">
              <div className="text-[10px] text-gray-500 uppercase tracking-widest mb-1">Current Condition</div>
              <div className="w-full bg-black/50 rounded-full h-2 relative overflow-hidden border border-white/10">
                <div
                  className={`h-full rounded-full transition-all duration-1000 ${activeInspectionShopType === 'mechanic' ? 'bg-purple-500' : 'bg-blue-500'}`}
                  style={{ width: `${activeInspectionShopType === 'body' ? car.bodyCondition : car.mechanicCondition}%` }}
                />
              </div>
            </div>
            <div className="text-2xl font-bold text-white">
              {Math.floor(activeInspectionShopType === 'body' ? car.bodyCondition : car.mechanicCondition)}%
            </div>
          </div>

          <div className="flex flex-col gap-2 max-h-[40vh] overflow-y-auto pr-2 scrollbar-thin scrollbar-thumb-white/10">
            <h3 className="text-xs font-bold text-gray-500 uppercase tracking-widest border-b border-white/10 pb-1 mb-1">Diagnostic Faults</h3>
            {relevantRepairs.length === 0 ? (
              <div className="text-center italic text-gray-500 py-6">No defects found in this subsystem. Clean bill of health!</div>
            ) : (
              relevantRepairs.map((r: any) => (
                <div key={r.id} className="flex justify-between items-center bg-black/40 p-3 rounded border border-white/5 hover:border-white/20 transition-all group">
                  <div className="flex flex-col">
                    <span className="font-bold text-white text-sm">{r.name}</span>
                    <span className="text-[10px] text-green-400 font-bold uppercase tracking-wider">+{r.conditionImpact}% Condition Recovered</span>
                  </div>
                  {(() => {
                    const hasPart = (me.partsInventory?.[r.name] || 0) > 0;
                    return (
                      <button
                        onClick={() => performSpecificRepair(car.id, r.id)}
                        disabled={!hasPart && me.money < r.cost}
                        className="bg-market/20 hover:bg-market text-market hover:text-black border border-market/50 transition-colors px-4 py-2 rounded font-bold text-xs disabled:opacity-30 disabled:cursor-not-allowed uppercase shrink-0"
                      >
                        {hasPart ? `Use Part ($0)` : `Fix ($${r.cost.toLocaleString()})`}
                      </button>
                    );
                  })()}
                </div>
              ))
            )}
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
};

const BankDashboard = () => {
  const { isBankModalOpen, closeBankModal, payFloorPlan, takeTitleLoan, gameState, playerId } = useGameStore();
  const me = gameState?.players[playerId || ''];
  const [activeTab, setActiveTab] = useState<'account' | 'collateral'>('account');
  const [selectedCarId, setSelectedCarId] = useState<string | null>(null);

  if (!isBankModalOpen || !me) return null;

  const computeCarLoan = (car: any) => {
    const mechanicImpact = car.mechanicCondition / 100;
    const bodyImpact = car.bodyCondition / 100;
    const accidentPenalty = car.accidents > 0 ? 0.70 : 1.0;
    const mileagePenalty = Math.max(0.3, 1.0 - (car.mileage / 300000));
    let marketVal = (car.basePrice || car.buyPrice) * mechanicImpact * bodyImpact * accidentPenalty * mileagePenalty;
    let maxAdvance = marketVal * 0.8;

    const offers = [];
    if (car.accidents === 0) { maxAdvance += 2000; offers.push({ title: 'Clean Title Advance', val: 2000 }); }
    if (car.mileage < 50000) { maxAdvance += 500; offers.push({ title: 'Low Mileage Premium', val: 500 }); }
    if (car.bodyCondition > 90 && car.mechanicCondition > 90) { maxAdvance += 1500; offers.push({ title: 'Mint Condition Credit', val: 1500 }); }
    if (car.titleStatus === 'Salvage') { maxAdvance -= 5000; offers.push({ title: 'Subprime / Salvage Penalty', val: -5000 }); }

    maxAdvance = Math.floor(Math.max(100, maxAdvance));

    return { maxAdvance, offers };
  };

  const selectedCar = selectedCarId ? me.inventory.find((c: any) => c.id === selectedCarId) : null;
  const loanData = selectedCar ? computeCarLoan(selectedCar) : null;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        className="fixed inset-0 bg-[#f5f5f5]/90 backdrop-blur-md z-[200] flex items-center justify-center p-4 pointer-events-auto"
      >
        <motion.div
          initial={{ scale: 0.9, y: 20 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.9, y: 20 }}
          className="bg-white border border-gray-300 p-6 rounded-xl max-w-2xl w-full flex flex-col gap-6 shadow-2xl relative text-slate-800 font-sans"
        >
          <button onClick={closeBankModal} className="absolute top-4 right-4 text-gray-400 hover:text-blue-600 transition-colors text-xl">✕</button>

          <div className="flex flex-col gap-1 border-b border-gray-200 pb-4">
            <h2 className="text-3xl font-black tracking-tight text-[#005ea2]">Capital Bank</h2>
            <p className="text-sm text-gray-500 font-medium">Commercial Dealer Services</p>
          </div>

          <div className="flex gap-4 border-b border-gray-200 pb-2">
            <button onClick={() => setActiveTab('account')} className={`px-4 py-2 font-bold text-sm tracking-widest uppercase transition-colors rounded-t-lg ${activeTab === 'account' ? 'border-b-4 border-[#005ea2] text-[#005ea2]' : 'text-gray-400 hover:text-gray-600'}`}>Corporate Account</button>
            <button onClick={() => { setActiveTab('collateral'); setSelectedCarId(null); }} className={`px-4 py-2 font-bold text-sm tracking-widest uppercase transition-colors rounded-t-lg ${activeTab === 'collateral' ? 'border-b-4 border-[#005ea2] text-[#005ea2]' : 'text-gray-400 hover:text-gray-600'}`}>Collateral Lines</button>
          </div>

          {activeTab === 'account' && (
            <div className="flex flex-col gap-6 animate-in fade-in">
              <div className="flex flex-col gap-4">
                <div className="flex justify-between items-center bg-gray-50 p-4 rounded-lg border border-gray-200 shadow-sm">
                  <span className="text-sm text-gray-500 font-bold uppercase tracking-widest">Liquid Cash</span>
                  <span className="text-3xl font-black text-green-700">${Math.floor(me.money).toLocaleString()}</span>
                </div>
                <div className="flex justify-between items-center bg-gray-50 p-4 rounded-lg border border-gray-200 shadow-sm">
                  <div className="flex flex-col items-start gap-1">
                    <span className="text-sm text-gray-500 font-bold uppercase tracking-widest">Floor Plan Debt</span>
                    <span className="text-xs text-gray-500 bg-blue-100 text-blue-800 px-2 py-0.5 rounded font-bold">Standard 0.5% Daily Interest</span>
                  </div>
                  <span className="text-3xl font-black text-red-600">${Math.floor(me.floorPlanDebt).toLocaleString()}</span>
                </div>
              </div>

              <div className="flex flex-col items-center bg-[#f0f9ff] p-4 rounded-lg border border-blue-100">
                <p className="text-sm text-[#005ea2] font-medium mb-4 text-center leading-relaxed">
                  Manage your Floor Plan line of credit to reduce daily interest expenditures and free up leveraging power for future inventory acquisitions.
                </p>
                <div className="flex gap-2 w-full">
                  <button onClick={() => payFloorPlan(10000)} disabled={me.money < 10000 || me.floorPlanDebt <= 0} className="flex-1 bg-white hover:bg-gray-50 text-[#005ea2] border-2 border-[#bbd4e7] hover:border-[#005ea2] transition-colors py-3 rounded-lg font-black tracking-widest text-sm disabled:opacity-50 disabled:cursor-not-allowed uppercase">Pay $10k</button>
                  <button onClick={() => payFloorPlan(50000)} disabled={me.money < 50000 || me.floorPlanDebt <= 0} className="flex-1 bg-white hover:bg-gray-50 text-[#005ea2] border-2 border-[#bbd4e7] hover:border-[#005ea2] transition-colors py-3 rounded-lg font-black tracking-widest text-sm disabled:opacity-50 disabled:cursor-not-allowed uppercase">Pay $50k</button>
                  <button onClick={() => payFloorPlan(me.floorPlanDebt)} disabled={me.money < me.floorPlanDebt || me.floorPlanDebt <= 0} className="flex-1 bg-[#005ea2] hover:bg-[#004b82] text-white transition-colors py-3 rounded-lg font-black tracking-widest text-sm disabled:opacity-50 disabled:cursor-not-allowed uppercase border-2 border-transparent">Pay Full Bal.</button>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'collateral' && !selectedCarId && (
            <div className="flex flex-col gap-3 max-h-[45vh] overflow-y-auto pr-2 animate-in fade-in">
              <p className="text-sm text-gray-500 font-medium mb-2">Select a vehicle from your inventory to estimate available Title Loan advances.</p>
              {me.inventory.filter((c: any) => !c.isProcessed).map((car: any) => (
                <div key={car.id} onClick={() => setSelectedCarId(car.id)} className={`p-4 rounded-lg border-2 cursor-pointer transition-all flex justify-between items-center ${car.isLienActive ? 'border-red-200 bg-red-50 opacity-50 pointer-events-none' : 'border-gray-200 hover:border-[#005ea2] bg-white hover:shadow-md'}`}>
                  <div className="flex flex-col gap-1">
                    <span className="font-black text-lg text-slate-800">{car.year} {car.make} {car.model}</span>
                    <span className="text-xs text-gray-500 uppercase font-bold tracking-wider">{car.mileage.toLocaleString()} mi | {car.title} Title</span>
                  </div>
                  {car.isLienActive ? (
                    <span className="text-xs font-bold text-red-600 bg-red-100 px-3 py-1 rounded-full uppercase tracking-widest">Lien Active</span>
                  ) : (
                    <span className="text-xs font-bold text-[#005ea2] bg-blue-50 hover:bg-blue-100 px-4 py-2 rounded uppercase tracking-widest">Select</span>
                  )}
                </div>
              ))}
              {me.inventory.filter((c: any) => !c.isProcessed).length === 0 && (
                <div className="text-center p-8 bg-gray-50 rounded-lg border border-dashed border-gray-300 text-gray-500 font-medium">No available inventory for collateral.</div>
              )}
            </div>
          )}

          {activeTab === 'collateral' && selectedCarId && selectedCar && loanData && (
            <div className="flex flex-col gap-4 animate-in fade-in slide-in-from-bottom-4">
              <button onClick={() => setSelectedCarId(null)} className="text-[10px] font-bold text-[#005ea2] uppercase tracking-widest self-start hover:underline mb-2 flex items-center gap-1">← Back to Inventory</button>

              <div className="flex justify-between items-baseline border-b-2 border-[#005ea2] pb-2">
                <h3 className="font-bold text-gray-600 text-lg">Estimated Final Advance</h3>
                <div className="text-right">
                  <div className="text-3xl font-black text-[#005ea2]">${loanData.maxAdvance.toLocaleString()}</div>
                </div>
              </div>

              <div className="flex rounded-t-lg overflow-hidden border-b border-gray-300 pt-2">
                <div className="flex-1 bg-[#005ea2] text-white text-center py-2 text-[10px] font-bold uppercase tracking-widest relative after:content-[''] after:absolute after:bottom-[-6px] after:left-1/2 after:-translate-x-1/2 after:border-l-[6px] after:border-r-[6px] after:border-t-[6px] after:border-l-transparent after:border-r-transparent after:border-t-[#005ea2]">
                  FLOOR PLAN ADVANCE
                </div>
                <div className="flex-1 bg-white text-gray-600 border-l border-t border-r border-gray-300 text-center py-2 text-[10px] font-bold uppercase tracking-widest shadow-inner relative">
                  TITLE LOAN
                  <div className="absolute inset-0 bg-gray-100 opacity-50 mix-blend-multiply pointer-events-none"></div>
                </div>
              </div>

              <div className="grid grid-cols-4 gap-4 py-4 text-center border-b border-gray-200">
                <div className="flex flex-col">
                  <span className="text-xl font-black text-slate-800">0.5%</span>
                  <span className="text-[9px] uppercase font-bold text-gray-500 tracking-widest">Daily Interest</span>
                </div>
                <div className="flex flex-col border-l border-gray-200">
                  <span className="text-xl font-black text-slate-800">Revolving</span>
                  <span className="text-[9px] uppercase font-bold text-gray-500 tracking-widest">Duration</span>
                </div>
                <div className="flex flex-col border-l border-gray-200">
                  <span className="text-xl font-black text-slate-800">{Math.floor((selectedCar.bodyCondition + selectedCar.mechanicCondition) / 2)}%</span>
                  <span className="text-[9px] uppercase font-bold text-gray-500 tracking-widest">Asset Cond.</span>
                </div>
                <div className="flex flex-col border-l border-gray-200">
                  <span className="text-xl font-black text-slate-800">5%</span>
                  <span className="text-[9px] uppercase font-bold text-gray-500 tracking-widest">Origination Fee</span>
                </div>
              </div>

              <div className="flex flex-col gap-3 py-2 max-h-[25vh] overflow-y-auto pr-2">
                <h4 className="text-lg font-black text-slate-800 flex items-center gap-2 mb-1">
                  Special Program Offers
                  <span className="bg-blue-100 text-blue-800 w-5 h-5 rounded-full inline-flex items-center justify-center text-xs">?</span>
                </h4>
                {loanData.offers.length === 0 ? (
                  <div className="text-gray-500 italic p-4 bg-gray-50 rounded border border-gray-200 text-sm">No special programs applicable to this asset.</div>
                ) : (
                  loanData.offers.map((offer, i) => (
                    <div key={i} className={`px-5 py-4 border-2 rounded text-left flex justify-between items-center shadow-sm ${offer.val > 0 ? 'border-blue-200 bg-white' : 'border-red-200 bg-red-50'}`}>
                      <div className="flex flex-col -space-y-1">
                        <span className="font-bold text-slate-700">{offer.title}</span>
                        <span className={`text-base font-black ${offer.val > 0 ? 'text-green-600' : 'text-red-600'}`}>
                          {offer.val > 0 ? '+' : ''}${Math.abs(offer.val).toLocaleString()}
                        </span>
                      </div>
                      <button disabled className="px-4 py-1.5 rounded-full border border-gray-300 text-[9px] font-bold text-gray-500 bg-gray-50 uppercase tracking-widest">Details</button>
                    </div>
                  ))
                )}
              </div>

              <div className="flex flex-col gap-2 mt-2">
                <p className="text-[10px] text-gray-400 flex gap-2 pt-2 border-t border-gray-200 leading-tight">
                  <span className="text-[#005ea2]">v</span> Offers are subject to eligibility restrictions and collateral verification. A 5% origination fee will be instantly added to your Floor Plan Debt upon signing.
                </p>
                <button
                  onClick={() => {
                    takeTitleLoan(selectedCar.id);
                    setSelectedCarId(null);
                    setActiveTab('account');
                  }}
                  className="mt-2 bg-white text-[#005ea2] border-none hover:bg-transparent transition-all py-2 font-black tracking-widest text-[11px] hover:underline uppercase self-end flex items-center gap-1"
                >
                  APPLY FOR FINANCING <span className="text-2xl font-normal leading-none font-sans relative -top-0.5">›</span>
                </button>
              </div>
            </div>
          )}

        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
};

const DealerGuideModal = ({ isOpen, onClose, step, setStep }: { isOpen: boolean; onClose: () => void; step: number; setStep: (s: number | ((prev: number) => number)) => void }) => {
  if (!isOpen) return null;

  const totalSteps = 5;

  const handleNext = () => {
    if (step < totalSteps - 1) {
      setStep(step + 1);
    } else {
      onClose();
    }
  };

  const handlePrev = () => {
    if (step > 0) {
      setStep(step - 1);
    }
  };

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 bg-black/85 backdrop-blur-md z-[300] flex items-center justify-center p-4 pointer-events-auto"
      >
        <motion.div
          initial={{ scale: 0.95, y: 25 }}
          animate={{ scale: 1, y: 0 }}
          exit={{ scale: 0.95, y: 25 }}
          transition={{ type: 'spring', duration: 0.5 }}
          className="bg-[#0b0c10]/95 border border-market/40 rounded-2xl max-w-2xl w-full flex flex-col h-[85vh] max-h-[620px] shadow-2xl relative text-white overflow-hidden"
        >
          {/* Header */}
          <div className="flex justify-between items-center bg-gradient-to-r from-market/20 to-transparent p-5 border-b border-white/10 shrink-0">
            <div className="flex items-center gap-2">
              <BookOpen className="text-market animate-pulse" size={22} />
              <h2 className="text-xl font-black uppercase tracking-wider text-market">
                Dealership Quick Start Guide
              </h2>
            </div>
            <button
              onClick={onClose}
              className="text-gray-400 hover:text-white transition-colors p-1 rounded-full hover:bg-white/5"
            >
              ✕
            </button>
          </div>

          {/* Body Content Slider */}
          <div className="flex-grow overflow-y-auto p-6 scrollbar-thin scrollbar-thumb-white/10 scrollbar-track-transparent">
            {step === 0 && (
              <motion.div
                initial={{ x: 20, opacity: 0 }}
                animate={{ x: 0, opacity: 1 }}
                className="flex flex-col gap-4 animate-in fade-in"
              >
                <div className="text-center mb-2">
                  <h3 className="text-lg font-bold text-success uppercase tracking-widest">
                    🏁 Step 1: The Core Dealership Loop
                  </h3>
                  <p className="text-xs text-gray-400 mt-1">
                    Your goal is to build a high-performance, premium Used Car Empire. Here is the operational loop that drives all profits:
                  </p>
                </div>

                <div className="grid grid-cols-5 gap-2 items-center text-center mt-2">
                  <div className="bg-white/5 border border-white/10 rounded-xl p-2.5 flex flex-col items-center gap-1.5 hover:border-market/40 transition-colors">
                    <span className="text-lg">🛒</span>
                    <span className="text-[10px] font-black uppercase tracking-widest text-market">1. Acquire</span>
                    <span className="text-[8px] text-gray-400 leading-tight">Buy cheap at Stand-off Auction</span>
                  </div>
                  <div className="text-gray-500 font-bold">➔</div>
                  <div className="bg-white/5 border border-white/10 rounded-xl p-2.5 flex flex-col items-center gap-1.5 hover:border-market/40 transition-colors">
                    <span className="text-lg">📋</span>
                    <span className="text-[10px] font-black uppercase tracking-widest text-market">2. Comply</span>
                    <span className="text-[8px] text-gray-400 leading-tight">Register at DMV / inspect</span>
                  </div>
                  <div className="text-gray-500 font-bold">➔</div>
                  <div className="bg-white/5 border border-white/10 rounded-xl p-2.5 flex flex-col items-center gap-1.5 hover:border-market/40 transition-colors">
                    <span className="text-lg">🔧</span>
                    <span className="text-[10px] font-black uppercase tracking-widest text-market">3. Recon</span>
                    <span className="text-[8px] text-gray-400 leading-tight">Repair Body & Mechanic parts</span>
                  </div>
                </div>

                <div className="flex justify-center items-center gap-6 my-1">
                  <div className="text-gray-500 font-bold rotate-90">➔</div>
                  <div className="text-gray-500 font-bold -rotate-90">➔</div>
                </div>

                <div className="grid grid-cols-3 gap-4 items-center text-center max-w-sm mx-auto">
                  <div className="bg-white/5 border border-white/10 rounded-xl p-3 flex flex-col items-center gap-1.5 hover:border-market/40 transition-colors">
                    <span className="text-lg">🧼</span>
                    <span className="text-[10px] font-black uppercase tracking-widest text-market">4. Detail</span>
                    <span className="text-[8px] text-gray-400 leading-tight">Wash dirty cars and display on show pad</span>
                  </div>
                  <div className="text-gray-500 font-bold">➔</div>
                  <div className="bg-white/5 border border-white/10 rounded-xl p-3 flex flex-col items-center gap-1.5 hover:border-market/40 transition-colors">
                    <span className="text-lg">🤝</span>
                    <span className="text-[10px] font-black uppercase tracking-widest text-market">5. Monetize</span>
                    <span className="text-[8px] text-gray-400 leading-tight">Negotiate, match budget & cash out</span>
                  </div>
                </div>

                <div className="bg-market/10 border border-market/30 rounded-xl p-4 mt-2 text-left">
                  <span className="text-xs font-bold text-market uppercase tracking-widest block mb-1">💡 Quick Pro-Tip</span>
                  <p className="text-[11px] text-gray-300 leading-relaxed">
                    Vehicles sitting on the display pad won't sell unless they are fully **Registered** at the DMV, **Washed** (drive to detailing bay), and **State Inspected** (if salvage title). Check your inventory list alerts to see what your cars need!
                  </p>
                </div>
              </motion.div>
            )}

            {step === 1 && (
              <motion.div
                initial={{ x: 20, opacity: 0 }}
                animate={{ x: 0, opacity: 1 }}
                className="flex flex-col gap-4 animate-in fade-in"
              >
                <div className="text-center mb-2">
                  <h3 className="text-lg font-bold text-success uppercase tracking-widest">
                    🛒 Step 2: Global Auction & MMR
                  </h3>
                  <p className="text-xs text-gray-400 mt-1">
                    Acquiring premium vehicles at wholesale price is the start of your profit funnel.
                  </p>
                </div>

                <div className="grid grid-cols-2 gap-4 text-left">
                  <div className="bg-white/5 border border-white/10 p-4 rounded-xl flex flex-col gap-2">
                    <div className="flex items-center gap-2 text-market">
                      <TrendingUp size={16} />
                      <span className="text-xs font-bold uppercase tracking-widest">MMR Valuations</span>
                    </div>
                    <p className="text-[10px] text-gray-400 leading-relaxed">
                      Every car has an estimated **MMR (Manheim Market Report)** base wholesale value. Buying well below MMR leaves room for reconditioning expenses. Watch out: salvage titles depreciate base wholesale but offer massive rebuilding upside!
                    </p>
                  </div>

                  <div className="bg-white/5 border border-white/10 p-4 rounded-xl flex flex-col gap-2">
                    <div className="flex items-center gap-2 text-warning">
                      <Activity size={16} />
                      <span className="text-xs font-bold uppercase tracking-widest">Locked Diagnostics & PSI</span>
                    </div>
                    <p className="text-[10px] text-gray-400 leading-relaxed">
                      Auction cars are sold with locked diagnostic scores (`???`). Bidding blind is highly risky. Order a **PSI (Post-Sale Inspection) report for $250** to reveal hidden cosmetic and mechanical faults before bidding!
                    </p>
                  </div>
                </div>

                <div className="bg-white/5 border border-white/10 p-4 rounded-xl text-left">
                  <span className="text-xs font-bold text-white uppercase tracking-widest block mb-2">Cash Buying vs Floor Planning</span>
                  <div className="grid grid-cols-2 gap-4 text-[10px]">
                    <div className="border-r border-white/10 pr-2">
                      <strong className="text-success uppercase">💰 Pay Cash:</strong>
                      <p className="text-gray-400 mt-1">Pay the full wholesale vehicle price immediately plus a $300 transport transport fee. Keeps your daily interest at zero.</p>
                    </div>
                    <div className="pl-2">
                      <strong className="text-warning uppercase">📈 Floor Plan line:</strong>
                      <p className="text-gray-400 mt-1">Borrow the cost from the bank with minimal upfront cash. Warning: incurs a **0.5% daily interest charge** on total borrowed balance. Pay off debt at the Accounting tab!</p>
                    </div>
                  </div>
                </div>
              </motion.div>
            )}

            {step === 2 && (
              <motion.div
                initial={{ x: 20, opacity: 0 }}
                animate={{ x: 0, opacity: 1 }}
                className="flex flex-col gap-4 animate-in fade-in"
              >
                <div className="text-center mb-2">
                  <h3 className="text-lg font-bold text-success uppercase tracking-widest">
                    📋 Step 3: DMV & Title Operations
                  </h3>
                  <p className="text-xs text-gray-400 mt-1">
                    Compliance is law. Ensure titles are completely legally cleared before putting cars on the pad.
                  </p>
                </div>

                <div className="flex flex-col gap-3 text-left">
                  <div className="bg-white/5 border border-white/10 rounded-xl p-4 flex gap-4 items-start">
                    <span className="text-2xl bg-market/10 text-market p-2 rounded-xl shrink-0">🚗</span>
                    <div>
                      <h4 className="text-xs font-bold text-white uppercase tracking-wider">Registration Obligation ($150)</h4>
                      <p className="text-[10px] text-gray-400 mt-1 leading-relaxed">
                        Every single vehicle you acquire must be registered under your dealer license before you are allowed to advertise it to the public. Head to the **DMV Services** tab to register stock for $150.
                      </p>
                    </div>
                  </div>

                  <div className="bg-white/5 border border-white/10 rounded-xl p-4 flex gap-4 items-start">
                    <span className="text-2xl bg-warning/10 text-warning p-2 rounded-xl shrink-0">⚠️</span>
                    <div>
                      <h4 className="text-xs font-bold text-white uppercase tracking-wider">Salvage State Inspections ($250)</h4>
                      <p className="text-[10px] text-gray-400 mt-1 leading-relaxed">
                        Salvage title cars are completely blocked from sale. You must physically drive salvage vehicles to the body and mechanic shops, repair BOTH mechanical and cosmetic systems to **95% or higher condition**, and then submit for state inspection for $250.
                      </p>
                    </div>
                  </div>

                  <div className="bg-success/15 border border-success/30 rounded-xl p-3 text-center">
                    <span className="text-[10px] uppercase font-black tracking-widest text-success block mb-0.5">🚀 Ultimate Rebuilt Upgrade</span>
                    <p className="text-[10px] text-success/90">
                      Once a salvage vehicle passes DMV inspection, its title brands as a premium **Rebuilt Title**, boosting its resale value drastically!
                    </p>
                  </div>
                </div>
              </motion.div>
            )}

            {step === 3 && (
              <motion.div
                initial={{ x: 20, opacity: 0 }}
                animate={{ x: 0, opacity: 1 }}
                className="flex flex-col gap-4 animate-in fade-in"
              >
                <div className="text-center mb-2">
                  <h3 className="text-lg font-bold text-success uppercase tracking-widest">
                    🔧 Step 4: Reconditioning & Mechanic Shops
                  </h3>
                  <p className="text-xs text-gray-400 mt-1">
                    Buy parts in bulk, optimize logistics, and get under the hood to maximize margins.
                  </p>
                </div>

                <div className="grid grid-cols-2 gap-4 text-left">
                  <div className="bg-white/5 border border-white/10 p-4 rounded-xl flex flex-col gap-1.5">
                    <strong className="text-xs text-purple-400 uppercase tracking-wider">🔧 Mechanic Shop</strong>
                    <p className="text-[10px] text-gray-400 leading-relaxed font-sans">
                      Drive the car down the road to the purple Mechanic Shop to perform diagnostics. Buy mechanic parts in bulk at the **Parts Store** tab to bypass high single-repair retail cost!
                    </p>
                  </div>

                  <div className="bg-white/5 border border-white/10 p-4 rounded-xl flex flex-col gap-1.5">
                    <strong className="text-xs text-blue-400 uppercase tracking-wider">🎨 Body Shop</strong>
                    <p className="text-[10px] text-gray-400 leading-relaxed font-sans">
                      Cosmetic dings, dents, scratches, and fade dramatically depress buyer budgets. Drive to the blue Body Shop down the road to inspect panels and perform body panel/paint repairs.
                    </p>
                  </div>
                </div>

                <div className="bg-white/5 border border-white/10 rounded-xl p-4 flex gap-4 items-center text-left">
                  <span className="text-2xl bg-white/5 p-2 rounded-xl shrink-0">👥</span>
                  <div>
                    <h4 className="text-xs font-bold text-white uppercase tracking-wider">Employee Leverage: Master Mechanic</h4>
                    <p className="text-[10px] text-gray-400 mt-1 leading-relaxed">
                      Hire a **Master Mechanic ($500/day)** at the **Staff** tab. They automatically slash all your repair expenses by **20%** and guarantee that complex mechanical and structural repairs **never fail**!
                    </p>
                  </div>
                </div>
              </motion.div>
            )}

            {step === 4 && (
              <motion.div
                initial={{ x: 20, opacity: 0 }}
                animate={{ x: 0, opacity: 1 }}
                className="flex flex-col gap-4 animate-in fade-in"
              >
                <div className="text-center mb-2">
                  <h3 className="text-lg font-bold text-success uppercase tracking-widest">
                    🤝 Step 5: Sales, Marketing & Contracts
                  </h3>
                  <p className="text-xs text-gray-400 mt-1">
                    Negotiate premium margins and manage dealer financing to build generational wealth.
                  </p>
                </div>

                <div className="bg-white/5 border border-white/10 rounded-xl p-4 flex flex-col gap-2 text-left">
                  <span className="text-xs font-bold text-white uppercase tracking-widest">Walk-In Traffic & Lead Generation</span>
                  <p className="text-[10px] text-gray-400 leading-relaxed">
                    Choose a **Marketing Tier** in your lot panel. Craigslist is free ($0/day), Meta Ads ($100/day) boosts volume, and Autotrader ($300/day) generates a constant flood of eager retail walk-ins!
                  </p>
                </div>

                <div className="grid grid-cols-2 gap-4 text-left">
                  <div className="bg-white/5 border border-white/10 p-4 rounded-xl flex flex-col gap-1.5">
                    <strong className="text-xs text-success uppercase tracking-widest">💳 In-House Financing (BHPH)</strong>
                    <p className="text-[10px] text-gray-400 leading-relaxed font-sans">
                      Accepting Buy-Here-Pay-Here financing generates massive long-term passive daily revenue yield. But beware: high-risk buyers might **default** and go delinquent!
                    </p>
                  </div>

                  <div className="bg-white/5 border border-white/10 p-4 rounded-xl flex flex-col gap-1.5">
                    <strong className="text-xs text-warning uppercase tracking-widest">🚨 Delinquency & Repossessions</strong>
                    <p className="text-[10px] text-gray-400 leading-relaxed font-sans">
                      If a customer goes delinquent, hire a **Repo Agent for $400** in the accounting menu. They will track down, seize, and return the vehicle directly to your lot!
                    </p>
                  </div>
                </div>

                <div className="bg-market/10 border border-market/30 rounded-xl p-3 flex justify-between items-center gap-4 text-left">
                  <p className="text-[9.5px] text-gray-300 leading-normal">
                    💡 **Hire F&I Managers & Salespeople** at the Staff tab to boost dealer sales margin by **10%** and slash financing default rates!
                  </p>
                  <button
                    onClick={onClose}
                    className="bg-market text-black font-black uppercase text-[10px] tracking-widest px-4 py-2 rounded-lg hover:bg-blue-400 transition-colors shrink-0"
                  >
                    Start Empire!
                  </button>
                </div>
              </motion.div>
            )}
          </div>

          {/* Footer Controls */}
          <div className="flex justify-between items-center p-5 border-t border-white/10 bg-[#08090d] shrink-0">
            <button
              onClick={handlePrev}
              disabled={step === 0}
              className="flex items-center gap-1.5 px-4 py-2 rounded-lg border border-white/10 text-xs font-bold uppercase transition-all hover:bg-white/5 disabled:opacity-20 disabled:pointer-events-none cursor-pointer"
            >
              <ChevronLeft size={16} /> Back
            </button>

            {/* Progress Dots */}
            <div className="flex gap-2">
              {Array.from({ length: totalSteps }).map((_, i) => (
                <button
                  key={i}
                  onClick={() => setStep(i)}
                  className={`w-2.5 h-2.5 rounded-full transition-all duration-300 ${step === i ? 'bg-market scale-125 shadow-[0_0_8px_#3b82f6]' : 'bg-white/20 hover:bg-white/40'}`}
                />
              ))}
            </div>

            <button
              onClick={handleNext}
              className="flex items-center gap-1.5 px-5 py-2.5 rounded-lg bg-market text-black text-xs font-black uppercase tracking-wider transition-all hover:bg-blue-400 cursor-pointer shadow-[0_0_15px_rgba(59,130,246,0.3)]"
            >
              {step === totalSteps - 1 ? 'Start Playing' : 'Next'} <ChevronRight size={16} />
            </button>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
};

const NegotiationModal = ({ agentId, setAgentId, carId, setCarId }: any) => {
  const { gameState, playerId, proposeDeal, counterOffer, rejectDeal, finalizeDeal } = useGameStore();
  const [counterInput, setCounterInput] = useState('');
  
  if (!gameState || !playerId || !agentId) return null;
  const me = gameState.players[playerId];
  if (!me) return null;
  const agents = gameState.activeWalkIns[playerId] || [];
  const agent = agents.find(a => a.id === agentId);
  if (!agent) {
      // Avoid infinite loop by not updating state in render, handled by useEffect in real app, but safe enough here
      return null;
  }

  const car = carId ? me.inventory.find((c: any) => c.id === carId) : null;
  const proposal = agent.activeProposal;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        className="fixed inset-0 bg-black/80 backdrop-blur-sm z-[100] flex items-center justify-center p-4 pointer-events-auto"
      >
        <motion.div
          initial={{ scale: 0.9, y: 20 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.9, y: 20 }}
          className="bg-[#0a0a0a] border border-blue-500/50 p-6 rounded-xl max-w-lg w-full flex flex-col gap-4 shadow-2xl relative"
        >
          <button onClick={() => { setAgentId(null); setCarId(null); }} className="absolute top-4 right-4 text-gray-500 hover:text-white transition-colors">✕</button>
          
          <h2 className="text-2xl font-black uppercase tracking-widest text-blue-400">
            {agent.state === 'browsing' ? 'Select Vehicle for Agent' : 'Negotiate Deal'}
          </h2>
          
          <div className="flex gap-4 p-3 bg-white/5 rounded border border-white/10">
            <div className="flex flex-col flex-1">
              <span className="text-sm font-bold text-white uppercase">{agent.name}</span>
              <span className="text-xs text-gray-400">Budget: <span className="text-green-400">${agent.budget.toLocaleString()}</span></span>
              <span className="text-xs text-gray-400">Credit: <span className="text-yellow-400">{agent.creditScore}</span></span>
            </div>
            <div className="flex flex-col flex-1 border-l border-white/10 pl-4">
               <span className="text-xs text-gray-400">Needs Max: <span className="text-white">{agent.needs.maxMileage.toLocaleString()} mi</span></span>
               <span className="text-xs text-gray-400">Needs Min Cond: <span className="text-white">{agent.needs.minCondition}%</span></span>
            </div>
          </div>

          {agent.state === 'browsing' ? (
            <div className="flex flex-col gap-2 max-h-[40vh] overflow-y-auto pr-2 scrollbar-thin scrollbar-thumb-white/10">
               <h3 className="text-xs font-bold text-gray-500 uppercase tracking-widest border-b border-white/10 pb-1 mb-1">Available Inventory</h3>
               {me.inventory.filter((c:any) => c.isProcessed && c.isRegistered && c.titleStatus !== 'Salvage').map((c:any) => (
                   <div key={c.id} onClick={() => setCarId(c.id)} className={`p-3 rounded border cursor-pointer flex justify-between items-center transition-colors ${carId === c.id ? 'bg-blue-500/20 border-blue-500' : 'bg-black/40 border-white/5 hover:border-white/20'}`}>
                       <div className="flex flex-col">
                           <span className="text-sm font-bold text-white">{c.year} {c.make} {c.model}</span>
                           <span className="text-xs text-gray-400">{c.mileage.toLocaleString()} mi | {Math.floor(c.condition)}% Cond</span>
                       </div>
                       <div className="text-right flex flex-col">
                           <span className="text-xs text-success font-bold">${c.buyPrice.toLocaleString()} Cost</span>
                           {carId === c.id && <span className="text-[10px] text-blue-400 uppercase tracking-widest mt-1 animate-pulse">Selected</span>}
                       </div>
                   </div>
               ))}
               {me.inventory.filter((c:any) => c.isProcessed && c.isRegistered && c.titleStatus !== 'Salvage').length === 0 && (
                   <div className="text-gray-500 italic text-sm text-center p-4">No eligible cars on the lot. Ensure cars are washed, registered, and parked on the display pad.</div>
               )}
               
               <button 
                  onClick={() => proposeDeal(agent.id, carId)}
                  disabled={!carId}
                  className="mt-4 bg-blue-500 hover:bg-blue-400 text-black font-bold uppercase py-3 rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
               >
                  Generate Proposal
               </button>
            </div>
          ) : proposal ? (
             <div className="flex flex-col gap-4">
                 <div className="bg-blue-500/10 border border-blue-500/30 p-4 rounded text-center">
                    <span className="text-xs uppercase tracking-widest text-blue-400 block mb-1">Agent's Initial Offer</span>
                    <span className="text-3xl font-black text-white">${proposal.totalValue.toLocaleString()}</span>
                    <div className="text-xs text-gray-400 mt-2 uppercase flex justify-center gap-4">
                        <span>Deal Type: <strong className="text-white">{proposal.dealType.toUpperCase()}</strong></span>
                        {proposal.dealType !== 'cash' && <span>Down: <strong className="text-white">${proposal.downPayment.toLocaleString()}</strong></span>}
                    </div>
                 </div>

                 <div className="flex flex-col gap-2 p-3 bg-white/5 rounded border border-white/10">
                     <span className="text-xs uppercase tracking-widest text-gray-400">Counter Offer</span>
                     <div className="flex gap-2">
                         <input 
                            type="number" 
                            className="flex-1 bg-black/50 border border-white/20 rounded px-3 py-2 text-white outline-none focus:border-blue-500 transition-colors"
                            placeholder="Enter amount..."
                            value={counterInput}
                            onChange={e => setCounterInput(e.target.value)}
                         />
                         <button 
                            onClick={() => { counterOffer(agent.id, Number(counterInput)); setCounterInput(''); }}
                            className="bg-market/20 text-market hover:bg-market hover:text-black border border-market/50 px-4 rounded font-bold uppercase text-xs transition-colors"
                         >
                             Counter
                         </button>
                     </div>
                 </div>
                 
                 <div className="grid grid-cols-2 gap-3 mt-2">
                     <button onClick={() => { finalizeDeal(car?.id, agent.id); setAgentId(null); setCarId(null); }} className="bg-success text-black py-3 rounded font-black uppercase text-sm hover:bg-green-400 transition-colors">
                         Accept Deal
                     </button>
                     <button onClick={() => { rejectDeal(agent.id); setAgentId(null); setCarId(null); }} className="bg-red-500/20 text-red-500 border border-red-500/50 py-3 rounded font-black uppercase text-sm hover:bg-red-500 hover:text-white transition-colors">
                         Reject Walk-Away
                     </button>
                 </div>
             </div>
          ) : null}

        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
};

const ClockDisplay = () => {
  const timeOfDay = useGameStore(s => s.timeOfDay);
  const day = useGameStore(s => s.gameState?.day || 1);
  const isAuctionOpen = useGameStore(s => s.timeOfDay >= 8.0 && s.timeOfDay < 17.0);
  const hours = Math.floor(timeOfDay);
  const minutes = Math.floor((timeOfDay - hours) * 60);
  const ampm = hours >= 12 && hours < 24 ? 'PM' : 'AM';
  const displayHours = hours % 12 || 12;
  const timeString = `${displayHours}:${minutes.toString().padStart(2, '0')} ${ampm}`;

  return (
    <div className="flex gap-4 items-center mt-2 lg:mt-0">
      <div className="flex items-center gap-2 text-white/50 border border-white/10 rounded px-2 py-1 text-[10px] uppercase font-bold tracking-widest bg-black/50">
        <Clock size={16} /> Day {day} | {timeString}
      </div>
      <div className={`flex items-center gap-2 border rounded px-2 py-1 text-[10px] uppercase font-bold tracking-widest ${isAuctionOpen ? 'text-green-500 border-green-500/30 bg-green-500/10' : 'text-red-500 border-red-500/30 bg-red-500/10'}`}>
        {isAuctionOpen ? 'Auction Open' : 'Auction Closed'}
      </div>
    </div>
  );
};

function App() {
  const { connect, gameState, playerId, buyCar, buyPsi, proposeDeal, counterOffer, rejectDeal, finalizeDeal, repairCar, requestInspection, registerVehicle, buyPart, scrapCar, buyScrapCar, orderRepo, setMarketingTier, upgradeLot, endDay, activeInteraction, openBankModal } = useGameStore();
  const timeOfDay = gameState?.timeOfDay || 8.0;
  const isAuctionOpen = timeOfDay >= 8.0 && timeOfDay < 17.0;
  const keyboardMap = useMemo(() => [
    { name: 'forward', keys: ['ArrowUp', 'KeyW'] },
    { name: 'backward', keys: ['ArrowDown', 'KeyS'] },
    { name: 'left', keys: ['ArrowLeft', 'KeyA'] },
    { name: 'right', keys: ['ArrowRight', 'KeyD'] },
    { name: 'jump', keys: ['Space'] },
    { name: 'interact', keys: ['KeyE'] },
    { name: 'r', keys: ['KeyR'] }
  ], []);

  const [nameInput, setNameInput] = useState('');
  const [lotScaleInput, setLotScaleInput] = useState<'Small' | 'Medium' | 'Large'>('Small');
  const [careerFocusInput, setCareerFocusInput] = useState<'dealership' | 'standalone'>('dealership');
  const [shopSpecialtyInput, setShopSpecialtyInput] = useState<'mechanic' | 'body' | 'dual'>('mechanic');
  const [activeTab, setActiveTab] = useState<'lot' | 'auction' | 'accounting' | 'crm' | 'dmv' | 'parts' | 'staff' | 'standalone-shops' | 'standalone-body'>('lot');
  const [expandedCarId, setExpandedCarId] = useState<string | null>(null);
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
  const [selectedCarForAgent, setSelectedCarForAgent] = useState<string | null>(null);
  const [counterValue, setCounterValue] = useState<string>('');
  const [showMoreMenu, setShowMoreMenu] = useState(false);
  const [mobileLotSubTab, setMobileLotSubTab] = useState<'finance' | 'inventory'>('finance');
  const [mobilePartsSubTab, setMobilePartsSubTab] = useState<'mechanic' | 'body'>('mechanic');

  // Guide state
  const [autoShowGuide, setAutoShowGuide] = useState(true);
  const [showGuide, setShowGuide] = useState(false);
  const [guideStep, setGuideStep] = useState(0);
  const [hasShownInitialGuide, setHasShownInitialGuide] = useState(false);

  // UI Toggle State
  const [showUI, setShowUI] = useState(true);

  // Mobile detection
  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    const checkMobile = () => {
      const mobileCheck = window.innerWidth <= 1024 || /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) || ('ontouchstart' in window) || (navigator.maxTouchPoints > 0);
      setIsMobile(mobileCheck);
    };
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Tab') {
        e.preventDefault();
        setShowUI(prev => !prev);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  useEffect(() => {
    const handleOpenAuction = () => {
      setActiveTab('auction');
      setShowUI(true);
    };
    window.addEventListener('open_auction', handleOpenAuction);
    return () => window.removeEventListener('open_auction', handleOpenAuction);
  }, []);

  useEffect(() => {
    if (playerId && gameState && autoShowGuide && !hasShownInitialGuide) {
      setShowGuide(true);
      setHasShownInitialGuide(true);
    }
  }, [playerId, gameState, autoShowGuide, hasShownInitialGuide]);

  useEffect(() => {
    const activePlayer = gameState?.players[playerId || ''];
    if (activePlayer && (activePlayer as any).isStandaloneOperator) {
      if ((activePlayer as any).shopSpecialty === 'body') {
        setActiveTab('standalone-body');
      } else {
        setActiveTab('standalone-shops');
      }
    }
  }, [playerId, gameState]);

  // Initial Connect screen
  if (!playerId || !gameState) {
    return (
      <div className="flex flex-col gap-4 min-h-screen items-center justify-center bg-background p-4 overflow-y-auto">
        
        {/* CARD 1: Brand Identity & Name Input */}
        <motion.div
          initial={{ y: -20, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ duration: 0.5 }}
          className="panel flex flex-col items-center gap-4 p-6 max-w-sm w-full border-market/30 bg-black/90 backdrop-blur-xl shadow-2xl rounded-2xl shrink-0"
        >
          <div className="text-center">
            <h1 className="text-2xl font-black tracking-tighter text-white uppercase flex items-center justify-center gap-2">
              <Sparkles className="text-market w-5 h-5 animate-pulse" />
              Used Car Empire
            </h1>
            <p className="text-[10px] text-gray-500 font-mono uppercase tracking-widest mt-1">Initialize corporate simulator</p>
          </div>

          <div className="w-full flex flex-col gap-1.5 text-left">
            <label className="text-[9px] font-black text-gray-500 uppercase tracking-widest">Company Operator Name</label>
            <input
              type="text"
              className="w-full bg-black/60 border border-white/10 rounded-xl px-4 py-2.5 text-xs text-white focus:outline-none focus:border-market transition-all"
              placeholder="e.g. Apex Corporate"
              value={nameInput}
              onChange={(e) => setNameInput(e.target.value)}
            />
          </div>
        </motion.div>

        {/* CARD 2: Career Path & Business Specialty Settings */}
        <motion.div
          initial={{ y: 20, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ duration: 0.5, delay: 0.15 }}
          className="panel flex flex-col gap-5 p-6 max-w-sm w-full border-market/30 bg-black/90 backdrop-blur-xl shadow-2xl rounded-2xl shrink-0"
        >
          <div className="w-full flex flex-col gap-2">
            <span className="text-[9px] font-black text-gray-500 uppercase tracking-widest text-left">Select Career Path</span>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setCareerFocusInput('dealership')}
                className={`py-2.5 text-[10px] font-black uppercase tracking-wider rounded-xl border transition-all ${careerFocusInput === 'dealership' ? 'bg-market text-black border-market shadow-[0_0_10px_rgba(59,130,246,0.3)] font-black' : 'bg-white/5 text-gray-400 border-white/10 hover:border-white/20'}`}
              >
                💼 Dealership
              </button>
              <button
                type="button"
                onClick={() => setCareerFocusInput('standalone')}
                className={`py-2.5 text-[10px] font-black uppercase tracking-wider rounded-xl border transition-all ${careerFocusInput === 'standalone' ? 'bg-emerald-500 text-black border-emerald-500 shadow-[0_0_10px_rgba(16,185,129,0.3)] font-black' : 'bg-white/5 text-gray-400 border-white/10 hover:border-white/20'}`}
              >
                🔧 Repair Shop
              </button>
            </div>
          </div>

          {careerFocusInput === 'dealership' ? (
            <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} className="w-full flex flex-col gap-2">
              <span className="text-[9px] font-black text-gray-500 uppercase tracking-widest text-left">Select Dealership Tier</span>
              <div className="grid grid-cols-3 gap-2">
                <button
                  type="button"
                  onClick={() => setLotScaleInput('Small')}
                  className={`py-2 text-[8.5px] font-black uppercase tracking-wider rounded-lg border transition-all ${lotScaleInput === 'Small' ? 'bg-market/25 text-market border-market' : 'bg-transparent text-gray-400 border-white/10 hover:border-white/20'}`}
                >
                  Small ($25K)
                </button>
                <button
                  type="button"
                  onClick={() => setLotScaleInput('Medium')}
                  className={`py-2 text-[8.5px] font-black uppercase tracking-wider rounded-lg border transition-all ${lotScaleInput === 'Medium' ? 'bg-market/25 text-market border-market' : 'bg-transparent text-gray-400 border-white/10 hover:border-white/20'}`}
                >
                  Med ($75K)
                </button>
                <button
                  type="button"
                  onClick={() => setLotScaleInput('Large')}
                  className={`py-2 text-[8.5px] font-black uppercase tracking-wider rounded-lg border transition-all ${lotScaleInput === 'Large' ? 'bg-market/25 text-market border-market' : 'bg-transparent text-gray-400 border-white/10 hover:border-white/20'}`}
                >
                  Large ($250K)
                </button>
              </div>
            </motion.div>
          ) : (
            <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} className="w-full flex flex-col gap-2">
              <span className="text-[9px] font-black text-gray-500 uppercase tracking-widest text-left">Select Shop Specialty</span>
              <div className="grid grid-cols-3 gap-2">
                <button
                  type="button"
                  onClick={() => setShopSpecialtyInput('mechanic')}
                  className={`py-2 text-[8.5px] font-black uppercase tracking-wider rounded-lg border transition-all ${shopSpecialtyInput === 'mechanic' ? 'bg-emerald-500/25 text-emerald-400 border-emerald-500' : 'bg-transparent text-gray-400 border-white/10 hover:border-white/20'}`}
                >
                  Mechanic ($45K)
                </button>
                <button
                  type="button"
                  onClick={() => setShopSpecialtyInput('body')}
                  className={`py-2 text-[8.5px] font-black uppercase tracking-wider rounded-lg border transition-all ${shopSpecialtyInput === 'body' ? 'bg-emerald-500/25 text-emerald-400 border-emerald-500' : 'bg-transparent text-gray-400 border-white/10 hover:border-white/20'}`}
                >
                  Body Shop ($35K)
                </button>
                <button
                  type="button"
                  onClick={() => setShopSpecialtyInput('dual')}
                  className={`py-2 text-[8.5px] font-black uppercase tracking-wider rounded-lg border transition-all ${shopSpecialtyInput === 'dual' ? 'bg-emerald-500/25 text-emerald-400 border-emerald-500' : 'bg-transparent text-gray-400 border-white/10 hover:border-white/20'}`}
                >
                  Dual ($95K)
                </button>
              </div>
            </motion.div>
          )}

          <div className="w-full flex flex-col gap-2 mt-1">
            <span className="text-[9px] font-black text-gray-500 uppercase tracking-widest text-left">First Time Playing?</span>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setAutoShowGuide(true)}
                className={`py-2 text-[9.5px] font-black uppercase tracking-wider rounded-lg border transition-all ${autoShowGuide ? 'bg-success/20 text-success border-success' : 'bg-transparent text-gray-400 border-white/10 hover:border-white/30'}`}
              >
                Show Guide
              </button>
              <button
                type="button"
                onClick={() => setAutoShowGuide(false)}
                className={`py-2 text-[9.5px] font-black uppercase tracking-wider rounded-lg border transition-all ${!autoShowGuide ? 'bg-white/10 text-white border-white/30' : 'bg-transparent text-gray-400 border-white/10 hover:border-white/30'}`}
              >
                Opt Out
              </button>
            </div>
          </div>

          <button
            type="button"
            className="w-full bg-gradient-to-r from-blue-500 to-market text-black font-black uppercase tracking-widest py-3 rounded-xl transition-all hover:scale-[1.02] flex items-center justify-center gap-2 mt-2 shadow-lg cursor-pointer"
            onClick={() => connect(nameInput || (careerFocusInput === 'standalone' ? 'Apex Repair' : 'Anonymous'), lotScaleInput, careerFocusInput, shopSpecialtyInput)}
          >
            <LogIn size={18} /> Establish Connection
          </button>
        </motion.div>
      </div>
    );
  }

  const me = gameState.players[playerId];
  if (!me) return null;

  const inventoryValue = me.inventory.reduce((sum, car) => sum + car.buyPrice, 0);
  const receivableContracts = me.contracts.reduce((sum, c) => sum + (c.dailyPayment * c.daysRemaining), 0);
  const totalAssets = me.money + inventoryValue + receivableContracts;
  const netWorth = totalAssets - me.floorPlanDebt;
  const isProfitable = me.balanceSheet.totalIncome >= me.balanceSheet.totalExpenses;

  return (
    <>
      <VanillaThreeScene />
      {!showUI && <LiveMap gameState={gameState} playerId={playerId} isMobile={isMobile} />}

      {/* Permanent UI Toggle Hint */}
      {!isMobile && (
        <div className="fixed top-6 right-8 text-white/40 text-xs font-black tracking-widest uppercase z-[999] pointer-events-none">
          Press [TAB] to {showUI ? 'Hide' : 'Show'} UI / Menu
        </div>
      )}

      <div className={`ui-container flex flex-col p-3 md:p-6 h-full pointer-events-none relative z-10 transition-opacity duration-500 ${showUI ? 'opacity-100' : 'opacity-0'}`}>

        {/* Navigation Tabs (Standalone / Standoff Tabs) */}
        <div className={`hidden md:flex justify-start md:justify-center mb-6 shrink-0 w-full max-w-[calc(100%-100px)] md:max-w-full ml-2 md:mx-auto overflow-hidden ${showUI ? 'pointer-events-auto' : 'pointer-events-none'}`}>
          <div className="flex gap-2 bg-black/50 p-2 rounded-2xl border border-white/10 backdrop-blur-md overflow-x-auto max-w-full scrollbar-none whitespace-nowrap">
            <button
              onClick={() => setActiveTab('lot')}
              className={`px-3 py-2 md:px-6 md:py-3 uppercase font-black tracking-widest text-[10px] md:text-sm rounded-xl transition-all duration-300 ${activeTab === 'lot' ? 'bg-market text-black shadow-[0_0_15px_rgba(59,130,246,0.5)] scale-105' : 'text-gray-400 hover:text-white hover:bg-white/5'}`}
            >
              My Dealership
            </button>
            <button
              onClick={() => setActiveTab('standalone-shops')}
              className={`px-3 py-2 md:px-6 md:py-3 uppercase font-black tracking-widest text-[10px] md:text-sm rounded-xl transition-all duration-300 flex items-center gap-2 ${activeTab === 'standalone-shops' ? 'bg-emerald-500 text-black border-emerald-500 shadow-[0_0_15px_rgba(16,185,129,0.5)] scale-105' : 'text-gray-400 hover:text-white hover:bg-white/5 bg-emerald-500/5 border border-emerald-500/10'}`}
            >
              <Wrench size={14} className={activeTab === 'standalone-shops' ? 'text-black' : 'text-emerald-400'} />
              RepairFlow Platform
            </button>
            <button
              onClick={() => setActiveTab('standalone-body')}
              className={`px-3 py-2 md:px-6 md:py-3 uppercase font-black tracking-widest text-[10px] md:text-sm rounded-xl transition-all duration-300 flex items-center gap-2 ${activeTab === 'standalone-body' ? 'bg-blue-500 text-black border-blue-500 shadow-[0_0_15px_rgba(59,130,246,0.5)] scale-105' : 'text-gray-400 hover:text-white hover:bg-white/5 bg-blue-500/5 border border-blue-500/10'}`}
            >
              <Wrench size={14} className={activeTab === 'standalone-body' ? 'text-black' : 'text-blue-400'} />
              AutoFlow Bodyshop
            </button>
            <button
              onClick={() => setActiveTab('auction')}
              className={`px-3 py-2 md:px-6 md:py-3 uppercase font-black tracking-widest text-[10px] md:text-sm rounded-xl transition-all duration-300 flex items-center gap-2 ${activeTab === 'auction' ? 'bg-market text-black shadow-[0_0_15px_rgba(59,130,246,0.5)] scale-105' : 'text-gray-400 hover:text-white hover:bg-white/5'}`}
            >
              <Activity size={14} className={activeTab === 'auction' ? 'text-black' : 'text-market'} />
              Global Auction
            </button>
            <button
              onClick={() => setActiveTab('accounting')}
              className={`px-3 py-2 md:px-6 md:py-3 uppercase font-black tracking-widest text-[10px] md:text-sm rounded-xl transition-all duration-300 flex items-center gap-2 ${activeTab === 'accounting' ? 'bg-market text-black shadow-[0_0_15px_rgba(59,130,246,0.5)] scale-105' : 'text-gray-400 hover:text-white hover:bg-white/5'}`}
            >
              <TrendingUp size={14} className={activeTab === 'accounting' ? 'text-black' : 'text-market'} />
              Accounting
            </button>
            <button
              onClick={() => setActiveTab('crm')}
              className={`px-3 py-2 md:px-6 md:py-3 uppercase font-black tracking-widest text-[10px] md:text-sm rounded-xl transition-all duration-300 flex items-center gap-2 ${activeTab === 'crm' ? 'bg-market text-black shadow-[0_0_15px_rgba(59,130,246,0.5)] scale-105' : 'text-gray-400 hover:text-white hover:bg-white/5'}`}
            >
              <Users size={14} className={activeTab === 'crm' ? 'text-black' : 'text-market'} />
              Customers
            </button>
            <button
              onClick={() => setActiveTab('dmv')}
              className={`px-3 py-2 md:px-6 md:py-3 uppercase font-black tracking-widest text-[10px] md:text-sm rounded-xl transition-all duration-300 flex items-center gap-2 ${activeTab === 'dmv' ? 'bg-market text-black shadow-[0_0_15px_rgba(59,130,246,0.5)] scale-105' : 'text-gray-400 hover:text-white hover:bg-white/5'}`}
            >
              <FileText size={14} className={activeTab === 'dmv' ? 'text-black' : 'text-market'} />
              DMV Services
            </button>
            <button
              onClick={() => setActiveTab('parts')}
              className={`px-3 py-2 md:px-6 md:py-3 uppercase font-black tracking-widest text-[10px] md:text-sm rounded-xl transition-all duration-300 flex items-center gap-2 ${activeTab === 'parts' ? 'bg-market text-black shadow-[0_0_15px_rgba(59,130,246,0.5)] scale-105' : 'text-gray-400 hover:text-white hover:bg-white/5'}`}
            >
              <Wrench size={14} className={activeTab === 'parts' ? 'text-black' : 'text-market'} />
              Parts Store
            </button>
            <button
              onClick={() => setActiveTab('staff')}
              className={`px-3 py-2 md:px-6 md:py-3 uppercase font-black tracking-widest text-[10px] md:text-sm rounded-xl transition-all duration-300 flex items-center gap-2 ${activeTab === 'staff' ? 'bg-market text-black shadow-[0_0_15px_rgba(59,130,246,0.5)] scale-105' : 'text-gray-400 hover:text-white hover:bg-white/5'}`}
            >
              <Users size={14} className={activeTab === 'staff' ? 'text-black' : 'text-market'} />
              Staff
            </button>
            <button
              onClick={() => { setShowGuide(true); setGuideStep(0); }}
              className="px-3 py-2 md:px-6 md:py-3 uppercase font-black tracking-widest text-[10px] md:text-sm rounded-xl transition-all duration-300 flex items-center gap-2 text-warning hover:text-white hover:bg-white/5 bg-warning/10 border border-warning/20 shrink-0"
            >
              <HelpCircle size={14} className="text-warning" />
              Dealer Guide
            </button>
          </div>
        </div>

        <div className="flex justify-between flex-grow overflow-hidden">
          {/* LEFT HUD: Financial & Inventory Management */}
          <AnimatePresence mode="wait">
            {activeTab === 'lot' && (
              <motion.div
                key="lot-tab"
                initial={{ x: -40, opacity: 0 }}
                animate={{ x: 0, opacity: 1 }}
                exit={{ x: -20, opacity: 0 }}
                transition={{ type: "spring", bounce: 0.2, duration: 0.6 }}
                className="flex flex-col gap-4 max-w-full md:max-w-md w-full h-full overflow-y-auto md:overflow-y-visible pb-24 md:pb-0 pointer-events-auto scrollbar-none"
              >
                {isMobile && (
                  <div className="flex gap-2 p-1 bg-black/50 border border-white/10 rounded-xl shrink-0 pointer-events-auto w-full">
                    <button
                      onClick={() => setMobileLotSubTab('finance')}
                      className={`flex-1 py-2 text-[10px] font-black uppercase tracking-wider rounded-lg transition-all ${mobileLotSubTab === 'finance' ? 'bg-market text-black shadow-md' : 'text-gray-400'}`}
                    >
                      Finances & Marketing
                    </button>
                    <button
                      onClick={() => setMobileLotSubTab('inventory')}
                      className={`flex-1 py-2 text-[10px] font-black uppercase tracking-wider rounded-lg transition-all ${mobileLotSubTab === 'inventory' ? 'bg-market text-black shadow-md' : 'text-gray-400'}`}
                    >
                      Lot & Inventory
                    </button>
                  </div>
                )}

                {(!isMobile || mobileLotSubTab === 'finance') && (
                  <motion.div initial={{ x: -20, opacity: 0 }} animate={{ x: 0, opacity: 1 }} className="panel break-words w-full shrink-0">
                    <div className="flex justify-between items-center mb-4">
                      <h2 className="text-xl font-black uppercase tracking-widest text-white/90">{me.name}'s {me.lotScale} Lot</h2>
                      <div className="flex items-center gap-4">
                        <ClockDisplay />
                        {me.lotScale === 'Small' && me.money >= 50000 && (
                          <button onClick={() => upgradeLot()} className="bg-warning/20 text-warning hover:bg-warning hover:text-black border border-warning/50 px-3 py-1 rounded text-xs font-bold transition-colors uppercase tracking-widest shadow-[0_0_10px_rgba(234,179,8,0.3)]">
                            + Medium ($50K)
                          </button>
                        )}
                        {me.lotScale === 'Medium' && me.money >= 150000 && (
                          <button onClick={() => upgradeLot()} className="bg-warning/20 text-warning hover:bg-warning hover:text-black border border-warning/50 px-3 py-1 rounded text-xs font-bold transition-colors uppercase tracking-widest shadow-[0_0_10px_rgba(234,179,8,0.3)]">
                            + Large ($150K)
                          </button>
                        )}
                        <button
                          onClick={() => endDay()}
                          className="bg-market/20 hover:bg-market text-market hover:text-black border border-market/50 px-3 py-1 rounded text-xs font-bold transition-colors uppercase tracking-widest shadow-[0_0_10px_rgba(59,130,246,0.3)]"
                        >
                          End Day
                        </button>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                      <div className="flex flex-col">
                        <span className="text-xs text-gray-400 uppercase tracking-widest">Liquid Cash</span>
                        <div className="flex items-center gap-2 text-success">
                          <Wallet size={16} />
                          <span className="text-2xl font-bold">${me.money.toLocaleString()}</span>
                        </div>
                      </div>

                      <div className="flex flex-col">
                        <span className="text-xs text-gray-400 uppercase tracking-widest">Floor Plan Debt</span>
                        <div className="flex items-center gap-2 text-warning">
                          <DollarSign size={16} />
                          <span className="text-xl font-bold">-${me.floorPlanDebt.toLocaleString()}</span>
                        </div>
                      </div>

                      <div className="flex flex-col">
                        <span className="text-xs text-gray-400 uppercase tracking-widest">Daily Revenue</span>
                        <div className="flex items-center gap-2 text-success">
                          <TrendingUp size={16} />
                          <span className="text-lg font-bold">+${me.balanceSheet.lastTickIncome.toLocaleString()}</span>
                        </div>
                      </div>

                      <div className="flex flex-col">
                        <span className="text-xs text-gray-400 uppercase tracking-widest">Daily Exp/Int</span>
                        <div className="flex items-center gap-2 text-warning">
                          <TrendingDown size={16} />
                          <span className="text-lg font-bold">-${me.balanceSheet.lastTickExpense.toLocaleString()}</span>
                        </div>
                      </div>
                    </div>

                    <div className="mt-4 pt-4 border-t border-white/10 flex flex-col gap-2">
                      <span className="text-xs text-gray-400 uppercase tracking-widest font-bold">Marketing & Lead Gen Budget</span>
                      <div className="flex gap-2">
                        <button onClick={() => setMarketingTier('Craigslist')} className={`flex-1 py-1.5 text-xs font-bold uppercase rounded border transition-all ${me.marketingTier === 'Craigslist' ? 'bg-market text-black border-market' : 'bg-transparent text-gray-400 border-white/10 hover:border-white/30'}`}>
                          Craigslist ($0)
                        </button>
                        <button onClick={() => setMarketingTier('MetaAds')} className={`flex-1 py-1.5 text-xs font-bold uppercase rounded border transition-all ${me.marketingTier === 'MetaAds' ? 'bg-blue-500 text-white border-blue-500 shadow-[0_0_10px_rgba(59,130,246,0.3)]' : 'bg-transparent text-gray-400 border-white/10 hover:border-white/30'}`}>
                          Meta Ads ($100)
                        </button>
                        <button onClick={() => setMarketingTier('Autotrader')} className={`flex-1 py-1.5 text-xs font-bold uppercase rounded border transition-all ${me.marketingTier === 'Autotrader' ? 'bg-orange-500 text-white border-orange-500 shadow-[0_0_10px_rgba(249,115,22,0.3)]' : 'bg-transparent text-gray-400 border-white/10 hover:border-white/30'}`}>
                          Autotrader ($300)
                        </button>
                      </div>
                    </div>
                  </motion.div>
                )}

                {(!isMobile || mobileLotSubTab === 'inventory') && (
                  <motion.div initial={{ x: -20, opacity: 0 }} animate={{ x: 0, opacity: 1 }} className="panel w-full flex-grow overflow-y-visible md:overflow-y-auto shrink-0">
                    <div className="flex items-center justify-between mb-4 pb-2 border-b border-white/10">
                      <h3 className="text-sm font-bold uppercase tracking-wider text-white">Active Walk-Ins</h3>
                    </div>
                    
                    <div className="flex flex-col gap-3 mb-6">
                        {(gameState.activeWalkIns[playerId] || []).map((agent: any) => (
                            <div key={agent.id} className="bg-blue-500/10 border border-blue-500/30 p-3 rounded flex justify-between items-center group hover:bg-blue-500/20 transition-colors">
                                <div className="flex flex-col">
                                    <span className="font-bold text-white text-sm flex items-center gap-2">
                                        <Users size={14} className="text-blue-400" />
                                        {agent.name}
                                    </span>
                                    <span className="text-[10px] text-gray-400 uppercase tracking-widest">{agent.state === 'browsing' ? 'Browsing Lot...' : 'Negotiating Deal'}</span>
                                </div>
                                <button 
                                    onClick={() => setSelectedAgentId(agent.id)}
                                    className="bg-blue-500 text-black px-3 py-1.5 rounded text-xs font-bold uppercase hover:bg-blue-400 transition-colors shadow-[0_0_10px_rgba(59,130,246,0.3)]"
                                >
                                    Interact
                                </button>
                            </div>
                        ))}
                        {(!gameState.activeWalkIns[playerId] || gameState.activeWalkIns[playerId].length === 0) && (
                            <span className="text-sm italic text-gray-500">No active walk-ins. Wait for customers or increase marketing.</span>
                        )}
                    </div>

                    <div className="flex items-center justify-between mb-4 pb-2 border-b border-white/10">
                      <h3 className="text-sm font-bold uppercase tracking-wider text-white">Your Inventory</h3>
                      <span className="text-xs text-gray-400">{me.inventory.length} / {me.lotScale === 'Small' ? 10 : me.lotScale === 'Medium' ? 25 : 50} Slots</span>
                    </div>

                    <div className="flex flex-col gap-3">
                      {me.inventory.length === 0 && <span className="text-sm italic text-gray-500">Your lot is empty. Head to the auction.</span>}
                      {me.inventory.map(car => (
                        <div key={car.id} className="bg-white/5 border border-white/10 rounded p-3 text-sm">
                          <div className="font-bold flex items-center justify-between">
                            <div className="flex flex-col">
                              <span>{car.year} {car.make}</span>
                              <span className="text-[9px] text-gray-500 font-mono tracking-widest uppercase mt-0.5">{car.vin}</span>
                            </div>
                            <div className="flex gap-2 items-center">
                              {car.isRegistered && <span className="text-[9px] px-1.5 py-0.5 rounded uppercase font-black bg-blue-500/20 text-blue-400 border border-blue-500/50">Registered</span>}
                              {car.titleStatus !== 'Clean' && (
                                <span className={`text-[10px] px-1.5 py-0.5 rounded uppercase font-black ${car.titleStatus === 'Salvage' ? 'bg-red-500/20 text-red-400 border border-red-500/50' : 'bg-orange-500/20 text-orange-400 border border-orange-500/50'}`}>
                                  {car.titleStatus}
                                </span>
                              )}
                            </div>
                          </div>
                          <div className="text-xs text-gray-400 mt-1 mb-1 flex justify-between">
                            <span>Cost: ${car.buyPrice.toLocaleString()}</span>
                            <span>{car.daysOnLot} Days on Lot</span>
                          </div>
                          <ConditionDisplay car={car} expandedCarId={expandedCarId} setExpandedCarId={setExpandedCarId} />
                          {!car.isRegistered ? (
                            <div className="text-center bg-red-500/20 border border-red-500/50 rounded py-1.5 mt-2 shadow-[0_0_10px_rgba(239,68,68,0.2)]">
                              <span className="text-[10px] uppercase text-red-400 font-bold tracking-widest w-full inline-block">Requires DMV Registration</span>
                            </div>
                          ) : car.titleStatus === 'Salvage' && car.inspectionStatus !== 'Passed' ? (
                            <div className="text-center bg-orange-500/20 border border-orange-500/50 rounded py-1.5 mt-2 shadow-[0_0_10px_rgba(249,115,22,0.2)]">
                              <span className="text-[10px] uppercase text-orange-400 font-bold tracking-widest w-full inline-block">DMV Inspection Required</span>
                            </div>
                          ) : car.isDirty ? (
                            <div className="text-center bg-blue-500/20 border border-blue-500/50 rounded py-1.5 mt-2 shadow-[0_0_10px_rgba(59,130,246,0.2)]">
                              <span className="text-[10px] uppercase text-blue-400 font-bold tracking-widest w-full inline-block">Requires Wash (Drive to Bay)</span>
                            </div>
                          ) : !car.isProcessed ? (
                            <div className="text-center bg-yellow-500/20 border border-yellow-500/50 rounded py-1.5 mt-2 shadow-[0_0_10px_rgba(234,179,8,0.2)]">
                              <span className="text-[10px] uppercase text-yellow-400 font-bold tracking-widest animate-pulse w-full inline-block">Park in Show Lot to Sell</span>
                            </div>
                          ) : (
                            <div className="text-center bg-white/5 border border-white/10 rounded py-1.5 mt-2">
                              <span className="text-[10px] uppercase text-gray-500 font-bold tracking-widest animate-pulse w-full inline-block">Waiting for Walk-Ins...</span>
                            </div>
                          )}
                          <div className="grid grid-cols-2 gap-2 mt-2">
                            <button onClick={() => alert("Please get in the vehicle and drive to the Body Shop down the road to perform diagnostics and repair.")} disabled={car.bodyCondition >= 100} className={`${car.bodyCondition < 50 ? 'bg-blue-500/50 border border-blue-400 text-white animate-pulse shadow-[0_0_10px_rgba(59,130,246,0.5)]' : 'bg-blue-500/10 text-blue-400/50'} hover:bg-blue-500 hover:text-black transition-all rounded py-1 font-bold text-[10px] uppercase tracking-wider disabled:opacity-20 disabled:cursor-not-allowed`}>
                              Body: {Math.floor(car.bodyCondition)}%
                            </button>
                            <button onClick={() => alert("Please get in the vehicle and drive to the Mechanic down the road to perform diagnostics and repair.")} disabled={car.mechanicCondition >= 100} className={`${car.mechanicCondition < 50 ? 'bg-purple-500/50 border border-purple-400 text-white animate-pulse shadow-[0_0_10px_rgba(168,85,247,0.5)]' : 'bg-purple-500/10 text-purple-400/50'} hover:bg-purple-500 hover:text-black transition-all rounded py-1 font-bold text-[10px] uppercase tracking-wider disabled:opacity-20 disabled:cursor-not-allowed`}>
                              Mech: {Math.floor(car.mechanicCondition)}%
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </motion.div>
                )}
              </motion.div>
            )}
          </AnimatePresence>

          {/* RIGHT HUD: Auction */}
          <AnimatePresence mode="wait">
            {activeTab === 'auction' && (
              <motion.div
                key="auction-tab"
                initial={{ x: 20, opacity: 0 }}
                animate={{ x: 0, opacity: 1 }}
                exit={{ x: 20, opacity: 0 }}
                transition={{ type: "spring", bounce: 0.2, duration: 0.6 }}
                className="panel border-market/30 bg-[#0a0a0a]/90 backdrop-blur-xl w-full max-w-full md:max-w-lg mx-auto h-full flex flex-col pointer-events-auto"
              >
                <div className="flex items-center justify-between mb-6 pb-4 border-b border-white/10 flex-shrink-0">
                  <div className="flex items-center gap-3">
                    <Activity className="text-market animate-pulse" size={28} />
                    <div className="flex flex-col">
                      <h3 className="text-xl font-bold uppercase tracking-wider text-market">Standoff Auction</h3>
                      <div className="flex items-center gap-1.5 mt-0.5">
                        <Wallet size={12} className="text-success" />
                        <span className="text-xs font-bold text-success">${me.money.toLocaleString()} Liquid</span>
                      </div>
                    </div>
                  </div>
                  <span className="text-xs text-gray-400 bg-white/5 px-3 py-1 rounded-full border border-white/10">Global Network</span>
                </div>

                {!isAuctionOpen && (
                  <div className="bg-orange-500/10 border border-orange-500/50 p-3 rounded mb-4 text-center shrink-0">
                    <span className="text-orange-400 font-bold uppercase tracking-widest text-xs">Bidding Closed</span>
                    <p className="text-gray-400 text-xs mt-1">The Global Exchange is exclusively open from 8:00 AM to 5:00 PM.</p>
                  </div>
                )}

                <div className="flex flex-col gap-4 overflow-y-auto flex-grow pe-2 scrollbar-thin scrollbar-thumb-white/10 scrollbar-track-transparent">
                  <AnimatePresence>
                    {gameState.market.map((car) => (
                      <AuctionCarCard key={car.id} car={car} me={me} buyCar={buyCar} buyPsi={buyPsi} expandedCarId={expandedCarId} setExpandedCarId={setExpandedCarId} isAuctionOpen={isAuctionOpen} />
                    ))}
                  </AnimatePresence>
                  {gameState.market.length === 0 && (
                    <div className="text-center text-gray-500 py-8 text-sm italic">
                      Waiting for next shipment...
                    </div>
                  )}
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* CENTER HUD: Accounting & Ledger */}
          <AnimatePresence mode="wait">
            {activeTab === 'accounting' && (
              <motion.div
                key="accounting-tab"
                initial={{ y: 20, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                exit={{ y: 20, opacity: 0 }}
                transition={{ type: "spring", bounce: 0.2, duration: 0.6 }}
                className="panel border-market/30 bg-[#0a0a0a]/90 backdrop-blur-xl w-full max-w-full md:max-w-4xl mx-auto h-full flex flex-col pointer-events-auto"
              >
                <div className="flex items-center justify-between mb-6 pb-4 border-b border-white/10 flex-shrink-0">
                  <div className="flex items-center gap-3">
                    <TrendingUp className="text-market" size={28} />
                    <h3 className="text-xl font-bold uppercase tracking-wider text-market">Corporate Accounting</h3>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-8 overflow-y-auto flex-grow pe-2 scrollbar-thin scrollbar-thumb-white/10 scrollbar-track-transparent pb-24 md:pb-0">
                  {/* Balance Sheet */}
                  <div className="flex flex-col gap-4">
                    <h4 className="text-sm font-bold uppercase tracking-widest text-white/50 border-b border-white/10 pb-2">Balance Sheet</h4>

                    <div className="bg-white/5 p-4 rounded-xl border border-white/10">
                      <h5 className="text-xs font-bold text-gray-400 mb-2 uppercase tracking-wider">Assets</h5>
                      <div className="flex justify-between text-sm mb-1">
                        <span>Liquid Cash</span>
                        <span className="font-bold text-white">${me.money.toLocaleString()}</span>
                      </div>
                      <div className="flex justify-between text-sm mb-1">
                        <span>Inventory Value ({me.inventory.length} units)</span>
                        <span className="font-bold text-white">${inventoryValue.toLocaleString()}</span>
                      </div>
                      <div className="flex justify-between text-sm mb-2 pb-2 border-b border-white/5">
                        <span>Accounts Receivable (F&I)</span>
                        <span className="font-bold text-white">${receivableContracts.toLocaleString()}</span>
                      </div>
                      <div className="flex justify-between text-sm font-bold text-market">
                        <span>Total Assets</span>
                        <span>${totalAssets.toLocaleString()}</span>
                      </div>
                    </div>

                    <div className="bg-white/5 p-4 rounded-xl border border-white/10">
                      <h5 className="text-xs font-bold text-gray-400 mb-2 uppercase tracking-wider">Liabilities</h5>
                      <div className="flex justify-between text-sm mb-2 pb-2 border-b border-white/5">
                        <span>Floor Plan Debt</span>
                        <span className="font-bold text-warning">${me.floorPlanDebt.toLocaleString()}</span>
                      </div>
                      <div className="flex justify-between text-sm font-bold text-warning">
                        <span>Total Liabilities</span>
                        <span>${me.floorPlanDebt.toLocaleString()}</span>
                      </div>
                    </div>

                    <div className="bg-white/10 p-4 rounded-xl border border-market/30 shadow-[0_0_15px_rgba(59,130,246,0.1)]">
                      <div className="flex justify-between text-lg font-bold">
                        <span className="text-white">Shareholder Equity</span>
                        <span className={netWorth >= 0 ? "text-success" : "text-red-500"}>${netWorth.toLocaleString()}</span>
                      </div>
                    </div>
                  </div>

                  {/* Income Statement & Ledgers */}
                  <div className="flex flex-col gap-4">
                    <h4 className="text-sm font-bold uppercase tracking-widest text-white/50 border-b border-white/10 pb-2">Income Statement (YTD)</h4>

                    <div className="bg-white/5 p-4 rounded-xl border border-white/10">
                      <div className="flex justify-between text-sm mb-1">
                        <span className="text-gray-400">Total Gross Revenue</span>
                        <span className="font-bold text-success">+${me.balanceSheet.totalIncome.toLocaleString()}</span>
                      </div>
                      <div className="flex justify-between text-sm mb-2 pb-2 border-b border-white/5">
                        <span className="text-gray-400">Total Expenses & Interest</span>
                        <span className="font-bold text-red-500">-${me.balanceSheet.totalExpenses.toLocaleString()}</span>
                      </div>
                      <div className="flex justify-between text-sm font-bold">
                        <span className="text-white">Net Income</span>
                        <span className={isProfitable ? "text-success" : "text-red-500"}>
                          {isProfitable ? '+' : '-'}${Math.abs(me.balanceSheet.totalIncome - me.balanceSheet.totalExpenses).toLocaleString()}
                        </span>
                      </div>
                    </div>

                    <h4 className="text-sm font-bold uppercase tracking-widest text-white/50 border-b border-white/10 pb-2 mt-4">Accounts Receivable (F&I)</h4>

                    <div className="flex flex-col gap-2">
                      {me.contracts.length === 0 && <span className="text-sm italic text-gray-500">No active finance contracts.</span>}
                      {me.contracts.map(contract => {
                        const customer = me.customers?.find(c => c.id === contract.customerId);
                        const paidSoFar = (contract.totalDays - contract.daysRemaining) * contract.dailyPayment;
                        const bal = contract.daysRemaining * contract.dailyPayment;

                        return (
                          <div key={contract.id} className={`bg-white/5 p-3 rounded-lg border flex flex-col gap-1 group hover:bg-white/10 transition-colors ${contract.isDelinquent ? 'border-red-500/50 shadow-[0_0_10px_rgba(239,68,68,0.2)]' : 'border-white/5'}`}>
                            <div className="flex justify-between items-center border-b border-white/5 pb-1 mb-1 text-xs">
                              <div className="font-bold text-market">
                                {customer ? customer.name : `Contract #${contract.id.slice(-6)}`}
                              </div>
                              <div className="text-gray-400">{contract.daysRemaining} days left @ {contract.interestRate * 100}%</div>
                            </div>
                            {contract.isDelinquent && (
                              <div className="text-[10px] uppercase font-black tracking-widest text-red-500 bg-red-500/10 p-1 text-center rounded border border-red-500/20 mb-1">
                                DELINQUENT - NO PAYMENTS
                              </div>
                            )}
                            <div className="flex justify-between text-gray-300 text-xs">
                              <span>Principal</span>
                              <span className="font-bold">${contract.principal.toLocaleString()}</span>
                            </div>
                            <div className="flex justify-between text-gray-300 text-xs">
                              <span>Total Yield (w/ Int)</span>
                              <span className="font-bold">${contract.totalYield.toLocaleString()}</span>
                            </div>
                            <div className="flex justify-between text-gray-300 text-xs">
                              <span>Paid to Date</span>
                              <span className="font-bold text-success">${paidSoFar.toLocaleString()}</span>
                            </div>
                            <div className="flex justify-between font-bold text-market mt-1 pt-1 border-t border-white/5 text-xs">
                              <span>Remaining Balance</span>
                              <span>${bal.toLocaleString()}</span>
                            </div>
                            {contract.isDelinquent && contract.repoStatus !== 'Pending' && (
                              <button
                                onClick={() => orderRepo(contract.id)}
                                disabled={me.money < 400}
                                className="mt-2 w-full bg-red-500/20 hover:bg-red-500 text-red-500 hover:text-black transition-colors rounded py-1.5 font-bold text-xs border border-red-500/50"
                              >
                                Hire Repo Agent ($400)
                              </button>
                            )}
                            {contract.repoStatus === 'Pending' && (
                              <button disabled className="mt-2 w-full bg-orange-500/20 text-orange-400 border border-orange-500/20 rounded py-1.5 font-bold text-xs uppercase tracking-widest">
                                Repo Out for Recovery...
                              </button>
                            )}
                          </div>
                        )
                      })}
                    </div>

                    <h4 className="text-sm font-bold uppercase tracking-widest text-white/50 border-b border-white/10 pb-2 mt-4">Unit Sales Economics</h4>

                    <div className="flex flex-col gap-2">
                      {(!me.customers || me.customers.length === 0) && <span className="text-sm italic text-gray-500">No vehicles sold yet.</span>}
                      {me.customers?.map(cust => {
                        const gp = cust.purchasePrice - cust.originalCost;
                        return (
                          <div key={cust.id} className="bg-white/5 p-3 rounded-lg border border-white/5 text-xs flex flex-col gap-1 group hover:bg-white/10 transition-colors">
                            <div className="flex justify-between items-center border-b border-white/5 pb-1 mb-1">
                              <div className="font-bold text-white">
                                {cust.carInfo.year} {cust.carInfo.make} {cust.carInfo.model}
                              </div>
                              <div className="text-gray-400">{cust.name}</div>
                            </div>
                            <div className="flex justify-between text-gray-300">
                              <span>Purchase Cost</span>
                              <span className="font-bold text-warning">${cust.originalCost.toLocaleString()}</span>
                            </div>
                            <div className="flex justify-between text-gray-300">
                              <span>Sale Price</span>
                              <span className="font-bold text-success">${cust.purchasePrice.toLocaleString()}</span>
                            </div>
                            <div className="flex justify-between font-bold text-market mt-1 pt-1 border-t border-white/5">
                              <span>Gross Profit</span>
                              <span className={gp >= 0 ? 'text-success' : 'text-red-500'}>{gp >= 0 ? '+' : '-'}${Math.abs(gp).toLocaleString()}</span>
                            </div>
                          </div>
                        )
                      })}
                    </div>

                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* CUSTOMERS CRM HUD */}
          <AnimatePresence mode="wait">
            {activeTab === 'crm' && (
              <motion.div
                key="crm-tab"
                initial={{ y: 20, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                exit={{ y: 20, opacity: 0 }}
                transition={{ type: "spring", bounce: 0.2, duration: 0.6 }}
                className="panel border-market/30 bg-[#0a0a0a]/90 backdrop-blur-xl w-full max-w-full md:max-w-4xl mx-auto h-full flex flex-col pointer-events-auto"
              >
                <div className="flex items-center justify-between mb-6 pb-4 border-b border-white/10 flex-shrink-0">
                  <div className="flex items-center gap-3">
                    <Users className="text-market" size={28} />
                    <h3 className="text-xl font-bold uppercase tracking-wider text-market">Customer Database</h3>
                  </div>
                  <span className="text-xs text-gray-400 bg-white/5 px-3 py-1 rounded-full border border-white/10">{me.customers?.length || 0} Records</span>
                </div>

                <div className="flex flex-col gap-3 overflow-y-auto flex-grow pe-2 scrollbar-thin scrollbar-thumb-white/10 scrollbar-track-transparent">
                  {(!me.customers || me.customers.length === 0) && (
                    <div className="text-center text-gray-500 py-8 text-sm italic">
                      No customers in the database. Sell some cars!
                    </div>
                  )}
                  {me.customers?.map(cust => (
                    <div key={cust.id} className="bg-white/5 p-4 rounded-xl border border-white/10 flex flex-col gap-2 hover:border-market/30 transition-colors">
                      <div className="flex justify-between items-start border-b border-white/10 pb-2 mb-1">
                        <div>
                          <h4 className="font-black text-white text-lg">{cust.name}</h4>
                          <span className="text-xs text-market/80">{cust.phone}</span>
                        </div>
                        <div className="text-right">
                          <div className="text-xs text-gray-500 uppercase tracking-widest mb-1">Purchased Day {cust.purchaseDay}</div>
                          <div className={`text-xs font-bold px-2 py-0.5 rounded inline-block uppercase tracking-wider ${cust.dealType === 'cash' ? 'bg-success/20 text-success' : 'bg-market/20 text-market'}`}>
                            {cust.dealType} Deal
                          </div>
                        </div>
                      </div>

                      <div className="flex justify-between items-center bg-black/30 p-2 rounded border border-white/5">
                        <div className="flex gap-4">
                          <div className="flex flex-col">
                            <span className="text-[10px] text-gray-500 uppercase tracking-widest">Vehicle</span>
                            <span className="text-sm font-bold text-white">{cust.carInfo.year} {cust.carInfo.make} {cust.carInfo.model}</span>
                          </div>
                          <div className="flex flex-col">
                            <span className="text-[10px] text-gray-500 uppercase tracking-widest">VIN Number</span>
                            <span className="text-[10px] text-gray-400 font-mono mt-0.5">{cust.carInfo.vin.toUpperCase()}</span>
                          </div>
                        </div>
                        <div className="flex flex-col text-right">
                          <span className="text-[10px] text-gray-500 uppercase tracking-widest">Sale Price</span>
                          <span className="text-sm font-bold text-success">${cust.purchasePrice.toLocaleString()}</span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>

              </motion.div>
            )}

            {activeTab === 'dmv' && (
              <motion.div
                key="dmv-tab"
                initial={{ x: 40, opacity: 0 }} animate={{ x: 0, opacity: 1 }} exit={{ x: 20, opacity: 0 }} transition={{ type: "spring", bounce: 0.2, duration: 0.6 }}
                className="panel flex flex-col gap-4 max-w-full md:max-w-2xl w-full h-full pointer-events-auto"
              >
                <div className="flex justify-between items-center mb-2 pb-2 border-b border-white/10 shrink-0">
                  <div className="flex items-center gap-3 text-white">
                    <FileText className="text-market" size={28} />
                    <h2 className="text-xl font-black uppercase tracking-widest text-white/90">Department of Motor Vehicles</h2>
                  </div>
                </div>

                <div className="flex flex-col gap-4 overflow-y-auto pr-2 pb-4 scrollbar-thin scrollbar-thumb-white/10 h-full">

                  <div className="bg-white/5 border border-white/10 rounded-xl p-4">
                    <h3 className="text-lg font-bold text-white mb-2 uppercase tracking-widest border-b border-white/10 pb-2 flex items-center gap-2">
                      <DollarSign size={16} className="text-market" /> Title & Registration
                    </h3>
                    <p className="text-xs text-gray-400 mb-4">All newly acquired vehicles must be registered under your dealership license before they can be legally sold to retail customers. Registration costs $150 per vehicle.</p>

                    <div className="flex flex-col gap-2">
                      {me.inventory.length === 0 && <span className="text-sm italic text-gray-500">No vehicles in inventory.</span>}
                      {me.inventory.map(car => (
                        <div key={car.id} className="flex justify-between items-center bg-black/30 p-3 rounded border border-white/5">
                          <div className="flex flex-col">
                            <span className="font-bold text-white">{car.year} {car.make} {car.model}</span>
                            <span className="text-[10px] text-gray-500 uppercase tracking-widest font-mono mt-0.5">VIN: {car.vin}</span>
                          </div>
                          <div>
                            {car.isRegistered ? (
                              <span className="text-xs font-bold text-blue-400 bg-blue-500/20 px-3 py-1.5 rounded uppercase tracking-widest border border-blue-500/30">Registered</span>
                            ) : (
                              <button
                                onClick={() => registerVehicle(car.id)}
                                disabled={me.money < 150}
                                className="bg-market hover:bg-blue-400 text-black px-4 py-1.5 rounded font-bold uppercase text-xs transition-colors disabled:opacity-50 disabled:cursor-not-allowed shadow-[0_0_10px_rgba(59,130,246,0.3)]"
                              >
                                Register ($150)
                              </button>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="bg-white/5 border border-white/10 rounded-xl p-4">
                    <h3 className="text-lg font-bold text-white mb-2 uppercase tracking-widest border-b border-white/10 pb-2 flex items-center gap-2">
                      <Activity size={16} className="text-orange-500" /> State Salvage Inspection
                    </h3>
                    <p className="text-xs text-gray-400 mb-4">Salvage vehicles require an official state inspection to verify repairs. Both mechanical and cosmetic conditions must be repaired to 95% or higher to pass. Passing changes title status to Rebuilt.</p>

                    <div className="flex flex-col gap-2">
                      {me.inventory.filter(c => c.titleStatus === 'Salvage').length === 0 && <span className="text-sm italic text-gray-500">No salvage vehicles requiring inspection.</span>}
                      {me.inventory.filter(c => c.titleStatus === 'Salvage').map(car => (
                        <div key={car.id} className="flex justify-between items-center bg-black/30 p-3 rounded border border-white/5">
                          <div className="flex flex-col">
                            <span className="font-bold text-white">{car.year} {car.make} {car.model}</span>
                            <span className="text-[10px] text-gray-500 uppercase tracking-widest font-mono mt-0.5">VIN: {car.vin}</span>
                          </div>
                          <div>
                            {car.inspectionStatus === 'Passed' ? (
                              <span className="text-xs font-bold text-green-400 bg-green-500/20 px-3 py-1.5 rounded uppercase tracking-widest border border-green-500/30">Passed</span>
                            ) : car.inspectionStatus === 'Pending' ? (
                              <span className="text-xs font-bold text-orange-400 bg-orange-500/20 px-3 py-1.5 rounded uppercase tracking-widest border border-orange-500/30">Pending...</span>
                            ) : (
                              <button
                                onClick={() => requestInspection(car.id)}
                                disabled={car.bodyCondition < 95 || car.mechanicCondition < 95 || me.money < 250}
                                className="bg-orange-500 hover:bg-orange-400 text-black px-4 py-1.5 rounded font-bold uppercase text-xs transition-colors disabled:opacity-50 disabled:cursor-not-allowed shadow-[0_0_10px_rgba(249,115,22,0.3)]"
                              >
                                Submit ($250)
                              </button>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                </div>
              </motion.div>
            )}

            {activeTab === 'parts' && (
              <motion.div
                key="parts-tab"
                initial={{ x: 40, opacity: 0 }} animate={{ x: 0, opacity: 1 }} exit={{ x: 20, opacity: 0 }} transition={{ type: "spring", bounce: 0.2, duration: 0.6 }}
                className="panel flex flex-col gap-4 max-w-full md:max-w-2xl w-full h-full pointer-events-auto"
              >
                <div className="flex justify-between items-center bg-black/40 p-4 rounded border border-white/10">
                  <div>
                    <h3 className="text-xl font-bold uppercase tracking-widest text-white/90">Body Shop & Mechanic Supplies</h3>
                    <p className="text-xs text-gray-400 uppercase tracking-wider mt-1">Purchase parts in bulk to save money on vehicle repairs</p>
                  </div>
                  <div className="text-right">
                    <div className="text-sm text-gray-400 uppercase tracking-widest">Available Cash</div>
                    <div className="text-2xl font-black text-market tracking-tighter">${me.money.toLocaleString()}</div>
                  </div>
                </div>

                {isMobile && (
                  <div className="flex gap-2 p-1 bg-black/50 border border-white/10 rounded-xl shrink-0 pointer-events-auto w-full mb-2">
                    <button
                      onClick={() => setMobilePartsSubTab('mechanic')}
                      className={`flex-1 py-2 text-[10px] font-black uppercase tracking-wider rounded-lg transition-all ${mobilePartsSubTab === 'mechanic' ? 'bg-market text-black shadow-md' : 'text-gray-400'}`}
                    >
                      Mechanic Parts
                    </button>
                    <button
                      onClick={() => setMobilePartsSubTab('body')}
                      className={`flex-1 py-2 text-[10px] font-black uppercase tracking-wider rounded-lg transition-all ${mobilePartsSubTab === 'body' ? 'bg-market text-black shadow-md' : 'text-gray-400'}`}
                    >
                      Body & Paint Panels
                    </button>
                  </div>
                )}

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 overflow-y-auto pr-2 pb-24 md:pb-20">
                  {(!isMobile || mobilePartsSubTab === 'mechanic') && (
                    <div className="space-y-4">
                      <h4 className="font-bold text-market uppercase tracking-widest text-sm border-b border-white/10 pb-2">Mechanic Parts</h4>
                      {MECHANIC_LIB.map((p, idx) => (
                        <div key={`m-${idx}`} className="bg-black/40 p-4 rounded border border-white/5 flex flex-col gap-2 relative overflow-hidden group">
                          <div className="absolute top-0 right-0 w-16 h-16 bg-market/5 rounded-bl-full -z-10 group-hover:bg-market/10 transition-colors"></div>
                          <div className="flex justify-between items-start">
                            <h5 className="font-bold text-white/90">{p.name}</h5>
                            <span className="text-sm font-bold text-green-400">${Math.floor(p.cost * 0.75).toLocaleString()}</span>
                          </div>
                          <div className="flex justify-between items-end mt-2">
                            <div className="text-xs text-gray-400 uppercase tracking-widest">
                              Owned: <span className="text-market font-bold text-sm">{me.partsInventory?.[p.name] || 0}</span>
                            </div>
                            <button 
                              onClick={() => buyPart(p.name, Math.floor(p.cost * 0.75))}
                              disabled={me.money < Math.floor(p.cost * 0.75)}
                              className="bg-market/20 hover:bg-market hover:text-black text-market px-3 py-1 rounded text-xs font-bold transition-colors disabled:opacity-30 uppercase tracking-widest"
                            >
                              Buy Stock
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  {(!isMobile || mobilePartsSubTab === 'body') && (
                    <div className="space-y-4">
                      <h4 className="font-bold text-market uppercase tracking-widest text-sm border-b border-white/10 pb-2">Body Panels & Paint</h4>
                      {BODY_LIB.map((p, idx) => (
                        <div key={`b-${idx}`} className="bg-black/40 p-4 rounded border border-white/5 flex flex-col gap-2 relative overflow-hidden group">
                          <div className="absolute top-0 right-0 w-16 h-16 bg-blue-500/5 rounded-bl-full -z-10 group-hover:bg-blue-500/10 transition-colors"></div>
                          <div className="flex justify-between items-start">
                            <h5 className="font-bold text-white/90">{p.name}</h5>
                            <span className="text-sm font-bold text-green-400">${Math.floor(p.cost * 0.75).toLocaleString()}</span>
                          </div>
                          <div className="flex justify-between items-end mt-2">
                            <div className="text-xs text-gray-400 uppercase tracking-widest">
                              Owned: <span className="text-market font-bold text-sm">{me.partsInventory?.[p.name] || 0}</span>
                            </div>
                            <button 
                              onClick={() => buyPart(p.name, Math.floor(p.cost * 0.75))}
                              disabled={me.money < Math.floor(p.cost * 0.75)}
                              className="bg-market/20 hover:bg-market hover:text-black text-market px-3 py-1 rounded text-xs font-bold transition-colors disabled:opacity-30 uppercase tracking-widest"
                            >
                              Buy Stock
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </motion.div>
            )}

            {activeTab === 'staff' && (
              <motion.div
                key="staff-tab"
                initial={{ x: 40, opacity: 0 }} animate={{ x: 0, opacity: 1 }} exit={{ x: 20, opacity: 0 }} transition={{ type: "spring", bounce: 0.2, duration: 0.6 }}
                className="panel flex flex-col gap-4 max-w-full md:max-w-2xl w-full h-full pointer-events-auto"
              >
                <div className="flex justify-between items-center bg-black/40 p-4 rounded border border-white/10">
                  <div>
                    <h3 className="text-xl font-bold uppercase tracking-widest text-white/90">Human Resources</h3>
                    <p className="text-xs text-gray-400 uppercase tracking-wider mt-1">Hire staff to optimize and scale your dealership</p>
                  </div>
                  <div className="text-right">
                    <div className="text-sm text-gray-400 uppercase tracking-widest">Daily Payroll</div>
                    <div className="text-2xl font-black text-red-400 tracking-tighter">
                      ${((me.employees?.mechanic ? 500 : 0) + (me.employees?.salesperson ? 400 : 0) + (me.employees?.financeManager ? 800 : 0)).toLocaleString()}
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-4 overflow-y-auto pr-2 pb-20">
                  
                  {/* Master Mechanic */}
                  <div className={`p-4 rounded border flex flex-col gap-2 relative overflow-hidden transition-colors ${me.employees?.mechanic ? 'bg-market/10 border-market/50' : 'bg-black/40 border-white/5'}`}>
                    <div className="flex justify-between items-start">
                      <div>
                        <h4 className="font-bold text-white/90 text-lg uppercase tracking-widest">Master Mechanic</h4>
                        <div className="text-xs text-gray-400 mt-1 uppercase tracking-widest">Salary: <span className="text-red-400">$500 / Day</span></div>
                      </div>
                      <button 
                        onClick={() => useGameStore.getState().toggleEmployee('mechanic')}
                        className={`px-4 py-2 font-bold uppercase tracking-widest text-xs rounded transition-colors ${me.employees?.mechanic ? 'bg-red-500/20 text-red-500 hover:bg-red-500 hover:text-white' : 'bg-market/20 text-market hover:bg-market hover:text-black'}`}
                      >
                        {me.employees?.mechanic ? 'Fire' : 'Hire'}
                      </button>
                    </div>
                    <p className="text-sm text-gray-300 mt-2 leading-relaxed">
                      Automatically reduces all repair costs by 20% and ensures that complex mechanical and body repairs <span className="text-market font-bold">never fail</span>. 
                      Essential for running a high-volume salvage operation.
                    </p>
                  </div>

                  {/* Floor Salesperson */}
                  <div className={`p-4 rounded border flex flex-col gap-2 relative overflow-hidden transition-colors ${me.employees?.salesperson ? 'bg-market/10 border-market/50' : 'bg-black/40 border-white/5'}`}>
                    <div className="flex justify-between items-start">
                      <div>
                        <h4 className="font-bold text-white/90 text-lg uppercase tracking-widest">Floor Salesperson</h4>
                        <div className="text-xs text-gray-400 mt-1 uppercase tracking-widest">Salary: <span className="text-red-400">$400 / Day</span></div>
                      </div>
                      <button 
                        onClick={() => useGameStore.getState().toggleEmployee('salesperson')}
                        className={`px-4 py-2 font-bold uppercase tracking-widest text-xs rounded transition-colors ${me.employees?.salesperson ? 'bg-red-500/20 text-red-500 hover:bg-red-500 hover:text-white' : 'bg-market/20 text-market hover:bg-market hover:text-black'}`}
                      >
                        {me.employees?.salesperson ? 'Fire' : 'Hire'}
                      </button>
                    </div>
                    <p className="text-sm text-gray-300 mt-2 leading-relaxed">
                      Increases foot traffic and the probability of a customer making an offer. They also negotiate harder, increasing the baseline Cash and Bank offers by <span className="text-market font-bold">10%</span>.
                    </p>
                  </div>

                  {/* F&I Manager */}
                  <div className={`p-4 rounded border flex flex-col gap-2 relative overflow-hidden transition-colors ${me.employees?.financeManager ? 'bg-market/10 border-market/50' : 'bg-black/40 border-white/5'}`}>
                    <div className="flex justify-between items-start">
                      <div>
                        <h4 className="font-bold text-white/90 text-lg uppercase tracking-widest">F&I Manager</h4>
                        <div className="text-xs text-gray-400 mt-1 uppercase tracking-widest">Salary: <span className="text-red-400">$800 / Day</span></div>
                      </div>
                      <button 
                        onClick={() => useGameStore.getState().toggleEmployee('financeManager')}
                        className={`px-4 py-2 font-bold uppercase tracking-widest text-xs rounded transition-colors ${me.employees?.financeManager ? 'bg-red-500/20 text-red-500 hover:bg-red-500 hover:text-white' : 'bg-market/20 text-market hover:bg-market hover:text-black'}`}
                      >
                        {me.employees?.financeManager ? 'Fire' : 'Hire'}
                      </button>
                    </div>
                    <p className="text-sm text-gray-300 mt-2 leading-relaxed">
                      Finance and Insurance Manager. Thoroughly checks customer credit and income. Drastically reduces the default and repossession rate on high-risk In-House (BHPH) subprime loans.
                    </p>
                  </div>

                </div>
              </motion.div>
            )}

            {activeTab === 'standalone-shops' && (
              <StandaloneShopPlatform />
            )}

            {activeTab === 'standalone-body' && (
              <ShopManagement />
            )}

          </AnimatePresence>
        </div>

        <InspectionModal />
        <BankDashboard />
        <DealerGuideModal isOpen={showGuide} onClose={() => setShowGuide(false)} step={guideStep} setStep={setGuideStep} />

        {/* Dynamic Action Interaction Overlay (Clickable/Tappable for both PC & Mobile) */}
        {activeInteraction && (
          <div className="fixed bottom-28 left-1/2 -translate-x-1/2 z-[1000] pointer-events-auto animate-bounce">
            <button
              onClick={() => {
                if (activeInteraction.type === 'bank') {
                  openBankModal();
                } else if (activeInteraction.type === 'auction') {
                  window.dispatchEvent(new CustomEvent('open_auction'));
                } else if (activeInteraction.type === 'car' && activeInteraction.carId) {
                  // Enter/exit driving state
                  if ((window as any).setMobileTap) {
                    (window as any).setMobileTap('e');
                  } else {
                    (window as any).setMobileKey('e', true);
                    setTimeout(() => (window as any).setMobileKey('e', false), 100);
                  }
                }
              }}
              className="px-8 py-5 bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-600 hover:to-teal-700 border-2 border-emerald-400/40 text-white font-extrabold rounded-2xl shadow-[0_10px_30px_rgba(16,185,129,0.5)] hover:shadow-[0_15px_40px_rgba(16,185,129,0.7)] active:scale-95 transition-all text-sm uppercase tracking-widest flex items-center gap-3 backdrop-blur-md cursor-pointer select-none"
            >
              <span className="flex h-3 w-3 relative">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-white opacity-75"></span>
                <span className="relative inline-flex rounded-full h-3 w-3 bg-white"></span>
              </span>
              <span>{activeInteraction.label}</span>
              <span className="text-emerald-200 text-xs font-medium ml-1">
                {activeInteraction.type === 'car' ? '[E]' : '[R]'}
              </span>
            </button>
          </div>
        )}
        
        {selectedAgentId && (
            <NegotiationModal 
               agentId={selectedAgentId} 
               setAgentId={setSelectedAgentId} 
               carId={selectedCarForAgent}
               setCarId={setSelectedCarForAgent}
            />
        )}

        {isMobile && showUI && (
          <div className="fixed bottom-0 left-0 right-0 bg-[#0f0f13]/95 border-t border-white/10 backdrop-blur-xl px-4 py-3 z-[9999] flex justify-around items-center pointer-events-auto shadow-2xl rounded-t-2xl">
            <button
              onClick={() => { setActiveTab('lot'); setShowMoreMenu(false); }}
              className={`flex flex-col items-center gap-1 transition-all ${activeTab === 'lot' && !showMoreMenu ? 'text-market' : 'text-gray-400'}`}
            >
              <Car size={20} />
              <span className="text-[9px] font-black uppercase tracking-wider">My Lot</span>
            </button>
            <button
              onClick={() => { setActiveTab('auction'); setShowMoreMenu(false); }}
              className={`flex flex-col items-center gap-1 transition-all ${activeTab === 'auction' && !showMoreMenu ? 'text-market' : 'text-gray-400'}`}
            >
              <Activity size={20} />
              <span className="text-[9px] font-black uppercase tracking-wider">Auction</span>
            </button>
            <button
              onClick={() => { setActiveTab('dmv'); setShowMoreMenu(false); }}
              className={`flex flex-col items-center gap-1 transition-all ${activeTab === 'dmv' && !showMoreMenu ? 'text-market' : 'text-gray-400'}`}
            >
              <FileText size={20} />
              <span className="text-[9px] font-black uppercase tracking-wider">DMV</span>
            </button>
            <button
              onClick={() => { setActiveTab('parts'); setShowMoreMenu(false); }}
              className={`flex flex-col items-center gap-1 transition-all ${activeTab === 'parts' && !showMoreMenu ? 'text-market' : 'text-gray-400'}`}
            >
              <Wrench size={20} />
              <span className="text-[9px] font-black uppercase tracking-wider">Parts</span>
            </button>
            <button
              onClick={() => { setShowUI(false); setShowMoreMenu(false); }}
              className="flex flex-col items-center gap-1 transition-all text-gray-400 hover:text-white"
            >
              <Gamepad2 size={20} className="text-emerald-400 animate-pulse" />
              <span className="text-[9px] font-black uppercase tracking-wider text-emerald-400">Explore</span>
            </button>
            <button
              onClick={() => setShowMoreMenu(prev => !prev)}
              className={`flex flex-col items-center gap-1 transition-all ${showMoreMenu ? 'text-warning font-black scale-105' : 'text-gray-400'}`}
            >
              <Menu size={20} />
              <span className="text-[9px] font-black uppercase tracking-wider">More</span>
            </button>
          </div>
        )}

        <AnimatePresence>
          {isMobile && showUI && showMoreMenu && (
            <>
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                onClick={() => setShowMoreMenu(false)}
                className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[9990] pointer-events-auto"
              />
              <motion.div
                initial={{ y: '100%' }}
                animate={{ y: 0 }}
                exit={{ y: '100%' }}
                transition={{ type: 'spring', damping: 25, stiffness: 200 }}
                className="fixed bottom-16 left-0 right-0 bg-[#0c0d12]/95 backdrop-blur-2xl border-t border-white/10 rounded-t-3xl p-6 z-[9995] flex flex-col gap-5 pointer-events-auto shadow-2xl max-h-[60vh] overflow-y-auto"
              >
                <div className="flex justify-between items-center border-b border-white/10 pb-3">
                  <h3 className="text-sm font-black uppercase tracking-widest text-warning">More Operations</h3>
                  <button onClick={() => setShowMoreMenu(false)} className="text-gray-400 hover:text-white transition-colors">✕</button>
                </div>
                
                <div className="grid grid-cols-2 gap-3 pb-8">
                  <button
                    onClick={() => { setActiveTab('standalone-shops'); setShowMoreMenu(false); }}
                    className={`p-4 rounded-2xl border transition-all flex flex-col items-center justify-center gap-2 hover:bg-white/5 ${activeTab === 'standalone-shops' ? 'bg-emerald-500/20 border-emerald-500 text-emerald-400' : 'bg-emerald-500/5 border-emerald-500/20 text-emerald-300'}`}
                  >
                    <Wrench size={24} />
                    <span className="text-xs font-bold uppercase tracking-wider text-center">RepairFlow Platform</span>
                  </button>
                  <button
                    onClick={() => { setActiveTab('standalone-body'); setShowMoreMenu(false); }}
                    className={`p-4 rounded-2xl border transition-all flex flex-col items-center justify-center gap-2 hover:bg-white/5 ${activeTab === 'standalone-body' ? 'bg-blue-500/20 border-blue-500 text-blue-400' : 'bg-blue-500/5 border-blue-500/20 text-blue-300'}`}
                  >
                    <Wrench size={24} />
                    <span className="text-xs font-bold uppercase tracking-wider text-center">AutoFlow Bodyshop</span>
                  </button>
                  <button
                    onClick={() => { setActiveTab('accounting'); setShowMoreMenu(false); }}
                    className={`p-4 rounded-2xl border transition-all flex flex-col items-center justify-center gap-2 hover:bg-white/5 ${activeTab === 'accounting' ? 'bg-market/10 border-market text-market' : 'bg-white/5 border-white/5 text-gray-300'}`}
                  >
                    <TrendingUp size={24} />
                    <span className="text-xs font-bold uppercase tracking-wider">Accounting</span>
                  </button>
                  <button
                    onClick={() => { setActiveTab('crm'); setShowMoreMenu(false); }}
                    className={`p-4 rounded-2xl border transition-all flex flex-col items-center justify-center gap-2 hover:bg-white/5 ${activeTab === 'crm' ? 'bg-market/10 border-market text-market' : 'bg-white/5 border-white/5 text-gray-300'}`}
                  >
                    <Users size={24} />
                    <span className="text-xs font-bold uppercase tracking-wider">Customers</span>
                  </button>
                  <button
                    onClick={() => { setActiveTab('staff'); setShowMoreMenu(false); }}
                    className={`p-4 rounded-2xl border transition-all flex flex-col items-center justify-center gap-2 hover:bg-white/5 ${activeTab === 'staff' ? 'bg-market/10 border-market text-market' : 'bg-white/5 border-white/5 text-gray-300'}`}
                  >
                    <Users size={24} />
                    <span className="text-xs font-bold uppercase tracking-wider">Staff List</span>
                  </button>
                  <button
                    onClick={() => { setShowGuide(true); setGuideStep(0); setShowMoreMenu(false); }}
                    className="p-4 rounded-2xl border bg-warning/10 border-warning/30 text-warning hover:bg-warning hover:text-black transition-all flex flex-col items-center justify-center gap-2"
                  >
                    <HelpCircle size={24} />
                    <span className="text-xs font-bold uppercase tracking-wider">Dealer Guide</span>
                  </button>
                </div>
              </motion.div>
            </>
          )}
        </AnimatePresence>

      </div>

      {/* On-Screen Mobile Touch Controls */}
      {isMobile && playerId && gameState && (
        <div className="fixed inset-0 pointer-events-none z-[999] flex flex-col justify-end p-6 select-none">
          {/* Top Right Floating Menu Toggle (Always visible, responsive alignment) */}
          <div className="absolute top-6 right-6 pointer-events-auto z-[9999]">
            <button
              onClick={() => setShowUI(prev => !prev)}
              className={`border rounded-xl px-4 py-3 text-xs font-black uppercase tracking-widest active:scale-95 transition-all backdrop-blur-md shadow-lg ${showUI ? 'bg-red-500/20 text-red-500 border-red-500/30 hover:bg-red-500 hover:text-black' : 'bg-black/60 border-white/20 text-white shadow-black/40'}`}
            >
              {showUI ? '✕ Close' : '💼 Menu'}
            </button>
          </div>

          {!showUI && (
            <div className="flex justify-between items-end w-full">
              {/* Virtual D-Pad (Left Side) */}
              <div className="flex flex-col gap-2 items-center pointer-events-auto">
                <button
                  onTouchStart={() => (window as any).setMobileKey('w', true)}
                  onTouchEnd={() => (window as any).setMobileKey('w', false)}
                  className="w-14 h-14 bg-black/60 border-2 border-white/30 text-white font-bold rounded-xl active:bg-market active:text-black flex items-center justify-center text-lg shadow-lg active:scale-95 transition-transform select-none touch-none"
                >
                  ▲
                </button>
                <div className="flex gap-2">
                  <button
                    onTouchStart={() => (window as any).setMobileKey('a', true)}
                    onTouchEnd={() => (window as any).setMobileKey('a', false)}
                    className="w-14 h-14 bg-black/60 border-2 border-white/30 text-white font-bold rounded-xl active:bg-market active:text-black flex items-center justify-center text-lg shadow-lg active:scale-95 transition-transform select-none touch-none"
                  >
                    ◀
                  </button>
                  <button
                    onTouchStart={() => (window as any).setMobileKey('s', true)}
                    onTouchEnd={() => (window as any).setMobileKey('s', false)}
                    className="w-14 h-14 bg-black/60 border-2 border-white/30 text-white font-bold rounded-xl active:bg-market active:text-black flex items-center justify-center text-lg shadow-lg active:scale-95 transition-transform select-none touch-none"
                  >
                    ▼
                  </button>
                  <button
                    onTouchStart={() => (window as any).setMobileKey('d', true)}
                    onTouchEnd={() => (window as any).setMobileKey('d', false)}
                    className="w-14 h-14 bg-black/60 border-2 border-white/30 text-white font-bold rounded-xl active:bg-market active:text-black flex items-center justify-center text-lg shadow-lg active:scale-95 transition-transform select-none touch-none"
                  >
                    ▶
                  </button>
                </div>
              </div>

              {/* Virtual Action Buttons (Right Side) */}
              <div className="flex gap-3 pointer-events-auto">
                <button
                  onTouchStart={() => {
                    if ((window as any).setMobileTap) {
                      (window as any).setMobileTap('e');
                    } else {
                      (window as any).setMobileKey('e', true);
                      setTimeout(() => (window as any).setMobileKey('e', false), 100);
                    }
                  }}
                  className="w-16 h-16 bg-blue-500/80 border-2 border-blue-400/50 text-white font-black rounded-full flex items-center justify-center text-xs shadow-lg active:scale-90 active:bg-blue-600 transition-all select-none touch-none"
                >
                  DRIVE
                </button>
                <button
                  onTouchStart={() => {
                    if ((window as any).setMobileTap) {
                      (window as any).setMobileTap('r');
                    } else {
                      (window as any).setMobileKey('r', true);
                      setTimeout(() => (window as any).setMobileKey('r', false), 100);
                    }
                  }}
                  className="w-16 h-16 bg-green-500/80 border-2 border-green-400/50 text-white font-black rounded-full flex items-center justify-center text-xs shadow-lg active:scale-90 active:bg-green-600 transition-all select-none touch-none"
                >
                  ACTION
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </>
  );
}

export default App;
