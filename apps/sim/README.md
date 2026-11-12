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

## Challenge a friend

A race between people, started from a link. The design, and what was built differently, is in `docs/superpowers/specs/2026-11-12-challenge-a-friend-design.md`.

- **The link.** At the Strip's rental counter, "Challenge a friend" picks a race (any the host's stage has opened) and one car of the rental fleet, and makes a room with a six-character code. The link is `/strip?race=CODE`. `GET /api/race/CODE` answers who hosts it, which race and which car (the entry card shows this before anyone joins), or 404 once the room is gone.
- **The room's life.** Up to four people. The host starts with two or more. Every racer is lent the same car, free: it is a rental marked as lent, so it blocks a paid event and goes back when the race closes. Each browser drives its own car and sends where it is about 15 times a second; the server passes that on, names one green light on its own clock, and checks every reported time against that clock. The race closes when everyone is home or out, or 60 seconds after the first finish; the room is then open for the next race. A room with nobody in it keeps its link for two minutes after its last member left it, and for fifteen when the last connection dropped (a reload comes back to it, and so does a host whose phone went to a messenger to send the link); then it is removed.
- **In memory.** Rooms are not saved. A deploy, a restart or a spin-down of the free plan ends every open challenge, and the link then reads "That challenge has ended." The server holds at most 100 rooms, and at most 20 made from one address.
- **Tests.** `src/world/race.test.ts` (the rules), `src/world/serverWiring.test.ts` (three sockets through a whole race), `e2e/challenge.smoke.mjs` (two browsers and one link; CI runs it after the Strip smoke).
