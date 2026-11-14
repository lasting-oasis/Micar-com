# Big races: 8 to 16 cars on the Strip's circuits — design

Date: 2026-11-14
Status: **written overnight by worker B while the owner slept; every choice below marked "Call" is the worker's, made without asking, and the owner can overturn any of them.** Figures marked *measured* were taken on this PC on 2026-11-14; figures marked *estimate* are arithmetic, not measurement.

## What this is for

The owner asked on 2026-11-13 whether races of 8 to 16 people could run on the $7 instance (the platform design's "Capacity" section). The first rough measurement says the server's CPU and memory can carry them; what limits the World is data. This design is the other half: what a race of 16 needs on the page and on the server, how its grid fills when few people are online, and what it costs each phone and the server.

The aim is a race that feels full. Four cars on a Grand Prix circuit look like a test session; sixteen look like a race.

## What exists today (read from the repository)

- **A challenge room holds four** (`RACE_MAX` in `apps/sim/src/world/race.ts`). A room is made at the rental counter, joined by link (`/strip?race=CODE`), started by its host. Everyone drives the same lent car (`room.car`) in a colour by grid place (`SLOT_COLORS`, four colours). Nothing is won or lost (the challenge design, point 5).
- **The grid has four places** (`EventRunner.start` in `strip/events.ts`): two rows of two, 3 m either side of the line through route point 0 and 8 m apart, placed along a straight line back from the start. A drag has four lanes (`DRAG_LANES`, `NET_LANES`).
- **Each browser drives its own car** and sends a pose about 15 times a second (`sendPose` in `VanillaThreeScene.tsx`: `[server time, x, z, heading, speed, distance, drift score]`, full-precision numbers). The server relays each pose to the others in the room (`race_pose` in `server.ts`) and keeps none.
- **The page keeps at most three other cars** (`takePose` in `raceNet.ts` drops a fourth), and draws each as a full car (4 draw calls near, 2 far, `scene/carModel.ts`) with its own name tag (a 512×128 canvas sprite, one more draw call each, `nameSprite` in `strip/park.ts`). Other people's cars never collide with yours (`StripScene.collide`).
- **The HUD's timing tower** already shows only the rows that fit plus the player's (`towerRows` in `raceHud.ts`); the results card and the waiting room list every row.
- **The phone frame budget** on a circuit is 100 draw calls and 500,000 triangles (`e2e/tracks.smoke.mjs`).
- **The computer's racers** in a solo race are pure state stepped by `stepAI` (`strip/ai.ts`): metres and a route, no THREE. The server already loads every circuit's routes at boot (`readTrackSync` in `startServer`).
- **Lane A** is adding, as its first task on `lane-a/platform`: `Room.max`, `roomMaxFrom`, `ROOM_MAX_LIMIT = 16` and the server setting `RACE_ROOM_MAX` (a whole number from 4 to 16; anything else is 4). It exists for lane A's load test. This design treats it as **the server's ceiling**: the largest room the server will make. It stays 4 on Render until the owner raises it after the paid server's load test.

## Goals

1. The host picks the grid: **4, 8, 12 or 16**, never above the server's ceiling, which the page learns from the server. A drag keeps its four lanes.
2. **A 16-car starting grid on every non-drag event**, checked by a test on each one.
3. **Sixteen colours you can tell apart**, and a **number and name over every other car**.
4. **Up to 15 other cars inside the phone frame budget** on every circuit, checked by a smoke on each one.
5. **The lobby, the HUD's positions, the results card and payouts work for 16.**
6. **What 16 cars cost** the server and each phone: estimated here, measured with lane A's load test once it exists.
7. **A big grid fills when few people are online:** a quick race (open rooms per circuit) and computer drivers in the empty places.

## Not in this work

- Contact between cars (people pass through each other today, on purpose).
- Prizes, stakes or a ranking. A race of people still pays nothing (see Payouts).
- Solo races: still the player and three computer cars.
- How the town sends player positions (worker D), `render.yaml`, `/healthz`, persistence and the load test (worker A), the value API and SEO pages (lane C).
- Raising `RACE_ROOM_MAX` on Render: the owner does that, after the paid server's load test.
- Spectators, chat in the room, voice, a friends list.

## What would make this a failure even if it worked

- A 16-car race that drops a mid-range phone below a playable frame rate, or that only works on a desktop.
- Today's four-person challenge looking or behaving differently in a way nobody asked for: links already sent must still work, four-car grids must stand where they stand today.
- Rooms bigger than four on the live server before the owner raises the ceiling.
- A bandwidth bill that grows without anyone having said what it would be.

## Constraints

- Build on lane A's room size; don't write a second one. Until lane A's commit exists, work only in files that do not touch `race.ts` or `server.ts`.
- Every new string a visitor sees goes through `t()`, with a Spanish entry that uses "usted". Ids and option values stay English.
- No new dependencies, no lockfile change.
- The phone frame budget (100 draw calls, 500,000 triangles on a circuit) holds with 16 cars.
- Ports 3200–3299 for anything this work starts on the PC.

## Approaches considered

### Drawing up to fifteen other cars

1. **Every other car a full car, as today.** Fifteen cars at 4 draw calls plus a tag each is 75 calls before the circuit itself is drawn. Over the budget. Ruled out.
2. **The nearest few as full cars, everything else as the far model.** Still one far model per car (2 calls each) and one tag each: about 45 calls for fifteen cars. Probably over the budget on the busier circuits, and it gets worse as the race spreads out.
3. **One instanced field** (chosen). In a race of people everybody drives the same lent car, so every other car is the same body style in a different colour. All of them can be drawn as instances of one model: body (per-instance colour), trim, glass and wheels for the near ones, the far body and trim for the rest. That is **six draw calls for all fifteen**, near or far, wherever they are on the lap. The names and numbers go on the HUD canvas, which is drawn every frame anyway, so they cost no draw call at all.

Call: approach 3. It is the only one whose cost does not grow with the number of cars, and it removes fifteen per-car paint materials and fifteen tag textures as well.

### Sending fifteen cars' poses

1. **Keep today's relay; send fewer bytes per pose** (chosen for Part 1). The sender rounds what it sends (centimetres, milliradians, centimetres a second) and the server rounds again as it relays (an older page still sends long numbers). The message shape does not change, so lane A's load test keeps working unchanged.
2. **The server batches** the newest pose of every racer into one message per player per tick, and sends far cars less often. It saves more, but it is a new message, lane A's load test counts the old one, and it is not needed unless the measurement says so. Written down as the next step if the load test's 16-person rooms fail or cost too much (see "What 16 cars cost").

### Who drives the computer cars in a race of people

1. **Each browser drives them itself, from a shared seed.** The computer racers react to the player's own car (`stepAI` takes the player's distance), so every screen would see a different race and a different result. Ruled out.
2. **The host's browser drives them and sends their poses.** The race then depends on one phone: if the host's tab sleeps, fifteen cars stop. Ruled out.
3. **The server drives them** (chosen). `stepAI` is pure and already runs in Node (its tests do); the server already has every route. The server steps each computer driver 15 times a second and relays its pose exactly as it relays a person's. Every screen sees the same computer cars, and their finishing times are the server's own.

### Filling a grid from people who don't know each other

1. **Open rooms per circuit** (chosen, as the brief asks). Quick race: pick a circuit, and you join the room that is filling there, or open one. It starts by itself.
2. **One queue for everything, matched by the server.** Fewer empty rooms, but nobody chooses where they race, and it needs a matching service the World does not have. Not now.

## The design

### Room size and the server's ceiling (Part 1)

- `GRID_SIZES = [4, 8, 12, 16]`. A room's size is chosen when it is made and can be changed by its host while it is open, never below the number of people already in it.
- **The ceiling.** The server's `ROOM_MAX` (lane A: `roomMaxFrom(process.env.RACE_ROOM_MAX)`) is the largest size it makes. A size above the ceiling, or not one of the four, is refused. A page that sends no size gets the ceiling, as lane A's code already does: lane A's load test makes its rooms that way and relies on it. On the live server the ceiling is 4, so an old page still gets a room of 4. Call: keep lane A's rule rather than make "no size" mean 4, which would quietly stop its load test at rooms of four.
- **The page learns the ceiling** from the server's capabilities, the same object the Strip entry card already reads: `/api/caps` and the `init` message gain `raceMax`. Call: one number in the existing capabilities, not a new address.
- **A drag is always 4**: the picker offers only 4 for a drag, and the server refuses a drag in a room of more than four (or a room of more than four switching to a drag).
- **The picker shows only the sizes the server allows.** With the ceiling at 4 there is nothing to pick, so it does not show at all: **the live site looks exactly as it does today until the owner raises the ceiling.**
- The room carries its size (`max`) to the page, so the waiting room can say "7 of 16" and the page knows how many other cars to keep (at most `ROOM_MAX_LIMIT − 1 = 15`).

### The grid (Part 1)

*Measured* on all eighteen non-drag events (a script over the track files, cross-checked against the asphalt decoded from each circuit's model):

- Every circuit's asphalt is 10 m (Harbour), 11 m (Dry Lagoon, The Mountain) or 12 m wide, all the way back from every start; the walls the cars collide with stand 8.8 to 10 m from the centre line there.
- **Extending today's straight line back from the start fails on seven events**: the track bends behind the line, and a back place leaves the asphalt (Harbour GP and Harbour X at place 12 by 0.4 m, the Harbour Drift at place 6, the Figure Eight Drift at place 3, the Eifel GP at place 9, the Lone Star GP at place 6, the Mountain Drift at place 10). Today's own third place on the Figure Eight Drift is already 1.8 m off the asphalt.
- **Following the circuit fits all eighteen**, even for the largest car a player can bring: nearest asphalt edge 0.88 m, nearest wall 4.84 m, nearest two cars 0.88 m apart.
- The sprints and drifts have no route behind their start (their routes begin at the line; the drifts start mid-lap), but the circuit runs on behind every start.
- Today's start-up search for a car's distance looks only 30 m either way, so a car 40 to 56 m back would be read as 32.5 m back and be told "Wrong way" within a second.

So:

- **Row r stands 8r m behind the start point along the circuit's closed centre line** (rows of two, 3 m either side of the line, 8 m apart, as now), and each car faces the way the line runs at its own point. A place knows its own distance to the line, so the back rows are never taken for cars going the wrong way.
- Call: every place of a race of people follows the circuit, the first four included. Today's front row moves at most 0.14 m and 2.7 degrees, its second row at most 0.16 m on fifteen events; it moves 0.6 to 0.7 m on the Lone Star GP and the Harbour Drift, and 4.5 m on the Figure Eight Drift, where it was off the road. Solo races keep their four places (not this work); the Figure Eight Drift's third place is written down below as a found fault.
- **Checked on each one:** a test places all sixteen on every non-drag event and asserts each footprint (4.8 m by 2.0 m, the lent cars' largest) is at least 0.25 m inside the asphalt, at least 0.5 m from every wall the cars collide with, and clear of every other place; that the front row stands within 0.15 m and 3 degrees of where it stood; and that a car on the back row is not told it is going the wrong way.

### Colours and numbers (Part 1)

- **Sixteen colours.** The first four are today's (yellow, blue, red, white), so a four-car race looks as it does now. The other twelve are chosen to be as far apart as possible from each other and from the four; a test asserts every pair differs by at least a set distance in a perceptual colour space (CIEDE2000), so a later edit cannot slip in two near-twins.
- Colour alone cannot carry sixteen identities (no palette of sixteen survives every kind of colour blindness), so **each car also carries its number**: its grid place this race, 1 being pole. Call: the number is the grid place, which already decides the colour, so the colour, the number and the place all agree.
- **Over each other car, on the HUD:** a small dark label in the old tag's look, with the number on a chip in the car's colour and the name after it (cut to fit). It sits over the car's roof, scales down with distance, fades out beyond about 150 m, and is not drawn for a car behind the camera. It replaces the 3D name sprite in races of people (four-car races included, so there is one way, not two). Call: labels show through scenery, as in most racing games; a car is easier to find than to lose.

### Drawing the field (Part 1)

*Measured* on this PC (software GL; draw calls and triangles do not depend on the GPU), phone view, Low graphics:

| What | Draw calls | Triangles |
| --- | --- | --- |
| A circuit's scenery (Harbour, Ardennes, Royal Park; on the grid and on the lap) | 14–20 | 33k–59k |
| The player's own car (the rental, or the lent car): body 3, lamp glow 5, Night Tuner's wheels 56; never drawn far | 64 | 7.8k |
| Another person's car: near / far, its name tag included | 5 / 3 | 4.1k / 0.4k |
| The contact shadows of every car | 1 | 2 per car |
| A race of four people today, on the grid | 99 | 55k |
| A race of sixteen people with today's drawing (scenery + own car + fifteen others) | about 124–160 (derived) | 50k–130k |

So draw calls are the limit, not triangles, and the player's own car already takes 64 of the 100. Fifteen others at today's 3 to 5 calls each cannot fit; drawn as one field they cost about seven.

- In a race of people, the other cars are not built as separate car models. One **field** holds six instanced meshes of the room's car: body (one paint material, per-instance colour), trim, glass and wheels (four instances per car) for near cars; the far body and trim for far cars. Each frame the field writes one matrix per car (four per car for the wheels) and splits the cars near/far by their distance to the camera, using the same distances as `updateCars` (45 m on Low graphics, 60 m on High). Instances not drawn are left out of the count, not hidden, so their triangles are not counted either.
- At most a set number of cars are drawn near (call: 6 on Low, 10 on High); further near cars are drawn far. This caps the triangles of a grid start, where all fifteen are close.
- The field's cars stand on their own instanced contact shadows (one more call), so the frame of a sixteen-car race is about scenery 20 + own car 64 + shadows 1 + field 7 = 92 calls at worst (estimate until the smoke measures it).
- The player's own car stays a full car, as today. Solo races keep their kitted computer cars, as today.
- Found while measuring, not this work: a solo lap race draws 218 to 414 calls at the green light (the computer racers' Night Tuner kits and wheels: 78 to 172 calls each, near), two to four times the budget. `e2e/tracks.smoke.mjs` does not see it, because it measures only after teleporting the player a long way from the grid. Worth its own fix.
- **Checked on each one:** a smoke puts 15 other cars on the grid of every circuit's lap race and at two places on the lap, and asserts the frame stays inside 100 draw calls and 500,000 triangles on a phone-sized view with Low graphics.

### The lobby, the HUD and the results for 16 (Part 1)

- **Making a room** (the challenge card): a **Grid** row of size buttons under the car, only when the ceiling is above 4. A drag shows "A drag race has four lanes" instead.
- **The waiting room:** "Racers 7 / 16" over the list; each row shows the grid number once a race is on. The host's Start and Change buttons stay at the foot of the card while the list scrolls (the card already scrolls on a short screen).
- **The timing tower** keeps its rule: the rows that fit, and the player's row. Its 16 rows are checked at 375 px portrait, a landscape phone and 1280 px.
- **The route map** shows a dot per car in its colour; the player stays the yellow arrow on top.
- **The results card** lists all sixteen; its Continue button stays at the foot of the card while the list scrolls.
- **The link card** (the Strip entry, from a link): "3 of 16 are in" beside the race, so a joiner knows how big the race is.

### Payouts (Part 1: no change)

A race of people pays nothing and records nothing, at any size, as the challenge design decided ("Nothing won, nothing lost"). Call: keep it, because a bigger room makes the old risk bigger: one person with two tabs can always finish first, and sixteen places give more to farm. `validateFinish`'s rule that a paid finish is placed 1 to 4 stays: paid events are solo, with four cars.

If the owner wants prizes for big races later, it needs, first: accounts on, one account per seat, and a payout table by place for N cars (for example the top half paid, scaled from the solo table's 100/40/20). That is a separate design.

### What 16 cars cost (estimate; measured by lane A's load test)

*Measured* on this PC (two socket clients through a real room; the websocket frames read raw; no compression is negotiated): a relayed pose is a **151-byte** message plus a 4-byte frame header (`42["race_pose",["<20-character id>",1794637215464.5,16098.616765074097,…]]`: every number travels with 15 to 18 digits); what a racer sends is 128 bytes plus its header. Rounded to the centimetre and the milliradian (Part 1, Task 5) the same relayed pose is about **92 bytes** plus a 2-byte header (estimate from the same example).

- **Messages**, per 16-person room: 16 racers × 15 poses a second in, 3,600 relayed poses a second out (16 × 15 × 15). Each phone receives 225 a second and sends 15.
- **Data, today's format** (estimate from the measured size): each phone downloads about 35 KB/s (about 125 MB an hour) and uploads about 2 KB/s; the server sends about 560 KB/s per 16-person race, **about 2 GB per race-hour**. On Render's Hobby workspace, past its free 5 GB a month, that is about $0.30 per race-hour.
- **Data, rounded** (Task 5; estimate): about 21 KB/s per phone (about 76 MB an hour) and about 340 KB/s from the server, **about 1.2 GB per race-hour**, about $0.18 past the free 5 GB.
- **Server CPU and memory:** lane A's rough measurement (platform design, Capacity) ran one 16-person room at 4.6% of a core and four at 11.5%, memory under 210 MB. That fits the $7 instance by the spec's own limit (25% of one PC core).
- **Computer drivers (Part 3)** add server work: about 17 route look-ups per car per step, 15 steps a second (estimate: well under 1% of a core for fifteen cars). Their poses cost the same bandwidth as a person's going out, and nothing coming in.
- **How it gets measured:** lane A's load test (`apps/sim/e2e/load.ts`, Task 5 of its plan) races fake players in rooms of 4, 8 and 16 on this PC and reads the server's CPU, lag and memory from `/healthz`. When it exists, run `STEPS=16x1,16x2,16x3` against this branch and put the table in Part 1's pull request; until then that pull request says it is not measured. On the paid server the owner decides when (its runbook, Task 5 step 4).
- **The trigger for the batched relay:** if a 16-person room fails the load test's limits, or the measured data comes to more than about 1 GB per race-hour, Part 1's follow-up is approach 2 above (batch and thin the poses) before the ceiling is raised.

### Quick race (Part 2)

- **Where:** at the rental counter, beside "Challenge a friend": **Quick race**. It lists the ten circuits, each with how many people are waiting there now. A circuit whose quick race the player's stage has not opened shows locked, as in the Races menu.
- **Each circuit has one quick event**, fixed: its lowest-stage lap race (a circuit race, then a street X, then a sprint on a tie). Today that is Harbour GP, Lagoons Sprint, Dry Lagoon X (all stage 1), Royal Park GP, Airfield Sprint (stage 2), Figure Eight GP, Eifel GP, Mountain Sprint (stage 3), Lone Star GP (stage 4) and Ardennes GP (stage 5): one per circuit, computed from the event library, not typed. Call: a fixed event per circuit so that everyone who picks a circuit lands in the same room; and the car is always the Ronin GT, so nobody has to agree on one.
- **Open rooms per circuit:** the server keeps at most one quick room per circuit that is open and has space. Picking a circuit joins it, or opens one at the size of the ceiling. A quick room has a link too, so a friend can be brought along.
- **It starts by itself:** 30 seconds after a second person arrives (the countdown shows in the waiting room), or as soon as it is full. Its first member can start it earlier, as a host can. After a race the room carries on; anyone may leave.
- **The server checks the stage** of whoever asks, joining or opening.

### Computer drivers in the empty places (Part 3)

- **When a race starts with empty places,** the server puts a computer driver in each, up to the room's size: always in a quick race; in a room made by link, only if its host switched "Fill the grid" on (call: off by default, so a race between friends stays between friends unless they ask).
- **The server drives them:** 15 steps a second with `stepAI`, on the room's route, at the lent car's top speed and acceleration (from the rental fleet's car), each a little slower or faster than the next (call: a spread of 82% to 96% of the car's top speed, so people can beat most of them). Their poses go to the room as `race_pose`, with ids that start `ai:`, and pages draw them like any other car.
- **They are marked:** the label over the car and the row in the tower and results say CPU after the name (call: one short word, the same in both languages).
- **Their finishes are the server's:** a computer driver's time is the server's clock when it crosses the line. When every person is home or out, the race closes and any computer driver still running is given an estimated time from its distance and speed, marked with an asterisk, as solo races already do.
- **Nothing is won or lost**, as in every race of people.

## How it is checked

- Pure rules (sizes, the ceiling, the grid, the colours, the quick event, the computer drivers' stepping and results) are unit tests beside the code they test.
- The server's wiring: a test starts the real server with `RACE_ROOM_MAX=16` and drives sixteen sockets through a room of 16: made with size 16, fifteen join, a seventeenth is refused, a drag is refused, the race starts, poses reach the other fifteen, everyone finishes, the result has sixteen rows, no money moved. A second server without the setting refuses a room of 8 and reports `raceMax: 4`.
- In a real browser: a smoke runs one browser as host and fifteen scripted racers (socket clients that drive the route) on a server started with `RACE_ROOM_MAX=16`, through the lobby, the grid, the race and the results, screenshots at 375 px and 1280 px in English and Spanish, and the draw calls on every circuit.

## Owner steps

- **Raise the ceiling** (`RACE_ROOM_MAX=16` under Environment in Render) only after the paid server's load test has passed with rooms of 16. Until then the site behaves as today.
- **Decide on prizes** for races of people, if ever (see Payouts).

## Risks and open items

- **A slow phone on a big grid.** Fifteen cars drawn as instances cost little, but the page also decodes 225 messages a second. Not measured on a real phone; the smoke uses software rendering on a PC.
- **The 60-second finish window.** With sixteen people of mixed skill, the slowest may be more than a minute behind the winner on a long race and be marked out. Today's rule, unchanged; worth watching.
- **Quick rooms when nobody is online** start with one person and computer drivers only once Part 3 exists; before it, a quick race needs two people.
- **Lane A's load test** is the only measurement of the server under 16-person rooms; until it runs on this branch, the cost figures here are estimates.
