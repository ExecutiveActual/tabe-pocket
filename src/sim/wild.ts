// Wildlife: deer for food and hides, wild Roukha flocks roaming the whole island (endless supply),
// and raid packs drawn to camp by hunger and scent. Packs size up the scouts they can see and charge
// at 2:1 or better (busy 0.4, downed 0.1); otherwise they stalk and then withdraw out of sight.
import { CFG, FEATURES, AGE, AgeClass } from './config';
import { World, Bird, Pack, Scout, rnd, rint, dist, TPH, hourOf, isDark, passableAt, newId, addLog, hasLOS, dayOf, tileCenter, PASSABLE } from './core';
import { able, say, hurt, campXY, fireLit, built, stock } from './ai';
import { addIntel } from './combat';

const DT = 1 / CFG.TICK_HZ;

export function packOf(w: World, b: Bird): Pack | undefined { return w.packs.find((p) => p.id === b.pack); }
function members(w: World, p: Pack): Bird[] { return w.birds.filter((b) => b.pack === p.id && b.state !== 'dead'); }

function rollAge(w: World): AgeClass { const r = rnd(w); return r < AGE.J.chance ? 'J' : r < AGE.J.chance + AGE.A.chance ? 'A' : 'B'; }
function spawnPack(w: World, kind: 'raid' | 'wild', x: number, y: number, size: number): Pack {
  const p: Pack = { id: newId(w), kind, members: [], state: kind === 'wild' ? 'roam' : 'approach', x, y, timer: 0, target: -1, size0: size, odds: 0, spawned: w.tick, reason: '', bull: -1, bullLost: false, home: -1 };
  for (let i = 0; i < size; i++) {
    const age = i === 0 && size >= 3 ? 'B' : rollAge(w);   // packs of 3+ are led by a bull
    const b: Bird = { id: newId(w), x: x + (i % 3) * 1.5, y: y + Math.floor(i / 3) * 1.5, px: x, py: y, fx: 1, fy: 0, hp: AGE[age].hp, pack: p.id, state: 'idle', tx: x, ty: y, target: -1, peck: 0, age, cracked: false, bleeding: false, flinch: 0 };
    w.birds.push(b); p.members.push(b.id);
    if (age === 'B' && p.bull < 0) p.bull = b.id;
  }
  w.packs.push(p); w.stats.packsSpawned++;
  return p;
}
/** A spawn point out of every scout's sight, at least minD from camp. */
function hiddenPoint(w: World, minD: number): [number, number] | null {
  const [cx, cy] = campXY(w); const n = w.map.n;
  // the island is big: look in a ring around camp rather than anywhere on the map
  for (let k = 0; k < 200; k++) {
    const ux = rnd(w) * 2 - 1, uy = rnd(w) * 2 - 1, ul = Math.sqrt(ux * ux + uy * uy); if (ul < 0.1 || ul > 1) continue;  // no sin/cos (determinism)
    const rr = minD + rnd(w) * CFG.SPAWN_RING_M;
    const tx = Math.floor((cx + (ux / ul) * rr) / CFG.TILE_M), ty = Math.floor((cy + (uy / ul) * rr) / CFG.TILE_M);
    if (tx < 0 || ty < 0 || tx >= n || ty >= n) continue;
    const i = ty * n + tx; if (!PASSABLE[w.map.terrain[i]]) continue;
    const [x, y] = tileCenter(w, i);
    if (dist(x, y, cx, cy) < minD) continue;
    if (w.scouts.some((s) => s.status !== 'dead' && dist(s.x, s.y, x, y) < 95)) continue;
    return [x, y];
  }
  return null;
}

// ---------- weights for the 2:1 rule ----------
export function scoutWeight(s: Scout): number {
  if (s.status === 'downed') return CFG.ODDS_W.downed;
  const ready = s.combat || (s.act !== null && (s.act.kind === 'watch' || s.act.kind === 'buddy' || s.act.kind === 'idle'));
  return ready && !s.sleeping ? CFG.ODDS_W.ready : CFG.ODDS_W.busy;
}
/** Pack's view of the odds against target scout t: healthy birds / weighted scouts near t that the pack can see. */
export function packOdds(w: World, p: Pack, t: Scout): number {
  const ms = members(w, p).filter((b) => b.hp > CFG.BIRD_FLEE_HP);
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
  if (p && p.home >= 0) { const r = w.rookeries.find((k) => k.id === p.home); if (r && dist(t.x, t.y, r.x, r.y) < CFG.ROOKERY_GUARD_M) th += CFG.ROOKERY_ODDS_MOD; }
  if (built(w, 'palisade') && dist(t.x, t.y, w.camp.x, w.camp.y) < 15) th += 0.5;
  return th;
}

// ---------- director: wild flocks and raids ----------
export function directorTick(w: World): void {
  if (w.flags.noRoukha) return;
  const tph = TPH();
  if (w.tick % Math.floor(tph) !== 0) return;
  // wild flocks: endless supply, keep the count up
  // Roukha concentrate at the rookeries (resident packs, bigger in nesting season); roamers wander near the company
  for (const r of w.rookeries) {
    const home = w.packs.filter((p) => p.home === r.id && p.state !== 'gone').length;
    if (home < CFG.ROOKERY_PACKS && !w.scouts.some((s) => s.status !== 'dead' && dist(s.x, s.y, r.x, r.y) < 80)) {
      const p = spawnPack(w, 'wild', r.x, r.y, rint(w, CFG.WILD_FLOCK_SIZE[0], CFG.WILD_FLOCK_SIZE[1]) + 2 + (seasonFx(w).nesting ? 1 : 0)); p.home = r.id;
    }
  }
  const roam = w.packs.filter((p) => p.kind === 'wild' && p.home < 0 && p.state !== 'gone').length;
  const flocks = Math.max(1, Math.round(CFG.WILD_FLOCKS * seasonFx(w).birds));
  if (roam < flocks) { const pt = hiddenPoint(w, 110); if (pt) spawnPack(w, 'wild', pt[0], pt[1], rint(w, CFG.WILD_FLOCK_SIZE[0], CFG.WILD_FLOCK_SIZE[1])); }
  // roamers that drift far from everyone despawn (the island is big; keep them where the story is)
  for (const p of w.packs) if (p.kind === 'wild' && p.home < 0 && p.state === 'roam' && !w.scouts.some((s) => s.status !== 'dead' && dist(s.x, s.y, p.x, p.y) < CFG.ROAMER_DESPAWN_M)) { p.state = 'gone'; for (const id of p.members) { const b = w.birds.find((x) => x.id === id); if (b) b.state = 'dead'; } }
  // raids: hunger + scent, more and bolder at night, packs grow over days
  if (!w.camp.sited || w.tick < CFG.PACK_GRACE_H * tph) return;
  if (w.packs.some((p) => p.kind === 'raid' && p.state !== 'gone')) return;
  if (w.tick < (w.raidCalm || 0)) return;  // after a raid the birds keep off for a while
  const dark = isDark(hourOf(w.tick)); const day = dayOf(w.tick);
  const scent = (fireLit(w) ? CFG.SCENT.fire : 0) + (w.camp.latrine.built ? CFG.SCENT.latrine : 0) + (stock(w, 'rawMeat') + stock(w, 'meal')) * CFG.SCENT.food + w.scentBoost
    + w.scouts.filter((s) => s.status === 'downed' || (s.status === 'ok' && s.hp < 50)).length * CFG.SCENT.wounded;
  const sf = seasonFx(w);
  const chance = (dark ? CFG.PACK_SPAWN_H.night : CFG.PACK_SPAWN_H.day) * (1 + 0.35 * Math.min(day - 1, CFG.PACK_PRESSURE_DAYS)) * (0.5 + scent * 0.3) * sf.birds;
  if (rnd(w) >= chance) return;
  const pt = hiddenPoint(w, 130); if (!pt) return;
  const size = Math.min(CFG.PACK_MAX, CFG.PACK_BASE + Math.floor((day - 1) * CFG.PACK_GROW_PER_DAY) + rint(w, 0, 1));
  const p = spawnPack(w, 'raid', pt[0], pt[1], size);
  p.reason = sf.raidStores ? 'starving: after the camp meat' : 'drawn by camp scent, hunting scouts'; addLog(w, 'Roukha', `a pack of ${size} is moving toward camp (unseen)`, 'event');
}

// ---------- pack and bird behaviour ----------
export function wildTick(w: World): void {
  const tph = TPH(); const dark = isDark(hourOf(w.tick));
  if (w.tick % 5 === 0) for (const p of w.packs) {
    if (p.state === 'gone') continue;
    const ms = members(w, p);
    if (!ms.length) { p.state = 'gone'; continue; }
    // anchor follows the birds' centre
    let sx = 0, sy = 0; for (const b of ms) { sx += b.x; sy += b.y; } const ax = sx / ms.length, ay = sy / ms.length;
    if (p.state !== 'roam') { p.x = ax; p.y = ay; }
    const healthy = ms.filter((b) => b.hp > CFG.BIRD_FLEE_HP).length;
    const live = w.scouts.filter((s) => able(s));
    const nearest = live.slice().sort((a, b) => dist(a.x, a.y, ax, ay) - dist(b.x, b.y, ax, ay) || a.id - b.id)[0];
    if (p.kind === 'wild') {
      // signs and calls let scouts find them
      if (w.tick % Math.floor(CFG.SIGN_EVERY_H * tph) < 5) w.signs.push({ id: newId(w), x: ax, y: ay, t: w.tick, pack: p.id, kind: (['tracks', 'feathers', 'droppings'] as const)[rint(w, 0, 2)] });
      if (w.tick % Math.floor(tph) < 5 && rnd(w) < CFG.CALL_CHANCE_H) {
        for (const s of live) {
          if (s.sleeping || dist(s.x, s.y, ax, ay) > CFG.CALL_HEAR_M) continue;
          if (rnd(w) < 0.5 + s.skills.tracking / 200) {
            const e = CFG.CALL_ERROR_M * (1 - s.skills.tracking / 150);
            addIntel(w, p.id, ax + (rnd(w) * 2 - 1) * e, ay + (rnd(w) * 2 - 1) * e, 'call', -1);
            if ((w.plan.warned['call'] || 0) < w.tick) { w.plan.warned['call'] = w.tick + 2 * tph; say(w, s, 'call'); }
            break;
          }
        }
      }
      for (const b of ms) if (b.bleeding) addIntel(w, p.id, b.x, b.y, 'trail', b.id);
    }
    switch (p.state) {
      case 'roam': {
        // wander; shy of scouts unless shot at
        if (nearest && dist(nearest.x, nearest.y, ax, ay) < CFG.BIRD_WARY_M) { const d = Math.max(1, dist(nearest.x, nearest.y, ax, ay)); setGoal(w, p, ax + ((ax - nearest.x) / d) * 30, ay + ((ay - nearest.y) / d) * 30); }
        else if (w.tick % Math.floor(tph) < 5 || dist(ax, ay, p.x, p.y) < 3) {
          const r = w.rookeries.find((k) => k.id === p.home);
          const [hx, hy] = r ? [r.x, r.y] : [ax, ay]; const rr = r ? 15 : 40;
          let gx = hx + (rnd(w) * 2 - 1) * rr, gy = hy + (rnd(w) * 2 - 1) * rr;
          if (!passableAt(w, gx, gy)) { gx = ax; gy = ay; }
          setGoal(w, p, gx, gy);
        }
        // nest defence: scouts close to the rookery get charged at worse odds
        if (p.home >= 0 && nearest) { const r = w.rookeries.find((k) => k.id === p.home); if (r && dist(nearest.x, nearest.y, r.x, r.y) < CFG.ROOKERY_GUARD_M) { const o = packOdds(w, p, nearest); if (o >= chargeThreshold(w, nearest, p)) { p.state = 'charge'; p.target = nearest.id; p.timer = CFG.CHARGE_MAX_S * CFG.TICK_HZ; w.stats.charges++; addLog(w, 'Roukha', 'the rookery birds defend their nests', 'combat'); for (const b of ms) { b.state = 'charge'; b.target = nearest.id; } } } }
        for (const b of ms) if (b.state === 'charge' || b.state === 'idle') b.state = 'move';
        break;
      }
      case 'approach': case 'stalk': {
        // pick the scout that gives the best odds among those near camp
        let best: Scout | null = null, bo = -1;
        for (const s of w.scouts) { if (s.status === 'dead' || s.status === 'downed') continue; const o = packOdds(w, p, s) - dist(s.x, s.y, ax, ay) / 400; if (o > bo) { bo = o; best = s; } }
        if (!best) { withdraw(w, p, 'no prey'); break; }
        p.target = best.id; p.odds = packOdds(w, p, best);
        const sd = dark ? CFG.STALK_M_NIGHT : CFG.STALK_M_DAY;
        const d = dist(best.x, best.y, ax, ay);
        const seenByScouts = w.scouts.some((s) => s.threat && ms.some((b) => b.id === s.threat!.id) && w.tick - s.threat.t < 20);
        if (p.state === 'approach') {
          setGoal(w, p, best.x + ((ax - best.x) / Math.max(1, d)) * sd, best.y + ((ay - best.y) / Math.max(1, d)) * sd);
          if (d < sd + 6) { p.state = 'stalk'; p.timer = CFG.STALK_H * tph; }
          break;
        }
        // stalking: size them up
        if (p.odds >= chargeThreshold(w, best, p)) {
          p.state = 'charge'; p.timer = CFG.CHARGE_MAX_S * CFG.TICK_HZ; w.stats.charges++;
          addLog(w, 'Roukha', `${ms.length} birds charge (odds ${p.odds.toFixed(1)}:1)`, 'combat');
          const sp = w.scouts.find((s) => able(s) && dist(s.x, s.y, ax, ay) < 100); if (sp) say(w, sp, 'charge', {}, 'combat');
          for (const b of ms) { b.state = 'charge'; b.target = best.id; }
          break;
        }
        if (seenByScouts && p.odds < 1) { withdraw(w, p, 'spotted and outnumbered'); break; }
        p.timer -= 5;
        if (p.timer <= 0) { withdraw(w, p, 'no opening'); break; }
        setGoal(w, p, best.x + ((ax - best.x) / Math.max(1, d)) * sd, best.y + ((ay - best.y) / Math.max(1, d)) * sd);
        break;
      }
      case 'charge': {
        p.timer -= 5;
        const standing = live.filter((s) => dist(s.x, s.y, ax, ay) < 40);
        // rout check: they only break when they're losing
        const lost = p.size0 - healthy; const breakAt = p.size0 * (p.bullLost ? CFG.BULL_LOSS_RESOLVE : CFG.PACK_BREAK_FRAC);
        const tgt = w.scouts.find((s) => s.id === p.target);
        const losing = lost >= breakAt || (lost > 0 && tgt && able(tgt) && packOdds(w, p, tgt) < CFG.ROUT_ODDS);
        if (losing || p.timer <= 0 || !standing.length) { withdraw(w, p, losing ? (p.bullLost ? 'the bull is down, they break' : 'losing, they break') : 'prey down or gone'); break; }
        for (const b of ms) {
          if (b.state !== 'charge') continue;
          const t = w.scouts.find((s) => s.id === b.target);
          if (!t || !able(t)) { const nt = live.slice().sort((x, y) => dist(x.x, x.y, b.x, b.y) - dist(y.x, y.y, b.x, b.y) || x.id - y.id)[0]; b.target = nt && dist(nt.x, nt.y, b.x, b.y) < 30 ? nt.id : -1; }
        }
        break;
      }
      case 'withdraw': {
        if (!nearest || dist(nearest.x, nearest.y, ax, ay) > CFG.WITHDRAW_M + 20) { if (p.kind === 'raid') { p.state = 'gone'; for (const b of ms) b.state = 'dead'; } else { p.state = 'roam'; } }
        else if (nearest) { const d = Math.max(1, dist(nearest.x, nearest.y, ax, ay)); setGoal(w, p, ax + ((ax - nearest.x) / d) * 40, ay + ((ay - nearest.y) / d) * 40); }
        break;
      }
    }
  }
  // birds move
  for (const b of w.birds) {
    if (b.state === 'dead') continue;
    b.px = b.x; b.py = b.y;
    if (b.bleeding) { b.hp -= CFG.TRAIL_BLEED_HP_H / tph; if (w.tick % 20 === 0) w.signs.push({ id: newId(w), x: b.x, y: b.y, t: w.tick, pack: b.pack, kind: 'blood' }); if (b.hp <= 0) { killBird(w, b, null, false); continue; } }
    if (b.flinch > 0) { b.flinch--; continue; }   // gunfire made it hesitate
    let tx = b.tx, ty = b.ty, spd = CFG.BIRD_WALK_MS * (b.age === 'J' ? 1.05 : 1);
    if (b.state === 'charge') {
      const t = w.scouts.find((s) => s.id === b.target);
      if (t && able(t)) {
        tx = t.x; ty = t.y; spd = CFG.BIRD_RUN_MS;
        if (dist(b.x, b.y, t.x, t.y) < CFG.PECK_M) {
          if (--b.peck <= 0) {
            b.peck = CFG.PECK_EVERY;
            const atk = CFG.BIRD_ATTACKS[rint(w, 0, CFG.BIRD_ATTACKS.length - 1)];
            t.threat = { id: b.id, x: b.x, y: b.y, t: w.tick };
            if (rnd(w) < 0.75) { if (w.tick % 3 === 0) addLog(w, 'Roukha', `${atk} on ${t.name}`, 'combat'); hurt(w, t, CFG.PECK_DMG * AGE[b.age].dmgMul * (0.7 + rnd(w) * 0.6), 'a Roukha ' + atk); }
          }
          continue;
        }
      } else { const p = packOf(w, b); tx = p ? p.x : b.x; ty = p ? p.y : b.y; }
    } else if (b.state === 'flee') { spd = CFG.BIRD_RUN_MS * 0.8; }
    else { const p = packOf(w, b); if (p && (p.state === 'withdraw' || p.state === 'approach')) spd = p.state === 'withdraw' ? CFG.BIRD_RUN_MS * 0.7 : CFG.BIRD_WALK_MS * 1.4; }
    steer(w, b, tx, ty, spd * DT);
  }
  w.birds = w.birds.filter((b) => b.state !== 'dead');
  w.packs = w.packs.filter((p) => p.state !== 'gone' || w.tick - p.spawned < 10);
  for (const p of w.packs) p.members = p.members.filter((id) => w.birds.some((b) => b.id === id));
}
function setGoal(w: World, p: Pack, x: number, y: number): void {
  const ms = members(w, p); let i = 0;
  for (const b of ms) { if (b.state === 'charge' && p.state === 'charge') continue; b.tx = x + (i % 3) * 2 - 2; b.ty = y + Math.floor(i / 3) * 2; if (b.state !== 'flee') b.state = 'move'; i++; }
  if (p.state === 'roam') { p.x = x; p.y = y; }
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
export function withdraw(w: World, p: Pack, why: string): void {
  if (p.state === 'withdraw') return;
  p.state = 'withdraw'; p.reason = why; w.stats.withdraws++;
  if (p.kind === 'raid') w.raidCalm = w.tick + CFG.RAID_CALM_H * TPH();
  for (const b of members(w, p)) { if (b.state !== 'flee') b.state = 'move'; b.target = -1; }
  addLog(w, 'Roukha', `the pack pulls back (${why})`, 'combat');
}

export function birdHit(w: World, b: Bird, dmg: number, shooter: Scout | null, head: boolean): void {
  b.hp -= dmg;
  if (b.hp <= 0) { killBird(w, b, shooter, head); return; }
  if (b.hp < AGE[b.age].hp * 0.5) b.bleeding = true;
  const p = packOf(w, b);
  if (b.hp < CFG.BIRD_FLEE_HP) { b.state = 'flee'; const away = shooter ? [b.x + (b.x - shooter.x), b.y + (b.y - shooter.y)] : [b.x, b.y]; b.tx = away[0]; b.ty = away[1]; }
  if (p && p.state === 'charge' && p.bull === b.id) { /* bull wounded: no effect until it dies */ }
  if (p && shooter && (p.state === 'roam' || p.state === 'stalk' || p.state === 'approach')) {
    const odds = packOdds(w, p, shooter);
    if (odds >= chargeThreshold(w, shooter, p)) {
      p.state = 'charge'; p.timer = CFG.CHARGE_MAX_S * CFG.TICK_HZ; p.target = shooter.id; w.stats.charges++;
      addLog(w, 'Roukha', `shot at, the birds charge (odds ${odds.toFixed(1)}:1)`, 'combat');
      for (const m of members(w, p)) if (m.state !== 'flee') { m.state = 'charge'; m.target = shooter.id; }
    } else withdraw(w, p, 'shot at and outnumbered');
  }
}
function killBird(w: World, b: Bird, shooter: Scout | null, head: boolean): void {
  const p = packOf(w, b); if (p && p.bull === b.id) { p.bullLost = true; addLog(w, 'Roukha', 'the pack bull is down', 'combat'); }
  b.state = 'dead'; b.hp = 0; w.stats.birdKills++; w.stats.license++;
  w.carcasses.push({ id: newId(w), x: b.x, y: b.y, kind: 'bird', claim: -1, t: w.tick, age: b.age, cracked: head });
  if (shooter) say(w, shooter, 'kill', {}, 'combat');
  addLog(w, 'Roukha', `${b.age === 'A' ? 'an' : 'a'} ${AGE[b.age].label} is down${head ? ' (headshot, the beak cracked)' : ''}`, 'combat');
}

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
export { spawnPack };
