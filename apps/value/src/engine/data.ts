// Reference tables for the valuation engine.
// residual5 = share of MSRP a typical example keeps after five years.
// These are rule-of-thumb estimates, not live market data.

export type Make = {
  name: string;
  segment: 'Economy' | 'Mainstream' | 'Luxury' | 'Performance' | 'EV' | 'Truck' | 'Discontinued' | 'Average';
  /** Share of MSRP typically kept after 5 years (rule-of-thumb). */
  residual5: number;
};

export const MAKES: Make[] = [
  { name: 'Honda', segment: 'Economy', residual5: 0.62 },
  { name: 'Mazda', segment: 'Economy', residual5: 0.58 },
  { name: 'Subaru', segment: 'Economy', residual5: 0.6 },
  { name: 'Toyota', segment: 'Economy', residual5: 0.64 },
  { name: 'Buick', segment: 'Mainstream', residual5: 0.48 },
  { name: 'Chevrolet', segment: 'Mainstream', residual5: 0.5 },
  { name: 'Chrysler', segment: 'Mainstream', residual5: 0.45 },
  { name: 'Dodge', segment: 'Mainstream', residual5: 0.52 },
  { name: 'Ford', segment: 'Mainstream', residual5: 0.52 },
  { name: 'Hyundai', segment: 'Mainstream', residual5: 0.54 },
  { name: 'Jeep', segment: 'Mainstream', residual5: 0.55 },
  { name: 'Kia', segment: 'Mainstream', residual5: 0.55 },
  { name: 'Mini', segment: 'Mainstream', residual5: 0.49 },
  { name: 'Mitsubishi', segment: 'Mainstream', residual5: 0.47 },
  { name: 'Nissan', segment: 'Mainstream', residual5: 0.48 },
  { name: 'Volkswagen', segment: 'Mainstream', residual5: 0.5 },
  { name: 'GMC', segment: 'Truck', residual5: 0.57 },
  { name: 'Ram', segment: 'Truck', residual5: 0.55 },
  { name: 'Acura', segment: 'Luxury', residual5: 0.55 },
  { name: 'Alfa Romeo', segment: 'Luxury', residual5: 0.38 },
  { name: 'Audi', segment: 'Luxury', residual5: 0.45 },
  { name: 'BMW', segment: 'Luxury', residual5: 0.44 },
  { name: 'Cadillac', segment: 'Luxury', residual5: 0.44 },
  { name: 'Genesis', segment: 'Luxury', residual5: 0.47 },
  { name: 'Infiniti', segment: 'Luxury', residual5: 0.45 },
  { name: 'Jaguar', segment: 'Luxury', residual5: 0.38 },
  { name: 'Land Rover', segment: 'Luxury', residual5: 0.42 },
  { name: 'Lexus', segment: 'Luxury', residual5: 0.63 },
  { name: 'Lincoln', segment: 'Luxury', residual5: 0.45 },
  { name: 'Mercedes-Benz', segment: 'Luxury', residual5: 0.43 },
  { name: 'Volvo', segment: 'Luxury', residual5: 0.48 },
  { name: 'Porsche', segment: 'Performance', residual5: 0.7 },
  { name: 'Lucid', segment: 'EV', residual5: 0.38 },
  { name: 'Polestar', segment: 'EV', residual5: 0.4 },
  { name: 'Rivian', segment: 'EV', residual5: 0.46 },
  { name: 'Tesla', segment: 'EV', residual5: 0.48 },
  // Added with the EPA model list. Rough rule-of-thumb resale shares.
  { name: 'Fiat', segment: 'Mainstream', residual5: 0.36 },
  { name: 'Smart', segment: 'Mainstream', residual5: 0.36 },
  { name: 'Aston Martin', segment: 'Performance', residual5: 0.45 },
  { name: 'Bentley', segment: 'Performance', residual5: 0.45 },
  { name: 'Ferrari', segment: 'Performance', residual5: 0.72 },
  { name: 'Lamborghini', segment: 'Performance', residual5: 0.68 },
  { name: 'Lotus', segment: 'Performance', residual5: 0.55 },
  { name: 'Maserati', segment: 'Performance', residual5: 0.35 },
  { name: 'McLaren', segment: 'Performance', residual5: 0.5 },
  { name: 'Rolls-Royce', segment: 'Performance', residual5: 0.5 },
  { name: 'Hummer', segment: 'Discontinued', residual5: 0.45 },
  { name: 'Isuzu', segment: 'Discontinued', residual5: 0.42 },
  { name: 'Mercury', segment: 'Discontinued', residual5: 0.42 },
  { name: 'Pontiac', segment: 'Discontinued', residual5: 0.42 },
  { name: 'Saab', segment: 'Discontinued', residual5: 0.36 },
  { name: 'Saturn', segment: 'Discontinued', residual5: 0.4 },
  { name: 'Scion', segment: 'Discontinued', residual5: 0.55 },
  { name: 'Suzuki', segment: 'Discontinued', residual5: 0.42 },
  { name: 'Other', segment: 'Average', residual5: 0.52 },
];

/** Labels for grouping makes in the picker, in display order. */
export const SEGMENT_LABELS: Record<Make['segment'], string> = {
  Economy: 'Known for reliability',
  Mainstream: 'Mainstream',
  Truck: 'Truck brands',
  Luxury: 'Luxury',
  Performance: 'Performance',
  EV: 'Electric',
  Discontinued: 'No longer sold new',
  Average: 'Not listed',
};

export type BodyStyle = { name: string; adj: number };
export const BODY_STYLES: BodyStyle[] = [
  { name: 'Sedan', adj: -0.02 },
  { name: 'SUV / Crossover', adj: 0.02 },
  { name: 'Pickup Truck', adj: 0.04 },
  { name: 'Coupe / Sports', adj: 0 },
  { name: 'Hatchback / Wagon', adj: 0 },
  { name: 'Minivan', adj: -0.03 },
];

export type Option = { name: string; mult: number; desc: string };

export const CONDITIONS: (Option & { recon: number })[] = [
  { name: 'Excellent', mult: 1.06, recon: 600, desc: 'Like new, no defects, full service records' },
  { name: 'Good', mult: 1.0, recon: 1200, desc: 'Minor wear, mechanically sound' },
  { name: 'Fair', mult: 0.88, recon: 2500, desc: 'Needs some cosmetic or mechanical repairs' },
  { name: 'Poor', mult: 0.7, recon: 4500, desc: 'Significant damage or rough running' },
];

export const TITLES: Option[] = [
  { name: 'Clean', mult: 1.0, desc: 'Original title, no total-loss history' },
  { name: 'Rebuilt', mult: 0.75, desc: 'Formerly salvage, repaired and re-certified' },
  { name: 'Salvage', mult: 0.55, desc: 'Declared a total loss by an insurer' },
];

export const ACCIDENTS: Option[] = [
  { name: 'None', mult: 1.0, desc: 'No reported accidents' },
  { name: 'Minor', mult: 0.94, desc: 'Cosmetic or minor reported damage' },
  { name: 'Major', mult: 0.82, desc: 'Structural damage or airbag deployment' },
];

export const REGIONS = ['Northeast', 'Southeast', 'Midwest', 'Southwest', 'West'] as const;
export type Region = (typeof REGIONS)[number];

/** Small regional demand nudges (fractions). Trucks sell stronger in the
 * middle of the country, EVs on the West Coast, AWD-heavy brands up north. */
export function regionAdjustment(region: Region, make: Make, body: BodyStyle): number {
  let adj = 0;
  if (body.name === 'Pickup Truck' || make.segment === 'Truck') {
    if (region === 'Southwest' || region === 'Midwest' || region === 'Southeast') adj += 0.03;
    if (region === 'Northeast') adj -= 0.01;
  }
  if (make.segment === 'EV') {
    if (region === 'West') adj += 0.03;
    if (region === 'Midwest' || region === 'Southeast') adj -= 0.03;
  }
  if (make.name === 'Subaru' && (region === 'Northeast' || region === 'Midwest')) adj += 0.02;
  if (body.name === 'Coupe / Sports' && region === 'Northeast') adj -= 0.01;
  return adj;
}
