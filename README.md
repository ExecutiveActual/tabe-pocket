# Beaks and Blood: Tabe Pocket (v1 sim)

An autonomous colony sim. A small company of scouts lands on the beach of Tabe island. They set up camp, keep the fire going, forage and cook, hunt the Roukha (big, dangerous flightless birds) for their beaks, survive night raids, and sell beaks to the trader's boat every 3-4 days. **Nobody controls them.** You watch. Player controls come after v1.

## Play online

The live game is https://executiveactual.github.io/tabe-pocket/ once GitHub Pages is enabled on the `main` branch, from the repository root (`/`). Open that link on an iPhone in landscape. The page can be added to the home screen from there: it is one self-contained file, uses only relative paths, and has no service worker, so the `/tabe-pocket/` subpath works.

## Watching it
- Open `index.html` at the repo root, or `dist/index.html` (the same self-contained file). On a phone, turn it **landscape**.
- **Camera:** it follows the squad. Pinch to zoom, drag to look around, and tap 🎯 to snap back to the squad.
- **Right-hand buttons:**
  - ⏸ pause
  - 1x / 4x / 16x speed (1 in-game day ≈ 10 real minutes at 1x)
  - 🗺 whole-map view
  - 📜 bark log (small, big, or hidden)
  - ☰ stats and game menu (new game, seed, difficulty)
  - 🔇 sound (off by default)
- **HUD:** day and time, season, money, days until the boat, days of food, and ammo.
- **Scouts:** each one has a short label over his head showing what he is doing. Tap a scout for his card: needs, traits and current job.
- **Barks** appear as speech bubbles and in the scrolling log.
- **At night** the screen darkens and the fires glow.
- **Saving:** the game autosaves to the browser every 30 seconds and resumes where you left off.
- **URL options:** `?seed=12&speed=4&zoom=7&day=3&hour=20` (handy for screenshots).

Screenshots (iPhone landscape, 844×390 @2x) are in `shots/`: `v1-noon.png`, `v1-night.png`, `v1-fight.png`, `v1-card.png`, plus `v1-map.png` (the whole map).

## Running from source
```
npm install
npm test            # behaviour + soak tests (vitest)
npm run typecheck
npm run build       # -> dist/index.html
npm run summary -- 204 20 -v   # headless run: seed, days, verbose log
```

## How it works
- **Sim** (`src/sim`): pure TypeScript, deterministic, seeded RNG, fixed 10 Hz tick. The same seed always gives the same story.
  - The sim never uses `Math.random`, wall-clock time, or trig/pow, so results stay bit-identical across machines.
- **Layers of AI:**
  1. **Needs:** food, water, sleep and morale, scored by utility.
  2. **Commander's camp plan:** a list of goals (wood, water, meals, hunt, meet the boat, rescue...).
  3. **Jobs** that carry out those goals.
  4. **Combat override,** with hysteresis so scouts don't flip-flop in and out of a fight.
- **Data:** every tunable is in `src/sim/config.ts`. Numbers marked `PLACEHOLDER` are guesses waiting for playtesting.
  - The v1 map is `data/pocket_v1.json` (160×160 tiles, 5 m per tile): a west beach landing, a stream, grass to the north, jungle to the south, a pond, and hills on the east.
- **Viewer** (`src/view`): Canvas 2D, bundled by esbuild into a single HTML file.
- **Client/server seam:** player orders go through `issueCommand()` (`CommandKind` in `src/sim/world.ts`). In v1 orders are logged and ignored.

## What is in v1
- **Map:** modest landing coast with beach, stream, jungle, grass, a pond and hills.
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
- **The big island:** a 600×600 hand-authored map (`data/tabe.json`) with outback, mangroves, cliffs and four rookeries.
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
2. Turn on the deferred systems one at a time, each with its own behaviour and soak tests: seasons → medicine → expeditions and the big map → builds → split money and debt.
3. Co-op networking: two squads, with a shared or separate camp and purse.

## Test status (v1)
- `npm test`: 19 tests (17 behaviour scenarios, plus the soak suite: 12 seeds × 20 days and seed 77 × 60 days).
  - The soak suite checks: no exceptions, no NaNs, no wipe or bankruptcy, nobody stuck, nobody frozen, nobody idling with work open.
- Extra soak runs done by hand during hardening: 30 seeds × 20 days, 30 seeds × 30 days, 9 seeds × 60 days.
  - Every company survived with all 5 scouts and ended in profit.
  - Zero exceptions and zero idle flags. A stuck flag fired at most once per run, below the test limit of 6.

## Known tuning notes (v1)
- v1 is tuned on the safe side. Nobody died in the hand-run soaks, so night raids are scary but rarely lethal. Raise `PACK_MAX`, `PACK_GROW_PER_DAY` or lower `RAID_CALM_H` in `config.ts` for more danger.
- Kill counts run high, about 4 Roukha per day.
- Many headshots crack beaks. Careful shooters should probably go for the body.
- Foragers sometimes come home after dark.
