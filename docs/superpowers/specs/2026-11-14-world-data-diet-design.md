# World data diet — design

Date: 2026-11-14
Status: **written, built and measured overnight by worker D while the owner was asleep** (the result is under "The result (measured)"). Every decision below that the owner did not make is marked "worker D's call", with the reason, so it can be checked and changed. Figures are measured unless marked as an estimate.

**Calls for the owner to check** (the owner's prompt said: "make each call yourself, write it down as your call, and keep going"; none of them needs money, an account or a secret). Each is a constant or a few lines, easy to change:

1. Who hears whom, how often: the 20 nearest within 200 m every 100 ms; within 400 m every 500 ms; the rest of the district every second; other districts every 5 seconds (section 2).
2. Positions rounded to 5 cm and headings to about 0.6° (section 3).
3. What a page reports about itself (its position, its car's fuel and town spot) does not count as a change to its record, for anyone; the record still goes whole and current whenever anything else in it changes, and to its own page after its own actions (section 4).
4. The joining player's copy hides other players' private fields, as `update` already did (section 4).
5. Tabs opened before the deploy keep getting the old messages until they reload (section 5).

## What this is for

MiCar World sends every player far more data than it needs to. Players' phones are the first thing to suffer when more people are online, and Render bills outbound data past 5 GB a month at $0.15 per GB (`2026-11-13-platform-upgrade-design.md`, Capacity). This change makes the World send each player much less, so the $7 instance's bandwidth and players' phones hold up with many people online.

Success: with 100 players online and everyone moving, each player downloads about 10 KB/s or less (the owner's estimate in the platform design), joining and acting stop costing every player a full copy of the state, and nothing changes on screen except that far-away players update less often. Nearby players move as smoothly as now.

## What the World sends today (measured)

Measured on 2026-11-14 with `apps/sim/e2e/data.ts` on the owner's PC (Windows 11, Node 22), run from a separate worktree at `origin/main` (`8412528`): a fresh World for each row, fake guests joining one at a time while standing still, then everyone driving circles at 72 km/h for 20 seconds, each sending its position ten times a second as the real page does. "Each player downloads" is what each fake player's TCP socket read, WebSocket framing included (not TCP/IP or TLS overhead). "All in the hub" puts everyone anywhere in the Strip's hub (about 600 by 320 m); "spread" deals players over the hub and the ten circuits in turn, each district's players within 150 m of its meeting point. Guests cannot enter the town, so the town is not in the tables. The figures are in `docs/superpowers/specs/2026-11-14-world-data-diet-data/` (`before-*.json`, `before-joins.txt`).

Driving only, as the owner asked:

| Layout | Online | Each player downloads | Of which positions | Joins, all players together | Server CPU (one PC core) | Server memory |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| All in the hub | 10 | 18.5 KB/s | 18.4 KB/s | 1.3 MB | 1.7% | 102 MB |
| All in the hub | 25 | 45.1 KB/s | 45.0 KB/s | 9.7 MB | 2.8% | 129 MB |
| All in the hub | 50 | 91.8 KB/s | 91.7 KB/s | 54 MB | 1.7% | 134 MB |
| All in the hub | 100 | 182 KB/s | 182 KB/s | 343 MB | 3.6% | 138 MB |
| Spread | 10 | 18.6 KB/s | 18.5 KB/s | 1.2 MB | 1.8% | 129 MB |
| Spread | 25 | 45.9 KB/s | 45.9 KB/s | 9.7 MB | 2.0% | 130 MB |
| Spread | 50 | 91.6 KB/s | 91.5 KB/s | 55 MB | 3.1% | 133 MB |
| Spread | 100 | 178 KB/s | 178 KB/s | 347 MB | 4.5% | 142 MB |

These agree with the throwaway measurement in the platform design (20, 49, 98 and 196 KB/s; 320 MB for 100 joins). Of the 343 MB of the 100 joins in the hub, 302 MB are full `update` copies, 35 MB positions and 5 MB the joiners' own `init`s. The ten nearest players within 200 m, and everyone else, update every 105 ms (median; 95th percentile 115 ms).

Playing (`play`: as above, plus a rental for each guest, its fuel every 1.5 s, and one action every 30 s per player, which the server refuses and answers with the state, as after any refusal), all in the hub:

| Online | Each player downloads | Of which positions | Of which full copies of the state | Server CPU | Server memory |
| ---: | ---: | ---: | ---: | ---: | ---: |
| 10 | 26.7 KB/s | 18.0 KB/s | 8.6 KB/s | 1.2% | 131 MB |
| 25 | 78.5 KB/s | 44.3 KB/s | 34.2 KB/s | 2.4% | 140 MB |
| 50 | 205 KB/s | 90.2 KB/s | 115 KB/s | 4.2% | 140 MB |
| 100 | 586 KB/s | 174 KB/s | 412 KB/s | 31.9% | 414 MB |

At 100 online the full copies cost more than the positions: 412 KB/s for each player, and the World used a third of a PC core and 414 MB of memory, against the $7 instance's half core and 512 MB. At that size the nearest players' updates also slipped (95th percentile 185 ms, from 115).

Why, read from `apps/sim/server.ts`:

1. **Positions.** Every 100 ms while anyone moves, the server sends every player one `player_positions` message holding every player's position, keyed by the 20-character socket id, with full-precision numbers: about 190 bytes per player, ten times a second, to everyone. The data grows with the square of the number online. Players in other circuits, 8 km away and never visible, are sent as often as the player alongside.
2. **Full copies of the state.** About 80 places call `broadcastState`, which sends every player an `update`: the whole game state (about 14.5 KB of market, junkyard, economy and shares) plus every player's record (about 0.8 KB for a guest, more for a dealer). A join calls it, so the 100th joiner makes the server send 100 copies of a 95 KB state: 302 of the 343 MB of the 100 joins. The same happens on every action anyone takes (renting, buying a part, finishing an event, or a refusal): at 100 online each action sends about 9.5 MB, which is the 412 KB/s each in the playing table.

## Goals, non-goals, anti-goals

Goals:
- Each player hears only what is near it often, what is far away rarely, and other districts' players hardly at all.
- A full copy of the state goes only to the player who needs it (a joining player). Everyone else is sent only what changed.
- Position messages get much smaller.
- The before-and-after numbers come from the same measuring program.

Non-goals:
- Race traffic (`race_pose`, `race_room` and the race code). Another worker owns it, and it already goes only to the four people in a room.
- What other players' records contain. This change sends them less often, not differently (see "Slimmer records" under Later).
- Compression, binary messages and new libraries.

Anti-goals (a failure even if the numbers drop):
- A nearby player who moves less smoothly than today.
- Anything else that looks different: a player missing, a stale name, a car on the wrong lot, a refused purchase that stays on screen.
- A tab opened before the deploy that silently freezes.

## Constraints

From the trial rules (`docs/superpowers/plans/2026-11-13-trial-rules.md`): no new dependencies or version changes; nothing new on screen; every visitor string through `t()` (this change adds none); Node 22; ports 3300 to 3399 for anything worker D starts. Files other lanes own are left alone: race messages and race code; `render.yaml`, `/healthz`, persistence and the load test (lane A); `apps/value/src/api`, `seo/api.ts`, `seo/pages.ts` and `valueRoute.ts` (lane C). In `apps/sim/server.ts`, lane A changes the imports under `persistence.js`, `/healthz`, the room-size line and `createRoom`; this change edits other lines (listed under Files).

## Approaches considered

1. **Per-player interest, smaller position messages, and state patches (chosen).** Each player gets its own position message each tick, holding only the players due for it: nearby ones every tick, distant ones less often. Positions become short numbers. Full copies of the state are replaced by patches holding only what changed for that player. It meets every goal, needs no library, and changes nothing on screen beyond the update rate of distant players. It costs more server work per tick (one small message per player instead of one shared one), which is cheap at these sizes and is measured.
2. **Slow everyone down** (positions five times a second for all) and shorten the messages. Simple, but nearby players would move half as smoothly, which the owner ruled out, and the data still grows with the square of the number online.
3. **One room per district, sent with socket.io's broadcast.** Cheap for the server, since each message is built once per district, but everyone in a crowded district still hears everyone in it at the full rate, so the hub at 100 online barely improves.
4. **Compression** (WebSocket permessage-deflate). Costs memory for every connection on a 512 MB instance and CPU on half a core, and does nothing for messages below its size threshold, which is most of them. The data would still grow with the square of the number online.
5. **Binary position messages.** About 12 bytes a player instead of about 21. Worker D's call: not now. Short number arrays meet the target, stay readable in a test, and need no second frame per message. Binary can come later if the numbers ask for it.

## The design

### 1. Districts

A district is the town, the Strip's hub, or one of the Strip's ten circuits: twelve in all. A Strip position's district is the 8 km grid square it falls in, rounded to the nearest square; the hub is the square at the centre. The circuits sit on that grid (`apps/sim/src/world/strip/tracks.json` offsets) and each reaches at most about 2 km from its offset, so the squares never mix them. Worker D's call: the grid needs no track files on the server and cannot disagree with them.

A player who is in the Strip but has not sent a Strip position yet (a guest's first moments) is placed by its stored position, which is in the hub.

### 2. Who hears whom, and how often

Every 100 ms, as today, the server decides for each player which other players' positions to send it. Distances are measured within a district, in metres.

| The other player is | You hear it |
| --- | --- |
| One of the 20 nearest to you in your district, within 200 m | every 100 ms, as today |
| Elsewhere in your district, within 400 m | every 500 ms |
| Elsewhere in your district | every second |
| In another district | every 5 seconds |

On top of that, whatever the distance:
- **Changes of district go out at once**, to everyone, and reliably: a player who leaves your circuit stops being drawn there straight away, and one who arrives is drawn straight away.
- **A player who stops** is sent once more, reliably, about 300 ms later, so the last position is right even if a moving update was dropped. Today's server does the same for everyone.
- **A new player** is sent everyone's current position at once, and everyone is sent the new player's.
- Moving updates are sent as today: they may be dropped when a phone's connection is backed up, because the next one is coming.
- A player is never sent its own position (the page does not use it).

Worker D's call on the numbers. The camera sees 3.25 km, but the Strip's fog hides most of what is past 1 km and a name tag 200 m away is a few pixels tall. Twenty players at full rate is the owner's own estimate ("if each player hears from at most about 20 others"). Players in other districts are never visible: the nearest two circuits are more than 6 km apart. The numbers are constants in one file, so they are easy to change.

### 3. Smaller position messages

A new message, `pos`: one flat array of whole numbers. Each player in it takes three to five numbers:

- `n * 4 + kind`, where `n` is the player's short number and `kind` says where the player is;
- kind 0, in the town: x, y, z, heading;
- kind 1, in the Strip: x, z, heading of its Strip pose (its town position is the Strip gate, as today);
- kind 2, in the Strip with no Strip pose yet: x, y, z, heading of its stored position.

x and z are in tenths of a world unit (5 cm), y in hundredths, heading in hundredths of a radian (about 0.6°). A player in the hub takes about 21 bytes, against about 190 today. The page turns each entry back into the object it uses today, so nothing that reads positions changes. Kind 1 carries no town position because there is only one: the server stores a Strip pose only in the handler that also sets the player's stored position to the gate (`server.ts`, `sync_player_pos`), and a wiring test compares the object an old page is sent with the one a new page decodes. The pose's height is always 0 (the page sends 0 in the Strip, `VanillaThreeScene.tsx:883`) and is not read (name tags float at a fixed height, `VanillaThreeScene.tsx:908-910`).

The short number `n` is given to each connection by the server and is part of every player's record the page receives. It is never saved.

### 4. A full copy only for the player who needs it

- A player joining gets the whole state in `init`, as today.
- Everyone else gets `patch` messages holding only what changed since the last copy or patch sent to them: the records of players who changed, the ids of players who left, and any part of the shared state (market, economy, the day, the clock, the host) that changed. The page applies a patch to the state it has. What a player may see of other players is exactly what `update` shows today.
- **The player whose action it was gets its own record back, changed or not.** The page shows some purchases before the server confirms them; when the server refuses one, today's full copy is what puts the page right. Keeping that for the player who acted keeps refusals working.
- **What a page reports about itself does not count as a change to a record.** A record changes while its player just plays: its position ten times a second (`sync_player_pos`, `server.ts` stores it in `worldPosition`), its car's fuel every 1.5 s while driving (`consume_fuel`), and a driven car's town spot three times a second in the town (`sync_car_pos`, the car's `lotPosition`). The server stores all three without a broadcast. When it decides whether a record changed for a page, it leaves those three out; when the record is sent for any other reason, it goes whole and current. Nobody needs them sooner, read from the page's code (`apps/sim/src`, every read of another player's record and of a car's fuel or spot):
  - Another player's record is read for its name (`VanillaThreeScene.tsx:899, 907, 1906-1916`; `scene/world/dealership.ts:137`; `App.tsx:177`), its lot's place (`VanillaThreeScene.tsx:1892-1896`, to build its dealership) and, as a fallback until a live position comes, its position (`App.tsx:92`, `VanillaThreeScene.tsx:1902`); with `pos`, a live position comes a tick after joining. Its cars are never read: every inventory read in the page is of the player's own (`me`, `meNow()`, `players[playerId]`: in `App.tsx`, `store.ts` `consumeFuel` and `openGarage`, `VanillaThreeScene.tsx:681, 923, 992, 1085, 1233, 1431-1625`, `world/GarageMenu.tsx:26, 35`). So no other player's fuel or car spot is ever shown.
  - The page that reports them has them already. It keeps its own tank in step as it reports it, because the server never answers `consume_fuel` (`store.ts` `consumeFuel`, whose comment explains that a stale copy once refilled the tank). It places its own car from `lotPosition` only when it first draws that car (`VanillaThreeScene.tsx:1496-1498`). It knows where it is.
  - And its own actions still bring its record back, whole (the rule above), so a refuel or a refused purchase is put right as today.

  Without this rule every action anyone took would also carry the records of everyone whose fuel or position had moved since, near a full copy again in real play; a moving dealer in the town (position ten times a second) would get its own record back on every action by anyone. (Raised by the builder check of this design, and by the boss's review of Task 1.)
- The joining player's `init` now hides other players' private fields the same way `update` does. Today the `init` briefly carries other players' money and gate codes until the next `update` replaces them.

Worker D's calls: a changed player's whole record is sent, not just the changed fields (simpler, and a guest's record is about 0.8 KB); the server finds what changed by comparing each part's JSON with what it last read, so none of the 80 callers of `broadcastState` has to say what it changed.

### 5. Tabs opened before the deploy

The page now says `proto: 2` when it joins. A connection that does not (a tab opened before the deploy, still running the old page) is sent the old `update` and `player_positions` messages, exactly as today, until it reloads. Worker D's call: a few lines of old code kept for a while, against an open tab that freezes silently after a deploy. It can be removed in a later release.

### 6. What changes on screen

- Players beyond your 20 nearest, or more than 200 m away, update less often. Within 400 m they update twice a second, which shows as slightly steppier movement of a figure or name tag a few pixels tall; past that, once a second; in other districts, where they are not visible, every 5 seconds. On the maps, their dots move less often.
- Positions are rounded to 5 cm and headings to about 0.6°.
- Nothing else.

### 7. Expected effect (estimates until measured)

- 100 players all in the hub: about 20 × 10 + 70 × 2 + 10 × 1, roughly 350 player updates a second at about 21 bytes: **about 7 to 8 KB/s each**, from 182.
- 100 players spread over the eleven Strip districts (about 9 in each): about 8 × 10 + 91 × 0.2, roughly 100 a second: **about 2 KB/s each**.
- 100 joins: about 10 MB in all, from 347 (each join sends the joiner one copy and everyone else the newcomer's record).
- One action at 100 online: about 0.8 KB to each player for a guest whose record changed, from about 95 KB, while everyone else drives too, since what pages report about themselves does not count (section 4). A refused action sends the player who tried its own record (about 1 to 2 KB) and nobody else anything.
- Playing at 100 online: the positions as above, and the full copies (412 KB/s each today) replaced by patches: with one refused action every 30 s per player, each player gets its own record about once every 30 s, so the state column falls to well under 1 KB/s each. A rough early run gave 0.2 KB/s.
- Server CPU: more work per position tick (one message per player instead of one shared one); a rough first run of the position part alone used about 7% of a PC core at 100 online driving, against 3.6% today. Much less work per action, since one action no longer serialises 100 copies of the state (31.9% today in play at 100).

## The result (measured)

Measured on 2026-11-14 on the owner's PC with `apps/sim/e2e/data.ts`, the same program on both sides: "before" on `origin/main` (`8412528`), "after" on the code branch's head, `lane-d/data-diet` `3c5aa0c`, each in a clean checkout. 20 seconds a row, as in the first measurement. The smoothness columns time the gap between position updates of each other player; the first of them is the twenty nearest players within 200 m, the ones this design keeps at full rate. An earlier "after" run on `19a90d3` (the commit before the head, which differs only in what a page is sent after a sign-out) gave the same traffic, row for row. The figures are in `2026-11-14-world-data-diet-data/` (`final-before-*` and `after-*`, one row per line in the `.jsonl` files, and `before-after.md`).

| Mode | Layout | Online | Each player downloads, KB/s | of which state | Joins, MB in all | Nearest twenty within 200 m, update gap ms (median / p95) | Rest of the district | Other districts | Server CPU | Server memory, MB |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| drive | all in the hub | 10 | 18.6 → **0.9** | 0.0 → 0.0 | 1.3 → 0.2 | 105 / 115 → 105 / 115 | 105 / 115 → 525 / 845 | — | 2.3% → 1.2% | 104 → 103 |
| drive | all in the hub | 25 | 46.0 → **2.5** | 0.0 → 0.0 | 9.6 → 0.9 | 105 / 115 → 105 / 115 | 105 / 115 → 525 / 955 | — | 2.2% → 2.8% | 130 → 135 |
| drive | all in the hub | 50 | 91.8 → **4.3** | 0.0 → 0.0 | 54.4 → 2.9 | 105 / 115 → 105 / 115 | 105 / 115 → 535 / 955 | — | 4.5% → 4.6% | 133 → 168 |
| drive | all in the hub | 100 | 184 → **6.1** | 0.0 → 0.0 | 344 → 10.0 | 105 / 115 → 105 / 115 | 105 / 115 → 525 / 955 | — | 6.3% → 5.6% | 139 → 174 |
| drive | spread over 11 | 10 | 18.5 → **0.1** | 0.0 → 0.0 | 1.2 → 0.2 | — | — | 105 / 115 → 4965 / 5005 | 1.5% → 1.4% | 130 → 129 |
| drive | spread over 11 | 25 | 45.7 → **0.4** | 0.0 → 0.0 | 10.0 → 0.9 | 105 / 115 → 105 / 115 | 105 / 115 → 525 / 545 | 105 / 115 → 4985 / 5055 | 1.9% → 1.4% | 130 → 131 |
| drive | spread over 11 | 50 | 91.1 → **0.9** | 0.0 → 0.0 | 54.2 → 2.9 | 105 / 115 → 105 / 115 | 105 / 115 → 525 / 545 | 105 / 115 → 5005 / 5035 | 3.2% → 2.0% | 133 → 161 |
| drive | spread over 11 | 100 | 182 → **1.9** | 0.0 → 0.0 | 346 → 10.0 | 105 / 115 → 105 / 115 | 105 / 115 → 525 / 545 | 105 / 115 → 4995 / 5035 | 6.5% → 5.3% | 138 → 173 |
| play | all in the hub | 10 | 27.2 → **1.0** | 8.8 → 0.1 | 1.3 → 0.2 | 105 / 115 → 105 / 115 | 105 / 115 → 525 / 755 | — | 0.5% → 1.3% | 128 → 103 |
| play | all in the hub | 25 | 80.2 → **2.6** | 34.4 → 0.1 | 9.6 → 0.9 | 105 / 115 → 105 / 115 | 105 / 115 → 525 / 955 | — | 3.2% → 3.1% | 114 → 113 |
| play | all in the hub | 50 | 206 → **4.4** | 115 → 0.1 | 54.6 → 2.9 | 105 / 115 → 105 / 115 | 105 / 115 → 525 / 955 | — | 5.5% → 2.2% | 165 → 169 |
| play | all in the hub | 100 | 582 → **6.2** | 410 → 0.1 | 344 → 10.1 | 105 / 175 → 105 / 115 | 105 / 175 → 525 / 955 | — | 29.0% → 7.7% | 464 → 175 |

What it shows:
- **Each player's download at 100 online: 6.1 KB/s all in the hub and 1.9 KB/s spread, from 184 and 182**, under the owner's estimate of about 10 KB/s. Playing, 6.2 KB/s from 582.
- **100 joins: 10 MB in all, from 344.**
- **The full copies of the state are gone**: in play at 100, 0.1 KB/s each from 410.
- **The nearest players move as smoothly as before**: 105 ms median and 115 ms 95th percentile at every size, before and after; in play at 100 the 95th percentile improved (175 → 115 ms). The rest of a district now updates about twice a second, and other districts every 5 seconds, as designed.
- **Server CPU**, as a share of one PC core, at 100 online: driving in the hub 6.3% → 5.6%, spread 6.5% → 5.3%, playing 29.0% → 7.7%. These figures move a few points between runs on this PC, which other workers share: the earlier "after" run had 7.3% driving in the hub, and the first, unpaired "before" had 3.6%. So driving costs about the same CPU as before, give or take that noise, and playing much less.
- **Server memory** (the process's working set at the end of a row): **driving at 50 and 100 online it was 28 to 36 MB larger than before** (133 → 168, 139 → 174, 133 → 161, 138 → 173 MB), at most 174 MB of the instance's 512 MB; playing at 100 it was 289 MB smaller (464 → 175). The working set moves with garbage collection: the two "after" runs differ by up to 27 MB in the same row (150 and 174 MB driving at 100 in the hub). The diet's own bookkeeping at 100 online, one record per pair of players and each player's record as JSON, is a few MB (estimate); the rest of the rise is not explained here.
- **Render's bill, an estimate** from the per-player rates (KB of 1024 bytes; GB of 10⁹): 100 people driving in the hub for an hour are sent about 2.2 GB in all, from about 68 GB; playing, about 2.3 GB from about 215 GB. Past the 5 GB a month included, at $0.15 per GB: about $0.34 an hour of such play, from about $32.

Not measured: the town (guests cannot enter it, so dealers are in the browser check but not in this table), real phones on a mobile network, TCP/IP and TLS headers, and Render itself.

## How it is checked

- Unit tests for the position format (round trips, rounding, the three kinds), the districts, the timing rules (with a fake clock: nearest at every tick, the others at their rates, district changes and stops sent at once and reliably), and the patches (a page that applies every patch ends with exactly what a fresh full copy would show it, through random changes, joins and departures, other players' drifting fields aside; the acting player always gets its record back; a driving player's fuel and position make no patch for anyone else, and are current when its record goes for another reason).
- Wiring tests against a real World in a child process: a new-protocol page gets `pos` and `patch` and never `update`; a near player arrives every tick and a far one rarely; a refused purchase returns the record to the player who tried it; other players' private fields never appear in a patch; a page that does not say `proto: 2` still gets `update` and `player_positions`.
- `apps/sim/e2e/data.ts` again, the same rows in both modes, and the before-and-after table in the pull request. The "before" rows run from a separate worktree at `origin/main` with the same `data.ts`, so both sides are measured the same way.
- Two real browsers on the built page: each sees the other's name tag move in the Strip.
- The existing tests, type check and build, with the known Windows-only failures noted.

## Files

New: `apps/sim/src/world/netPositions.ts` and its test (format, districts, timing); `apps/sim/src/world/stateSync.ts` and its test (views, patches); `apps/sim/src/world/dataDiet.wiring.test.ts` (its own World in a child process, so other lanes' edits to `serverWiring.test.ts` cannot clash with it); `apps/sim/e2e/data.ts`; `docs/superpowers/specs/2026-11-14-world-data-diet-data/` (the measurements, before and after).

This design, its plan and the measurements are one documents-only pull request; the code is another (the plan says why).

Changed: `apps/sim/server.ts` (the private-field view, `broadcastState`, the position relay, the `join` handler's two `init` lines and its protocol check, the handler wrapper that notes who acted, `disconnect`); `apps/sim/src/store.ts` (`proto: 2` in each join; `patch` and `pos` handled; positions merged and cleaned up); `apps/sim/src/types.ts` (the optional `n` on a player).

## Other calls worker D made overnight

- The measurement uses guests, which can only be in the Strip; "spread" means over the hub and the ten circuits, each district's players within 150 m of its meeting point (the hub's spawn, a circuit's lobby), as players gather. Players join standing still, so join data is counted apart from driving. The smoothness column of the first measurement counted the ten nearest players within 200 m; the final one counts the twenty nearest within 200 m, exactly the players the design keeps at full rate.
- A second mode, `play`, besides the owner's driving-only measurement: each guest rents a car, streams fuel as the page does and, once every 30 s, asks to tune its rental. The server refuses (a rental stays stock) and sends the state again, as after any refusal, so every action is counted as it reaches everyone. It shows what real play costs, which driving alone hides.
- One independent read of this design by a fresh agent before planning. It raised one question (the drifting fields, section 4); its answer is now in the design. No reviewer agent per task: the boss is the reviewer (trial rules, rule 3).

## Later, not in this change

- **Slimmer records of other players.** A patch still carries another player's whole record, cars included. The page reads only its name, its lot's place and, until its first `pos`, its position (section 4 lists the reads); sending only those would make each action smaller still, most of all for dealers with many cars. That changes what other pages hold, so it is left for its own change.
- **Shared state a Strip visitor never uses** (the market, the junkyard, the shares) is still sent to visitors when it changes.
- Removing the old protocol once no old tabs are left.
- Binary position messages, if the numbers ever ask for them.

## Risks

- **More work per tick for the server.** One message per player, built for that player. Measured by `data.ts` (server CPU column); the estimate is small next to the 25% budget in the platform design.
- **A missed change.** A part of the state that changes without anything calling `broadcastState` is not sent until the next call, exactly as today.
- **Old tabs.** Served the old way until they reload; that path keeps today's costs for those tabs only.
