# MiCar car models in the dealer simulator

Drop-in replacement for the box cars in `src/VanillaThreeScene.tsx`. Nothing here is wired yet; these are the three edits to make when the garage logic goes in.

## Files
- `public/models/cars/<style>.glb`: nine models named by the sim's `bodyStyle` value: sedan, coupe, hatchback, suv, truck, sports, van, plus wagon and convertible (new styles the server can start using). About 11,500 triangles and 300 KB each, 2.6 MB for all nine.
- `src/carModels.ts`: loads them and builds a car with the same return shape as `buildCarModel()`.

Each model: forward is +Z, up is +Y, tyres on y = 0. The loader scales each one to the old box car's length (sedan 9, truck 11, and so on), so lot rows, the gate and collisions don't move.

## Edits in VanillaThreeScene.tsx
1. Import:
   ```ts
   import { preloadCarModels, buildCarFromModel } from './carModels';
   ```
2. Start loading when the scene is set up (once, before the render loop):
   ```ts
   const carModelsLoaded = preloadCarModels(`${import.meta.env.BASE_URL}models/cars/`);
   ```
3. First line inside `buildCarModel`:
   ```ts
   const fromModel = buildCarFromModel(style, rawColor, bodyCond, mechCond);
   if (fromModel) return fromModel as any;
   ```
   Until the models finish loading, cars fall back to the box version.

Optional: swap boxes for models once loading finishes, so cars created in the first second upgrade too:
```ts
carModelsLoaded.then(() => {
    Object.keys(carMeshes).forEach(id => {
        if (id === localDrivingCarId) return;           // don't pull the car out from under the driver
        scene.remove(carMeshes[id]);
        delete carMeshes[id]; delete carBodies[id]; delete carWheels[id]; delete carSteering[id]; delete carSmokes[id];
    });                                                  // the sync loop rebuilds them next frame from lotPosition
});
```

## What keeps working unchanged
- Paint colour, the mud look (`isDirty`), clearcoat and the star glow: `body` is a single mesh with its own `MeshPhysicalMaterial`.
- Rust below 50 body condition, cracked glass below 40, dull chrome below 50: same rules as the box cars.
- Smoke below 50 mechanical condition.
- `wheels[i].rotateX()` rolls the wheels; `frontPivots[i].rotation.y` steers the front pair.

## Rebuilding the models
In Blender, open `nexus-garage-cars.blend`, then run `builder.py` and `export_glb.py` (both in `C:\Users\Owner\NexusGarage`) with `WSEG = 32` and `BSEG_MAX = 2` for game quality. The same builder renders the card art at full quality.
