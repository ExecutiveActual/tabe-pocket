# Changelog

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
