// Wildlife. Roukha (v1.2) live at nests and run the same shared AI modules as the scouts (src/sim/agent):
//  - needs:   every bird has a hunger meter (SPECIES.roukha.needs); feeding at home holds it, a hunt fills it up
//  - home:    birds feel safe within SPECIES.roukha.home.safeR of their nest. There they loaf, feed and tend the
//             nest in ones, twos and threes. Nobody goes beyond it in a group smaller than a hunting pack (4+).
//  - request: a hungry bird at the nest calls a hunt with the SAME help-request engine the scouts use for their
//             buddy teams: the flock answers come now / "gimme a sec" (finishing a feed) / "help me first" (tending
//             the nest); they muster at the nest and set out together. Fewer than 4 able birds: no hunt.
// A hunting pack (4-7, led by a bull when it has one) looks for scouts, sizes them up and charges at 2:1 odds or
// better (busy 0.4, downed 0.1), or heads home. Fear: losses, wounds and being far from the nest shake a pack, and
// gunfire rattles it a little (capped: gunfire alone never breaks them). A shaken pack retreats to its nest; a badly
// wounded bird runs for home on its own and leaves a blood trail. The home flock defends its nest.
import { CFG, FEATURES, AGE, AgeClass, SPECIES } from './config';
import { World, Bird, Pack, Scout, Nest, Muster, BirdJob, rnd, rint, dist, TPH, hourOf, isDark, passableAt, newId, addLog, hasLOS, tileCenter, nearestPassable } from './core';
import { able, say, hurt, campXY, fireLit, built, stock } from './ai';
import { addIntel } from './combat';
import { comfort, unease } from './agent/home';
import { decayNeeds, urgency, chooseBest } from './agent/needs';
import { Answerer, collectAnswers, rallyVerdict, short } from './agent/request';

const DT = 1 / CFG.TICK_HZ;
const R = SPECIES.roukha;
const HOME_JOBS: BirdJob[] = ['loaf', 'feed', 'tend', 'roost'];
const HUNGER = ['hunger'] as const;

export function packOf(w: World, b: Bird): Pack | undefined { return w.packs.find((p) => p.id === b.pack); }
function members(w: World, p: Pack): Bird[] { return w.birds.filter((b) => b.pack === p.id && b.state !== 'dead'); }
const nestOf = (w: World, b: Bird): Nest | undefined => w.nests.find((n) => n.id === b.nest);
const atHome = (b: Bird): boolean => HOME_JOBS.indexOf(b.job) >= 0;

function rollAge(w: World): AgeClass { const r = rnd(w); return r < AGE.J.chance ? 'J' : r < AGE.J.chance + AGE.A.chance ? 'A' : 'B'; }
function newPack(w: World, kind: Pack['kind'], nest: Nest, x: number, y: number): Pack {
  const p: Pack = { id: newId(w), kind, members: [], state: kind === 'home' ? 'home' : 'approach', x, y, timer: 0, target: -1, size0: 0, odds: 0, spawned: w.tick, reason: '', bull: -1, bullLost: false, home: nest.id, stalkT: 0, downs: 0, shock: 0, gun: 0, fightT: -1 };
  w.packs.push(p); w.stats.packsSpawned++;
  return p;
}
export function homePack(w: World, nest: Nest): Pack {
  return w.packs.find((p) => p.kind === 'home' && p.home === nest.id && p.state !== 'gone') || newPack(w, 'home', nest, nest.x, nest.y);
}
function addBird(w: World, nest: Nest, age: AgeClass): Bird {
  const p = homePack(w, nest);
  const pt = nearestPassable(w, nest.x + (rnd(w) * 2 - 1) * 12, nest.y + (rnd(w) * 2 - 1) * 12, 4) || [nest.x, nest.y];
  const b: Bird = { id: newId(w), x: pt[0], y: pt[1], px: pt[0], py: pt[1], fx: 1, fy: 0, hp: AGE[age].hp, pack: p.id, state: 'move', tx: pt[0], ty: pt[1], target: -1, peck: 0, age, cracked: false, bleeding: false, flinch: 0,
    nest: nest.id, needs: { hunger: 65 + rnd(w) * 35 }, job: 'loaf', jobUntil: w.tick, promise: -1 };
  w.birds.push(b); p.members.push(b.id);
  return b;
}
function bearingName(dx: number, dy: number): string { return dy < -Math.abs(dx) * 0.6 ? 'north' : dy > Math.abs(dx) * 0.6 ? 'south' : dx > 0 ? 'east' : 'west'; }
/** Nests come from the map (data/maps/<map>.meta.json "nests"). Called at the end of createWorld. */
export function initNests(w: World, tiles: number[][]): void {
  const n = w.map.n; const used = new Set<string>();
  for (const [tx, ty] of tiles) {
    const [x, y] = tileCenter(w, ty * n + tx);
    let name = bearingName(x - w.landing.x, y - w.landing.y); if (used.has(name)) name = name + '-' + (used.size + 1); used.add(name);
    const nest: Nest = { id: newId(w), x, y, name, hatch: 0, cool: 0, muster: null };
    w.nests.push(nest); homePack(w, nest);
    if (w.flags.noRoukha) continue;
    const count = rint(w, CFG.NEST_BIRDS[0], CFG.NEST_BIRDS[1]);
    for (let i = 0; i < count; i++) addBird(w, nest, i === 0 ? 'B' : rollAge(w));   // every nest has its bull
  }
}

// ---------- weights for the 2:1 rule ----------
export function scoutWeight(s: Scout): number {
  if (s.status === 'downed') return CFG.ODDS_W.downed;
  const ready = s.combat || (s.act !== null && (s.act.kind === 'watch' || s.act.kind === 'buddy' || s.act.kind === 'idle'));
  return ready && !s.sleeping ? CFG.ODDS_W.ready : CFG.ODDS_W.busy;
}
/** The birds' view of the odds against scout t: healthy birds / weighted scouts near t that the birds can see. */
export function packOdds(w: World, p: Pack, t: Scout, birds?: Bird[]): number {
  const ms = (birds || members(w, p)).filter((b) => b.hp > CFG.BIRD_FLEE_HP && b.state !== 'flee');
  const sight = isDark(hourOf(w.tick)) ? CFG.BIRD_SIGHT_NIGHT_M : CFG.BIRD_SIGHT_M;
  let def = 0;
  for (const s of w.scouts) {
    if (s.status === 'dead' || dist(s.x, s.y, t.x, t.y) > CFG.ODDS_RADIUS_M) continue;
    if (!ms.some((b) => dist(b.x, b.y, s.x, s.y) < sight && hasLOS(w, b.x, b.y, s.x, s.y)) && s !== t) continue;
    def += scoutWeight(s);
  }
  return ms.length / Math.max(0.1, def);
}
export function seasonFx(w: World): (typeof CFG.SEASON_ROUKHA)[number] { return CFG.SEASON_ROUKHA[w.season % 4]; }
function chargeThreshold(w: World, t: Scout, p?: Pack): number {
  let th = (isDark(hourOf(w.tick)) ? CFG.CHARGE_ODDS_NIGHT : CFG.CHARGE_ODDS) + seasonFx(w).oddsMod;
  const nest = p ? w.nests.find((n) => n.id === p.home) : undefined;
  if (nest && dist(t.x, t.y, nest.x, nest.y) < CFG.NEST_GUARD_M) th += CFG.NEST_ODDS_MOD;   // territorial at the nest
  if (built(w, 'palisade') && dist(t.x, t.y, w.camp.x, w.camp.y) < 15) th += 0.5;
  return th;
}

// ---------- fear (pack morale) ----------
/** How shaken a pack is: shock (losses, wounds) + gunfire (capped) + unease at being far from the nest. */
export function packFear(w: World, p: Pack): number {
  const nest = w.nests.find((n) => n.id === p.home);
  const far = nest ? unease(R.home, dist(p.x, p.y, nest.x, nest.y)) * CFG.FEAR.far : 0;
  return p.shock + p.gun + far;
}
/** Gunfire close by: rattles them a little, never enough to break a pack on its own (FEAR.gunCap + FEAR.far < FEAR.breakAt). */
export function gunfireNear(w: World, b: Bird): void {
  const p = packOf(w, b); if (p) p.gun = Math.min(CFG.FEAR.gunCap, p.gun + CFG.FEAR.gunfire);
}

// ---------- director: nests refill (endless supply, but never in front of the scouts) ----------
export function directorTick(w: World): void {
  if (w.flags.noRoukha) return;
  const tph = TPH();
  if (w.tick % Math.floor(tph) !== 0) return;
  for (const nest of w.nests) {
    const pop = w.birds.filter((b) => b.nest === nest.id && b.state !== 'dead').length;
    if (pop >= CFG.NEST_MAX || w.tick < nest.hatch) continue;
    if (w.scouts.some((s) => s.status !== 'dead' && dist(s.x, s.y, nest.x, nest.y) < CFG.SPAWN_HIDE_M)) continue;
    nest.hatch = w.tick + CFG.NEST_REGROW_H * tph;
    addBird(w, nest, pop === 0 || !w.birds.some((b) => b.nest === nest.id && b.age === 'B' && b.state !== 'dead') ? 'B' : rollAge(w));
  }
}

// ---------- life at the nest ----------
function homeSpot(w: World, nest: Nest, b: Bird, r: number): [number, number] {
  // flock in small knots: half the time near a nest-mate who is also out feeding or loafing
  const mates = w.birds.filter((o) => o !== b && o.nest === nest.id && o.state !== 'dead' && atHome(o) && o.job !== 'roost');
  if (mates.length && rnd(w) < 0.5) { const m = mates[rint(w, 0, mates.length - 1)]; const x = m.tx + (rnd(w) * 2 - 1) * 4, y = m.ty + (rnd(w) * 2 - 1) * 4; if (passableAt(w, x, y) && dist(x, y, nest.x, nest.y) < R.home.safeR) return [x, y]; }
  for (let k = 0; k < 6; k++) { const x = nest.x + (rnd(w) * 2 - 1) * r, y = nest.y + (rnd(w) * 2 - 1) * r; if (passableAt(w, x, y) && dist(x, y, nest.x, nest.y) <= r) return [x, y]; }
  return [nest.x, nest.y];
}
/** Pick the next home activity (shared utility: highest score wins). */
function nextHomeJob(w: World, nest: Nest, b: Bird): void {
  const tph = TPH(); const h = hourOf(w.tick); const hr = R.needs.hunger;
  // a promise ("gimme a sec") is kept as soon as the feed is done
  if (b.promise >= 0 && nest.muster && nest.muster.leader === b.promise && nest.muster.promised.indexOf(b.id) >= 0) {
    const m = nest.muster; m.promised = m.promised.filter((x) => x !== b.id); m.crew.push(b.id); b.promise = -1; b.job = 'muster'; b.jobUntil = w.tick; return;
  }
  b.promise = -1;
  const night = isDark(h);
  const best = chooseBest([
    { score: night ? 2.0 : 0, job: 'roost' as BirdJob },
    { score: urgency(b.needs.hunger, hr.seek, hr.urgent) * (night ? 0.3 : 1) + rnd(w) * 0.3, job: 'feed' as BirdJob },
    { score: 0.6 + rnd(w) * 0.3, job: 'loaf' as BirdJob },
    { score: 0.35 + (b.age === 'B' ? 0.25 : 0) + rnd(w) * 0.25, job: 'tend' as BirdJob },
  ])!;
  b.job = best.job; b.state = 'move';
  const dur = best.job === 'roost' ? 1.5 : best.job === 'feed' ? 0.6 + rnd(w) * 0.6 : best.job === 'tend' ? 0.8 + rnd(w) * 0.7 : 0.5 + rnd(w) * 0.5;
  b.jobUntil = w.tick + Math.round(dur * tph);
  const [x, y] = best.job === 'roost' ? homeSpot(w, nest, b, 6) : best.job === 'tend' ? homeSpot(w, nest, b, 3) : best.job === 'loaf' ? homeSpot(w, nest, b, 25) : homeSpot(w, nest, b, R.home.safeR * 0.9);
  b.tx = x; b.ty = y;
}

// ---------- mustering a hunt: the shared help-request engine ----------
function jobValue(b: Bird): number { return b.job === 'loaf' ? 0.3 : b.job === 'roost' ? 0.8 : b.job === 'feed' ? 1.4 : b.job === 'tend' ? 2.2 : 99; }
function birdAnswerer(w: World, L: Bird): Answerer<Bird> {
  return {
    id: (o) => o.id,
    unavailable: (o) => o === L || o.state === 'dead' || o.state === 'flee' || !atHome(o) || o.promise >= 0 || o.hp < AGE[o.age].hp * 0.6 || o.nest !== L.nest,
    value: (o) => jobValue(o),
    remainingH: (o) => Math.max(0, o.jobUntil - w.tick) / TPH(),
    canHelpFirst: (o) => o.job === 'tend',
  };
}
function huntHours(h: number): boolean { const [a, b] = CFG.HUNT_HOURS; return a <= b ? h >= a && h < b : h >= a || h < b; }
function maybeCallHunt(w: World, nest: Nest): void {
  const tph = TPH();
  if (nest.muster || w.tick < nest.cool || w.tick < CFG.PACK_GRACE_H * tph || !w.camp.sited || w.tick < (w.raidCalm || 0)) return;
  if (w.packs.filter((p) => p.kind === 'hunt' && p.state !== 'gone').length >= CFG.MAX_HUNTS_OUT) return;
  if (w.nests.some((n) => n.muster)) return;   // one hunt being called at a time across the island
  const hp = homePack(w, nest); if (hp.state !== 'home') return;
  const home = members(w, hp).filter((b) => atHome(b) && b.hp >= AGE[b.age].hp * 0.6);
  if (home.length < R.team.minTeam) return;   // too few: they stay home where they feel safe
  const hr = R.needs.hunger; const h = hourOf(w.tick);
  const hungry = home.filter((b) => b.needs.hunger < hr.seek).sort((p, q) => p.needs.hunger - q.needs.hunger || (q.age === 'B' ? 1 : 0) - (p.age === 'B' ? 1 : 0) || p.id - q.id);
  const L = hungry[0]; if (!L) return;
  if (!huntHours(h) && L.needs.hunger >= hr.urgent) return;   // they set out late in the day (or any time when starving)
  const scent = (fireLit(w) ? CFG.SCENT.fire : 0) + (w.camp.latrine.built ? CFG.SCENT.latrine : 0) + (stock(w, 'rawMeat') + stock(w, 'meal')) * CFG.SCENT.food + w.scentBoost
    + w.scouts.filter((s) => s.status === 'downed' || (s.status === 'ok' && s.hp < 50)).length * CFG.SCENT.wounded;
  const urg = urgency(L.needs.hunger, hr.seek, hr.urgent) + (isDark(h) ? CFG.HUNT_NIGHT_URG : 0) + Math.min(CFG.HUNT_SCENT_URG, scent * 0.1);   // hungry + dark + camp smells good = more birds drop what they are doing
  const need = Math.min(home.length, rint(w, CFG.HUNT_PACK[0], CFG.HUNT_PACK[1]));
  nest.muster = { need, urg, crew: [], promised: [], helpWith: -1, phase: 'rally', waitT: 0, asked: {}, leader: L.id, rx: nest.x, ry: nest.y, posted: w.tick };
  L.job = 'muster'; L.promise = -1; L.state = 'move'; L.tx = nest.x; L.ty = nest.y;
  w.stats.roukha.musters++;
  addLog(w, 'Roukha', `${nest.name} nest: ${AGE[L.age].label === 'adult' ? 'an adult' : 'a ' + AGE[L.age].label} calls the flock together to hunt (needs ${need})`, 'event');
}
function musterTick(w: World, nest: Nest): void {
  const m = nest.muster as Muster; const tph = TPH();
  const L = w.birds.find((b) => b.id === m.leader);
  if (!L || L.state === 'dead' || L.job !== 'muster') { endMuster(w, nest, 'cancel'); return; }
  m.waitT++;
  const byId = (id: number): Bird | undefined => w.birds.find((b) => b.id === id);
  if (w.tick % CFG.DECIDE_EVERY === 0) {
    m.crew = m.crew.filter((id) => { const b = byId(id); return !!b && b.state !== 'dead' && b.job === 'muster'; });
    m.promised = m.promised.filter((id) => { const b = byId(id); return !!b && b.state !== 'dead' && b.promise === L.id && atHome(b); });
    if (m.helpWith >= 0) { const hb = byId(m.helpWith); if (!hb || hb.job !== 'tend' || m.promised.indexOf(hb.id) < 0) m.helpWith = -1; }
    if (short(m)) {
      const flock = members(w, homePack(w, nest));
      for (const { o, r } of collectAnswers(R.team, birdAnswerer(w, L), m, flock, (o) => dist(o.x, o.y, L.x, L.y), w.tick)) {
        if (!short(m)) break;
        if (r === 'now') { o.job = 'muster'; o.promise = -1; o.state = 'move'; m.crew.push(o.id); w.stats.roukha.now++; }
        else if (r === 'promise') { o.promise = L.id; m.promised.push(o.id); w.stats.roukha.promise++; }
        else if (r === 'first') { o.promise = L.id; m.promised.push(o.id); m.helpWith = o.id; w.stats.roukha.helpFirst++; o.jobUntil = Math.min(o.jobUntil, w.tick + Math.round(0.6 * tph)); }
        else m.asked[o.id] = w.tick + R.team.reaskH * tph;
      }
    }
  }
  // the caller waits at the nest (or lends a hand tending first); the others gather round
  const hb = m.helpWith >= 0 ? byId(m.helpWith) : undefined;
  if (hb && hb.job === 'tend') { L.tx = hb.x + 1.2; L.ty = hb.y + 0.8; hb.jobUntil = Math.min(hb.jobUntil, w.tick + Math.round(0.3 * tph)); } else { L.tx = m.rx; L.ty = m.ry; }
  m.crew.forEach((id, i) => { const b = byId(id); if (b) { b.tx = m.rx + ((i % 3) - 1) * 2.2; b.ty = m.ry + 2 + Math.floor(i / 3) * 2; } });
  const crew = m.crew.map(byId).filter((b): b is Bird => !!b);
  const linked = m.helpWith < 0 && crew.every((b) => dist(b.x, b.y, L.x, L.y) <= R.team.linkM) && dist(L.x, L.y, m.rx, m.ry) < R.team.linkM;
  const v = rallyVerdict(R.team, m, crew.length, linked, tph, () => false);   // birds never hunt alone
  if (v === 'wait') return;
  if (v === 'deadlock') { w.stats.roukha.deadlocks++; w.stats.mon.notes.push(`roukha muster deadlock ${nest.name} t${w.tick}`); }
  if (v === 'full' || v === 'smaller') { setOut(w, nest, L, crew); return; }
  endMuster(w, nest, 'cancel');
}
function endMuster(w: World, nest: Nest, why: 'cancel'): void {
  const m = nest.muster; if (!m) return;
  for (const b of w.birds) if (b.nest === nest.id && (b.job === 'muster' || b.promise >= 0) && b.state !== 'dead') { b.promise = -1; if (b.job === 'muster') { b.job = 'loaf'; b.jobUntil = w.tick; } }
  nest.muster = null; nest.cool = w.tick + 1.5 * TPH();
  if (why === 'cancel') w.stats.roukha.musterCancel++;
}
function setOut(w: World, nest: Nest, L: Bird, crew: Bird[]): void {
  const birds = [L, ...crew]; const hp = homePack(w, nest);
  const p = newPack(w, 'hunt', nest, L.x, L.y);
  for (const b of birds) { b.pack = p.id; b.job = 'pack'; b.promise = -1; b.state = 'move'; p.members.push(b.id); hp.members = hp.members.filter((x) => x !== b.id); }
  for (const b of w.birds) if (b.nest === nest.id && b.promise === L.id) b.promise = -1;
  const bull = birds.find((b) => b.age === 'B'); p.bull = bull ? bull.id : -1;
  p.size0 = birds.length; p.timer = 0;
  p.reason = 'hunting'; nest.muster = null; nest.cool = w.tick + CFG.HUNT_COOL_H * TPH();
  w.stats.roukha.hunts++; w.stats.roukha.packSizes[birds.length] = (w.stats.roukha.packSizes[birds.length] || 0) + 1;
  addLog(w, 'Roukha', `a pack of ${birds.length}${bull ? ', led by a bull,' : ''} sets out from the ${nest.name} nest to hunt (unseen)`, 'event');
}
/** A hunting pack is back at its nest: it breaks up into the home flock. */
function disband(w: World, p: Pack): void {
  const nest = w.nests.find((n) => n.id === p.home); if (!nest) { p.state = 'gone'; return; }
  const hp = homePack(w, nest);
  const fed = CFG.HUNT_FED * (p.state === 'retreat' ? 0.5 : 1);
  for (const b of members(w, hp)) if (b.state !== 'dead') b.needs.hunger = Math.min(100, b.needs.hunger + fed * CFG.HUNT_SHARE);
  for (const b of members(w, p)) { b.pack = hp.id; hp.members.push(b.id); b.target = -1; if (b.state !== 'flee') { b.job = 'loaf'; b.jobUntil = w.tick; b.state = 'move'; } b.needs.hunger = Math.min(100, b.needs.hunger + fed); }
  p.state = 'gone'; p.members = [];
}

// ---------- pack and bird behaviour ----------
export function wildTick(w: World): void {
  const tph = TPH(); const dark = isDark(hourOf(w.tick));
  for (const nest of w.nests) { if (nest.muster) musterTick(w, nest); else if (w.tick % CFG.DECIDE_EVERY === 0) maybeCallHunt(w, nest); }
  if (w.tick % 5 === 0) for (const p of w.packs) {
    if (p.state === 'gone') continue;
    const ms = members(w, p);
    if (!ms.length && p.kind === 'hunt') { p.state = 'gone'; continue; }
    const nest = w.nests.find((n) => n.id === p.home);
    // fear fades
    p.shock = Math.max(0, p.shock - (CFG.FEAR.decayH / tph) * 5); p.gun = Math.max(0, p.gun - (CFG.FEAR.gunDecayH / tph) * 5);
    if (!ms.length) continue;
    let sx = 0, sy = 0; for (const b of ms) { sx += b.x; sy += b.y; } const ax = sx / ms.length, ay = sy / ms.length;
    p.x = ax; p.y = ay;
    const live = w.scouts.filter((s) => able(s));
    if (p.kind === 'home') { homeFlockTick(w, p, ms, nest!, live); continue; }
    const healthy = ms.filter((b) => b.hp > CFG.BIRD_FLEE_HP).length;
    // a shaken pack retreats to its nest (losing, badly hurt, far from home); mere gunfire can't do it (shock > 0)
    if ((p.state === 'approach' || p.state === 'stalk' || p.state === 'charge') && p.shock > 0 && packFear(w, p) >= CFG.FEAR.breakAt) { retreat(w, p, p.bullLost ? 'the bull is down, they break' : 'losing, they break for the nest'); continue; }
    switch (p.state) {
      case 'approach': case 'stalk': {
        p.timer += 5;
        if (p.timer > CFG.HUNT_TRIP_H * tph) { goHome(w, p, 'no luck, back to the nest'); break; }
        let best: Scout | null = null, bo = -1;
        for (const s of w.scouts) { if (s.status === 'dead' || s.status === 'downed') continue; const o = packOdds(w, p, s) - dist(s.x, s.y, ax, ay) / 400; if (o > bo) { bo = o; best = s; } }
        if (!best) { goHome(w, p, 'no prey'); break; }
        p.target = best.id; p.odds = packOdds(w, p, best);
        const sd = dark ? CFG.STALK_M_NIGHT : CFG.STALK_M_DAY;
        const d = dist(best.x, best.y, ax, ay);
        const seenByScouts = w.scouts.some((s) => s.threat && ms.some((b) => b.id === s.threat!.id) && w.tick - s.threat.t < 20);
        if (p.state === 'approach') {
          setGoal(w, p, best.x + ((ax - best.x) / Math.max(1, d)) * sd, best.y + ((ay - best.y) / Math.max(1, d)) * sd);
          if (d < sd + 6) { p.state = 'stalk'; p.stalkT = CFG.STALK_H * tph; }
          break;
        }
        if (p.odds >= chargeThreshold(w, best, p)) { charge(w, p, ms, best, `${ms.length} birds charge (odds ${p.odds.toFixed(1)}:1)`); break; }
        if (seenByScouts && p.odds < 1) { goHome(w, p, 'spotted and outnumbered'); break; }
        p.stalkT -= 5;
        if (p.stalkT <= 0) { goHome(w, p, 'no opening'); break; }
        setGoal(w, p, best.x + ((ax - best.x) / Math.max(1, d)) * sd, best.y + ((ay - best.y) / Math.max(1, d)) * sd);
        break;
      }
      case 'charge': {
        p.timer -= 5;
        const standing = live.filter((s) => dist(s.x, s.y, ax, ay) < CFG.CHARGE_REACH_M);   // a charge starts from stalking range
        const tgt = w.scouts.find((s) => s.id === p.target);
        const lost = p.size0 - healthy;
        if (lost > 0 && tgt && able(tgt) && packOdds(w, p, tgt) < CFG.ROUT_ODDS) p.shock += CFG.FEAR.badOdds;   // losing the fight shakes them
        if (p.timer <= 0 || !standing.length) { goHome(w, p, 'prey down or gone'); break; }
        for (const b of ms) {
          if (b.state !== 'charge') continue;
          const t = w.scouts.find((s) => s.id === b.target);
          if (!t || !able(t)) { const nt = live.slice().sort((x, y) => dist(x.x, x.y, b.x, b.y) - dist(y.x, y.y, b.x, b.y) || x.id - y.id)[0]; b.target = nt && dist(nt.x, nt.y, b.x, b.y) < 30 ? nt.id : -1; }
        }
        break;
      }
      case 'return': case 'retreat': {
        if (!nest) { p.state = 'gone'; break; }
        if (dist(ax, ay, nest.x, nest.y) < 12) { disband(w, p); break; }
        if (w.tick % 25 === 0 || ms.some((b) => b.state === 'charge')) setGoal(w, p, nest.x, nest.y);
        break;
      }
    }
  }
  // birds: needs, home life, movement
  for (const b of w.birds) {
    if (b.state === 'dead') continue;
    b.px = b.x; b.py = b.y;
    decayNeeds(b.needs, HUNGER, R.needs, tph);   // shared needs module
    if (b.bleeding) { b.hp -= CFG.TRAIL_BLEED_HP_H / tph; if (w.tick % 20 === 0) w.signs.push({ id: newId(w), x: b.x, y: b.y, t: w.tick, pack: b.pack, kind: 'blood' }); if (b.hp <= 0) { killBird(w, b, null, false); continue; } }
    const nest = nestOf(w, b);
    if (atHome(b) && nest) {
      if (b.state !== 'charge' && w.tick >= b.jobUntil) nextHomeJob(w, nest, b);
      if (b.job === 'feed') b.needs.hunger = Math.min(100, b.needs.hunger + CFG.FEED_GAIN_H / tph);
      if (b.state !== 'charge' && w.tick % 60 === b.id % 60 && dist(b.x, b.y, b.tx, b.ty) < 1 && b.job !== 'roost') { const x = b.tx + (rnd(w) * 2 - 1) * 2, y = b.ty + (rnd(w) * 2 - 1) * 2; if (passableAt(w, x, y) && dist(x, y, nest.x, nest.y) < R.home.safeR) { b.tx = x; b.ty = y; } }
    }
    if (b.state === 'flee' && nest && dist(b.x, b.y, nest.x, nest.y) < 8) {   // made it home: back in the flock
      const p = packOf(w, b); const hp = homePack(w, nest);
      if (p && p !== hp) { p.members = p.members.filter((x) => x !== b.id); hp.members.push(b.id); b.pack = hp.id; }
      b.state = 'move'; b.job = 'roost'; b.jobUntil = w.tick + Math.round(2 * tph); b.tx = nest.x + (rnd(w) * 2 - 1) * 3; b.ty = nest.y + (rnd(w) * 2 - 1) * 3;
    }
    if (b.flinch > 0) { b.flinch--; continue; }   // gunfire made it hesitate
    let tx = b.tx, ty = b.ty, spd = CFG.BIRD_WALK_MS * (b.age === 'J' ? 1.05 : 1) * (atHome(b) ? 0.6 : 1);
    if (b.state === 'charge') {
      const t = w.scouts.find((s) => s.id === b.target);
      if (t && able(t)) {
        tx = t.x; ty = t.y; spd = CFG.BIRD_RUN_MS;
        // no more than MAX_ON_ONE birds on one scout: the rest switch to another one nearby, or circle
        if (dist(b.x, b.y, t.x, t.y) < 4 && dist(b.x, b.y, t.x, t.y) >= CFG.PECK_M && w.birds.filter((o) => o !== b && o.state === 'charge' && o.target === t.id && dist(o.x, o.y, t.x, t.y) < CFG.PECK_M).length >= CFG.MAX_ON_ONE) {
          const alt = w.scouts.filter((o) => o !== t && able(o) && dist(o.x, o.y, b.x, b.y) < 30 && w.birds.filter((q) => q.state === 'charge' && q.target === o.id).length < CFG.MAX_ON_ONE).sort((a, c) => dist(a.x, a.y, b.x, b.y) - dist(c.x, c.y, b.x, b.y) || a.id - c.id)[0];
          if (alt) b.target = alt.id; else { b.flinch = 3; continue; }
        }
        if (dist(b.x, b.y, t.x, t.y) < CFG.PECK_M) {
          if (--b.peck <= 0) {
            b.peck = CFG.PECK_EVERY;
            const atk = CFG.BIRD_ATTACKS[rint(w, 0, CFG.BIRD_ATTACKS.length - 1)];
            t.threat = { id: b.id, x: b.x, y: b.y, t: w.tick };
            if (rnd(w) < 0.75) {
              if (w.tick % 3 === 0) addLog(w, 'Roukha', `${atk} on ${t.name}`, 'combat');
              hurt(w, t, CFG.PECK_DMG * AGE[b.age].dmgMul * (0.7 + rnd(w) * 0.6), 'a Roukha ' + atk);
              const bp = packOf(w, b);
              if (bp) {
                bp.shock = Math.max(0, bp.shock - (t.status === 'ok' ? CFG.FEAR.bite : CFG.FEAR.downed));   // winning steadies them
                if (t.status !== 'ok' && ++bp.downs >= CFG.PACK_SATED_DOWNS && bp.kind === 'hunt' && bp.state === 'charge') goHome(w, bp, 'blood enough, back to the nest');
              }
            }
          }
          continue;
        }
      } else { const p = packOf(w, b); tx = p ? p.x : b.x; ty = p ? p.y : b.y; }
    } else if (b.state === 'flee') { spd = CFG.BIRD_RUN_MS * 0.8; if (nest) { tx = nest.x; ty = nest.y; } }
    else {
      const p = packOf(w, b);
      if (p && p.kind === 'hunt') spd = p.state === 'retreat' ? CFG.BIRD_RUN_MS * 0.85 : p.state === 'stalk' ? CFG.BIRD_WALK_MS : CFG.BIRD_TROT_MS;
      else if (b.job === 'muster') spd = CFG.BIRD_WALK_MS;
    }
    steer(w, b, tx, ty, spd * DT);
  }
  w.birds = w.birds.filter((b) => b.state !== 'dead');
  w.packs = w.packs.filter((p) => p.state !== 'gone' || w.tick - p.spawned < 10);
  for (const p of w.packs) p.members = p.members.filter((id) => w.birds.some((b) => b.id === id));
}
/** The home flock: signs and calls (how scouts find them), and defending the nest. */
function homeFlockTick(w: World, p: Pack, ms: Bird[], nest: Nest, live: Scout[]): void {
  const tph = TPH();
  const out = ms.filter((b) => atHome(b) || b.state === 'charge');
  if (out.length) {
    const k = out[(w.tick / 5) % out.length | 0];
    if (w.tick % Math.floor(CFG.SIGN_EVERY_H * tph) < 5) w.signs.push({ id: newId(w), x: k.x, y: k.y, t: w.tick, pack: p.id, kind: (['tracks', 'feathers', 'droppings'] as const)[rint(w, 0, 2)] });
    if (w.tick % Math.floor(tph) < 5 && rnd(w) < CFG.CALL_CHANCE_H) {
      for (const s of live) {
        if (s.sleeping || dist(s.x, s.y, k.x, k.y) > CFG.CALL_HEAR_M) continue;
        if (rnd(w) < 0.5 + s.skills.tracking / 200) {
          const e = CFG.CALL_ERROR_M * (1 - s.skills.tracking / 150);
          addIntel(w, p.id, k.x + (rnd(w) * 2 - 1) * e, k.y + (rnd(w) * 2 - 1) * e, 'call', -1);
          if ((w.plan.warned['call'] || 0) < w.tick) { w.plan.warned['call'] = w.tick + 2 * tph; say(w, s, 'call'); }
          break;
        }
      }
    }
  }
  for (const b of ms) if (b.bleeding) addIntel(w, p.id, b.x, b.y, 'trail', b.id);
  if (p.state === 'charge') {
    // defending: keep going while scouts stand near the nest and the birds aren't shaken
    p.timer -= 5;
    const near = live.filter((s) => dist(s.x, s.y, nest.x, nest.y) < R.home.safeR + 20);
    if (p.timer <= 0 || !near.length || (p.shock > 0 && packFear(w, p) >= CFG.FEAR.breakAt)) {
      if (p.shock > 0 && packFear(w, p) >= CFG.FEAR.breakAt) { w.stats.roukha.scatters++; addLog(w, 'Roukha', `the ${nest.name} nest birds break off and scatter to the nest`, 'combat'); }
      endFight(w, p); p.state = 'home';
      for (const b of ms) if (b.state === 'charge') { b.state = 'move'; b.job = 'roost'; b.jobUntil = w.tick + Math.round(0.8 * tph); b.tx = nest.x + (rnd(w) * 2 - 1) * 4; b.ty = nest.y + (rnd(w) * 2 - 1) * 4; }
      return;
    }
    for (const b of ms) if (b.state === 'charge') { const t = w.scouts.find((s) => s.id === b.target); if (!t || !able(t)) { const nt = near.slice().sort((x, y) => dist(x.x, x.y, b.x, b.y) - dist(y.x, y.y, b.x, b.y) || x.id - y.id)[0]; b.target = nt ? nt.id : -1; if (!nt) b.state = 'move'; } }
    return;
  }
  // scouts at the nest: the flock rises to defend it if the odds suit them (worse odds accepted at the nest)
  const intruder = live.filter((s) => dist(s.x, s.y, nest.x, nest.y) < CFG.NEST_GUARD_M).sort((a, b) => dist(a.x, a.y, nest.x, nest.y) - dist(b.x, b.y, nest.x, nest.y) || a.id - b.id)[0];
  if (intruder && w.tick % 25 === 0) defendOrScatter(w, p, nest, intruder);
}
function defenders(w: World, nest: Nest, ms: Bird[]): Bird[] { return ms.filter((b) => atHome(b) && b.hp > CFG.BIRD_FLEE_HP && dist(b.x, b.y, nest.x, nest.y) < R.home.safeR + 10); }
function defendOrScatter(w: World, p: Pack, nest: Nest, s: Scout): void {
  const ms = members(w, p); const def = defenders(w, nest, ms);
  if (def.length && packOdds(w, p, s, def) >= chargeThreshold(w, s, p)) {
    if (nest.muster) endMuster(w, nest, 'cancel');
    p.state = 'charge'; p.target = s.id; p.timer = CFG.CHARGE_MAX_S * CFG.TICK_HZ; w.stats.charges++; w.stats.roukha.defends++; startFight(w, p);
    addLog(w, 'Roukha', `the ${nest.name} nest birds rise to defend it (${def.length})`, 'combat');
    for (const b of def) { b.state = 'charge'; b.target = s.id; b.promise = -1; }
  } else {
    // too many guns: the birds near him slip back to the nest
    for (const b of ms) if (atHome(b) && dist(b.x, b.y, s.x, s.y) < 40) { b.job = 'roost'; b.jobUntil = w.tick + Math.round(0.8 * TPH()); b.tx = nest.x + (rnd(w) * 2 - 1) * 5; b.ty = nest.y + (rnd(w) * 2 - 1) * 5; }
  }
}
function charge(w: World, p: Pack, ms: Bird[], t: Scout, why: string): void {
  p.state = 'charge'; p.target = t.id; p.timer = CFG.CHARGE_MAX_S * CFG.TICK_HZ; w.stats.charges++; startFight(w, p);
  addLog(w, 'Roukha', why, 'combat');
  const sp = w.scouts.find((s) => able(s) && dist(s.x, s.y, p.x, p.y) < 100); if (sp) say(w, sp, 'charge', {}, 'combat');
  for (const b of ms) if (b.state !== 'flee') { b.state = 'charge'; b.target = t.id; }
}
function startFight(w: World, p: Pack): void { if (p.fightT < 0) p.fightT = w.tick; }
function endFight(w: World, p: Pack): void { if (p.fightT >= 0) { w.stats.roukha.fights++; w.stats.roukha.fightTicks += w.tick - p.fightT; p.fightT = -1; } }
function setGoal(w: World, p: Pack, x: number, y: number): void {
  const ms = members(w, p); let i = 0;
  for (const b of ms) { if (b.state === 'flee') continue; if (b.state === 'charge' && p.state === 'charge') continue; b.tx = x + (i % 3) * 2 - 2; b.ty = y + Math.floor(i / 3) * 2; b.state = 'move'; i++; }
}
function steer(w: World, b: Bird, tx: number, ty: number, step: number): void {
  const d = dist(b.x, b.y, tx, ty); if (d < 0.3) return;
  const mx = ((tx - b.x) / d) * Math.min(step, d), my = ((ty - b.y) / d) * Math.min(step, d);
  b.fx = mx / Math.max(1e-6, Math.min(step, d)); b.fy = my / Math.max(1e-6, Math.min(step, d));
  if (passableAt(w, b.x + mx, b.y + my)) { b.x += mx; b.y += my; return; }
  // slide around obstacles
  if (passableAt(w, b.x + mx, b.y)) { b.x += mx; return; }
  if (passableAt(w, b.x, b.y + my)) { b.y += my; return; }
  if (passableAt(w, b.x - my, b.y + mx)) { b.x -= my; b.y += mx; return; }
  if (passableAt(w, b.x + my, b.y - mx)) { b.x += my; b.y -= mx; }
}
/** The hunt is over without a rout: head home at a walk. */
function goHome(w: World, p: Pack, why: string): void {
  if (p.state === 'return' || p.state === 'retreat') return;
  endFight(w, p);
  p.state = 'return'; p.reason = why; w.stats.withdraws++; w.stats.roukha.returns++;
  w.raidCalm = w.tick + CFG.RAID_CALM_H * TPH();
  for (const b of members(w, p)) { if (b.state !== 'flee') b.state = 'move'; b.target = -1; }
  const nest = w.nests.find((n) => n.id === p.home); if (nest) setGoal(w, p, nest.x, nest.y);
  addLog(w, 'Roukha', `the pack pulls back (${why})`, 'combat');
}
/** Fear won: the pack runs for its nest. */
export function retreat(w: World, p: Pack, why: string): void {
  if (p.state === 'retreat') return;
  endFight(w, p);
  p.state = 'retreat'; p.reason = why; w.stats.withdraws++; w.stats.roukha.retreats++;
  w.raidCalm = w.tick + CFG.RAID_CALM_H * TPH();
  for (const b of members(w, p)) { if (b.state !== 'flee') b.state = 'move'; b.target = -1; }
  const nest = w.nests.find((n) => n.id === p.home); if (nest) setGoal(w, p, nest.x, nest.y);
  addLog(w, 'Roukha', `the pack retreats toward its nest (${why})`, 'combat');
}

export function birdHit(w: World, b: Bird, dmg: number, shooter: Scout | null, head: boolean): void {
  b.hp -= head ? dmg : dmg / CFG.BIRD_TOUGH;
  if (b.hp <= 0) { killBird(w, b, shooter, head); return; }
  if (b.hp < AGE[b.age].hp * 0.5) b.bleeding = true;
  const p = packOf(w, b);
  if (p) p.shock += CFG.FEAR.wound;
  // badly hurt: it runs for its nest on its own, leaving a blood trail
  // (in a charge, with the pack still around it, a wounded bird presses on until it is nearly done)
  const backed = !!p && p.kind === 'hunt' && p.state === 'charge' && members(w, p).filter((o) => o !== b && o.state === 'charge').length >= 2;
  if (b.hp < CFG.BIRD_FLEE_HP * (backed ? CFG.BIRD_PRESS_ON : 1) && b.state !== 'flee') { b.state = 'flee'; b.job = 'flee'; b.target = -1; w.stats.roukha.flees++; }
  if (!p || !shooter) return;
  const nest = w.nests.find((n) => n.id === p.home);
  if (p.kind === 'home' && p.state === 'home' && nest) { defendOrScatter(w, p, nest, shooter); return; }
  if (p.kind === 'hunt' && (p.state === 'approach' || p.state === 'stalk')) {
    const odds = packOdds(w, p, shooter);
    if (odds >= chargeThreshold(w, shooter, p)) charge(w, p, members(w, p), shooter, `shot at, the birds charge (odds ${odds.toFixed(1)}:1)`);
    else goHome(w, p, 'shot at and outnumbered');
  }
}
function killBird(w: World, b: Bird, shooter: Scout | null, head: boolean): void {
  const p = packOf(w, b);
  if (p) { p.shock += CFG.FEAR.loss * CFG.FEAR.lossRef / Math.max(CFG.FEAR.lossRef, p.size0 || 1); if (p.bull === b.id) { p.bullLost = true; p.shock += CFG.FEAR.bull; addLog(w, 'Roukha', 'the pack bull is down', 'combat'); } }
  b.state = 'dead'; b.hp = 0; w.stats.birdKills++; w.stats.license++;
  w.carcasses.push({ id: newId(w), x: b.x, y: b.y, kind: 'bird', claim: -1, t: w.tick, age: b.age, cracked: head });
  if (shooter) say(w, shooter, 'kill', {}, 'combat');
  addLog(w, 'Roukha', `${b.age === 'A' ? 'an' : 'a'} ${AGE[b.age].label} is down${head ? ' (headshot, the beak cracked)' : ''}`, 'combat');
}
/** Home comfort of a bird right now (0..1): used by the viewer card and tests. */
export function birdComfort(w: World, b: Bird): number { const n = nestOf(w, b); return n ? comfort(R.home, dist(b.x, b.y, n.x, n.y)) : 0; }

// ---------- deer ----------
export function deerHit(w: World, id: number, dmg: number): void {
  const d = w.deer.find((x) => x.id === id); if (!d || d.state === 'dead') return;
  d.hp -= dmg;
  if (d.hp <= 0) { d.state = 'dead'; w.stats.deerKills++; w.carcasses.push({ id: newId(w), x: d.x, y: d.y, kind: 'deer', claim: -1, t: w.tick, age: 'A', cracked: false }); addLog(w, 'Hunt', 'a deer is down', 'event'); return; }
  d.state = 'flee'; d.t = 40;
}
export function deerTick(w: World): void {
  const tph = TPH();
  for (const d of w.deer) {
    if (d.state === 'dead') continue;
    d.px = d.x; d.py = d.y;
    let near: Scout | null = null, nd = 1e9;
    if (w.tick % 5 === 0 || d.state === 'flee') for (const s of w.scouts) { if (!able(s)) continue; const dd = dist(s.x, s.y, d.x, d.y); if (dd < nd) { nd = dd; near = s; } }
    if (near && nd < CFG.DEER_FLEE_M && !(near.posture === 'crouch' && nd > CFG.DEER_FLEE_M * 0.6)) { d.state = 'flee'; d.t = 40; d.tx = d.x + (d.x - near.x) * 2; d.ty = d.y + (d.y - near.y) * 2; }
    if (d.state === 'flee') { if (--d.t <= 0) d.state = 'graze'; }
    else if (w.tick % 50 === d.id % 50) { d.tx = d.x + (rnd(w) * 2 - 1) * 8; d.ty = d.y + (rnd(w) * 2 - 1) * 8; }
    const spd = (d.state === 'flee' ? CFG.DEER_RUN_MS : CFG.DEER_WALK_MS) * DT;
    const dd = dist(d.x, d.y, d.tx, d.ty);
    if (dd > 0.3) { const mx = ((d.tx - d.x) / dd) * Math.min(spd, dd), my = ((d.ty - d.y) / dd) * Math.min(spd, dd); if (passableAt(w, d.x + mx, d.y + my)) { d.x += mx; d.y += my; } else { d.tx = d.x; d.ty = d.y; } }
  }
  w.deer = w.deer.filter((d) => d.state !== 'dead');
  if (FEATURES.deer && w.tick % Math.floor(tph) === 0 && w.deer.length < CFG.DEER_HERDS * CFG.DEER_PER_HERD && --w.deerRespawn <= 0) {
    w.deerRespawn = Math.floor(CFG.DEER_RESPAWN_H / CFG.DEER_HERDS);
    const n = w.map.n; const [cx, cy] = campXY(w);
    for (let k = 0; k < 50; k++) {
      const i = rint(w, 0, n * n - 1); if (w.map.terrain[i] !== 2) continue;
      const [x, y] = tileCenter(w, i); if (dist(x, y, cx, cy) < 70) continue;
      w.deer.push({ id: newId(w), x, y, px: x, py: y, hp: CFG.DEER_HP, herd: -1, state: 'graze', tx: x, ty: y, t: 0 }); break;
    }
  }
}
