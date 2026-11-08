// v1.2 scenario tests: shared AI modules (needs, home comfort, help requests) used by scouts AND Roukha; nests and
// hunting packs of 4+; fear and retreat; a lone wounded bird flees home bleeding; the firing sequence; pocket rations.
import { describe, it, expect } from 'vitest';
import { createWorld, step, tickAt } from '../src/sim/world';
import { CFG, SPECIES, FOOD } from '../src/sim/config';
import { World, Pack, dist, TPH, invAdd, invGet } from '../src/sim/core';
import { mkAct, startAct, endAct, fireSeat, campXY } from '../src/sim/ai';
import { shootAt, perceive } from '../src/sim/combat';
import { gunfireNear, packFear, birdHit, packOf } from '../src/sim/wild';
import { pocketTick, pocketPts } from '../src/sim/pocket';
import { comfort, unease, groupNeededAt } from '../src/sim/agent/home';
import { urgency, decayNeeds, chooseBest } from '../src/sim/agent/needs';
import { answerRequest, rallyVerdict, collectAnswers, type Answerer, type RequestState } from '../src/sim/agent/request';

const until = (w: World, t: number): void => { while (w.tick < t) step(w); };
function staged(seed = 3, opts = { noRoukha: true, noBoat: true }): World {
  const w = createWorld(seed, opts); until(w, tickAt(2, 10));
  w.scouts.forEach((s, i) => { endAct(w, s); s.status = 'ok'; s.sleeping = false; s.promise = -1; s.combat = false; for (const k of Object.keys(s.needs) as (keyof typeof s.needs)[]) s.needs[k] = 90; const [x, y] = fireSeat(w, s, 10 + i); s.x = x; s.y = y; });
  return w;
}
/** Run until the first hunting pack has set out; returns it (Roukha on). */
function firstHunt(seed: number): { w: World; p: Pack } {
  const w = createWorld(seed);
  for (let i = 0; i < 6 * CFG.DAY_TICKS; i++) { step(w); const p = w.packs.find((q) => q.kind === 'hunt' && q.state === 'approach'); if (p) return { w, p }; }
  throw new Error('no hunt in 6 days');
}

describe('shared AI modules (pure)', () => {
  it('home comfort: 1 at home, linear to 0 at the edge; groups needed beyond the perimeter', () => {
    for (const sp of ['scout', 'roukha'] as const) {
      const r = SPECIES[sp].home;
      expect(comfort(r, 0)).toBe(1); expect(comfort(r, r.safeR)).toBe(1); expect(comfort(r, r.edgeR)).toBe(0);
      expect(comfort(r, (r.safeR + r.edgeR) / 2)).toBeCloseTo(0.5, 5);
      expect(unease(r, r.edgeR + 50)).toBe(1);
      expect(groupNeededAt(r, r.safeR + 1)).toBe(r.awayGroup); expect(groupNeededAt(r, 1)).toBe(1);
    }
    expect(SPECIES.roukha.home.awayGroup).toBe(4);   // Roukha only go out as a pack of 4+
  });
  it('needs: decay per game hour, urgency jumps below urgent, ties go to the first candidate', () => {
    const n = { hunger: 50 }; decayNeeds(n, ['hunger'], SPECIES.roukha.needs, 10);
    expect(n.hunger).toBeCloseTo(50 - SPECIES.roukha.needs.hunger.decayH / 10, 6);
    expect(urgency(80, 60, 25)).toBeLessThan(0.3); expect(urgency(30, 60, 25)).toBeLessThan(urgency(20, 60, 25) - 1.9);
    expect(chooseBest([{ score: 1, k: 'a' }, { score: 1, k: 'b' }])!.k).toBe('a');
  });
  it('help requests: now / gimme a sec / help me first / no, and the rally fallbacks', () => {
    const rules = SPECIES.roukha.team;
    type M = { id: number; v: number; left: number; first: boolean };
    const ad: Answerer<M> = { id: (o) => o.id, unavailable: () => false, value: (o) => o.v, remainingH: (o) => o.left, canHelpFirst: (o) => o.first };
    const req: RequestState = { need: 5, urg: 1.5, crew: [], promised: [], helpWith: -1, phase: 'rally', waitT: 0, asked: {} };
    expect(answerRequest(rules, ad, req, { id: 1, v: 0.3, left: 1, first: false }, 0)).toBe('now');
    expect(answerRequest(rules, ad, req, { id: 2, v: 1.4, left: 0.2, first: false }, 0)).toBe('promise');
    expect(answerRequest(rules, ad, req, { id: 3, v: 2.2, left: 2, first: true }, 0)).toBe('first');
    expect(answerRequest(rules, ad, req, { id: 4, v: 99, left: 2, first: true }, 0)).toBe('no');
    const order = collectAnswers(rules, ad, req, [{ id: 9, v: 2.2, left: 2, first: true }, { id: 8, v: 0.3, left: 1, first: false }], () => 1, 0).map((x) => x.r);
    expect(order).toEqual(['now', 'first']);
    const tph = 10;
    expect(rallyVerdict(rules, { ...req, crew: [1, 2, 3, 4] }, 4, true, tph, () => false)).toBe('full');
    expect(rallyVerdict(rules, { ...req, waitT: 5 }, 1, true, tph, () => false)).toBe('wait');
    expect(rallyVerdict(rules, { ...req, waitT: (rules.waitH + 0.1) * tph }, 3, true, tph, () => false)).toBe('smaller');   // 4 birds: still a pack
    expect(rallyVerdict(rules, { ...req, waitT: (rules.waitH + 0.1) * tph }, 2, true, tph, () => true)).toBe('solo');       // (birds pass soloOk = false)
    expect(rallyVerdict(rules, { ...req, waitT: (rules.waitH + 0.1) * tph }, 2, true, tph, () => false)).toBe('cancel');    // 3 birds don't hunt
  });
});

describe('Roukha nests and packs', () => {
  it('nests sit far from the landing, each with a home flock and a bull', () => {
    const w = createWorld(5);
    expect(w.nests.length).toBeGreaterThanOrEqual(3);
    for (const n of w.nests) {
      expect(dist(n.x, n.y, w.landing.x, w.landing.y)).toBeGreaterThan(250);
      const flock = w.birds.filter((b) => b.nest === n.id);
      expect(flock.length).toBeGreaterThanOrEqual(CFG.NEST_BIRDS[0]);
      expect(flock.some((b) => b.age === 'B')).toBe(true);
      expect(flock.every((b) => packOf(w, b)?.kind === 'home')).toBe(true);
    }
  });
  it('a hunt is mustered through the shared request engine and sets out as a pack of 4+ from one nest', () => {
    const { w, p } = firstHunt(201);
    const ms = w.birds.filter((b) => b.pack === p.id);
    expect(ms.length).toBeGreaterThanOrEqual(4); expect(ms.length).toBeLessThanOrEqual(CFG.HUNT_PACK[1]);
    expect(new Set(ms.map((b) => b.nest)).size).toBe(1);
    expect(w.stats.roukha.musters).toBeGreaterThanOrEqual(1);
    expect(w.stats.roukha.now + w.stats.roukha.promise + w.stats.roukha.helpFirst).toBeGreaterThanOrEqual(3);
    // they left together: everyone within a few metres of the caller
    const cx = ms.reduce((t, b) => t + b.x, 0) / ms.length, cy = ms.reduce((t, b) => t + b.y, 0) / ms.length;
    for (const b of ms) expect(dist(b.x, b.y, cx, cy)).toBeLessThan(2 * SPECIES.roukha.team.linkM + 4);   // mustered at the nest, not strung out
  });
  it('fewer than 4 birds at a nest: no hunting, they stay home feeding and loafing near the nest', () => {
    const w = createWorld(201);
    const keepRegrow = CFG.NEST_REGROW_H; (CFG as { NEST_REGROW_H: number }).NEST_REGROW_H = 1e9;
    try {
      for (const n of w.nests) { n.hatch = 1e12; const fl = w.birds.filter((b) => b.nest === n.id); for (const b of fl.slice(3)) b.state = 'dead'; }
      w.birds = w.birds.filter((b) => b.state !== 'dead'); for (const p of w.packs) p.members = p.members.filter((id) => w.birds.some((b) => b.id === id));
      let maxD = 0;
      for (let i = 0; i < 4 * CFG.DAY_TICKS; i++) { step(w); if (i % 50 === 0) for (const b of w.birds) { const n = w.nests.find((x) => x.id === b.nest)!; maxD = Math.max(maxD, dist(b.x, b.y, n.x, n.y)); } }
      expect(w.stats.roukha.hunts).toBe(0);
      expect(w.stats.roukha.musters).toBe(0);
      expect(maxD).toBeLessThan(SPECIES.roukha.home.safeR + 15);
    } finally { (CFG as { NEST_REGROW_H: number }).NEST_REGROW_H = keepRegrow; }
  });
});

describe('fear and running away', () => {
  it('gunfire alone never breaks a pack; losses do, and it retreats toward its nest', () => {
    const { w, p } = firstHunt(201);
    const ms = w.birds.filter((b) => b.pack === p.id);
    for (let k = 0; k < 200; k++) gunfireNear(w, ms[0]);
    expect(packFear(w, p)).toBeLessThan(CFG.FEAR.breakAt);
    for (let k = 0; k < 50; k++) step(w);
    expect(['approach', 'stalk', 'return']).toContain(p.state);
    // now kill most of the pack (and the bull)
    for (const b of ms.slice().sort((a, c) => (c.age === 'B' ? 1 : 0) - (a.age === 'B' ? 1 : 0)).slice(0, Math.max(2, ms.length - 2))) birdHit(w, b, 9999, null, false);
    expect(packFear(w, p)).toBeGreaterThanOrEqual(CFG.FEAR.breakAt);
    for (let k = 0; k < 6; k++) step(w);
    expect(p.state).toBe('retreat');
    expect(w.stats.roukha.retreats).toBeGreaterThanOrEqual(1);
    const nest = w.nests.find((n) => n.id === p.home)!; const d0 = dist(p.x, p.y, nest.x, nest.y);
    for (let i = 0; i < 300; i++) step(w);
    const live = w.birds.filter((b) => b.pack === p.id);
    if (live.length) { const cx = live.reduce((t, b) => t + b.x, 0) / live.length, cy = live.reduce((t, b) => t + b.y, 0) / live.length; expect(dist(cx, cy, nest.x, nest.y)).toBeLessThan(d0); }
  });
  it('a badly wounded lone bird runs for its nest, bleeding a trail', () => {
    const w = createWorld(7);
    const n = w.nests[0]; const b = w.birds.find((x) => x.nest === n.id && x.age === 'A')!;
    b.x = n.x + 60; b.y = n.y; b.tx = b.x; b.ty = b.y;
    birdHit(w, b, (b.hp - 10) * CFG.BIRD_TOUGH, null, false);
    expect(b.state).toBe('flee'); expect(b.bleeding).toBe(true);
    const d0 = dist(b.x, b.y, n.x, n.y); const s0 = w.signs.filter((s) => s.kind === 'blood').length;
    for (let i = 0; i < 60; i++) step(w);
    if (b.state !== 'dead') expect(dist(b.x, b.y, n.x, n.y)).toBeLessThan(d0 - 5);
    expect(w.signs.filter((s) => s.kind === 'blood').length).toBeGreaterThan(s0);
    expect(w.stats.roukha.flees).toBeGreaterThanOrEqual(1);
  });
});

describe('firing sequence', () => {
  it('crouch -> present (0.5 s) -> aim (1-2 s) -> shot -> bolt (~1 s) -> aim again', () => {
    const w = staged(3, { noRoukha: false, noBoat: true });
    const s = w.scouts[0]; s.mag = 5; s.ammo = 20; s.guns = [{ type: 'rifle', cond: 100 }]; s.skills.shooting = 50; s.jam = 0; s.reload = 0;
    const tx = s.x + 30, ty = s.y; const id = 987654;
    const log: string[] = []; const shots: number[] = []; let n0 = w.stats.shots;
    for (let t = 0; t < 120; t++) {
      shootAt(w, s, id, tx, ty, false);
      log.push(s.posture === 'crouch' ? s.firePhase : 'stand');
      if (w.stats.shots > n0) { shots.push(t); n0 = w.stats.shots; }
    }
    expect(log.slice(0, CFG.CROUCH_TICKS - 1).every((x) => x === 'stand')).toBe(true);
    const firstPresent = log.indexOf('present'), firstAim = log.indexOf('aim'), firstBolt = log.indexOf('bolt');
    expect(firstPresent).toBeGreaterThanOrEqual(CFG.CROUCH_TICKS - 1);
    expect(firstAim - firstPresent).toBeGreaterThanOrEqual(CFG.PRESENT_TICKS - 1);
    expect(shots.length).toBeGreaterThanOrEqual(2);
    const aimTicks = shots[0] - firstAim;
    expect(aimTicks).toBeGreaterThanOrEqual(CFG.AIM_MIN_TICKS - 1); expect(aimTicks).toBeLessThanOrEqual(CFG.AIM_MAX_TICKS + 1);   // 1-2 s
    expect(firstBolt).toBe(shots[0] + 0 + (log[shots[0]] === 'bolt' ? 0 : 1));
    expect(shots[1] - shots[0]).toBeGreaterThanOrEqual(CFG.BOLT_TICKS + CFG.AIM_MIN_TICKS - 2);   // bolt, then a fresh aim
    expect(s.flashT).toBeGreaterThan(0);
  });
  it('a better shot aims faster; a snap shot at a close bird is quicker still', () => {
    const w = staged(3, { noRoukha: false, noBoat: true });
    const need = (skill: number, d: number): number => {
      const s = w.scouts[1]; s.skills.shooting = skill; s.mag = 5; s.guns = [{ type: 'rifle', cond: 100 }]; s.posture = 'crouch'; s.firePhase = 'aim'; s.aimT = 0; s.aimTarget = 1; s.injuries = []; s.hangover = 0;
      shootAt(w, s, 1, s.x + d, s.y, false); return s.aimNeed;
    };
    expect(need(100, 40)).toBeLessThan(need(0, 40));
    expect(need(50, 8)).toBeLessThan(need(50, 40));
  });
});

describe('pocket rations', () => {
  function campWith(items: Partial<Record<'smoked' | 'ration' | 'meal' | 'berries', number>>): World {
    const w = staged(3);
    for (const k of Object.keys(FOOD) as (keyof typeof FOOD)[]) invAdd(w.camp.stock, k, -invGet(w.camp.stock, k));
    for (const [k, v] of Object.entries(items)) invAdd(w.camp.stock, k as 'smoked', v!);
    return w;
  }
  it('heading out he takes non-spoiling food (~150 pts) from the stores; out there he eats it; the rest goes back', () => {
    const w = campWith({ smoked: 30, ration: 10, meal: 10 });
    const s = w.scouts[0]; const [cx, cy] = campXY(w);
    startAct(w, s, mkAct('explore', 'Scouting', '', cx + 200, cy, {}));
    pocketTick(w, s);
    expect(pocketPts(s)).toBeGreaterThanOrEqual(CFG.POCKET_PTS); expect(pocketPts(s)).toBeLessThan(CFG.POCKET_PTS + 40);
    expect(Object.keys(s.pocket).every((k) => !FOOD[k as 'smoked'].spoils)).toBe(true);
    expect(invGet(s.pocket, 'smoked')).toBeGreaterThan(0);   // jerky first
    // out there and hungry: eats from the pocket instead of walking back
    s.x = cx + 150; s.y = cy; s.needs.food = 30; const before = pocketPts(s); const meals0 = w.stats.pocketMeals;
    let snacked = false; for (let t = 0; t < 60 && !snacked; t++) { w.tick++; pocketTick(w, s); if (s.needs.food > 30) snacked = true; }
    expect(snacked).toBe(true); expect(pocketPts(s)).toBeLessThan(before);
    expect(w.stats.pocketMeals - meals0).toBe(1);
    // home with nothing to do outside: what's left goes back into the stores
    endAct(w, s); s.x = cx; s.y = cy; const st0 = invGet(w.camp.stock, 'smoked') + invGet(w.camp.stock, 'ration');
    for (let t = 0; t < 20; t++) { w.tick++; pocketTick(w, s); }
    expect(pocketPts(s)).toBe(0); expect(invGet(w.camp.stock, 'smoked') + invGet(w.camp.stock, 'ration')).toBeGreaterThan(st0);
  });
  it('food data: points per item (a full meal = 100), spoils flags agree with the spoil rates', () => {
    for (const [k, f] of Object.entries(FOOD)) {
      expect(f!.pts, k).toBeGreaterThan(0); expect(f!.pts, k).toBeLessThanOrEqual(100);
      expect(f!.spoils, `${k} spoils flag vs SPOIL_H`).toBe((CFG.SPOIL_H as Record<string, number>)[k] > 0);
    }
    for (const k of CFG.POCKET_PREF) expect(FOOD[k as 'smoked'].spoils, `${k} in POCKET_PREF must keep`).toBe(false);
  });
  it('with only spoilable food in camp nothing is pocketed (he walks back to eat as before)', () => {
    const w = campWith({ meal: 30, berries: 40 });
    const s = w.scouts[0]; const [cx, cy] = campXY(w);
    startAct(w, s, mkAct('explore', 'Scouting', '', cx + 200, cy, {}));
    pocketTick(w, s);
    expect(pocketPts(s)).toBe(0);
  });
  it('pockets never strip the stores below the per-man reserve', () => {
    const w = campWith({ smoked: 20 });   // 640 pts, reserve 5 x 120 = 600
    const [cx, cy] = campXY(w);
    for (const s of w.scouts) { startAct(w, s, mkAct('explore', 'Scouting', '', cx + 200, cy, {})); pocketTick(w, s); }
    expect(invGet(w.camp.stock, 'smoked') * FOOD.smoked.pts).toBeGreaterThanOrEqual(CFG.POCKET_RESERVE * w.scouts.length - FOOD.smoked.pts);
  });
});
void TPH; void perceive;
