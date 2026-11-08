# Extending Tabe Pocket (v1.2.1)

Where the next systems plug in. v1.2.1 added only empty seams: with nothing registered, the sim behaves the way it did before.
Every number in `src/sim/config.ts` is still designer data, and the PLACEHOLDER markers still mean "not approved yet".

## Rules that still apply
- The sim is deterministic. Use the world RNG (`rnd(w)` and friends), never `Math.random`, `Date` or float trig in `src/sim`.
  Anything you register must run in a fixed order: arrays, not object key order that depends on insertion timing.
- New world state must be plain JSON (it is saved and hashed). Changing the world's shape means bumping the save key in
  `src/view/main.ts` and adding a save/load test.
- Keep a system behind a `FEATURES` flag until it has a soak run.

## Orders and jobs (the first expansion)
Planned: the player gives orders (build, zone, hunt, with a 1-5 priority). The Boss turns them into goals, and the existing
allocator hands goals to men.
- **Input:** `issueCommand()` in `world.ts` queues a command for a target tick. `applyCommands()` applies due commands in a
  canonical order. Register `COMMAND_HANDLERS[kind]` to record the order in world state, e.g. a new `w.orders` list
  (save key bump). Kinds with no handler are logged and ignored, as before.
- **Planning:** push a `GoalSource` onto `GOAL_SOURCES` (`ai.ts`). `planTick()` calls each source after the built-in goals,
  with the same `add(id, kind, pri, slots, label, target?)`. To map an order priority of 1-5 onto the goal scale, compare with
  the built-ins: explore is 0.75, wood 1.2-3.3, rescue 3.6.
- **Execution:** a goal of a new kind needs a `JOB_MAKERS[kind]` that returns an `Act`, or null. Built-in kinds win.
  The act runs in `runAct()`. Add a `case` there for a new act kind. Outside jobs get teams through `needBuddy` and the
  shared help-request engine (`agent/request.ts`, `team.ts`).
- **Interruptions:** `maybeInterrupt()` in `world.ts` decides what ends a job: an urgent need that can be met right now (one that can't makes him rethink at most every `NEED_RETHINK_H`),
  or bedtime. `NOT_AT_BEDTIME` lists the acts that bedtime leaves alone.

## Inventories
- **Company (off island):** `w.ledger.credits`, plus `income`, `spending` and `shipped`. Pay with `payHome()`.
- **Camp cash:** `w.ledger.cash`. Pay with `payCash()`, which falls back on credits. Sales are booked with
  `receive(w, amt, toCamp)`. `stealCash()` is the hook bandits will use. `funds()` is the sum.
- **Camp stores:** `w.camp.stock` (an `Inv`, read and written with `invGet` and `invAdd`). A man's own load is `s.carry`.
  `s.pocket` holds his trip rations, which still count as camp food (`foodPoints`). Boat: `w.boat.cargo`, `crate` and `shop`.
- The two-inventory design (company assets vs camp stores and cash) maps onto ledger.credits vs ledger.cash and camp.stock.
  Company assets other than money (gear and boats held back home) would be a new `w.company` record.

## Structures
- The data is `CFG.BUILDINGS` (id, label, wood, hours, dx/dy offset from the fire, effect). Per-camp state is `w.camp.builds[id]` (`Build`: x, y, built,
  progress, claim). The `approveBuild()` hook in `ai.ts` returns yes automatically today.
- This is gated by `FEATURES.builds`, which is off in v1.2.x. The build job is already the generic `'build'` goal kind.
- A player-placed build order is a `buildHere` command handler plus a goal source that adds `add(id, 'build', pri, 1, label)`.

## Factions
- There is no faction field yet. Today the sides are implicit: scouts (`w.scouts`) and Roukha (`w.birds`, `w.packs`,
  `w.nests`).
- Planned: bandits and suppression (0-100). Add a faction id to `Scout` and `Pack`, or a new `Band` list, with a
  `CFG.FACTIONS` data table. Bump the save key. Teach `perceive()` and `combatTick()` in `combat.ts` who is hostile.
  The shared AI modules (`agent/needs`, `agent/home`, `agent/request`) are species-agnostic, so new humans can reuse them.
