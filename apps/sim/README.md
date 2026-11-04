# MiCar Dealer Simulator

The MiCar car dealer simulator and training tool: a multiplayer 3D used-car dealership where you buy at auction, recondition, finance and sell cars, race them, and learn how a real lot makes money. Short name: MiCar Dealer Sim.

Formerly "Used Car Empire" (site title "Used Car Sim", package `car-dealer-sim`); the GitHub repository and the Render service still use the `car-dealer-sim` name.

## Run it

```
npm install
npm run server   # game server with the Vite dev server built in: http://localhost:3000
```

Production: `npm run build`, then `npm start` with `NODE_ENV=production`, which serves the built files from `dist/` (see `render.yaml`).
