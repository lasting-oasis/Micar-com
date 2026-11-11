import express from 'express';
import { createServer } from 'node:http';
import { Server } from 'socket.io';
import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import { GameState, Car, Player, FractionalVehicle, FUEL_PRICE_PER_UNIT } from './src/types.js';
import { EVENTS, carState, freshStrip, getV, isOwned, okey, stageOf, withV, type PartValue } from './src/world/data.js';
import { applyPayout, clampTune, ensureStrip, outrunEvent, partPrice, validateEnter, validateFinish, validateOutrun, ENTRY_TTL_MS, type EventEntry } from './src/world/payout.js';
import { MECHANIC_LIB, BODY_LIB } from './src/constants.js';
import { CAR_CATALOG } from './src/carCatalog.js';
import { DOORS, applyOrder, isOrderLine, quoteOrder, type OrderCtx, type WorkOrder } from './src/bay/order.js';
import { explainCondition } from './src/bay/faults.js';
import { guarded, handlerErrorLog } from './src/world/safeHandler.js';
import { REPAIR_JOBS, repairJobFor } from './src/bay/catalog.js';
import { GATE_RETURN } from './src/scene/world/gateSpot.js';
import { RENTAL_FLEET, canRent, isRental, isVisitor, rent, type RentalKey } from './src/world/rental.js';
import { MAGIC_TTL_MS, allowSend, clientIp, newSendLog, pruneSendLog, applyRecord, attachAccount, liveHolder, bootState, claimAllowance, findAccount, linkGuest, saveRecord, signMagic, signSession, utcDay, verifyGoogle, verifyMagic, verifySession, type Account, type Identity, type Jwk } from './src/world/accounts.js';
import { RENTAL_DENIED, VISITOR_DENIED, VISITOR_EVENTS, closeEvent, guestPlayer, hostIsVacant, isUntouchedGuest, linkTarget, pickHost, quitEvent, sanitizePosition } from './src/world/stripFlow.js';
import { coalescingSaver, loadOrQuarantine, writeAtomic } from './src/world/persistence.js';
import { grantTester, heldTestCar, returnTestCar, setTestCar, splitTesterName, testCarDef, topUp } from './src/world/tester.js';
import { checkTesterKey, configuredTesterKey, isKeyAttempt, newAttemptLog, refusalText } from './src/world/testerKey.js';
import { TRACKS } from './src/world/strip/district.js';
import { readTrackSync, setTrackDir } from './src/world/strip/districtNode.js';

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
// Where newly delivered stock lands: the delivery zone along the lot's left edge.
// Cars stand side by side 6 units apart, nose toward the lot. (Lined up nose to
// tail at that spacing, the 9-11-unit-long cars overlapped.)
const dropOffSpot = (lot: { x: number; z: number }, index: number) =>
    ({ x: lot.x - 40, z: lot.z + 15 + index * 6, r: -Math.PI / 2 });

// Position payloads from clients are validated and clamped by sanitizePosition (stripFlow.ts):
// the town to ±2000 world units, a Strip pose (district 'strip') to the circuits' grid.

// One write at a time (a save asked for mid-write coalesces into one more), each to a temp file renamed over the save.
const saver = coalescingSaver(async () => {
    try {
        await writeAtomic(fs, DATA_FILE, JSON.stringify(gameState));
    } catch (err) {
        console.error('Failed to save game state:', err);
    }
});
const saveGameState = () => saver.save();

async function loadGameState() {
    try {
        const loaded = await loadOrQuarantine(fs, DATA_FILE, Date.now());
        if (loaded.kind === 'quarantined') console.error(`The save file did not parse; it was set aside as ${loaded.to ?? '(rename failed)'} and the server starts fresh.`);
        const parsed = loaded.kind === 'loaded' ? loaded.data : null;
        if (parsed) {
            gameState = { ...gameState, ...parsed };
            // Players are keyed by socket id, which is regenerated on every new
            // connection — so persisted players can never be reclaimed by anyone.
            // Keeping them just litters the world with un-ownable ghost lots (whose
            // gates never open for you) and inflates the join lot-count, which is how
            // a reconnecting player ends up spawned on a stale lot they can't exit.
            // Drop them so every fresh server process starts with no ghosts.
            // (bootState also makes sure the saved accounts map exists.)
            gameState = bootState(gameState);
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

// Live Strip event entries: socket id -> the event entered and when (enter_event).
// finish_event pays only against one of these, and consumes it.
const activeEvents = new Map<string, EventEntry>();
// The car each socket last drove (from sync_car_pos): its stored build gives the style bonus.
const drivenCar = new Map<string, string>();
// When each socket last had an outrun paid, or entered the Strip: outruns are paid at most every OUTRUN_MIN_MS.
const lastOutrunAt = new Map<string, number>();
// Where each socket is inside the Strip (world units of the Strip's own scene), while it is there. The
// player's worldPosition stays its town location: the gate spot, tagged district 'strip'.
const stripPositions = new Map<string, any>();
// When each socket last had an event paid (any cash, Octane or REP): the next is paid no sooner than PAID_COOLDOWN_MS.
const lastPaidAt = new Map<string, number>();
/** A socket's player was replaced (a re-join, a sign-out, a superseded session): nothing of the old run's live state stays. */
function resetSocketState(socketId: string) {
    for (const m of [activeEvents, drivenCar, stripPositions, lastOutrunAt, lastPaidAt] as Map<string, unknown>[]) m.delete(socketId);
}

// Timestamp of the last accepted end_day, used to throttle host day-advances.
let lastEndDayAt = 0;

// --- Guests, rentals and accounts --------------------------------------------
// Rules live in src/world/rental.ts, accounts.ts and stripFlow.ts; this is the wiring.
// Secrets come only from the environment and are never logged.
const CAPS = {
    google: !!process.env.GOOGLE_CLIENT_ID,
    googleClientId: process.env.GOOGLE_CLIENT_ID ?? null, // public: the browser needs it for Google sign-in
    magic: !!(process.env.RESEND_API_KEY && process.env.MAGIC_SECRET && process.env.MAGIC_FROM),
};
// Tester mode (src/world/tester.ts): off unless TESTER_KEY is set to 8-128 characters. The key is compared, never
// sent, stored or logged; misses are rationed per address and overall (src/world/testerKey.ts).
const TESTER_KEY = configuredTesterKey(process.env.TESTER_KEY);
if (process.env.TESTER_KEY && !TESTER_KEY) console.log('TESTER_KEY is set but is not 8 to 128 characters long: tester mode stays off');
const testerAttempts = newAttemptLog();
const TESTER_NO_ACCOUNT = 'A tester session is not saved to an account';
const DEFAULT_ORIGIN = 'https://micar-sim.onrender.com';
// Resend's endpoint; RESEND_API_URL overrides it only so the wiring test can point the server at a local fake.
const RESEND_URL = process.env.RESEND_API_URL || 'https://api.resend.com/emails';
const LINK_COOLDOWN_MS = 60_000;
const JWKS_TTL_MS = 6 * 3600_000;
// Magic tokens already used (single use), each kept until it could no longer be valid anyway.
const usedMagic = new Set<string>();
const usedMagicUntil = new Map<string, number>();
// When each socket, and each address, last asked for a magic link (one per minute each).
const lastLinkAt = new Map<string, number>();
const lastLinkTo = new Map<string, number>();
// Every email actually sent, in the rolling hour: 30 in all, 3 per client address.
const linkSends = newSendLog();
// Who asked for a link to each address (lowercased): the click signs in that guest, if its tab is still here.
const linkRequests = new Map<string, { socketId: string; at: number }>();
let googleKeys: { keys: Jwk[]; at: number } | null = null;
let googleForcedAt = 0;

const redact = (s: string) => s.slice(0, 3) + '…';
const accountView = (a: Account) => ({ id: a.id, identity: a.identities[0], allowanceToday: a.lastAllowance === utcDay(Date.now()) });
const issueSession = (accountId: string) => process.env.MAGIC_SECRET ? signSession(accountId, Date.now(), process.env.MAGIC_SECRET) : null;
// The state a client may see: never the accounts (identities are private), nor other players' account ids or tester flag.
const publicState = (viewerId: string) => {
    const { accounts: _accounts, ...rest } = gameState;
    const players: Record<string, Player> = {};
    for (const [pid, p] of Object.entries(gameState.players)) players[pid] = pid === viewerId ? p : { ...p, accountId: undefined, tester: undefined };
    return { ...rest, players };
};

/** Copy an account holder's live progress into their account record. flush: write the save file now. */
function persistAccount(player: Player, flush = true) {
    const account = player.accountId ? gameState.accounts[player.accountId] : undefined;
    if (!account) return;
    account.player = saveRecord(player);
    if (flush) void saveGameState();
}

function pruneUsedMagic(now: number) {
    for (const [t, until] of usedMagicUntil) if (until < now) { usedMagicUntil.delete(t); usedMagic.delete(t); }
    for (const [addr, at] of lastLinkTo) if (now - at >= LINK_COOLDOWN_MS) lastLinkTo.delete(addr);
    for (const [addr, r] of linkRequests) if (now - r.at > MAGIC_TTL_MS) linkRequests.delete(addr);
    pruneSendLog(linkSends, now);
}

/** Google's signing keys, cached 6 hours; force refetches (at most once a minute) for an unknown kid. */
async function getGoogleKeys(force = false): Promise<Jwk[]> {
    const now = Date.now();
    if (googleKeys && !force && now - googleKeys.at < JWKS_TTL_MS) return googleKeys.keys;
    if (force && now - googleForcedAt < 60_000) return googleKeys?.keys ?? [];
    if (force) googleForcedAt = now;
    try {
        const res = await fetch('https://www.googleapis.com/oauth2/v3/certs');
        if (!res.ok) throw new Error(`status ${res.status}`);
        const body: any = await res.json();
        if (!Array.isArray(body?.keys)) throw new Error('no keys');
        googleKeys = { keys: body.keys, at: now };
    } catch (err) {
        console.error('Google keys fetch failed:', (err as Error).message);
    }
    return googleKeys?.keys ?? [];
}

async function verifyGoogleToken(idToken: string): Promise<Identity | undefined> {
    const clientId = process.env.GOOGLE_CLIENT_ID;
    if (!clientId) return undefined;
    let kid: unknown;
    try { kid = JSON.parse(Buffer.from(idToken.split('.')[0], 'base64url').toString()).kid; } catch { return undefined; }
    let keys = await getGoogleKeys();
    if (!keys.some(k => k.kid === kid)) keys = await getGoogleKeys(true);
    const g = verifyGoogle(idToken, clientId, keys, Date.now());
    return g ? { kind: 'google', sub: g.sub, ...(g.email ? { email: g.email } : {}) } : undefined;
}

/** The link goes to the page's own origin only when it is the host this server answers on. */
function linkOrigin(headers: Record<string, unknown>): string {
    const origin = headers.origin, host = headers.host;
    if (typeof origin !== 'string' || typeof host !== 'string') return DEFAULT_ORIGIN;
    try {
        const u = new URL(origin);
        if ((u.protocol === 'https:' || u.protocol === 'http:') && u.host === host) return u.origin;
    } catch { /* fall through */ }
    return DEFAULT_ORIGIN;
}

async function sendMagicEmail(email: string, origin: string): Promise<boolean> {
    const secret = process.env.MAGIC_SECRET, key = process.env.RESEND_API_KEY, from = process.env.MAGIC_FROM;
    if (!secret || !key || !from) return false;
    const token = signMagic(email, Date.now(), secret);
    try {
        const res = await fetch(RESEND_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
            body: JSON.stringify({ from, to: email, subject: 'Your MiCar sign-in link', text: `Sign in: ${origin}/strip#link=${token}  (15 minutes, one use)` }),
        });
        if (!res.ok) { console.error('Magic link send failed for', redact(email), 'status', res.status); return false; }
        return true;
    } catch (err) {
        console.error('Magic link send failed for', redact(email), (err as Error).message);
        return false;
    }
}

/** An event entry closed: hand back the rental it was driven in, if any. True when one went back. */
function endEvent(socketId: string, carId: string | undefined): boolean {
    const player = gameState.players[socketId];
    if (!player) return false;
    const { returned } = closeEvent(player, carId);
    if (returned) drivenCar.delete(socketId);
    return !!returned;
}

// Entries left open past their TTL are closed (their rental returned) once a minute.
setInterval(() => {
    const now = Date.now();
    let changed = false;
    for (const [sid, e] of activeEvents) {
        if (now - e.startedAt <= ENTRY_TTL_MS) continue;
        activeEvents.delete(sid);
        if (endEvent(sid, e.carId)) changed = true;
    }
    if (changed) broadcastState(io, gameState);
}, 60_000);

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
                    accountId: undefined,  // account ids are private
                    tester: undefined,     // and so is who is testing
                    inventory: p.inventory ? p.inventory.map((c: any) => ({ ...c, buyPrice: 0 })) : []
                };
            }
        }
        const myWalkIns = state.activeWalkIns?.[id];
        // The chat log is sent once on join ('init'); new messages arrive as 'chat'
        // events, so it's left out of every state update to keep them small.
        // Accounts (identities, saved records) are never sent to any client.
        const { chatLog: _chatLog, accounts: _accounts, ...shared } = state as any;
        socket.emit('update', {
            ...shared,
            players,
            activeWalkIns: myWalkIns ? { [id]: myWalkIns } : {}
        });
    }
}

let gameState: GameState = { 
    day: 1, 
    timeOfDay: 8.0, 
    players: {}, 
    accounts: {},
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

/** Gives a car a fault for every point of condition it lost that no fault accounts for. */
let faultSeq = 0;
const explainCar = (car: Car) => { explainCondition(car, Math.random, () => `rep-x-${Date.now()}-${faultSeq++}`); };
const explainAll = (p: Player) => { for (const c of p.inventory) explainCar(c); };

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

// The smoke test's server (SMOKE=1 only, never otherwise): a new player starts with one car, a copy of the
// cheapest car at the auction, titled and on the lot like any owned car, so the test needs no auction window.
const grantStarterCar = (player: Player) => {
    if (!gameState.market.length) generateMarketCars();
    const base = [...gameState.market].sort((a, b) => a.buyPrice - b.buyPrice)[0];
    if (!base) return;
    const car: Car = JSON.parse(JSON.stringify(base));
    car.id = `starter-${Date.now()}-${player.id.substring(0, 4)}`;
    car.vin = generateVIN();
    car.ownerId = player.id;
    car.daysOnLot = 0;
    car.isRegistered = true;
    car.isDirty = false;
    car.isProcessed = true;
    // the last stall of the right display row (dealership.ts paintParkingRow(10, 28, -30, 78)), nose in: clear of
    // the drop-off line, where the next car bought at the auction lands
    car.lotPosition = { x: player.lotPosition.x + 19, z: player.lotPosition.z + 75, r: -Math.PI / 2 } as any;
    player.inventory.push(car);
    console.log('SMOKE: granted a starter car', car.year, car.make, car.model, 'to', player.name);
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
    if (isVisitor(p)) return; // a Strip visitor runs no business: no premiums, no adverse events
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
            explainCar(c);
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
        explainCar(car);
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
        // a Strip visitor runs no business: no overhead, walk-ins, insurance, or days on lot for a rental
        if (isVisitor(p)) return;
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
                                lotPosition: dropOffSpot(p.lotPosition, unparkedCount)
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

// Live player positions. Clients send theirs ~10x/sec (sync_player_pos); this
// relays everyone's to everyone at the same rate so other players move smoothly
// instead of only updating when some unrelated event triggers a full broadcast.
// Only sent while someone's position is actually changing (clients keep resending
// theirs while standing still). Volatile: a dropped packet is fine, the next one is
// 100 ms away; 300 ms after movement stops, one final copy is sent reliably so a
// client that dropped the last moving packets isn't left with stale positions.
let positionsDirty = false;
let quietTicks = 3; // relay ticks since a position last changed
setInterval(() => {
    if (positionsDirty) quietTicks = 0;
    else if (++quietTicks !== 3) return;
    const positions: Record<string, any> = {};
    for (const pid in gameState.players) {
        const wp = (gameState.players[pid] as any).worldPosition, sp = stripPositions.get(pid);
        if (wp) positions[pid] = sp && wp.district === 'strip' ? { ...wp, stripPosition: sp } : wp;
    }
    if (positionsDirty) {
        positionsDirty = false;
        io.volatile.emit('player_positions', positions);
    } else {
        io.emit('player_positions', positions);
    }
}, 100);

io.on('connection', (socket) => {
    // A handler that throws, or whose promise rejects, is logged and the server carries on. The error's message only: never the payload.
    const on = socket.on.bind(socket) as (event: string, fn: (...args: any[]) => unknown) => unknown;
    (socket as any).on = (event: string, fn: (...args: any[]) => unknown) => on(event, guarded(event, fn, (ev, error) => console.log('--- HANDLER ERROR ---', handlerErrorLog(ev, error))));
    // A Strip visitor (a guest or a Strip account holder) may send only the Strip's own events (VISITOR_EVENTS): no
    // dealer handler ever runs for one, so no money made there can be carried into an account.
    socket.use(([event], next) => {
        const sender = gameState.players[socket.id];
        if (sender?.tester) topUp(sender); // a tester's money is never short, whatever they do next
        if (isVisitor(sender) && !VISITOR_EVENTS.has(event)) { socket.emit('strip_denied', { reason: VISITOR_DENIED }); return; }
        next();
    });
    const deny = (reason: string) => socket.emit('strip_denied', { reason });
    /** The player's car for a dealer action (sell, repair, inspect, borrow against, fractionalize, scrap...); a rental
     *  is refused (strip_denied) and comes back undefined, so the handler does nothing. */
    const dealerCar = (player: Player, carId: unknown): Car | undefined => {
        const car = player.inventory.find(c => c.id === carId);
        if (car && isRental(car)) { deny(RENTAL_DENIED); return undefined; }
        return car;
    };

    // A visitor in the Strip: a fresh guest, or (account) the account's saved progress, or (tester) a guest in tester mode.
    const spawnVisitor = (name: unknown, account?: Account, tester = false) => {
      const now = Date.now();
      const p = guestPlayer(socket.id, typeof name === 'string' ? name.trim().slice(0, 24) : '', now);
      if (account) {
          applyRecord(p, structuredClone(account.player)); // a copy: the record changes only via persistAccount
          explainAll(p);
          p.accountId = account.id;
          p.guest = false;
      } else if (tester) grantTester(p);
      gameState.players[socket.id] = p;
      lastOutrunAt.set(socket.id, now); // they start in the Strip: the outrun clock starts now
      socket.emit('init', { id: socket.id, state: publicState(socket.id), caps: CAPS, ...(account ? { account: accountView(account) } : {}) });
      broadcastState(io, gameState);
      return p;
    };

    socket.on('join', (msg: any) => {
      const { name: typedName, lotScale, careerFocus, shopSpecialty } = (msg && typeof msg === 'object' ? msg : {}) as any;
      // "Name#key": what follows the first '#' is a tester key and never part of anyone's name, on any join
      const typed = splitTesterName(typedName);
      const name = typeof typedName === 'string' && typedName.includes('#') ? typed.name : typedName;
      // Tester mode: a plain guest join (never a session, an account or a dealer) that carries the server's tester key,
      // on its own field or after the name. A key that is not taken refuses the join before anything changes, and says
      // why; the entry card then offers the ordinary guest join. Anything too short to be a key is not a try at one.
      let tester = false;
      if (msg?.mode === 'guest' && typeof msg.session !== 'string') {
          const key = typeof msg.testerKey === 'string' ? msg.testerKey : typed.key;
          if (isKeyAttempt(key)) {
              const verdict = checkTesterKey(key, TESTER_KEY, testerAttempts, clientIp(socket.handshake.headers as any, socket.handshake.address), Date.now());
              if (verdict.ok) tester = true;
              else {
                  console.log('--- TESTER KEY REFUSED ---', { why: verdict.why });
                  socket.emit('join_refused', { why: verdict.why, reason: refusalText(verdict) });
                  return;
              }
          }
      }
      // a re-join on the same socket replaces its player: save an account holder's progress first
      const prior = gameState.players[socket.id];
      if (prior?.accountId) persistAccount(prior);
      if (prior) resetSocketState(socket.id); // no event entry, driven car or cooldown of the old run carries over
      if (msg?.mode === 'guest' || typeof msg?.session === 'string') {
          // A session that is invalid, expired, unknown or already live elsewhere falls back to a guest
          // (no refusal): the init carries no account, so the client clears its token.
          let account: Account | undefined;
          let lost = false; // a good session for an account this server does not have (a wiped save file)
          const secret = process.env.MAGIC_SECRET;
          if (typeof msg.session === 'string' && secret) {
              const id = verifySession(msg.session, Date.now(), secret);
              const a = id ? gameState.accounts[id] : undefined;
              if (id && !a) lost = true;
              if (a) {
                  // a session for an account still live on another socket (a dropped transport not yet noticed) supersedes it
                  const oldId = liveHolder(a.id, gameState.players, socket.id);
                  if (oldId) {
                      persistAccount(gameState.players[oldId]);
                      delete gameState.players[oldId];
                      resetSocketState(oldId);
                      lastLinkAt.delete(oldId);
                      if (gameState.hostId === oldId) gameState.hostId = pickHost(gameState.players);
                      io.sockets.sockets.get(oldId)?.disconnect(true);
                  }
                  account = a;
              }
          }
          // a visitor never runs the day: a host re-joining as one hands it on
          if (gameState.hostId === socket.id) gameState.hostId = pickHost(gameState.players, socket.id);
          const p = spawnVisitor(name, account, tester);
          if (lost) deny('Your saved account was not found on this server');
          console.log('--- VISITOR JOIN ---', { account: !!account, tester });
          pushChat(io, { id: `${Date.now()}-j`, playerId: '', name: 'System', text: `${p.name} entered the world`, ts: Date.now(), system: true });
          return;
      }
      console.log('--- PLAYER JOIN ---', { name, lotScale, careerFocus, shopSpecialty });
      // only a dealer or shop runs the day: a visitor never claims host
      if (hostIsVacant(gameState.hostId, gameState.players)) {
          gameState.hostId = socket.id;
      }
      // Take the first lot slot no current player holds. (Using the player count
      // gave a newcomer the lot of someone still here once anyone had left.)
      const takenLots = new Set(Object.values(gameState.players).filter(p => !isVisitor(p)).map(p => `${p.lotPosition?.x},${p.lotPosition?.z}`)); // a visitor holds no lot
      let slot = 0;
      while (takenLots.has(`${(slot % 5) * 250},${Math.floor(slot / 5) * -250}`)) slot++;
      let x = (slot % 5) * 250;
      let z = Math.floor(slot / 5) * -250;

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
        // the Strip career (Night Tuner): a fresh record, no Octane, no stamps
        strip: freshStrip(),
        octane: 0,
        stamps: [],
        // Standalone properties
        isStandaloneOperator: isStandalone,
        shopSpecialty: isStandalone ? (shopSpecialty || 'dual') : undefined
      } as any;
      if (process.env.SMOKE === '1') grantStarterCar(gameState.players[socket.id]);
      socket.emit('init', { id: socket.id, state: publicState(socket.id), caps: CAPS });
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
            car.lotPosition = dropOffSpot(player.lotPosition, unparkedCount);
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
            car.lotPosition = dropOffSpot(player.lotPosition, unparkedCount);
            player.inventory.push(car);
            gameState.market.splice(carIndex, 1);
            broadcastState(io, gameState);
        }
    }
  });

  socket.on('sync_car_pos', ({ carId, position, district }) => {
     const player = gameState.players[socket.id];
     if (!player) return;
     const car = player.inventory.find(c => c.id === carId);
     if (!car) return;
     drivenCar.set(socket.id, car.id);
     const d = district === 'strip' ? 'strip' : 'town';
     car.district = d;
     // lotPosition is the car's town spot: Strip coordinates never overwrite it
     if (d === 'strip') return;
     const clean = sanitizePosition(position);
     if (clean) car.lotPosition = clean as any;
  });

  // A town position, or (district 'strip') a pose in the Strip: that goes to stripPositions and the
  // town position becomes the gate spot, so the town still sees the player at the gate.
  const samePos = (a: any, b: any) => !!a && !!b && a.x === b.x && a.y === b.y && a.z === b.z && a.r === b.r && a.rotation === b.rotation && a.district === b.district;
  socket.on('sync_player_pos', (pos) => {
      const player = gameState.players[socket.id];
      const clean = sanitizePosition(pos);
      if (!player || !clean) return;
      const district = pos.district === 'strip' ? 'strip' : 'town';
      if (district === 'town' && player.guest) { socket.emit('strip_denied', { reason: 'The Dealership is for account holders with a car of their own.' }); return; }
      clean.district = district; // relayed in player_positions
      const prev: any = player.worldPosition;
      if (district === 'strip' && prev?.district !== 'strip') lastOutrunAt.set(socket.id, Date.now()); // entering the Strip starts the outrun clock
      if (district !== 'strip' && prev?.district === 'strip') { // leaving the Strip abandons any event
          const e = activeEvents.get(socket.id);
          activeEvents.delete(socket.id);
          if (e && endEvent(socket.id, e.carId)) broadcastState(io, gameState);
      }
      if (district === 'strip') {
          if (!samePos(stripPositions.get(socket.id), clean)) positionsDirty = true;
          stripPositions.set(socket.id, clean);
          const gate = { x: GATE_RETURN.x, y: 0, z: GATE_RETURN.z, rotation: GATE_RETURN.rotY, district: 'strip' };
          if (!samePos(prev, gate)) { player.worldPosition = gate as any; positionsDirty = true; }
          return;
      }
      stripPositions.delete(socket.id);
      if (!samePos(prev, clean)) positionsDirty = true; // only a real move needs relaying
      player.worldPosition = clean as any;
  });

  // --- Fuel ---------------------------------------------------------
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

  // --- The Strip: events, outruns, parts and tunes --------------------------
  // Driving is simulated client-side; the server keeps the money and the record.
  // A run is paid only against a live entry (enter_event), at the stage and style of
  // the player's stored record and build, never figures from the client.
  const stripOf = (player: Player) => ensureStrip(player).strip!;
  const ownsCar = (player: Player, carId: unknown): carId is string => typeof carId === 'string' && player.inventory.some(c => c.id === carId);

  socket.on('enter_event', ({ eventId } = {} as any) => {
      const player = gameState.players[socket.id];
      if (!player) return;
      const ev = EVENTS.find(e => e.id === eventId);
      if (!ev) { activeEvents.delete(socket.id); return; }
      const ok = validateEnter(player.worldPosition?.district, ev, stageOf(stripOf(player).rep));
      if (!ok.ok) { activeEvents.delete(socket.id); deny(ok.reason === 'not in the Strip' ? 'Events are raced inside the Strip.' : ok.reason); return; }
      activeEvents.set(socket.id, { eventId: ev.id, startedAt: Date.now(), carId: drivenCar.get(socket.id) }); // the car is locked for the style bonus
  });

  socket.on('finish_event', (msg: any) => {
      const player = gameState.players[socket.id];
      if (!player || !msg || typeof msg !== 'object') return;
      const entry = activeEvents.get(socket.id);
      const now = Date.now();
      const v = validateFinish(entry, { eventId: msg.eventId, pos: msg.pos, time: msg.time ?? null, score: Number(msg.score) || 0, failed: !!msg.failed }, now, lastPaidAt.get(socket.id));
      activeEvents.delete(socket.id); // an entry is answered once, paid or refused
      if (!v.ok) {
          console.log('finish_event refused:', socket.id, v.reason);
          deny('That run could not be verified, so it paid nothing.');
          if (entry && endEvent(socket.id, entry.carId)) broadcastState(io, gameState); // the event is over either way
          return;
      }
      const ev = EVENTS.find(e => e.id === entry!.eventId)!;
      const r = applyPayout(player, ev, v.pos, !!msg.failed, { time: msg.time, carId: entry!.carId });
      if (r.cash || r.octane || r.rep) lastPaidAt.set(socket.id, now);
      endEvent(socket.id, entry!.carId); // after the payout: the style bonus read the rental's build
      persistAccount(player);
      socket.emit('event_result', r);
      broadcastState(io, gameState);
  });

  // A live event abandoned without results (R, leaving the Strip): drop the entry, pay nothing.
  // A restart (restart: true) clears the entry but keeps the rental for the enter_event that follows.
  socket.on('quit_event', ({ eventId, restart } = {} as any) => {
      const player = gameState.players[socket.id];
      const e = activeEvents.get(socket.id);
      if (player && e && e.eventId === eventId) {
          activeEvents.delete(socket.id);
          const { returned } = quitEvent(player, e.carId, restart === true);
          if (returned) { drivenCar.delete(socket.id); broadcastState(io, gameState); }
      }
  });

  const liveEntry = (now: number) => { const e = activeEvents.get(socket.id); return !!e && now - e.startedAt <= ENTRY_TTL_MS; };

  socket.on('finish_outrun', ({ won } = {} as any) => {
      const player = gameState.players[socket.id];
      if (!player) return;
      const now = Date.now();
      // An outrun (won or lost) ends the run in a rental, unless it happened inside a live event.
      const returned = !liveEntry(now) && endEvent(socket.id, drivenCar.get(socket.id));
      if (won !== true) { if (returned) broadcastState(io, gameState); return; } // a lost outrun pays nothing: nothing to verify or refuse
      const v = player.worldPosition?.district === 'strip' ? validateOutrun(lastOutrunAt.get(socket.id), now, liveEntry(now)) : { ok: false as const, reason: 'not in the Strip' };
      if (!v.ok) { console.log('finish_outrun refused:', socket.id, v.reason); deny('That outrun could not be verified, so it paid nothing.'); if (returned) broadcastState(io, gameState); return; }
      lastOutrunAt.set(socket.id, now);
      const r = applyPayout(player, outrunEvent(stageOf(stripOf(player).rep)), 1, false);
      persistAccount(player);
      socket.emit('event_result', r);
      if (r.cash || r.rep || returned) broadcastState(io, gameState);
  });

  socket.on('strip_buy_part', ({ carId, key, v, price } = {} as any) => {
      const player = gameState.players[socket.id];
      if (!player) return;
      if (!ownsCar(player, carId) || typeof key !== 'string' || (typeof v !== 'string' && typeof v !== 'number')) { deny('That part is not for sale.'); broadcastState(io, gameState); return; }
      if (!dealerCar(player, carId)) { broadcastState(io, gameState); return; } // a rental stays stock
      const rec = stripOf(player), c = carState(rec, carId);
      const q = partPrice(key, v as PartValue, stageOf(rec.rep));
      if (!q.ok) { deny(q.reason); broadcastState(io, gameState); return; }
      if (!isOwned(c.cfg, c.owned, key, v)) { // owned already (bought, fitted or free): no charge, just fit it
          if (price !== q.price) { deny('The price changed. Try again.'); broadcastState(io, gameState); return; }
          if (player.money < q.price) { deny('Not enough cash for that part.'); broadcastState(io, gameState); return; }
          player.money -= q.price;
          player.balanceSheet.totalExpenses += q.price;
          player.balanceSheet.lastTickExpense += q.price;
      }
      const o = okey(key, v);
      if (!c.owned.includes(o)) c.owned.push(o);
      c.cfg = withV(c.cfg, key, v);
      persistAccount(player);
      broadcastState(io, gameState);
  });

  socket.on('strip_equip', ({ carId, key, v } = {} as any) => {
      const player = gameState.players[socket.id];
      if (!player) return;
      if (!ownsCar(player, carId) || typeof key !== 'string' || (typeof v !== 'string' && typeof v !== 'number')) return;
      if (!dealerCar(player, carId)) { broadcastState(io, gameState); return; } // a rental stays stock
      const rec = stripOf(player), c = carState(rec, carId);
      // only a part the car owns, or a free one in the catalog (isOwned: free, fitted, or bought)
      const q = partPrice(key, v, stageOf(rec.rep)); // the stage applies to free parts too
      if (!q.ok) { deny(q.reason); broadcastState(io, gameState); return; }
      if (!isOwned(c.cfg, c.owned, key, v)) { deny('Buy that part first.'); broadcastState(io, gameState); return; }
      if (getV(c.cfg, key) === v) return;
      c.cfg = withV(c.cfg, key, v);
      persistAccount(player);
      broadcastState(io, gameState);
  });

  socket.on('strip_tune', ({ carId, tune } = {} as any) => {
      const player = gameState.players[socket.id];
      if (!player) return;
      if (!ownsCar(player, carId)) return;
      if (!dealerCar(player, carId)) { broadcastState(io, gameState); return; } // a rental stays stock
      carState(stripOf(player), carId).tune = clampTune(tune);
      persistAccount(player, false); // tunes stream from the dyno: the 15 s autosave writes them
      broadcastState(io, gameState);
  });

  let orderSeq = 0;
  socket.on('bay_order', (msg: any) => {
      const { carId, door, lines, quote } = msg && typeof msg === 'object' ? msg : {} as any;
      const player = gameState.players[socket.id];
      if (!player) return;
      const bad = () => { deny('That order is not valid.'); broadcastState(io, gameState); };
      if (!ownsCar(player, carId) || !(DOORS as readonly unknown[]).includes(door) || !Array.isArray(lines) || !lines.length || !lines.every(isOrderLine)) { bad(); return; }
      const car = dealerCar(player, carId);
      if (!car) { broadcastState(io, gameState); return; } // a rental stays stock
      const rec = stripOf(player), c = carState(rec, carId);
      const ctx: OrderCtx = { car, build: c, style: 'sedan', stage: stageOf(rec.rep), partsInventory: player.partsInventory, hasMechanic: !!player.employees?.mechanic };
      const q = quoteOrder(ctx, lines);
      const refused = q.lines.find(l => l.status !== 'ok');
      if (refused) { deny(refused.reason ?? 'That order is not valid.'); broadcastState(io, gameState); return; }
      if (quote !== q.total) { deny('The price changed. Try again.'); broadcastState(io, gameState); return; }
      if (player.money < q.total) { deny('Not enough cash for this order.'); broadcastState(io, gameState); return; }
      const result = applyOrder(ctx, lines, Math.random);
      player.money -= result.total;
      player.balanceSheet.totalExpenses += result.total;
      player.balanceSheet.lastTickExpense += result.total;
      const order: WorkOrder = { ...result, id: 'wo-' + Date.now() + '-' + orderSeq++, carId, car: `${car.year} ${car.make} ${car.model}`, door: door as WorkOrder['door'], day: gameState.day };
      player.orders = [order, ...(player.orders ?? [])].slice(0, 30);
      persistAccount(player);
      socket.emit('bay_result', { order });
      broadcastState(io, gameState);
  });

  // --- Rentals and accounts -------------------------------------------------
  // The server owns the money, the date and the identity: nothing here takes them from the client.
  socket.on('rent_car', ({ key } = {} as any) => {
      const player = gameState.players[socket.id];
      if (!player) return;
      if (!RENTAL_FLEET.some(f => f.key === key)) { deny('That car is not for rent.'); return; }
      const ok = canRent(player, key as RentalKey);
      if (!ok.ok) { deny(ok.reason); return; }
      rent(player, key as RentalKey, Date.now());
      broadcastState(io, gameState);
  });

  // A tester's car: any model on the list, owned for the session (kept across events, open to the Garage), one at a
  // time. Only a tester gets one; like every visitor's car it can never be sold, borrowed against or scrapped.
  socket.on('test_car', ({ make, model } = {} as any) => {
      const player = gameState.players[socket.id];
      if (!player) return;
      if (!player.tester) { deny('That car is not for rent.'); return; }
      const def = testCarDef(make, model);
      if (!def) { deny('That car is not on the list.'); return; }
      if (activeEvents.has(socket.id)) { deny('Finish or quit the event first.'); return; }
      setTestCar(player, def, Date.now());
      drivenCar.delete(socket.id);
      broadcastState(io, gameState);
  });
  socket.on('test_car_return', () => {
      const player = gameState.players[socket.id];
      if (!player?.tester || !heldTestCar(player)) return;
      if (activeEvents.has(socket.id)) { deny('Finish or quit the event first.'); return; }
      returnTestCar(player);
      drivenCar.delete(socket.id);
      broadcastState(io, gameState);
  });

  socket.on('request_link', async ({ email } = {} as any) => {
      const player = gameState.players[socket.id];
      if (!player) return;
      // only a guest makes an account (and only once): nobody else has a reason to send a sign-in email
      if (player.accountId) { deny('already signed in'); return; }
      if (!player.guest) { deny('Accounts are made from the Strip for now'); return; }
      if (player.tester) { deny(TESTER_NO_ACCOUNT); return; }
      const now = Date.now();
      const last = lastLinkAt.get(socket.id);
      if (last !== undefined && now - last < LINK_COOLDOWN_MS) { deny('Try again in a minute'); return; }
      lastLinkAt.set(socket.id, now);
      const addr = typeof email === 'string' ? email.trim().toLowerCase() : '';
      const valid = addr.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(addr);
      if (valid) {
          pruneUsedMagic(now);
          if (lastLinkTo.has(addr)) { deny('Try again in a minute'); return; }
          lastLinkTo.set(addr, now);
      }
      if (valid && CAPS.magic) {
          const room = allowSend(linkSends, clientIp(socket.handshake.headers as any, socket.handshake.address), now);
          if (!room.ok) { deny(room.reason); return; }
          if (await sendMagicEmail(addr, linkOrigin(socket.handshake.headers as any))) {
              // the click signs in this guest, wherever the link is opened (while this tab is still here)
              linkRequests.set(addr, { socketId: socket.id, at: now });
              socket.emit('link_sent', {});
              return;
          }
      }
      deny("Couldn't send the link — try Google or try again in a minute");
  });

  socket.on('link_account', async (msg: any) => {
      const { google, magic, confirmReplace, target: choice } = (msg && typeof msg === 'object' ? msg : {}) as any;
      const clicker = gameState.players[socket.id];
      if (!clicker) return;
      if (clicker.accountId) { deny('already signed in'); return; }
      // accounts are made from the Strip only for now: a dealer's join cash is not carried into one
      // (checked before any token is read, so a magic link stays unspent)
      if (!clicker.guest) { deny('Accounts are made from the Strip for now'); return; }
      if (clicker.tester) { deny(TESTER_NO_ACCOUNT); return; } // a tester's money and cars are not a record to keep
      let identity: Identity | undefined;
      let magicToken: string | undefined;
      if (typeof google === 'string' && google) {
          identity = await verifyGoogleToken(google);
          if (!identity) { deny('Sign-in failed'); return; }
      } else if (typeof magic === 'string' && magic) {
          const secret = process.env.MAGIC_SECRET;
          if (!secret) { deny('Sign-in failed'); return; }
          const now = Date.now();
          pruneUsedMagic(now);
          const addr = verifyMagic(magic, now, secret, usedMagic);
          if (!addr) { deny('That link has expired or was already used'); return; }
          usedMagicUntil.set(magic, now + MAGIC_TTL_MS);
          magicToken = magic;
          identity = { kind: 'email', email: addr };
      } else { deny('Sign-in failed'); return; }
      // the socket may have left or re-joined while Google's keys were fetched
      if (gameState.players[socket.id] !== clicker || clicker.accountId || !clicker.guest || clicker.tester) return;
      // A magic link opened in another tab (or device) than the guest tab that asked for it: the clicking tab proved it
      // controls the address, so it chooses where the sign-in lands (link_choice), never the asking tab silently. The
      // choice step spends nothing: the same link is resent with target 'requester' or 'here'.
      let targetId = socket.id;
      if (identity.kind === 'email') {
          const req = linkRequests.get(identity.email);
          const reqPlayer = req ? gameState.players[req.socketId] : undefined;
          const pick = choice === 'requester' || choice === 'here' ? choice : undefined;
          const who = linkTarget(req && { socketId: req.socketId, connected: io.sockets.sockets.has(req.socketId), guest: !!reqPlayer?.guest && !reqPlayer.accountId && !reqPlayer.tester }, socket.id, pick);
          if (who.to === 'choose') {
              if (magicToken) { usedMagic.delete(magicToken); usedMagicUntil.delete(magicToken); }
              socket.emit('link_choice', { email: identity.email, requester: true });
              return;
          }
          if (who.to === 'requester') targetId = req!.socketId;
          if (who.fellBack) deny('The game tab that asked is gone — signing in here instead');
      }
      const player = gameState.players[targetId];
      const target = io.sockets.sockets.get(targetId)!;
      const elsewhere = targetId !== socket.id;
      const existing = findAccount(gameState.accounts, identity);
      // Refusals and the prompt change nothing, so the same magic link stays good (until it expires) for a retry.
      const unspend = () => { if (magicToken) { usedMagic.delete(magicToken); usedMagicUntil.delete(magicToken); } };
      if (existing && !attachAccount(existing.id, Object.values(gameState.players)).ok) { unspend(); deny('already signed in'); return; }
      // a guest who has done nothing yet loses nothing: no prompt
      if (existing && confirmReplace !== true && !isUntouchedGuest(player)) {
          unspend();
          // the prompt goes to the tab being signed in; the link comes with it so its Confirm can resend it from there
          target.emit('account_replace_prompt', { money: player.money, ...(elsewhere && magicToken ? { magic: magicToken } : {}) });
          if (elsewhere) socket.emit('account_linked_elsewhere', {});
          return;
      }
      const { account, replaced } = linkGuest(gameState.accounts, identity, player, Date.now());
      if (replaced) { // the guest's run (and any rental it held) is set aside for the saved one
          applyRecord(player, structuredClone(account.player));
          explainAll(player);
          drivenCar.delete(targetId);
          activeEvents.delete(targetId);
      }
      player.accountId = account.id;
      player.guest = false;
      if (identity.kind === 'email') linkRequests.delete(identity.email);
      persistAccount(player);
      console.log('account linked:', targetId, identity.kind, replaced ? 'existing' : 'new', elsewhere ? '(from another tab)' : '');
      const session = issueSession(account.id);
      target.emit('account_linked', { account: accountView(account), session, replaced });
      // this tab proved the address too: it may carry on here instead (a join with the session supersedes the game tab)
      if (elsewhere) socket.emit('account_linked_elsewhere', { session });
      broadcastState(io, gameState);
  });

  socket.on('claim_allowance', () => {
      const player = gameState.players[socket.id];
      if (!player) return;
      const account = player.accountId ? gameState.accounts[player.accountId] : undefined;
      if (!account) { deny('Not signed in'); return; }
      persistAccount(player, false); // the record matches the live player before the allowance is added
      const r = claimAllowance(account, Date.now());
      if (!r.ok) { deny(r.reason); return; }
      player.money += r.amount;
      persistAccount(player);
      broadcastState(io, gameState);
      socket.emit('account_linked', { account: accountView(account), session: issueSession(account.id), replaced: false });
  });

  socket.on('sign_out', () => {
      const player = gameState.players[socket.id];
      if (!player) return;
      if (!player.accountId) { deny('Not signed in'); return; }
      persistAccount(player);
      resetSocketState(socket.id);
      spawnVisitor(player.name); // a guest again, under the same name
  });
  socket.on('wash_car', (carId) => {
     const player = gameState.players[socket.id];
     if (!player) return;
     const car = dealerCar(player, carId);
     if (car) {
         car.isDirty = false;
         broadcastState(io, gameState);
     }
  });

  socket.on('place_on_lot', (carId) => {
     const player = gameState.players[socket.id];
     if (!player) return;
     const car = dealerCar(player, carId);
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
      const car = dealerCar(player, carId);
      
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
      if (carIndex === -1 || !dealerCar(player, carId)) return;
      
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
          const tradedIn: Car = {
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
              lotPosition: dropOffSpot(player.lotPosition, unparkedCount)
          };
          explainCar(tradedIn);
          player.inventory.push(tradedIn);
      }

      let cashProceeds = 0;
      if (dealType === 'cash') cashProceeds = proposal.downPayment; // For cash, downPayment is full price
      else if (dealType === 'bank') {
          // (salvage is already rejected at the top of finalize_deal)
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
      const car = dealerCar(player, carId);
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
      const car = dealerCar(player, carId);
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

  socket.on('buy_part', (msg: any) => {
      const player = gameState.players[socket.id], partName = msg?.partName;
      if (!player || typeof partName !== 'string') return;
      // the job is found by part name, or by fault name for a page loaded before the deploy; the price is the server's
      const job = repairJobFor(partName) ?? REPAIR_JOBS.find(j => j.n === partName);
      if (!job) return;
      const cost = Math.floor(job.cost * 0.75);
      if (player.money < cost) return;
      player.money -= cost;
      player.balanceSheet.totalExpenses += cost;
      player.balanceSheet.lastTickExpense += cost;
      player.partsInventory[job.partName] = (player.partsInventory[job.partName] || 0) + 1;
      broadcastState(io, gameState);
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
          car.lotPosition = dropOffSpot(player.lotPosition, unparkedCount);
          player.inventory.push(car);
          gameState.junkyard.splice(index, 1);
          broadcastState(io, gameState);
      }
  });

  socket.on('scrap_car', (carId) => {
      const player = gameState.players[socket.id];
      if (!player) return;
      
      const carIndex = player.inventory.findIndex(c => c.id === carId);
      if (carIndex === -1 || !dealerCar(player, carId)) return;
      
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
      const car = dealerCar(player, carId);
      if (car && !car.isLienActive && !car.isProcessed) {
          // Calculate max collateral value precisely as 80% LTV of extrapolated retail!
          const mechanicImpact = car.mechanicCondition / 100;
          const bodyImpact = car.bodyCondition / 100;
          const accidentPenalty = (car.accidents || 0) > 0 ? 0.70 : 1.0;
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
      const car = dealerCar(player, carId);
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
      const car = dealerCar(player, carId);
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
      const car = dealerCar(player, carId);
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
      if (idx === -1 || !dealerCar(player, carId)) return;
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

  socket.on('buy_insurance', ({ type }: { type: 'liability' | 'inventory' | 'gap' }) => {
      const player = gameState.players[socket.id];
      if (!player) return;
      if (!player.insurance) player.insurance = { liability: false, inventory: false, gap: false };
      if (type === 'liability' || type === 'inventory' || type === 'gap') {
          player.insurance[type] = true;
          broadcastState(io, gameState);
      }
  });

  socket.on('cancel_insurance', ({ type }: { type: 'liability' | 'inventory' | 'gap' }) => {
      const player = gameState.players[socket.id];
      if (!player || !player.insurance) return;
      if (type === 'liability' || type === 'inventory' || type === 'gap') {
          player.insurance[type] = false;
          broadcastState(io, gameState);
      }
  });

  socket.on('disconnect', () => {
    const gone = gameState.players[socket.id];
    if (gone?.accountId) persistAccount(gone);
    lastLinkAt.delete(socket.id);
    resetSocketState(socket.id);
    const leaving = gameState.players[socket.id];
    delete gameState.players[socket.id];
    if (gameState.hostId === socket.id) gameState.hostId = pickHost(gameState.players); // a dealer, never a visitor
    if (leaving) {
        pushChat(io, { id: `${Date.now()}-l`, playerId: '', name: 'System', text: `${leaving.name} left the world`, ts: Date.now(), system: true });
    }
    broadcastState(io, gameState);
  });
});

async function startServer() {
    // the track files the client is served: public/ under Vite in development, the build's copy in production
    const built = path.join(process.cwd(), 'dist', 'strip', 'tracks'), pub = path.join(process.cwd(), 'public', 'strip', 'tracks');
    setTrackDir(process.env.NODE_ENV === 'production' && existsSync(built) ? built : pub);
    for (const t of TRACKS) readTrackSync(t.id);
    await loadGameState();

    // What the Strip entry card may offer before anyone has joined (init.caps arrives too late for it)
    app.get('/api/caps', (_req, res) => { res.set('Cache-Control', 'no-store'); res.json(CAPS); });

    if (process.env.NODE_ENV !== 'production') {
        const { createServer: createViteServer } = await import('vite');
        const vite = await createViteServer({ server: { middlewareMode: true }, appType: 'spa' });
        app.use(vite.middlewares);
    } else {
        const distDir = path.join(process.cwd(), 'dist');
        app.use(express.static(distDir));
        // A missing build file (e.g. a chunk from before the last deploy) is a 404.
        // Answering with index.html instead made the browser reject it as a script
        // with a confusing MIME-type error.
        app.use('/assets', (_req, res) => { res.sendStatus(404); });
        // SPA fallback: serve index.html for any non-asset route so refreshes /
        // deep links don't 404. (socket.io traffic is handled before Express.)
        app.get('*', (_req, res) => {
            res.sendFile(path.join(distDir, 'index.html'));
        });
    }

    const port = process.env.PORT || 3000;
    httpServer.listen(Number(port), '0.0.0.0', () => {
        // the bound port (PORT=0 picks a free one: the wiring test reads it from this line)
        console.log(`Server running on port ${(httpServer.address() as AddressInfo).port} with Economic Floor Plan Engine`);
    });
}

startServer();
