import { describe, expect, it } from 'vitest';
import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { CAR_MODELS, gameNameOf, realNameOf } from './carModels';
import { CAR_CATALOG, ORIGINAL_MAKES } from './carCatalog';
import { getCarSpec, STYLE_SPECS } from './carSpecs';
import { STYLES, specFor } from './world/data';
import { MESH_MODELS, carMeshId } from './scene/car/carMeshes';

const carsDir = fileURLToPath(new URL('../public/cars/', import.meta.url));
const key = (make: string, model: string) => `${make}|${model}`;

describe('the car model list (src/carModels.json): one row per finished 3D model', () => {
    it('every row has an id, real and game names, and a body style the sim draws', () => {
        expect(CAR_MODELS.length).toBeGreaterThan(300);
        for (const r of CAR_MODELS) {
            expect(r.id).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
            for (const v of [r.make, r.model, r.gameMake, r.gameModel]) expect(v.trim().length).toBeGreaterThan(0);
            expect(STYLES as string[]).toContain(r.style);
        }
    });
    it('ids, real names and game names are each unique', () => {
        expect(new Set(CAR_MODELS.map(r => r.id)).size).toBe(CAR_MODELS.length);
        expect(new Set(CAR_MODELS.map(r => key(r.make, r.model))).size).toBe(CAR_MODELS.length);
        expect(new Set(CAR_MODELS.map(r => key(r.gameMake, r.gameModel))).size).toBe(CAR_MODELS.length);
    });
    it('covers all 7 body styles', () => {
        expect(new Set(CAR_MODELS.map(r => r.style))).toEqual(new Set(STYLES));
    });
    it('every row has its model file in public/cars, and every file there has its row (drop a file in with its row)', () => {
        const files = readdirSync(carsDir).filter(f => f.endsWith('.glb')).map(f => f.slice(0, -4)).sort();
        expect(files).toEqual(CAR_MODELS.map(r => r.id).sort());
        expect([...MESH_MODELS].sort()).toEqual(files);
    });
    it('maps game names to real names and back (the value app shows the real ones)', () => {
        const r = CAR_MODELS.find(x => x.id === 'acura-adx')!;
        expect(realNameOf(r.gameMake, r.gameModel)).toEqual({ make: 'Acura', model: 'ADX' });
        expect(gameNameOf('Acura', 'ADX')).toEqual({ make: r.gameMake, model: r.gameModel });
        expect(realNameOf('Nobody', 'Nothing')).toBeNull();
    });
});

describe("the world's catalog", () => {
    const entries = Object.entries(CAR_CATALOG).flatMap(([make, list]) => list.map(m => ({ make, ...m })));
    it('keeps the original 5 makes and 36 models as they were', () => {
        expect(ORIGINAL_MAKES).toEqual(['Toyota', 'Ford', 'Honda', 'Chevy', 'BMW']);
        expect(ORIGINAL_MAKES.flatMap(m => CAR_CATALOG[m]).length).toBe(36);
    });
    it('adds every other finished model under its game name, by its body style', () => {
        const original = new Set(ORIGINAL_MAKES.flatMap(m => CAR_CATALOG[m].map(e => carMeshId(m, e.model))).filter(Boolean));
        const added = CAR_MODELS.filter(r => !original.has(r.id));
        expect(added.length).toBeGreaterThan(300);
        for (const r of added) expect(CAR_CATALOG[r.gameMake]).toContainEqual({ model: r.gameModel, style: r.style });
        // an original model is not listed a second time under its game name
        for (const r of CAR_MODELS.filter(x => original.has(x.id))) expect(CAR_CATALOG[r.gameMake]?.some(e => e.model === r.gameModel) ?? false).toBe(false);
        expect(entries.length).toBe(36 + added.length);
        expect(new Set(entries.map(e => key(e.make, e.model))).size).toBe(entries.length);
    });
    it('every added model is drawn from its own model; the original ones where theirs is finished', () => {
        for (const e of entries.filter(x => !ORIGINAL_MAKES.includes(x.make))) expect(carMeshId(e.make, e.model)).not.toBeNull();
        expect(carMeshId('Toyota', 'Camry')).toBe('toyota-camry');
        expect(carMeshId('Chevy', 'Tahoe')).toBe('chevrolet-tahoe');
        // no finished model yet (no mesh, a bad mesh, or flawed and back in Blender): the lofted body
        for (const [make, model] of [['Toyota', 'Supra'], ['Ford', 'Ranger'], ['Chevy', 'Silverado'], ['BMW', 'M4'], ['Ford', 'Mustang'], ['Toyota', 'RAV4']])
            expect(carMeshId(make, model)).toBeNull();
    });
    it("an added model is named by its game name in the Garage, on its body style's figures", () => {
        const r = CAR_MODELS.find(x => x.id === 'ferrari-296-gtb')!;
        const own = specFor({ make: r.gameMake, model: r.gameModel, bodyStyle: r.style }), style = specFor({ bodyStyle: r.style });
        expect(own.name).toBe(`${r.gameMake} ${r.gameModel}`);
        expect({ ...own, name: '' }).toEqual({ ...style, name: '' });
        expect(specFor({ make: 'Nobody', model: 'Nothing', bodyStyle: 'sports' }).name).toBe(style.name); // unknown cars as before
    });
    it('an added model without its own figures drives on its body style\'s', () => {
        const r = CAR_MODELS.find(x => x.id === 'acura-adx')!;
        expect(getCarSpec({ make: r.gameMake, model: r.gameModel, bodyStyle: r.style })).toBe(STYLE_SPECS[r.style]);
    });
});
