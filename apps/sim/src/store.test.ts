import { describe, it, expect, vi, afterEach } from 'vitest';
import { useGameStore, ORDER_TIMEOUT_MS, accountChanged } from './store';
import type { GameState } from './types';

describe('openGarage', () => {
  const withCars = (cars: { id: string; rental?: boolean }[]) =>
    useGameStore.setState({ playerId: 'p1', garageCarId: null, gameState: { players: { p1: { id: 'p1', inventory: cars } } } as unknown as GameState });
  it('never opens on a rental', () => {
    withCars([{ id: 'r1', rental: true }]);
    useGameStore.getState().openGarage('r1');
    expect(useGameStore.getState().garageCarId).toBeNull();
  });
  it('opens on a car of your own', () => {
    withCars([{ id: 'c1' }]);
    useGameStore.getState().openGarage('c1');
    expect(useGameStore.getState().garageCarId).toBe('c1');
  });
  it('the bay opens on the tab asked for, and on Custom when none is', () => {
    withCars([{ id: 'c1' }]);
    useGameStore.getState().openGarage('c1', 'body');
    expect(useGameStore.getState().bayTab).toBe('body');
    useGameStore.getState().openGarage('c1');
    expect(useGameStore.getState().bayTab).toBe('custom');
  });
});

describe('placeOrder', () => {
  const lines = [{ kind: 'repair' as const, repairId: 'f1' }];
  afterEach(() => { vi.useRealTimers(); useGameStore.setState({ socket: null, orderPending: false, lastOrder: null, bayTab: 'custom' }); });
  it('an order is sent once however often it is tapped', () => {
    const sent: unknown[][] = [];
    useGameStore.setState({ socket: { emit: (...a: unknown[]) => { sent.push(a); } } as never, orderPending: false });
    useGameStore.getState().placeOrder('c1', 'garage', lines, 250);
    useGameStore.getState().placeOrder('c1', 'garage', lines, 250);
    expect(sent).toEqual([['bay_order', { carId: 'c1', door: 'garage', lines, quote: 250 }]]);
    expect(useGameStore.getState().orderPending).toBe(true);
  });
  it('with no socket nothing is sent and nothing is pending', () => {
    useGameStore.setState({ socket: null, orderPending: false });
    useGameStore.getState().placeOrder('c1', 'garage', lines, 250);
    expect(useGameStore.getState().orderPending).toBe(false);
  });
});

describe('the bay leaves with the player', () => {
  const order = { id: 'o1' } as never;
  const dirty = () => useGameStore.setState({ socket: { emit: () => {}, disconnect: () => {} } as never, lastOrder: order, orderPending: true, bayTab: 'body' });
  const clean = () => { const st = useGameStore.getState(); expect([st.lastOrder, st.orderPending, st.bayTab]).toEqual([null, false, 'custom']); };
  afterEach(() => { useGameStore.setState({ socket: null, lastOrder: null, orderPending: false, bayTab: 'custom' }); });
  it('signOut clears the order, the pending flag and the tab', () => { dirty(); useGameStore.getState().signOut(); clean(); });
  it('disconnect clears the order, the pending flag and the tab', () => { dirty(); useGameStore.getState().disconnect(); clean(); });
});

describe('an unanswered order', () => {
  const lines = [{ kind: 'repair' as const, repairId: 'f1' }];
  const fake = () => useGameStore.setState({ socket: { emit: () => {} } as never, orderPending: false });
  afterEach(() => { vi.useRealTimers(); useGameStore.setState({ socket: null, orderPending: false }); });
  it('gives up after ten seconds', () => {
    vi.useFakeTimers(); fake();
    useGameStore.getState().placeOrder('c1', 'garage', lines, 1);
    vi.advanceTimersByTime(ORDER_TIMEOUT_MS - 100);
    expect(useGameStore.getState().orderPending).toBe(true);
    vi.advanceTimersByTime(100);
    expect(useGameStore.getState().orderPending).toBe(false);
  });
  it('the first order\'s timer never clears a later order', () => {
    vi.useFakeTimers(); fake();
    useGameStore.getState().placeOrder('c1', 'garage', lines, 1);
    vi.advanceTimersByTime(3000);
    useGameStore.setState({ orderPending: false }); // answered
    vi.advanceTimersByTime(2000);
    useGameStore.getState().placeOrder('c1', 'garage', lines, 1);
    vi.advanceTimersByTime(5000); // t = 10s: first timer's moment
    expect(useGameStore.getState().orderPending).toBe(true);
    vi.advanceTimersByTime(5000); // t = 15s
    expect(useGameStore.getState().orderPending).toBe(false);
  });
});

describe('accountChanged', () => {
  it('tells a new account from a reconnect', () => {
    expect(accountChanged(null, undefined)).toBe(false);
    expect(accountChanged(null, { id: 'a' })).toBe(true);
    expect(accountChanged({ id: 'a' }, null)).toBe(true);
    expect(accountChanged({ id: 'a' }, { id: 'a' })).toBe(false);
    expect(accountChanged({ id: 'a' }, { id: 'b' })).toBe(true);
  });
});
