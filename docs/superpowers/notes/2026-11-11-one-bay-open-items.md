# One bay: open items after Stage 1

Note for later. Date: 2026-11-11. Stage 1 was merged to `main` as `7cc137c` (pull request #8). Nothing here is decided; each item waits for the owner. The plan is `docs/superpowers/plans/2026-11-11-one-bay.md`, the design `docs/superpowers/specs/2026-11-11-one-bay-design.md`.

## 1. What a small leftover fault costs

Every fault in the catalogue comes in a fixed size: 5, 10, 15, 35, 40 or 45 points. A car's lost points rarely divide by 5. A trade-in with a body score of 48 has lost 52 points: catalogue faults cover 50, and 2 are left over. The leftover becomes the smallest fault in its trade at a smaller size: a Misfiring Engine (mechanical) or a Cracked Windshield (body). About four trade-ins in five get one in each trade.

| | As merged: per point | Alternative: whole repair |
| --- | --- | --- |
| 2-point Cracked Windshield | $100 | $250 |
| 2-point Misfiring Engine | $60 | $150 |
| Range | $30 to $200 | always $150 or $250 |

- For per point: restoring 1 point never costs $250, and it matches the design's "the libraries' own cost per point".
- For whole repair: a repair always costs its list price. It also avoids an oddity: as merged, the stock part for a windshield ($187 in the Parts Store) can cost more than the small repair it would make free.
- On a trade-in that takes about $3,800 to clear, the difference is roughly $100 to $300 a car.
- Where: `explainCondition` in `apps/sim/src/bay/faults.ts`, the remainder's `cost`. One line either way, and one test.

## 2. Two things outside the plan

Both were in the code before Stage 1. The final review found them by reading; neither was run.

- **The trade-in value the server trusts.** When a dealer closes a sale with a trade-in (`finalize_deal` in `apps/sim/server.ts`), the page says what the trade-in is worth and the server believes it. That value becomes the car's buy price, and insurance claims and title loans pay on buy price. A tampered page could claim a large value and then borrow or claim against it. Dealer cash is not saved or carried into an account, so the damage is to fair play. The fix is for the server to set or cap the value. Not yet sized: how much the server already knows about the customer's trade-in has not been looked at.
- **Other players' money in the first data a page receives.** On joining, the page gets one full copy of the game state (`publicState`, sent as `init`), and it includes other players' cash. Every later update hides it. The fix is to hide the same fields in that first copy, after checking that no screen relies on them.

Each would be a small pull request of its own.

## 3. Stage 2 waits for a go

Stage 2 (Tasks 6 to 9 of the plan) adds the tuner's bolt-on parts to today's Garage: 17 new choices in 12 categories, drawn on all seven body styles, each offered only on bodies it fits. It ends with a contact sheet of every body with each kit for the owner to look at before anything merges.

- Placeholder prices stand: lift $900 and $1,900, all-terrain tires $980, spare carrier $380.
- Needed: a yes, and whether to run it as Stage 1 was (a builder per task, a checker, a final review).
- Suggested first: confirm the Stage 1 deploy on the live site (the Parts Store shows "Fixes: ..." under each part).
- Read "Stage 1 as built" at the end of the plan before starting.

## 4. GitHub's checks were queued at merge time

GitHub's CI for the final commit (`15b733f`) had not started 35 minutes after it was requested, and no run had started for the merge. The same steps were run by hand on a clean copy of that commit before merging and passed: 790 value tests, 494 sim tests, both builds, both browser smoke tests. The home page deploys through a GitHub run, so it may lag until the queue moves.
