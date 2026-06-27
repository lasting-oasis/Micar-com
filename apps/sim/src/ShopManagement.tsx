import React, { useState, useEffect } from 'react';
import {
  ClipboardList, Search, Hammer, Paintbrush, Wrench, ShieldCheck,
  CheckCircle, LayoutDashboard, ArrowRight, ChevronRight,
  Clock, AlertCircle, Check, ArrowLeft, Plus,
  Trash2, Settings, ShieldAlert, RefreshCw
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

const GLOSSARY = {
  'ro': { title: 'Repair Order (RO)', desc: 'A service ticket tracking a vehicle checked into the body shop.' },
  'intake': { title: 'Vehicle Intake', desc: 'The process of logging a new vehicle into the shop, performing a pre-inspection, and initializing its repair stages.' },
  'qc': { title: 'Quality Control (QC)', desc: 'The final phase where certified inspectors review structural repairs, paint finishes, and clear coats for absolute perfection.' },
  'recon': { title: 'Recon Pipeline', desc: 'Reconditioning pipeline of 7 sequential stages from intake to ready for customer delivery.' }
};

const GlossaryTerm = ({ term, children }: { term: keyof typeof GLOSSARY; children: React.ReactNode }) => {
  const [show, setShow] = useState(false);
  const info = GLOSSARY[term];
  return (
    <span className="relative inline-flex items-center gap-1 group">
      <span className="font-bold underline decoration-dashed decoration-market/50 hover:text-market cursor-help transition-colors">
        {children}
      </span>
      <button 
        type="button"
        onMouseEnter={() => setShow(true)}
        onMouseLeave={() => setShow(false)}
        onClick={() => setShow(!show)}
        className="w-3.5 h-3.5 rounded-full bg-white/10 hover:bg-market/20 hover:text-market flex items-center justify-center text-[8px] font-black text-gray-400 cursor-help select-none"
      >
        ?
      </button>
      <AnimatePresence>
        {show && (
          <motion.div
            initial={{ opacity: 0, y: 5 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 5 }}
            className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-48 p-3 bg-[#0f0f13]/95 border border-market/40 rounded-xl shadow-2xl backdrop-blur-md z-[10000] text-left select-none pointer-events-none"
          >
            <h5 className="text-[10px] font-black uppercase tracking-wider text-market mb-1">{info.title}</h5>
            <p className="text-[9px] text-gray-300 leading-normal font-sans font-medium">{info.desc}</p>
          </motion.div>
        )}
      </AnimatePresence>
    </span>
  );
};

const TUTORIAL_STEPS = [
  {
    title: 'Welcome to Repair Logistics! 🛠️',
    desc: 'This tool lets you manage and track vehicle reconditioning. Let\'s learn the basics in 4 quick steps.',
    target: 'header'
  },
  {
    title: '1. The Shop Floor 📋',
    desc: 'Switch to the "Shop Floor" tab to intake new vehicles, advance their pipeline stages, and update technician notes.',
    target: 'nav'
  },
  {
    title: '2. Customer Tracking 🔍',
    desc: 'Use "Customer Search" to track a vehicle\'s real-time, Domino\'s-style progress by searching for its RO code.',
    target: 'nav'
  },
  {
    title: '3. Layman\'s Glossary 💡',
    desc: 'Whenever you see a dotted underlined word with a (?) badge, hover over it to read its simple definition!',
    target: 'glossary'
  }
];

// Define the standard stages of the body shop repair process
const STAGES = [
  { id: 0, name: 'Intake', icon: ClipboardList, desc: 'Vehicle checked in' },
  { id: 1, name: 'Inspection', icon: Search, desc: 'Evaluating damage & ordering parts' },
  { id: 2, name: 'Body Work', icon: Hammer, desc: 'Structural and dent repairs' },
  { id: 3, name: 'Paint', icon: Paintbrush, desc: 'Priming, painting & clear coat' },
  { id: 4, name: 'Reassembly', icon: Wrench, desc: 'Putting everything back together' },
  { id: 5, name: 'Quality Control', icon: ShieldCheck, desc: 'Final checks and detailing' },
  { id: 6, name: 'Ready', icon: CheckCircle, desc: 'Ready for pickup!' },
];

// Initial preloaded datasets
const INITIAL_JOBS = [
  { id: 'RO-1024', customerName: 'Alice Johnson', vehicle: '2021 Honda Civic', status: 3, notes: 'Awaiting clear coat application. Looking good.', lastUpdated: 'Today, 9:30 AM' },
  { id: 'RO-1025', customerName: 'Bob Smith', vehicle: '2019 Ford F-150', status: 1, notes: 'Waiting on insurance approval for front bumper replacement.', lastUpdated: 'Today, 8:15 AM' },
  { id: 'RO-1026', customerName: 'Charlie Davis', vehicle: '2022 Tesla Model 3', status: 6, notes: 'Washed and ready. Customer notified via SMS.', lastUpdated: 'Yesterday, 4:00 PM' },
];

export default function ShopManagement() {
  const [view, setView] = useState<'landing' | 'admin' | 'customer' | 'tracker' | 'dev'>('landing');
  const [jobs, setJobs] = useState(INITIAL_JOBS);
  const [trackedJob, setTrackedJob] = useState<any>(null);
  const [errorMsg, setErrorMsg] = useState('');
  
  const [showTutorial, setShowTutorial] = useState(false);
  const [tutorialStep, setTutorialStep] = useState(0);
  const [selectedStageIndex, setSelectedStageIndex] = useState<number | null>(null);
  
  // New Job Inputs
  const [newVehicle, setNewVehicle] = useState('');
  const [newCustomer, setNewCustomer] = useState('');
  const [newNotes, setNewNotes] = useState('');
  const [showAddForm, setShowAddForm] = useState(false);

  // Developer permissions & overrides states
  const [allowStatusUpdates, setAllowStatusUpdates] = useState(true);
  const [allowAddJobs, setAllowAddJobs] = useState(true);
  const [allowDeleteJobs, setAllowDeleteJobs] = useState(true);
  const [allowNotesEditing, setAllowNotesEditing] = useState(true);
  const [faultOverrideActive, setFaultOverrideActive] = useState(false);

  // Sync tracked job changes if list updates
  useEffect(() => {
    if (trackedJob) {
      const match = jobs.find(j => j.id === trackedJob.id);
      if (match) setTrackedJob(match);
    }
  }, [jobs, trackedJob]);

  // Apply fault override: instantly repair all jobs to stage 6 (Ready)
  useEffect(() => {
    if (faultOverrideActive) {
      const repaired = jobs.map(j => ({ ...j, status: 6, notes: 'DEVELOPER OVERRIDE: All vehicle systems fully repaired and cleared!', lastUpdated: 'Just now' }));
      setJobs(repaired);
    }
  }, [faultOverrideActive]);

  // Updates a job's status or notes from the Admin Dashboard
  const updateJob = (id: string, newStatus: number, newNotes: string) => {
    const updatedJobs = jobs.map(job => {
      if (job.id === id) {
        return {
          ...job,
          status: newStatus,
          notes: newNotes,
          lastUpdated: 'Just now'
        };
      }
      return job;
    });
    setJobs(updatedJobs);
  };

  // Delete/Complete a repair order
  const deleteJob = (id: string) => {
    setJobs(jobs.filter(j => j.id !== id));
    if (trackedJob?.id === id) setTrackedJob(null);
  };

  // Create a new repair order
  const handleCreateJob = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newVehicle || !newCustomer) return;
    
    const nextRoNumber = 1024 + jobs.length + Math.floor(Math.random() * 50);
    const newRo = {
      id: `RO-${nextRoNumber}`,
      customerName: newCustomer,
      vehicle: newVehicle,
      status: 0,
      notes: newNotes || 'Vehicle checked in. Pre-inspection queued.',
      lastUpdated: 'Just now'
    };

    setJobs([newRo, ...jobs]);
    setNewVehicle('');
    setNewCustomer('');
    setNewNotes('');
    setShowAddForm(false);
  };

  // Navigates to the tracker if the Repair Order is valid
  const handleSearch = (query: string) => {
    const job = jobs.find(j => j.id.toLowerCase() === query.toLowerCase());
    if (job) {
      setErrorMsg('');
      setTrackedJob(job);
      setView('tracker');
    } else {
      setErrorMsg('Repair Order not found. Try RO-1024, RO-1025, or RO-1026.');
    }
  };

  const resetDemoData = () => {
    setJobs(INITIAL_JOBS);
    setTrackedJob(null);
    setFaultOverrideActive(false);
  };

  // Stats calculations
  const totalActive = jobs.filter(j => j.status < 6).length;
  const totalReady = jobs.filter(j => j.status === 6).length;
  const avgStage = jobs.length > 0 ? (jobs.reduce((acc, j) => acc + j.status, 0) / jobs.length).toFixed(1) : '0';

  return (
    <div className="bg-[#0c0d12]/90 border border-white/10 rounded-2xl p-4 md:p-6 shadow-2xl flex flex-col w-full h-full max-w-full text-white pointer-events-auto overflow-y-auto scrollbar-none pb-20">
      {/* Component Header */}
      <header className="border-b border-white/10 pb-4 mb-6 flex flex-col md:flex-row justify-between items-start md:items-center gap-4 shrink-0">
        <div className="flex items-center gap-3">
          <div className="bg-market/20 p-2.5 rounded-xl border border-market/40 shadow-[0_0_15px_rgba(59,130,246,0.2)]">
            <Wrench className="w-6 h-6 text-market animate-spin-slow" />
          </div>
          <div>
            <h1 className="text-xl font-bold tracking-wider uppercase text-white">Precision Repair Logistics</h1>
            <p className="text-xs text-gray-400 font-mono"><GlossaryTerm term="recon">Recon</GlossaryTerm> Center & Diagnostics HUD</p>
          </div>
          <button
            onClick={() => { setShowTutorial(true); setTutorialStep(0); }}
            className="ml-3 px-3 py-1.5 bg-emerald-500/20 border border-emerald-500/30 text-emerald-400 hover:bg-emerald-500 hover:text-black transition-all rounded-lg text-[10px] font-black uppercase tracking-widest flex items-center gap-1.5 animate-pulse select-none"
          >
            💡 Quick Tour
          </button>
        </div>

        {/* Local Navigation buttons */}
        <nav className="flex flex-wrap gap-2 text-xs font-bold uppercase tracking-wider">
          <button
            onClick={() => setView('landing')}
            className={`px-4 py-2 rounded-lg transition-all border ${view === 'landing' ? 'bg-market text-black border-market shadow-[0_0_10px_rgba(59,130,246,0.3)]' : 'bg-white/5 border-white/10 text-gray-300 hover:bg-white/10'}`}
          >
            Overview
          </button>
          <button
            onClick={() => setView('admin')}
            className={`px-4 py-2 rounded-lg transition-all border ${view === 'admin' ? 'bg-market text-black border-market shadow-[0_0_10px_rgba(59,130,246,0.3)]' : 'bg-white/5 border-white/10 text-gray-300 hover:bg-white/10'}`}
          >
            Shop Floor
          </button>
          <button
            onClick={() => setView('customer')}
            className={`px-4 py-2 rounded-lg transition-all border ${view === 'customer' ? 'bg-market text-black border-market shadow-[0_0_10px_rgba(59,130,246,0.3)]' : 'bg-white/5 border-white/10 text-gray-300 hover:bg-white/10'}`}
          >
            Customer Search
          </button>
          <button
            onClick={() => setView('dev')}
            className={`px-4 py-2 rounded-lg transition-all border flex items-center gap-1.5 ${view === 'dev' ? 'bg-warning/20 border-warning text-warning' : 'bg-white/5 border-white/10 text-warning/80 hover:bg-white/10'}`}
          >
            <Settings size={14} /> Dev Page
          </button>
        </nav>
      </header>

      {/* Main Views Container */}
      <div className="flex-grow">
        
        {/* VIEW 1: LANDING OVERVIEW */}
        {view === 'landing' && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-6">
            
            {/* Quick Stats Grid */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <div className="bg-white/5 border border-white/10 p-4 rounded-xl flex items-center gap-4 hover:border-market/30 transition-colors">
                <ClipboardList className="text-market w-8 h-8 shrink-0" />
                <div>
                  <span className="text-[10px] text-gray-400 uppercase tracking-widest font-black block">Total active jobs</span>
                  <span className="text-xl font-bold">{totalActive} Orders</span>
                </div>
              </div>
              <div className="bg-white/5 border border-white/10 p-4 rounded-xl flex items-center gap-4 hover:border-success/30 transition-colors">
                <CheckCircle className="text-success w-8 h-8 shrink-0 animate-pulse" />
                <div>
                  <span className="text-[10px] text-gray-400 uppercase tracking-widest font-black block">Completed / Ready</span>
                  <span className="text-xl font-bold">{totalReady} Vehicles</span>
                </div>
              </div>
              <div className="bg-white/5 border border-white/10 p-4 rounded-xl flex items-center gap-4 hover:border-market/30 transition-colors">
                <Wrench className="text-purple-400 w-8 h-8 shrink-0" />
                <div>
                  <span className="text-[10px] text-gray-400 uppercase tracking-widest font-black block">Average Recon Stage</span>
                  <span className="text-xl font-bold">Stage {avgStage} / 7</span>
                </div>
              </div>
              <div className="bg-white/5 border border-white/10 p-4 rounded-xl flex items-center gap-4 hover:border-warning/30 transition-colors">
                <ShieldAlert className="text-warning w-8 h-8 shrink-0" />
                <div>
                  <span className="text-[10px] text-gray-400 uppercase tracking-widest font-black block">Diagnostics Override</span>
                  <span className="text-xl font-bold">{faultOverrideActive ? 'ACTIVE' : 'OFF'}</span>
                </div>
              </div>
            </div>

            {/* Interactive Welcome Hero */}
            <div className="bg-gradient-to-r from-market/20 via-transparent to-transparent border border-white/10 p-6 rounded-2xl flex flex-col md:flex-row items-center justify-between gap-6">
              <div className="space-y-2 text-left">
                <h2 className="text-2xl font-black uppercase tracking-wider text-white">
                  Real-Time <span className="text-market">Reconditioning Control</span>
                </h2>
                <p className="text-sm text-gray-400 max-w-xl leading-relaxed font-medium">
                  Welcome to the Precision Auto <GlossaryTerm term="recon">reconditioning</GlossaryTerm> suite. Manage incoming customer service tickets, track mechanical and paint stages in real time, and audit your shop efficiency from our digital dashboard.
                </p>
              </div>
              <div className="flex gap-3 shrink-0 w-full md:w-auto">
                <button
                  onClick={() => setView('admin')}
                  className="flex-1 md:flex-initial px-6 py-3 bg-market hover:bg-blue-400 text-black font-black uppercase text-xs tracking-wider rounded-xl transition-all shadow-[0_0_15px_rgba(59,130,246,0.4)] flex items-center justify-center gap-2"
                >
                  <LayoutDashboard size={16} /> Enter Shop Floor
                </button>
                <button
                  onClick={() => setView('customer')}
                  className="flex-1 md:flex-initial px-6 py-3 bg-white/5 border border-white/10 hover:bg-white/10 text-white font-black uppercase text-xs tracking-wider rounded-xl transition-all flex items-center justify-center gap-2"
                >
                  <Search size={16} /> Track Vehicle
                </button>
              </div>
            </div>

            {/* Stage Previews Diagram */}
            <div className="bg-white/5 border border-white/10 p-6 rounded-2xl text-left">
              <div className="flex justify-between items-baseline mb-4">
                <h3 className="text-sm font-black uppercase tracking-widest text-market">Standard Operational Pipeline</h3>
                <span className="text-[10.5px] text-gray-400 font-semibold font-mono animate-pulse">💡 Click any stage below to explore details</span>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-7 gap-3">
                {STAGES.map((s, idx) => {
                  const Icon = s.icon;
                  const isSelected = selectedStageIndex === idx;
                  return (
                    <div 
                      key={s.id} 
                      onClick={() => setSelectedStageIndex(isSelected ? null : idx)}
                      className={`cursor-pointer bg-black/30 border p-3 rounded-xl flex flex-col items-center text-center gap-2 transition-all hover:scale-[1.02] ${isSelected ? 'border-market bg-market/5 shadow-[0_0_15px_rgba(59,130,246,0.2)]' : 'border-white/5 hover:border-market/40'}`}
                    >
                      <span className="text-[10px] text-market font-bold font-mono">STAGE {idx+1}</span>
                      <div className={`w-8 h-8 rounded-full flex items-center justify-center transition-colors ${isSelected ? 'bg-market text-black' : 'bg-market/10 text-market'}`}>
                        <Icon size={16} />
                      </div>
                      <span className="text-[10px] font-black uppercase tracking-widest text-white">{s.name}</span>
                      <span className="text-[8px] text-gray-500 leading-tight">{s.desc}</span>
                    </div>
                  );
                })}
              </div>

              {/* Click-to-Explain Details */}
              <AnimatePresence>
                {selectedStageIndex !== null && (
                  <motion.div
                    initial={{ opacity: 0, y: -10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -10 }}
                    className="mt-4 bg-market/5 border border-market/30 p-5 rounded-xl text-left relative overflow-hidden"
                  >
                    <div className="absolute top-0 left-0 w-1.5 h-full bg-market" />
                    <div className="flex justify-between items-start">
                      <div>
                        <h4 className="text-xs font-black uppercase tracking-widest text-market">
                          Stage {selectedStageIndex + 1} Deep Dive: {STAGES[selectedStageIndex].name}
                        </h4>
                        <p className="text-sm text-white font-bold mt-1 leading-normal">{STAGES[selectedStageIndex].desc}</p>
                        <p className="text-xs text-gray-400 font-sans leading-relaxed mt-2 font-medium">
                          {selectedStageIndex === 0 && 'Intake is where the vehicle first enters our shop. Check in the owner, record their contact information, and initiate the initial diagnostics code.'}
                          {selectedStageIndex === 1 && 'During Inspection, certified technicians visually assess collision damage, scan structural frames, and prepare list items for any replacement steel or side panel parts.'}
                          {selectedStageIndex === 2 && 'Body Work involves dent pulling, panel welding, frame straightening, and secondary mechanical assembly prep to restore the car\'s structural baseline.'}
                          {selectedStageIndex === 3 && 'The Paint stage applies a multi-coat primer, exact color matching spray, and a thick glossy protective clear coat. Let it cure completely!'}
                          {selectedStageIndex === 4 && 'Reassembly puts headlamps, grille panels, bumper fascias, door locks, and interior trims back onto the car according to factory standards.'}
                          {selectedStageIndex === 5 && 'Quality Control performs a comprehensive diagnostic bus scan, alignment check, test track verification, and meticulous detailing to ensure perfection.'}
                          {selectedStageIndex === 6 && 'Ready status clears the ticket, logs the gross margin, alerts the retail sales desk, and schedules the customer delivery pick-up.'}
                        </p>
                      </div>
                      <button 
                        onClick={() => setSelectedStageIndex(null)}
                        className="text-gray-400 hover:text-white font-bold text-xs uppercase cursor-pointer"
                      >
                        ✕ Close
                      </button>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

          </motion.div>
        )}

        {/* VIEW 2: ADMIN SHOP FLOOR */}
        {view === 'admin' && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-6">
            
            {/* Header control buttons */}
            <div className="flex justify-between items-center bg-white/5 border border-white/10 px-4 py-3 rounded-xl">
              <div>
                <h2 className="text-lg font-black uppercase tracking-wider text-white">Active Shop Orders</h2>
                <p className="text-xs text-gray-400 font-mono">Manage stage steps and write diagnostic reports</p>
              </div>
              <button
                disabled={!allowAddJobs}
                onClick={() => setShowAddForm(prev => !prev)}
                className="bg-market hover:bg-blue-400 text-black px-4 py-2 rounded-lg text-xs font-black uppercase tracking-widest transition-all shadow-[0_0_10px_rgba(59,130,246,0.3)] disabled:opacity-30 disabled:cursor-not-allowed flex items-center gap-1.5"
              >
                <Plus size={14} /> Intake Vehicle
              </button>
            </div>

            {/* intake Form Modal Overlay */}
            <AnimatePresence>
              {showAddForm && (
                <motion.div
                  initial={{ opacity: 0, y: -20 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -20 }}
                  className="bg-white/5 border border-white/10 p-5 rounded-2xl flex flex-col gap-4 text-left"
                >
                  <h3 className="text-sm font-black uppercase tracking-widest text-market border-b border-white/10 pb-2"><GlossaryTerm term="intake">Vehicle Intake</GlossaryTerm> Logging</h3>
                  <form onSubmit={handleCreateJob} className="grid grid-cols-1 md:grid-cols-3 gap-4 items-end">
                    <div className="flex flex-col gap-1.5">
                      <label className="text-[10px] text-gray-400 uppercase tracking-widest font-bold">Vehicle Info</label>
                      <input
                        type="text"
                        className="bg-black/50 border border-white/20 rounded-lg px-3 py-2 text-xs text-white focus:border-market focus:outline-none"
                        placeholder="e.g. 2023 Toyota Camry"
                        value={newVehicle}
                        onChange={e => setNewVehicle(e.target.value)}
                        required
                      />
                    </div>
                    <div className="flex flex-col gap-1.5">
                      <label className="text-[10px] text-gray-400 uppercase tracking-widest font-bold">Customer Name</label>
                      <input
                        type="text"
                        className="bg-black/50 border border-white/20 rounded-lg px-3 py-2 text-xs text-white focus:border-market focus:outline-none"
                        placeholder="e.g. David Miller"
                        value={newCustomer}
                        onChange={e => setNewCustomer(e.target.value)}
                        required
                      />
                    </div>
                    <div className="flex gap-2">
                      <button
                        type="submit"
                        className="flex-1 bg-success text-black py-2 rounded-lg text-xs font-black uppercase tracking-widest hover:bg-green-400 transition-colors"
                      >
                        File Intake
                      </button>
                      <button
                        type="button"
                        onClick={() => setShowAddForm(false)}
                        className="bg-white/10 hover:bg-white/20 py-2 px-4 rounded-lg text-xs font-black uppercase tracking-widest transition-colors"
                      >
                        Cancel
                      </button>
                    </div>
                    <div className="md:col-span-3 flex flex-col gap-1.5">
                      <label className="text-[10px] text-gray-400 uppercase tracking-widest font-bold">Initial Diagnostics / Notes</label>
                      <input
                        type="text"
                        className="bg-black/50 border border-white/20 rounded-lg px-3 py-2 text-xs text-white focus:border-market focus:outline-none"
                        placeholder="e.g. Front fender dent, clear coat fading..."
                        value={newNotes}
                        onChange={e => setNewNotes(e.target.value)}
                      />
                    </div>
                  </form>
                </motion.div>
              )}
            </AnimatePresence>

            {/* active jobs List Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 text-left">
              {jobs.map(job => (
                <div key={job.id} className="bg-white/5 border border-white/10 rounded-2xl p-5 flex flex-col gap-4 hover:border-market/30 transition-colors">
                  
                  {/* Card Title */}
                  <div className="flex justify-between items-start border-b border-white/10 pb-3">
                    <div>
                      <span className="text-[10px] font-mono font-bold text-market bg-market/10 border border-market/20 px-2 py-0.5 rounded">
                        <GlossaryTerm term="ro">{job.id}</GlossaryTerm>
                      </span>
                      <h3 className="font-bold text-white text-base mt-2">{job.vehicle}</h3>
                      <span className="text-xs text-gray-400">Customer: {job.customerName}</span>
                    </div>
                    {job.status === 6 && (
                      <span className="bg-success/20 text-success border border-success/30 px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase tracking-widest flex items-center gap-1 animate-pulse">
                        <Check size={12} /> Ready
                      </span>
                    )}
                  </div>

                  {/* Inline visual progress bar */}
                  <div className="flex flex-col gap-1.5 border-b border-white/5 pb-3">
                    <div className="flex justify-between text-[9px] uppercase font-mono tracking-widest text-gray-400">
                      <span>Progress</span>
                      <span className="text-market font-bold">{Math.round((job.status / 6) * 100)}%</span>
                    </div>
                    <div className="w-full h-1.5 bg-black/40 rounded-full overflow-hidden border border-white/5">
                      <div 
                        className="h-full bg-gradient-to-r from-blue-500 to-market rounded-full transition-all duration-500 shadow-[0_0_8px_#3b82f6]"
                        style={{ width: `${(job.status / 6) * 100}%` }}
                      />
                    </div>
                  </div>

                  {/* Status Selection Steppers */}
                  <div className="space-y-3">
                    <div className="flex flex-col gap-1.5">
                      <label className="text-[9px] text-gray-400 uppercase tracking-widest font-bold">Repair <GlossaryTerm term="recon">Pipeline Stage</GlossaryTerm></label>
                      <select
                        disabled={!allowStatusUpdates}
                        value={job.status}
                        onChange={(e) => updateJob(job.id, parseInt(e.target.value), job.notes)}
                        className="bg-black border border-white/10 text-white rounded-lg p-2 text-xs font-bold outline-none focus:border-market transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed w-full"
                      >
                        {STAGES.map((s, idx) => (
                          <option key={s.id} value={s.id}>
                            Stage {idx+1}: {s.name}
                          </option>
                        ))}
                      </select>
                    </div>

                    {/* Step Increments */}
                    <div className="flex gap-2">
                      <button
                        disabled={!allowStatusUpdates || job.status === 0}
                        onClick={() => updateJob(job.id, job.status - 1, job.notes)}
                        className="flex-1 py-1.5 bg-white/5 hover:bg-white/10 rounded-lg text-[10px] font-bold uppercase transition-colors disabled:opacity-20 disabled:cursor-not-allowed border border-white/5"
                      >
                        Prev Stage
                      </button>
                      <button
                        disabled={!allowStatusUpdates || job.status === 6}
                        onClick={() => updateJob(job.id, job.status + 1, job.notes)}
                        className="flex-1 py-1.5 bg-market/10 hover:bg-market text-market hover:text-black rounded-lg text-[10px] font-bold uppercase transition-all disabled:opacity-20 disabled:cursor-not-allowed border border-market/20"
                      >
                        Next Stage
                      </button>
                    </div>
                  </div>

                  {/* Notes Comment Box */}
                  <div className="flex flex-col gap-1.5">
                    <label className="text-[9px] text-gray-400 uppercase tracking-widest font-bold">Technician Diagnostics Notes</label>
                    <textarea
                      disabled={!allowNotesEditing}
                      value={job.notes}
                      onChange={(e) => updateJob(job.id, job.status, e.target.value)}
                      rows={2}
                      className="bg-black/40 border border-white/5 rounded-lg p-2.5 text-xs text-gray-300 outline-none focus:border-market resize-none w-full disabled:opacity-50 disabled:cursor-not-allowed font-sans"
                      placeholder="Write repair updates..."
                    />
                  </div>

                  {/* Card Actions Footer */}
                  <div className="border-t border-white/10 pt-3 flex justify-between items-center mt-auto text-[10px] text-gray-500">
                    <span className="flex items-center gap-1"><Clock size={12} /> {job.lastUpdated}</span>
                    <div className="flex gap-2">
                      <button
                        onClick={() => {
                          setTrackedJob(job);
                          setView('tracker');
                        }}
                        className="text-market font-bold hover:underline uppercase flex items-center gap-0.5"
                      >
                        Track <ChevronRight size={12} />
                      </button>
                      {allowDeleteJobs && (
                        <button
                          onClick={() => deleteJob(job.id)}
                          className="text-red-400 hover:text-red-500 font-bold uppercase flex items-center gap-0.5"
                        >
                          <Trash2 size={12} /> Complete
                        </button>
                      )}
                    </div>
                  </div>

                </div>
              ))}

              {jobs.length === 0 && (
                <div className="col-span-full text-center text-gray-500 py-12 italic border border-dashed border-white/10 rounded-2xl">
                  All repair slots are empty. Intake a new vehicle!
                </div>
              )}
            </div>

          </motion.div>
        )}

        {/* VIEW 3: CUSTOMER PORTAL SEARCH */}
        {view === 'customer' && (
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="max-w-md mx-auto my-8 p-6 bg-white/5 border border-white/10 rounded-2xl flex flex-col gap-6 shadow-xl text-left"
          >
            <div className="w-12 h-12 bg-market/10 border border-market/30 rounded-2xl flex items-center justify-center">
              <Search className="w-6 h-6 text-market" />
            </div>
            <div>
              <h2 className="text-xl font-bold uppercase text-white">Track Your Repair Order</h2>
              <p className="text-xs text-gray-400 mt-1 leading-relaxed">
                Enter your unique <GlossaryTerm term="ro">Repair Order (RO)</GlossaryTerm> code to view the live, Domino's style reconditioning status.
              </p>
            </div>

            <form
              onSubmit={(e: any) => {
                e.preventDefault();
                handleSearch(e.target.query.value);
              }}
              className="space-y-4"
            >
              <div className="flex flex-col gap-1.5">
                <label className="text-[10px] text-gray-400 uppercase tracking-widest font-black"><GlossaryTerm term="ro">Repair Order (RO)</GlossaryTerm> Code</label>
                <input
                  name="query"
                  type="text"
                  placeholder="e.g. RO-1024"
                  className="bg-black/50 border border-white/20 rounded-xl px-4 py-3 text-sm text-white focus:border-market focus:ring-1 focus:ring-market focus:outline-none transition-all w-full uppercase"
                  autoFocus
                />
              </div>

              {errorMsg && (
                <div className="text-red-400 text-xs flex items-center gap-1.5 bg-red-950/20 border border-red-500/20 p-3 rounded-lg">
                  <AlertCircle size={14} className="shrink-0" /> {errorMsg}
                </div>
              )}

              <button
                type="submit"
                className="w-full bg-market hover:bg-blue-400 text-black font-black uppercase text-xs tracking-wider py-3.5 rounded-xl shadow-md transition-all flex justify-center items-center gap-2 group"
              >
                Track Progress <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
              </button>
            </form>
          </motion.div>
        )}

        {/* VIEW 4: DOMINO'S STYLE TRACKER PROGRESS */}
        {view === 'tracker' && trackedJob && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-6">
            
            {/* Header controls */}
            <button
              onClick={() => setView('customer')}
              className="flex items-center gap-1.5 text-xs font-bold text-gray-400 hover:text-white uppercase transition-colors self-start border border-white/10 px-3 py-1.5 rounded-lg bg-white/5"
            >
              <ArrowLeft size={14} /> Search Another
            </button>

            {/* Progress Card Container */}
            <div className="bg-white/5 border border-white/10 rounded-3xl overflow-hidden shadow-2xl text-left">
              
              {/* Card Banner Header */}
              <div className="bg-gradient-to-r from-market/20 to-transparent border-b border-white/10 p-8 flex flex-col md:flex-row justify-between md:items-end gap-6">
                <div>
                  <span className="bg-market/15 text-market border border-market/30 px-3 py-1 rounded-full text-[9px] font-black tracking-widest uppercase mb-3 inline-block font-mono">
                    ORDER {trackedJob.id}
                  </span>
                  <h2 className="text-2xl font-bold text-white leading-tight">{trackedJob.vehicle}</h2>
                  <p className="text-xs text-gray-400 font-medium mt-1">Customer Profile: {trackedJob.customerName}</p>
                </div>
                
                <div className="text-left md:text-right">
                  <div className="flex items-center gap-1.5 md:justify-end text-[10px] text-gray-400 mb-2">
                    <Clock size={12} /> Last updated: {trackedJob.lastUpdated}
                  </div>
                  {trackedJob.status === 6 ? (
                    <div className="text-success font-black text-xs uppercase tracking-widest flex items-center gap-1 md:justify-end animate-pulse">
                      <CheckCircle size={14} /> Ready for Pickup
                    </div>
                  ) : (
                    <div className="text-market font-bold text-xs uppercase tracking-widest">
                      Estimated Duration: <span className="text-white font-black">2-3 Hours</span>
                    </div>
                  )}
                </div>
              </div>

              {/* Progress stepper line */}
              <div className="p-8 md:p-12">
                <div className="relative">
                  {/* Progress lines (Desktop) */}
                  <div className="hidden md:block absolute top-6 left-6 right-6 h-1 bg-white/5 rounded-full" />
                  <div
                    className="hidden md:block absolute top-6 left-6 h-1 bg-market rounded-full transition-all duration-1000 ease-out shadow-[0_0_8px_#3b82f6]"
                    style={{ width: `${(trackedJob.status / (STAGES.length - 1)) * 100}%` }}
                  />

                  {/* Progress lines (Mobile) */}
                  <div className="absolute left-6 top-6 bottom-6 w-1 bg-white/5 rounded-full md:hidden" />
                  <div
                    className="absolute left-6 top-6 w-1 bg-market rounded-full transition-all duration-1000 ease-out md:hidden shadow-[0_0_8px_#3b82f6]"
                    style={{ height: `${(trackedJob.status / (STAGES.length - 1)) * 100}%` }}
                  />

                  {/* Stages List Nodes */}
                  <div className="flex flex-col md:flex-row justify-between gap-8 md:gap-0 relative z-10">
                    {STAGES.map((s, idx) => {
                      const isCompleted = idx < trackedJob.status;
                      const isActive = idx === trackedJob.status;
                      const isFuture = idx > trackedJob.status;
                      const Icon = s.icon;

                      return (
                        <div key={s.id} className="flex md:flex-col items-center gap-4 md:gap-3 group">
                          {/* Node Icon Circle */}
                          <div className={`
                            w-12 h-12 rounded-full flex items-center justify-center flex-shrink-0 transition-all duration-500 border-4
                            ${isCompleted ? 'bg-market border-market text-black shadow-[0_0_10px_rgba(59,130,246,0.3)]' : ''}
                            ${isActive ? 'bg-[#0c0d12] border-market text-market shadow-[0_0_20px_rgba(59,130,246,0.5)] animate-pulse' : ''}
                            ${isFuture ? 'bg-[#0c0d12] border-white/10 text-gray-600' : ''}
                          `}>
                            {isCompleted ? <Check className="w-5 h-5" /> : <Icon className="w-5 h-5" />}
                          </div>

                          {/* Node Titles */}
                          <div className={`md:text-center md:w-24 ${isFuture ? 'opacity-35' : 'opacity-100'}`}>
                            <p className={`text-xs font-black uppercase tracking-wider ${isActive ? 'text-market' : 'text-white'}`}>
                              {s.name}
                            </p>
                            <p className="text-[9px] text-gray-500 hidden md:block mt-1 leading-tight font-medium">
                              {s.desc}
                            </p>
                            <p className="text-[9px] text-gray-500 md:hidden mt-0.5 font-medium">
                              {s.desc}
                            </p>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Mechanic comments box */}
                <div className="mt-12 bg-market/5 border border-market/20 rounded-2xl p-6 relative overflow-hidden flex gap-4 items-start">
                  <div className="absolute top-0 left-0 w-1.5 h-full bg-market" />
                  <ClipboardList className="w-6 h-6 text-market shrink-0 mt-0.5" />
                  <div>
                    <h3 className="text-xs font-black uppercase tracking-wider text-market mb-1">
                      Latest Technician Report Comments
                    </h3>
                    <p className="text-sm text-gray-300 italic">"{trackedJob.notes}"</p>
                  </div>
                </div>

              </div>

            </div>
          </motion.div>
        )}

        {/* VIEW 5: DEVELOPER PAGE (PERMISSIONS PANEL) */}
        {view === 'dev' && (
          <motion.div
            initial={{ opacity: 0, y: 15 }}
            animate={{ opacity: 1, y: 0 }}
            className="max-w-2xl mx-auto space-y-6 text-left"
          >
            
            {/* Dev Warning header */}
            <div className="bg-warning/10 border border-warning/30 p-5 rounded-2xl flex gap-4 items-start">
              <ShieldAlert className="w-8 h-8 text-warning shrink-0" />
              <div>
                <h3 className="text-sm font-black uppercase tracking-wider text-warning">Developer Permissions Portal</h3>
                <p className="text-xs text-gray-400 mt-1 leading-relaxed">
                  Use this console to disallow or allow specific workspace actions, override active repair statuses, and audit live logic parameters dynamically.
                </p>
              </div>
            </div>

            {/* Toggles Panel */}
            <div className="bg-white/5 border border-white/10 rounded-2xl p-6 space-y-4 shadow-xl">
              <h4 className="text-xs font-black uppercase tracking-widest text-market border-b border-white/10 pb-2 flex items-center gap-1.5">
                <Settings size={14} /> Operation Permissions Switches
              </h4>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                
                {/* Switch 1: Status Updates */}
                <label className="flex items-center justify-between p-4 bg-black/40 border border-white/5 rounded-xl cursor-pointer hover:border-white/10 transition-colors">
                  <div className="flex flex-col gap-0.5">
                    <span className="text-xs font-bold text-white uppercase tracking-wide">Allow Status Steppers</span>
                    <span className="text-[9px] text-gray-500">Enable/disable stage updates on Shop Floor</span>
                  </div>
                  <input
                    type="checkbox"
                    checked={allowStatusUpdates}
                    onChange={e => setAllowStatusUpdates(e.target.checked)}
                    className="w-4 h-4 rounded border-white/20 bg-black text-market focus:ring-market cursor-pointer"
                  />
                </label>

                {/* Switch 2: Add Jobs */}
                <label className="flex items-center justify-between p-4 bg-black/40 border border-white/5 rounded-xl cursor-pointer hover:border-white/10 transition-colors">
                  <div className="flex flex-col gap-0.5">
                    <span className="text-xs font-bold text-white uppercase tracking-wide">Allow Intake Creation</span>
                    <span className="text-[9px] text-gray-500">Enable/disable adding new repair orders</span>
                  </div>
                  <input
                    type="checkbox"
                    checked={allowAddJobs}
                    onChange={e => setAllowAddJobs(e.target.checked)}
                    className="w-4 h-4 rounded border-white/20 bg-black text-market focus:ring-market cursor-pointer"
                  />
                </label>

                {/* Switch 3: Delete Jobs */}
                <label className="flex items-center justify-between p-4 bg-black/40 border border-white/5 rounded-xl cursor-pointer hover:border-white/10 transition-colors">
                  <div className="flex flex-col gap-0.5">
                    <span className="text-xs font-bold text-white uppercase tracking-wide">Allow Archive / Delete</span>
                    <span className="text-[9px] text-gray-500">Enable/disable completing or removing ROs</span>
                  </div>
                  <input
                    type="checkbox"
                    checked={allowDeleteJobs}
                    onChange={e => setAllowDeleteJobs(e.target.checked)}
                    className="w-4 h-4 rounded border-white/20 bg-black text-market focus:ring-market cursor-pointer"
                  />
                </label>

                {/* Switch 4: Notes Editing */}
                <label className="flex items-center justify-between p-4 bg-black/40 border border-white/5 rounded-xl cursor-pointer hover:border-white/10 transition-colors">
                  <div className="flex flex-col gap-0.5">
                    <span className="text-xs font-bold text-white uppercase tracking-wide">Allow Comment Writing</span>
                    <span className="text-[9px] text-gray-500">Enable/disable technician note writing</span>
                  </div>
                  <input
                    type="checkbox"
                    checked={allowNotesEditing}
                    onChange={e => setAllowNotesEditing(e.target.checked)}
                    className="w-4 h-4 rounded border-white/20 bg-black text-market focus:ring-market cursor-pointer"
                  />
                </label>

              </div>
            </div>

            {/* Overrides panel */}
            <div className="bg-white/5 border border-white/10 rounded-2xl p-6 space-y-4 shadow-xl">
              <h4 className="text-xs font-black uppercase tracking-widest text-warning border-b border-white/10 pb-2 flex items-center gap-1.5">
                <ShieldAlert size={14} /> Diagnostic & Hardware Override Controls
              </h4>

              <div className="flex flex-col gap-3">
                <div className="flex justify-between items-center p-4 bg-black/40 border border-white/5 rounded-xl">
                  <div className="flex flex-col gap-0.5">
                    <span className="text-xs font-bold text-white uppercase tracking-wide">Instant Diagnostic Repair (MMR 100%)</span>
                    <span className="text-[9px] text-gray-500">Force all jobs to "Ready" stage and auto-recover structural conditions</span>
                  </div>
                  <button
                    onClick={() => setFaultOverrideActive(!faultOverrideActive)}
                    className={`px-4 py-2 rounded-lg text-xs font-black uppercase tracking-widest transition-all ${faultOverrideActive ? 'bg-success text-black shadow-[0_0_10px_rgba(16,185,129,0.3)]' : 'bg-white/5 border border-white/10 text-gray-300'}`}
                  >
                    {faultOverrideActive ? 'Active' : 'Trigger'}
                  </button>
                </div>

                <div className="flex justify-between items-center p-4 bg-black/40 border border-white/5 rounded-xl">
                  <div className="flex flex-col gap-0.5">
                    <span className="text-xs font-bold text-white uppercase tracking-wide">Reset Demo Datasets</span>
                    <span className="text-[9px] text-gray-500">Wipe current state and reload initial Alice/Bob/Charlie test records</span>
                  </div>
                  <button
                    onClick={resetDemoData}
                    className="bg-warning/20 border border-warning/40 text-warning hover:bg-warning hover:text-black px-4 py-2 rounded-lg text-xs font-black uppercase tracking-widest transition-all flex items-center gap-1"
                  >
                    <RefreshCw size={12} /> Reload Demo
                  </button>
                </div>
              </div>
            </div>

          </motion.div>
        )}

      </div>

      {/* Onboarding Tutorial Guide Overlay */}
      <AnimatePresence>
        {showTutorial && (
          <div className="fixed inset-0 bg-black/60 backdrop-blur-xs z-[99999] flex items-center justify-center p-4 select-none pointer-events-auto">
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-[#0b0c10]/95 border-2 border-market/40 rounded-2xl max-w-sm w-full p-6 shadow-2xl relative text-white text-left flex flex-col gap-4"
            >
              <div className="flex justify-between items-center border-b border-white/10 pb-2">
                <span className="text-[10px] font-mono font-bold text-market">
                  GUIDED TOUR • STEP {tutorialStep + 1} OF {TUTORIAL_STEPS.length}
                </span>
                <button 
                  onClick={() => setShowTutorial(false)}
                  className="text-gray-400 hover:text-white transition-colors cursor-pointer"
                >
                  ✕
                </button>
              </div>
              <div className="space-y-2">
                <h4 className="font-black text-white text-lg uppercase tracking-wide leading-tight">
                  {TUTORIAL_STEPS[tutorialStep].title}
                </h4>
                <p className="text-xs text-gray-300 leading-relaxed font-sans font-medium">
                  {TUTORIAL_STEPS[tutorialStep].desc}
                </p>
              </div>
              <div className="flex justify-between items-center pt-2 mt-2 border-t border-white/5">
                <button
                  disabled={tutorialStep === 0}
                  onClick={() => setTutorialStep(prev => prev - 1)}
                  className="px-3 py-1.5 bg-white/5 border border-white/10 text-gray-400 hover:text-white transition-colors rounded-lg text-xs font-bold uppercase disabled:opacity-20 cursor-pointer"
                >
                  Back
                </button>
                <button
                  onClick={() => {
                    if (tutorialStep < TUTORIAL_STEPS.length - 1) {
                      setTutorialStep(prev => prev + 1);
                    } else {
                      setShowTutorial(false);
                    }
                  }}
                  className="px-4 py-1.5 bg-market text-black font-black uppercase text-xs tracking-wider rounded-lg transition-all shadow-[0_0_10px_rgba(59,130,246,0.3)] cursor-pointer"
                >
                  {tutorialStep === TUTORIAL_STEPS.length - 1 ? 'Finish' : 'Next'}
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

    </div>
  );
}
