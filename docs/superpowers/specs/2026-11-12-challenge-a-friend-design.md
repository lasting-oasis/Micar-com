# Challenge a friend: a live race between people, started from a link — design

Date: 2026-11-12. Status: the design was approved by the owner in conversation on 2026-11-12, with the push and the deploy.

Every race in the Strip is one person against three computer-driven cars. Other people in the Strip are a name tag floating over the road; nobody races anybody. This work adds the race between people and the link that starts it: a visitor at the rental counter picks a race and a car, gets a link, and sends it. Whoever opens the link lands in the same waiting room. The host presses Start and up to four people race the same circuit at the same moment, in the same car, and see each other drive.

## What the player sees

1. **Start a challenge.** The rental counter (the lobby every `/strip` visitor lands in, and returns to after each event) gets a button, **Challenge a friend**. It opens a card: pick the race from the ones your stage has opened, pick the car from the rental fleet, press **Get the link**.
2. **The waiting room.** The card becomes the waiting room: the race, the car, the link with a **Share** button (the phone's share sheet where there is one, **Copy link** otherwise; the link also sits in a field that can be copied by hand), and the list of who is here. The host sees **Start race**, enabled once two people are in, and can change the race or the car. Everyone else sees "Waiting for {host} to start". Anyone can **Leave**.
3. **Open the link.** `https://micar-sim.onrender.com/strip?race=K7M2QX`. The entry card reads "{host} challenged you", names the race and the car, asks "What do we call you?" and has one button: **Join the race**. No account and no money are needed. A browser with a saved sign-in joins without the card. The friend lands in the same waiting room.
4. **The race.** Start lends everyone the car and puts them on the grid of the race's circuit: the people only, no computer cars. The banner holds "Get ready" until every browser has the circuit loaded, then counts 3, 2, 1, GO at the same instant for all. You see the other cars (the same model, a colour per grid place, the driver's name above), your position and the gap. Cars do not touch: they pass through each other.
5. **The finish.** Lowest time wins; in a drift, highest score. When the first car is home the rest have 60 seconds. The results card lists everyone by name and fills in as they finish; it offers **Continue** once the race is closed. The lent car goes back. Nobody's cash, REP, Octane, stamps, wins or best times change.
6. **Again.** Everyone is back in the waiting room, which now shows the last race's result. The same link still works. The host can start again, or change the race or the car first.

## Decisions

1. **Live, not "beat my time".** The owner chose a race both people drive at once. A link that carries a recorded result is a later stage.
2. **The same car, lent free.** The owner chose it. A friend with no money and no account is on the grid in seconds, the race is fair, and the money system is untouched.
3. **Each browser drives its own car; the server referees.** Driving is simulated in the browser today and the server already relays positions. The server keeps the room, names the green light, relays each car's pose to the others and settles the result. Running the physics on the server, or connecting browsers directly, were both set aside: the first needs the planned physics core and a bigger server, the second fails on some phone networks and leaves nobody to referee.
4. **No contact between cars.** Each car is a fraction of a second out of date on the other screens, so a collision would be decided by lag.
5. **Nothing won, nothing lost.** A challenge pays no cash, REP, Octane or stamp and records no win or best time. While a player holds a lent car the server refuses paid events and pays no outrun, so a free car can never earn.
6. **Up to four racers,** because the grid has four places. Grid places rotate from race to race, so nobody keeps the back row.
7. **People only.** The computer racers are simulated in each browser and would differ from screen to screen.
8. **The host picks from the races their own stage has opened;** a friend can race it whatever their stage. Opening circuits stays worth something.
9. **Made at the rental counter.** A dealer in the town reaches a challenge the way anyone does: `/strip`, or a link.
10. **The room outlives its host.** When the host leaves, the next member becomes host. An empty room lasts two minutes (a reload comes back to it), then its link is dead.
11. **Rooms live in the server's memory,** like players. A deploy, or a spin-down of the free Render plan, ends every room; the link then says the challenge has ended.
12. **Pause stops only your own car.** The race clock is the wall clock, so it runs on. A challenge has no restart; quitting is a DNF.
13. **A room is a short code, not a secret.** Six characters from `ABCDEFGHJKMNPQRSTUVWXYZ23456789` (no I, L, O, 0 or 1), matched without case. Whoever has the code can read the host's name, the race and the car, and can join.
14. **English and Spanish** for every new line the player reads.

## The race, exactly

**Phases of a room.** `open` (the waiting room, also between races) → `loading` (cars lent, browsers loading the circuit) → `racing` (the green light is named) → `open`.

**A member's state.** `waiting` (in the room, not in this race), `loading`, `ready` (on the grid), `racing`, `finished`, `dnf`.

| Step | Rule |
|---|---|
| Start | The host, in `open`, with at least 2 members. Every member becomes `loading` with a grid place: `(index + race number) mod racers`. The race number goes up by one |
| Ready | A browser reports ready once it sits on the grid in the lent car. When nobody is still `loading` and at least 2 are `ready`, the server names the green light: now + 5 s |
| Slow to load | 30 s after Start, members still `loading` go back to `waiting` and miss this race. With 2 or more `ready` the race goes; with fewer it is called off and the room says so |
| Green light | One server time for all. Each browser measured its clock against the server's (five timed round trips, the fastest one kept) and counts down to that instant; the banner shows 3, 2, 1 in the last three seconds |
| Poses | While racing, each browser sends its car's pose about 15 times a second: server time, x, z, heading, speed, distance along the route, drift score. The server relays it to the other members and keeps nothing |
| Finish | A browser reports its own time from the green light. The server measures the same span on its own clock. The claim stands when it is no faster than the track allows (`raceFloor`), not later than the server's figure by more than 0.1 s, and within 0.5 s under it; otherwise the server's figure is the time. A finish that arrives before the track's floor has passed on the server's clock is refused |
| Failed | A blown engine in a drag is a DNF |
| Quit, leave, drop | A racer who quits, leaves the room or loses the connection is a DNF; the others race on |
| The window | 60 s after the first finish, racers still `racing` are DNF and the race closes. It also closes once nobody is `racing`, and at the event's time cap (`raceCapS`) + 30 s after the green light |
| Result | Finishers by time, lowest first (drift: by score, highest first, time breaking a tie), then the DNFs. The room goes back to `open`, everyone to `waiting`, and the result stays on the room as its last race |

**The other cars on screen.** A browser keeps the last poses of each other racer and draws the car where it was a short moment ago (the delay follows the measured lag, 80 to 600 ms), then carries it forward along the route by its rate of progress to where it is now. When poses stop arriving the carry fades over half a second and the car stands still. In the race's standings the other racers are ranked by that same distance along the route.

## Server

- `apps/sim/src/world/race.ts` (pure: no I/O, the clock and the random source passed in). The rules above: `makeCode`, `normalizeCode`, `createRoom`, `joinRoom`, `leaveRoom`, `setRace`, `startRace`, `markReady`, `claimFinish`, `quitRace`, `tick`, `sweep`, `roomView`, `invitation`, `holdsLoan`. Constants in one place: `RACE_MAX = 4`, `RACE_MIN = 2`, `ROOMS_MAX = 100`, `LOAD_TIMEOUT_MS = 30000`, `GO_LEAD_MS = 5000`, `FINISH_WINDOW_MS = 60000`, `EMPTY_TTL_MS = 120000`, `CLAIM_TOLERANCE_S = 0.5`, `SLOT_COLORS`.
- `apps/sim/src/world/rental.ts`: `lend(player, key, code, color, now)` adds the fleet car as a rental that costs nothing and carries `loan: <room code>`; `heldLoan`, `returnLoan`. Because it is a rental, every rental rule already holds: no parts, no tune, no bay order, no Garage, never saved to an account.
- `apps/sim/server.ts`, wiring only:
  - `GET /api/race/:code` → `{ ok: true, host, eventId, car, count, max, phase }`, or 404 `{ ok: false }`. Not cached.
  - `race_time` (acknowledged with the server's clock), `race_create {eventId, car}`, `race_join {code}`, `race_set {eventId, car}`, `race_start`, `race_ready`, `race_pose [t, x, z, h, v, s, score]`, `race_finish {time, score, failed}`, `race_quit`, `race_leave`. All ten join `VISITOR_EVENTS`.
  - Every change to a room is sent to its members as `race_room` (the whole room: code, race, car, host, phase, race number, the green light, when the window closes, members with place, state, time and score, the last result, a note when a race was called off). A refusal is `race_denied { why }`.
  - After every change the lent cars are made to match the room: a member who is `loading`, `ready`, `racing` or `finished` while a race is on holds one; anyone else does not. A finisher therefore keeps the car until the race closes, and a DNF hands it back at once.
  - A one-second timer runs `tick` on every room and sweeps the empty ones.
  - A socket leaves its room on `race_leave`, on disconnect, on a re-join, on sign-out, and when a sign-in replaces its run with a saved account.
  - While a player holds a lent car: `enter_event` is refused and `finish_outrun` pays nothing. While a player is in a room: `rent_car` and `test_car` are refused. A player holding a rental or a tester's car, or in a live event, cannot create or join a room.
  - Limits: one room per socket (creating or joining another leaves the first), one creation per 3 s per socket, 100 rooms, a pose at most every 40 ms per socket, every number in a pose finite and clamped.

## Client

- `apps/sim/src/world/strip/remote.ts` (pure): `RemoteCar`, the pose buffer of one other racer: `push(sample, now)`, `pose(now, route)`.
- `apps/sim/src/world/raceNet.ts`: what the 3D view needs from the network without re-rendering React: the clock offset (`syncClock`, `serverNow`) and the `RemoteCar` of each other racer.
- `apps/sim/src/world/strip/events.ts`: `EventRunner.start(ev, { net })`. With `net` (my grid place, the other racers, the green light, the clock) no computer racer is spawned; the others are racers whose state comes from the network; the countdown ends at the named instant; the race clock is the wall clock; the time cap does not apply; `onFinish` fires at the line.
- `apps/sim/src/world/strip/scene.ts`: racers from the network are placed from their `RemoteCar`, carry a name tag, and are left out of collisions.
- `apps/sim/src/store.ts`: `race` (the room as last sent), `raceCode` (the room this page means to be in: from the link, or made here; joined again after every reconnect), `raceDenied`, and the actions `createRace`, `joinRace`, `setRace`, `startRace`, `leaveRace`. The page's address follows the room: `?race=CODE` while in one.
- `apps/sim/src/strip/StripEntry.tsx`: with `?race=` in the address the card looks the room up, shows the invitation, and joins the room once the player is in the Strip. A room that is gone, or full, says so and leaves the ordinary guest card.
- `apps/sim/src/strip/Challenge.tsx`: the setup card (race, car, Get the link) and the waiting room (link, Share, members, Start, Leave, the last result, a race in progress).
- `apps/sim/src/world/DriveLayer.tsx`: the counter's **Challenge a friend** button; the waiting room in the counter's place while in a room; the results card waits for the race to close before it offers Continue; the pause menu offers no restart in a challenge.
- `apps/sim/src/VanillaThreeScene.tsx`: a lent car that arrives while a race is on is driven straight onto the grid; ready, poses, the finish and a quit go to the room's messages, never to `enter_event` or `finish_event`; the results card is built from the room.
- `apps/sim/src/i18n.tsx`: the new lines, English and Spanish.

## Errors

| The player sees | When |
|---|---|
| "That challenge has ended." with the ordinary guest card | The code is unknown: the room emptied out, or the server restarted |
| "That race is full." | Four people are already in |
| "Race in progress. You are in the next one." | Joined while the others are racing |
| "Not enough racers were ready. Try again." | A start was called off |
| "You missed the start. You are in the next one." | Still loading 30 s after Start |
| "Only the host can do that." | A member who is not the host asks to start or to change the race |
| "The Strip is busy. Try again in a minute." | 100 rooms exist, or rooms are being made too fast |
| "Finish what you are driving first." | Creating or joining while holding a rental or a tester's car, or in a live event |
| "Leave the challenge first." | Renting at the counter while in a room |

## Tests

- `race.test.ts`: codes use only the allowed characters and normalise; create refuses an unknown race, a race above the host's stage, an unknown car, and the 101st room; join refuses the fifth member and is harmless twice; start needs the host and two members; places rotate; ready from all starts the countdown; the slow are dropped at 30 s and a race with one ready racer is called off; the claim rule on each side of each bound; a finish before the floor is refused; the 60 s window and the cap make DNFs; drift ranks by score; a quit and a leave are DNFs and the others race on; the host hands over; the last result survives its racers leaving; an empty room is swept after two minutes and a join before that revives it.
- `rental.test.ts`: a lent car costs nothing, is a rental, carries the code and the colour, blocks a second rental, and goes back with its part record.
- `remote.test.ts`: interpolation between samples; heading turns the short way; out-of-order samples are dropped; the delay follows the lag; a car at constant speed is drawn where it is now whatever the delay; the carry follows a bend and wraps a lap; the carry fades when poses stop.
- `events.test.ts`: a race with `net` spawns no computer racer, takes its grid place from the field, waits for the green light and goes at the named instant, times itself on the wall clock, ranks the others by their progress, fires `onFinish` once at the line, and ignores the time cap.
- `stripFlow.test.ts`: the visitor's event list with the ten new events.
- `serverWiring.test.ts`: three sockets through a whole race: create, the lookup address, join, a fourth and fifth joiner, start by a non-host refused, start, cars lent in three colours, ready, the green light, poses reach the room and nobody else, finishes, the result, cars back, no money moved; a paid event refused while holding a lent car; a disconnect mid-race is a DNF and hands the host on; the race messages are open to a visitor.
- `strip.smoke.mjs`: two browsers. One makes a drag challenge and reads the link; the other opens it and joins; the host starts; both race; both results cards list both names; both are back in the waiting room with their $500.

## Out of scope

Prizes and stakes; bringing your own car; a link that carries a recorded result ("beat my time"); contact between cars; computer cars filling the grid; more than four racers; spectators; a challenge button in the dealer's town screens; a leaderboard or a saved history of challenges; chat inside the room (the world's chat is unchanged); moving rooms to a store that survives a restart.

## Left alone, noted for the owner

- A modified browser can report a time up to half a second better than it drove. Nothing rides on a challenge, so the bound was chosen to forgive a slow phone connection rather than to stop a cheat.
- `finish_outrun` still takes the browser's word that an outrun was won, as before. This work does not widen it: a lent car pays no outrun.
- Whether an open game connection keeps the free Render plan awake was not checked: render.com could not be reached from the workspace this was built in.
