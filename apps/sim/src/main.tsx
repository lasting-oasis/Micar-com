import React, { useState, useEffect } from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.tsx'
import ShopManagement from './ShopManagement.tsx'
import MechanicManagement from './MechanicManagement.tsx'
import StandaloneShopPlatform from './StandaloneShopPlatform.tsx'
import './index.css'
import { useGameStore } from './store'
import { Car, Wrench, Gamepad2, ArrowRight, ShieldCheck, CheckCircle, Gauge, Activity } from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
// Global Error Overlay Catcher for Debugging Sandboxed/Compatibility crashes
window.addEventListener('error', (event) => {
    const errorContainer = document.createElement('div');
    errorContainer.id = 'debug-error-overlay';
    errorContainer.style.cssText = 'position: fixed; inset: 0; background: rgba(15, 23, 42, 0.98); color: #f87171; font-family: monospace; font-size: 13px; padding: 24px; z-index: 999999; overflow: auto; display: flex; flex-direction: column; gap: 16px; border: 4px solid #ef4444; pointer-events: auto;';
    
    errorContainer.innerHTML = `
        <h2 style="color: #ef4444; font-size: 18px; font-weight: 900; margin: 0; border-bottom: 2px solid #ef4444; padding-bottom: 8px;">
            ⚠️ CRITICAL RUNTIME CRASH CAPTURED
        </h2>
        <div style="background: rgba(0,0,0,0.5); padding: 12px; border-radius: 8px; border: 1px solid rgba(239, 68, 68, 0.2);">
            <strong style="color: #ffffff; display: block; margin-bottom: 4px;">Message:</strong>
            ${event.message || 'Unknown unhandled error'}
        </div>
        <div style="background: rgba(0,0,0,0.5); padding: 12px; border-radius: 8px; border: 1px solid rgba(239, 68, 68, 0.2);">
            <strong style="color: #ffffff; display: block; margin-bottom: 4px;">Source:</strong>
            ${event.filename || 'unknown'}:${event.lineno || 0}:${event.colno || 0}
        </div>
        <div style="background: rgba(0,0,0,0.5); padding: 12px; border-radius: 8px; border: 1px solid rgba(239, 68, 68, 0.2); flex-grow: 1;">
            <strong style="color: #ffffff; display: block; margin-bottom: 4px;">Stack Trace:</strong>
            <pre style="margin: 0; white-space: pre-wrap; word-break: break-all; line-height: 1.4; color: #fca5a5;">${event.error?.stack || 'No stack trace available'}</pre>
        </div>
        <button onclick="document.getElementById('debug-error-overlay').remove()" style="align-self: flex-end; padding: 10px 20px; background: #ef4444; color: white; border: none; border-radius: 8px; font-weight: bold; cursor: pointer;">
            Close Overlay
        </button>
    `;
    document.body.appendChild(errorContainer);
});

function GatewayPortal() {
  const [activeApp, setActiveApp] = useState<'gateway' | 'game' | 'shop' | 'mechanic' | 'platform'>('gateway');

  // Parse URL parameters on initial mount and history updates
  useEffect(() => {
    const handleUrlChange = () => {
      const params = new URLSearchParams(window.location.search);
      const appParam = params.get('app');
      if (appParam === 'shop') {
        setActiveApp('shop');
      } else if (appParam === 'game') {
        setActiveApp('game');
      } else if (appParam === 'mechanic') {
        setActiveApp('mechanic');
      } else if (appParam === 'platform') {
        setActiveApp('platform');
      } else {
        setActiveApp('gateway');
      }
    };

    handleUrlChange();
    window.addEventListener('popstate', handleUrlChange);
    return () => window.removeEventListener('popstate', handleUrlChange);
  }, []);

  // Dynamically manage body & root scrolling/height styles to prevent game constraints from locking the business tool
  useEffect(() => {
    const rootEl = document.getElementById('root');
    if (!rootEl) return;

    if (activeApp === 'game') {
      // Simulator game expects standard locked full-screen viewport
      document.body.style.overflow = 'hidden';
      rootEl.style.height = '100vh';
      rootEl.style.width = '100vw';
      rootEl.style.overflow = 'hidden';
    } else {
      // Gateway portal and standalone bodyshop ERP tool expect normal vertical scrolling
      document.body.style.overflow = 'auto';
      rootEl.style.height = 'auto';
      rootEl.style.minHeight = '100vh';
      rootEl.style.width = '100%';
      rootEl.style.overflow = 'visible';
    }
  }, [activeApp]);

  const selectApp = (app: 'game' | 'shop' | 'mechanic' | 'platform') => {
    try {
      const newUrl = new URL(window.location.href);
      newUrl.searchParams.set('app', app);
      window.history.pushState({}, '', newUrl.toString());
    } catch (e) {
      console.warn('History pushState blocked by iframe/sandbox:', e);
    }
    setActiveApp(app);
  };

  const goBackToGateway = () => {
    // Cleanly disconnect active socket and reset store state
    useGameStore.getState().disconnect();

    try {
      const newUrl = new URL(window.location.href);
      newUrl.searchParams.delete('app');
      window.history.pushState({}, '', newUrl.toString());
    } catch (e) {
      console.warn('History pushState blocked by iframe/sandbox:', e);
    }
    setActiveApp('gateway');
  };

  // 1. STANDALONE SIMULATOR GAME VIEW
  if (activeApp === 'game') {
    return (
      <div className="relative w-screen h-screen overflow-hidden bg-[#0c0d12]">
        {/* Floating Escape Hatch */}
        <button 
          onClick={goBackToGateway}
          className="absolute top-4 left-4 z-[9999] px-4 py-2.5 bg-black/60 border border-white/20 hover:border-market/40 rounded-xl hover:bg-black/95 text-xs font-black uppercase tracking-widest text-white hover:text-market transition-all duration-300 flex items-center gap-1.5 shadow-[0_4px_20px_rgba(0,0,0,0.5)] pointer-events-auto"
        >
          ← Exit to Launchpad
        </button>
        <App />
      </div>
    );
  }

  // 2. STANDALONE ENTERPRISE BODYSHOP TOOL VIEW
  if (activeApp === 'shop') {
    return (
      <div className="relative min-h-screen bg-[#08090d] text-white flex flex-col font-sans select-none overflow-x-hidden">
        {/* Gorgeous premium background gradient glowing spot */}
        <div className="absolute top-0 left-0 right-0 h-[450px] bg-gradient-to-b from-blue-500/10 via-blue-500/2 to-transparent pointer-events-none z-0" />
        
        {/* Standalone ERP Navigation Header */}
        <header className="relative z-10 w-full max-w-7xl mx-auto px-4 md:px-8 py-5 flex justify-between items-center border-b border-white/5">
          <div className="flex items-center gap-2.5">
            <div className="bg-blue-500/20 p-2 rounded-xl border border-blue-500/40 text-blue-400 font-extrabold tracking-wider font-mono text-sm shadow-[0_0_15px_rgba(59,130,246,0.15)]">
              AF
            </div>
            <div>
              <span className="text-sm font-black uppercase tracking-widest text-white block">AutoFlow Pro</span>
              <span className="text-[9px] text-blue-400 font-mono tracking-widest uppercase block">Enterprise Bodyshop Suite</span>
            </div>
          </div>
          <button 
            onClick={goBackToGateway}
            className="px-4 py-2 bg-white/5 border border-white/10 hover:border-white/20 rounded-xl hover:bg-white/10 text-xs font-bold uppercase tracking-wider text-gray-300 hover:text-white transition-all duration-300"
          >
            Exit to Launchpad
          </button>
        </header>

        {/* Main Bodyshop ERP Content Area */}
        <main className="relative z-10 flex-grow w-full max-w-7xl mx-auto px-4 md:px-8 py-6 flex items-center justify-center">
          <ShopManagement />
        </main>

        {/* Professional ERP footer */}
        <footer className="relative z-10 py-5 text-center border-t border-white/5 text-[9px] text-gray-500 font-mono tracking-widest">
          © {new Date().getFullYear()} AUTOFLOW PRO INC. • ENTERPRISE BUSINESS MANAGEMENT SYSTEM • VERSION 4.2.0-PRO
        </footer>
      </div>
    );
  }

  // 3. STANDALONE ENTERPRISE MECHANIC DIAGNOSTICS TOOL VIEW
  if (activeApp === 'mechanic') {
    return (
      <div className="relative min-h-screen bg-[#08090d] text-white flex flex-col font-sans select-none overflow-x-hidden">
        {/* Gorgeous premium background gradient glowing spot */}
        <div className="absolute top-0 left-0 right-0 h-[450px] bg-gradient-to-b from-emerald-500/10 via-emerald-500/2 to-transparent pointer-events-none z-0" />
        
        {/* Standalone ERP Navigation Header */}
        <header className="relative z-10 w-full max-w-7xl mx-auto px-4 md:px-8 py-5 flex justify-between items-center border-b border-white/5">
          <div className="flex items-center gap-2.5">
            <div className="bg-emerald-500/20 p-2 rounded-xl border border-emerald-500/40 text-emerald-400 font-extrabold tracking-wider font-mono text-sm shadow-[0_0_15px_rgba(16,185,129,0.15)]">
              MF
            </div>
            <div>
              <span className="text-sm font-black uppercase tracking-widest text-white block">MechFlow Pro</span>
              <span className="text-[9px] text-emerald-400 font-mono tracking-widest uppercase block">Engine & OBD-II Suite</span>
            </div>
          </div>
          <button 
            onClick={goBackToGateway}
            className="px-4 py-2 bg-white/5 border border-white/10 hover:border-white/20 rounded-xl hover:bg-white/10 text-xs font-bold uppercase tracking-wider text-gray-300 hover:text-white transition-all duration-300"
          >
            Exit to Launchpad
          </button>
        </header>

        {/* Main Mechanic ERP Content Area */}
        <main className="relative z-10 flex-grow w-full max-w-7xl mx-auto px-4 md:px-8 py-6 flex items-center justify-center">
          <MechanicManagement />
        </main>

        {/* Professional ERP footer */}
        <footer className="relative z-10 py-5 text-center border-t border-white/5 text-[9px] text-gray-500 font-mono tracking-widest">
          © {new Date().getFullYear()} MECHFLOW PRO INC. • ENTERPRISE DIAGNOSTICS SYSTEM • VERSION 1.0.0-PRO
        </footer>
      </div>
    );
  }

  // 4. STANDALONE REPAIRFLOW PLATFORM VIEW
  if (activeApp === 'platform') {
    return (
      <div className="relative min-h-screen bg-[#08090d] text-white flex flex-col font-sans select-none overflow-x-hidden">
        {/* Gorgeous premium background gradient glowing spot */}
        <div className="absolute top-0 left-0 right-0 h-[450px] bg-gradient-to-b from-emerald-500/10 via-emerald-500/2 to-transparent pointer-events-none z-0" />
        
        {/* Standalone ERP Navigation Header */}
        <header className="relative z-10 w-full max-w-7xl mx-auto px-4 md:px-8 py-5 flex justify-between items-center border-b border-white/5">
          <div className="flex items-center gap-2.5">
            <div className="bg-emerald-500/20 p-2 rounded-xl border border-emerald-500/40 text-emerald-400 font-extrabold tracking-wider font-mono text-sm shadow-[0_0_15px_rgba(16,185,129,0.15)]">
              RF
            </div>
            <div>
              <span className="text-sm font-black uppercase tracking-widest text-white block">RepairFlow Pro</span>
              <span className="text-[9px] text-emerald-400 font-mono tracking-widest uppercase block">Standalone Platform Suite</span>
            </div>
          </div>
          <button 
            onClick={goBackToGateway}
            className="px-4 py-2 bg-white/5 border border-white/10 hover:border-white/20 rounded-xl hover:bg-white/10 text-xs font-bold uppercase tracking-wider text-gray-300 hover:text-white transition-all duration-300"
          >
            Exit to Launchpad
          </button>
        </header>

        {/* Main Platform Content Area */}
        <main className="relative z-10 flex-grow w-full max-w-7xl mx-auto px-4 md:px-8 py-6 flex items-center justify-center">
          <StandaloneShopPlatform />
        </main>

        {/* Professional ERP footer */}
        <footer className="relative z-10 py-5 text-center border-t border-white/5 text-[9px] text-gray-500 font-mono tracking-widest">
          © {new Date().getFullYear()} REPAIRFLOW PLATFORM • ENTERPRISE LOGISTICS SYSTEM • VERSION 1.0.0-PRO
        </footer>
      </div>
    );
  }

  // 3. PREMIUM LAUNCHPAD GATEWAY PORTAL
  return (
    <div className="relative min-h-screen bg-[#06070a] text-white flex flex-col items-center justify-between font-sans overflow-x-hidden p-6 select-none md:p-12">
      {/* Decorative Neon Glowing Orbs */}
      <div className="absolute top-[-10%] left-[-10%] w-[50vw] h-[50vw] rounded-full bg-cyan-500/10 blur-[120px] pointer-events-none" />
      <div className="absolute bottom-[-10%] right-[-10%] w-[50vw] h-[50vw] rounded-full bg-blue-600/10 blur-[120px] pointer-events-none" />

      {/* Top Brand Header */}
      <header className="w-full max-w-6xl flex justify-between items-center z-10 shrink-0 border-b border-white/5 pb-6">
        <div className="flex items-center gap-2">
          <div className="w-3 h-3 rounded-full bg-cyan-400 animate-pulse shadow-[0_0_10px_#22d3ee]" />
          <span className="text-[11px] font-mono tracking-[0.25em] text-cyan-400 font-black uppercase">AUTO LOGISTICS PORTAL</span>
        </div>
        <span className="text-[10px] text-gray-500 font-mono">v4.0.0-READY</span>
      </header>

      {/* Main Experience cards Grid */}
      <main className="w-full max-w-5xl flex flex-col justify-center items-center gap-8 my-10 z-10 flex-grow">
        <div className="text-center space-y-3 max-w-2xl">
          <h1 className="text-3xl md:text-5xl font-black uppercase tracking-wider bg-gradient-to-r from-cyan-400 via-indigo-200 to-blue-400 bg-clip-text text-transparent">
            Automotive Hub
          </h1>
          <p className="text-xs md:text-sm text-gray-400 font-medium leading-relaxed max-w-lg mx-auto">
            Select an operational workspace. Experience the premium 3D dealership simulator or deploy our real-world reconditioning logistics dashboard.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-8 w-full max-w-5xl">
          
          {/* CARD 1: 3D SIMULATOR GAME */}
          <motion.div 
            whileHover={{ y: -8, scale: 1.01 }}
            transition={{ type: "spring", stiffness: 300, damping: 20 }}
            className="group relative bg-white/[0.02] border border-white/10 hover:border-cyan-500/40 rounded-3xl p-8 flex flex-col justify-between gap-8 cursor-pointer transition-all duration-300 overflow-hidden shadow-2xl backdrop-blur-md"
            onClick={() => selectApp('game')}
          >
            {/* Top Glow bar on hover */}
            <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-cyan-400 to-blue-400 opacity-0 group-hover:opacity-100 transition-opacity duration-500" />
            
            <div className="space-y-6">
              {/* Card Icon Header */}
              <div className="flex justify-between items-center">
                <div className="bg-cyan-500/10 border border-cyan-500/20 text-cyan-400 p-4 rounded-2xl group-hover:scale-110 transition-transform duration-300">
                  <Gamepad2 size={28} />
                </div>
                <span className="text-[9px] font-mono tracking-widest text-cyan-400 bg-cyan-400/10 border border-cyan-400/20 px-3 py-1 rounded-full font-black uppercase">
                  GAME EXPERIENCE
                </span>
              </div>

              {/* Title & Desc */}
              <div className="space-y-3 text-left">
                <h3 className="text-xl font-bold uppercase tracking-wider group-hover:text-cyan-400 transition-colors">
                  Dealership 3D Simulator
                </h3>
                <p className="text-xs text-gray-400 leading-relaxed font-sans">
                  Step onto the virtual showroom floor. An immersive 3D environment for buying, bidding, restoring, and selling vehicles with advanced financial forecasting.
                </p>
              </div>

              {/* Bulleted checklist of features */}
              <ul className="space-y-2.5 text-xs text-gray-300 font-sans text-left border-t border-white/5 pt-5">
                <li className="flex items-center gap-2">
                  <CheckCircle size={14} className="text-cyan-400 shrink-0" />
                  <span>Real-Time 3D Interactive Lot & Canvas</span>
                </li>
                <li className="flex items-center gap-2">
                  <CheckCircle size={14} className="text-cyan-400 shrink-0" />
                  <span>Live Bidding Auction Mechanics</span>
                </li>
                <li className="flex items-center gap-2">
                  <CheckCircle size={14} className="text-cyan-400 shrink-0" />
                  <span>Interactive CRM & DMV Registration Panels</span>
                </li>
                <li className="flex items-center gap-2">
                  <CheckCircle size={14} className="text-cyan-400 shrink-0" />
                  <span>Staff Hiring & AI Agent Management</span>
                </li>
              </ul>
            </div>

            {/* Launch trigger button */}
            <button className="w-full py-4 bg-white/5 hover:bg-cyan-400 hover:text-black border border-white/10 hover:border-cyan-400 rounded-2xl font-black uppercase text-xs tracking-widest transition-all duration-300 flex items-center justify-center gap-2 group-hover:shadow-[0_0_20px_rgba(34,211,238,0.3)]">
              Launch Simulator 3D <ArrowRight size={16} className="group-hover:translate-x-1.5 transition-transform" />
            </button>
          </motion.div>

          {/* CARD 2: REAL WORLD BODYSHOP & MECHANIC TOOL */}
          <motion.div 
            whileHover={{ y: -8, scale: 1.01 }}
            transition={{ type: "spring", stiffness: 300, damping: 20 }}
            className="group relative bg-white/[0.02] border border-white/10 hover:border-blue-500/40 rounded-3xl p-8 flex flex-col justify-between gap-8 cursor-pointer transition-all duration-300 overflow-hidden shadow-2xl backdrop-blur-md"
            onClick={() => selectApp('shop')}
          >
            {/* Top Glow bar on hover */}
            <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-blue-500 to-indigo-500 opacity-0 group-hover:opacity-100 transition-opacity duration-500" />

            <div className="space-y-6">
              {/* Card Icon Header */}
              <div className="flex justify-between items-center">
                <div className="bg-blue-500/10 border border-blue-500/20 text-blue-400 p-4 rounded-2xl group-hover:scale-110 transition-transform duration-300">
                  <Wrench size={28} />
                </div>
                <span className="text-[9px] font-mono tracking-widest text-blue-400 bg-blue-400/10 border border-blue-400/20 px-3 py-1 rounded-full font-black uppercase">
                  ENTERPRISE TOOL
                </span>
              </div>

              {/* Title & Desc */}
              <div className="space-y-3 text-left">
                <h3 className="text-xl font-bold uppercase tracking-wider group-hover:text-blue-400 transition-colors">
                  AutoFlow Pro Bodyshop Suite
                </h3>
                <p className="text-xs text-gray-400 leading-relaxed font-sans">
                  A standalone reconditioning operations tracker built for professional garages, detail centers, paint shops, and real-world mechanic operations.
                </p>
              </div>

              {/* Bulleted checklist of features */}
              <ul className="space-y-2.5 text-xs text-gray-300 font-sans text-left border-t border-white/5 pt-5">
                <li className="flex items-center gap-2">
                  <ShieldCheck size={14} className="text-blue-400 shrink-0" />
                  <span>Domino's-Style Live Repair Status Portal</span>
                </li>
                <li className="flex items-center gap-2">
                  <ShieldCheck size={14} className="text-blue-400 shrink-0" />
                  <span>7-Stage Active Shop Pipeline & Board</span>
                </li>
                <li className="flex items-center gap-2">
                  <ShieldCheck size={14} className="text-blue-400 shrink-0" />
                  <span>Custom Diagnostics & Technician Notes Logging</span>
                </li>
                <li className="flex items-center gap-2">
                  <ShieldCheck size={14} className="text-blue-400 shrink-0" />
                  <span>Dev Operations Permissions Console Controls</span>
                </li>
              </ul>
            </div>

            {/* Launch trigger button */}
            <button className="w-full py-4 bg-white/5 hover:bg-blue-500 hover:text-black border border-white/10 hover:border-blue-500 rounded-2xl font-black uppercase text-xs tracking-widest transition-all duration-300 flex items-center justify-center gap-2 group-hover:shadow-[0_0_20px_rgba(59,130,246,0.3)]">
              Launch Bodyshop Suite <ArrowRight size={16} className="group-hover:translate-x-1.5 transition-transform" />
            </button>
          </motion.div>

          {/* CARD 3: REAL WORLD ENGINE & OBD-II MECH TOOL */}
          <motion.div 
            whileHover={{ y: -8, scale: 1.01 }}
            transition={{ type: "spring", stiffness: 300, damping: 20 }}
            className="group relative bg-white/[0.02] border border-white/10 hover:border-emerald-500/40 rounded-3xl p-8 flex flex-col justify-between gap-8 cursor-pointer transition-all duration-300 overflow-hidden shadow-2xl backdrop-blur-md"
            onClick={() => selectApp('mechanic')}
          >
            {/* Top Glow bar on hover */}
            <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-emerald-400 to-teal-400 opacity-0 group-hover:opacity-100 transition-opacity duration-500" />

            <div className="space-y-6">
              {/* Card Icon Header */}
              <div className="flex justify-between items-center">
                <div className="bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 p-4 rounded-2xl group-hover:scale-110 transition-transform duration-300">
                  <Gauge size={28} />
                </div>
                <span className="text-[9px] font-mono tracking-widest text-emerald-400 bg-emerald-400/10 border border-emerald-400/20 px-3 py-1 rounded-full font-black uppercase">
                  DIAGNOSTICS TOOL
                </span>
              </div>

              {/* Title & Desc */}
              <div className="space-y-3 text-left">
                <h3 className="text-xl font-bold uppercase tracking-wider group-hover:text-emerald-400 transition-colors">
                  MechFlow Pro Diagnostics
                </h3>
                <p className="text-xs text-gray-400 leading-relaxed font-sans">
                  A standalone mechanical diagnostics and engine overhaul suite built for technical garages, dyno tuners, and electrical diagnostics bays.
                </p>
              </div>

              {/* Bulleted checklist of features */}
              <ul className="space-y-2.5 text-xs text-gray-300 font-sans text-left border-t border-white/5 pt-5">
                <li className="flex items-center gap-2">
                  <ShieldCheck size={14} className="text-emerald-400 shrink-0" />
                  <span>Real-Time OBD-II CAN-Bus Terminal Simulator</span>
                </li>
                <li className="flex items-center gap-2">
                  <ShieldCheck size={14} className="text-emerald-400 shrink-0" />
                  <span>4-Bay Mechanical Lift Manager & Steppers</span>
                </li>
                <li className="flex items-center gap-2">
                  <ShieldCheck size={14} className="text-emerald-400 shrink-0" />
                  <span>Interactive Fault Code Library Lookup</span>
                </li>
                <li className="flex items-center gap-2">
                  <ShieldCheck size={14} className="text-emerald-400 shrink-0" />
                  <span>Pistons, Turbos & Ignition Spares Auditor</span>
                </li>
              </ul>
            </div>

            {/* Launch trigger button */}
            <button className="w-full py-4 bg-white/5 hover:bg-emerald-400 hover:text-black border border-white/10 hover:border-emerald-400 rounded-2xl font-black uppercase text-xs tracking-widest transition-all duration-300 flex items-center justify-center gap-2 group-hover:shadow-[0_0_20px_rgba(16,185,129,0.3)]">
              Launch Diagnostics Suite <ArrowRight size={16} className="group-hover:translate-x-1.5 transition-transform" />
            </button>
          </motion.div>

          {/* CARD 4: STANDALONE REPAIRFLOW PLATFORM */}
          <motion.div 
            whileHover={{ y: -8, scale: 1.01 }}
            transition={{ type: "spring", stiffness: 300, damping: 20 }}
            className="group relative bg-white/[0.02] border border-white/10 hover:border-emerald-500/40 rounded-3xl p-8 flex flex-col justify-between gap-8 cursor-pointer transition-all duration-300 overflow-hidden shadow-2xl backdrop-blur-md"
            onClick={() => selectApp('platform')}
          >
            {/* Top Glow bar on hover */}
            <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-emerald-500 to-teal-500 opacity-0 group-hover:opacity-100 transition-opacity duration-500" />

            <div className="space-y-6">
              {/* Card Icon Header */}
              <div className="flex justify-between items-center">
                <div className="bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 p-4 rounded-2xl group-hover:scale-110 transition-transform duration-300">
                  <Activity size={28} />
                </div>
                <span className="text-[9px] font-mono tracking-widest text-emerald-400 bg-emerald-400/10 border border-emerald-400/20 px-3 py-1 rounded-full font-black uppercase">
                  PUBLIC PLATFORM
                </span>
              </div>

              {/* Title & Desc */}
              <div className="space-y-3 text-left">
                <h3 className="text-xl font-bold uppercase tracking-wider group-hover:text-emerald-400 transition-colors">
                  RepairFlow Platform
                </h3>
                <p className="text-xs text-gray-400 leading-relaxed font-sans">
                  A public standalone shop simulator & process tracking portal where customers query mechanical repair order metrics and view real-time OBD-II visualizers.
                </p>
              </div>

              {/* Bulleted checklist of features */}
              <ul className="space-y-2.5 text-xs text-gray-300 font-sans text-left border-t border-white/5 pt-5">
                <li className="flex items-center gap-2">
                  <ShieldCheck size={14} className="text-emerald-400 shrink-0" />
                  <span>Real-Time CAN-Bus Telemetry & SVGs</span>
                </li>
                <li className="flex items-center gap-2">
                  <ShieldCheck size={14} className="text-emerald-400 shrink-0" />
                  <span>Live Capacity Indexes & Wait Queues</span>
                </li>
                <li className="flex items-center gap-2">
                  <ShieldCheck size={14} className="text-emerald-400 shrink-0" />
                  <span>Interactive Fault Code Lookup Terminal</span>
                </li>
                <li className="flex items-center gap-2">
                  <ShieldCheck size={14} className="text-emerald-400 shrink-0" />
                  <span>Operator Bay Manager & Tech Upgrades</span>
                </li>
              </ul>
            </div>

            {/* Launch trigger button */}
            <button className="w-full py-4 bg-white/5 hover:bg-emerald-400 hover:text-black border border-white/10 hover:border-emerald-500 rounded-2xl font-black uppercase text-xs tracking-widest transition-all duration-300 flex items-center justify-center gap-2 group-hover:shadow-[0_0_20px_rgba(16,185,129,0.3)]">
              Launch RepairFlow Platform <ArrowRight size={16} className="group-hover:translate-x-1.5 transition-transform" />
            </button>
          </motion.div>

        </div>
      </main>

      {/* Bottom Legal Footer */}
      <footer className="w-full text-center z-10 shrink-0 border-t border-white/5 pt-6 text-[10px] text-gray-500 font-mono tracking-widest">
        SYSTEM SECURITY CLASSIFICATION: COMMERCIAL SYSTEM • SECURED VIA INTEGRATED SECURE PROTOCOLS
      </footer>
    </div>
  )
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <GatewayPortal />
  </React.StrictMode>,
)
