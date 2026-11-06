# MiCar Dealer Simulator

The MiCar car dealer simulator and training tool: a multiplayer 3D used-car dealership where you buy at auction, recondition, finance and sell cars, race them, and learn how a real lot makes money. Short name: MiCar Dealer Sim.

Formerly "Used Car Empire" (site title "Used Car Sim", package `car-dealer-sim`); the GitHub repository and the Render service still use the `car-dealer-sim` name.

## Run it

```
npm install
npm run server   # game server with the Vite dev server built in: http://localhost:3000
```

Production: `npm run build`, then `npm start` with `NODE_ENV=production`, which serves the built files from `dist/` (see `render.yaml`).

## Deploy (Render) and accounts

`render.yaml` deploys the server on Render's free plan, which has an ephemeral filesystem. The save file `data/gameState.json` holds the Strip's accounts.

**Gate: leave `GOOGLE_CLIENT_ID`, `MAGIC_SECRET`, `RESEND_API_KEY` and `MAGIC_FROM` unset until the service has a persistent disk (a Render paid plan, with a disk mounted at `apps/sim/data/`) or accounts move to a hosted store.** On the free plan `data/gameState.json` is wiped on every deploy and spin-down, and accounts with it. With them unset, the Strip offers guest play only and no sign-in buttons.

- `MAGIC_SECRET` signs the emailed sign-in links **and** the session tokens that keep a player signed in. Without it Google sign-ins don't survive a reload (no session token is issued).
- `GOOGLE_CLIENT_ID` turns on Google sign-in; `RESEND_API_KEY` and `MAGIC_FROM` (with `MAGIC_SECRET`) turn on "Email me a link". Secrets come only from the environment.
- If the save file is lost while a browser still holds a valid session token, that player joins as a guest and is told "Your saved account was not found on this server".
- The save is written to `gameState.json.tmp` and renamed over `gameState.json`. A save that fails to parse on boot is set aside as `gameState.json.corrupt-<timestamp>` and the server starts fresh; it is never overwritten.
