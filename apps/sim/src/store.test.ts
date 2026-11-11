import { describe, it, expect } from 'vitest';
import { useGameStore } from './store';
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
