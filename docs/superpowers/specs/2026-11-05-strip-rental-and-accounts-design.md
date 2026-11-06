# Strip spawn, car rental and accounts — design

Phase 2a shipped the Strip behind the town's gate: you reach it as a Dealer with a car of your own. This phase adds a front door. A link lands a visitor in the Strip as a guest with enough money to rent a car and race once; creating an account keeps what they earned and pays a daily allowance.

## What the player sees

1. **`/strip`** on the sim server (and a Pages redirect, like `/tuner/`) skips the Dealer setup screen. One card: "What do we call you?", then three buttons — *Race as guest*, *Sign in with Google*, *Email me a link*.
2. A guest spawns **on foot at the rental lot**, a building on the Strip grid at node [7,8], beside the exit gate at [8,8]. Guests carry **$500**, no dealer lot, `district: 'strip'`. The gate does not let a guest into town: "The Dealership is for account holders with a car of their own."
3. The **rental counter** (E, or tap) lists the three driving archetypes (Kanjo, Ronin, the sports car), stock, no tuning, **$500 for one event**. Renting debits $500, places the car in the lot's bay, and the player gets in.
4. The rental is bound to **one event**. When the event's results close (win, lose, fail or quit) the car returns itself to the bay and the player is on foot again. Winnings stay with the player. The results card says "Rental returned — $X on hand".
5. A guest at **$0** gets the counter's other line: "Make an account for a $1,000 daily allowance." Account holders with their own car can also rent, same price.
6. **Accounts** are passwordless. Google sign-in or an emailed magic link. Linking from a live guest session moves that session onto the account: money, Octane, stamps, Strip record, cars (minus any rental), name. Linking an identity that already has an account loads the saved record instead; the client warns first ("Your $1,350 from this session will be replaced by your saved account") and asks to confirm.
7. Signed-in players get a signed **session token** in localStorage, sent with `join`, so reloads and later visits restore the account without re-authenticating. *Sign out* (pause menu → Account panel) clears it.
8. **Daily allowance**: at the counter, account holders see *Collect today's $1,000* when `lastAllowance !== today (UTC)`. Claiming adds $1,000 and stamps the date. Skipped days do not stack. Nothing is granted on login.
9. Every `/strip` arrival — guest or account — spawns at the rental lot; an account made in the Strip has no dealer lot until it buys one in town.
10. A guest's progress lives for the session only. Quitting without an account loses it; the entry screen says so in one line.

## Decisions

1. **Separate URL, not a setup-screen option.** `/strip` is the funnel from the website; the Dealer/Shop setup is untouched.
2. **Both Google and magic link, no passwords.** Nothing secret about the player is stored; identities are a Google `sub` or an email.
3. **Accounts live in the server's JSON state** (`gameState.accounts`), the storage the server already has. One module owns it, so a database can replace it later without touching the game. Fine for hundreds of accounts.
4. **The rental car is an ordinary car** in the player's `cars`, flagged `rental: true`, so sync, same-district visibility and payout's `carId` work unchanged; the server strips it at return.
5. **Rental cars are stock and untunable.** The Garage opens only for owned cars. Tuning a rental is out of scope.
6. **Money is dollars, as everywhere.** $500 rental, $500 guest stake, $1,000 allowance; constants in one place.
7. **Guests cannot enter town.** Town assumes a dealer lot; a guest has none.

## Server

- `apps/sim/src/world/rental.ts` (pure): `RENTAL_PRICE = 500`, `GUEST_STAKE = 500`, `RENTAL_FLEET` (the three archetype keys), `canRent(player) → {ok} | {ok:false, reason}` (money ≥ price, no rental held), `rent(player, key, now) → Car` (debits, appends `{…, rental: true, eventBound: true}`), `returnRental(player) → Car | undefined` (removes the rental car, keeps money).
- `apps/sim/src/world/accounts.ts` (pure, injected clock/secret/fetch):
  - `signMagic(email, now, secret) → token`; `verifyMagic(token, now, secret, used: Set) → email | undefined` — HMAC-SHA256, 15-minute expiry, single use.
  - `verifyGoogle(idToken, clientId, keys) → sub | undefined` — RS256 signature against Google's JWKS (fetched and cached by the server, passed in), audience = client ID, issuer check, expiry.
  - `signSession(accountId, now, secret)`, `verifySession(token, now, secret) → accountId | undefined` — 30-day expiry.
  - `linkGuest(accounts, identity, guestPlayer, now) → {accountId, player, replaced: boolean}` — new identity: creates the account from the guest record (rental stripped); existing identity: returns the saved record and `replaced: true`.
  - `claimAllowance(account, today) → {ok, amount} | {ok:false, reason}` — `ALLOWANCE = 1000`, once per UTC date.
  - `saveRecord(account, player)` — what persists: name, money, octane, stamps, strip (rep, best, build/parts), cars without rentals.
- `server.ts` wiring only:
  - `join {mode:'guest', name}` → guest player (stake, no lot, district strip, spawn at the rental lot). `join {session}` → account player restored. `join` reply gains `caps: {google: boolean, magic: boolean}` from which env vars are set.
  - `rent_car {key}` → `rental.canRent`/`rent`, broadcasts update. `strip_denied` on refusal.
  - On `finish_event`, `finish_outrun`, `quit_event` and event abandon (`onAbandon`): if the driven car is a rental, `returnRental` after payout, then update.
  - `request_link {email}` → sends the link via Resend; `strip_denied` if `RESEND_API_KEY` is missing or the send fails. `link_account {google} | {magic}` → verify, `linkGuest`, reply `account_linked {accountId, session, replaced}`.
  - `claim_allowance` → `claimAllowance`, update.
  - Persistence: `gameState.accounts[accountId] = { identities: [{kind:'google', sub} | {kind:'email', email}], player, lastAllowance?: 'YYYY-MM-DD' }`, saved on every change; account records also saved on disconnect. Boot keeps `accounts`, still drops anonymous `players`.
  - Gate: `sync_player_pos` from a guest with `district:'town'` is refused; the client never offers the gate to guests.
- Secrets, Render environment only: `GOOGLE_CLIENT_ID` (public, but configured there), `MAGIC_SECRET`, `RESEND_API_KEY`, `MAGIC_FROM` (sender address). CI sets none; the server runs with both sign-in methods off and the smoke runs as a guest.

## Client

- `apps/sim/src/strip/StripEntry.tsx`: the `/strip` card; reads `#link=<token>` from the hash and sends `link_account {magic}` on load; loads Google Identity Services only when `caps.google`.
- `apps/sim/src/strip/AccountPanel.tsx`: identity, allowance status, Sign out; opened from the pause menu and the counter.
- `apps/sim/src/scene/world/rentalLot.ts`: the building and bay at node [7,8], the counter trigger; same `buildGate` style.
- `VanillaThreeScene.tsx`: on-foot state inside the Strip (walk, prompt at the counter), `rent_car` → get in the delivered car; on `update` with the rental gone, back to on-foot at the bay. Guests get no gate prompt.
- `DriveLayer.tsx`: counter menu (fleet + price, allowance line, account nudge at $0), rental-returned line on results.
- Store: `account?: {id, identity}`, `caps`, `session` token in localStorage under `micar.session` (reads wrapped in try/catch, like options).
- Door (`apps/value`) and the Strip copy gain the `/strip` link: "Race now — no account needed."

## Errors

All server refusals are `strip_denied {reason}` → the drive notice: can't afford the rental; already holding a rental; Google token invalid or expired; link expired or already used; couldn't send the link ("try Google or try again in a minute"); allowance already collected today; guests can't enter town. The server never trusts the client's money, date or identity.

## Tests

- `rental.test.ts`: price constants; refuses at $499 and when a rental is held; rent debits exactly $500 and appends a `rental: true` car; return removes it and keeps winnings; return with no rental is a no-op.
- `accounts.test.ts`: magic token round-trip; rejects expired, tampered and reused tokens; Google verification accepts a token signed by a stubbed key and rejects wrong audience, wrong issuer, expiry; session round-trip and expiry; `linkGuest` creates from a guest record with the rental stripped, loads an existing account with `replaced: true`; `claimAllowance` pays once per UTC date and refuses the second claim; boot keeps `accounts` and drops `players`.
- `server` handler tests where the existing suite has them: rental returned after `finish_event`, after `quit_event`, after abandon; guest `sync_player_pos` to town refused.
- Smoke (`strip.smoke.mjs`) gains a `/strip` guest run: name, rent, drag, results show the rental returned, money changed by −500 plus the prize.

## Out of scope

Octane store; buying cars inside the Strip; password accounts; tuning rental cars; moving accounts to a database; anything in town.
