// Soak: many seeds, many days, zero input. Fails on exceptions, NaNs, wipes, stuck/idle scouts or a frozen scout.
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
  it('12 seeds x 20 days: no exceptions, NaNs, wipes, stuck or frozen scouts', () => {
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
      const alive = w.scouts.filter((s) => s.status !== 'dead').length;
      expect(alive, `seed ${seed} alive`).toBeGreaterThanOrEqual(3);
      expect(w.over, `seed ${seed} game over`).toBe('');
      expect(w.stats.mon.exceptions, `seed ${seed} exceptions`).toBe(0);
      expect(w.stats.mon.stuck, `seed ${seed} stuck`).toBeLessThan(6);
      expect(w.stats.mon.idle, `seed ${seed} idle`).toBeLessThan(6);
    }
  }, 900000);
  it('a 60-day run of one seed stays sane', () => {
    const w = createWorld(77);
    for (let i = 0; i < 60 * CFG.DAY_TICKS; i++) step(w);
    check(w, 77);
    expect(w.stats.mon.exceptions).toBe(0);
    expect(w.log.length).toBeLessThanOrEqual(CFG.LOG_MAX);
  }, 900000);
});
