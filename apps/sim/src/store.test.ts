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
});
