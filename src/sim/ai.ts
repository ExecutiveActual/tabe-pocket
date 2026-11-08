// Scout brain. Layers, from the bottom:
//   needs (individual drives)  ->  camp plan (commander's prioritized goals)  ->  jobs (concrete steps,
//   feasibility checked BEFORE claiming)  ->  danger override (combat.ts, runs first each tick).
// A scout picks the best-scoring option among need activities, leisure/training (data in config) and open
// camp goals, then commits to it until it finishes, fails with a reason, or an urgent need/danger interrupts.
import { CFG, FEATURES, NEED_IDS, NeedId, Item, ActivityDef, EXPORTS, SkillId, AGE, AgeClass, ITEM_LABEL } from './config';
import {
  Act, Scout, World, Goal, Build, rnd, rint, dayOf, dist, clamp, TPH, hourOf, period, isDark,
  invGet, invAdd, invWeight, tileOf, tileCenter, findPath, nearestPassable, addLog, SPEED_MUL, terrainAt, newId, PASSABLE, tfx, hasTrait, wakeOffset,
  funds, payCash,
} from './core';
import { BarkKey, barkLine } from './barks';

const DT = 1 / CFG.TICK_HZ;
/** Debug hook for scripts: set DEBUG.name to trace one scout's choices. */
export const DEBUG = { name: '', out: [] as string[] };

// ---------- basic queries ----------
export const able = (s: Scout): boolean => s.status === 'ok' || s.status === 'recovering';
export const campXY = (w: World): [number, number] => (w.camp.sited ? [w.camp.x, w.camp.y] : [w.landing.x, w.landing.y]);
export const fireLit = (w: World): boolean => w.camp.fire.built && w.camp.fire.fuel > 0;
export const built = (w: World, id: string): boolean => !!w.camp.builds[id] && w.camp.builds[id].built;
export function distCamp(w: World, x: number, y: number): number { const [cx, cy] = campXY(w); return dist(x, y, cx, cy); }
export function seen(w: World, x: number, y: number): boolean { return w.map.seen[tileOf(w, x, y)] === 1; }
export function stock(w: World, k: Item): number { return invGet(w.camp.stock, k); }

/** Chain of command: rank first, then Leadership skill, then seniority (id). Includes the downed (they keep their place). */
export function chainOrder(w: World): Scout[] {
  return w.scouts.filter((s) => s.status !== 'dead').sort((a, b) => b.rank - a.rank || b.skills.leadership - a.skills.leadership || a.id - b.id);
}
export function commander(w: World): Scout | null { for (const s of chainOrder(w)) if (able(s)) return s; return null; }

export function say(w: World, s: Scout, key: BarkKey, vars: { n?: string; x?: string | number } = {}, kind: 'bark' | 'warn' | 'combat' | 'boat' | 'event' = 'bark'): void {
  const text = barkLine(key, s.traits, (w.tick * 31 + s.id * 7) | 0, vars);
  s.bark = text; s.barkUntil = w.tick + 45; addLog(w, s.name, text, kind);
}
export function skillUp(s: Scout, sk: SkillId, hours: number): void { s.skills[sk] = Math.min(100, s.skills[sk] + CFG.SKILL_GAIN_PER_H * hours); }

// ---------- acts ----------
export function mkAct(kind: string, label: string, goal: string, tx: number, ty: number, o: Partial<Act> = {}): Act {
  const a: Act = { kind, label, goal, target: -1, tx, ty, step: 0, t: 0, started: 0, until: 0, path: null, pi: 0, pathTo: -1, buddy: -1, leader: -1, gid: -1, n: 0, item: '', actId: '', urgent: false, needBuddy: false, mode: '' };
  return Object.assign(a, o);
}
export function startAct(w: World, s: Scout, a: Act): void {
  a.started = w.tick; s.act = a; s.thought = a.label;
  if (a.kind !== 'idle') { s.idleT = 0; s.starts.push(w.tick); }
  while (s.starts.length && s.starts[0] < w.tick - 600) s.starts.shift();
  if (s.starts.length === 16) { w.stats.mon.oscillation++; w.stats.mon.notes.push(`osc ${s.name} t${w.tick} ${a.kind}`); }
}
export function endAct(w: World, s: Scout, why = ''): void {
  const a = s.act; if (!a) return;
  s.act = null;
  for (const arr of [w.trees, w.bushes, w.fish, w.carcasses] as { claim: number }[][]) for (const o of arr) if (o.claim === s.id) o.claim = -1;
  for (const b of Object.values(w.camp.builds)) if (b.claim === s.id) b.claim = -1;
  if (w.camp.fire.claim === s.id) w.camp.fire.claim = -1;
  if (w.camp.latrine.claim === s.id) w.camp.latrine.claim = -1;
  if (a.gid >= 0) { const g = w.gatherings.find((x) => x.id === a.gid); if (g) g.members = g.members.filter((m) => m !== s.id); }
  if (a.buddy >= 0) { const b = w.scouts.find((x) => x.id === a.buddy); if (b && b.act && b.act.leader === s.id) endAct(w, b); }
  if (a.leader >= 0) { const l = w.scouts.find((x) => x.id === a.leader); if (l && l.act && l.act.buddy === s.id) l.act.buddy = -1; }
  if (a.kind === 'rescue' && a.target >= 0) { const v = w.scouts.find((x) => x.id === a.target); if (v && v.draggedBy === s.id) v.draggedBy = -1; }
  if (why) s.why = why;
  s.posture = 'stand'; s.sleeping = false;
}

/** Walks along an A* path. Returns 0 arrived, 1 moving, -1 no path. */
export function moveTo(w: World, s: Scout, x: number, y: number, mul = 1): number {
  const a = s.act as Act;
  if (dist(s.x, s.y, x, y) < 0.6) { s.stillT = 0; return 0; }
  const goalTile = tileOf(w, x, y);
  if (!a.path || a.pathTo !== goalTile) {
    if (!PASSABLE[terrainAt(w, s.x, s.y)]) { const p = nearestPassable(w, s.x, s.y, 4); if (p) { s.x = p[0]; s.y = p[1]; } }
    const p = findPath(w, tileOf(w, s.x, s.y), goalTile);
    if (!p) return -1;
    a.path = p; a.pi = 1; a.pathTo = goalTile;
  }
  let wx = x, wy = y;
  if (a.pi < a.path.length - 1) [wx, wy] = tileCenter(w, a.path[a.pi]);
  let spd = CFG.WALK_MS * mul * SPEED_MUL[terrainAt(w, s.x, s.y)] * DT;
  if (s.status === 'recovering' || s.sick > 0) spd *= 0.7;
  for (const i of s.injuries) spd *= CFG.INJURIES[i].speedMul;
  if (s.carcassMode === 'drag') spd *= CFG.CARCASS_DRAG_MUL;
  const ti = tileOf(w, s.x, s.y); const tr = w.map.trail[ti] || 0;
  if (FEATURES.trails) for (let k = CFG.TRAIL_LEVELS.length - 1; k >= 0; k--) if (tr >= CFG.TRAIL_LEVELS[k].at) { spd *= CFG.TRAIL_LEVELS[k].mul; break; }
  const d = dist(s.x, s.y, wx, wy);
  const ox = s.x, oy = s.y;
  if (d <= spd) { s.x = wx; s.y = wy; if (a.pi < a.path.length - 1) a.pi++; }
  else { s.x += ((wx - s.x) / d) * spd; s.y += ((wy - s.y) / d) * spd; s.fx = (wx - ox) / d; s.fy = (wy - oy) / d; }
  if (FEATURES.trails) { const nt = tileOf(w, s.x, s.y); if (nt !== ti) w.map.trail[nt] = Math.min(CFG.TRAIL_MAX, (w.map.trail[nt] || 0) + 1); }
  if (dist(ox, oy, s.x, s.y) < 1e-4) { if (++s.stillT === 30) { w.stats.mon.stuck++; w.stats.mon.notes.push(`stuck ${s.name} t${w.tick} ${a.kind}`); a.path = null; } }
  else s.stillT = 0;
  return 1;
}

function workMul(s: Scout): number {
  let m = 1;
  if (s.morale < 30) m *= 0.8;          // low morale: works badly
  if (s.status === 'recovering') m *= 0.6;
  if (s.sick > 0) m *= CFG.SICKNESS[s.sickKind] ? CFG.SICKNESS[s.sickKind].workMul : CFG.SICK_WORK_MUL;
  return m;
}
/** Advances work progress; returns true when `hours` of work are done. */
function work(w: World, s: Scout, hours: number, sk?: SkillId): boolean {
  const a = s.act as Act; a.t += workMul(s);
  s.posture = 'crouch';
  if (sk) skillUp(s, sk, 1 / TPH());
  if (FEATURES.gear) s.gear = Math.max(0, s.gear - CFG.GEAR_WEAR_H / TPH());
  if (FEATURES.accidents && rnd(w) < (CFG.ACCIDENT_PER_WORK_H / TPH()) * (s.morale < 30 ? 2 : 1)) accident(w, s);
  return a.t >= hours * TPH();
}
/** Minor accidents only: a weighted pick from the data table, never taking him below the HP floor. */
function accident(w: World, s: Scout): void {
  const tot = CFG.ACCIDENTS.reduce((t, x) => t + x.w, 0); let r = rnd(w) * tot;
  const ac = CFG.ACCIDENTS.find((x) => (r -= x.w) < 0) || CFG.ACCIDENTS[0];
  const dmg = Math.min(ac.dmg[0] + rnd(w) * (ac.dmg[1] - ac.dmg[0]), Math.max(0, s.hp - s.maxHp * CFG.ACCIDENT_HP_FLOOR));
  if (dmg <= 0) return;
  s.hp -= dmg; say(w, s, 'accident', {}, 'warn'); addLog(w, s.name, ac.text, 'event');
}
/** Sickness from the data table (fever, infection, poisoning, chills). Tough/Sickly scale the odds upstream. */
export function fallSick(w: World, s: Scout, kind: string): void {
  if (!FEATURES.sickness) return;
  if (s.status === 'dead' || s.sick > 0) return;
  const d = CFG.SICKNESS[kind]; s.sick = d.hours * TPH(); s.sickKind = kind;
  say(w, s, 'sick', {}, 'warn'); addLog(w, s.name, 'is down with ' + d.label.toLowerCase(), 'event');
}
export function hurt(w: World, s: Scout, dmg: number, cause: string): void {
  if (s.status === 'dead' || s.status === 'downed') return;
  s.hp -= dmg;
  if (s.hp <= 0) {
    s.hp = 0; s.status = 'downed'; s.wound = 10; s.stabilized = false; w.stats.downs++;
    addLog(w, s.name, `is down (${cause})`, 'combat'); say(w, s, 'downed', {}, 'combat');
    // his shout wakes the camp
    for (const o of w.scouts) if (o.sleeping && dist(o.x, o.y, s.x, s.y) < CFG.SHOUT_M) { o.sleeping = false; if (o.act && o.act.kind === 'sleep') endAct(w, o); }
    endAct(w, s); s.combat = false;
  }
}

function carryRoom(s: Scout, k: Item): number { return Math.max(0, Math.floor((CFG.CARRY_CAP - invWeight(s.carry)) / CFG.WEIGHT[k] + 1e-9)); }
function depositAll(w: World, s: Scout): void {
  for (const k in s.carry) { const n = s.carry[k as Item] || 0; if (n > 0) invAdd(w.camp.stock, k as Item, n); }
  s.carry = {}; s.carcassMode = '';
}
function partner(w: World, s: Scout): Scout | null {
  const a = s.act; if (!a || a.buddy < 0) return null;
  const b = w.scouts.find((x) => x.id === a.buddy); return b && b.act && b.act.leader === s.id && able(b) ? b : null;
}
/** Leader waits for a lagging buddy so nobody ends up alone out there. */
function buddyLagging(w: World, s: Scout): boolean { const b = partner(w, s); return !!b && dist(b.x, b.y, s.x, s.y) > 14; }

// ---------- needs and morale ----------
const NEED_WORD: Record<NeedId, string> = { food: 'Hungry', water: 'Thirsty', rest: 'Exhausted', warmth: 'Cold', social: 'Lonely', fitness: 'Out of shape' };
export function tickNeeds(w: World, s: Scout): void {
  const tph = TPH(), h = hourOf(w.tick);
  for (const n of NEED_IDS) if (n !== 'rest' && n !== 'warmth' && (FEATURES.leisure || (n !== 'social' && n !== 'fitness'))) s.needs[n] = Math.max(0, s.needs[n] - CFG.NEED_DECAY_H[n] / tph);
  if (s.sleeping) s.needs.rest = Math.min(100, s.needs.rest + CFG.SLEEP_GAIN_H / tph);
  else s.needs.rest = Math.max(0, s.needs.rest - CFG.NEED_DECAY_H.rest / tph);
  // warmth: cold at night or in rain, unless by a lit fire (bedrolls are around the fire)
  const nearFire = fireLit(w) && dist(s.x, s.y, w.camp.fire.x, w.camp.fire.y) < CFG.FIRE_WARM_M;
  const cold = isDark(h) || w.weather !== 'clear';
  let dw = 0;
  if (nearFire) dw = CFG.WARMTH_FIRE_GAIN_H; else if (cold) dw = -CFG.WARMTH_COLD_LOSS_H * (w.weather === 'storm' ? 1.5 : 1) * (s.gear < 30 ? 1.3 : 1); else dw = 10;
  s.needs.warmth = clamp(s.needs.warmth + dw / tph, 0, 100);
  // stress: danger and exhaustion build it; sleep and leisure bleed it off
  let ds = -CFG.STRESS_DECAY_H;
  if (FEATURES.leisure && (s.combat || (s.threat && w.tick - s.threat.t < 100))) ds += CFG.STRESS_DANGER_H;
  if (s.needs.rest < 30) ds += CFG.STRESS_TIRED_H;
  if (s.sleeping) ds -= CFG.STRESS_RELIEF_SLEEP_H;
  if (s.act && s.act.kind === 'leisure') ds -= CFG.STRESS_RELIEF_LEISURE_H;
  s.stress = clamp(s.stress + ds / tph, 0, 100);
  if (s.sick > 0) {
    s.sick--; const d = CFG.SICKNESS[s.sickKind]; if (d && s.hp > s.maxHp * 0.3) s.hp -= d.hpPerH / tph;
    if (s.sick === 0) { addLog(w, s.name, 'is over the ' + (d ? d.label.toLowerCase() : 'sickness'), 'event'); s.sickKind = ''; }
  }
  // wounds heal slowly with rest, faster under a medic's care
  const heal = ((s.act && s.act.kind === 'sleep') || s.status === 'recovering' ? CFG.HEAL_REST_H : CFG.HEAL_AWAKE_H) * (s.medicUntil > w.tick ? CFG.HEAL_MEDIC_MUL : 1);
  if (s.status === 'recovering') { s.hp = Math.min(s.maxHp, s.hp + heal / tph); if (--s.recover <= 0) { s.status = 'ok'; addLog(w, s.name, 'is back on his feet', 'event'); } }
  else if (s.status === 'ok' && s.hp < s.maxHp) s.hp = Math.min(s.maxHp, s.hp + heal / tph);
}
export function tickMorale(w: World, s: Scout): void {
  const th: { text: string; v: number }[] = [];
  for (const n of NEED_IDS) {
    const v = s.needs[n], seek = CFG.NEED_SEEK[n];
    if (v < seek) th.push({ text: NEED_WORD[n], v: -Math.round((CFG.MORALE_NEED_PENALTY * (seek - v)) / seek) });
  }
  const ammo = stock(w, 'ammo') + w.scouts.reduce((t, x) => t + (able(x) ? x.ammo : 0), 0);
  if (ammo < CFG.AMMO_LOW) th.push({ text: 'Short on ammo', v: -CFG.MORALE_AMMO_LOW });
  if (FEATURES.leisure && w.tick - s.lastLeisure > CFG.MORALE_NO_DOWNTIME_H * TPH()) th.push({ text: 'No downtime', v: -CFG.MORALE_NO_DOWNTIME });
  const C = CFG.MORALE_COMFORT;
  if (fireLit(w)) th.push({ text: 'Warm fire', v: C.fire });
  if (w.camp.latrine.built) th.push({ text: 'Proper latrine', v: C.latrine });
  for (const id of ['mess', 'shed', 'tower', 'palisade']) if (built(w, id)) th.push({ text: (CFG.BUILDINGS.find((b) => b.id === id) || { label: id }).label, v: C[id] });
  if (s.lastMeal > 0 && w.tick - s.lastMeal < 12 * TPH()) th.push({ text: 'Hot meal', v: C.meal + (built(w, 'mess') ? 2 : 0) });
  if (s.stress > 10) th.push({ text: 'Strung out', v: -Math.round((s.stress / 100) * CFG.STRESS_MORALE_MAX) });
  if (s.lastMeal > 0 && s.lastDrink > 0 && Math.abs(s.lastMeal - s.lastDrink) < CFG.MEAL_AND_DRINK_WINDOW_H * TPH() && w.tick - Math.max(s.lastMeal, s.lastDrink) < CFG.MEAL_AND_DRINK_WINDOW_H * TPH()) th.push({ text: 'Good meal and a drink', v: CFG.MEAL_AND_DRINK_LIFT });
  if (w.grief > 0.5) th.push({ text: 'Lost a mate', v: -Math.round(w.grief) });
  if (s.gear < 30) th.push({ text: 'Worn-out gear', v: -4 });
  if (s.hp < s.maxHp * 0.5 && s.status !== 'downed') th.push({ text: 'Wounded', v: -6 });
  if (s.sick > 0) th.push({ text: CFG.SICKNESS[s.sickKind] ? CFG.SICKNESS[s.sickKind].label : 'Sick', v: -6 });
  if (s.grief > 0.5) th.push({ text: 'Lost his closest mate', v: -Math.round(s.grief) });
  if (s.hangover > w.tick) th.push({ text: 'Hungover', v: CFG.HANGOVER_MORALE });
  for (const i of s.injuries) th.push({ text: CFG.INJURIES[i].label, v: -3 });
  s.thoughts = th.filter((t) => t.v !== 0);
  let target = CFG.MORALE_BASE + 35; for (const t of s.thoughts) target += t.v;
  target = clamp(target, 0, 100);
  const step = (CFG.MORALE_RATE_H * 25) / TPH();     // called every 25 ticks
  if (s.morale < target) s.morale = Math.min(target, s.morale + step * CFG.MORALE_RECOVER_FAST);
  else s.morale = Math.max(target, s.morale - step);
}

// ---------- scoring helpers ----------
function urg(v: number, seek: number): number {
  if (v >= seek) return ((100 - v) / 100) * 0.3;
  let u = ((seek - v) / seek) * 2 + 0.3;
  if (v < CFG.NEED_URGENT) u += 2;
  return u;
}
function foodAvailable(w: World, s: Scout): Item | '' {
  for (const k of CFG.EAT_PREF) if (invGet(s.carry, k) >= 1) return k;
  if (!w.camp.sited) return '';
  for (const k of CFG.EAT_PREF) if (stock(w, k) >= 1) return k;
  return '';
}
function nearestWaterPt(w: World, s: Scout): [number, number] | null {
  let best = -1, bd = 1e18;
  for (const i of w.waterPts) { if (w.map.seen[i] !== 1) continue; const [x, y] = tileCenter(w, i); const d = (x - s.x) * (x - s.x) + (y - s.y) * (y - s.y); if (d < bd) { bd = d; best = i; } }
  return best < 0 ? null : tileCenter(w, best);
}
function bedSpot(w: World, s: Scout): [number, number] {
  const k = s.id % 8; const R = 3.2;  // bedrolls in a ring around the fire
  const ring = [[1, 0], [0.7, 0.7], [0, 1], [-0.7, 0.7], [-1, 0], [-0.7, -0.7], [0, -1], [0.7, -0.7]];
  return nearestPassable(w, w.camp.fire.x + ring[k][0] * R, w.camp.fire.y + ring[k][1] * R, 3) || [w.camp.fire.x, w.camp.fire.y];
}
function fireSeat(w: World, s: Scout, salt: number): [number, number] {
  const ring = [[1, 0.3], [0.3, 1], [-0.8, 0.6], [-1, -0.2], [-0.3, -1], [0.7, -0.7]]; const k = (s.id + salt) % ring.length;
  return nearestPassable(w, w.camp.fire.x + ring[k][0] * 2.2, w.camp.fire.y + ring[k][1] * 2.2, 3) || [w.camp.fire.x, w.camp.fire.y];
}

// ---------- deciding ----------
interface Cand { score: number; why: string; make: () => Act | null }

export function decide(w: World, s: Scout): void {
  const h = hourOf(w.tick), per = period(h), dark = isDark(h);
  const cands: Cand[] = [];
  const jitter = (): number => rnd(w) * 0.06;
  // the boss always goes to meet the trader while it's in (unless he's needed to keep someone alive)
  if (w.boat.state === 'docked' && !w.boat.pending && commander(w) === s && !s.combat) { const g = w.plan.goals.find((x) => x.kind === 'meetBoat'); startAct(w, s, mkAct('meetBoat', 'Meeting the boat (requisitions)', g ? g.id : '', w.landing.x, w.landing.y)); return; }
  if (s.tag === 'pack' && w.camp.sited) { startAct(w, s, mkAct('unpack', 'Hauling crates and his pack to camp', '', w.camp.pile.x, w.camp.pile.y)); return; }
  // --- camp under attack: nobody turns in while mates are fighting nearby; stand to by the fire instead ---
  const alert = campAlert(w) && w.camp.sited && dist(s.x, s.y, w.camp.x, w.camp.y) < CFG.ALERT_M + 20;
  if (alert && dark) cands.push({ score: CFG.STAND_TO_SCORE + jitter(), why: 'stand to', make: () => { const [x, y] = fireSeat(w, s, 5); return mkAct('idle', 'Standing to, rifle ready', '', x, y, { until: w.tick + 40 }); } });
  // --- leftovers: a man whose haul was interrupted drops it off at camp before starting something new ---
  if (w.camp.sited && !alert && Object.keys(s.carry).some((k) => (s.carry[k as Item] || 0) > 0))
    cands.push({ score: CFG.STASH_SCORE + jitter(), why: 'drop off', make: () => { const x = mkAct('load', 'Dropping off what he carries', '', w.camp.pile.x, w.camp.pile.y); x.step = 2; return x; } });
  // --- needs ---
  const mealTime = CFG.MEALS.some((m) => h >= m.from && h < m.to);
  const fu = s.needs.food < CFG.NEED_URGENT ? urg(s.needs.food, CFG.NEED_SEEK.food) : mealTime ? Math.max(0.5, urg(s.needs.food, 90)) * CFG.MEAL_TIME_MUL * 0.6 : urg(s.needs.food, CFG.NEED_SEEK.food) * CFG.OFF_MEAL_MUL;
  if (s.needs.food < (mealTime ? 85 : 60)) {
    const it = foodAvailable(w, s);
    if (it) cands.push({ score: fu * 1.6 + jitter(), why: 'hungry', make: () => { const [x, y] = w.camp.fire.built ? fireSeat(w, s, 4) : [w.camp.pile.x, w.camp.pile.y]; return mkAct('eat', mealTime ? 'Eating with the lads' : 'Eating', '', x, y, { urgent: s.needs.food < CFG.NEED_URGENT }); } });
    else if (s.needs.food < CFG.NEED_SEEK.food && (s.cool['hungry'] || 0) < w.tick) { s.cool['hungry'] = w.tick + 3 * TPH(); say(w, s, 'hungryNoFood', {}, 'warn'); }
  }
  if (s.needs.water < 92) cands.push({ score: Math.max(mealTime && s.needs.water < 80 ? 2.4 : 0, urg(s.needs.water, CFG.NEED_SEEK.water + 10) * 2.1) + jitter(), why: 'thirsty', make: () => drinkAct(w, s) });
  {
    let sc = 0;
    const wakeH = CFG.WAKE_H + wakeOffset(s);
    if ((dark || h < wakeH) && h < 12 && s.needs.rest < 92) sc = 3 + (100 - s.needs.rest) / 50;
    else if (dark && h < 21 && s.needs.rest > 30) sc = 0.9 + (h - 19.5);          // evening: supper and a smoke first
    else if (dark && s.needs.rest < 92) sc = 3 + (100 - s.needs.rest) / 50;
    else if (per === 'evening' && h >= 20.5 && s.needs.rest < 80) sc = 1.5;
    else if (s.needs.rest < 20) sc = 2.5;
    if (sc > 0 && !alert) cands.push({ score: sc + jitter(), why: 'tired', make: () => sleepAct(w, s) });
  }
  if (s.needs.warmth < CFG.NEED_SEEK.warmth && fireLit(w)) {
    cands.push({ score: urg(s.needs.warmth, CFG.NEED_SEEK.warmth) * 1.4, why: 'cold', make: () => { const [x, y] = fireSeat(w, s, 1); return mkAct('warm', 'Warming up by the fire', '', x, y); } });
  }
  if (FEATURES.gear && w.camp.sited && s.guns.length && s.guns[0].cond < CFG.MAINT_BELOW && (per === 'evening' || per === 'day')) {
    cands.push({ score: 0.5 + (CFG.MAINT_BELOW - s.guns[0].cond) / 40, why: 'gun', make: () => { const [x, y] = fireSeat(w, s, 2); return mkAct('maint', 'Cleaning his rifle', '', x, y); } });
  }
  // --- leisure and training (data-driven) ---
  if (FEATURES.leisure && w.camp.sited && w.camp.fire.built && !dark) {
    for (const def of CFG.ACTIVITIES) {
      const aff = def.affinity[per]; if (aff <= 0) continue;
      if ((s.cool[def.id] || 0) > w.tick) continue;
      if (def.where === 'fire' && !fireLit(w)) continue;
      if (def.requires) {
        const r = def.requires; const have = stock(w, r.item) + (r.alt ? stock(w, r.alt) : 0);
        if (have < r.perSession + (r.surplusOver || 0)) continue;  // e.g. marksmanship only with a big ammo surplus
      }
      let g = 0; for (const n in def.gain) { const nn = n as NeedId; g += ((def.gain[nn] || 0) / 40) * urg(s.needs[nn], CFG.NEED_SEEK[nn] + 25); }
      if (g <= 0.05) continue;
      if (def.traitOnly && !hasTrait(s, def.traitOnly)) continue;
      const social = def.minPeople >= 2;
      let m = 1; for (const t of s.traits) m *= (def.traitMul && def.traitMul[t]) || 1;
      if (social) m *= tfx(s, 'social');
      if (def.drink) m *= tfx(s, 'drink');
      if (m <= 0) continue;
      const open = w.gatherings.find((x) => x.actId === def.id && x.members.length < def.maxPeople);
      // only host a group activity when somebody is plausibly free to join
      if (!open && def.minPeople >= 2 && aff < 1 && !w.scouts.some((o) => o !== s && o.status === 'ok' && o.act && (o.act.kind === 'idle' || o.act.kind === 'leisure' || o.act.kind === 'eat'))) continue;
      cands.push({ score: Math.min(CFG.LEISURE_MAX_SCORE, g * aff * m * 0.9 + (open ? 0.6 : 0)) + jitter(), why: def.id, make: () => leisureAct(w, s, def) });
    }
  }
  // --- camp plan goals ---
  const wa = CFG.WORK_AFFINITY[per] * (dark ? 0 : 1);
  {
    const claims = goalClaims(w);
    for (const g of w.plan.goals) {
      if (g.blockedUntil > w.tick) continue;
      if ((claims[g.id] || 0) >= g.slots) continue;
      if (g.kind === 'meetBoat' && commander(w) !== s) continue;
      if (g.kind === 'escort' && g.target === s.id) continue;
      if (g.kind === 'treat' && g.target === s.id) continue;
      if ((s.cool['goal:' + g.id] || 0) > w.tick) continue;
      if (g.kind === 'cook' && CFG.COOK_BEST_ONLY) { const cook = bestCook(w); if (cook && cook !== s) continue; }
      const life = g.kind === 'rescue' || g.kind === 'treat' || g.kind === 'escort';
      let sc = g.pri * (life ? CFG.LIFE_GOAL_MUL : wa) * (s.morale < 30 ? 0.85 : 1);  // a downed mate outranks sleep
      if (sc <= 0) continue;
      if ((g.kind === 'hunt' || g.kind === 'roukhaHunt' || g.kind === 'explore') ) sc /= tfx(s, 'danger');
      if (s.sick > 0 || s.status === 'recovering') sc *= 0.5;
      cands.push({ score: sc + jitter(), why: g.id, make: () => makeJob(w, s, g) });
    }
  }
  cands.sort((a, b) => b.score - a.score);
  if (DEBUG.name === s.name) DEBUG.out.push(`t${w.tick} ${s.name}: ` + cands.slice(0, 8).map((c) => `${c.why}=${c.score.toFixed(2)}`).join(' '));
  for (const c of cands) {
    if (c.score < 0.12) break;
    const a = c.make();
    if (a) { startAct(w, s, a); s.why = c.why; return; }
  }
  const [ix, iy] = w.camp.sited && w.camp.fire.built ? fireSeat(w, s, 3) : [s.x, s.y];
  startAct(w, s, mkAct('idle', w.camp.sited ? 'Taking a breather' : 'Waiting', '', ix, iy, { until: w.tick + 30 }));
}

/** True while Roukha are pressing the camp: a pack charging close by, or a man fighting near the fire. */
export function campAlert(w: World): boolean {
  if (!w.camp.sited) return false;
  const cx = w.camp.x, cy = w.camp.y, R = CFG.ALERT_M;
  if (w.scouts.some((o) => o.combat && o.status === 'ok' && dist(o.x, o.y, cx, cy) < R)) return true;
  return w.packs.some((p) => p.state === 'charge' && p.members.some((id) => { const b = w.birds.find((x) => x.id === id); return !!b && b.state !== 'dead' && dist(b.x, b.y, cx, cy) < R; }));
}
/** The best available cook (highest Cooking among scouts who are fit and not fighting or on watch). */
export function bestCook(w: World): Scout | null {
  const c = w.scouts.filter((x) => x.status === 'ok' && !x.combat && !(x.act && (x.act.needBuddy || x.act.kind === 'buddy' || x.act.kind === 'watch' || x.act.kind === 'rescue') && x.act.kind !== 'idle'))
    .sort((a, b) => b.skills.cooking - a.skills.cooking || a.id - b.id);
  return c[0] || null;
}
export function goalClaims(w: World): Record<string, number> {
  const c: Record<string, number> = {};
  for (const s of w.scouts) if (s.act && s.act.goal && able(s)) c[s.act.goal] = (c[s.act.goal] || 0) + 1;
  return c;
}
function block(w: World, g: Goal, reason: string, hours: number, s: Scout, bark?: BarkKey): null {
  g.blockedUntil = w.tick + hours * TPH(); g.reason = reason;
  const key = 'warn:' + g.kind;
  if (bark && (w.plan.warned[key] || 0) < w.tick) { w.plan.warned[key] = w.tick + 4 * TPH(); say(w, s, bark, {}, 'warn'); }
  return null;
}
function drinkAct(w: World, s: Scout): Act | null {
  const pt = nearestWaterPt(w, s);
  const caskOk = w.camp.sited && stock(w, 'water') >= 1;
  const dCask = caskOk ? dist(s.x, s.y, w.camp.cask.x, w.camp.cask.y) : 1e9;
  const dPt = pt ? dist(s.x, s.y, pt[0], pt[1]) : 1e9;
  const ptFar = pt ? distCamp(w, pt[0], pt[1]) > CFG.FAR_M && dist(s.x, s.y, pt[0], pt[1]) > 25 : true;
  if (caskOk && (dCask <= dPt + 10 || ptFar)) return mkAct('drink', 'Drinking from the cask', '', w.camp.cask.x, w.camp.cask.y, { mode: 'cask', urgent: s.needs.water < CFG.NEED_URGENT });
  if (!pt || (ptFar && s.needs.water > CFG.NEED_URGENT)) return null; // no lone trips for a drink unless desperate
  return mkAct('drink', 'Drinking at the stream', '', pt[0], pt[1], { mode: 'stream', urgent: s.needs.water < CFG.NEED_URGENT });
}
function sleepAct(w: World, s: Scout): Act {
  const [x, y] = w.camp.sited && w.camp.fire.built ? bedSpot(w, s) : [s.x, s.y];
  return mkAct('sleep', 'Sleeping', '', x, y, { urgent: s.needs.rest < CFG.NEED_URGENT });
}
function leisureAct(w: World, s: Scout, def: ActivityDef): Act | null {
  let g = w.gatherings.find((x) => x.actId === def.id && x.members.length < def.maxPeople);
  if (!g) {
    const [x, y] = def.where === 'range' ? [w.camp.range.x, w.camp.range.y] : def.where === 'camp' ? [w.camp.x + 4, w.camp.y + 3] : [w.camp.fire.x, w.camp.fire.y];
    const p = nearestPassable(w, x, y, 4) || [x, y];
    g = { id: newId(w), actId: def.id, x: p[0], y: p[1], members: [], host: s.id, started: w.tick, active: false, until: 0 };
    w.gatherings.push(g);
  }
  g.members.push(s.id);
  if (def.requires) {
    const r = def.requires; let need = r.perSession;
    const fromMain = Math.min(need, stock(w, r.item) - (r.surplusOver || 0)); if (fromMain > 0) { invAdd(w.camp.stock, r.item, -fromMain); need -= fromMain; }
    if (need > 0 && r.alt) invAdd(w.camp.stock, r.alt, -Math.min(need, stock(w, r.alt)));
  }
  const k = g.members.length;
  const spot = def.where === 'fire' ? fireSeat(w, s, k) : nearestPassable(w, g.x + (k % 3) * 1.6 - 1.6, g.y + Math.floor(k / 3) * 1.6, 3) || [g.x, g.y];
  if (g.host === s.id && def.minPeople >= 2) { s.bark = def.bark; s.barkUntil = w.tick + 45; addLog(w, s.name, def.bark, 'bark'); }
  return mkAct('leisure', def.label, '', spot[0], spot[1], { gid: g.id, actId: def.id });
}

// ---------- job factory: think before acting ----------
function reachable(w: World, s: Scout, x: number, y: number): boolean { return !!findPath(w, tileOf(w, s.x, s.y), tileOf(w, x, y)); }
function freeHands(w: World, s: Scout): number { return w.scouts.filter((x) => x !== s && x.status === 'ok' && !x.combat).length; }

/** A standable spot near (x,y). */
function sp(w: World, x: number, y: number): [number, number] { return nearestPassable(w, x, y, 4) || [x, y]; }
function makeJob(w: World, s: Scout, g: Goal): Act | null {
  const [cx, cy] = campXY(w);
  const far = (x: number, y: number): boolean => dist(x, y, cx, cy) > CFG.FAR_M;
  const canGoFar = (): boolean => (s.cool['far'] || 0) < w.tick && freeHands(w, s) > 0;
  switch (g.kind) {
    case 'build': {
      const b = g.id === 'fire' ? w.camp.fire : g.id === 'latrine' ? w.camp.latrine : w.camp.builds[g.id];
      if (!b || b.built || b.claim >= 0) return null;
      const def = CFG.BUILDINGS.find((x) => x.id === g.id);
      const wood = g.id === 'fire' ? CFG.FIRE_BUILD_WOOD : def ? def.wood : 0;
      if (b.progress === 0 && stock(w, 'wood') < wood) return block(w, g, 'Needs ' + wood + ' wood first', 0.3, s);
      if (!reachable(w, s, b.x, b.y)) return block(w, g, 'Site unreachable', 2, s);
      b.claim = s.id;
      const label = g.id === 'fire' ? 'Building the campfire' : g.id === 'latrine' ? 'Digging the latrine' : 'Building: ' + (def ? def.label : g.id);
      say(w, s, g.id === 'fire' ? 'fire' : g.id === 'latrine' ? 'latrine' : 'build', { x: def ? def.label.toLowerCase() : '' });
      return mkAct('build', label, g.id, b.x, b.y, { mode: g.id });
    }
    case 'wood': case 'timber': {
      const timber = g.kind === 'timber';
      const cand = w.trees.filter((t) => t.claim < 0 && (timber ? t.size >= 2 && t.timber > 0 : t.wood >= 1) && t.id !== w.camp.tree && seen(w, t.x, t.y));
      cand.sort((a, b) => dist(a.x, a.y, cx, cy) - dist(b.x, b.y, cx, cy) || a.id - b.id);
      let tries = 0;
      for (const t of cand) {
        if (dist(t.x, t.y, cx, cy) > CFG.EXPLORE_MAX_M || ++tries > 6) break;
        if (far(t.x, t.y) && !canGoFar()) continue;
        if (!reachable(w, s, t.x, t.y)) continue;
        t.claim = s.id;
        say(w, s, timber ? 'timber' : 'wood');
        return mkAct(timber ? 'fell' : 'chop', timber ? 'Felling timber' : 'Cutting firewood', g.id, t.x, t.y, { target: t.id, needBuddy: far(t.x, t.y) });
      }
      return block(w, g, timber ? 'No reachable timber trees' : 'No wood nearby', 1, s, timber ? undefined : 'noWood');
    }
    case 'forage': {
      const food = g.id === 'forage';  // 'forage' wants food; 'herbs' wants sellable/medicinal plants
      const cand = w.bushes.filter((b) => b.claim < 0 && b.berries >= 2 && (food ? CFG.FORAGE[b.kind].item === 'berries' || CFG.FORAGE[b.kind].item === 'rawMeat' : !(CFG.FORAGE[b.kind].item === 'berries' || CFG.FORAGE[b.kind].item === 'rawMeat')) && dist(b.x, b.y, cx, cy) < CFG.FORAGE_MAX_M && seen(w, b.x, b.y)).sort((a, b) => dist(a.x, a.y, cx, cy) - dist(b.x, b.y, cx, cy) || a.id - b.id);
      for (const b of cand.slice(0, 5)) {
        if (far(b.x, b.y) && !canGoFar()) continue;
        if (!reachable(w, s, b.x, b.y)) continue;
        b.claim = s.id; say(w, s, 'forage');
        return mkAct('forage', CFG.FORAGE[b.kind].label, g.id, b.x, b.y, { target: b.id, needBuddy: far(b.x, b.y) });
      }
      return block(w, g, food ? 'No ripe forage known' : 'No herbs or leaf known', 1, s);
    }
    case 'fish': {
      const setting = g.id === 'setTrap';
      const cand = w.fish.filter((f) => f.claim < 0 && (setting ? !f.trap : f.trap && f.fish >= 1) && seen(w, f.x, f.y) && dist(f.x, f.y, cx, cy) < CFG.FORAGE_MAX_M).sort((a, b) => dist(a.x, a.y, cx, cy) - dist(b.x, b.y, cx, cy) || a.id - b.id);
      for (const f of cand.slice(0, 4)) {
        if (far(f.x, f.y) && !canGoFar()) continue;
        if (!reachable(w, s, f.x, f.y)) continue;
        f.claim = s.id; say(w, s, 'fish');
        return mkAct('fish', setting ? 'Setting a fish trap' : 'Checking the fish traps', g.id, f.x, f.y, { target: f.id, needBuddy: far(f.x, f.y), mode: setting ? 'set' : 'check' });
      }
      return block(w, g, setting ? 'No spot for a trap known' : 'No traps with fish', 1, s);
    }
    case 'hunt': {
      if (!canGoFar()) return null;
      const deer = w.deer.filter((d) => d.state !== 'dead' && seen(w, d.x, d.y) && dist(d.x, d.y, cx, cy) < CFG.EXPLORE_MAX_M)
        .sort((a, b) => dist(a.x, a.y, s.x, s.y) - dist(b.x, b.y, s.x, s.y) || a.id - b.id);
      if (!deer.length) return block(w, g, 'No deer seen lately', 1.5, s);
      const d = deer[0];
      if (!reachable(w, s, d.x, d.y)) return block(w, g, 'Deer out of reach', 1, s);
      return mkAct('hunt', 'Hunting deer', g.id, d.x, d.y, { target: d.id, needBuddy: true, until: w.tick + 3 * TPH() });
    }
    case 'roukhaHunt': {
      if (!canGoFar()) return null;
      const it = w.intel.filter((i) => w.tick - i.t < CFG.INTEL_LIFE_H * TPH()).sort((a, b) => b.t - a.t || a.id - b.id)[0];
      if (!it) return block(w, g, 'No fresh Roukha sign', 1, s);
      if (distCamp(w, it.x, it.y) > CFG.EXPLORE_MAX_M) return block(w, g, 'Sign too far out', 1, s);
      if (!reachable(w, s, it.x, it.y)) return block(w, g, 'Sign out of reach', 1, s);
      w.stats.roukhaHunts++;
      return mkAct('rhunt', 'Hunting Roukha (following sign)', g.id, it.x, it.y, { target: it.pack, needBuddy: true, until: w.tick + CFG.HUNT_MAX_H * TPH() });
    }
    case 'loot': {
      const c = w.carcasses.find((x) => x.id === g.target);
      if (!c || c.claim >= 0) return null;
      if (far(c.x, c.y) && !canGoFar()) return null;
      if (!reachable(w, s, c.x, c.y)) return block(w, g, 'Carcass unreachable', 2, s);
      c.claim = s.id;
      return mkAct('loot', c.kind === 'bird' ? 'Recovering a Roukha carcass' : 'Butchering a deer', g.id, c.x, c.y, { target: c.id, needBuddy: far(c.x, c.y) });
    }
    case 'water': {
      const pt = nearestWaterPt(w, s);
      if (!pt) return block(w, g, 'No fresh water known', 1, s);
      if (far(pt[0], pt[1]) && !canGoFar()) return null;
      if (!reachable(w, s, pt[0], pt[1])) return block(w, g, 'Water unreachable', 1, s);
      say(w, s, 'water');
      return mkAct('fetchWater', 'Fetching water', g.id, pt[0], pt[1], { needBuddy: far(pt[0], pt[1]) });
    }
    case 'fuel': return stock(w, 'wood') >= 1 ? mkAct('fuel', 'Feeding the fire', g.id, ...sp(w, w.camp.fire.x, w.camp.fire.y + 1)) : null;
    case 'cook': {
      if (!fireLit(w) || stock(w, 'rawMeat') + stock(w, 'rawFish') < 1) return null;
      say(w, s, 'cook'); return mkAct('cook', 'Cooking', g.id, ...sp(w, w.camp.fire.x + 1.2, w.camp.fire.y));
    }
    case 'smoke': {
      if (stock(w, 'rawMeat') < 1) return null;
      const r = w.camp.builds['racks']; const rack = !!r && r.built;
      if (!rack && !fireLit(w)) return null;
      const at = rack ? [r.x, r.y] : [w.camp.fire.x - 1.2, w.camp.fire.y];
      say(w, s, 'smoke'); return mkAct('smokeMeat', 'Smoking meat', g.id, ...sp(w, at[0], at[1]));
    }
    case 'scrape': return stock(w, 'rawHide') >= 1 ? mkAct('scrape', 'Scraping hides', g.id, ...sp(w, w.camp.pile.x + 1, w.camp.pile.y + 1)) : null;
    case 'process': {
      const it = (['carcB', 'carcA', 'carcJ'] as Item[]).find((k) => stock(w, k) >= 1); if (!it) return null;
      const b = w.camp.builds['butcher']; const at = b && b.built ? [b.x, b.y] : [w.camp.pile.x - 1.5, w.camp.pile.y];
      return mkAct('process', 'Butchering a Roukha', g.id, ...sp(w, at[0], at[1]), { item: it });
    }
    case 'explore': {
      if (!canGoFar()) return null;
      const f = frontier(w, s);
      if (!f) return block(w, g, 'Nothing left to explore nearby', 6, s);
      say(w, s, 'explore');
      return mkAct('explore', 'Exploring', g.id, f[0], f[1], { needBuddy: true });
    }
    case 'load': return w.boat.state === 'docked' && EXPORTS.some((k) => stock(w, k) >= 1) ? mkAct('load', 'Loading cargo onto the boat', g.id, w.camp.pile.x, w.camp.pile.y) : null;
    case 'unload': return Object.keys(w.boat.crate).length ? mkAct('unload', 'Hauling supplies from the boat', g.id, w.landing.x, w.landing.y) : null;
    case 'meetBoat': return w.boat.state === 'docked' ? mkAct('meetBoat', 'Meeting the boat (requisitions)', g.id, w.landing.x, w.landing.y) : null;
    case 'rescue': case 'treat': {
      const v = w.scouts.find((x) => x.id === g.target);
      if (!v || (g.kind === 'rescue' && v.status !== 'downed') || v.draggedBy >= 0) return null;
      if (!reachable(w, s, v.x, v.y)) return block(w, g, 'Cannot reach ' + v.name, 0.5, s);
      if (g.kind === 'rescue') say(w, s, 'rescue', { n: v.name });
      return mkAct(g.kind, g.kind === 'rescue' ? 'Rescuing ' + v.name : 'Treating ' + v.name, g.id, v.x, v.y, { target: v.id });
    }
    case 'escort': {
      const l = w.scouts.find((x) => x.id === g.target);
      if (!l || !l.act || !l.act.needBuddy || l.act.buddy >= 0 || !able(l)) return null;
      l.act.buddy = s.id; say(w, s, 'buddyYes');
      return mkAct('buddy', 'Going along with ' + l.name, '', l.x, l.y, { leader: l.id });
    }
  }
  return null;
}

/** An unexplored tile next to explored ground, within range of camp. */
function frontier(w: World, s: Scout): [number, number] | null {
  const n = w.map.n, ter = w.map.terrain, sn = w.map.seen; const [cx, cy] = campXY(w);
  const cands: { x: number; y: number; sc: number }[] = [];
  for (let y = 2; y < n - 2; y += 2) for (let x = 2; x < n - 2; x += 2) {
    const i = y * n + x; if (sn[i] === 1 || !PASSABLE[ter[i]]) continue;
    if (!(sn[i - 2] === 1 || sn[i + 2] === 1 || sn[i - 2 * n] === 1 || sn[i + 2 * n] === 1)) continue;
    const px = (x + 0.5) * CFG.TILE_M, py = (y + 0.5) * CFG.TILE_M; const dc = dist(px, py, cx, cy);
    if (dc > CFG.EXPLORE_MAX_M) continue;
    if (w.rookeries.some((r) => seen(w, r.x, r.y) && dist(px, py, r.x, r.y) < CFG.ROOKERY_GUARD_M + 15)) continue;
    cands.push({ x: px, y: py, sc: dc + dist(px, py, s.x, s.y) * 0.5 });
  }
  cands.sort((a, b) => a.sc - b.sc);
  for (const c of cands.slice(0, 4)) if (reachable(w, s, c.x, c.y)) return [c.x, c.y];
  return null;
}

// ---------- running an act ----------
export function runAct(w: World, s: Scout): void {
  const a = s.act as Act;
  // far work: wait at camp until a buddy joins
  if (a.needBuddy && a.step === 0 && a.buddy < 0) {
    if (a.n === 0) { const b = bestBuddy(w, s); say(w, s, 'buddyAsk', { n: b ? b.name : 'anyone' }); a.n = 1; }
    a.t++;
    s.thought = a.label + ' (waiting for a buddy)';
    if (a.t > 0.5 * TPH()) { say(w, s, 'noBuddy', {}, 'warn'); s.cool['far'] = w.tick + 1.5 * TPH(); endAct(w, s, 'no buddy'); }
    return;
  }
  if (a.needBuddy && a.n === 1) { a.t = 0; a.n = 2; s.thought = a.label; }
  const r = stepAct(w, s, a);
  if (s.act !== a) return;
  if (r === 'done') endAct(w, s);
  else if (r === 'fail') { s.failT = w.tick; if (a.goal) s.cool['goal:' + a.goal] = w.tick + 0.3 * TPH(); endAct(w, s, 'failed: ' + a.kind); }
}
function bestBuddy(w: World, s: Scout): Scout | null {
  const c = w.scouts.filter((x) => x !== s && x.status === 'ok').sort((a, b) => dist(a.x, a.y, s.x, s.y) - dist(b.x, b.y, s.x, s.y) || a.id - b.id);
  return c[0] || null;
}
type R = 'run' | 'done' | 'fail';
function go(w: World, s: Scout, x: number, y: number, mul = 1): number {
  if (buddyLagging(w, s)) { s.stillT = 0; return 1; }
  return moveTo(w, s, x, y, mul);
}

function stepAct(w: World, s: Scout, a: Act): R {
  const tph = TPH();
  switch (a.kind) {
    case 'idle': { if (go(w, s, a.tx, a.ty) < 0) { a.tx = s.x; a.ty = s.y; } return w.tick >= a.until ? 'done' : 'run'; }
    case 'unpack': {
      const m = go(w, s, a.tx, a.ty); if (m < 0) return 'fail'; if (m) return 'run';
      s.tag = ''; w.camp.packsDown++;
      for (const k in CFG.START_CRATES) invAdd(w.camp.stock, k as Item, (CFG.START_CRATES[k as Item] || 0) / CFG.SCOUTS_START);
      say(w, s, 'unpack'); return 'done';
    }
    case 'eat': {
      const carried = CFG.EAT_PREF.some((k) => invGet(s.carry, k) >= 1);
      if (!carried) { const m = go(w, s, a.tx, a.ty); if (m < 0) return 'fail'; if (m) return 'run'; }
      if (++a.t % 8) return 'run';
      const src = carried ? s.carry : w.camp.stock;
      const it = CFG.EAT_PREF.find((k) => invGet(src, k) >= 1);
      if (!it || s.needs.food >= 95) return a.n > 0 ? 'done' : 'fail';
      if (a.n === 0) say(w, s, 'eat');
      invAdd(src, it, -1); a.n++;
      s.needs.food = Math.min(100, s.needs.food + (CFG.FOOD_VALUE[it] || 0));
      invAdd(w.stats.eaten, it, 1);
      if (it === 'meal') { s.lastMeal = w.tick; if (rnd(w) < CFG.POISON_PER_MEAL * (1.5 - (bestCook(w)?.skills.cooking ?? 30) / 100) * tfx(s, 'sick')) fallSick(w, s, 'poisoning'); }
      return 'run';
    }
    case 'drink': {
      const m = go(w, s, a.tx, a.ty); if (m < 0) return 'fail'; if (m) return 'run';
      if (++a.t % 5) return 'run';
      if (a.mode === 'cask') { if (stock(w, 'water') < 1 || s.needs.water >= 95) return 'done'; invAdd(w.camp.stock, 'water', -1); s.needs.water = Math.min(100, s.needs.water + CFG.WATER_PER_UNIT); }
      else { s.needs.water = Math.min(100, s.needs.water + 20); if (rnd(w) < CFG.FEVER_PER_STREAM_DRINK * tfx(s, 'sick')) fallSick(w, s, 'fever'); if (s.needs.water >= 99) return 'done'; }
      w.stats.drank++; return 'run';
    }
    case 'sleep': {
      if (!s.sleeping) { const m = go(w, s, a.tx, a.ty); if (m < 0) { a.tx = s.x; a.ty = s.y; } if (m > 0) return 'run'; s.sleeping = true; if (a.n === 0) { say(w, s, 'sleep'); a.n = 1; } }
      s.posture = 'crouch';
      const h = hourOf(w.tick);
      const wake = CFG.WAKE_H + wakeOffset(s);
      if (h >= wake && h < 12 && s.needs.rest > 60) { s.sleeping = false; say(w, s, 'wake'); return 'done'; }
      if (!isDark(h) && h >= 12 && s.needs.rest > 85) { s.sleeping = false; return 'done'; }
      return 'run';
    }
    case 'warm': { const m = go(w, s, a.tx, a.ty); if (m < 0) return 'fail'; if (m) return 'run'; return s.needs.warmth >= 90 || ++a.t > 0.6 * tph ? 'done' : 'run'; }
    case 'maint': {
      const m = go(w, s, a.tx, a.ty); if (m < 0) return 'fail'; if (m) return 'run';
      if (a.t === 0) say(w, s, 'maint');
      if (!work(w, s, CFG.MAINT_H)) return 'run';
      for (const gun of s.guns) gun.cond = 100; s.jam = 0; return 'done';
    }
    case 'leisure': {
      const g = w.gatherings.find((x) => x.id === a.gid); if (!g) return 'done';
      const def = CFG.ACTIVITIES.find((d) => d.id === a.actId) as ActivityDef;
      const m = go(w, s, a.tx, a.ty); if (m < 0) return 'fail'; if (m) return 'run';
      s.posture = def.id === 'workout' || def.id === 'spar' ? 'stand' : 'crouch';
      if (!g.active) {
        if (++a.t > CFG.SOCIAL_WAIT_H * tph) { say(w, s, 'socialFail'); s.cool[def.id] = w.tick + 3 * tph; return 'fail'; }
        s.thought = def.label + ' (waiting for company)'; return 'run';
      }
      s.thought = def.label;
      for (const n in def.gain) { const nn = n as NeedId; s.needs[nn] = Math.min(100, s.needs[nn] + (def.gain[nn] || 0) / tph); }
      if (def.id === 'marks') skillUp(s, 'shooting', 3 / tph);
      if (def.id === 'spar' || def.id === 'workout') s.posture = 'stand';
      if (def.id === 'nap') { s.sleeping = true; }
      if (def.drink) { s.lastDrink = w.tick; if (def.id === 'rum') { const d = dayOf(w.tick); s.hangover = (hourOf(w.tick) < CFG.HANGOVER_UNTIL_H ? d - 1 : d) * CFG.DAY_TICKS + CFG.HANGOVER_UNTIL_H * TPH(); } }
      // cards are played for stakes: a hand every so often moves a little cash between purses
      if (def.id === 'cards' && rnd(w) < 2 / TPH()) { const g = w.gatherings.find((x) => x.id === a.gid); const others = g ? g.members.filter((id) => id !== s.id) : []; if (others.length) { const o = w.scouts.find((x) => x.id === others[rint(w, 0, others.length - 1)]); const st = rint(w, CFG.CARDS_STAKE[0], CFG.CARDS_STAKE[1]); if (o && o.purse >= st) { o.purse -= st; s.purse += st; } } }
      s.lastLeisure = w.tick; w.stats.leisure[def.id] = (w.stats.leisure[def.id] || 0) + 1 / tph;
      if (w.tick >= g.until) { s.morale = Math.min(100, s.morale + (def.morale || 0)); return 'done'; }
      return 'run';
    }
    case 'watch': {
      if (go(w, s, a.tx, a.ty) < 0) { a.tx = s.x; a.ty = s.y; }
      s.posture = 'crouch'; s.sleeping = false;
      return w.tick >= a.until || w.plan.watch.id !== s.id ? 'done' : 'run';
    }
    case 'build': {
      const b: Build = a.mode === 'fire' ? w.camp.fire : a.mode === 'latrine' ? w.camp.latrine : w.camp.builds[a.mode];
      const m = go(w, s, a.tx, a.ty); if (m < 0) return 'fail'; if (m) return 'run';
      if (b.built) return 'done';
      const def = CFG.BUILDINGS.find((x) => x.id === a.mode);
      if (b.progress === 0) {
        const wood = a.mode === 'fire' ? CFG.FIRE_BUILD_WOOD : def ? def.wood : 0;
        if (stock(w, 'wood') < wood) return 'fail';
        invAdd(w.camp.stock, 'wood', -wood);
      }
      b.progress += workMul(s); s.posture = 'crouch';
      if (b.progress >= (def ? def.hours : CFG.BUILD_H[a.mode]) * tph) {
        b.built = true; b.claim = -1;
        if (a.mode === 'fire') { w.camp.fire.fuel = CFG.FIRE_MAX_FUEL * 0.6; if (w.camp.readyTick.fire < 0) w.camp.readyTick.fire = w.tick; }
        if (a.mode === 'latrine' && w.camp.readyTick.latrine < 0) w.camp.readyTick.latrine = w.tick;
        addLog(w, s.name, 'finished the ' + (def ? def.label.toLowerCase() : a.mode === 'fire' ? 'campfire' : 'latrine'), 'event');
        return 'done';
      }
      return 'run';
    }
    case 'chop': case 'fell': {
      const t = w.trees.find((x) => x.id === a.target); if (!t) return 'fail';
      if (a.step === 0) { const m = go(w, s, t.x, t.y); if (m < 0) return 'fail'; if (m) return 'run'; a.step = 1; }
      if (a.step === 1) {
        const left = a.kind === 'chop' ? t.wood : t.timber;
        if (left < 1) { say(w, s, 'bare'); return 'fail'; }  // re-validated before working: never mime work
        if (!work(w, s, a.kind === 'chop' ? CFG.CHOP_H : t.felled ? 0.4 : CFG.FELL_H)) return 'run';
        if (a.kind === 'fell' && !t.felled) { t.felled = true; addLog(w, s.name, 'felled a tree', 'event'); }
        const k: Item = a.kind === 'chop' ? 'wood' : 'timber';
        const take = Math.min(a.kind === 'chop' ? t.wood : t.timber, carryRoom(s, k));
        if (take < 1) return 'fail';
        if (a.kind === 'chop') t.wood -= take; else t.timber -= take;
        invAdd(s.carry, k, take);
        const b = partner(w, s);
        if (b) { const more = Math.min(a.kind === 'chop' ? t.wood : t.timber, carryRoom(b, k)); if (more >= 1) { if (a.kind === 'chop') t.wood -= more; else t.timber -= more; invAdd(b.carry, k, more); } }
        t.claim = -1; a.step = 2;
      }
      return haulHome(w, s);
    }
    case 'forage': {
      const b = w.bushes.find((x) => x.id === a.target); if (!b) return 'fail';
      if (a.step === 0) { const m = go(w, s, b.x, b.y); if (m < 0) return 'fail'; if (m) return 'run'; a.step = 1; }
      if (a.step === 1) {
        if (b.berries < 1) { say(w, s, 'bare'); return 'fail'; }
        if (!work(w, s, CFG.FORAGE_H)) return 'run';
        const fd = CFG.FORAGE[b.kind]; const take = Math.min(b.berries, fd.take); b.berries -= take; invAdd(s.carry, fd.item, take);
        if (fd.item === 'berries' && rnd(w) < CFG.LEAF_CHANCE) invAdd(s.carry, 'leaf', 1);
        b.claim = -1; a.step = 2;
      }
      return haulHome(w, s);
    }
    case 'fish': {
      const f = w.fish.find((x) => x.id === a.target); if (!f) return 'fail';
      if (a.step === 0) { const m = go(w, s, f.x, f.y); if (m < 0) return 'fail'; if (m) return 'run'; a.step = 1; }
      if (a.step === 1) {
        if (a.mode === 'set') { if (!work(w, s, CFG.SET_TRAP_H)) return 'run'; f.trap = true; f.claim = -1; addLog(w, s.name, 'set a fish trap', 'event'); return 'done'; }
        if (f.fish < 1) return 'fail';
        if (!work(w, s, CFG.FISH_H)) return 'run';
        const n = Math.min(f.fish, 1 + Math.floor(rnd(w) * 3)); f.fish -= n; invAdd(s.carry, 'rawFish', n);
        f.claim = -1; a.step = 2;
      }
      return haulHome(w, s);
    }
    case 'fetchWater': {
      if (a.step === 0) { const m = go(w, s, a.tx, a.ty); if (m < 0) return 'fail'; if (m) return 'run'; a.step = 1; }
      if (a.step === 1) { if (!work(w, s, CFG.FILL_H)) return 'run'; s.needs.water = 100; invAdd(s.carry, 'water', carryRoom(s, 'water')); const b = partner(w, s); if (b) { b.needs.water = 100; invAdd(b.carry, 'water', carryRoom(b, 'water')); } a.step = 2; }
      return haulHome(w, s);
    }
    case 'fuel': {
      const m = go(w, s, a.tx, a.ty); if (m < 0) return 'fail'; if (m) return 'run';
      if (++a.t < 10) return 'run';
      const add = Math.min(stock(w, 'wood'), Math.floor(CFG.FIRE_MAX_FUEL - w.camp.fire.fuel));
      if (add >= 1) { invAdd(w.camp.stock, 'wood', -add); w.camp.fire.fuel += add; }
      return 'done';
    }
    case 'cook': case 'smokeMeat': {
      const m = go(w, s, a.tx, a.ty); if (m < 0) return 'fail'; if (m) return 'run';
      const smoke = a.kind === 'smokeMeat';
      if (!work(w, s, smoke ? CFG.SMOKE_H / (built(w, 'racks') ? CFG.SMOKE_RACK_MUL : 1) : CFG.COOK_H, 'cooking')) return 'run';
      let n = smoke ? CFG.SMOKE_BATCH : CFG.COOK_BATCH;
      const bonus = !smoke && s.skills.cooking > 60 ? 1 : 0;  // a good cook stretches the pot
      for (const k of (smoke ? ['rawMeat'] : ['rawMeat', 'rawFish']) as Item[]) {
        const u = Math.min(n, Math.floor(stock(w, k))); if (u <= 0) continue;
        invAdd(w.camp.stock, k, -u); invAdd(w.camp.stock, smoke ? 'smoked' : 'meal', u + Math.min(bonus, u)); n -= u;
      }
      return 'done';
    }
    case 'scrape': {
      const m = go(w, s, a.tx, a.ty); if (m < 0) return 'fail'; if (m) return 'run';
      if (!work(w, s, CFG.SCRAPE_H / (built(w, 'racks') ? 1.5 : 1))) return 'run';
      const u = Math.min(2, Math.floor(stock(w, 'rawHide'))); if (u > 0) { invAdd(w.camp.stock, 'rawHide', -u); invAdd(w.camp.stock, 'hide', u); }
      return 'done';
    }
    case 'process': {
      const m = go(w, s, a.tx, a.ty); if (m < 0) return 'fail'; if (m) return 'run';
      const it = a.item as Item; if (stock(w, it) < 1) return 'fail';
      w.scentBoost = Math.max(w.scentBoost, CFG.PROCESS_SCENT);  // processing smells: draws Roukha
      const hours = (CFG.PROCESS_H / (built(w, 'butcher') ? 1.5 : 1)) * (1.3 - s.skills.butchering / 200);
      if (!work(w, s, hours, 'butchering')) return 'run';
      invAdd(w.camp.stock, it, -1);
      const age = (it === 'carcB' ? 'B' : it === 'carcA' ? 'A' : 'J') as AgeClass;
      const mul = AGE[age].yieldMul * (0.85 + s.skills.butchering / 400) * (built(w, 'butcher') ? 1.1 : 1);
      for (const k in CFG.ROUKHA_PARTS) invAdd(w.camp.stock, k as Item, Math.max(1, Math.round((CFG.ROUKHA_PARTS[k as Item] || 0) * mul)));
      invAdd(w.camp.stock, AGE[age].beak, 1);
      addLog(w, s.name, 'processed a ' + AGE[age].label + ' Roukha: ' + ITEM_LABEL[AGE[age].beak] + ', feathers, hide, talons, meat', 'event');
      return 'done';
    }
    case 'loot': return lootStep(w, s, a);
    case 'hunt': return huntStep(w, s, a);
    case 'rhunt': return rhuntStep(w, s, a);
    case 'explore': { const m = go(w, s, a.tx, a.ty); if (m < 0) return 'fail'; return m === 0 || seen(w, a.tx, a.ty) ? 'done' : 'run'; }
    case 'buddy': {
      const l = w.scouts.find((x) => x.id === a.leader);
      if (!l || !l.act || l.act.buddy !== s.id || !able(l)) return 'done';
      if (dist(s.x, s.y, l.x, l.y) > CFG.BUDDY_KEEP_M * 0.6) { if (moveTo(w, s, l.x, l.y, 1.08) < 0) return 'fail'; }
      else { s.posture = 'crouch'; s.stillT = 0; }
      s.thought = 'With ' + l.name + ': ' + l.act.label.toLowerCase();
      return 'run';
    }
    case 'load': {
      if (a.step === 0) {
        const m = go(w, s, w.camp.pile.x, w.camp.pile.y); if (m < 0) return 'fail'; if (m) return 'run';
        if (w.boat.state !== 'docked') return 'done';
        for (const k of EXPORTS) { const n = Math.min(Math.floor(stock(w, k)), carryRoom(s, k)); if (n >= 1) { invAdd(w.camp.stock, k, -n); invAdd(s.carry, k, n); } }
        if (!Object.keys(s.carry).length) return 'done';
        a.step = 1;
      }
      if (a.step === 1) {
        const m = go(w, s, w.landing.x, w.landing.y); if (m < 0) return 'fail'; if (m) return 'run';
        if (w.boat.state === 'docked') { for (const k in s.carry) invAdd(w.boat.cargo, k as Item, s.carry[k as Item] || 0); s.carry = {}; return 'done'; }
        a.step = 2;
      }
      return haulHome(w, s);
    }
    case 'unload': {
      if (a.step === 0) {
        const m = go(w, s, w.landing.x, w.landing.y); if (m < 0) return 'fail'; if (m) return 'run';
        for (const k in w.boat.crate) { const kk = k as Item; const have = invGet(w.boat.crate, kk); const n = Math.min(have, Math.max(carryRoom(s, kk), have < 1 ? have : 0)); if (n > 0) { invAdd(w.boat.crate, kk, -n); invAdd(s.carry, kk, n); } }
        a.step = 2;
      }
      return haulHome(w, s);
    }
    case 'meetBoat': {
      const m = go(w, s, w.landing.x, w.landing.y); if (m < 0) return 'fail'; if (m) return 'run';
      if (w.boat.state === 'docked' && !w.boat.pending) requisition(w, s);
      return 'done';
    }
    case 'rescue': return rescueStep(w, s, a);
    case 'treat': {
      const v = w.scouts.find((x) => x.id === a.target); if (!v || v.status === 'dead') return 'fail';
      const m = go(w, s, v.x, v.y); if (m < 0) return 'fail'; if (m) return 'run';
      if (a.n === 0) { say(w, s, 'treat', { n: v.name }); a.n = 1; }
      if (!work(w, s, CFG.TREAT_H * (1.4 - s.skills.medicine / 120), 'medicine')) return 'run';
      if (stock(w, 'meds') >= 1) invAdd(w.camp.stock, 'meds', -1); else if (stock(w, 'herbs') >= CFG.HERBS_PER_MED) invAdd(w.camp.stock, 'herbs', -CFG.HERBS_PER_MED);
      v.sick = Math.floor(v.sick * 0.25); v.hp = Math.min(v.maxHp, v.hp + 10 + s.skills.medicine / 10); v.medicUntil = w.tick + CFG.MEDIC_BOOST_H * TPH();
      return 'done';
    }
  }
  return 'fail';
}

function haulHome(w: World, s: Scout): R {
  const tx = s.carry.water ? w.camp.cask.x : w.camp.pile.x, ty = s.carry.water ? w.camp.cask.y : w.camp.pile.y;
  const m = go(w, s, tx, ty); if (m < 0) return 'fail'; if (m) return 'run';
  depositAll(w, s);
  const b = partner(w, s); if (b && dist(b.x, b.y, s.x, s.y) < 8) depositAll(w, b);
  if (w.camp.readyTick.wood < 0 && stock(w, 'wood') >= CFG.WOOD_TARGET / 2) w.camp.readyTick.wood = w.tick;
  return 'done';
}

function rescueStep(w: World, s: Scout, a: Act): R {
  const v = w.scouts.find((x) => x.id === a.target); if (!v || v.status === 'dead') return 'fail';
  if (a.step === 0) {
    if (v.status !== 'downed') return 'done';
    const m = moveTo(w, s, v.x, v.y, 1.3); if (m < 0) return 'fail'; if (m) return 'run';
    if (v.draggedBy >= 0 && v.draggedBy !== s.id) return 'fail';
    v.draggedBy = s.id; a.step = 1;
  }
  if (a.step === 1) {
    const m = moveTo(w, s, w.camp.treat.x, w.camp.treat.y, CFG.DRAG_MS / CFG.WALK_MS); if (m < 0) return 'fail';
    v.x = s.x - s.fx * 0.9; v.y = s.y - s.fy * 0.9;
    if (m) return 'run';
    a.step = 2; a.t = 0; say(w, s, 'treat', { n: v.name });
  }
  v.stabilized = true;  // Medicine: wounds stop worsening once he's being worked on
  if (!work(w, s, CFG.TREAT_H * 2 * (1.4 - s.skills.medicine / 120), 'medicine')) return 'run';
  let meds = stock(w, 'meds') >= 1; if (meds) invAdd(w.camp.stock, 'meds', -1); else if (stock(w, 'herbs') >= CFG.HERBS_PER_MED) { invAdd(w.camp.stock, 'herbs', -CFG.HERBS_PER_MED); meds = true; }
  v.status = 'recovering'; v.draggedBy = -1; v.recover = CFG.RECOVER_H * TPH() * (meds ? 1 : 1.8) * (1 + v.wound / 100);
  v.maxHp = Math.max(40, v.maxHp - Math.round(v.wound * CFG.WOUND_MAXHP_LOSS)); v.hp = Math.max(v.hp, 25);
  if (FEATURES.injuries && rnd(w) < v.wound * CFG.INJURY_PER_WOUND) { const opts = Object.keys(CFG.INJURIES).filter((k) => v.injuries.indexOf(k) < 0); if (opts.length) { const k = opts[rint(w, 0, opts.length - 1)]; v.injuries.push(k); addLog(w, v.name, 'will carry this one: ' + CFG.INJURIES[k].label.toLowerCase(), 'event'); } }
  v.wound = 0; v.medicUntil = w.tick + CFG.MEDIC_BOOST_H * TPH();
  w.stats.rescues++; addLog(w, s.name, 'got ' + v.name + ' back to camp and patched him up' + (meds ? '' : ' (no meds left)'), 'event');
  return 'done';
}

function lootStep(w: World, s: Scout, a: Act): R {
  const c = w.carcasses.find((x) => x.id === a.target);
  if (a.step === 0) {
    if (!c) return 'fail';
    const m = go(w, s, c.x, c.y); if (m < 0) return 'fail'; if (m) return 'run';
    if (c.kind === 'deer') a.mode = 'deer';
    else {
      // the party leader chooses: drag the whole bird home, or take only the head (the beak)
      const h = hourOf(w.tick);
      const danger = w.birds.some((b) => b.state !== 'dead' && dist(b.x, b.y, c.x, c.y) < CFG.HEAD_ONLY_DANGER_M);
      const late = h >= CFG.HEAD_ONLY_DUSK_H || isDark(h);
      a.mode = distCamp(w, c.x, c.y) > CFG.HEAD_ONLY_DIST_M || danger || late ? 'head' : 'drag';
      say(w, s, a.mode === 'head' ? 'headOnly' : 'drag');
    }
    a.step = 1;
  }
  if (a.step === 1) {
    if (!c) return 'fail';
    const hours = a.mode === 'deer' ? CFG.BUTCHER_H * (1.3 - s.skills.butchering / 200) : a.mode === 'head' ? CFG.HEAD_CUT_H : 0.1;
    if (!work(w, s, hours, a.mode === 'deer' ? 'butchering' : undefined)) return 'run';
    if (a.mode === 'deer') {
      let meat = Math.round(CFG.DEER_MEAT * (0.85 + s.skills.butchering / 400));
      invAdd(s.carry, 'rawHide', 1);
      const takeM = Math.min(meat, carryRoom(s, 'rawMeat')); invAdd(s.carry, 'rawMeat', takeM); meat -= takeM;
      const b = partner(w, s); if (b && meat > 0) invAdd(b.carry, 'rawMeat', Math.min(meat, carryRoom(b, 'rawMeat')));
    } else if (a.mode === 'head') invAdd(s.carry, c.cracked ? 'beakCr' : AGE[c.age].beak, 1);
    else { invAdd(s.carry, c.cracked ? 'carcJ' : AGE[c.age].carc, 1); s.carcassMode = 'drag'; }
    w.carcasses = w.carcasses.filter((x) => x !== c);
    a.step = 2;
  }
  return haulHome(w, s);
}

function huntStep(w: World, s: Scout, a: Act): R {
  if (w.tick > a.until) { addLog(w, s.name, 'gave up the hunt', 'event'); return 'fail'; }
  const d = w.deer.find((x) => x.id === a.target);
  if (!d) return 'fail';
  if (d.state === 'dead') {
    const c = w.carcasses.find((x) => x.kind === 'deer' && dist(x.x, x.y, d.x, d.y) < 3 && x.claim < 0);
    if (!c) return 'fail';
    c.claim = s.id; a.kind = 'loot'; a.target = c.id; a.step = 0; a.label = 'Butchering a deer'; return 'run';
  }
  const dd = dist(s.x, s.y, d.x, d.y);
  if (dd > CFG.HUNT_SHOT_M || !HOOKS.los(w, s.x, s.y, d.x, d.y)) { const m = go(w, s, d.x, d.y, dd > 60 ? 1 : 0.6); if (m < 0) return 'fail'; s.aimT = 0; return 'run'; }
  HOOKS.shoot(w, s, d.id, d.x, d.y, true);
  const b = partner(w, s); if (b && b.act && b.act.kind === 'buddy' && HOOKS.los(w, b.x, b.y, d.x, d.y)) HOOKS.shoot(w, b, d.id, d.x, d.y, true);
  return 'run';
}

function rhuntStep(w: World, s: Scout, a: Act): R {
  if (w.tick > a.until) { addLog(w, s.name, 'called off the Roukha hunt', 'event'); return 'fail'; }
  const it = w.intel.filter((i) => i.pack === a.target).sort((p, q) => q.t - p.t)[0];
  if (it) { a.tx = it.x; a.ty = it.y; }
  const c = w.carcasses.find((x) => x.kind === 'bird' && x.claim < 0 && dist(x.x, x.y, s.x, s.y) < 40);
  const vis = w.birds.filter((b) => b.state !== 'dead' && b.pack === a.target && dist(b.x, b.y, s.x, s.y) < CFG.HUNT_SHOOT_M + 15 && HOOKS.los(w, s.x, s.y, b.x, b.y));
  if (!vis.length && c) { c.claim = s.id; a.kind = 'loot'; a.target = c.id; a.step = 0; a.label = 'Recovering a Roukha carcass'; return 'run'; }
  if (vis.length) {
    vis.sort((p, q) => dist(p.x, p.y, s.x, s.y) - dist(q.x, q.y, s.x, s.y) || p.id - q.id);
    const b = vis[0];
    if (dist(b.x, b.y, s.x, s.y) > CFG.HUNT_SHOOT_M) { if (go(w, s, b.x, b.y, 0.6) < 0) return 'fail'; return 'run'; }
    HOOKS.shoot(w, s, b.id, b.x, b.y, true);
    const p = partner(w, s); if (p && p.act && p.act.kind === 'buddy') HOOKS.shoot(w, p, b.id, b.x, b.y, true);
    return 'run';
  }
  const m = go(w, s, a.tx, a.ty, 0.8); if (m < 0) return 'fail';
  if (m === 0) { if (!w.birds.some((b) => b.pack === a.target && b.state !== 'dead')) return 'fail'; if (++a.t > 0.6 * TPH()) return 'fail'; }
  return 'run';
}

/** Hooks filled in by combat.ts so this file stays free of combat internals. */
export const HOOKS = {
  los: (w: World, ax: number, ay: number, bx: number, by: number): boolean => { void w; void ax; void ay; void bx; void by; return true; },
  shoot: (w: World, s: Scout, id: number, x: number, y: number, hunting: boolean): void => { void w; void s; void id; void x; void y; void hunting; },
};

// ---------- the commander's camp plan ----------
export function foodPoints(w: World): number {
  const st = w.camp.stock;
  return invGet(st, 'meal') * 40 + invGet(st, 'smoked') * 32 + invGet(st, 'berries') * 9 + invGet(st, 'ration') * 35 + (invGet(st, 'rawMeat') + invGet(st, 'rawFish')) * 36;
}
export function planTick(w: World): void {
  const c = commander(w);
  if (!c) { w.plan.goals = []; return; }
  if (w.plan.commander !== c.id) {
    const prev = w.scouts.find((x) => x.id === w.plan.commander);
    if (prev) say(w, c, 'command', { n: prev.name }, 'event');
    w.plan.commander = c.id;
  }
  if (!w.camp.sited) siteCamp(w, c);
  const G: Goal[] = [];
  const old: Record<string, Goal> = {}; for (const g of w.plan.goals) old[g.id] = g;
  const add = (id: string, kind: string, pri: number, slots: number, label: string, target?: number): void => {
    if (pri <= 0 || slots <= 0) return;
    const o = old[id];
    G.push({ id, kind, pri, slots, label, blockedUntil: o ? o.blockedUntil : 0, reason: o ? o.reason : '', target });
  };
  const alive = w.scouts.filter(able).length;
  const st = w.camp.stock; const wood = invGet(st, 'wood'); const h = hourOf(w.tick);
  if (!w.camp.fire.built) add('fire', 'build', 2.9, 1, 'Build the campfire');
  if (w.camp.fire.built && w.camp.fire.fuel < CFG.FIRE_REFUEL_BELOW && wood >= 1) add('fuel', 'fuel', 3.0, 1, 'Keep the fire going');
  const nightBurn = CFG.FIRE_BURN_H * 12 + 4;
  const woodNeed = Math.min(1.5, 1 - wood / CFG.WOOD_TARGET + (h >= 14 && wood < nightBurn ? 0.5 : 0));
  if (woodNeed > 0) add('wood', 'wood', 1.2 + 1.4 * woodNeed + (!w.camp.fire.built ? 0.6 : 0), woodNeed > 0.5 ? 3 : 2, 'Firewood ' + Math.floor(wood) + '/' + CFG.WOOD_TARGET);
  if (!w.camp.latrine.built && w.camp.packsDown > 0) add('latrine', 'build', 2.3, 1, 'Dig the latrine');
  const water = invGet(st, 'water');
  if (water < CFG.WATER_TARGET) add('water', 'water', 1.3 + 1.2 * (1 - water / CFG.WATER_TARGET), 1, 'Fill the water cask ' + Math.floor(water) + '/' + CFG.WATER_TARGET);
  const fp = foodPoints(w), ft = Math.max(1, alive) * CFG.FOOD_PER_DAY * CFG.FOOD_DAYS_TARGET; const fneed = clamp(1 - fp / ft, 0, 1);
  if (fneed > 0) {
    add('forage', 'forage', 1.2 + 1.6 * fneed, fneed > 0.5 ? 2 : 1, 'Forage for food');
    if (w.fish.some((f) => f.trap && f.fish >= 2)) add('fish', 'fish', 1.1 + 1.5 * fneed, 1, 'Check the fish traps');
    if (w.fish.filter((f) => f.trap).length < CFG.TRAPS_MAX && w.fish.some((f) => !f.trap && seen(w, f.x, f.y) && dist(f.x, f.y, w.camp.x, w.camp.y) < CFG.FORAGE_MAX_M)) add('setTrap', 'fish', 1.0, 1, 'Set fish traps');
    if (w.bushes.some((b) => (b.kind === 'herbs' || b.kind === 'leaf') && b.berries >= 2 && seen(w, b.x, b.y) && dist(b.x, b.y, w.camp.x, w.camp.y) < CFG.FORAGE_MAX_M)) add('herbs', 'forage', 0.6 + (stock(w, 'meds') < 2 ? 0.6 : 0), 1, 'Gather herbs and leaf');
    if (h < 15) add('hunt', 'hunt', 1.0 + 1.6 * fneed, 1, 'Hunt deer');
  }
  const raw = stock(w, 'rawMeat') + stock(w, 'rawFish');
  if (raw >= 1 && fireLit(w)) add('cook', 'cook', 1.4 + Math.min(1, raw / 10) + (invGet(st, 'meal') < alive ? 0.6 : 0), 1, 'Cook raw food');
  if (FEATURES.smoking && stock(w, 'rawMeat') >= 6 && (fireLit(w) || built(w, 'racks'))) add('smoke', 'smoke', 1.5, 1, 'Smoke meat so it keeps');
  if (stock(w, 'rawHide') >= 1) add('scrape', 'scrape', 0.9, 1, 'Scrape hides');
  if ((['carcJ', 'carcA', 'carcB'] as Item[]).some((k) => stock(w, k) >= 1)) add('process', 'process', 1.9, 1, 'Process a Roukha carcass');
  for (const cc of w.carcasses) if (cc.claim < 0 && seen(w, cc.x, cc.y) && distCamp(w, cc.x, cc.y) < CFG.EXPLORE_MAX_M) add('loot:' + cc.id, 'loot', cc.kind === 'bird' ? 2.0 : 1.7, 1, cc.kind === 'bird' ? 'Recover Roukha carcass' : 'Butcher deer', cc.id);
  for (const v of w.scouts) {
    if (v.status === 'downed' && v.draggedBy < 0) add('rescue:' + v.id, 'rescue', 3.6, 1, 'Rescue ' + v.name, v.id);
    if (v.status === 'ok' && (v.sick > CFG.SICK_H * TPH() * 0.3 || (v.hp < v.maxHp * CFG.TREAT_BELOW_HP && v.medicUntil < w.tick))) add('treat:' + v.id, 'treat', 1.6, 1, 'Treat ' + v.name, v.id);
    // a man too broken to work the island goes home on the next boat
    if (v.status === 'ok' && !v.homeBound && (v.injuries.length >= CFG.INVALID_INJURIES || v.maxHp < CFG.INVALID_MAXHP)) { v.homeBound = true; addLog(w, commander(w)?.name || 'Camp', `${v.name} is going home on the next boat; we'll need a new man`, 'event'); }
  }
  if (w.boat.state === 'docked') {
    if (!w.boat.pending) add('meetBoat', 'meetBoat', 3.4, 1, 'Boss meets the boat');
    if (EXPORTS.some((k) => stock(w, k) >= 1)) add('load', 'load', w.boat.state === 'docked' ? 3.2 : 2.5, 3, 'Load exports');
  }
  if (Object.keys(w.boat.crate).length) add('unload', 'unload', invGet(w.boat.crate, 'ration') > 0 ? 3.3 : 2.6, 2, 'Haul supplies up from the landing');
  const basics = w.camp.fire.built && wood >= CFG.WOOD_TARGET * 0.4 && fneed < 0.6 && water >= 4;
  if (basics) {
    if (FEATURES.timber) add('timber', 'timber', 1.0, 2, 'Fell timber for export');
    if (h < 15 && w.intel.some((i) => w.tick - i.t < CFG.INTEL_LIFE_H * TPH())) add('roukhaHunt', 'roukhaHunt', 1.25, 1, 'Hunt Roukha (beaks pay)');
    // building proposals: the Boss proposes, approveBuild() decides (auto-yes in the zero-input sim)
    if (FEATURES.builds && !w.pendingBuild && wood >= CFG.WOOD_TARGET + CFG.BUILD_SURPLUS_WOOD) {
      const def = CFG.BUILDINGS.find((d) => !w.camp.builds[d.id].built && w.camp.proposals.indexOf(d.id) < 0);
      if (def) { w.camp.proposals.push(def.id); if (approveBuild(w, def.id)) { w.pendingBuild = def.id; addLog(w, c.name, 'Proposes a ' + def.label.toLowerCase() + '. Approved.', 'event'); } }
    }
  }
  if (w.pendingBuild) {
    const b = w.camp.builds[w.pendingBuild]; const def = CFG.BUILDINGS.find((d) => d.id === w.pendingBuild);
    if (b.built) w.pendingBuild = ''; else if (def) add(def.id, 'build', 1.15, 1, 'Build: ' + def.label);
  }
  const blockedForKnowledge = G.some((g) => g.blockedUntil > w.tick && /No |known|seen/.test(g.reason));
  if (w.camp.sited) add('explore', 'explore', blockedForKnowledge ? 1.5 : 0.75, 2, 'Explore the island');
  for (const s of w.scouts) if (s.act && s.act.needBuddy && s.act.buddy < 0 && able(s)) add('escort:' + s.id, 'escort', 3.1, 1, 'Go with ' + s.name, s.id);
  w.plan.goals = G.sort((a, b) => b.pri - a.pri);
  watchTick(w, c);
}
/** Approval hook for the later player layer. Zero-input sim: auto-approve. */
export function approveBuild(w: World, id: string): boolean { void w; void id; return true; }

function watchTick(w: World, c: Scout): void {
  const h = hourOf(w.tick);
  const watchTime = w.camp.fire.built && (h >= 20.5 || h < 5.5);
  if (!watchTime) { w.plan.watch.id = -1; return; }
  const cur = w.scouts.find((x) => x.id === w.plan.watch.id);
  if (cur && able(cur) && w.tick < w.plan.watch.until && ((cur.act && cur.act.kind === 'watch') || cur.combat)) return;
  const pool = w.scouts.filter((x) => x.status === 'ok' && !x.combat && x.id !== w.plan.watch.id && !(x.act && (x.act.kind === 'rescue' || x.act.kind === 'treat')));
  if (!pool.length) { if (!(cur && able(cur))) w.plan.watch.id = -1; return; }
  pool.sort((a, b) => b.needs.rest - a.needs.rest || a.id - b.id);
  const s = pool[0];
  endAct(w, s);
  const tw = built(w, 'tower') ? w.camp.builds['tower'] : null;
  const p = tw ? [tw.x, tw.y] : nearestPassable(w, w.camp.fire.x + 5, w.camp.fire.y - 3, 4) || [w.camp.fire.x, w.camp.fire.y];
  w.plan.watch = { id: s.id, until: w.tick + CFG.WATCH_SHIFT_H * TPH() };
  if (c !== s) say(w, c, 'watchAssign', { n: s.name });
  startAct(w, s, mkAct('watch', 'On night watch', '', p[0], p[1], { until: w.plan.watch.until }));
  say(w, s, 'watch');
}

/** Picks the camp site: a big known tree near fresh water, sheltered from the wind, not on the beach. */
export function siteCamp(w: World, c: Scout): void {
  let best: { x: number; y: number; id: number } | null = null, bs = -1e9;
  const from = tileOf(w, w.landing.x, w.landing.y);
  const cands = w.trees.filter((t) => t.size >= 3 && seen(w, t.x, t.y) && dist(t.x, t.y, w.landing.x, w.landing.y) < 140);
  const scored = cands.map((t) => {
    let wd = 1e9; for (const i of w.waterPts) { const [x, y] = tileCenter(w, i); const d = dist(x, y, t.x, t.y); if (d < wd) wd = d; }
    let shelter = 0; for (let k = 4; k <= 20; k += 4) if (terrainAt(w, t.x - w.wind.x * k, t.y - w.wind.y * k) === 3) shelter++;
    let open = 0; for (const [ox, oy] of [[4, 0], [-4, 0], [0, 4], [0, -4], [4, 4], [-4, -4]]) { const tt = terrainAt(w, t.x + ox, t.y + oy); if (PASSABLE[tt] && tt !== 3) open++; }
    const dl = dist(t.x, t.y, w.landing.x, w.landing.y);
    // room for the camp: bedrolls, fire and builds need dry open ground, not a pond edge
    let wet = 0; for (let oy = -8; oy <= 12; oy += 2) for (let ox = -8; ox <= 12; ox += 2) if (!PASSABLE[terrainAt(w, t.x + ox, t.y + oy)] || terrainAt(w, t.x + ox, t.y + oy) === 6) wet++;
    return { t, sc: -wet * CFG.CAMP_WET_PENALTY - (wd < CFG.CAMP_MIN_WATER_M ? 15 : 0) - Math.min(wd, 120) * 0.6 + shelter * 3 + open * 2 - Math.abs(dl - 50) * 0.25 - (terrainAt(w, t.x, t.y) === 1 ? 20 : 0) };
  }).sort((a, b) => b.sc - a.sc || a.t.id - b.t.id);
  for (const k of scored.slice(0, 8)) if (findPath(w, from, tileOf(w, k.t.x, k.t.y))) { best = { x: k.t.x, y: k.t.y, id: k.t.id }; bs = k.sc; break; }
  void bs;
  if (!best) {
    const mid = (w.map.n * CFG.TILE_M) / 2;
    const p = nearestPassable(w, w.landing.x + (mid - w.landing.x) * 0.15, w.landing.y + (mid - w.landing.y) * 0.15, 8) || [w.landing.x, w.landing.y];
    best = { x: p[0], y: p[1], id: -1 };
  }
  layoutCamp(w, best.x, best.y, best.id);
  say(w, c, 'site');
}
export function layoutCamp(w: World, tx: number, ty: number, treeId: number): void {
  const cp = w.camp; cp.sited = true; cp.tree = treeId;
  const P = (x: number, y: number): [number, number] => nearestPassable(w, x, y, 6) || [tx, ty];
  const [cx, cy] = P(tx + 3, ty + 3); cp.x = cx; cp.y = cy;
  [cp.pile.x, cp.pile.y] = P(tx + 1.5, ty + 1);
  [cp.fire.x, cp.fire.y] = P(cx + 2, cy + 3);
  [cp.cask.x, cp.cask.y] = P(cp.fire.x + 2.5, cp.fire.y - 1.5);
  [cp.treat.x, cp.treat.y] = P(cp.fire.x - 3, cp.fire.y - 1);
  [cp.range.x, cp.range.y] = P(cx - 8, cy + 8);
  [cp.latrine.x, cp.latrine.y] = P(cx + w.wind.x * CFG.LATRINE_DOWNWIND_M, cy + w.wind.y * CFG.LATRINE_DOWNWIND_M);
  for (const def of CFG.BUILDINGS) { const [bx, by] = P(cp.fire.x + def.dx, cp.fire.y + def.dy); cp.builds[def.id] = { x: bx, y: by, built: false, progress: 0, claim: -1 }; }
}

// ---------- requisitions: only the commander deals with the boat ----------
export function requisition(w: World, s: Scout): void {
  const b = w.boat; const st = w.camp.stock; const why: string[] = [];
  const o = { ration: 0, ammo: 0, meds: 0, tobacco: 0, rum: 0, guns: 0, gear: 0, scouts: 0, why };
  let budget = funds(w) + cargoValue(b.cargo) + cargoValue(exportsInStock(w)) - CFG.REQ_RESERVE_CREDITS;  // counts on today's sale
  let cashLeft = w.ledger.cash + Math.min(cargoValue(b.cargo) + cargoValue(exportsInStock(w)), 200); // on-the-spot buys are cash only
  const spend = (cost: number): boolean => { if (cost <= budget) { budget -= cost; return true; } return false; };
  const alive = w.scouts.filter((x) => x.status !== 'dead').length;
  const fp = foodPoints(w), ft = alive * CFG.FOOD_PER_DAY * CFG.FOOD_DAYS_TARGET;
  const T = CFG.REQ_TARGET;
  if (fp < ft) { const n = Math.max(0, (T.ration || 0) - invGet(st, 'ration')); const k = Math.floor(Math.min(n, budget / CFG.COST.ration)); if (k > 0 && spend(k * CFG.COST.ration)) { o.ration = k; why.push(`Food's thin. ${FEATURES.orders ? 'Ordering' : 'Buying'} ${k} rations.`); } }
  const ammo = invGet(st, 'ammo'); const an = Math.max(0, (T.ammo || 0) - ammo);
  if (an >= 20) { const k = Math.floor(Math.min(an, budget / CFG.COST.ammo) / 10) * 10; if (k > 0 && spend(k * CFG.COST.ammo)) { o.ammo = k; why.push(ammo < CFG.AMMO_LOW * 2 ? `We're low on rounds, ${FEATURES.orders ? 'ordering' : 'buying'} ${k}.` : `Topping up ammunition, ${k} rounds.`); } }
  const missing = !FEATURES.replacements ? 0 : CFG.SCOUTS_START - alive + w.scouts.filter((x) => x.status !== 'dead' && x.homeBound).length;
  for (let i = 0; i < missing; i++) if (spend(CFG.COST.scout + (w.spare.length > i ? 0 : CFG.GUN_COST))) { o.scouts++; if (w.spare.length <= i) o.guns++; }
  if (o.scouts) why.push(`We need ${o.scouts === 1 ? 'a new man' : o.scouts + ' new men'}. Sending for ${o.scouts}.`);
  else if (missing > 0) why.push("We're short-handed but can't afford a new man yet.");
  if (!FEATURES.orders) {
    // v1: the trader always has food and ammo; the commander buys on the spot and it's unloaded today
    if (!why.length) why.push('Nothing we need badly. Keeping the money.');
    const bought = (['ration', 'ammo'] as const).filter((k) => o[k] > 0);
    for (const k of bought) invAdd(b.crate, k, o[k]);
    const cost = o.ration * CFG.COST.ration + o.ammo * CFG.COST.ammo; if (cost > 0) payCash(w, cost);
    b.pending = { ration: 0, ammo: 0, meds: 0, tobacco: 0, rum: 0, guns: 0, gear: 0, scouts: 0, why };  // marks "met"; nothing owed later
    for (const line of why) { s.bark = line; s.barkUntil = w.tick + 60; addLog(w, s.name, line, 'boat'); }
    return;
  }
  const mn = Math.max(0, (T.meds || 0) - invGet(st, 'meds')); if (mn > 0) { const k = Math.floor(Math.min(mn, budget / CFG.COST.meds)); if (k > 0 && spend(k * CFG.COST.meds)) { o.meds = k; why.push(`Medical kit's light. ${k} more.`); } }
  const gunless = w.scouts.filter((x) => x.status !== 'dead' && !x.guns.length).length - w.spare.length;
  for (let i = 0; i < gunless; i++) if (spend(CFG.GUN_COST)) o.guns++;
  const worn = w.scouts.filter((x) => x.status !== 'dead' && x.gear < CFG.GEAR_ORDER_BELOW).length;
  for (let i = 0; i < worn; i++) if (spend(CFG.GEAR_COST)) o.gear++;
  if (o.gear) why.push(`Clothes are rags. ${o.gear} new kit${o.gear > 1 ? 's' : ''}.`);
  for (const k of ['tobacco', 'rum'] as const) { const n = Math.max(0, (T[k] || 0) - invGet(st, k)); const q = Math.floor(Math.min(n, budget / CFG.COST[k])); if (q > 0 && spend(q * CFG.COST[k])) o[k] = q; }
  if (o.tobacco || o.rum) why.push('Tobacco and rum too. The men have earned it.');
  if (!why.length) why.push('Nothing we need badly. Keeping the money.');
  // buy what the trader has on board today (at a markup); the rest is ordered for a later boat
  const now: string[] = [];
  for (const k of ['ration', 'ammo', 'meds', 'tobacco', 'rum'] as const) {
    const unit = CFG.COST[k] * CFG.SHOP_MARKUP; const q = Math.min(o[k], invGet(b.shop, k), Math.floor(cashLeft / unit)); if (q <= 0) continue;
    o[k] -= q; invAdd(b.shop, k, -q); invAdd(b.crate, k, q); payCash(w, q * unit); cashLeft -= q * unit; now.push(`${q} ${k}`);
  }
  if (now.length) why.push(`Trader's got ${now.join(', ')} on board. Taking it now.`);
  b.pending = o;
  for (const line of why) { s.bark = line; s.barkUntil = w.tick + 60; addLog(w, s.name, line, 'boat'); }
}
export function exportsInStock(w: World): Partial<Record<Item, number>> { const o: Partial<Record<Item, number>> = {}; for (const k of EXPORTS) { const n = Math.floor(stock(w, k)); if (n > 0) o[k] = n; } return o; }
export function cargoValue(inv: Partial<Record<Item, number>>): number { let v = 0; for (const k in inv) v += (CFG.PRICE[k as Item] || 0) * (inv[k as Item] || 0); return v; }
export function orderCost(o: { ration: number; ammo: number; meds: number; tobacco: number; rum: number; guns: number; gear: number; scouts: number }): number {
  return o.ration * CFG.COST.ration + o.ammo * CFG.COST.ammo + o.meds * CFG.COST.meds + o.tobacco * CFG.COST.tobacco + o.rum * CFG.COST.rum + o.guns * CFG.GUN_COST + o.gear * CFG.GEAR_COST + o.scouts * CFG.COST.scout;
}
