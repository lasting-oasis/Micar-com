# Three-Worker Trial — Rules and Runbook

Date: 2026-11-13
Status: **proposed.** Nothing here has been run yet. Every target and cost below is an estimate until the trial measures it, and is marked as one.

## What the trial is for

One question: do three AI workers building at the same time, each gated by the boss on the Pi, get more good work merged than one worker does, without the owner becoming the bottleneck?

Three workers for seven days, measured. Add workers only if the numbers say so.

The work itself is real. It is the first stage of the platform upgrade (`docs/superpowers/specs/2026-11-13-platform-upgrade-design.md`), the first piece of "type your car, get its card, race a friend", and the trust fixes that came out of the title debate.

## Who does what

| Who | Where | Does |
| --- | --- | --- |
| Worker A | An Opus session on the PC, worktree `~/Micar-com-lane-a` | Lane A, the platform: `2026-11-13-trial-lane-a-foundation.md` |
| Worker B | An Opus session on the PC, worktree `~/Micar-com-lane-b` | Lane B, the card-race challenge: `2026-11-13-trial-lane-b-card-challenge.md` |
| Worker C | Claude in the cloud, in the chat where this plan was made | Lane C, the trust fixes: `2026-11-13-trial-lane-c-trust-fixes.md` |
| The relay | A third, short-lived session on the PC | Carries lane C's finished parts to the boss. Changes no code. |
| The boss | Fable 5.2 on the Pi | One review per submission. Approves at 8 out of 10 or better with no high-severity problem. |
| The owner | | Says yes to the plan, pays, types secrets, merges. Nobody else merges. |

## The lanes, and what waits for what

| Lane and part | Branch | Can start |
| --- | --- | --- |
| A, Part 1: the World keeps its data; preview links; one build for any address; a load test on this PC | `lane-a/platform` | Now |
| A, Part 2: one address book | `lane-a/addresses` | After C, Part 1 is merged |
| A, Part 3: the domain; accounts on; visitor counts | `lane-a/domain` | After Part 2 is merged, the World has been seen to keep its data across a deploy, and the owner has bought the domain |
| B: challenge a friend to a card race | `lane-b/card-challenge` | Now |
| C, Part 1: the valuation API gives no number for a branded title | `lane-c/api-branded` | Now, and first: pull request #21 was merged without it |
| C, Part 2: trust wording | `lane-c/trust-wording` | Now |

There is one hard chain: **C, Part 1 is merged → A, Part 2 starts.** Both change `seo/api.ts` and `api/valueApi.ts`. Everything else can merge in any order once the boss approves it. Whoever merges second rebases.

## Rules for every worker

1. **Read first.** This file, then your lane's plan, then the spec your plan names. Work task by task. A task is done when its checks pass and the boss approves it.
2. **Your own worktree and branch.** Never work in `~/Micar-com` itself, never on `main`, never in another lane's folder. Use Node 22 (`fnm use 22`) and `pnpm install --frozen-lockfile`.
3. **Build it yourself,** in your own session (`superpowers:executing-plans`, if you have it). Do not start a reviewer subagent for each task: the boss is the independent reviewer, and a second one spends the plan's usage twice.
4. **Edit only your lane's files.** Each plan lists them under Global Constraints. If a task needs a file that belongs to another lane, stop and say so.
5. **Never type a MiCar address.** Import `SITE_URL` and `WORLD_URL` from `@micar/brand`. Old strays are lane A's to remove; add no new ones.
6. **Two languages.** Every string a visitor sees goes through `t()` and has a Spanish entry written with "usted". Option values and ids stay English.
7. **One API shape.** Success is `{ ok: true, … }`. Failure is `{ ok: false, errors: { field: message } }`.
8. **No new dependencies,** no version changes, no lockfile changes. If `pnpm-lock.yaml` shows as changed, undo it.
9. **Keep the look.** Change nothing on screen that your plan does not name.
10. **Money, accounts and secrets are the owner's.** A step marked OWNER stops you. A secret is never written in the repository, in a pull request or in chat.
11. **One PC, two workers.** Stop only a process you started, by its own id. Never stop every `node` process: the other worker's are running too. Use the ports your plan names, or let a script pick a free one. If git reports a lock file, wait ten seconds and try once more; if it is still there, tell the owner. Do not run `git gc` or `git worktree prune`.
12. **Say what you did not test.** In every request to the boss and every pull request, name what was not checked and mark any estimate as an estimate.
13. **When you need the owner,** send one short message that starts with what you need.

## The boss

The standing rule on the PC applies: a task is not done until the boss approves it.

1. Run your lane's checks. They are listed under Global Constraints in your plan.
2. Commit.
3. Write `.boss/request.md`: what changed, why, which plan and task it carries out, how you checked it, and what is unfinished or untested. Add the line `Visual: yes` if the change shows on screen, otherwise `Visual: no`.
4. Put the checks' full output in `.boss/tests.txt`. For visual work put up to 8 screenshots in `.boss/shots/`, at 375 px wide and at 1280 px, in English and in Spanish where words changed.
5. Run `bash ~/.micar-boss/ask.sh` and allow it up to 10 minutes. Use the default effort. `--effort max` is for when the owner asks: its cost has not been measured.
6. Exit 0 is approved. Exit 1 is rejected: check each problem against the code, fix the ones that are right, and answer the wrong ones with evidence in the next `request.md`. Exit 2 is an error: tell the owner.
7. After three rejections of the same task, stop and tell the owner. The verdicts are in `.boss/verdicts/`.
8. `.boss/` is never committed. Do not change `~/.micar-boss/`.

Where a plan mentions the boss only at the end of a part, the reviews after each task still happen. The last one is the review the pull request cites.

### Lane C and the boss

The cloud cannot reach the Pi, so lane C's reviews go through the PC:

1. Worker C finishes a part, runs the checks in the cloud, pushes, and writes the pull request's description in the form below. That description is the request.
2. The owner tells the relay session which branch. The relay checks the branch out on the PC, **runs the checks again there**, takes any screenshots, and runs `ask.sh`.
3. The relay posts the boss's verdict on the pull request as a comment. Worker C reads it there. If the relay cannot post, the owner pastes the verdict to worker C.

So lane C is reviewed once per part, not once per task, and each review costs the owner one message. That is a known weakness of a cloud worker. The trial measures how much it costs.

## Pull requests

- One per part, with the title the plan gives. Never merge it.
- The description uses these headings: **What changed**, **Why**, **Plan** (the file, part and tasks), **How it was checked** (commands and results; what was looked at, at which widths, in which languages), **Not done or not tested**, then the line `Visual: yes` or `Visual: no`.
- Once approved, add one line: `Boss: APPROVED 9/10 after 2 reviews`, with the real numbers.
- GitHub's own checks must be green before the owner is asked to merge.
- After another lane's pull request is merged: `git fetch origin`, `git rebase origin/main`, run the checks again, and push your own branch with `--force-with-lease`. Never push to another lane's branch.

## Files more than one lane touches

Each lane changes different lines, so git should merge them without help. If it does not, that is a clash: write it on the scoreboard.

| File | Lane A | Lane B | Lane C |
| --- | --- | --- | --- |
| `render.yaml` | Part 1: the plan id, health check and disk, directly under `plan:`; a second service at the end | | |
| `apps/sim/server.ts` | Part 1: an import under the `persistence.js` import, `/healthz` above `/api/caps`, the room-size line beside `ROOM_GAP_MS` and the `createRoom` call. Part 2: `DEFAULT_ORIGIN` | | |
| `apps/sim/src/world/race.ts` | Part 1: a room's size (`Room.max`, `roomMaxFrom`), for the load test only | | |
| `apps/value/src/door/Door.tsx` | Part 1: the `BASE` line, only if it is at fault. Part 2: the Strip link, line 253 | | Part 2: the sentence at line 161 |
| `apps/value/src/seo/pages.ts`, `seo/api.ts`, `api/valueApi.ts` | Part 2, after C, Part 1 is merged: address lines | | Part 1 |
| `apps/value/src/garage/` | Part 1: the `BASE` line of `CollectibleCard.tsx` and `back.ts`, only if at fault | The challenge files, `Garage.tsx`, `RacePanel.tsx`, `panels.css`, `es-panels.ts`, `es.test.ts` | Part 2: one line of `PassportPanel.tsx` |
| `apps/value/src/App.tsx`, `i18n-es.ts`, `i18n.test.ts`, `engine/data.ts` | | | Part 2: all of it |

## Runbook for the owner

**Before anything is built**

1. Read the platform design. It is short, and it asks for one yes: about $7.25 a month from the day lane A's first pull request is merged, and about $1 a month more once a domain is bought.
2. Merge the latest plan pull request, if one is open. Plan pull requests hold documents only. The workers read their plans from `main`.

**Start the three lanes**

3. Worker A: in the Claude desktop app, start a new Code session on the `Micar-com` folder with Opus, and paste "Prompt for worker A" from below.
4. Worker B: the same in a second session, with "Prompt for worker B".
5. Worker C: say "go lane C" in the chat where this plan was made.

**While they work**

6. When worker C says a part is pushed, start a third Code session, paste "Prompt for the relay", and name the branch. Keep that session open; for the next review, type the branch name again.
7. When a pull request says the boss approved it and GitHub's checks are green, look at it and merge it. Until lane A's Part 1 is live, look at the screenshots in the pull request. After that, each pull request should also get a preview link that opens on a phone (expected from Render's previews; not seen working yet).
8. Do the owner's steps as they come up. Each one stops a worker until it is done:

| When | What |
| --- | --- |
| Before merging lane A, Part 1 | Add a payment method in Render. Merging is the yes to about $7.25 a month. Then apply the Blueprint, reading what Render says it will change before approving. |
| After that | Press "Manual Deploy" once when worker A asks, so it can prove the World kept its data. |
| Any time | Choose and buy the domain, then tell worker A its name. |
| With the domain | The DNS records worker A lists; the custom domain in GitHub's Pages settings; the worker's `ALLOWED_ORIGIN` in Cloudflare. |
| To turn accounts on | Resend: add the domain. Render: type the four secrets. Google sign-in, if wanted: add the new address to the client's allowed origins. |
| Optional | Two Cloudflare Web Analytics sites, one per new address, and hand worker A the two tokens. |

9. Each evening, tell worker C two numbers: the plan's usage so far, and roughly how many minutes the trial took of your day. Worker C keeps the scoreboard.

### Prompt for worker A

```
You are worker A in MiCar's three-worker trial. Your lane is the platform.

1. Work in your own git worktree of the Micar-com repository, on a new branch named lane-a/platform made from origin/main. If this session already has its own worktree, stay in it and rename its branch. Otherwise make one beside the main clone, named like the others: ~/Micar-com-lane-a. Never work in ~/Micar-com itself or on main. Use Node 22 (fnm use 22) and run pnpm install --frozen-lockfile.
2. Read docs/superpowers/plans/2026-11-13-trial-rules.md, then docs/superpowers/specs/2026-11-13-platform-upgrade-design.md, then your plan: docs/superpowers/plans/2026-11-13-trial-lane-a-foundation.md.
3. Do Part 1 of the plan, task by task, yourself. After each task: run the checks, commit, write .boss/request.md and .boss/tests.txt, and run bash ~/.micar-boss/ask.sh.
4. When the last task of Part 1 is approved, push the branch and open one pull request with the title the plan gives. Do not merge it.
5. Stop and send me one short message that starts with what you need when: a step is marked OWNER; a step needs a secret, money or an account; a task needs a file the rules give to another lane; or the boss has rejected the same task three times.
6. Parts 2 and 3 wait for the conditions the plan names. When I tell you one is met, start that part on its own new branch from the latest origin/main.
```

### Prompt for worker B

```
You are worker B in MiCar's three-worker trial. Your lane is "challenge a friend to a card race" in the Garage.

1. Work in your own git worktree of the Micar-com repository, on a new branch named lane-b/card-challenge made from origin/main. If this session already has its own worktree, stay in it and rename its branch. Otherwise make one beside the main clone, named like the others: ~/Micar-com-lane-b. Never work in ~/Micar-com itself or on main. Use Node 22 (fnm use 22) and run pnpm install --frozen-lockfile.
2. Read docs/superpowers/plans/2026-11-13-trial-rules.md, then your plan: docs/superpowers/plans/2026-11-13-trial-lane-b-card-challenge.md. The plan is its own design.
3. Do the plan task by task, yourself. After each task: run the checks, commit, write .boss/request.md and .boss/tests.txt (and .boss/shots/ for anything that shows on screen), and run bash ~/.micar-boss/ask.sh.
4. When the last task is approved, push the branch and open one pull request with the title the plan gives. Do not merge it.
5. Stop and send me one short message that starts with what you need when: a task needs a file the rules give to another lane; a step needs a secret, money or an account; or the boss has rejected the same task three times.
```

### Prompt for the relay

```
You are the relay for lane C in MiCar's three-worker trial. Lane C's code is written by Claude in the cloud and pushed to GitHub. The cloud cannot reach the boss on the Pi, so you carry each finished part to the boss from this PC. You change no code and you fix nothing.

Read docs/superpowers/plans/2026-11-13-trial-rules.md first. Then, for the branch I name (lane-c/api-branded or lane-c/trust-wording):

1. In the main clone run git fetch origin. Use one worktree for lane C, ~/Micar-com-lane-c (make it the first time), switch it to that branch and bring it to exactly origin/<branch>. Use Node 22 (fnm use 22) and run pnpm install --frozen-lockfile.
2. Clear out anything left in .boss/shots/ from an earlier review. Run the checks listed under Global Constraints in docs/superpowers/plans/2026-11-13-trial-lane-c-trust-fixes.md and save their full output to .boss/tests.txt. If a check fails, stop and show me the failure.
3. Write .boss/request.md: the pull request's description, word for word. Read it with gh pr view <number> --json body -q .body, or from https://github.com/lasting-oasis/Micar-com/pull/<number>.
4. If the description says Visual: yes, build the site and take the screenshots that the plan's "Look at it" step lists, into .boss/shots/.
5. Run bash ~/.micar-boss/ask.sh and allow it up to 10 minutes.
6. Post the whole verdict as a comment on the pull request (gh pr comment <number> --body-file .boss/verdicts/<n>.md). If you cannot post it, show it to me so I can pass it on.
```

## Scoreboard

Worker C keeps both tables in the project document `claude/micar-parallel-trial-plan.md`. It fills the first from GitHub. The owner supplies two columns of the second: usage and minutes.

| Lane, part | Pull request | First push | Boss reviews | Approved | Merged | Clashes | Owner's steps |
| --- | --- | --- | --- | --- | --- | --- | --- |
| A, Part 1 | | | | | | | |
| A, Part 2 | | | | | | | |
| A, Part 3 | | | | | | | |
| B | | | | | | | |
| C, Part 1 | | | | | | | |
| C, Part 2 | | | | | | | |

| Day | Plan usage at the end of the day | Owner's minutes | Stops, and what for |
| --- | --- | --- | --- |
| 1 | | | |
| 2 | | | |
| 3 | | | |
| 4 | | | |
| 5 | | | |
| 6 | | | |
| 7 | | | |

At the end, also note the boss's spend from the API console and Render's build minutes.

What to expect of the boss's cost: the one review run so far cost $0.06. A larger change with screenshots will cost more, and that has not been measured. An estimate for the week is about 30 reviews and somewhere between $2 and $15.

## When to stop

These are proposals. The owner can change any of them.

- **A merge breaks the live site or the World.** Stop merging. Revert that pull request first, then find out why.
- **A secret appears in the repository, a pull request or a chat.** Stop everything. The owner replaces that secret.
- **The boss rejects the same task three times.** That lane stops until the owner has looked.
- **A lane edits a file it does not own, twice.** The file table above is wrong. Fix the table before going on.
- **The plan's usage runs out before the day's work, two days running.** Drop to two workers.
- **The trial takes the owner more than about 30 minutes a day.** It is costing more than it gives. Stop and regroup.

## What counts as a pass

Also proposals. After seven days:

- Lane A's Part 1 is merged and the World has been seen to keep its data across a deploy.
- The load test has run on this PC, and its table is in lane A's pull request.
- Lane B is merged and a challenge link works between two phones.
- Both parts of lane C are merged.
- Nothing on the live site broke, and no secret leaked.
- The boss needed two reviews or fewer for most tasks.
- The owner spent about 20 minutes a day or less.

If all seven hold, try five workers. If some do not, stay at three and fix whatever the scoreboard shows was slowest: the boss's rounds, the owner's steps, clashes, lane C's relay, or usage.

There is no measured baseline for one worker. The nearest comparison is the pull requests merged in the week before the trial, which worker C can count from GitHub.
