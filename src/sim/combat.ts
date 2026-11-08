// Danger override and the shooting model.
// Perception, weapon capability and permission are separate checks: seeing a bird, having a clear line,
// being in range, being crouched and having aimed long enough must ALL hold before a round is fired.
import { CFG, FEATURES } from './config';
import { Scout, World, Bird, rnd, dist, TPH, hourOf, isDark, tileOf, hasLOS, invAdd, invGet, newId, nearestPassable, addLog, tfx, hasTrait } from './core';
import { able, say, mkAct, startAct, endAct, moveTo, built, fireLit, skillUp, HOOKS, campXY } from './ai';
import { birdHit, deerHit, packOf } from './wild';

const DT = 1 / CFG.TICK_HZ;

export function sightOf(w: World, s: Scout): number {
  const dark = isDark(hourOf(w.tick));
  let r = dark ? CFG.SCOUT_SIGHT_NIGHT_M : CFG.SCOUT_SIGHT_DAY_M;
  if (w.weather === 'storm') r *= CFG.STORM_SIGHT_MUL; else if (w.weather === 'rain') r *= CFG.RAIN_SIGHT_MUL; else if (w.weather === 'fog') r *= CFG.FOG_SIGHT_MUL;
  if (s.act && s.act.kind === 'watch') r *= built(w, 'tower') ? CFG.TOWER_SIGHT_MUL : CFG.WATCH_SIGHT_MUL;
  if (s.sleeping) r = 0;
  return r;
}
/** Can scout s see bird b right now? Range (or firelight) plus a clear line. */
export function canSee(w: World, s: Scout, x: number, y: number): boolean {
  if (s.sleeping || !able(s)) return false;
  const d = dist(s.x, s.y, x, y);
  let r = sightOf(w, s);
  if (fireLit(w) && dist(x, y, w.camp.fire.x, w.camp.fire.y) < CFG.FIRE_LIGHT_M) r = Math.max(r, 45);
  // nothing in the fog can be seen (or shot): the reveal radius in perceive() is the same sight radius
  return d <= r && w.map.seen[tileOf(w, x, y)] === 1 && hasLOS(w, s.x, s.y, x, y);
}
// last reveal per scout (tile + radius); a cache only, so skipping a repeat reveal can't change the sim
const LAST_REVEAL = new WeakMap<World, Map<number, number>>();

export function perceive(w: World, s: Scout): void {
  // fog of war: reveal everything inside his sight radius (so anything he can see or shoot is on the map)
  const r = Math.max(sightOf(w, s), isDark(hourOf(w.tick)) ? CFG.REVEAL_NIGHT_M : CFG.REVEAL_DAY_M), n = w.map.n;
  const cx = Math.floor(s.x / CFG.TILE_M), cy = Math.floor(s.y / CFG.TILE_M), rt = Math.ceil(r / CFG.TILE_M);
  let lr = LAST_REVEAL.get(w); if (!lr) LAST_REVEAL.set(w, (lr = new Map()));
  const key = (cy * n + cx) * 256 + Math.min(255, rt);
  if (!s.sleeping && lr.get(s.id) !== key) {
    lr.set(s.id, key);
    for (let y = cy - rt; y <= cy + rt; y++) for (let x = cx - rt; x <= cx + rt; x++) {
      if (x < 0 || y < 0 || x >= n || y >= n) continue;
      if ((x - cx) * (x - cx) + (y - cy) * (y - cy) <= rt * rt) w.map.seen[y * n + x] = 1;
    }
  }
  // spot Roukha
  let best: Bird | null = null, bd = 1e9, count = 0;
  for (const b of w.birds) {
    if (b.state === 'dead' || !canSee(w, s, b.x, b.y)) continue;
    count++;
    const d = dist(s.x, s.y, b.x, b.y); if (d < bd) { bd = d; best = b; }
    const p = packOf(w, b); if (p && p.kind === 'wild') addIntel(w, p.id, b.x, b.y, 'seen', b.id);
  }
  if (best) {
    const fresh = !s.threat || w.tick - s.threat.t > CFG.ALL_CLEAR_S * CFG.TICK_HZ;
    s.threat = { id: best.id, x: best.x, y: best.y, t: w.tick };
    if (fresh && bd < CFG.DANGER_M) {
      say(w, s, 'roukha', { x: count }, 'combat');
      for (const o of w.scouts) if (o !== s && able(o) && dist(o.x, o.y, s.x, s.y) < CFG.SHOUT_M) {
        o.threat = { id: best.id, x: best.x, y: best.y, t: w.tick };
        if (o.sleeping) { o.sleeping = false; if (o.act && o.act.kind === 'sleep') endAct(w, o); }
      }
    }
  }
  // Roukha sign: tracking skill decides whether he notices it
  for (const sg of w.signs) {
    if (dist(sg.x, sg.y, s.x, s.y) > CFG.SIGN_NOTICE_M + s.skills.tracking / 10) continue;
    const p = sg.kind === 'blood' ? 0.9 : 0.15 + s.skills.tracking / 140;
    if (rnd(w) < p * 0.5) {
      const pk = w.packs.find((x) => x.id === sg.pack);
      const ix = pk ? sg.x + (pk.x - sg.x) * (0.2 + s.skills.tracking / 250) : sg.x, iy = pk ? sg.y + (pk.y - sg.y) * (0.2 + s.skills.tracking / 250) : sg.y;
      addIntel(w, sg.pack, ix, iy, sg.kind === 'blood' ? 'trail' : 'sign', -1);
      if ((w.plan.warned['sign'] || 0) < w.tick) { w.plan.warned['sign'] = w.tick + TPH(); say(w, s, sg.kind === 'blood' ? 'trail' : 'sign'); }
      skillUp(s, 'tracking', 0.3);
      sg.t = -1e9; // noticed, gone from the list next cleanup
    }
  }
}
export function addIntel(w: World, pack: number, x: number, y: number, kind: 'sign' | 'call' | 'trail' | 'seen', bird: number): void {
  const ex = w.intel.find((i) => i.pack === pack);
  if (ex) { ex.x = x; ex.y = y; ex.t = w.tick; ex.kind = kind; ex.bird = bird; return; }
  w.intel.push({ id: newId(w), pack, x, y, t: w.tick, kind, bird });
}

/** Danger layer. Returns true when it has control of the scout this tick. */
export function combatTick(w: World, s: Scout): boolean {
  if (!able(s)) return false;
  const th = s.threat;
  const bird = th ? w.birds.find((b) => b.id === th.id && b.state !== 'dead') : undefined;
  const fresh = !!th && !!bird && w.tick - th.t < CFG.ALL_CLEAR_S * CFG.TICK_HZ;
  // hysteresis: entering needs a seen bird inside DANGER_M; leaving needs none inside DANGER_M + EXIT_PAD for CLEAR_HOLD ticks
  const R = s.combat ? CFG.DANGER_M + CFG.COMBAT_EXIT_PAD_M : CFG.DANGER_M;
  let near = fresh && bird ? w.birds.some((b) => b.state !== 'dead' && dist(b.x, b.y, s.x, s.y) < R && (s.combat || canSee(w, s, b.x, b.y) || b.state === 'charge')) : false;
  if (near) s.clearT = 0; else if (s.combat && fresh && ++s.clearT < CFG.COMBAT_CLEAR_HOLD) near = true;
  if (!near) {
    if (s.combat) {
      s.combat = false; s.posture = 'stand'; if (s.act && s.act.kind === 'combat') endAct(w, s);
      if (!fresh && (w.plan.warned['clear'] || 0) < w.tick) { w.plan.warned['clear'] = w.tick + 60; say(w, s, 'allClear'); }
    }
    return false;
  }
  // rescue continues while no bird is right on top of him
  if (s.act && s.act.kind === 'rescue' && !w.birds.some((b) => b.state !== 'dead' && dist(b.x, b.y, s.x, s.y) < 15)) return false;
  if (!s.combat) {
    s.combat = true; s.combatFlips.push(w.tick);
    while (s.combatFlips.length && s.combatFlips[0] < w.tick - 600) s.combatFlips.shift();
    if (s.combatFlips.length === 8) { w.stats.mon.oscillation++; w.stats.mon.notes.push(`combat-flip ${s.name} t${w.tick}`); }
    if (s.carcassMode === 'drag') dropCarcass(w, s);
    if (s.act && s.act.kind !== 'combat') endAct(w, s);
    s.sleeping = false;
    startAct(w, s, mkAct('combat', 'Fighting Roukha', '', s.x, s.y));
  }
  if (!s.act || s.act.kind !== 'combat') startAct(w, s, mkAct('combat', 'Fighting Roukha', '', s.x, s.y));
  // melee when a bird is on him: rifle butt and bayonet
  const close = w.birds.filter((b) => b.state !== 'dead' && dist(b.x, b.y, s.x, s.y) < CFG.MELEE_M);
  if (close.length) {
    s.act!.label = 'Fighting hand to hand';
    if (s.cooldown > 0) { s.cooldown--; return true; }
    const b = close[0]; const [a, c] = CFG.MELEE_DMG;
    s.cooldown = CFG.MELEE_EVERY;
    if ((w.plan.warned['melee' + s.id] || 0) < w.tick) { w.plan.warned['melee' + s.id] = w.tick + 80; say(w, s, 'melee', {}, 'combat'); }
    birdHit(w, b, a + rnd(w) * (c - a), s, false);
    return true;
  }
  // pick the nearest bird he can see and has a clear line to
  const vis = w.birds.filter((b) => b.state !== 'dead' && canSee(w, s, b.x, b.y)).sort((p, q) => dist(p.x, p.y, s.x, s.y) - dist(q.x, q.y, s.x, s.y) || p.id - q.id);
  const gun = s.guns[0] ? CFG.GUNS[s.guns[0].type] : null;
  const t = vis[0];
  if (t && gun) {
    const d = dist(t.x, t.y, s.x, s.y); const pk = packOf(w, t);
    const charging = t.state === 'charge' || (!!pk && pk.state === 'charge');
    if (d <= gun.eff || (charging && d <= gun.max)) {
      s.act!.label = 'Shooting at Roukha'; s.thought = `Shooting: bird at ${Math.round(d)} m`;
      shootAt(w, s, t.id, t.x, t.y, false);
      return true;
    }
    s.thought = `Watching a bird at ${Math.round(d)} m (out of range)`;
  }
  // otherwise regroup: close on the nearest mate, or fall back to the fire
  const [cx, cy] = campXY(w);
  const mates = w.scouts.filter((o) => o !== s && able(o)).sort((p, q) => dist(p.x, p.y, s.x, s.y) - dist(q.x, q.y, s.x, s.y));
  let gx = s.x, gy = s.y;
  if (dist(s.x, s.y, cx, cy) < 80 && dist(s.x, s.y, cx, cy) > 8) { gx = w.camp.fire.x; gy = w.camp.fire.y; s.act!.label = 'Falling back to the fire'; }
  else if (mates[0] && dist(mates[0].x, mates[0].y, s.x, s.y) > 8) { gx = mates[0].x; gy = mates[0].y; s.act!.label = 'Closing on ' + mates[0].name; }
  if (dist(gx, gy, s.x, s.y) > 1) { s.posture = 'stand'; s.postureT = 0; if (moveTo(w, s, gx, gy, CFG.RUN_MS / CFG.WALK_MS) < 0) { s.act!.path = null; } }
  else { s.posture = 'crouch'; s.stillT = 0; }
  return true;
}
function dropCarcass(w: World, s: Scout): void {
  for (const k of ['carcJ', 'carcA', 'carcB'] as const) if (invGet(s.carry, k) >= 1) {
    invAdd(s.carry, k, -1); say(w, s, 'ropeDrop', {}, 'combat');   // the rope goes down instantly; the team picks it up again after
    w.carcasses.push({ id: newId(w), x: s.x, y: s.y, kind: 'bird', claim: -1, t: w.tick, age: k === 'carcB' ? 'B' : k === 'carcA' ? 'A' : 'J', cracked: false });
  }
  s.carcassMode = '';
}

/** The aim-cone shooting model: crouch, settle aim, fire a real bullet with travel time. */
export function shootAt(w: World, s: Scout, id: number, tx: number, ty: number, hunting: boolean): void {
  const gunS = s.guns[0]; if (!gunS) return;
  const gun = CFG.GUNS[gunS.type];
  const d = dist(s.x, s.y, tx, ty); if (d < 0.01) return;
  s.fx = (tx - s.x) / d; s.fy = (ty - s.y) / d;
  if (s.jam > 0) { if (--s.jam === 0) addLog(w, s.name, 'cleared the jam', 'combat'); return; }
  if (s.reload > 0) { if (--s.reload === 0) { const k = Math.min(gun.mag, s.ammo); s.mag += k; s.ammo -= k; } return; }
  if (s.mag <= 0) {
    if (s.ammo <= 0 && dist(s.x, s.y, w.camp.pile.x, w.camp.pile.y) < 12) { const k = Math.min(CFG.CARRY_AMMO, Math.floor(invGet(w.camp.stock, 'ammo'))); invAdd(w.camp.stock, 'ammo', -k); s.ammo += k; }
    if (s.ammo > 0) { s.reload = gun.reload; if ((w.plan.warned['rl' + s.id] || 0) < w.tick) { w.plan.warned['rl' + s.id] = w.tick + 100; say(w, s, 'reload', {}, 'combat'); } }
    else s.thought = 'Out of ammunition!';
    return;
  }
  if (s.posture !== 'crouch') { if (++s.postureT >= CFG.CROUCH_TICKS) { s.posture = 'crouch'; s.postureT = 0; } return; }
  if (s.aimTarget !== id) { s.aimTarget = id; s.aimT = 0; }
  s.aimT++;
  let need = CFG.AIM_TICKS * gun.aim * tfx(s, 'aim') * (s.hangover > w.tick ? CFG.HANGOVER_AIM_MUL : 1);
  for (const i of s.injuries) need *= CFG.INJURIES[i].aimMul;
  if (hunting && hasTrait(s, 'steadyHand')) need *= 1.3;
  if (s.carcassMode === 'drag') need *= CFG.CARCASS_AIM_MUL;
  if (s.aimT < need) return;
  // fire: offset inside the aim cone, which has tightened with aim time
  const settle = Math.min(1, s.aimT / CFG.CONE_SETTLE_TICKS);
  let cone = CFG.CONE_START - (CFG.CONE_START - CFG.CONE_MIN) * settle;
  cone *= CFG.CROUCH_CONE * gun.cone * tfx(s, 'cone') * (1.3 - s.skills.shooting / 200) * (s.morale < 30 ? 1.2 : 1);
  const off = (rnd(w) * 2 - 1) * cone * d;
  const ax = tx + -s.fy * off, ay = ty + s.fx * off; const ad = dist(s.x, s.y, ax, ay);
  const [lo, hi] = gun.dmg;
  w.bullets.push({ id: newId(w), x: s.x, y: s.y, px: s.x, py: s.y, dx: (ax - s.x) / ad, dy: (ay - s.y) / ad, left: gun.max * 1.2, owner: s.id, target: id, dmg: lo + rnd(w) * (hi - lo), hunting });
  if (w.map.seen[tileOf(w, tx, ty)] !== 1) w.stats.mon.fogShots = (w.stats.mon.fogShots || 0) + 1;   // monitor: must stay 0
  if (s.carcassMode === 'drag') w.stats.mon.dragShots = (w.stats.mon.dragShots || 0) + 1;
  s.mag--; w.stats.shots++; w.stats.shotTicks.push(w.tick); if (w.stats.shotTicks.length > 200) w.stats.shotTicks.shift();
  s.aimT = Math.floor(need * 0.35);
  gunS.cond = Math.max(0, gunS.cond - CFG.GUN_WEAR_PER_SHOT);
  skillUp(s, 'shooting', 0.05);
  if (FEATURES.gear && gunS.cond < CFG.JAM_BELOW && rnd(w) < (CFG.JAM_BELOW - gunS.cond) / 300) { s.jam = CFG.JAM_CLEAR_TICKS; say(w, s, 'jam', {}, 'combat'); }
}

export function tickBullets(w: World): void {
  const step = CFG.BULLET_MS * DT;
  const keep = [];
  for (const b of w.bullets) {
    b.px = b.x; b.py = b.y;
    const len = Math.min(step, b.left);
    let hitT = 2, hitBird: Bird | null = null, hitDeer = -1;
    for (const o of w.birds) { if (o.state === 'dead') continue; const t = segHit(b.x, b.y, b.dx, b.dy, len, o.x, o.y, 0.9 * (o.age === 'B' ? 1.3 : o.age === 'J' ? 0.8 : 1)); if (t >= 0 && t < hitT) { hitT = t; hitBird = o; hitDeer = -1; } }
    for (const o of w.deer) { if (o.state === 'dead') continue; const t = segHit(b.x, b.y, b.dx, b.dy, len, o.x, o.y, 0.7); if (t >= 0 && t < hitT) { hitT = t; hitDeer = o.id; hitBird = null; } }
    // rocks stop bullets
    let blocked = 2;
    for (let k = 1; k <= Math.ceil(len); k++) { const f = Math.min(1, k / len); const t = w.map.terrain[tileOf(w, b.x + b.dx * len * f, b.y + b.dy * len * f)]; if (t === 4) { blocked = f; break; } }
    if (blocked < hitT) { b.x += b.dx * len * blocked; b.y += b.dy * len * blocked; continue; }
    if (hitBird || hitDeer >= 0) {
      b.x += b.dx * len * hitT; b.y += b.dy * len * hitT;
      const shooter = w.scouts.find((x) => x.id === b.owner) || null;
      w.stats.hits++;
      if (hitBird) {
        let dmg = b.dmg; let head = false;
        const sk = shooter ? shooter.skills.shooting : 40;
        if (rnd(w) < CFG.VITAL_CHANCE * (0.7 + sk / 100)) dmg *= CFG.VITAL_MUL;      // one good shot can drop a Roukha
        const hc = b.hunting && shooter && hasTrait(shooter, 'steadyHand') ? CFG.HEADSHOT_CAREFUL : CFG.HEADSHOT_CHANCE;
        if (rnd(w) < hc) { head = true; dmg = 999; }                                   // headshot: kills, but cracks the beak
        birdHit(w, hitBird, dmg, shooter, head);
      } else deerHit(w, hitDeer, b.dmg);
      continue;
    }
    // near misses make birds flinch (a brief hesitation, not panic)
    for (const o of w.birds) if (o.state !== 'dead' && segHit(b.x, b.y, b.dx, b.dy, len, o.x, o.y, CFG.FLINCH_M) >= 0) o.flinch = CFG.FLINCH_TICKS;
    b.x += b.dx * len; b.y += b.dy * len; b.left -= len;
    if (b.left > 0.01) keep.push(b);
  }
  w.bullets = keep;
}
function segHit(x: number, y: number, dx: number, dy: number, len: number, cx: number, cy: number, r: number): number {
  const fx = cx - x, fy = cy - y; const t = fx * dx + fy * dy;
  if (t < 0 || t > len + r) return -1;
  const px = x + dx * t - cx, py = y + dy * t - cy;
  return px * px + py * py <= r * r ? Math.max(0, t / len) : -1;
}

/** Downed scouts: wounds worsen until someone works on him; Medicine stabilizes. */
export function tickDowned(w: World, s: Scout): void {
  if (s.status !== 'downed') return;
  if (!s.stabilized && s.draggedBy < 0) s.wound += CFG.WOUND_WORSEN_H / TPH();
  if (s.wound >= 100) killScout(w, s, 'his wounds');
}
export function killScout(w: World, s: Scout, cause: string): void {
  s.status = 'dead'; s.hp = 0; w.stats.deaths++;
  w.grief += CFG.MORALE_DEATH;
  // the man who spent the most time with him takes it hardest
  let close: Scout | null = null, best = 0;
  for (const o of w.scouts) if (o !== s && o.status !== 'dead' && (s.together[o.id] || 0) > best) { best = s.together[o.id]; close = o; }
  if (close) close.grief += CFG.MORALE_DEATH_CLOSE;
  addLog(w, s.name, 'died of ' + cause, 'combat');
  const c = w.scouts.find((x) => x.status === 'ok' && x !== s);
  if (c) say(w, c, 'death', { n: s.name }, 'combat');
  // his gear goes back to stores
  for (const g of s.guns) w.spare.push(g); s.guns = [];
  invAdd(w.camp.stock, 'ammo', s.ammo + s.mag); s.ammo = 0; s.mag = 0;
  for (const k in s.carry) invAdd(w.camp.stock, k as keyof typeof s.carry, s.carry[k as keyof typeof s.carry] || 0); s.carry = {};
  endAct(w, s);
  const p = nearestPassable(w, s.x, s.y, 3); if (p) { s.x = p[0]; s.y = p[1]; }
}

HOOKS.los = (w, ax, ay, bx, by) => hasLOS(w, ax, ay, bx, by);
HOOKS.shoot = (w, s, id, x, y, hunting) => shootAt(w, s, id, x, y, hunting);
HOOKS.see = (w, s, x, y) => canSee(w, s, x, y);
HOOKS.drop = (w, s) => dropCarcass(w, s);
