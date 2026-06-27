import React, { useState, useEffect } from 'react';
import {
  Cpu, Layers, Settings, AlertTriangle, Gauge, Terminal, Wrench,
  CheckCircle, Play, ChevronRight, Clock, Check,
  Plus, Trash2, ShieldAlert, RefreshCw, Layers3
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

const GLOSSARY = {
  'obd': { title: 'OBD-II Scan', desc: 'On-Board Diagnostics. A standardized computer protocol allowing technicians to query internal powertrain sensor fault codes.' },
  'ecu': { title: 'ECU Coding', desc: 'Engine Control Unit. The main computer brain coordinating fuel injection, cylinder spark, and camshaft timing cycles.' },
  'can': { title: 'CAN-Bus Network', desc: 'Controller Area Network. The high-speed physical wire harness that networks all vehicle microcontrollers and sensors.' },
  'vvt': { title: 'VVT Pulley', desc: 'Variable Valve Timing pulley. An ECU-controlled sprocket that advances or retards intake valve cycles dynamically.' },
  'vin': { title: 'VIN Frame ID', desc: 'Vehicle Identification Number. A unique 17-digit physical serialization serial stamp representing the vehicle\'s mainframe chassis.' },
  'ro': { title: 'Repair Order (RO)', desc: 'A service ticket tracking a vehicle checked into the mechanic bay lifts.' }
};

const GlossaryTerm = ({ term, children }: { term: keyof typeof GLOSSARY; children: React.ReactNode }) => {
  const [show, setShow] = useState(false);
  const info = GLOSSARY[term];
  return (
    <span className="relative inline-flex items-center gap-1 group">
      <span className="font-bold underline decoration-dashed decoration-emerald-500/50 hover:text-emerald-400 cursor-help transition-colors">
        {children}
      </span>
      <button 
        type="button"
        onMouseEnter={() => setShow(true)}
        onMouseLeave={() => setShow(false)}
        onClick={() => setShow(!show)}
        className="w-3.5 h-3.5 rounded-full bg-white/10 hover:bg-emerald-500/20 hover:text-emerald-400 flex items-center justify-center text-[8px] font-black text-gray-400 cursor-help select-none"
      >
        ?
      </button>
      <AnimatePresence>
        {show && (
          <motion.div
            initial={{ opacity: 0, y: 5 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 5 }}
            className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-48 p-3 bg-[#0f0f13]/95 border border-emerald-500/40 rounded-xl shadow-2xl backdrop-blur-md z-[10000] text-left select-none pointer-events-none"
          >
            <h5 className="text-[10px] font-black uppercase tracking-wider text-emerald-400 mb-1">{info.title}</h5>
            <p className="text-[9px] text-gray-300 leading-normal font-sans font-medium">{info.desc}</p>
          </motion.div>
        )}
      </AnimatePresence>
    </span>
  );
};

const TUTORIAL_STEPS = [
  {
    title: 'Welcome to MechFlow Pro! ⚙️',
    desc: 'This diagnostics suite lets you audit active lift bays, scan electronic ECU modules, and manage parts spares.',
    target: 'header'
  },
  {
    title: '1. Active Lift Bays 🛗',
    desc: 'Open "Lift Bays" to monitor checked-in cars, manage repair stages, and update symptom comments.',
    target: 'nav'
  },
  {
    title: '2. OBD-II CAN-Bus Terminal 💻',
    desc: 'Select a vehicle, click "Initiate OBD-II Scan", and query the powertrain control module for live sensor trouble codes.',
    target: 'nav'
  },
  {
    title: '3. Layman\'s Glossary 💡',
    desc: 'Hover over any dotted underlined word with a (?) question badge to read its simple definition instantly!',
    target: 'glossary'
  }
];

// Stages of the mechanics shop repair process
const MECH_STAGES = [
  { id: 0, name: 'Diagnostic Scan', icon: Terminal, desc: 'OBD-II Fault Scanning & Verification' },
  { id: 1, name: 'Disassembly', icon: Layers3, desc: 'Tearing down engine or subsystem components' },
  { id: 2, name: 'Part Replacement', icon: Wrench, desc: 'Installing new mechanical hardware' },
  { id: 3, name: 'Reassembly', icon: Layers, desc: 'Rebuilding subsystem back to factory spec' },
  { id: 4, name: 'ECU Coding & Tune', icon: Cpu, desc: 'Coding modules and clearing codes' },
  { id: 5, name: 'Road Testing', icon: Gauge, desc: 'Dynamo & highway verification testing' },
  { id: 6, name: 'Ready', icon: CheckCircle, desc: 'Ready for client pickup' },
];

const INITIAL_JOBS = [
  { id: 'RO-3001', customerName: 'David Vance', vehicle: '2020 Chevrolet Corvette C8', status: 0, repairType: 'Engine Rebuild', vin: '1G1YB2D47L51000X1', faultCode: 'P0302', notes: 'Active misfire in cylinder 2. Rough idling and flashing check engine light.', lastUpdated: 'Today, 10:15 AM' },
  { id: 'RO-3002', customerName: 'Sarah Jenkins', vehicle: '2018 Ford Mustang GT', status: 2, repairType: 'Transmission Sync', vin: '1FA6P8CF3J51999X2', faultCode: 'P0700', notes: 'Grinding noise going from 2nd to 3rd gear. Replacement gears arrived.', lastUpdated: 'Today, 8:30 AM' },
  { id: 'RO-3003', customerName: 'Michael Chang', vehicle: '2022 BMW M3', status: 5, repairType: 'ECU Tuning & Calibration', vin: 'WBA5R1C00N51888X3', faultCode: 'P0011', notes: 'VVT solenoid replacement complete. Tuning camshaft profiles on the dyno.', lastUpdated: 'Yesterday, 3:45 PM' },
];

const OBD_CODES_LIB: Record<string, { code: string; label: string; desc: string; fix: string }> = {
  'P0302': {
    code: 'P0302',
    label: 'Cylinder 2 Misfire Detected',
    desc: 'The powertrain control module (PCM) detected misfires in engine cylinder number 2. This causes rough idle, loss of horsepower, and high fuel emissions.',
    fix: 'Inspect spark plug wire connections, replace worn spark plug, or swap ignition coil pack.'
  },
  'P0700': {
    code: 'P0700',
    label: 'Transmission Control System Malfunction',
    desc: 'The vehicle dashboard reports a generic TCM system fault. The solenoid valves or sync gears have failed to line up.',
    fix: 'Replace worn 3rd-stage sync collar ring, drain transmission fluid, and flash TCM software.'
  },
  'P0011': {
    code: 'P0011',
    label: 'Camshaft Position "A" Timing Over-Advanced (Bank 1)',
    desc: 'The variable valve timing (VVT) solenoid is sticking or oil passages are clogged, throwing off exhaust/intake overlap.',
    fix: 'Clear VVT actuator mesh filter, swap out variable camshaft actuator, or adjust timing chain tensioner.'
  },
  'P0171': {
    code: 'P0171',
    label: 'System Too Lean (Bank 1)',
    desc: 'The oxygen sensor reports excess oxygen in exhaust. The engine is pulling in too much unmetered air or is starved of gasoline fuel.',
    fix: 'Inspect vacuum hose gaskets, clean Mass Air Flow (MAF) sensor, or swap secondary fuel injector pump.'
  },
  'P0420': {
    code: 'P0420',
    label: 'Catalytic Converter System Efficiency Below Threshold',
    desc: 'The catalytic converter is failing to convert toxic carbon monoxide emissions efficiently, causing carbon buildup.',
    fix: 'Replace rear catalytic converter module and recalibrate downstream O2 oxygen sensors.'
  }
};

export default function MechanicManagement() {
  const [view, setView] = useState<'landing' | 'lifts' | 'obd' | 'inventory' | 'dev'>('landing');
  const [jobs, setJobs] = useState(INITIAL_JOBS);
  const [selectedJobId, setSelectedJobId] = useState<string>('RO-3001');

  const [showTutorial, setShowTutorial] = useState(false);
  const [tutorialStep, setTutorialStep] = useState(0);

  // Scanner Terminal logs simulation states
  const [isScanning, setIsScanning] = useState(false);
  const [scanProgress, setScanProgress] = useState(0);
  const [scanLogs, setScanLogs] = useState<string[]>([]);
  const [scanResultCode, setScanResultCode] = useState<string | null>(null);

  // New mechanical job creation state
  const [newVehicle, setNewVehicle] = useState('');
  const [newCustomer, setNewCustomer] = useState('');
  const [newRepair, setNewRepair] = useState('Engine Rebuild');
  const [newCode, setNewCode] = useState('P0302');
  const [newNotes, setNewNotes] = useState('');
  const [showAddForm, setShowAddForm] = useState(false);

  // Developer permissions & bypasses
  const [allowDiagnose, setAllowDiagnose] = useState(true);
  const [allowDisassembly, setAllowDisassembly] = useState(true);
  const [allowECUCoding, setAllowECUCoding] = useState(true);
  const [instantRepairActive, setInstantRepairActive] = useState(false);

  // Apply instant mechanical repairs override
  useEffect(() => {
    if (instantRepairActive) {
      const repaired = jobs.map(j => ({ ...j, status: 6, notes: 'ECU FLASH OVERRIDE: Mechanical diagnostic errors resolved, cylinders firing 100%!', lastUpdated: 'Just now' }));
      setJobs(repaired);
    }
  }, [instantRepairActive]);

  // Update mechanical status or notes
  const updateJob = (id: string, newStatus: number, newNotes: string) => {
    const updated = jobs.map(job => {
      if (job.id === id) {
        return { ...job, status: newStatus, notes: newNotes, lastUpdated: 'Just now' };
      }
      return job;
    });
    setJobs(updated);
  };

  const deleteJob = (id: string) => {
    setJobs(jobs.filter(j => j.id !== id));
    if (selectedJobId === id) {
      const remaining = jobs.filter(j => j.id !== id);
      if (remaining.length > 0) setSelectedJobId(remaining[0].id);
    }
  };

  const handleCreateJob = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newVehicle || !newCustomer) return;

    const nextRo = 3000 + jobs.length + Math.floor(Math.random() * 80);
    const vinChars = '0123456789ABCDEFGHJKLMNPRSTUVWXYZ';
    let randomVin = '1G1';
    for (let i = 0; i < 14; i++) {
      randomVin += vinChars.charAt(Math.floor(Math.random() * vinChars.length));
    }

    const newJob = {
      id: `RO-${nextRo}`,
      customerName: newCustomer,
      vehicle: newVehicle,
      status: 0,
      repairType: newRepair,
      vin: randomVin,
      faultCode: newCode,
      notes: newNotes || 'Vehicle loaded in bay. Diagnostic bus scan pending.',
      lastUpdated: 'Just now'
    };

    setJobs([newJob, ...jobs]);
    setNewVehicle('');
    setNewCustomer('');
    setNewNotes('');
    setShowAddForm(false);
  };

  // OBD-II Scanner simulation
  const runObdScan = (jobCode: string) => {
    if (isScanning) return;
    setIsScanning(true);
    setScanProgress(0);
    setScanResultCode(null);
    setScanLogs([]);

    const steps = [
      '[ECU] Initializing OBD-II CAN controller interface...',
      '[ECU] Handshaking protocol ISO 15765-4 (CAN-BUS 11-bit ID, 500 Kbaud)...',
      '[ECU] Establishing link to main powertrain module (PCM)... SUCCESS',
      '[ECU] Querying Mode 03 active emission-related diagnostic trouble codes...',
      `[ECU] Read complete. Found 1 active diagnostic fault code in PCM: ${jobCode}`
    ];

    let currentStep = 0;
    const interval = setInterval(() => {
      if (currentStep < steps.length) {
        setScanLogs(prev => [...prev, steps[currentStep]]);
        setScanProgress(Math.floor(((currentStep + 1) / steps.length) * 100));
        currentStep++;
      } else {
        clearInterval(interval);
        setIsScanning(false);
        setScanResultCode(jobCode);
      }
    }, 850);
  };

  const resetAllData = () => {
    setJobs(INITIAL_JOBS);
    setInstantRepairActive(false);
    setSelectedJobId(INITIAL_JOBS[0].id);
    setScanResultCode(null);
    setScanLogs([]);
  };

  // Stats
  const activeRepairsCount = jobs.filter(j => j.status < 6).length;
  const readyRepairsCount = jobs.filter(j => j.status === 6).length;
  const liftUsagePercent = Math.min(100, Math.floor((jobs.length / 4) * 100));

  const activeJob = jobs.find(j => j.id === selectedJobId) || jobs[0];

  return (
    <div className="bg-[#0c0d12]/90 border border-white/10 rounded-2xl p-4 md:p-6 shadow-2xl flex flex-col w-full h-full max-w-full text-white pointer-events-auto overflow-y-auto scrollbar-none pb-20">
      
      {/* Header */}
      <header className="border-b border-white/10 pb-4 mb-6 flex flex-col md:flex-row justify-between items-start md:items-center gap-4 shrink-0">
        <div className="flex items-center gap-3">
          <div className="bg-emerald-500/20 p-2.5 rounded-xl border border-emerald-500/40 shadow-[0_0_15px_rgba(16,185,129,0.2)]">
            <Gauge className="w-6 h-6 text-emerald-400" />
          </div>
          <div>
            <h1 className="text-xl font-bold tracking-wider uppercase text-white">MechFlow Pro Diagnostics</h1>
            <p className="text-xs text-gray-400 font-mono"><GlossaryTerm term="obd">OBD-II</GlossaryTerm> & Mechanical Lift Bays</p>
          </div>
          <button
            onClick={() => { setShowTutorial(true); setTutorialStep(0); }}
            className="ml-3 px-3 py-1.5 bg-emerald-500/20 border border-emerald-500/30 text-emerald-400 hover:bg-emerald-500 hover:text-black transition-all rounded-lg text-[10px] font-black uppercase tracking-widest flex items-center gap-1.5 animate-pulse select-none"
          >
            💡 Quick Tour
          </button>
        </div>

        {/* Standalone Tab Navigation */}
        <nav className="flex flex-wrap gap-2 text-xs font-bold uppercase tracking-wider">
          <button
            onClick={() => setView('landing')}
            className={`px-4 py-2 rounded-lg transition-all border ${view === 'landing' ? 'bg-emerald-500 text-black border-emerald-500 shadow-[0_0_10px_rgba(16,185,129,0.3)]' : 'bg-white/5 border-white/10 text-gray-300 hover:bg-white/10'}`}
          >
            Overview
          </button>
          <button
            onClick={() => setView('lifts')}
            className={`px-4 py-2 rounded-lg transition-all border ${view === 'lifts' ? 'bg-emerald-500 text-black border-emerald-500 shadow-[0_0_10px_rgba(16,185,129,0.3)]' : 'bg-white/5 border-white/10 text-gray-300 hover:bg-white/10'}`}
          >
            Lift Bays
          </button>
          <button
            onClick={() => setView('obd')}
            className={`px-4 py-2 rounded-lg transition-all border ${view === 'obd' ? 'bg-emerald-500 text-black border-emerald-500 shadow-[0_0_10px_rgba(16,185,129,0.3)]' : 'bg-white/5 border-white/10 text-gray-300 hover:bg-white/10'}`}
          >
            OBD-II Terminal
          </button>
          <button
            onClick={() => setView('inventory')}
            className={`px-4 py-2 rounded-lg transition-all border ${view === 'inventory' ? 'bg-emerald-500 text-black border-emerald-500 shadow-[0_0_10px_rgba(16,185,129,0.3)]' : 'bg-white/5 border-white/10 text-gray-300 hover:bg-white/10'}`}
          >
            Parts auditor
          </button>
          <button
            onClick={() => setView('dev')}
            className={`px-4 py-2 rounded-lg transition-all border flex items-center gap-1.5 ${view === 'dev' ? 'bg-warning/20 border-warning text-warning' : 'bg-white/5 border-white/10 text-warning/80 hover:bg-white/10'}`}
          >
            <Settings size={14} /> Dev Switch
          </button>
        </nav>
      </header>

      {/* View router content */}
      <div className="flex-grow">
        
        {/* VIEW 1: LANDING */}
        {view === 'landing' && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-6">
            
            {/* Quick Metrics */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <div className="bg-white/5 border border-white/10 p-4 rounded-xl flex items-center gap-4 hover:border-emerald-500/30 transition-colors">
                <Wrench className="text-emerald-400 w-8 h-8 shrink-0" />
                <div>
                  <span className="text-[10px] text-gray-400 uppercase tracking-widest font-black block">Active Engine Repairs</span>
                  <span className="text-xl font-bold">{activeRepairsCount} Vehicles</span>
                </div>
              </div>
              <div className="bg-white/5 border border-white/10 p-4 rounded-xl flex items-center gap-4 hover:border-success/30 transition-colors">
                <CheckCircle className="text-success w-8 h-8 shrink-0 animate-pulse" />
                <div>
                  <span className="text-[10px] text-gray-400 uppercase tracking-widest font-black block">Tuned / Calibrated</span>
                  <span className="text-xl font-bold">{readyRepairsCount} Ready</span>
                </div>
              </div>
              <div className="bg-white/5 border border-white/10 p-4 rounded-xl flex items-center gap-4 hover:border-emerald-500/30 transition-colors">
                <Gauge className="text-blue-400 w-8 h-8 shrink-0" />
                <div>
                  <span className="text-[10px] text-gray-400 uppercase tracking-widest font-black block">Bay Lift Occupancy</span>
                  <span className="text-xl font-bold">{liftUsagePercent}% Capacity</span>
                </div>
              </div>
              <div className="bg-white/5 border border-white/10 p-4 rounded-xl flex items-center gap-4 hover:border-warning/30 transition-colors">
                <ShieldAlert className="text-warning w-8 h-8 shrink-0" />
                <div>
                  <span className="text-[10px] text-gray-400 uppercase tracking-widest font-black block">OBD-II Overrides</span>
                  <span className="text-xl font-bold">{instantRepairActive ? 'ACTIVE' : 'STANDBY'}</span>
                </div>
              </div>
            </div>

            {/* Interactive Hero Banner */}
            <div className="bg-gradient-to-r from-emerald-500/20 via-transparent to-transparent border border-white/10 p-6 rounded-2xl flex flex-col md:flex-row items-center justify-between gap-6">
              <div className="space-y-2 text-left">
                <h2 className="text-2xl font-black uppercase tracking-wider text-white">
                  Real-Time <span className="text-emerald-400">Mechanical & ECU Operations</span>
                </h2>
                <p className="text-sm text-gray-400 max-w-xl leading-relaxed font-medium">
                  Monitor engine overhauls, transmission sync calibrations, and <GlossaryTerm term="can">CAN-bus</GlossaryTerm> electrical networks. Access direct <GlossaryTerm term="obd">OBD-II</GlossaryTerm> live fault codes using our integrated scan terminal.
                </p>
              </div>
              <div className="flex gap-3 shrink-0 w-full md:w-auto">
                <button
                  onClick={() => setView('lifts')}
                  className="flex-1 md:flex-initial px-6 py-3 bg-emerald-500 hover:bg-emerald-400 text-black font-black uppercase text-xs tracking-wider rounded-xl transition-all shadow-[0_0_15px_rgba(16,185,129,0.4)] flex items-center justify-center gap-2"
                >
                  <Wrench size={16} /> Open Lift Bays
                </button>
                <button
                  onClick={() => setView('obd')}
                  className="flex-1 md:flex-initial px-6 py-3 bg-white/5 border border-white/10 hover:bg-white/10 text-white font-black uppercase text-xs tracking-wider rounded-xl transition-all flex items-center justify-center gap-2"
                >
                  <Terminal size={16} /> Scan ECU Codes
                </button>
              </div>
            </div>

            {/* Pipeline Stage previews */}
            <div className="bg-white/5 border border-white/10 p-6 rounded-2xl text-left">
              <h3 className="text-sm font-black uppercase tracking-widest text-emerald-400 mb-4">Mechanical Recon Pipeline Stages</h3>
              <div className="grid grid-cols-2 md:grid-cols-7 gap-3">
                {MECH_STAGES.map((s, idx) => {
                  const Icon = s.icon;
                  return (
                    <div key={s.id} className="bg-black/30 border border-white/5 p-3 rounded-xl flex flex-col items-center text-center gap-2 hover:border-emerald-500/40 transition-colors">
                      <span className="text-[10px] text-emerald-400 font-bold font-mono">STAGE {idx+1}</span>
                      <div className="w-8 h-8 rounded-full bg-emerald-500/10 flex items-center justify-center text-emerald-400">
                        <Icon size={16} />
                      </div>
                      <span className="text-[10px] font-black uppercase tracking-widest text-white leading-tight">{s.name}</span>
                      <span className="text-[8px] text-gray-500 leading-tight">{s.desc}</span>
                    </div>
                  );
                })}
              </div>
            </div>

          </motion.div>
        )}

        {/* VIEW 2: LIFT BAYS */}
        {view === 'lifts' && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-6">
            
            <div className="flex justify-between items-center bg-white/5 border border-white/10 px-4 py-3 rounded-xl">
              <div>
                <h2 className="text-lg font-black uppercase tracking-wider text-white">Active Bay Lifts</h2>
                <p className="text-xs text-gray-400 font-mono">Assign mechanic work steps and monitor lift bays</p>
              </div>
              <button
                onClick={() => setShowAddForm(prev => !prev)}
                className="bg-emerald-500 hover:bg-emerald-400 text-black px-4 py-2 rounded-lg text-xs font-black uppercase tracking-widest transition-all shadow-[0_0_10px_rgba(16,185,129,0.3)] flex items-center gap-1.5"
              >
                <Plus size={14} /> Intake Vehicle
              </button>
            </div>

            {/* Intake Form */}
            <AnimatePresence>
              {showAddForm && (
                <motion.div
                  initial={{ opacity: 0, y: -20 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -20 }}
                  className="bg-white/5 border border-white/10 p-5 rounded-2xl flex flex-col gap-4 text-left"
                >
                  <h3 className="text-sm font-black uppercase tracking-widest text-emerald-400 border-b border-white/10 pb-2">Diagnostic Intake Form</h3>
                  <form onSubmit={handleCreateJob} className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 items-end">
                    <div className="flex flex-col gap-1.5">
                      <label className="text-[10px] text-gray-400 uppercase tracking-widest font-bold">Vehicle Make/Model</label>
                      <input
                        type="text"
                        className="bg-black/50 border border-white/20 rounded-lg px-3 py-2 text-xs text-white focus:border-emerald-500 focus:outline-none"
                        placeholder="e.g. 2021 Toyota Supra"
                        value={newVehicle}
                        onChange={e => setNewVehicle(e.target.value)}
                        required
                      />
                    </div>
                    <div className="flex flex-col gap-1.5">
                      <label className="text-[10px] text-gray-400 uppercase tracking-widest font-bold">Client Name</label>
                      <input
                        type="text"
                        className="bg-black/50 border border-white/20 rounded-lg px-3 py-2 text-xs text-white focus:border-emerald-500 focus:outline-none"
                        placeholder="e.g. Robert Stark"
                        value={newCustomer}
                        onChange={e => setNewCustomer(e.target.value)}
                        required
                      />
                    </div>
                    <div className="flex flex-col gap-1.5">
                      <label className="text-[10px] text-gray-400 uppercase tracking-widest font-bold">Mechanical Focus</label>
                      <select
                        value={newRepair}
                        onChange={e => setNewRepair(e.target.value)}
                        className="bg-black border border-white/20 rounded-lg px-3 py-2 text-xs text-white focus:border-emerald-500 focus:outline-none cursor-pointer"
                      >
                        <option value="Engine Rebuild">Engine Component Rebuild</option>
                        <option value="Transmission Sync">Gearbox Sync Wear Repair</option>
                        <option value="Suspension Repair">Shock Bushings Replacement</option>
                        <option value="ECU Tuning & Calibration">Electronic ECU Module Flash</option>
                      </select>
                    </div>
                    <div className="flex flex-col gap-1.5">
                      <label className="text-[10px] text-gray-400 uppercase tracking-widest font-bold">Estimated Fault Code</label>
                      <select
                        value={newCode}
                        onChange={e => setNewCode(e.target.value)}
                        className="bg-black border border-white/20 rounded-lg px-3 py-2 text-xs text-white focus:border-emerald-500 focus:outline-none cursor-pointer"
                      >
                        <option value="P0302">P0302 (Cylinder Misfire)</option>
                        <option value="P0700">P0700 (Transmission Solenoid)</option>
                        <option value="P0011">P0011 (Camshaft Over-Advance)</option>
                        <option value="P0171">P0171 (System Lean Gas Mix)</option>
                        <option value="P0420">P0420 (Catalytic Converter)</option>
                      </select>
                    </div>
                    <div className="md:col-span-2 flex flex-col gap-1.5">
                      <label className="text-[10px] text-gray-400 uppercase tracking-widest font-bold">Tech Diagnosis Symptoms</label>
                      <input
                        type="text"
                        className="bg-black/50 border border-white/20 rounded-lg px-3 py-2 text-xs text-white focus:border-emerald-500 focus:outline-none"
                        placeholder="e.g. Engine knocking under heavy load..."
                        value={newNotes}
                        onChange={e => setNewNotes(e.target.value)}
                      />
                    </div>
                    <div className="md:col-span-2 flex gap-2">
                      <button
                        type="submit"
                        className="flex-1 bg-success text-black py-2 rounded-lg text-xs font-black uppercase tracking-widest hover:bg-green-400 transition-colors"
                      >
                        Secure Lift Intake
                      </button>
                      <button
                        type="button"
                        onClick={() => setShowAddForm(false)}
                        className="bg-white/10 hover:bg-white/20 py-2 px-4 rounded-lg text-xs font-black uppercase tracking-widest transition-colors"
                      >
                        Cancel
                      </button>
                    </div>
                  </form>
                </motion.div>
              )}
            </AnimatePresence>

            {/* active jobs List */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 text-left">
              {jobs.map((job, idx) => (
                <div key={job.id} className="bg-white/5 border border-white/10 rounded-2xl p-5 flex flex-col gap-4 hover:border-emerald-500/30 transition-colors relative">
                  
                  {/* Top Header */}
                  <div className="flex justify-between items-start border-b border-white/10 pb-3">
                    <div>
                      <span className="text-[10px] font-mono font-bold text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-2 py-0.5 rounded">
                        LIFT {idx + 1}: <GlossaryTerm term="ro">{job.id}</GlossaryTerm>
                      </span>
                      <h3 className="font-bold text-white text-base mt-2">{job.vehicle}</h3>
                      <span className="text-xs text-gray-400">Client: {job.customerName}</span>
                    </div>
                    {job.status === 6 && (
                      <span className="bg-success/20 text-success border border-success/30 px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase tracking-widest flex items-center gap-1 animate-pulse">
                        <Check size={12} /> Tuned
                      </span>
                    )}
                  </div>

                  {/* Inline visual progress bar */}
                  <div className="flex flex-col gap-1.5 border-b border-white/5 pb-3">
                    <div className="flex justify-between text-[9px] uppercase font-mono tracking-widest text-gray-400">
                      <span>Diagnostics Progress</span>
                      <span className="text-emerald-400 font-bold">{Math.round((job.status / 6) * 100)}%</span>
                    </div>
                    <div className="w-full h-1.5 bg-black/40 rounded-full overflow-hidden border border-white/5">
                      <div 
                        className="h-full bg-gradient-to-r from-blue-500 to-emerald-400 rounded-full transition-all duration-500 shadow-[0_0_8px_#10b981]"
                        style={{ width: `${(job.status / 6) * 100}%` }}
                      />
                    </div>
                  </div>

                  {/* Pipeline selector */}
                  <div className="space-y-3">
                    <div className="flex flex-col gap-1.5">
                      <label className="text-[9px] text-gray-400 uppercase tracking-widest font-bold">Active Repair <GlossaryTerm term="obd">Pipeline Stage</GlossaryTerm></label>
                      <select
                        value={job.status}
                        onChange={(e) => updateJob(job.id, parseInt(e.target.value), job.notes)}
                        className="bg-black border border-white/10 text-white rounded-lg p-2 text-xs font-bold outline-none focus:border-emerald-500 transition-colors cursor-pointer w-full"
                      >
                        {MECH_STAGES.map((s, sIdx) => (
                          <option key={s.id} value={s.id}>
                            Stage {sIdx + 1}: {s.name}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div className="flex gap-2">
                      <button
                        disabled={job.status === 0}
                        onClick={() => updateJob(job.id, job.status - 1, job.notes)}
                        className="flex-1 py-1.5 bg-white/5 hover:bg-white/10 rounded-lg text-[10px] font-bold uppercase transition-colors disabled:opacity-20 border border-white/5"
                      >
                        Prev Step
                      </button>
                      <button
                        disabled={job.status === 6}
                        onClick={() => updateJob(job.id, job.status + 1, job.notes)}
                        className="flex-1 py-1.5 bg-emerald-500/10 hover:bg-emerald-500 text-emerald-400 hover:text-black rounded-lg text-[10px] font-bold uppercase transition-all border border-emerald-500/20"
                      >
                        Next Step
                      </button>
                    </div>
                  </div>

                  {/* Mechanic Comments */}
                  <div className="flex flex-col gap-1.5">
                    <label className="text-[9px] text-gray-400 uppercase tracking-widest font-bold">Diagnosis Symptoms & Notes</label>
                    <textarea
                      value={job.notes}
                      onChange={(e) => updateJob(job.id, job.status, e.target.value)}
                      rows={2}
                      className="bg-black/40 border border-white/5 rounded-lg p-2.5 text-xs text-gray-300 outline-none focus:border-emerald-500 resize-none w-full font-sans"
                      placeholder="Write symptoms report..."
                    />
                  </div>

                  {/* Card actions */}
                  <div className="border-t border-white/10 pt-3 flex justify-between items-center mt-auto text-[10px] text-gray-500">
                    <span className="flex items-center gap-1"><Clock size={12} /> {job.lastUpdated}</span>
                    <div className="flex gap-2">
                      <button
                        onClick={() => {
                          setSelectedJobId(job.id);
                          setView('obd');
                        }}
                        className="text-emerald-400 font-bold hover:underline uppercase flex items-center gap-0.5"
                      >
                        Scan ECU <ChevronRight size={12} />
                      </button>
                      <button
                        onClick={() => deleteJob(job.id)}
                        className="text-red-400 hover:text-red-500 font-bold uppercase flex items-center gap-0.5"
                      >
                        <Trash2 size={12} /> Ship out
                      </button>
                    </div>
                  </div>

                </div>
              ))}

              {jobs.length === 0 && (
                <div className="col-span-full text-center text-gray-500 py-12 italic border border-dashed border-white/10 rounded-2xl">
                  All mechanic lifts are currently empty. Check in a vehicle!
                </div>
              )}
            </div>

          </motion.div>
        )}

        {/* VIEW 3: OBD-II TERMINAL SCANNER */}
        {view === 'obd' && activeJob && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="grid grid-cols-1 lg:grid-cols-3 gap-6 text-left">
            
            {/* Left Column: Job Selector */}
            <div className="flex flex-col gap-4">
              <h3 className="text-xs font-black uppercase tracking-widest text-emerald-400 border-b border-white/10 pb-2">Active Work Orders</h3>
              <div className="flex flex-col gap-2 max-h-[50vh] overflow-y-auto pr-2 scrollbar-thin">
                {jobs.map(j => (
                  <div
                    key={j.id}
                    onClick={() => {
                      setSelectedJobId(j.id);
                      setScanResultCode(null);
                      setScanLogs([]);
                    }}
                    className={`p-4 rounded-xl border-2 cursor-pointer transition-all flex justify-between items-center ${selectedJobId === j.id ? 'border-emerald-500 bg-emerald-500/10' : 'border-white/5 bg-black/40 hover:border-white/20'}`}
                  >
                    <div className="flex flex-col gap-1">
                      <span className="font-bold text-sm text-white">{j.vehicle}</span>
                      <span className="text-[10px] text-gray-400 uppercase font-bold tracking-wider">{j.repairType} | {j.id}</span>
                    </div>
                    <ChevronRight size={16} className={selectedJobId === j.id ? 'text-emerald-400' : 'text-gray-500'} />
                  </div>
                ))}
              </div>
            </div>

            {/* Middle Column: Interactive ECU Scan Terminal & Visual Monitor */}
            <div className="lg:col-span-2 grid grid-cols-1 md:grid-cols-2 gap-6">
              
              {/* SUB-COLUMN 1: ECU Terminal Console */}
              <div className="flex flex-col gap-4">
                <div className="flex justify-between items-baseline border-b border-white/10 pb-2">
                  <h3 className="text-xs font-black uppercase tracking-widest text-emerald-400">ECU Terminal Console</h3>
                  <span className="text-[9.5px] text-gray-500 font-mono">VIN: <GlossaryTerm term="vin">{activeJob.vin}</GlossaryTerm></span>
                </div>

                <div className="bg-black/80 border border-emerald-500/20 p-5 rounded-2xl flex flex-col gap-4 shadow-2xl min-h-[350px] font-mono text-xs">
                  
                  {/* Console Log Panel */}
                  <div className="flex-grow bg-[#050507] border border-emerald-950 p-4 rounded-xl flex flex-col gap-2 min-h-[220px] max-h-[260px] overflow-y-auto text-emerald-400 select-text scrollbar-thin">
                    {scanLogs.length === 0 ? (
                      <div className="text-gray-600 italic">OBD-II CAN Scanner interface loaded. Press "Initiate OBD-II Scan" to query powertrain module errors.</div>
                    ) : (
                      scanLogs.map((log, i) => (
                        <div key={i} className="leading-relaxed animate-in fade-in slide-in-from-left-2 duration-300">
                          {log}
                        </div>
                      ))
                    )}
                    {isScanning && (
                      <div className="flex items-center gap-2 text-emerald-300 font-bold uppercase animate-pulse mt-2">
                        <span className="flex h-2.5 w-2.5 relative">
                          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                          <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500"></span>
                        </span>
                        Scanning bus modules ({scanProgress}%)...
                      </div>
                    )}
                  </div>

                  <div className="flex items-center gap-3">
                    <button
                      onClick={() => runObdScan(activeJob.faultCode)}
                      disabled={isScanning || !allowDiagnose}
                      className="flex-grow bg-emerald-500 hover:bg-emerald-400 text-black py-3 rounded-xl font-black uppercase tracking-widest transition-all disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer flex justify-center items-center gap-2"
                    >
                      <Play size={14} /> {isScanning ? 'Querying CAN-Bus...' : 'Initiate OBD-II Scan'}
                    </button>
                    <button
                      onClick={() => {
                        setScanLogs([]);
                        setScanResultCode(null);
                      }}
                      className="bg-white/5 border border-white/10 hover:bg-white/10 text-white px-4 py-3 rounded-xl font-bold uppercase tracking-wider transition-colors"
                    >
                      Clear Console
                    </button>
                  </div>

                </div>
              </div>

              {/* SUB-COLUMN 2: Virtual Engine Diagnostics Monitor */}
              <div className="flex flex-col gap-4">
                <div className="flex justify-between items-baseline border-b border-white/10 pb-2">
                  <h3 className="text-xs font-black uppercase tracking-widest text-emerald-400">Powertrain Visualizer</h3>
                  <span className="bg-emerald-500/10 text-emerald-400 text-[8px] px-2 py-0.5 rounded font-mono uppercase font-black tracking-widest animate-pulse">
                    Live Telemetry
                  </span>
                </div>

                <div className="bg-[#0b0c10]/80 border border-emerald-500/20 p-5 rounded-2xl flex flex-col gap-4 shadow-2xl min-h-[350px] text-left">
                  <div className="flex-grow flex items-center justify-center bg-black/40 border border-white/5 rounded-xl p-4 relative overflow-hidden h-[220px]">
                    {/* Visual Connection Wire Cable overlay */}
                    <div className="absolute top-2 left-1/2 -translate-x-1/2 flex items-center gap-1.5 text-[9px] font-mono tracking-widest text-emerald-500/60 bg-black/40 px-3 py-1 rounded-full border border-emerald-950">
                      <span className="w-1.5 h-1.5 bg-emerald-400 rounded-full animate-ping"></span>
                      <span>OBD-II DATA FEED ACTIVE</span>
                    </div>

                    {/* V8 Piston Cylinder Block Misfire visual */}
                    {activeJob.faultCode === 'P0302' && (
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

                    {/* Transmission Gearbox Sync Wear visual */}
                    {activeJob.faultCode === 'P0700' && (
                      <svg viewBox="0 0 200 150" className="w-full h-full max-h-[160px]">
                        <style>{`
                          @keyframes gear-spin-cw {
                            0% { transform: rotate(0deg); }
                            100% { transform: rotate(360deg); }
                          }
                          @keyframes gear-spin-ccw {
                            0% { transform: rotate(0deg); }
                            100% { transform: rotate(-360deg); }
                          }
                          .gear-cw { transform-origin: 65px 75px; animation: gear-spin-cw 4s linear infinite; }
                          .gear-ccw { transform-origin: 135px 75px; animation: gear-spin-ccw 4s linear infinite; }
                        `}</style>
                        <rect x="20" y="45" width="160" height="60" rx="10" fill="none" stroke="#374151" strokeWidth="2" />
                        <line x1="10" y1="75" x2="190" y2="75" stroke="#4b5563" strokeWidth="4" />
                        <g className="gear-cw">
                          <circle cx="65" cy="75" r="30" fill="none" stroke="#10b981" strokeWidth="4" strokeDasharray="6 4" />
                          <circle cx="65" cy="75" r="15" fill="none" stroke="#4b5563" strokeWidth="2" />
                          <circle cx="65" cy="75" r="4" fill="#9ca3af" />
                        </g>
                        <g className="gear-ccw">
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

                    {/* timing chain / VVT misalignment visual */}
                    {activeJob.faultCode === 'P0011' && (
                      <svg viewBox="0 0 200 150" className="w-full h-full max-h-[160px]">
                        <style>{`
                          @keyframes pulley-spin {
                            0% { transform: rotate(0deg); }
                            100% { transform: rotate(360deg); }
                          }
                          .pulley-l { transform-origin: 65px 45px; animation: pulley-spin 6s linear infinite; }
                          .pulley-r { transform-origin: 135px 45px; animation: pulley-spin 6s linear infinite; }
                          .pulley-crank { transform-origin: 100px 105px; animation: pulley-spin 3s linear infinite; }
                        `}</style>
                        <path d="M 65 15 L 135 15 A 30 30 0 0 1 165 45 L 125 105 A 25 25 0 0 1 75 105 L 35 45 A 30 30 0 0 1 65 15 Z" fill="none" stroke="#f59e0b" strokeWidth="3" strokeDasharray="3 3" />
                        <g className="pulley-l">
                          <circle cx="65" cy="45" r="22" fill="none" stroke="#10b981" strokeWidth="4" />
                          <line x1="65" y1="23" x2="65" y2="67" stroke="#4b5563" strokeWidth="2" />
                          <line x1="43" y1="45" x2="87" y2="45" stroke="#4b5563" strokeWidth="2" />
                          <circle cx="65" cy="45" r="4" fill="#9ca3af" />
                        </g>
                        <g className="pulley-r">
                          <circle cx="135" cy="45" r="22" fill="none" stroke="#ef4444" strokeWidth="4" className="animate-pulse" />
                          <line x1="135" y1="23" x2="135" y2="67" stroke="#4b5563" strokeWidth="2" />
                          <line x1="113" y1="45" x2="157" y2="45" stroke="#4b5563" strokeWidth="2" />
                          <circle cx="135" cy="45" r="4" fill="#9ca3af" />
                        </g>
                        <g className="pulley-crank">
                          <circle cx="100" cy="105" r="15" fill="none" stroke="#10b981" strokeWidth="4" />
                          <circle cx="100" cy="105" r="4" fill="#9ca3af" />
                        </g>
                        <g className="animate-bounce">
                          <text x="100" y="140" fill="#ef4444" fontSize="8" fontWeight="black" fontFamily="monospace" textAnchor="middle">TIMING MISALIGNED!</text>
                          <circle cx="135" cy="23" r="3" fill="#ef4444" />
                          <line x1="135" y1="15" x2="135" y2="30" stroke="#ef4444" strokeWidth="1.5" />
                        </g>
                      </svg>
                    )}

                    {/* Oxygen Sensor / Lean Mix / Cat Converter visual */}
                    {(activeJob.faultCode === 'P0171' || activeJob.faultCode === 'P0420') && (
                      <svg viewBox="0 0 200 150" className="w-full h-full max-h-[160px]">
                        <path d="M 20 40 L 70 40 L 100 75 L 180 75" fill="none" stroke={activeJob.faultCode === 'P0171' ? '#f59e0b' : '#10b981'} strokeWidth="8" className={activeJob.faultCode === 'P0171' ? 'animate-pulse' : ''} />
                        <rect x="100" y="60" width="50" height="30" rx="5" fill="none" stroke={activeJob.faultCode === 'P0420' ? '#ef4444' : '#4b5563'} strokeWidth="3" className={activeJob.faultCode === 'P0420' ? 'animate-pulse' : ''} />
                        <text x="125" y="78" fill="#9ca3af" fontSize="6" textAnchor="middle" fontFamily="monospace">CATALYTIC</text>
                        {activeJob.faultCode === 'P0171' && (
                          <g className="animate-pulse">
                            <circle cx="60" cy="40" r="12" fill="#eab308" opacity="0.3" />
                            <text x="60" y="115" fill="#eab308" fontSize="8" fontWeight="bold" fontFamily="monospace" textAnchor="middle">SYSTEM LEAN (GAS EXP)</text>
                          </g>
                        )}
                        {activeJob.faultCode === 'P0420' && (
                          <g className="animate-pulse">
                            <circle cx="125" cy="75" r="16" fill="#ef4444" opacity="0.3" />
                            <text x="125" y="115" fill="#ef4444" fontSize="8" fontWeight="bold" fontFamily="monospace" textAnchor="middle">EMISSIONS FAIL</text>
                          </g>
                        )}
                      </svg>
                    )}
                  </div>
                </div>
              </div>

              {/* Scan Results Diagnostics Display */}
              <AnimatePresence>
                {scanResultCode && OBD_CODES_LIB[scanResultCode] && (
                  <motion.div
                    initial={{ opacity: 0, y: 15 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: 15 }}
                    className="bg-emerald-500/10 border-2 border-emerald-500/30 p-5 rounded-2xl flex flex-col gap-3"
                  >
                    <div className="flex justify-between items-start border-b border-emerald-500/20 pb-2">
                      <div className="flex items-center gap-2.5 text-emerald-400">
                        <AlertTriangle size={20} className="animate-bounce" />
                        <span className="text-base font-black tracking-wider font-mono">{OBD_CODES_LIB[scanResultCode].code}</span>
                      </div>
                      <span className="bg-red-500/20 text-red-400 border border-red-500/40 text-[9px] px-2.5 py-0.5 rounded uppercase font-black tracking-widest font-mono">
                        Active ECU Misfire
                      </span>
                    </div>

                    <div className="space-y-1">
                      <strong className="text-sm text-white block uppercase tracking-wide">{OBD_CODES_LIB[scanResultCode].label}</strong>
                      <p className="text-xs text-gray-400 leading-relaxed font-sans">{OBD_CODES_LIB[scanResultCode].desc}</p>
                    </div>

                    <div className="bg-black/40 border border-white/5 p-3.5 rounded-xl mt-1 flex flex-col gap-1 leading-normal font-sans">
                      <span className="text-[10px] text-emerald-400 font-bold uppercase tracking-widest font-mono">Recommended Field Action</span>
                      <p className="text-xs text-emerald-300 font-medium">"{OBD_CODES_LIB[scanResultCode].fix}"</p>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>

            </div>
          </motion.div>
        )}

        {/* VIEW 4: PARTS AUDITOR */}
        {view === 'inventory' && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-6 text-left">
            
            <div className="bg-black/40 p-4 rounded border border-white/10 flex justify-between items-center">
              <div>
                <h3 className="text-xl font-bold uppercase tracking-widest text-emerald-400">Mechanical Spares Inventory</h3>
                <p className="text-xs text-gray-400 uppercase tracking-wider mt-1">Audit current engine and mechanical spares stock levels</p>
              </div>
              <div className="text-right">
                <span className="text-xs text-gray-400 uppercase tracking-widest block font-bold">Total Vault Spares</span>
                <span className="text-2xl font-black text-emerald-400 tracking-tighter">180 Units</span>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              
              <div className="bg-black/30 border border-white/5 p-4 rounded-2xl flex flex-col gap-2 hover:border-emerald-500/30 transition-all">
                <div className="flex justify-between items-start">
                  <h4 className="font-bold text-white text-base">Forged Pistons & Gaskets</h4>
                  <span className="bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 px-2 py-0.5 rounded text-[10px] font-black uppercase tracking-widest">In Stock</span>
                </div>
                <div className="flex justify-between items-end mt-4">
                  <div>
                    <span className="text-[10px] text-gray-400 uppercase tracking-widest">Audited Level</span>
                    <div className="text-lg font-black text-white">42 Units</div>
                  </div>
                  <span className="text-[10px] text-gray-500 font-mono">Location: Bay A-4</span>
                </div>
              </div>

              <div className="bg-black/30 border border-white/5 p-4 rounded-2xl flex flex-col gap-2 hover:border-emerald-500/30 transition-all">
                <div className="flex justify-between items-start">
                  <h4 className="font-bold text-white text-base">High-Performance Turbos</h4>
                  <span className="bg-red-500/10 text-red-400 border border-red-500/30 px-2 py-0.5 rounded text-[10px] font-black uppercase tracking-widest animate-pulse">Low Stock</span>
                </div>
                <div className="flex justify-between items-end mt-4">
                  <div>
                    <span className="text-[10px] text-gray-400 uppercase tracking-widest">Audited Level</span>
                    <div className="text-lg font-black text-red-400">3 Units</div>
                  </div>
                  <span className="text-[10px] text-gray-500 font-mono">Location: Vault Safe</span>
                </div>
              </div>

              <div className="bg-black/30 border border-white/5 p-4 rounded-2xl flex flex-col gap-2 hover:border-emerald-500/30 transition-all">
                <div className="flex justify-between items-start">
                  <h4 className="font-bold text-white text-base">Ignition Coil Packs</h4>
                  <span className="bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 px-2 py-0.5 rounded text-[10px] font-black uppercase tracking-widest">In Stock</span>
                </div>
                <div className="flex justify-between items-end mt-4">
                  <div>
                    <span className="text-[10px] text-gray-400 uppercase tracking-widest">Audited Level</span>
                    <div className="text-lg font-black text-white">96 Units</div>
                  </div>
                  <span className="text-[10px] text-gray-500 font-mono">Location: Shelf B-12</span>
                </div>
              </div>

            </div>

          </motion.div>
        )}

        {/* VIEW 5: DEV PAGE */}
        {view === 'dev' && (
          <motion.div initial={{ opacity: 0, y: 15 }} animate={{ opacity: 1, y: 0 }} className="max-w-2xl mx-auto space-y-6 text-left">
            
            <div className="bg-warning/10 border border-warning/30 p-5 rounded-2xl flex gap-4 items-start">
              <ShieldAlert className="w-8 h-8 text-warning shrink-0" />
              <div>
                <h3 className="text-sm font-black uppercase tracking-wider text-warning">Mechanical System Dev Overrides</h3>
                <p className="text-xs text-gray-400 mt-1 leading-relaxed">
                  Use this terminal tool console to adjust ECU diagnose locks, skip Road testing pipelines, or bypass parts replacement stock requirements.
                </p>
              </div>
            </div>

            <div className="bg-white/5 border border-white/10 rounded-2xl p-6 space-y-4 shadow-xl">
              <h4 className="text-xs font-black uppercase tracking-widest text-emerald-400 border-b border-white/10 pb-2 flex items-center gap-1.5">
                <Settings size={14} /> Mechanical Permission Switches
              </h4>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                
                <label className="flex items-center justify-between p-4 bg-black/40 border border-white/5 rounded-xl cursor-pointer hover:border-white/10 transition-colors">
                  <div className="flex flex-col gap-0.5">
                    <span className="text-xs font-bold text-white uppercase tracking-wide">Allow OBD-II Scanning</span>
                    <span className="text-[9px] text-gray-500">Enable/disable scanning active fault codes</span>
                  </div>
                  <input
                    type="checkbox"
                    checked={allowDiagnose}
                    onChange={e => setAllowDiagnose(e.target.checked)}
                    className="w-4 h-4 rounded border-white/20 bg-black text-emerald-400 focus:ring-emerald-500 cursor-pointer"
                  />
                </label>

                <label className="flex items-center justify-between p-4 bg-black/40 border border-white/5 rounded-xl cursor-pointer hover:border-white/10 transition-colors">
                  <div className="flex flex-col gap-0.5">
                    <span className="text-xs font-bold text-white uppercase tracking-wide">Allow Core Disassembly</span>
                    <span className="text-[9px] text-gray-500">Enable/disable physical hardware teardowns</span>
                  </div>
                  <input
                    type="checkbox"
                    checked={allowDisassembly}
                    onChange={e => setAllowDisassembly(e.target.checked)}
                    className="w-4 h-4 rounded border-white/20 bg-black text-emerald-400 focus:ring-emerald-500 cursor-pointer"
                  />
                </label>

                <label className="flex items-center justify-between p-4 bg-black/40 border border-white/5 rounded-xl cursor-pointer hover:border-white/10 transition-colors">
                  <div className="flex flex-col gap-0.5">
                    <span className="text-xs font-bold text-white uppercase tracking-wide">Allow ECU Coding Solenoids</span>
                    <span className="text-[9px] text-gray-500">Enable/disable flashing sensor timing parameters</span>
                  </div>
                  <input
                    type="checkbox"
                    checked={allowECUCoding}
                    onChange={e => setAllowECUCoding(e.target.checked)}
                    className="w-4 h-4 rounded border-white/20 bg-black text-emerald-400 focus:ring-emerald-500 cursor-pointer"
                  />
                </label>

              </div>
            </div>

            <div className="bg-white/5 border border-white/10 rounded-2xl p-6 space-y-4 shadow-xl">
              <h4 className="text-xs font-black uppercase tracking-widest text-warning border-b border-white/10 pb-2 flex items-center gap-1.5">
                <ShieldAlert size={14} /> ECU Override Controls
              </h4>

              <div className="flex flex-col gap-3">
                <div className="flex justify-between items-center p-4 bg-black/40 border border-white/5 rounded-xl">
                  <div className="flex flex-col gap-0.5">
                    <span className="text-xs font-bold text-white uppercase tracking-wide">Instant Diagnostic Fix (ECU Flash 100%)</span>
                    <span className="text-[9px] text-gray-500">Force all jobs to "Ready" and auto-clear mechanical misfires</span>
                  </div>
                  <button
                    onClick={() => setInstantRepairActive(!instantRepairActive)}
                    className={`px-4 py-2 rounded-lg text-xs font-black uppercase tracking-widest transition-all ${instantRepairActive ? 'bg-success text-black shadow-[0_0_10px_rgba(16,185,129,0.3)]' : 'bg-white/5 border border-white/10 text-gray-300'}`}
                  >
                    {instantRepairActive ? 'Active' : 'Trigger'}
                  </button>
                </div>

                <div className="flex justify-between items-center p-4 bg-black/40 border border-white/5 rounded-xl">
                  <div className="flex flex-col gap-0.5">
                    <span className="text-xs font-bold text-white uppercase tracking-wide">Reset Mechanical Datasets</span>
                    <span className="text-[9px] text-gray-500">Wipe current lifts state and reload Corvette/Mustang/BMW records</span>
                  </div>
                  <button
                    onClick={resetAllData}
                    className="bg-warning/20 border border-warning/40 text-warning hover:bg-warning hover:text-black px-4 py-2 rounded-lg text-xs font-black uppercase tracking-widest transition-all flex items-center gap-1"
                  >
                    <RefreshCw size={12} /> Reload Lifts
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
              className="bg-[#0b0c10]/95 border-2 border-emerald-500/40 rounded-2xl max-w-sm w-full p-6 shadow-2xl relative text-white text-left flex flex-col gap-4"
            >
              <div className="flex justify-between items-center border-b border-white/10 pb-2">
                <span className="text-[10px] font-mono font-bold text-emerald-400">
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
                  className="px-4 py-1.5 bg-emerald-500 text-black font-black uppercase text-xs tracking-wider rounded-lg transition-all shadow-[0_0_10px_rgba(16,185,129,0.3)] cursor-pointer"
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
