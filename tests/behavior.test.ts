// Behavior scenario tests. Each one runs the real sim headless with zero player input.
import { describe, it, expect } from 'vitest';
import { createWorld, step, runDays, runTicks, hashWorld, tickAt, save, load } from '../src/sim/world';
import { CFG } from '../src/sim/config';
import { invAdd, invGet, dayOf, dist } from '../src/sim/core';
import { commander, chainOrder, campAlert } from '../src/sim/ai';
import { hurt } from '../src/sim/ai';

const until = (w: ReturnType<typeof createWorld>, t: number): void => { while (w.tick < t) step(w); };

describe('determinism', () => {
  it('same seed gives the same world hash after a day', () => {
    const a = createWorld(7), b = createWorld(7); runDays(a, 1); runDays(b, 1);
    expect(hashWorld(a)).toBe(hashWorld(b));
  });
  it('save/load mid-run continues identically', () => {
    const a = createWorld(9); runTicks(a, 3000); const b = load(save(a));
    runTicks(a, 2000); runTicks(b, 2000); expect(hashWorld(a)).toBe(hashWorld(b));
  });
});

describe('landing and camp setup (no Roukha)', () => {
  for (const seed of [1, 2, 3, 4, 5]) it(`seed ${seed}: camp sited, fire, latrine and a wood pile by 15:00 on day 1`, () => {
    const w = createWorld(seed, { noRoukha: true }); until(w, tickAt(1, 15));
    expect(w.camp.sited).toBe(true);
    expect(w.camp.readyTick.fire).toBeGreaterThanOrEqual(0);
    expect(w.camp.readyTick.latrine).toBeGreaterThanOrEqual(0);
    expect(w.camp.readyTick.wood).toBeGreaterThanOrEqual(0);
    expect(w.scouts.every((s) => s.tag !== 'pack')).toBe(true); // everyone unpacked
  });
});

describe('needs and self-sufficiency', () => {
  it('with ample resources needs stay healthy for a week (3 seeds, no Roukha)', () => {
    for (const seed of [11, 12, 13]) {
      const w = createWorld(seed, { noRoukha: true }); runDays(w, 7);
      for (const d of w.stats.days.slice(1)) for (const s of d.scouts) {
        expect(s.min.food, `${seed} d${d.day} ${s.name} food`).toBeGreaterThan(8);
        expect(s.min.water, `${seed} d${d.day} ${s.name} water`).toBeGreaterThan(10);
        expect(s.end.morale, `${seed} d${d.day} ${s.name} morale`).toBeGreaterThan(25);
      }
      expect(w.scouts.every((s) => s.status !== 'dead')).toBe(true);
    }
  });
  it('a daily rhythm emerges: everyone sleeps at night and works in the day', () => {
    const w = createWorld(3, { noRoukha: true }); until(w, tickAt(1, 26));
    const awake = w.scouts.filter((s) => s.status === 'ok' && !(s.act && (s.act.kind === 'sleep' || s.act.kind === 'watch')));
    expect(awake.length).toBeLessThanOrEqual(1);
    until(w, tickAt(2, 10.5));
    expect(w.scouts.filter((s) => s.act && s.act.kind === 'sleep').length).toBe(0);
  });
  it('exactly one scout on night watch', () => {
    const w = createWorld(5, { noRoukha: true }); until(w, tickAt(1, 25));
    expect(w.scouts.filter((s) => s.act && s.act.kind === 'watch').length).toBe(1);
  });
  it('under scarcity: food before leisure, no marksmanship practice when ammo is short', () => {
    const w = createWorld(4, { noRoukha: true }); runDays(w, 1);
    for (const k of CFG.EAT_PREF) invAdd(w.camp.stock, k, -invGet(w.camp.stock, k));
    invAdd(w.camp.stock, 'ammo', -invGet(w.camp.stock, 'ammo') + 20);
    const before = w.stats.leisure['marks'] || 0;
    for (const s of w.scouts) s.needs.food = 30;
    runDays(w, 1);
    expect((w.stats.leisure['marks'] || 0) - before).toBe(0);
    const foodWork = w.stats.days[w.stats.days.length - 1];
    expect(foodWork.scouts.every((s) => s.min.food > 0)).toBe(true);
  });
  it('morale declines gradually under a shortage and recovers after', () => {
    const w = createWorld(6, { noRoukha: true, noBoat: true }); runDays(w, 1);
    const m0 = w.scouts.reduce((t, s) => t + s.morale, 0) / w.scouts.length;
    // a lean spell: strip food and tobacco/rum
    for (const k of [...CFG.EAT_PREF, 'rum', 'tobacco'] as const) invAdd(w.camp.stock, k, -invGet(w.camp.stock, k));
    let prev = m0, maxDrop = 0;
    for (let h = 0; h < 24; h++) { runTicks(w, Math.round(CFG.DAY_TICKS / 24)); const m = w.scouts.reduce((t, s) => t + s.morale, 0) / w.scouts.length; maxDrop = Math.max(maxDrop, prev - m); prev = m; }
    expect(maxDrop).toBeLessThan(15);         // no sudden collapse in any hour
    runDays(w, 3);
    expect(w.scouts.every((s) => s.status !== 'dead')).toBe(true);
    const m2 = w.scouts.reduce((t, s) => t + s.morale, 0) / w.scouts.length;
    expect(m2).toBeGreaterThan(30);           // they fed themselves back up
  });
});

describe('chain of command and requisitions', () => {
  it('rank first, then Leadership; #2 takes over when #1 is downed', () => {
    const w = createWorld(2, { noRoukha: true }); runTicks(w, 100);
    const order = chainOrder(w);
    for (let i = 1; i < order.length; i++) expect(order[i - 1].rank > order[i].rank || (order[i - 1].rank === order[i].rank && order[i - 1].skills.leadership >= order[i].skills.leadership)).toBe(true);
    const c = commander(w)!; hurt(w, c, 999, 'test');
    expect(commander(w)).toBe(order[1]);
  });
  it('the commander meets the boat, sells exports and buys supplies on the spot', () => {
    const w = createWorld(8, { noRoukha: true }); invAdd(w.camp.stock, 'timber', 4);
    while (w.stats.boatsDone < 1 && dayOf(w.tick) < 7) step(w);
    expect(w.stats.boatsDone).toBe(1);
    expect(w.ledger.income).toBeGreaterThan(0);
    // v1: the boss meets the trader and buys on the spot (no orders for a later boat)
    expect(w.log.some((l) => l.who === 'Boat' && /nobody met the boat/.test(l.text))).toBe(false);
    expect(w.log.some((l) => l.kind === 'boat' && /(Buying|Topping up|Keeping the money)/.test(l.text))).toBe(true);
  });
});

describe('danger and rescue', () => {
  it('a downed scout is dragged back and patched up', () => {
    const w = createWorld(3, { noRoukha: true }); until(w, tickAt(1, 14));
    const v = w.scouts[w.scouts.length - 1]; hurt(w, v, v.hp, "test");   // just down (no overkill: a mortal wound could be lost on the table)
    runTicks(w, 3 * 250 * 10);
    expect(v.status === 'recovering' || v.status === 'ok').toBe(true);
    expect(w.stats.rescues).toBeGreaterThanOrEqual(1);
  });
  it('with Roukha on: scouts fight back and nobody wipes in 6 days (4 seeds)', () => {
    for (const seed of [21, 22, 23, 24]) {
      const w = createWorld(seed); runDays(w, 6);
      expect(w.scouts.filter((s) => s.status !== 'dead').length, `seed ${seed}`).toBeGreaterThanOrEqual(3);
      expect(w.stats.mon.exceptions).toBe(0);
    }
  });
});

describe('night raids', () => {
  it('nobody stays asleep near the fire while the camp is under attack (seed 204, the old day-9 wipe)', () => {
    const w = createWorld(204); let alerts = 0, worst = 0; const asleepT: Record<number, number> = {};
    while (dayOf(w.tick) < 11) {
      step(w);
      if (!campAlert(w)) { for (const k in asleepT) delete asleepT[k]; continue; }
      alerts++;
      for (const s of w.scouts) {
        const near = s.status === 'ok' && s.act?.kind === 'sleep' && dist(s.x, s.y, w.camp.x, w.camp.y) < CFG.ALERT_M;
        asleepT[s.id] = near ? (asleepT[s.id] || 0) + 1 : 0; worst = Math.max(worst, asleepT[s.id]);
      }
    }
    expect(alerts).toBeGreaterThan(0);
    expect(worst).toBeLessThan(CFG.DECIDE_EVERY * 2 + 2);  // woken within a decision pass or two
    expect(w.scouts.filter((s) => s.status !== 'dead').length).toBe(5);
  });
});
