import type { Car, Player } from '../types';
import { freshStrip } from './data';
import { GUEST_STAKE, RENTAL_BAY, heldRental, isVisitor, returnRental } from './rental';

/** An event (or outrun) ended: if it was driven in the player's rental, the rental goes back. */
export function closeEvent(player: Player, carId: string | undefined): { returned: Car | undefined } {
  const rental = heldRental(player);
  if (!carId || !rental || rental.id !== carId) return { returned: undefined };
  if (player.strip) delete player.strip.cars[rental.id]; // no part record outlives the car
  return { returned: returnRental(player) };
}

/** A live event abandoned: a restart keeps the rental for the next entry; a plain quit returns it. */
export function quitEvent(player: Player, carId: string | undefined, restart: boolean): { returned: Car | undefined } {
  return restart ? { returned: undefined } : closeEvent(player, carId);
}

/** A visitor with no account: the guest stake, no lot of their own, standing at the rental bay in the Strip. */
export function guestPlayer(id: string, name: string, _now: number): Player {
  return {
    id,
    name: name || `Guest_${id.substring(0, 4)}`,
    guest: true,
    money: GUEST_STAKE,
    inventory: [],
    lotPosition: { x: 0, z: 0 },
    worldPosition: { x: RENTAL_BAY.x * 2, y: 0, z: RENTAL_BAY.z * 2, rotation: 0, district: 'strip' },
    lotScale: 'Small',
    marketingTier: 'Craigslist',
    floorPlanDebt: 0,
    floorPlanRate: 0.005,
    contracts: [],
    customers: [],
    employees: { mechanic: false, salesperson: false, financeManager: false },
    partsInventory: {},
    reputation: 0,
    balanceSheet: { totalIncome: 0, totalExpenses: 0, lastTickIncome: 0, lastTickExpense: 0 },
    shareHoldings: {},
    insurance: { liability: false, inventory: false, gap: false },
    insuranceLog: [],
    strip: freshStrip(),
    octane: 0,
    stamps: [],
    isStandaloneOperator: false,
  };
}

/** The only socket events a Strip visitor (a guest or a Strip account holder) may send; the server answers anything
 *  else with strip_denied. Joining, chat, the Strip's position, car, fuel and event sync, the parts bench, the rental
 *  counter and the account. */
export const VISITOR_EVENTS: ReadonlySet<string> = new Set([
  'join', 'chat_message',
  'sync_player_pos', 'sync_car_pos', 'consume_fuel', 'refuel',
  'enter_event', 'finish_event', 'finish_outrun', 'quit_event',
  'strip_buy_part', 'strip_equip', 'strip_tune',
  'rent_car', 'request_link', 'link_account', 'claim_allowance', 'sign_out',
]);
export const VISITOR_DENIED = 'Not available in the Strip';

/** A refusal for a rental car in any handler that would tune, sell, borrow against or otherwise monetise it. */
export const RENTAL_DENIED = 'A rental is for racing one event only';

/** Who runs the day: the first dealer or shop still here (never a visitor), else nobody. */
export function pickHost(players: Record<string, Pick<Player, 'guest' | 'accountId'>>, exceptId?: string): string | null {
  return Object.keys(players).find(id => id !== exceptId && !isVisitor(players[id])) ?? null;
}

/** A joining dealer takes the host when there is none, or the host is gone or is a visitor. */
export function hostIsVacant(hostId: string | null | undefined, players: Record<string, Pick<Player, 'guest' | 'accountId'>>): boolean {
  return !hostId || !players[hostId] || isVisitor(players[hostId]);
}

/** A guest who has done nothing yet: the stake untouched, no rental, no stamps, no Octane, no REP. Signing them in to a
 *  saved account loses nothing, so it needs no replace prompt. */
export function isUntouchedGuest(p: Player): boolean {
  return !!p.guest && p.money === GUEST_STAKE && !heldRental(p) && (p.stamps?.length ?? 0) === 0 && (p.octane ?? 0) === 0 && (p.strip?.rep ?? 0) === 0;
}

/** Which player a clicked magic link signs in. The clicking tab proved it controls the address, so only it decides, and
 *  never silently for another tab: when a different guest tab (still connected, still a guest) asked for the link and the
 *  clicker has not chosen, the answer is 'choose' (ask the clicker). 'requester' only when the clicker chose it and that
 *  tab is still valid; otherwise the clicker's own guest. `fellBack`: the clicker chose the requester but it is gone. */
export function linkTarget(
  requester: { socketId: string; connected: boolean; guest: boolean } | undefined,
  clickerId: string,
  choice?: 'requester' | 'here',
): { to: 'choose' | 'requester' | 'clicker'; fellBack: boolean } {
  const valid = !!requester && requester.connected && requester.guest && requester.socketId !== clickerId;
  if (valid && choice === undefined) return { to: 'choose', fellBack: false };
  if (valid && choice === 'requester') return { to: 'requester', fellBack: false };
  return { to: 'clicker', fellBack: choice === 'requester' && requester?.socketId !== clickerId };
}
