// Model-level market data. residual5 is the share of a NEW one's price that a
// typical five-year-old example sells for (used prices track the price of a
// new replacement, so the engine inflates old stickers to today's dollars
// first). It already reflects reliability reputation, demand and supply for
// that model. Honda Civic (0.66) is backtested against 55 real 2026 dealer
// listings; see src/engine/backtest-civic.test.ts. Values are rule-of-thumb estimates drawn
// from published depreciation studies, not live market data; correct them
// with real asking prices (the comps input) when you have them.
//
// Traits explain the residual and set how sensitive the model is to local
// oversupply and the market cycle (see elasticity() in valuation.ts).

export type Trait = 'reliability' | 'enthusiast' | 'fleet' | 'luxury' | 'ev' | 'truck';

export const TRAIT_NOTES: Record<Trait, string> = {
  reliability: 'Strong reliability reputation keeps demand high, so prices hold even when lots are full.',
  enthusiast: 'A loyal buyer base competes for these, which keeps prices firm.',
  fleet: 'Sold heavily to rental and company fleets, so used lots are often crowded and sellers undercut each other.',
  luxury: 'Lease returns flood the market at three years, and repair costs scare off budget buyers.',
  ev: 'Incentives on new EVs and fast battery and software changes pull used prices down.',
  truck: 'Steady work and towing demand across the country supports prices.',
};

export type ModelInfo = {
  make: string;
  model: string;
  body: string;
  /** Typical new price for a mid-trim 2025 model, used to prefill MSRP. */
  typicalMsrp: number;
  residual5: number;
  traits: Trait[];
};

const BODY: Record<string, string> = {
  S: 'Sedan', U: 'SUV / Crossover', P: 'Pickup Truck', C: 'Coupe / Sports', H: 'Hatchback / Wagon', M: 'Minivan',
};

type Row = [make: string, model: string, body: keyof typeof BODY, msrp: number, residual5: number, traits?: string];

const ROWS: Row[] = [
  // Toyota
  ['Toyota', 'Camry', 'S', 30000, 0.62, 'reliability fleet'],
  ['Toyota', 'Corolla', 'S', 24000, 0.64, 'reliability fleet'],
  ['Toyota', 'Corolla Cross', 'U', 27000, 0.62, 'reliability'],
  ['Toyota', 'RAV4', 'U', 32000, 0.64, 'reliability'],
  ['Toyota', 'Highlander', 'U', 42000, 0.61, 'reliability'],
  ['Toyota', 'Grand Highlander', 'U', 46000, 0.62, 'reliability'],
  ['Toyota', '4Runner', 'U', 45000, 0.70, 'reliability enthusiast'],
  ['Toyota', 'Sequoia', 'U', 65000, 0.62, 'reliability truck'],
  ['Toyota', 'Tacoma', 'P', 38000, 0.72, 'reliability enthusiast truck'],
  ['Toyota', 'Tundra', 'P', 48000, 0.66, 'reliability truck'],
  ['Toyota', 'Prius', 'H', 30000, 0.60, 'reliability'],
  ['Toyota', 'Sienna', 'M', 42000, 0.62, 'reliability'],
  ['Toyota', 'GR86', 'C', 32000, 0.68, 'enthusiast'],
  ['Toyota', 'GR Supra', 'C', 56000, 0.66, 'enthusiast'],
  // Honda
  ['Honda', 'Civic', 'S', 26000, 0.66, 'reliability enthusiast'],
  ['Honda', 'Accord', 'S', 30000, 0.60, 'reliability'],
  ['Honda', 'CR-V', 'U', 33000, 0.63, 'reliability'],
  ['Honda', 'HR-V', 'U', 27000, 0.60, 'reliability'],
  ['Honda', 'Pilot', 'U', 42000, 0.58, 'reliability'],
  ['Honda', 'Passport', 'U', 44000, 0.55, 'reliability'],
  ['Honda', 'Odyssey', 'M', 43000, 0.55, 'reliability'],
  ['Honda', 'Ridgeline', 'P', 42000, 0.62, 'reliability truck'],
  // Subaru
  ['Subaru', 'Crosstrek', 'U', 28000, 0.68, 'reliability enthusiast'],
  ['Subaru', 'Forester', 'U', 32000, 0.62, 'reliability'],
  ['Subaru', 'Outback', 'H', 32000, 0.60, 'reliability'],
  ['Subaru', 'Impreza', 'H', 25000, 0.62, 'reliability'],
  ['Subaru', 'Ascent', 'U', 38000, 0.55, 'reliability'],
  ['Subaru', 'WRX', 'S', 35000, 0.64, 'enthusiast'],
  ['Subaru', 'BRZ', 'C', 32000, 0.68, 'enthusiast'],
  // Mazda
  ['Mazda', 'Mazda3', 'S', 26000, 0.60, 'reliability'],
  ['Mazda', 'CX-5', 'U', 31000, 0.60, 'reliability'],
  ['Mazda', 'CX-50', 'U', 32000, 0.58, 'reliability'],
  ['Mazda', 'CX-90', 'U', 42000, 0.52, ''],
  ['Mazda', 'MX-5 Miata', 'C', 32000, 0.70, 'enthusiast reliability'],
  // Ford
  ['Ford', 'F-150', 'P', 45000, 0.62, 'truck'],
  ['Ford', 'F-250 Super Duty', 'P', 55000, 0.64, 'truck'],
  ['Ford', 'Ranger', 'P', 36000, 0.62, 'truck'],
  ['Ford', 'Maverick', 'P', 28000, 0.70, 'truck enthusiast'],
  ['Ford', 'Mustang', 'C', 35000, 0.64, 'enthusiast fleet'],
  ['Ford', 'Bronco', 'U', 42000, 0.66, 'enthusiast'],
  ['Ford', 'Bronco Sport', 'U', 32000, 0.55, ''],
  ['Ford', 'Explorer', 'U', 42000, 0.50, 'fleet'],
  ['Ford', 'Escape', 'U', 31000, 0.47, 'fleet'],
  ['Ford', 'Edge', 'U', 40000, 0.46, 'fleet'],
  ['Ford', 'Expedition', 'U', 60000, 0.52, 'truck'],
  ['Ford', 'Mustang Mach-E', 'U', 45000, 0.42, 'ev'],
  // Chevrolet
  ['Chevrolet', 'Silverado 1500', 'P', 48000, 0.60, 'truck'],
  ['Chevrolet', 'Silverado 2500HD', 'P', 55000, 0.63, 'truck'],
  ['Chevrolet', 'Colorado', 'P', 36000, 0.62, 'truck'],
  ['Chevrolet', 'Equinox', 'U', 30000, 0.48, 'fleet'],
  ['Chevrolet', 'Trax', 'U', 22000, 0.50, 'fleet'],
  ['Chevrolet', 'Trailblazer', 'U', 25000, 0.50, 'fleet'],
  ['Chevrolet', 'Blazer', 'U', 38000, 0.48, 'fleet'],
  ['Chevrolet', 'Traverse', 'U', 42000, 0.48, 'fleet'],
  ['Chevrolet', 'Tahoe', 'U', 62000, 0.56, 'truck'],
  ['Chevrolet', 'Suburban', 'U', 65000, 0.55, 'truck'],
  ['Chevrolet', 'Malibu', 'S', 27000, 0.44, 'fleet'],
  ['Chevrolet', 'Camaro', 'C', 35000, 0.60, 'enthusiast fleet'],
  ['Chevrolet', 'Corvette', 'C', 72000, 0.70, 'enthusiast'],
  ['Chevrolet', 'Bolt EV', 'H', 30000, 0.38, 'ev'],
  // GMC
  ['GMC', 'Sierra 1500', 'P', 50000, 0.60, 'truck'],
  ['GMC', 'Canyon', 'P', 40000, 0.62, 'truck'],
  ['GMC', 'Terrain', 'U', 31000, 0.47, 'fleet'],
  ['GMC', 'Acadia', 'U', 45000, 0.47, 'fleet'],
  ['GMC', 'Yukon', 'U', 65000, 0.56, 'truck'],
  // Ram
  ['Ram', '1500', 'P', 48000, 0.57, 'truck fleet'],
  ['Ram', '2500', 'P', 55000, 0.62, 'truck'],
  // Jeep
  ['Jeep', 'Wrangler', 'U', 40000, 0.70, 'enthusiast'],
  ['Jeep', 'Gladiator', 'P', 42000, 0.60, 'enthusiast truck'],
  ['Jeep', 'Grand Cherokee', 'U', 45000, 0.52, 'fleet'],
  ['Jeep', 'Cherokee', 'U', 35000, 0.45, 'fleet'],
  ['Jeep', 'Compass', 'U', 30000, 0.47, 'fleet'],
  // Dodge / Chrysler
  ['Dodge', 'Charger', 'S', 40000, 0.56, 'enthusiast fleet'],
  ['Dodge', 'Challenger', 'C', 38000, 0.60, 'enthusiast'],
  ['Dodge', 'Durango', 'U', 45000, 0.52, 'fleet'],
  ['Dodge', 'Hornet', 'U', 32000, 0.42, ''],
  ['Chrysler', 'Pacifica', 'M', 42000, 0.45, 'fleet'],
  ['Chrysler', '300', 'S', 38000, 0.44, 'fleet'],
  // Buick / Cadillac / Lincoln
  ['Buick', 'Enclave', 'U', 45000, 0.44, 'fleet'],
  ['Buick', 'Envision', 'U', 37000, 0.45, 'fleet'],
  ['Buick', 'Encore GX', 'U', 28000, 0.44, 'fleet'],
  ['Buick', 'Envista', 'U', 25000, 0.46, ''],
  ['Cadillac', 'Escalade', 'U', 90000, 0.50, 'luxury truck'],
  ['Cadillac', 'XT5', 'U', 48000, 0.44, 'luxury fleet'],
  ['Cadillac', 'XT4', 'U', 40000, 0.44, 'luxury'],
  ['Cadillac', 'CT5', 'S', 48000, 0.42, 'luxury'],
  ['Cadillac', 'Lyriq', 'U', 62000, 0.40, 'luxury ev'],
  ['Lincoln', 'Navigator', 'U', 100000, 0.48, 'luxury truck'],
  ['Lincoln', 'Aviator', 'U', 58000, 0.44, 'luxury'],
  ['Lincoln', 'Nautilus', 'U', 52000, 0.45, 'luxury'],
  ['Lincoln', 'Corsair', 'U', 42000, 0.44, 'luxury'],
  // Nissan / Infiniti
  ['Nissan', 'Altima', 'S', 28000, 0.45, 'fleet'],
  ['Nissan', 'Sentra', 'S', 22000, 0.50, 'fleet'],
  ['Nissan', 'Versa', 'S', 19000, 0.50, 'fleet'],
  ['Nissan', 'Rogue', 'U', 30000, 0.50, 'fleet'],
  ['Nissan', 'Kicks', 'U', 23000, 0.52, 'fleet'],
  ['Nissan', 'Murano', 'U', 40000, 0.45, 'fleet'],
  ['Nissan', 'Pathfinder', 'U', 38000, 0.50, 'fleet'],
  ['Nissan', 'Frontier', 'P', 33000, 0.64, 'truck'],
  ['Nissan', 'Titan', 'P', 48000, 0.52, 'truck'],
  ['Nissan', 'Leaf', 'H', 29000, 0.35, 'ev'],
  ['Infiniti', 'QX50', 'U', 42000, 0.42, 'luxury'],
  ['Infiniti', 'QX60', 'U', 52000, 0.42, 'luxury'],
  ['Infiniti', 'QX80', 'U', 85000, 0.42, 'luxury truck'],
  ['Infiniti', 'Q50', 'S', 45000, 0.44, 'luxury'],
  // Hyundai / Kia / Genesis
  ['Hyundai', 'Elantra', 'S', 23000, 0.54, 'fleet'],
  ['Hyundai', 'Sonata', 'S', 28000, 0.48, 'fleet'],
  ['Hyundai', 'Venue', 'U', 21000, 0.54, ''],
  ['Hyundai', 'Kona', 'U', 26000, 0.53, ''],
  ['Hyundai', 'Tucson', 'U', 30000, 0.55, ''],
  ['Hyundai', 'Santa Fe', 'U', 36000, 0.52, ''],
  ['Hyundai', 'Palisade', 'U', 40000, 0.58, ''],
  ['Hyundai', 'Santa Cruz', 'P', 30000, 0.58, 'truck'],
  ['Hyundai', 'Ioniq 5', 'U', 45000, 0.42, 'ev'],
  ['Kia', 'Forte / K4', 'S', 23000, 0.54, 'fleet'],
  ['Kia', 'K5', 'S', 28000, 0.50, 'fleet'],
  ['Kia', 'Soul', 'H', 22000, 0.54, ''],
  ['Kia', 'Seltos', 'U', 26000, 0.55, ''],
  ['Kia', 'Niro', 'U', 28000, 0.52, ''],
  ['Kia', 'Sportage', 'U', 30000, 0.55, ''],
  ['Kia', 'Sorento', 'U', 34000, 0.53, ''],
  ['Kia', 'Telluride', 'U', 38000, 0.63, 'enthusiast'],
  ['Kia', 'Carnival', 'M', 38000, 0.52, ''],
  ['Kia', 'EV6', 'U', 45000, 0.40, 'ev'],
  ['Genesis', 'G70', 'S', 43000, 0.45, 'luxury'],
  ['Genesis', 'G80', 'S', 55000, 0.44, 'luxury'],
  ['Genesis', 'GV70', 'U', 48000, 0.50, 'luxury'],
  ['Genesis', 'GV80', 'U', 60000, 0.52, 'luxury'],
  // Volkswagen
  ['Volkswagen', 'Jetta', 'S', 24000, 0.52, 'fleet'],
  ['Volkswagen', 'Golf GTI', 'H', 33000, 0.60, 'enthusiast'],
  ['Volkswagen', 'Taos', 'U', 26000, 0.50, ''],
  ['Volkswagen', 'Tiguan', 'U', 30000, 0.46, 'fleet'],
  ['Volkswagen', 'Atlas', 'U', 40000, 0.48, ''],
  ['Volkswagen', 'ID.4', 'U', 42000, 0.38, 'ev'],
  // Audi / BMW / Mercedes-Benz
  ['Audi', 'A4', 'S', 45000, 0.46, 'luxury'],
  ['Audi', 'A5', 'C', 48000, 0.46, 'luxury'],
  ['Audi', 'A6', 'S', 60000, 0.42, 'luxury'],
  ['Audi', 'Q3', 'U', 40000, 0.47, 'luxury'],
  ['Audi', 'Q5', 'U', 48000, 0.46, 'luxury'],
  ['Audi', 'Q7', 'U', 62000, 0.42, 'luxury'],
  ['Audi', 'Q8 e-tron', 'U', 75000, 0.35, 'luxury ev'],
  ['BMW', '3 Series', 'S', 48000, 0.45, 'luxury'],
  ['BMW', '4 Series', 'C', 52000, 0.46, 'luxury'],
  ['BMW', '5 Series', 'S', 60000, 0.40, 'luxury'],
  ['BMW', '7 Series', 'S', 100000, 0.36, 'luxury'],
  ['BMW', 'X1', 'U', 42000, 0.47, 'luxury'],
  ['BMW', 'X3', 'U', 50000, 0.47, 'luxury'],
  ['BMW', 'X5', 'U', 68000, 0.45, 'luxury'],
  ['BMW', 'X7', 'U', 85000, 0.44, 'luxury'],
  ['BMW', 'i4', 'S', 55000, 0.40, 'luxury ev'],
  ['Mercedes-Benz', 'C-Class', 'S', 50000, 0.44, 'luxury'],
  ['Mercedes-Benz', 'E-Class', 'S', 65000, 0.42, 'luxury'],
  ['Mercedes-Benz', 'S-Class', 'S', 120000, 0.40, 'luxury'],
  ['Mercedes-Benz', 'GLA', 'U', 43000, 0.45, 'luxury'],
  ['Mercedes-Benz', 'GLB', 'U', 45000, 0.46, 'luxury'],
  ['Mercedes-Benz', 'GLC', 'U', 50000, 0.46, 'luxury'],
  ['Mercedes-Benz', 'GLE', 'U', 65000, 0.45, 'luxury'],
  ['Mercedes-Benz', 'GLS', 'U', 90000, 0.44, 'luxury'],
  ['Mercedes-Benz', 'EQE', 'S', 78000, 0.32, 'luxury ev'],
  // Lexus / Acura
  ['Lexus', 'ES', 'S', 45000, 0.58, 'reliability luxury'],
  ['Lexus', 'IS', 'S', 42000, 0.58, 'reliability luxury'],
  ['Lexus', 'UX', 'U', 38000, 0.56, 'reliability luxury'],
  ['Lexus', 'NX', 'U', 42000, 0.60, 'reliability luxury'],
  ['Lexus', 'RX', 'U', 52000, 0.62, 'reliability luxury'],
  ['Lexus', 'TX', 'U', 58000, 0.58, 'reliability luxury'],
  ['Lexus', 'GX', 'U', 65000, 0.68, 'reliability enthusiast'],
  ['Lexus', 'LX', 'U', 100000, 0.65, 'reliability luxury'],
  ['Acura', 'Integra', 'H', 34000, 0.60, 'reliability'],
  ['Acura', 'TLX', 'S', 46000, 0.50, 'reliability luxury'],
  ['Acura', 'RDX', 'U', 46000, 0.54, 'reliability luxury'],
  ['Acura', 'MDX', 'U', 52000, 0.55, 'reliability luxury'],
  ['Acura', 'ZDX', 'U', 65000, 0.38, 'luxury ev'],
  // Volvo / Land Rover / Jaguar / Alfa Romeo / Mini / Mitsubishi
  ['Volvo', 'XC40', 'U', 42000, 0.48, 'luxury'],
  ['Volvo', 'XC60', 'U', 48000, 0.46, 'luxury'],
  ['Volvo', 'XC90', 'U', 60000, 0.44, 'luxury'],
  ['Volvo', 'S60', 'S', 43000, 0.42, 'luxury'],
  ['Land Rover', 'Range Rover', 'U', 110000, 0.44, 'luxury'],
  ['Land Rover', 'Range Rover Sport', 'U', 85000, 0.45, 'luxury'],
  ['Land Rover', 'Range Rover Evoque', 'U', 50000, 0.40, 'luxury'],
  ['Land Rover', 'Defender', 'U', 60000, 0.58, 'luxury enthusiast'],
  ['Land Rover', 'Discovery', 'U', 62000, 0.40, 'luxury'],
  ['Jaguar', 'F-Pace', 'U', 58000, 0.38, 'luxury'],
  ['Jaguar', 'E-Pace', 'U', 48000, 0.36, 'luxury'],
  ['Jaguar', 'XF', 'S', 50000, 0.36, 'luxury'],
  ['Jaguar', 'F-Type', 'C', 78000, 0.45, 'luxury enthusiast'],
  ['Alfa Romeo', 'Giulia', 'S', 45000, 0.38, 'luxury'],
  ['Alfa Romeo', 'Stelvio', 'U', 48000, 0.38, 'luxury'],
  ['Alfa Romeo', 'Tonale', 'U', 42000, 0.40, 'luxury'],
  ['Mini', 'Cooper', 'H', 30000, 0.50, 'enthusiast'],
  ['Mini', 'Countryman', 'U', 35000, 0.48, ''],
  ['Mitsubishi', 'Mirage', 'H', 18000, 0.45, 'fleet'],
  ['Mitsubishi', 'Outlander', 'U', 30000, 0.46, 'fleet'],
  ['Mitsubishi', 'Outlander Sport', 'U', 25000, 0.45, 'fleet'],
  ['Mitsubishi', 'Eclipse Cross', 'U', 27000, 0.45, 'fleet'],
  // Porsche
  ['Porsche', '911', 'C', 125000, 0.78, 'enthusiast luxury'],
  ['Porsche', '718 Cayman / Boxster', 'C', 75000, 0.74, 'enthusiast luxury'],
  ['Porsche', 'Macan', 'U', 65000, 0.58, 'luxury'],
  ['Porsche', 'Cayenne', 'U', 85000, 0.55, 'luxury'],
  ['Porsche', 'Panamera', 'S', 105000, 0.45, 'luxury'],
  ['Porsche', 'Taycan', 'S', 100000, 0.40, 'luxury ev'],
  // EV makes
  ['Tesla', 'Model 3', 'S', 42000, 0.45, 'ev'],
  ['Tesla', 'Model Y', 'U', 47000, 0.48, 'ev'],
  ['Tesla', 'Model S', 'S', 85000, 0.40, 'ev luxury'],
  ['Tesla', 'Model X', 'U', 90000, 0.40, 'ev luxury'],
  ['Tesla', 'Cybertruck', 'P', 80000, 0.50, 'ev enthusiast'],
  ['Rivian', 'R1T', 'P', 75000, 0.45, 'ev enthusiast'],
  ['Rivian', 'R1S', 'U', 78000, 0.45, 'ev enthusiast'],
  ['Lucid', 'Air', 'S', 80000, 0.32, 'ev luxury'],
  ['Polestar', '2', 'H', 55000, 0.35, 'ev luxury'],
  ['Polestar', '3', 'U', 70000, 0.38, 'ev luxury'],
];

export const MODELS: ModelInfo[] = ROWS.map(([make, model, body, typicalMsrp, residual5, traits]) => ({
  make, model, body: BODY[body], typicalMsrp, residual5,
  traits: (traits ?? '').split(' ').filter(Boolean) as Trait[],
}));

export function modelsForMake(make: string): ModelInfo[] {
  return MODELS.filter((m) => m.make === make);
}

export function findModel(make: string, model: string): ModelInfo | undefined {
  return MODELS.find((m) => m.make === make && m.model === model);
}

/** Typical sticker price for a given model year, assuming ~3% yearly price growth. */
export function typicalMsrp(info: ModelInfo, year: number): number {
  const raw = info.typicalMsrp * Math.pow(1.03, Math.min(1, year - 2025));
  return Math.round(raw / 100) * 100;
}
