// The two example cards from the product brief. Their seven values are illustrative placeholders typed in by hand:
// they are not verified manufacturer data and they do not come from a specification. The GT-R NISMO's are the ones
// the brief gave; the Civic's are set to show a standard car against a supercar: lower in the four performance
// attributes, higher in reliability and efficiency. Cards built from these are stamped as examples.
import type { ExampleVehicle } from '../types';

const NOTE = 'Illustrative placeholder values, not verified manufacturer data.';

export const EXAMPLE_DATA: readonly ExampleVehicle[] = [
  {
    id: 'example-nissan-gt-r-nismo',
    identity: { year: 2024, make: 'Nissan', model: 'GT-R', trim: 'NISMO', bodyClass: 'sports' },
    attributes: { power: 950, speed: 920, acceleration: 880, handling: 880, durability: 650, reliability: 700, efficiency: 500 },
    note: NOTE,
  },
  {
    id: 'example-honda-civic',
    identity: { year: 2024, make: 'Honda', model: 'Civic', trim: 'Sedan LX', bodyClass: 'sedan' },
    attributes: { power: 400, speed: 570, acceleration: 370, handling: 560, durability: 640, reliability: 860, efficiency: 720 },
    note: NOTE,
  },
];
