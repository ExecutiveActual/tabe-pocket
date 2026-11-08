// v1.1 scenario tests: help requests and teams, joint work in camp, sight vs fog, scout speed, the big pre-baked map.
import { describe, it, expect } from 'vitest';
import { createWorld, step, runDays, tickAt, save, load, hashWorld, islandTiles, ISLAND_N } from '../src/sim/world';
import { CFG } from '../src/sim/config';
import { World, Scout, dist, tileOf, TPH } from '../src/sim/core';
import { mkAct, startAct, endAct, fireSeat, moveTo, campXY } from '../src/sim/ai';
import { openTeam, answer, teamTick, teamWork, crewOf, actValue } from '../src/sim/team';
import { canSee, perceive } from '../src/sim/combat';
import { packTiles, unpackTiles } from '../src/sim/mapdata';
import TABE from '../data/tabe_big.packed.json';

const until = (w: World, t: number): void => { while (w.tick < t) step(w); };
/** A settled camp at 10:00 on day 2, everyone fed and rested, sitting round the fire doing nothing. */
function staged(seed = 3): World {
  const w = createWorld(seed, { noRoukha: true, noBoat: true }); until(w, tickAt(2, 10));
  w.scouts.forEach((s, i) => {
    endAct(w, s); s.status = 'ok'; s.sleeping = false; s.promise = -1; s.combat = false;
    for (const k of Object.keys(s.needs) as (keyof typeof s.needs)[]) s.needs[k] = 90;
    const [x, y] = fireSeat(w, s, 10 + i); s.x = x; s.y = y;
  });
  return w;
}
/** A passable spot about `m` metres from camp, inside the explored area (or the nearest one). */
function farSpot(w: World, m: number): [number, number] {
  const [cx, cy] = campXY(w); let best: [number, number] = [cx, cy], bd = 1e9;
  for (let ty = 0; ty < w.map.n; ty += 2) for (let tx = 0; tx < w.map.n; tx += 2) {
    const i = ty * w.map.n + tx; if (!w.map.seen[i] || w.map.terrain[i] !== 2 /* grass */) continue;
    const x = (tx + 0.5) * CFG.TILE_M, y = (ty + 0.5) * CFG.TILE_M, e = Math.abs(dist(x, y, cx, cy) - m);
    if (e < bd) { bd = e; best = [x, y]; }
  }
  return best;
}
const goal = (w: World, id: string, pri: number): void => { w.plan.goals.push({ id, kind: id, pri, slots: 3, label: id, blockedUntil: 0, reason: '' }); };

describe('help requests: the three answers', () => {
  it('idle -> comes now; nearly done with something important -> "gimme a sec"; long camp job -> "help me with this first"', () => {
    const w = staged(); const [L, a, b, c, d] = w.scouts;
    const [fx, fy] = farSpot(w, 120);
    startAct(w, L, mkAct('explore', 'Scouting', '', fx, fy, { needBuddy: true }));
    const t = openTeam(w, L, L.act!); t.urg = 2.7; t.need = 4;
    goal(w, 'tFuel', 3.0); goal(w, 'tCook', 3.0);
    startAct(w, a, mkAct('leisure', 'Yarning', '', a.x, a.y));
    startAct(w, b, mkAct('fuel', 'Feeding the fire', 'tFuel', w.camp.fire.x, w.camp.fire.y));
    startAct(w, c, mkAct('cook', 'Cooking', 'tCook', w.camp.fire.x + 1, w.camp.fire.y));
    startAct(w, d, mkAct('sleep', 'Sleeping', '', d.x, d.y)); d.sleeping = true;
    expect(answer(w, L, t, a)).toBe('now');
    expect(answer(w, L, t, b)).toBe('promise');
    expect(answer(w, L, t, c)).toBe('first');
    expect(answer(w, L, t, d)).toBe('skip');
    const n0 = w.stats.team.now + w.stats.team.promise + w.stats.team.helpFirst;
    teamTick(w);
    expect(t.crew).toEqual([a.id]);
    expect(a.act!.kind).toBe('buddy');
    expect(b.promise).toBe(L.id); expect(c.promise).toBe(L.id); expect(t.helpWith).toBe(c.id);
    expect(w.stats.team.now + w.stats.team.promise + w.stats.team.helpFirst - n0).toBe(3);
    for (const s of [a, b, c]) expect(s.bark, `${s.name} answers out loud`).toBeTruthy();
  });
  it('a man with an urgent need, or on watch, is not asked', () => {
    const w = staged(); const [L, a, b] = w.scouts;
    startAct(w, L, mkAct('explore', 'Scouting', '', ...farSpot(w, 120), { needBuddy: true }));
    const t = openTeam(w, L, L.act!);
    a.needs.water = 5; startAct(w, b, mkAct('watch', 'On watch', '', b.x, b.y));
    expect(answer(w, L, t, a)).toBe('skip');
    expect(['no', 'skip']).toContain(answer(w, L, t, b));
    expect(actValue(w, b)).toBeGreaterThan(50);
  });
});

describe('teams link up in camp and travel together', () => {
  it('the leader waits for his crew, they leave together and stay together on the way out', () => {
    const w = staged(5); const L = w.scouts[0];
    for (const s of w.scouts.slice(1)) startAct(w, s, mkAct('idle', 'Idle', '', s.x, s.y, { until: w.tick + 50 }));
    const [fx, fy] = farSpot(w, 150);
    startAct(w, L, mkAct('explore', 'Scouting', 'explore', fx, fy, { needBuddy: true }));
    let departed = -1, maxGap = 0, linkGap = 0;
    for (let i = 0; i < TPH() * 2 && L.act && L.act.kind === 'explore'; i++) {
      step(w);
      const t = L.act && L.act.team; if (!t) continue;
      if (t.phase === 'go' && departed < 0) { departed = w.tick; linkGap = Math.max(0, ...crewOf(w, L).map((b) => dist(b.x, b.y, L.x, L.y))); }
      if (departed >= 0 && w.tick - departed > 20) for (const b of crewOf(w, L)) maxGap = Math.max(maxGap, dist(b.x, b.y, L.x, L.y));
    }
    expect(departed, 'the team left').toBeGreaterThan(0);
    expect(linkGap, 'linked up before leaving').toBeLessThanOrEqual(CFG.TEAM_LINK_M + 1);
    expect(maxGap, 'stayed together on the way').toBeLessThan(16);
    expect(w.stats.team.solo).toBe(0);
  });
  it('nobody free: a low-risk job goes solo, a bird loot is cancelled (never dragged alone)', () => {
    for (const kind of ['fetchWater', 'loot']) {
      const w = staged(7); const L = w.scouts[0];
      for (const s of w.scouts.slice(1)) { startAct(w, s, mkAct('sleep', 'Sleeping', '', s.x, s.y)); s.sleeping = true; s.cool['sleepLock'] = 1e9; }
      const [fx, fy] = farSpot(w, 60);
      startAct(w, L, mkAct(kind, kind, '', fx, fy, { needBuddy: true, mode: kind === 'loot' ? 'J' : '' }));
      const t0 = w.tick; let outcome = ''; const solo0 = w.stats.team.solo, can0 = w.stats.team.cancelled;
      while (w.tick - t0 < TPH() * (CFG.TEAM_WAIT_MAX_H + 1) && !outcome) {
        for (const s of w.scouts.slice(1)) { s.sleeping = true; if (!s.act || s.act.kind !== 'sleep') startAct(w, s, mkAct('sleep', 'Sleeping', '', s.x, s.y)); }
        step(w);
        if (w.stats.team.solo > solo0) outcome = 'solo'; else if (w.stats.team.cancelled > can0) outcome = 'cancel';
      }
      expect(outcome, kind).toBe(kind === 'loot' ? 'cancel' : 'solo');
    }
  });
});

describe('joint work in camp', () => {
  it('helpers speed the work up with diminishing returns, and add a quality bonus', () => {
    const w = staged(); const [L, ...rest] = w.scouts;
    startAct(w, L, mkAct('cook', 'Cooking', '', L.x, L.y));
    const muls: number[] = []; const qual: number[] = [];
    for (let k = 0; k <= 3; k++) {
      if (k > 0) { const h = rest[k - 1]; h.x = L.x + k; h.y = L.y; startAct(w, h, mkAct('assist', 'Helping', '', L.x, L.y, { leader: L.id })); }
      const r = teamWork(w, L); muls.push(r.mul); qual.push(r.quality);
    }
    expect(muls).toEqual(CFG.TEAM_WORK.slice(0, 4));
    for (let k = 1; k < 3; k++) expect(muls[k + 1] - muls[k]).toBeLessThan(muls[k] - muls[k - 1]);
    expect(qual[1]).toBeGreaterThan(0);
    // a helper out of range doesn't count
    rest[0].x = L.x + 30; expect(teamWork(w, L).mul).toBe(CFG.TEAM_WORK[2]);
  });
  it('mates do help each other in camp over a normal week', () => {
    const w = createWorld(21, { noRoukha: true }); runDays(w, 5);
    expect(w.stats.team.assists).toBeGreaterThan(8);
    expect(w.stats.team.helpTicks).toBeGreaterThan(1000);
  });
});

describe('outside work in the long run (4 seeds x 8 days, Roukha on)', () => {
  it('teams form, nothing deadlocks, solo trips are rare, no bird is dragged alone, no shots into fog or with a rope in hand', () => {
    for (const seed of [301, 302, 303, 304]) {
      const w = createWorld(seed); let soloLoot = 0;   // a mate who dropped out to fight stays on the team (promised), so that's not solo
      for (let i = 0; i < 8 * CFG.DAY_TICKS; i++) {
        step(w);
        if (i % 10 === 0) for (const s of w.scouts) { const a = s.act; if (a && a.kind.startsWith('loot') && a.team && a.team.phase === 'go' && a.team.crew.length === 0 && a.team.promised.length === 0 && s.status === 'ok' && dist(s.x, s.y, ...campXY(w)) > CFG.FAR_M + 10) soloLoot++; }
      }
      const T = w.stats.team, m = w.stats.mon;
      expect(T.departed, `${seed} teams`).toBeGreaterThan(15);
      expect(T.deadlocks, `${seed} deadlocks`).toBe(0);
      expect(T.solo / Math.max(1, T.departed), `${seed} solo share`).toBeLessThan(0.1);
      expect(T.soloOutsideTicks / Math.max(1, T.outsideTicks), `${seed} time outside alone`).toBeLessThan(0.12);
      expect(T.dragAloneTicks / Math.max(1, T.dragTicks), `${seed} dragged alone`).toBeLessThan(0.05);
      expect(soloLoot, `${seed} solo loot trips`).toBe(0);
      expect(m.fogShots || 0, `${seed} shots into fog`).toBe(0);
      expect(m.dragShots || 0, `${seed} shots with a rope in hand`).toBe(0);
      expect(T.waitTicks / Math.max(1, T.departed + T.cancelled) / TPH(), `${seed} average wait (h)`).toBeLessThan(0.8);
      expect(w.over, `${seed} game over`).toBe('');
    }
  });
});

describe('sight vs fog', () => {
  it('a target on a fog tile cannot be seen even in range; perceive reveals his whole sight radius', () => {
    const w = staged(); const s = w.scouts[0];
    const x = s.x + 10, y = s.y; const ti = tileOf(w, x, y);
    w.map.seen[ti] = 0; expect(canSee(w, s, x, y)).toBe(false);
    w.map.seen[ti] = 1; expect(canSee(w, s, x, y)).toBe(true);
    const r = Math.max(CFG.SCOUT_SIGHT_DAY_M, CFG.REVEAL_DAY_M) - 2; s.x += 0.01;
    for (let k = 0; k < 8; k++) { const ang = [[1, 0], [0, 1], [-1, 0], [0, -1], [0.7, 0.7], [-0.7, 0.7], [0.7, -0.7], [-0.7, -0.7]][k]; w.map.seen[tileOf(w, s.x + ang[0] * r, s.y + ang[1] * r)] = 0; }
    perceive(w, s);
    for (const ang of [[1, 0], [0, 1], [-1, 0], [0, -1]]) expect(w.map.seen[tileOf(w, s.x + ang[0] * r, s.y + ang[1] * r)]).toBe(1);
  });
});

describe('scout speed', () => {
  it('walks at WALK_MS x SCOUT_SPEED_MUL on open grass', () => {
    const w = staged(); const s = w.scouts[0];
    const [fx, fy] = farSpot(w, 60); s.x = fx; s.y = fy;
    startAct(w, s, mkAct('walk', 'Walking', '', fx + 8, fy));
    let moved = 0; for (let i = 0; i < 5; i++) { const ox = s.x, oy = s.y; moveTo(w, s, s.act!.tx, s.act!.ty); moved = Math.max(moved, dist(ox, oy, s.x, s.y)); }
    expect(CFG.SCOUT_SPEED_MUL).toBeGreaterThanOrEqual(1.2);
    expect(moved).toBeGreaterThan(CFG.WALK_MS * CFG.SCOUT_SPEED_MUL / CFG.TICK_HZ * 0.6);
    expect(moved).toBeLessThanOrEqual(CFG.WALK_MS * CFG.SCOUT_SPEED_MUL / CFG.TICK_HZ * 1.6 + 1e-9);
  });
});

describe('the big pre-baked island', () => {
  it('unpacks to the full map and the packing round-trips', () => {
    const t = islandTiles();
    expect(ISLAND_N).toBe(TABE.n); expect(t.length).toBe(TABE.n * TABE.n); expect(TABE.n).toBeGreaterThanOrEqual(700);
    expect(unpackTiles(packTiles(t), t.length)).toEqual(t);
    expect(TABE.tiles.length, 'stored compactly').toBeLessThan(80000);
  });
  it('save/load round-trips on the big map, and saves stay small', () => {
    const w = createWorld(41); runDays(w, 2);
    const s = save(w); expect(s.length).toBeLessThan(600000);
    const b = load(s); expect(hashWorld(b)).toBe(hashWorld(w));
    for (let i = 0; i < 500; i++) { step(w); step(b); }
    expect(hashWorld(b)).toBe(hashWorld(w));
  });
});
