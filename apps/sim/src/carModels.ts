import data from './carModels.json';

// The finished car models: one row of carModels.json per model file in public/cars/<id>.glb, with the car's real make
// and model, its body style and the made-up name the world shows for it. More are added by adding a row and its file.

export type CarModelRow = { id: string; make: string; model: string; style: string; gameMake: string; gameModel: string };

export const CAR_MODELS: readonly CarModelRow[] = data.rows.map(line => {
    const [id, make, model, style, gameMake, gameModel] = line.split('|');
    return { id, make, model, style, gameMake, gameModel };
});

const k = (make: string, model: string) => make + '|' + model;
const byGame = new Map(CAR_MODELS.map(r => [k(r.gameMake, r.gameModel), r]));
const byReal = new Map(CAR_MODELS.map(r => [k(r.make, r.model), r]));

/** The row of a car the world names by its game name (null: not one of these). */
export const rowByGameName = (make?: string | null, model?: string | null) => (make && model && byGame.get(k(make, model))) || null;
/** The real make and model behind a game name (for the value app). */
export function realNameOf(gameMake: string, gameModel: string): { make: string; model: string } | null {
    const r = byGame.get(k(gameMake, gameModel));
    return r ? { make: r.make, model: r.model } : null;
}
/** The game name of a real make and model. */
export function gameNameOf(make: string, model: string): { make: string; model: string } | null {
    const r = byReal.get(k(make, model));
    return r ? { make: r.gameMake, model: r.gameModel } : null;
}
