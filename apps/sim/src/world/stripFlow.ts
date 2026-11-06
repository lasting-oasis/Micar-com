import type { Car, Player } from '../types';
import { freshStrip } from './data';
import { GUEST_STAKE, RENTAL_BAY, heldRental, returnRental } from './rental';

/** An event (or outrun) ended: if it was driven in the player's rental, the rental goes back. */
export function closeEvent(player: Player, carId: string | undefined): { returned: Car | undefined } {
  const rental = heldRental(player);
  if (!carId || !rental || rental.id !== carId) return { returned: undefined };
  return { returned: returnRental(player) };
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
