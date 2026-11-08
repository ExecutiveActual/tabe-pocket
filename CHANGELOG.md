# Changelog

## 1.2.0 - 2026-11-08
Shared AI modules, Roukha nests and hunting packs, fear and retreat, a readable firing sequence, food points and pocket rations, and danger tuning. The sim is still deterministic (seeded, fixed 10 Hz). Every invented number is marked PLACEHOLDER in `src/sim/config.ts`.

### Added
- **Shared AI modules** in `src/sim/agent/`. They are pure functions, and scouts and Roukha both use them:
  - `needs.ts`: need decay and urgency;
  - `home.ts`: home comfort and distance from home;
  - `request.ts`: the team-request engine, with collect answers and a rally verdict (now / gimme a sec / help me first).
  - Species data lives in `SPECIES` (config.ts). The adapters are `scoutAnswerer` (team.ts) and `birdAnswerer` (wild.ts).
  - Scouts were moved onto these modules with bit-identical results against v1.1. See `docs/ROUKHA_INTENT.md` and `docs/SCOUT_INTENT.md`.
- **Roukha nests:** 4 nests about 335-347 m from the landing, stored in map meta. Each starts with 7-9 birds (`NEST_BIRDS`), is capped at `NEST_MAX` 10, and regrows one bird every 14 h.
- **Hunting packs:**
  - A pack has 4-7 birds (`HUNT_PACK`) and is led by a bull. Fewer than 4 able birds means no hunt: they feed and stay near the nest.
  - Before a hunt, the bull musters the flock through the shared request engine.
  - Hunters come home fed, and the birds left at the nest get a share (`HUNT_SHARE`).
- **Fear and retreat** (`FEAR` table):
  - Fear comes from losses (scaled by pack size), wounds, a downed bull, gunfire (capped, so gunfire alone never breaks a pack), distance from the nest and bad odds.
  - At `breakAt` the pack retreats to the nest.
  - A lone wounded bird flees and leaves a blood trail.
  - A pack that has downed 2 scouts goes home sated.
- **Firing sequence:** "Contact!" → crouch → present (0.5 s) → aim (1-2 s; snap shots up close; moving targets widen the cone) → shoot → bolt (1 s for a rifle, faster for a carbine or pistol) → aim again.
  - On screen: an aim line with a progress ring, a muzzle flash, a ⟲ bolt cue and a crouch pose.
  - Misses happen, and when birds close in it becomes melee.
- **Food points:** a full meal is 100 points. `FOOD` gives each item its points, a spoils flag and an edible flag:
  - meal 40, spoils;
  - smoked 32, keeps;
  - ration 35, keeps;
  - berries 9, spoils;
  - raw meat and raw fish 36, spoil, not edible raw.
- **Pocket rations** (`src/sim/pocket.ts`):
  - A scout heading out packs about 150 points of non-spoiling food (`POCKET_PTS`) and leaves a camp reserve (`POCKET_RESERVE`).
  - He eats it outside when hungry. Leftovers go back to the stores when he gets home.
  - If the camp only has spoilable food, behaviour is unchanged from v1.1.
- **UI:**
  - the HUD 🍖 chip shows food in points, and the camp popup shows points per item;
  - the scout tap card shows pocket food;
  - nests and pack labels, plus muster and flee rings.
- **Viewer URL params:** `tick=`, `look=nest|pack|fight`, `reveal=1`. The save key is now `tabe-pocket-save-v1.2`.
- **Tests:** `tests/v12.test.ts`, 14 tests. The suite has 44 tests in total.
- **Soak report:** `scripts/soak_report.ts` now gives the full v1.2 metrics.
- **Shots:** `shots/v1_2-{muster,firing,retreat,pocket,hud}.png`, 844×390 with phone insets.

### Changed
- **Wounds:**
  - a downed scout's wound severity is `DOWN_WOUND` plus overkill;
  - a rescue can lose a man above `MORTAL_WOUND`;
  - birds are tougher (`BIRD_TOUGH`) and press on in a charge;
  - at most 2 birds peck one scout (`MAX_ON_ONE`).
- **Explorers avoid known nests.** A hungry scout eats supper before sleeping (`SUPPER_FIRST`).
- **Food is counted in points everywhere:** eating, stores and AI.
- **Removed** the old wild-flock and rookery-pack knobs.

### Soak (30 seeds × 20 days, seeds 300-329)
| metric | v1.1 | v1.2 |
|---|---|---|
| camps alive at day 20 | 30/30 | 29/30 (25 with no deaths) |
| deaths (per run) | 0 | 10 (0.33); per run {0:25, 1:3, 2:1, 5:1} |
| games over | 0 | 1 |
| scouts downed | - | 65 |
| kills/day | 2.39 | 3.06 |
| shots per kill / hit rate | - | 3.7 / 59.8% |
| hunts (musters) | - | 723 (723) |
| pack sizes | - | 4:225, 5:208, 6:160, 7:130 (avg 5.3) |
| pack retreats (fear) / walked home / wounded birds fled | - | 321 / 393 / 792 |
| fights / avg length | - | 353 / 11.0 s sim (0.44 game h) |
| pocket meals | - | 121 (0.20/day, 5670 pts) |
| solo departures / time outside alone | 1.2% / 2.7% | 2.5% / 3.5% |
| avg team wait | 0.42 h | 0.38 h |
| stuck / osc / exceptions | 5 / 35 / 0 | 0 / 50 / 0 |


## 1.1.0 - 2026-11-08
A stability and quality pass, plus teams and the big island. The sim stays deterministic (seeded, fixed 10 Hz).

### Added
- **The big pre-baked island:** 768×768 tiles at 2 m, about 1.5 km across.
  - Source of truth: `data/maps/tabe_big.txt`, hand-editable.
  - The build embeds `data/tabe_big.packed.json`: run-length plus base64, about 32 KB.
  - Terrain: outback, hills, cliffs, mangroves, jungle clearings, 14 streams, 14 ponds, 6 rookeries. The landing coast keeps the v1 layout.
  - Scripts: `map:gen`, `map:pack`, `map:png`.
- **Help requests and teams** (`src/sim/team.ts`):
  - Outside the camp perimeter, work is done by 2 men, or 3 for a big bird.
  - A mate answers "right behind you" (drops his job), "gimme a sec" (finishes first; the asker waits) or "help me with this first" (the asker pitches in on his camp job, then they go).
  - Teams link up in camp, travel together, and walk home together.
  - Barks go to bubbles and the log.
  - Fallbacks: go smaller; go solo only on short, safe daytime jobs; otherwise cancel with a cooldown. A safety net cancels any stuck team.
- **Bird looting is a team-only job** at high priority (`LOOT_BIRD_PRI` 2.7, below rescue and the boat).
  - More men on the rope haul faster.
  - Haulers drop the rope the instant they fight, then pick it back up.
  - A man who drops out to fight stays on his team, and the leader holds for him.
  - If the whole team is lost out there, the job is abandoned and the bird is left on the ground.
- **Joint work in camp:** mates lend a hand on building, cooking, smoking, butchering, scraping and chopping.
  - Work multipliers 1.6 / 1.95 / 2.15 with 1-3 helpers, plus a quality bonus (meal value, meat yield).
  - All numbers are PLACEHOLDER data in `config.ts`.
- **Scout speed** ×1.25 (`SCOUT_SPEED_MUL`, PLACEHOLDER).
- **Sight = fog:** a scout reveals his whole sight radius, and `canSee` refuses fog tiles. Nothing in the fog is shot.
- **Phone UI:**
  - safe-area insets plus extra top and bottom margins;
  - a compact HUD chip that expands;
  - a collapsible log chip;
  - speed, view and menu buttons at the right-hand middle;
  - a reusable popup-menu component (`src/view/ui.ts`).
  - Labels are de-conflicted in screen space, and bubbles stack.
  - Teams forming show "need N more", with rally lines and visible ropes.
- **Render interpolation:** position and facing are blended between sim steps, with the same 10 Hz sim.
- **Chunked, cached terrain and fog rendering** (64×64-tile chunks), drawing only what is visible.
- **Compact saves:**
  - terrain is omitted;
  - the explored mask is run-length packed;
  - trees, bushes and fish are stored as diffs from the pristine island.
  - The save key is now `tabe-pocket-save-v1.1`.
- `docs/SCOUT_INTENT.md`: what the scouts are meant to be doing, in plain English.
- `scripts/soak_report.ts` (`npm run soak`) and `scripts/shots.mjs` (844×390 screenshots with simulated insets).
- Tests: 11 new scenario tests (`tests/teams.test.ts`), and team, fog and drag checks in the soak suite. 30 tests in total, all passing.

### Fixed
- A dawn sleep/wake flip-flop.
- The boss restarting "meet the boat" while an order was pending.
- Explore churn now that sight reveals the target at once: the target is pushed past the frontier and the job ends on arrival.
- A bird is never carried off on another errand: ending the job puts it back on the ground. The boss finishes hauling with his team before going to the boat.

### Soak, 30 seeds × 20 days (`npm run soak -- 200 30 20`)
- **Survival:** 0 deaths, 0 games over, 2.52 kills/day.
- **Requests:** 3780 help requests, 2830 departures.
  - Full team 2630, smaller 172, solo 28 (1.0% of departures); 394 cancelled.
  - The rest ended before leaving, e.g. a fight or the job vanished.
- **Answers:** came now 2389, "gimme a sec" 957, "help me first" 567. Camp assists 3166.
- **Waiting:** average buddy wait 0.43 game hours (about 11 s at 1x), max 1.6 h. **Deadlocks 0.**
- **Alone:** 2.6% of time outside the perimeter was spent alone. Birds dragged alone: 0.0% of drag time. Shots into fog 0. Shots with a rope in hand 0.
- **Monitors:** stuck 5, idle 0, oscillation 37 (spread across job kinds, about 1 per 16 seed-days), exceptions 0.

## 0.1.0 (v1) - 2026-11-08
First playable, watch-only slice.

### Added
- Deterministic sim with a fixed 10 Hz tick (1 day = 10 real minutes at 1x) and a seeded RNG.
- 5 autonomous scouts with food, water, sleep and morale needs, 1-2 traits, and skills.
- A commander's camp plan and chain of command. Jobs: chopping, keeping the fire, water, foraging, cooking, night watch, rescue and treatment.
- Roukha:
  - Hunt loop: tracking, shooting, dragging or taking the head, selling beaks.
  - Packs led by a bull; night raids; flinching; rout checks.
- Trader boat every 3-4 days: on-the-spot rations and ammo, beak sales, per-beak license fee.
- One company purse with daily wages. Game over when everyone is dead or the company is bankrupt. Score and stats.
- Save/resume.
- v1 landing-coast map (`data/pocket_v1.json`).
- Landscape phone viewer: follow camera, pinch and drag, labels, tap cards, bark bubbles and log, night lighting, procedural sound, autosave.
- Behaviour scenario tests (17) and multi-day soak tests (12 seeds × 20 days, plus one 60-day run).
- Inert groundwork, switched off by `FEATURES`: seasons, medicine, leisure, rookeries and eggs, trails, extra food, split money and debt, and the 600×600 big-island map.
- Player command types defined in the client/server seam (not wired up).

### Fixed during v1 hardening
- Scouts no longer go to bed while their mates are fighting at camp. They stand to, and sleepers wake when the camp is attacked.
- Rescuing a downed man now outranks sleep.
- The commander and the loading party respond as soon as the boat arrives, not at the next planning pass.
- The boss always goes to meet the trader: he drops buddy jobs and chores, and the trader's goods get hauled up as a priority when they're food.
- Interrupted hauls get dropped off at camp instead of being carried around forever.
- After a raid pack pulls back, the birds keep off for 10 hours (`RAID_CALM_H`). No more back-to-back charges through one night.
- Foraging, wood cutting and exploring stop at dark.
- The scout card shows only the four v1 needs, and only traits whose effects are live in v1 are drawn.
- Viewer survives blocked browser storage (private mode).
- Raid packs grow more gently, so a v1 company isn't wiped out by day 9.
