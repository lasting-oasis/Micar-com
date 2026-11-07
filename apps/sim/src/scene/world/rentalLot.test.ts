import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { buildRentalLot } from './rentalLot';
import { STRIP_EXIT } from './gate';
import { RENTAL_KIOSK } from '../../world/rental';
import { HUB } from '../../world/strip/district';
import { WORLD_PER_M as W } from '../../world/units';

describe('rental lot and gate', () => {
  it('puts the kiosk at HUB.rental.kiosk', () => {
    const lot = buildRentalLot();
    lot.group.updateMatrixWorld(true);
    const p = new THREE.Vector3();
    const near = lot.group.children.some(c => { c.getWorldPosition(p); return Math.hypot(p.x - RENTAL_KIOSK.x * W, p.z - RENTAL_KIOSK.z * W) < W; });
    expect(near).toBe(true);
    lot.dispose();
  });
  it('the exit ring is the hub exit', () => {
    expect(STRIP_EXIT).toEqual({ x: HUB.exit.x, z: HUB.exit.z, r: HUB.exit.r });
  });
});
