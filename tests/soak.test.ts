// Soak: many seeds, many days, zero input. Fails on exceptions, NaNs, too many wipes, stuck/idle scouts or a frozen scout,
// and checks the v1.2 Roukha rules hold over the long run (packs of 4+, retreats happen, pocket food gets eaten).
import { describe, it, expect } from 'vitest';
import { createWorld, step } from '../src/sim/world';
import { CFG } from '../src/sim/config';
import { World } from '../src/sim/core';

function finite(o: unknown, path: string, out: string[]): void {
  if (typeof o === 'number') { if (!Number.isFinite(o)) out.push(path); return; }
  if (!o || typeof o !== 'object') return;
  for (const k of Object.keys(o as object)) finite((o as Record<string, unknown>)[k], path + '.' + k, out);
}
function check(w: World, seed: number): void {
  const bad: string[] = [];
  finite(w.scouts, 'scouts', bad); finite(w.birds, 'birds', bad); finite(w.camp, 'camp', bad); finite(w.ledger, 'ledger', bad);
  expect(bad.slice(0, 5), `seed ${seed} non-finite numbers`).toEqual([]);
}
describe('soak', () => {
  it('12 seeds x 20 days: no exceptions, NaNs, stuck or frozen scouts; most camps survive; packs of 4+', () => {
    let wipes = 0, deaths = 0, retreats = 0, hunts = 0, pocket = 0, fights = 0;
    for (let seed = 200; seed < 212; seed++) {
      const w = createWorld(seed);
      for (let d = 0; d < 20; d++) {
        const walked: Record<number, number> = {}; const prev: Record<number, [number, number]> = {};
        for (const s of w.scouts) prev[s.id] = [s.x, s.y];
        for (let i = 0; i < CFG.DAY_TICKS; i++) {
          step(w);
          if (i % 10 === 0) for (const s of w.scouts) { const p = prev[s.id] || [s.x, s.y]; walked[s.id] = (walked[s.id] || 0) + Math.abs(p[0] - s.x) + Math.abs(p[1] - s.y); prev[s.id] = [s.x, s.y]; }
        }
        check(w, seed);
        // every man who was fit all day must have walked somewhere (no deadlock)
        for (const s of w.scouts) if (s.status === 'ok') expect(walked[s.id] || 0, `seed ${seed} day ${d + 1} ${s.name} frozen`).toBeGreaterThan(10);
      }
      // v1.2 danger: some deaths, not a massacre (counted over all seeds below)
      if (w.over) wipes++; deaths += w.stats.deaths;
      const Rk = w.stats.roukha; retreats += Rk.retreats; hunts += Rk.hunts; pocket += w.stats.pocketMeals; fights += Rk.fights;
      for (const k of Object.keys(Rk.packSizes)) expect(Number(k), `seed ${seed} hunting pack size`).toBeGreaterThanOrEqual(4);
      expect(Rk.deadlocks, `seed ${seed} muster deadlocks`).toBe(0);
      expect(w.stats.mon.exceptions, `seed ${seed} exceptions`).toBe(0);
      expect(w.stats.mon.stuck, `seed ${seed} stuck`).toBeLessThan(6);
      expect(w.stats.mon.idle, `seed ${seed} idle`).toBeLessThan(6);
      // v1.1 teams: nothing deadlocks, solo trips stay rare, nobody shoots into the fog
      const T = w.stats.team;
      expect(T.deadlocks, `seed ${seed} team deadlocks`).toBe(0);
      expect(T.solo / Math.max(1, T.departed), `seed ${seed} solo share`).toBeLessThan(0.15);   // v1.2: birds stay near their nests, so more jobs near camp count as low-risk
      expect(T.dragAloneTicks / Math.max(1, T.dragTicks), `seed ${seed} dragged alone`).toBeLessThan(0.05);
      expect(w.stats.mon.fogShots || 0, `seed ${seed} shots into fog`).toBe(0);
    }
    expect(wipes, 'camps wiped out (of 12)').toBeLessThanOrEqual(2);
    expect(deaths, 'some deaths over 12 x 20 days').toBeGreaterThan(0);
    expect(hunts, 'hunting packs set out').toBeGreaterThan(100);
    expect(fights, 'fights').toBeGreaterThan(30);
    expect(retreats, 'packs retreat when losing').toBeGreaterThan(10);
    expect(pocket, 'pocket meals eaten out there').toBeGreaterThan(20);
  }, 900000);
  it('a 60-day run of one seed stays sane', () => {
    const w = createWorld(77);
    for (let i = 0; i < 60 * CFG.DAY_TICKS; i++) step(w);
    check(w, 77);
    expect(w.stats.mon.exceptions).toBe(0);
    expect(w.log.length).toBeLessThanOrEqual(CFG.LOG_MAX);
  }, 900000);
});
