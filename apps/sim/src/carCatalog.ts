import { CAR_MODELS, modelIdOf } from './carModels';

// Real model line-ups per make, each tagged with the body style that drives its 3D silhouette. The server's auction
// picks one of its makes (the original five), then a random model from it; the Strip's tester counter lists them all.
// After the original five come the other finished 3D models (carModels.ts), under their game names, by body style.
const ORIGINAL: Record<string, { model: string; style: string }[]> = {
    Toyota: [
        { model: 'Camry', style: 'sedan' }, { model: 'Corolla', style: 'sedan' },
        { model: 'RAV4', style: 'suv' }, { model: 'Tacoma', style: 'truck' },
        { model: 'Tundra', style: 'truck' }, { model: 'Prius', style: 'hatchback' },
        { model: 'Sienna', style: 'van' }, { model: 'Supra', style: 'sports' },
    ],
    Ford: [
        { model: 'F-150', style: 'truck' }, { model: 'Ranger', style: 'truck' },
        { model: 'Mustang', style: 'sports' }, { model: 'Explorer', style: 'suv' },
        { model: 'Escape', style: 'suv' }, { model: 'Focus', style: 'hatchback' },
        { model: 'Fusion', style: 'sedan' },
    ],
    Honda: [
        { model: 'Civic', style: 'sedan' }, { model: 'Accord', style: 'sedan' },
        { model: 'CR-V', style: 'suv' }, { model: 'Pilot', style: 'suv' },
        { model: 'Odyssey', style: 'van' }, { model: 'Fit', style: 'hatchback' },
        { model: 'Ridgeline', style: 'truck' },
    ],
    Chevy: [
        { model: 'Silverado', style: 'truck' }, { model: 'Colorado', style: 'truck' },
        { model: 'Camaro', style: 'sports' }, { model: 'Corvette', style: 'sports' },
        { model: 'Equinox', style: 'suv' }, { model: 'Tahoe', style: 'suv' },
        { model: 'Malibu', style: 'sedan' },
    ],
    BMW: [
        { model: '3 Series', style: 'sedan' }, { model: '5 Series', style: 'sedan' },
        { model: 'X5', style: 'suv' }, { model: 'X3', style: 'suv' },
        { model: 'M4', style: 'coupe' }, { model: '4 Series', style: 'coupe' },
        { model: 'Z4', style: 'sports' },
    ],
};
export const ORIGINAL_MAKES = Object.keys(ORIGINAL);
const originalIds = new Set(ORIGINAL_MAKES.flatMap(m => ORIGINAL[m].map(e => modelIdOf(m, e.model))));
export const CAR_CATALOG: Record<string, { model: string; style: string }[]> = { ...ORIGINAL };
for (const r of CAR_MODELS) if (!originalIds.has(r.id)) (CAR_CATALOG[r.gameMake] ??= []).push({ model: r.gameModel, style: r.style });
