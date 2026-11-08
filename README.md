# Beaks and Blood: Tabe Pocket (v1.2.1 sim)

An autonomous colony sim. A small company of scouts lands on the beach of Tabe island. They set up camp, keep the fire going, forage and cook, hunt the Roukha (big, dangerous flightless birds) for their beaks, survive night raids, and sell beaks to the trader's boat every 3-4 days. **Nobody controls them.** You watch. Player controls come after v1.

## Play online

The live game is https://executiveactual.github.io/tabe-pocket/ once GitHub Pages is enabled on the `main` branch, from the repository root (`/`). Open that link on an iPhone in landscape. The page can be added to the home screen from there: it is one self-contained file, uses only relative paths, and has no service worker, so the `/tabe-pocket/` subpath works.

## Watching it
- Open `index.html` at the repo root, or `dist/index.html` (the same self-contained file). On a phone, turn it **landscape**.
- **Safe margins:** all UI sits inside the iPhone safe area (`env(safe-area-inset-*)`) plus an extra margin, larger at the top and bottom, and the controls sit around the vertical middle.
- **Camera:** it follows the squad. Pinch to zoom, drag to look around.
- **Compact UI (tap to expand):**
  - **HUD chip** (top left): day, time, weather, money and food (🍖, in points; a full meal = 100). Tap it for camp details: season, men, boat, food points and days, water, wood, ammo, and teams out.
  - **Log chip** (bottom left): shows the latest bark. Tap it to open the full camp log.
  - **Right side, three buttons:**
    - speed (⏸ / 1x / 2x / 4x / 16x);
    - view (follow the squad, island map, camp log, sound);
    - ☰ menu (chain of command, score, stats, team stats, stores, plan, new game with seed).
  - All three use one small popup-menu component (`src/view/ui.ts`). Tap outside to close.
- **Scouts:** a short label over each head shows what he is doing; a team still forming shows "need N more". Tap a scout for his card (it shows his pocket food in points). Dotted lines link men forming up on a leader, and ropes show a bird being hauled.
- **Fights (v1.2):** a crouched man has a dark knee block behind him. While he aims, a dashed line runs to his bird and brightens as the aim settles, with a gold ring filling round him; the shot is a muzzle flash; a blue ring and ⟲ show him working the bolt (orange when reloading). Labels read "raising rifle", "aiming", "working the bolt", "reloading", "hand to hand!".
- **Roukha (v1.2):** nests are twig rings with eggs, with a dashed ring for the birds' home range. Seen birds mustering for a hunt have a gold ring and the nest label reads "mustering 3/5"; seen packs are labelled "hunting pack", "pack stalking", "charging!", "retreating · fear N" or "pack heading home". A bird fleeing home has a red ring.
- **Barks** appear as speech bubbles (stacked so they don't overlap) and in the log. **At night** the screen darkens and the fires glow.
- **Smooth movement:** the sim still steps at 10 Hz. The viewer blends position and facing between the last two steps (fixed-timestep interpolation).
- **Saving:** the game autosaves every 30 seconds and resumes where you left off. The save key is `tabe-pocket-save-v1.2`, so older saves are not loaded.
- **URL options:**
  - `?seed=12&speed=4&zoom=7&day=3&hour=20`
  - `&pick=Name&panel=0` follows one scout without opening his card.
  - `&open=hud|speed|log` opens a popup.
  - `&inset=47,0,47,21` previews safe-area insets on a desktop (left, top, right, bottom in px).
  - `&tick=42555` runs to an exact sim tick (screenshots, bug reports).
  - `&look=nest|pack|fight` points the camera at a nest calling a hunt, a hunting pack, or the current fight.
  - `&reveal=1` is a designer view: no fog, every bird drawn. The sim is unchanged.

Screenshots (844×390 @2x, simulated iPhone insets 47/0/47/21) are in `shots/`:
- v1.2:
  - `v1_2_1-gameover.png`: the game-over card ("The company is dead.", the day, kills, losses, profit, Start a new company); `v1_2_1-newcompany.png` is the result of tapping it
  - `v1_2_1-noon.png`, `v1_2_1-night.png`: camp at noon and at 22:00; `v1_2_1-pack.png`: a charging pack with its label on the birds; `v1_2_1-fight.png`: a night fight with the boss's tap card
  - `v1_2-muster.png`: the north nest calling a hunt, "mustering 5/6" (designer `reveal=1` view: nobody is near the nest)
  - `v1_2-firing.png`: mid-fight: men crouched, aiming (aim lines, rings), a muzzle flash, a man working the bolt, and a pack charging a man into hand-to-hand
  - `v1_2-retreat.png`: a beaten pack retreating to its nest ("retreating (5) · fear 92")
  - `v1_2-pocket.png`: a tap card showing pocket food (140 pts)
  - `v1_2-hud.png`: the camp popup with food in points
- `v1_1-noon.png`
- `v1_1-team-forming.png`: a request out loud, with "gimme a sec" and "on my way"
- `v1_1-team-haul.png`: two teams roping birds home
- `v1_1-menu.png`, `v1_1-hud.png`, `v1_1-speed.png`, `v1_1-view-menu.png`, `v1_1-log.png`
- `v1_1-map.png`
- `v1_1-night-fight.png`

The v1 shots are kept as `v1-*.png`. The `v1_1-*` shots show the v1.1 build.

## Running from source
```
npm install
npm test            # behaviour + soak tests (vitest)
npm run typecheck
npm run build       # -> dist/index.html
npm run summary -- 204 20 -v   # headless run: seed, days, verbose log
npm run soak -- 300 30 20      # soak report: first seed, seeds, days (survival, deaths, kills/day, packs, fights, pocket meals, teams)
node scripts/shots.mjs name "seed=1&day=2&hour=12" [clickSelector...]   # 844x390 screenshot
```

### Editing the map
The island is pre-baked: no map generation happens at runtime.
- The hand-editable source is `data/maps/tabe_big.txt`: 768×768 characters, 2 m per tile, so about 1.5 × 1.5 km.
  - Legend: `~` sea, `.` beach, `,` grass, `J` jungle, `o` outback, `m` mangrove, `h` hills, `^` cliffs, `p` pond, `s` stream.
  - The landing, the Roukha nests (`nests`, tile x/y) and the old rookeries are in `tabe_big.meta.json`. `npx tsx scripts/placenests.ts` re-picks nest sites (open ground, away from water, ~330 m from the landing); or edit them by hand.
- After an edit, run `npm run map:pack`. It writes `data/tabe_big.packed.json` (run-length plus base64, about 32 KB) and checks the round trip. That file is what the build embeds.
- `npm run map:png` renders a preview.
- `npm run map:gen` regenerates the whole island from its seed. It overwrites hand edits.

## How it works
- **Sim** (`src/sim`): pure TypeScript, deterministic, seeded RNG, fixed 10 Hz tick. The same seed always gives the same story.
  - The sim never uses `Math.random`, wall-clock time, or trig/pow, so results stay bit-identical across machines.
- **Layers of AI:** needs → the commander's camp plan (goals) → jobs → combat override. Help requests and teams (`src/sim/team.ts`) sit between the plan and the jobs.
  - What the scouts are meant to be doing, in plain English: [`docs/SCOUT_INTENT.md`](docs/SCOUT_INTENT.md). The Roukha: [`docs/ROUKHA_INTENT.md`](docs/ROUKHA_INTENT.md).
- **Shared AI modules (v1.2, `src/sim/agent/`):** pure functions with no world access and no RNG, used by every species and parameterized by species data (`SPECIES` in `config.ts`):
  - `needs.ts`: need meters that decay per game hour, the urgency curve, and a generic "highest score wins" choice;
  - `home.ts`: home comfort (1 inside `safeR`, falling to 0 at `edgeR`), unease, and the smallest group that goes beyond the perimeter;
  - `request.ts`: the help-request engine: answers (come now / gimme a sec / help me first / no), answer ordering, and the rally verdict (go full, go smaller, go solo, call off, deadlock safety net).
  - Each species plugs in with a small adapter: scouts in `team.ts` (`scoutAnswerer`), Roukha in `wild.ts` (`birdAnswerer`, the nest muster). Adding a species means a `SPECIES` entry and an adapter.
- **Data:** every tunable is in `src/sim/config.ts`. Numbers marked `PLACEHOLDER` are guesses waiting for playtesting, including:
  - species rules: `SPECIES.scout` / `SPECIES.roukha` (home radii, team rules such as `minTeam`, needs);
  - Roukha: `NEST_*`, `HUNT_*`, `FEED_GAIN_H`, `FEAR`, `PACK_SATED_DOWNS`, `MAX_ON_ONE`, `BIRD_TOUGH`, `BIRD_PRESS_ON`;
  - firing: `PRESENT_TICKS`, `AIM_MIN_TICKS`/`AIM_MAX_TICKS`, `SNAP_*`, `BOLT_TICKS` (× each gun's `bolt`), `CONE_*`, `MOVING_CONE`;
  - food: the `FOOD` table (points per item, spoils or not), `POCKET_PTS`, `POCKET_PREF`, `POCKET_RESERVE`, `SNACK_TICKS`;
  - wounds: `DOWN_WOUND`, `OVERKILL_WOUND`, `MORTAL_WOUND`;
  - v1.1 teams: `TEAM_SIZE`, `TEAM_WORK`, `TEAM_QUALITY`, `ASSIST_*`, `LOOT_BIRD_PRI`, `CARCASS_DRAG_TEAM`, `SCOUT_SPEED_MUL`, `SPAWN_HIDE_M`.
- **Viewer** (`src/view`): Canvas 2D, bundled by esbuild into a single HTML file.
  - Terrain and fog are drawn in cached 64×64-tile chunks, and only the visible chunks are drawn.
  - The flora is indexed by chunk.
- **Saves:** compact. The fixed terrain is skipped, the explored-tiles mask is run-length packed, and trees, bushes and fish are stored as changes from the pristine island.
- **Client/server seam:** player orders go through `issueCommand()` (`CommandKind` in `src/sim/world.ts`). Orders are logged and ignored for now.

## What is new in v1.2
- **Shared AI modules** (`src/sim/agent/`): needs, home comfort and help requests are generic and used by both scouts and Roukha. The scouts' behaviour was moved onto them unchanged (identical world hashes before and after).
- **Roukha nests and packs:** 4 nests about 330 m from the landing, 7-9 birds each with a bull. A hunt is called through the same help request the scouts use, and a pack of 4-7 musters at the nest and sets out together. Fewer than 4 birds never hunt; they stay home.
- **Roukha run away:** pack fear from losses, wounds, a lost bull, gunfire (capped, never enough alone) and distance from home. Beaten packs retreat to the nest; a badly wounded bird on its own flees home bleeding a trail.
- **The firing sequence:** "Contact!", crouch, raise the rifle, aim 1-2 s, shoot, work the bolt, aim again, all visible on screen. Misses happen; fights take several shots; birds that close in get the bayonet.
- **Food in points and pocket rations:** a full meal = 100 points. Each food item has points and a spoils flag. Men heading out take ~150 points of non-spoiling food from the stores and eat it out there instead of walking back; leftovers go back to the stores. HUD and tap card show the points.
- **Danger:** some deaths, not a massacre: 29 of 30 camps alive after 20 days in the long soak (see the CHANGELOG table).

## What is new in v1.1
- **The big island:** 768×768 tiles, about 1.5 km across, pre-baked and stored compactly. It has outback, hills, cliffs, mangroves, 14 streams, 14 ponds and 6 rookeries.
  - The landing coast keeps the v1 feel: grass to the north, jungle to the south, a stream and a pond.
  - Birds spawn out of sight (`SPAWN_HIDE_M`) and walk in, so the camp still sees action.
- **Teams:** every job outside the camp perimeter is done by a pair, or by three men for a big bird. Help requests get one of three answers: come now, "gimme a sec", or "help me with this first".
  - The team links up in camp, goes out together, works together and walks home together.
  - Looting a bird is a high-priority team-only job. Haulers drop the rope the instant a fight starts and pick it back up after.
  - Fallbacks so nothing deadlocks: go smaller; go solo only on short, safe daytime jobs; otherwise call it off.
- **Joint work in camp:** helpers make building, cooking, smoking, butchering, scraping and chopping faster (×1.6 / ×1.95 / ×2.15 with 1-3 helpers) and slightly better (quality bonus).
- **Scouts move 25% faster** (`SCOUT_SPEED_MUL`).
- **Sight = fog:** a scout reveals his whole sight radius, and nothing in the fog can be seen or shot.
- **Phone UI:** safe-area margins, compact chips and popups (see above), and interpolated movement.

## What is in v1
- **Map (v1):** a small landing coast (160×160 tiles at 2 m) with beach, stream, jungle, grass, a pond and hills. Replaced by the big island in v1.1.
- **Scouts:** 5 of them, each with food, water, sleep and morale needs. Each has 1-2 traits and skills.
- **Command:** a commander with a chain of command. If the boss goes down, #2 takes over.
- **Camp:** sited on dry ground near water. Wood chopping, the fire kept lit day and night, and a night watch rotation.
- **Food:** foraging fruit, fetching water, cooking meals, and Roukha meat.
- **Roukha hunt loop:** sign and blood tracking, stalking, shooting, then dragging near kills home or taking the head from far ones. Beaks (some get cracked by headshots) are sold to the boat.
- **Roukha raids:** packs led by a bull. Night charges on camp. Guns make the birds flinch. A pack routs on losses or bad odds, or when its bull dies.
  - Downed men shout and wake nearby sleepers, and they get rescued and treated.
  - While the camp is under attack nobody turns in. Everyone stands to by the fire.
- **The boat:** every 3-4 days, stays about 4 hours. The commander meets it while a work party loads exports. Beaks and other goods are sold (with a per-beak license fee), and rations and ammo are bought on the spot.
- **Money:** one company purse, daily wages.
- **Game over:** everyone dead, or bankrupt (the purse stays negative for 3 mornings). The final score is profit, shown on a stats screen.
- **Save/resume:** saves skip the fixed terrain.
- **Viewer:** landscape, labels, tap cards, barks, log, night lighting, stats, watch-only.

## Deferred (not in v1)
These exist only as data and doc notes, or as inert groundwork behind `FEATURES` switches in `config.ts`, all set to `false`. **Groundwork behind a switch is not tested or tuned. Treat it as a sketch, not a feature.**
- **Seasons:** four 30-day seasons, a 120-day year, season license fee, seasonal wages. Spring nesting; in winter, fewer but hungrier and bolder birds that raid camp meat only when starving.
- **Rookeries and eggs:** territorial nesting grounds. Eggs are loot with a PLACEHOLDER price.
- **Medicine:**
  - Sickness: fever from bad water, infection, food poisoning, chills.
  - Minor accidents.
  - Lasting injuries (limp, bad arm), invaliding men home, and replacements.
  - Faster healing with a medic.
- **Leisure:** cards, chat, sparring, drinking (with hangovers that hurt aim), stress.
- **Expeditions:** day trips and multi-day trips with a field camp, packed supplies, a garrison policy, and party size scaled to the danger.
- **Trails:** worn paths built from per-tile traffic.
- **More food:** fish traps and nets, roots, crabs, lizards, herbs, smoking leaf, smoking meat.
- **Builds and camp relocation.**
- **Gear wear and jams.**
- **Trade:** orders that arrive on a later boat, random shop stock, missed-boat spoilage rules.
- **Money:** camp cash vs home account, the commander's cash policy, card stakes, bandit theft, debt down to a limit.
- **Co-op networking** (the second squad's colour and hat are already defined).
- **All player controls** (see roadmap).

## Roadmap
1. **Player controls** (the command types already exist in the seam; none are wired up):
   - Tap the ground for a menu: move here, hunt here, build here. Target one tapped scout, or the whole squad.
   - Priority sliders, company-wide and per scout.
   - Broad orders: hunt this area, hold camp, fall back to camp, go to the boat, move camp here, rest day.
   - Fight controls: pick a target, move to cover, hold fire / fire at will, bayonet charge, drag a downed man.
   - Auto-pause on big events (a setting).
   - Either co-op player can approve builds.
   - Quick map pings, no text chat.
2. Turn on the deferred systems one at a time, each with its own behaviour and soak tests: seasons → medicine → expeditions (the big map is in) → builds → split money and debt.
3. Co-op networking: two squads, with a shared or separate camp and purse.

## Test status (v1.2)
- `npm test`: 44 tests, all passing.
  - 14 v1.2 scenarios (`tests/v12.test.ts`): the shared modules (home comfort, needs, the request engine and its fallbacks); nests with flocks and bulls; a hunt mustered through the request engine as a pack of 4+; no hunting with fewer than 4 birds; gunfire alone never breaks a pack but losses do, and it retreats home; a lone wounded bird flees home bleeding; firing-sequence timing (crouch, present, 1-2 s aim, shot, bolt, aim); skill and snap shots shorten the aim; pocket take/eat/return; spoilable food is never pocketed; the stores reserve; food data consistency.
  - 17 v1 behaviour scenarios.
  - 11 v1.1 scenarios (`tests/teams.test.ts`):
    - the three answers to a help request;
    - who isn't asked;
    - linking up and travelling together;
    - the solo and cancel fallbacks;
    - joint-work multipliers;
    - camp assists happening;
    - a 4-seed × 8-day team check: no deadlocks, few solo trips, no bird dragged alone, no shots into the fog or with a rope in hand;
    - sight vs fog;
    - scout speed;
    - map packing round trip;
    - big-map save/load.
  - The soak suite: 12 seeds × 20 days plus seed 77 × 60 days. It checks for no exceptions, NaNs, stuck or frozen men, no team or muster deadlocks, a solo share under 15%, no bird dragged alone, no shots into the fog; and over all 12 seeds: at most 2 camps wiped, some deaths, hunting packs always 4+, fights, retreats and pocket meals happening.
- Long soak, 30 seeds × 20 days with `npm run soak -- 300 30 20`. The numbers are in the CHANGELOG.

## Known tuning notes
- Danger (v1.2): about 1 run in 6 loses a man over 20 days and about 1 in 30 is wiped out. There are no replacements yet, so a camp that loses two or three men can spiral. Knobs: `PACK_SATED_DOWNS`, `DOWN_WOUND`, `MORTAL_WOUND`, `PECK_EVERY`, `MAX_ON_ONE`, `BIRD_TOUGH`, `FEAR.breakAt`, `HUNT_PACK`, `RAID_CALM_H`, `MAX_HUNTS_OUT`.
- There are no replacements yet. A camp left with 1-2 men dies on its first night, or within days with 3. Game over is immediate, and the viewer shows a card with a "Start a new company" button (v1.2.1).
- Every hunt call so far succeeds. This is by design, not a bug: a hunt is only called with 4 or more healthy birds at home, and home jobs are short. Most seeds see their first hunt on day 3 at 15:00 from the same nest.
- Scouts never reach the nests (335-347 m out). Exploring and Roukha hunts stop at 160 m (`EXPLORE_MAX_M`), so nest defences stay at 0 until something sends men farther out.
- The oscillation monitor is near 0 since v1.2.1. What is left is mostly men re-entering a fight, which is legitimate.
- Extension seams for orders, inventories, structures and factions are described in `docs/EXTENDING.md`.
- Many headshots crack beaks.
- Profit varies a lot between seeds: it depends on how close the first birds come.
- Trees are re-grown at load from a fixed salt rather than stored in the map file. Hand edits to the map change terrain only.
