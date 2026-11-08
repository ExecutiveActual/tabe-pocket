// World creation and the fixed-tick step. Pure and deterministic: no DOM, no clock, no Math.random.
// v1 plays on the small landing-coast map; the full island (data/tabe.json) is for later
import TABE from '../../data/pocket_v1.json';
import { CFG, FEATURES, NAMES, TRAIT_PAIRS, TRAITS_PER_SCOUT, NEED_IDS, Item, SKILL_IDS, SkillId, COMPANY_NAME, Trait } from './config';
import {
  World, Scout, Inv, T, rnd, rint, pick, dist, clamp, TPH, hourOf, dayOf, genTerrain, carveWater, tileCenter,
  PASSABLE, addLog, invAdd, invGet, newId, nearestPassable, needsFull, tileOf, DayReport, tfx,
  funds, payCash, payHome, receive, MAP_CHARS, isDark,
} from './core';
import { fallSick, commander, campAlert, able, decide, runAct, endAct, planTick, tickNeeds, tickMorale, campXY, fireLit, built, stock, cargoValue, orderCost, say, chainOrder, foodPoints } from './ai';
import { perceive, combatTick, tickBullets, tickDowned } from './combat';
import { directorTick, wildTick, deerTick } from './wild';

export interface WorldOpts { kind?: 'island' | 'arena'; noRoukha?: boolean; noBoat?: boolean; scouts?: number; scenario?: string; difficulty?: string }

export function blankWorld(seed: number, n: number): World {
  const B = (): { x: number; y: number; built: boolean; progress: number; claim: number } => ({ x: 0, y: 0, built: false, progress: 0, claim: -1 });
  return {
    seed, tick: 0, rng: (Math.imul(seed, 2654435761) >>> 0) || 1, nextId: 1,
    map: { n, terrain: [], trail: {}, seen: new Array(n * n).fill(0), water: [] }, landing: { x: 0, y: 0, sx: 0, sy: 0 }, wind: { x: 1, y: 0 },
    scouts: [], deer: [], birds: [], packs: [], trees: [], bushes: [], fish: [], carcasses: [], gatherings: [], bullets: [], signs: [], intel: [], waterPts: [], spare: [], rookeries: [], departed: [],
    camp: {
      sited: false, x: 0, y: 0, tree: -1, packsDown: 0, fire: Object.assign(B(), { fuel: 0 }), latrine: B(), builds: {}, proposals: [], stock: {},
      pile: { x: 0, y: 0 }, cask: { x: 0, y: 0 }, range: { x: 0, y: 0 }, treat: { x: 0, y: 0 }, readyTick: { fire: -1, latrine: -1, wood: -1 },
    },
    boat: { state: 'away', nextArrive: 0, departAt: 0, x: 0, y: 0, visits: 0, cargo: {}, crate: {}, pending: null, shop: {}, crateGear: 0, crateGuns: 0 },
    ledger: { income: 0, spending: 0, credits: 0, cash: 0, shipped: {} },
    plan: { commander: -1, goals: [], watch: { id: -1, until: 0 }, warned: {} },
    weather: 'clear', difficulty: CFG.DEFAULT_DIFFICULTY, season: 0, deerRespawn: 0, grief: 0, scentBoost: 0, pendingBuild: '',
    log: [], logN: 0, commands: [], flags: { noRoukha: false, noBoat: false, scenario: '' },
    over: '', raidCalm: 0,
    stats: {
      shots: 0, hits: 0, birdKills: 0, deerKills: 0, deaths: 0, downs: 0, rescues: 0, charges: 0, withdraws: 0, roukhaHunts: 0, seasonFees: 0, beaksSold: 0, debtDays: 0, license: 0, wages: 0,
      packsSpawned: 0, phantomWork: 0, boatsDone: 0, shotTicks: [], days: [], mon: { stuck: 0, idle: 0, oscillation: 0, lone: 0, exceptions: 0, notes: [] },
      dayMin: {}, eaten: {}, drank: 0, leisure: {},
    },
  };
}

/** 1-3 traits, never both halves of an opposing pair. */
function rollTraits(w: World): Trait[] {
  const n = rint(w, TRAITS_PER_SCOUT[0], TRAITS_PER_SCOUT[1]);
  // v1 only draws traits whose effects are live; social/drink traits wait for FEATURES.leisure
  const pairs = TRAIT_PAIRS.filter(([a]) => FEATURES.leisure || (a !== 'loner' && a !== 'drinker')); const out: Trait[] = [];
  for (let i = 0; i < n && pairs.length; i++) { const k = rint(w, 0, pairs.length - 1); const p = pairs.splice(k, 1)[0]; out.push(p[rint(w, 0, 1)]); }
  return out;
}
export function makeScout(w: World, x: number, y: number, rank: number, skills: Record<SkillId, number>, used: Set<string>): Scout {
  let name = pick(w, NAMES); for (let k = 0; k < 40 && used.has(name); k++) name = pick(w, NAMES); used.add(name);
  const traits = rollTraits(w);
  const guns = (CFG.LOADOUT_BY_RANK[rank] || ['rifle']).map((t) => ({ type: t, cond: 85 + rint(w, 0, 15) }));
  const g = CFG.GUNS[guns[0].type];
  const hp = Math.round(CFG.HP * tfx({ traits }, 'hp'));
  const s: Scout = {
    id: newId(w), name, squad: 0, trait: traits[0], traits, rank, skills: { ...skills },
    x, y, px: x, py: y, fx: 0, fy: -1, hp, maxHp: hp, status: 'ok', bleed: 0, recover: 0, draggedBy: -1,
    needs: needsFull(), purse: 0, morale: 65, thoughts: [], carry: {}, mag: g.mag, ammo: CFG.CARRY_AMMO, reload: 0, guns, jam: 0, gear: 80 + rint(w, 0, 20), wound: 0, stabilized: false,
    act: null, posture: 'stand', postureT: 0, aimT: 0, aimTarget: -1, cooldown: 0, thought: '', bark: '', barkUntil: 0,
    threat: null, combat: false, sleeping: false, lastLeisure: 0, idleT: 0, stillT: 0, failT: 0,
    hist: [], starts: [], joined: w.tick, tag: 'pack', lastMeal: 0, lastDrink: 0, stress: 0, sick: 0, cool: {}, why: '', combatFlips: [], clearT: 0, carcassMode: '', sickKind: '', injuries: [], medicUntil: 0, hangover: 0, grief: 0, together: {}, homeBound: false, shipped: false,
  };
  for (const k of NEED_IDS) s.needs[k] = 75 + rint(w, 0, 20);
  for (const k of SKILL_IDS) s.skills[k] = clamp(s.skills[k] + rint(w, -5, 5), 0, 100);
  return s;
}

export function createWorld(seed: number, opts: WorldOpts = {}): World {
  const kind = opts.kind || 'island';
  const n = kind === 'arena' ? 70 : TABE.rows.length;
  const w = blankWorld(seed, n);
  w.flags.noRoukha = !!opts.noRoukha; w.flags.noBoat = !!opts.noBoat; w.flags.scenario = opts.scenario || '';
  w.difficulty = opts.difficulty || CFG.DEFAULT_DIFFICULTY;
  const start = CFG.DIFFICULTY[w.difficulty] ?? CFG.DIFFICULTY.normal;
  w.ledger.cash = FEATURES.splitMoney ? Math.round(start * CFG.START_CASH_SHARE) : 0; w.ledger.credits = start - w.ledger.cash;
  // the island is the same hand-authored map every game (data/tabe.json); the seed varies people, animals and weather
  w.map.terrain = kind === 'island' ? islandTerrain() : genTerrain(seed, n, kind);
  if (kind !== 'island') for (let y = -3; y <= 3; y++) for (let x = -3; x <= 3; x++) if (x * x + y * y <= 9) w.map.terrain[(20 + y) * n + 45 + x] = T.POND;
  const ter = w.map.terrain;
  for (let i = 0; i < n * n; i++) {
    if (ter[i] === T.STREAM) { w.waterPts.push(i); continue; }
    if (!PASSABLE[ter[i]]) continue;
    const x = i % n, y = Math.floor(i / n);
    if ((x > 0 && ter[i - 1] === T.POND) || (x < n - 1 && ter[i + 1] === T.POND) || (y > 0 && ter[i - n] === T.POND) || (y < n - 1 && ter[i + n] === T.POND)) w.waterPts.push(i);
  }
  if (kind === 'island') {
    // content by biome (data). Placement is seeded per tile from a fixed salt so the island's groves are the same every game.
    const salt = { rng: (CFG.MAP_CONTENT_SEED >>> 0) || 1 };
    for (let i = 0; i < n * n; i++) {
      const bc = CFG.BIOME_CONTENT[ter[i]]; if (!bc) continue;
      if (bc.tree && rnd(salt) < bc.tree) { const size = rnd(salt) < 0.22 ? 3 : rnd(salt) < 0.5 ? 2 : 1; addTree(w, i, size); continue; }
      const r = rnd(salt); let acc = 0;
      for (const k in bc.forage) { if (!FEATURES.extraForage && k !== 'fruit') continue; acc += bc.forage[k]; if (r < acc) { const [x, y] = tileCenter(w, i); w.bushes.push({ id: newId(w), x, y, berries: 2 + Math.floor(rnd(salt) * (CFG.BUSH_MAX - 1)), regrow: 0, claim: -1, kind: k }); break; } }
    }
  } else {
    for (let k = 0; k < 40; k++) { const x = 18 + (k % 8) * 2 + (k % 3), y = 22 + Math.floor(k / 8) * 2; addTree(w, y * n + x, k % 5 === 0 ? 3 : 2); }
    for (let k = 0; k < 8; k++) { const [x, y] = tileCenter(w, (40 + k) * n + 20 + k * 2); w.bushes.push({ id: newId(w), x, y, berries: CFG.BUSH_MAX, regrow: 0, claim: -1, kind: 'fruit' }); }
  }
  const shore: number[] = [];
  for (let i = 0; i < n * n; i++) { if (!PASSABLE[ter[i]] || ter[i] === T.STREAM) continue; const x = i % n, y = Math.floor(i / n); if (x < 1 || y < 1 || x > n - 2 || y > n - 2) continue; if ([ter[i - 1], ter[i + 1], ter[i - n], ter[i + n]].some((t) => t === T.SEA || t === T.POND)) shore.push(i); }
  // fish spots along the shore and the streams (traps and nets get set there, then checked)
  if (kind === 'island' && FEATURES.fishing) { const salt = { rng: (CFG.MAP_CONTENT_SEED * 7 >>> 0) || 3 }; for (let i = 0; i < n * n; i++) if (ter[i] === T.STREAM && rnd(salt) < CFG.FISH_SPOT_DENSITY) { const [x, y] = tileCenter(w, i); w.fish.push({ id: newId(w), x, y, fish: 0, regrow: 0, claim: -1, trap: false }); }
    for (const i of shore) if (rnd(salt) < CFG.FISH_SPOT_DENSITY * 0.5) { const [x, y] = tileCenter(w, i); w.fish.push({ id: newId(w), x, y, fish: 0, regrow: 0, claim: -1, trap: false }); } }
  else if (kind !== 'island') for (let k = 0; k < CFG.FISH_SPOTS && shore.length; k++) { const i = shore[rint(w, 0, shore.length - 1)]; const [x, y] = tileCenter(w, i); w.fish.push({ id: newId(w), x, y, fish: 0, regrow: 0, claim: -1, trap: false }); }
  // landing: a beach tile with a good grove and fresh water within reach
  let bestI = -1, bestS = -1e9;
  const sandTiles: number[] = [];
  for (let i = n; i < n * n - n; i++) if (ter[i] === T.SAND && [ter[i - 1], ter[i + 1], ter[i - n], ter[i + n]].some((t) => t === T.SEA)) sandTiles.push(i);
  if (kind === 'island') { bestI = TABE.landing[1] * n + TABE.landing[0]; }
  else for (let k = 0; k < Math.min(160, sandTiles.length); k++) {
    const i = kind === 'arena' ? sandTiles.filter((j) => Math.floor(j / n) > n - 8)[20] : sandTiles[rint(w, 0, sandTiles.length - 1)];
    const [x, y] = tileCenter(w, i);
    let big = 0; for (const t of w.trees) { if (t.size === 3 && dist(t.x, t.y, x, y) < CFG.LANDING_REVEAL_M - 5) big++; }
    let wd = 1e9; for (const j of w.waterPts) { const [a, b] = tileCenter(w, j); wd = Math.min(wd, dist(a, b, x, y)); }
    const sc = Math.min(big, 6) * 4 - Math.max(0, wd - 60) * 0.3 + rnd(w);
    if (sc > bestS) { bestS = sc; bestI = i; }
    if (kind === 'arena') break;
  }
  const [lx, ly] = tileCenter(w, bestI);
  w.landing.x = lx; w.landing.y = ly;
  let sx = 0, sy = 0; for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) if (ter[bestI + dx + dy * n] === T.SEA) { sx = dx; sy = dy; }
  w.landing.sx = sx; w.landing.sy = sy; w.boat.x = lx + sx * 10; w.boat.y = ly + sy * 10;
  const wd = pick(w, [[1, 0], [-1, 0], [0, 1], [0, -1], [0.7071, 0.7071], [-0.7071, 0.7071], [0.7071, -0.7071], [-0.7071, -0.7071]]);
  w.wind = { x: wd[0], y: wd[1] };
  reachPrune(w, bestI);
  for (let h = 0; h < (FEATURES.deer ? CFG.DEER_HERDS : 0); h++) {
    for (let k = 0; k < 80; k++) {
      const i = rint(w, 0, n * n - 1); if (ter[i] !== T.GRASS && ter[i] !== T.OUTBACK) continue; const [x, y] = tileCenter(w, i);
      if (dist(x, y, lx, ly) < 60) continue;
      for (let m = 0; m < CFG.DEER_PER_HERD; m++) { const p = nearestPassable(w, x + m * 2, y + (m % 2) * 2, 3) || [x, y]; w.deer.push({ id: newId(w), x: p[0], y: p[1], px: p[0], py: p[1], hp: CFG.DEER_HP, herd: h, state: 'graze', tx: p[0], ty: p[1], t: 0 }); }
      break;
    }
  }
  const used = new Set<string>();
  const count = opts.scouts || CFG.SCOUTS_START;
  for (let k = 0; k < count; k++) {
    const r = CFG.START_ROSTER[k % CFG.START_ROSTER.length];
    const p = nearestPassable(w, lx - sx * 2 + (k - 2) * 1.5 * (sy !== 0 ? 1 : 0), ly - sy * 2 + (k - 2) * 1.5 * (sx !== 0 ? 1 : 0), 4) || [lx, ly];
    w.scouts.push(makeScout(w, p[0], p[1], r.rank, r.skills, used));
  }
  // rookeries: far from the landing, on open ground
  // rookeries are fixed places on the map (Roukha concentrate there; roamers elsewhere)
  if (kind === 'island') for (const [rx, ry] of TABE.rookeries as number[][]) { const [x, y] = tileCenter(w, ry * n + rx); w.rookeries.push({ id: newId(w), x, y, eggs: CFG.EGGS_PER_ROOKERY }); }
  reveal(w, lx, ly, CFG.LANDING_REVEAL_M);
  w.boat.nextArrive = tickAt(1 + rint(w, CFG.BOAT_EVERY_DAYS[0], CFG.BOAT_EVERY_DAYS[1]), CFG.BOAT_ARRIVE_H);
  addLog(w, COMPANY_NAME, `The boat drops ${count} scouts and their crates on the beach. Boss: ${chainOrder(w)[0].name}.`, 'event');
  return w;
}
function addTree(w: World, i: number, size: number): void {
  const [x, y] = tileCenter(w, i);
  w.trees.push({ id: newId(w), x, y, size, wood: size * CFG.TREE_WOOD_PER_SIZE, timber: size >= 2 ? size * CFG.TREE_TIMBER_PER_SIZE : 0, felled: false, regrow: 0, claim: -1 });
}
function reachPrune(w: World, from: number): void {
  const n = w.map.n, ter = w.map.terrain, ok = new Uint8Array(n * n); const q = [from]; ok[from] = 1;
  while (q.length) { const i = q.pop() as number; for (const d of [1, -1, n, -n]) { const j = i + d; if (j < 0 || j >= n * n || ok[j] || !PASSABLE[ter[j]]) continue; ok[j] = 1; q.push(j); } }
  const f = (x: number, y: number): boolean => ok[tileOf(w, x, y)] === 1;
  w.trees = w.trees.filter((t) => f(t.x, t.y)); w.bushes = w.bushes.filter((b) => f(b.x, b.y)); w.fish = w.fish.filter((x) => f(x.x, x.y));
  w.waterPts = w.waterPts.filter((i) => ok[i] === 1);
}
export function reveal(w: World, x: number, y: number, r: number): void {
  const n = w.map.n, rt = Math.ceil(r / CFG.TILE_M), cx = Math.floor(x / CFG.TILE_M), cy = Math.floor(y / CFG.TILE_M);
  for (let yy = cy - rt; yy <= cy + rt; yy++) for (let xx = cx - rt; xx <= cx + rt; xx++) if (xx >= 0 && yy >= 0 && xx < n && yy < n && (xx - cx) * (xx - cx) + (yy - cy) * (yy - cy) <= rt * rt) w.map.seen[yy * n + xx] = 1;
}
export function tickAt(day: number, hour: number): number { return Math.round((day - 1) * CFG.DAY_TICKS + (hour - CFG.START_HOUR) * TPH()); }

// ---------- the player-command API (stub for the later interaction layer) ----------
/** Commands carry a target tick so the host phone can apply both players' input in one canonical order. */
/**
 * Player orders (the client/server seam). NOT WIRED UP IN v1: the sim logs them and ignores them.
 * Planned for after v1 (see README roadmap). Target is one scout (args.scout) or the whole squad (no scout).
 *  - ground menu:   'moveTo' | 'huntHere' | 'buildHere'                       args: x, y (metres) [, build]
 *  - priorities:    'setPriority' (company-wide) | 'setScoutPriority'         args: job, value 0..1 [, scout]
 *  - broad orders:  'huntArea' | 'holdCamp' | 'fallBack' | 'goToBoat' | 'moveCamp' | 'restDay'
 *  - fight:         'pickTarget' (bird) | 'takeCover' | 'holdFire' | 'fireAtWill' | 'bayonetCharge' | 'dragDowned' (scout)
 *  - co-op / misc:  'approveBuild' (either player) | 'ping' (x, y, kind; no text chat) | 'autoPause' (on: 0/1) | 'pause' | 'setSpeed'
 */
export type CommandKind =
  | 'moveTo' | 'huntHere' | 'buildHere'
  | 'setPriority' | 'setScoutPriority'
  | 'huntArea' | 'holdCamp' | 'fallBack' | 'goToBoat' | 'moveCamp' | 'restDay'
  | 'pickTarget' | 'takeCover' | 'holdFire' | 'fireAtWill' | 'bayonetCharge' | 'dragDowned'
  | 'approveBuild' | 'ping' | 'autoPause' | 'pause' | 'setSpeed'
  | 'hold' | 'regroup' | 'explore';
export function issueCommand(w: World, player: string, kind: CommandKind, args: Record<string, number | string>, atTick = w.tick): void {
  w.commands.push({ tick: atTick, player, kind, args });
}
function applyCommands(w: World): void {
  if (!w.commands.length) return;
  const due = w.commands.filter((c) => c.tick <= w.tick).sort((a, b) => a.tick - b.tick || (a.player < b.player ? -1 : a.player > b.player ? 1 : 0));
  w.commands = w.commands.filter((c) => c.tick > w.tick);
  for (const c of due) addLog(w, 'Orders', `${c.player}: '${c.kind}' received (player orders are not wired up yet)`, 'event');
}

// ---------- the step ----------
/** Commander's cash policy (data): next season's wages and fees plus a supplies float. */
export function cashTarget(w: World): number {
  const men = w.scouts.filter((s) => s.status !== 'dead').length; const P = CFG.CASH_POLICY;
  return men * CFG.WAGE_PER_DAY * CFG.SEASON_DAYS * P.seasonsOfWages + CFG.SEASON_LICENSE_FEE + P.feeBirds * CFG.LICENSE_FEE + P.supplies;
}
export function step(w: World): void {
  if (w.over) return;   // game over: the world stops
  const tph = TPH(); const h = hourOf(w.tick);
  applyCommands(w);
  if (w.tick % Math.floor(tph) === 0) hourly(w);
  if (w.tick % CFG.PLAN_EVERY === 0) planTick(w);
  for (const s of w.scouts) {
    s.px = s.x; s.py = s.y;
    if (s.status === 'dead') continue;
    try {
      if (s.status === 'downed') { tickDowned(w, s); continue; }
      tickNeeds(w, s);
      if ((w.tick + s.id) % 25 === 0) tickMorale(w, s);
      if ((w.tick + s.id) % 5 === 0) perceive(w, s);
      if (combatTick(w, s)) continue;
      if (s.act && (w.tick + s.id) % CFG.DECIDE_EVERY === 0) maybeInterrupt(w, s, h);
      if (!s.act) decide(w, s);
      if (s.act) runAct(w, s);
    } catch (e) {
      w.stats.mon.exceptions++; w.stats.mon.notes.push(`exception ${s.name} t${w.tick}: ${(e as Error).message}`);
      s.act = null;
    }
  }
  gatherTick(w);
  if (w.camp.fire.built && w.camp.fire.fuel > 0) {
    w.camp.fire.fuel -= (CFG.FIRE_BURN_H * (w.weather === 'rain' || w.weather === 'storm' ? 1.5 : 1)) / tph;
    if (w.camp.fire.fuel <= 0) { w.camp.fire.fuel = 0; addLog(w, 'Camp', 'the fire burned out', 'warn'); }
  }
  directorTick(w); wildTick(w); deerTick(w); tickBullets(w);
  boatTick(w);
  monitors(w);
  w.tick++;
}

function maybeInterrupt(w: World, s: Scout, h: number): void {
  const a = s.act!;
  // the trader is in and the boss is off on something else (a buddy job, a chore): he drops it and goes
  if (w.boat.state === 'docked' && !w.boat.pending && ['combat', 'rescue', 'treat', 'meetBoat', 'escort'].indexOf(a.kind) < 0 && commander(w) === s) { endAct(w, s, 'boat'); return; }
  // day work stops at dark: foragers, wood cutters and explorers head home with what they have
  if (isDark(h) && (a.kind === 'forage' || a.kind === 'chop' || a.kind === 'explore') && a.step < 2) { endAct(w, s, 'dark'); return; }
  // the camp is under attack: sleepers near the fire get up
  if (a.kind === 'sleep' && campAlert(w) && dist(s.x, s.y, w.camp.x, w.camp.y) < CFG.ALERT_M + 20) { endAct(w, s, 'alarm'); return; }
  if (a.kind === 'watch' || a.kind === 'rescue' || a.kind === 'combat' || a.kind === 'buddy' || a.buddy >= 0) return;
  const urgent = (s.needs.food < CFG.NEED_URGENT && a.kind !== 'eat') || (s.needs.water < CFG.NEED_URGENT && a.kind !== 'drink') || (s.needs.rest < CFG.NEED_URGENT / 2 && a.kind !== 'sleep');
  if (urgent && !a.urgent) { endAct(w, s, 'urgent need'); return; }
  const lateNight = (h >= 21 || h < 4) && ['eat', 'drink', 'sleep', 'warm', 'unpack'].indexOf(a.kind) < 0;
  if (lateNight && s.needs.rest < 92) endAct(w, s, 'bedtime');
}

function gatherTick(w: World): void {
  for (const g of w.gatherings) {
    const def = CFG.ACTIVITIES.find((d) => d.id === g.actId)!;
    const present = g.members.filter((id) => { const s = w.scouts.find((x) => x.id === id); return !!s && s.act !== null && s.act.gid === g.id && dist(s.x, s.y, s.act.tx, s.act.ty) < 1; });
    if (!g.active && present.length >= def.minPeople) { g.active = true; g.until = w.tick + def.hours * TPH(); }
  }
  w.gatherings = w.gatherings.filter((g) => g.members.length > 0 && !(g.active && w.tick > g.until + 5));
}

function hourly(w: World): void {
  const tph = TPH(); const h = Math.round(hourOf(w.tick)); const day = dayOf(w.tick);
  // seasons and weather
  const ns = FEATURES.seasons ? Math.floor((day - 1) / CFG.SEASON_DAYS) % 4 : 0;
  if (!FEATURES.seasons) {
    // v1: daily wages at dawn, one purse
    if (h === 6) { const men = w.scouts.filter((s) => s.status !== 'dead').length; const wage = men * CFG.WAGE_PER_DAY; payCash(w, wage); w.stats.wages += wage; }
  } else if (ns !== w.season || w.stats.seasonFees === 0) {
    w.season = ns; payCash(w, CFG.SEASON_LICENSE_FEE); w.stats.seasonFees++;
    // wages for the season, cash first, then home; short money becomes debt
    const men = w.scouts.filter((s) => s.status !== 'dead'); const wage = CFG.WAGE_PER_DAY * CFG.SEASON_DAYS;
    for (const s of men) s.purse += wage;
    payCash(w, wage * men.length); w.stats.wages += wage * men.length;
    addLog(w, 'Ledger', `${CFG.SEASONS[ns]}: season license ${CFG.SEASON_LICENSE_FEE} cr, wages ${wage * men.length} cr`, 'event');
  }
  if (h % 4 === 0) {
    const c = CFG.WEATHER_CHANCE[w.season]; const r = rnd(w);
    const nw = r < c.storm ? 'storm' : r < c.storm + c.rain ? 'rain' : r < c.storm + c.rain + c.fog && (h < 10) ? 'fog' : 'clear';
    if (nw !== w.weather) { w.weather = nw; addLog(w, 'Weather', nw === 'clear' ? 'skies clear' : nw === 'rain' ? 'rain sets in' : nw === 'fog' ? 'fog rolls in off the sea' : 'a storm rolls in', 'event'); }
  }
  if (w.weather === 'rain' || w.weather === 'storm') {
    // rain washes out tracks; unsheltered fires can be put out
    w.signs = w.signs.filter((s) => s.kind === 'blood' && w.weather === 'rain');
    if (fireLit(w) && !built(w, 'shelter') && rnd(w) < CFG.RAIN_DOUSE_H * (w.weather === 'storm' ? 2 : 1)) { w.camp.fire.fuel = 0; addLog(w, 'Camp', 'the rain put the fire out', 'warn'); }
  }
  for (const t of w.trees) if (t.wood < t.size * CFG.TREE_WOOD_PER_SIZE && ++t.regrow >= CFG.TREE_WOOD_REGROW_H) { t.regrow = 0; t.wood++; }
  for (const b of w.bushes) if (b.berries < CFG.BUSH_MAX && ++b.regrow >= CFG.BUSH_REGROW_H * (w.season === 3 ? 2 : 1)) { b.regrow = 0; b.berries++; }
  // trails fade slowly
  for (const k in w.map.trail) { const v = w.map.trail[k] - CFG.TRAIL_DECAY_H; if (v <= 0) delete w.map.trail[k]; else w.map.trail[k] = v; }
  for (const r of w.rookeries) r.eggs = w.season === 0 ? CFG.EGGS_PER_ROOKERY : 0;
  for (const f of w.fish) if (f.trap && f.fish < CFG.FISH_MAX && ++f.regrow >= CFG.FISH_REGROW_H) { f.regrow = 0; f.fish++; }  // traps fill while set
  const mul = built(w, 'shed') ? CFG.SPOIL_SHED_MUL : 1;
  for (const k in CFG.SPOIL_H) { const kk = k as Item; const v = invGet(w.camp.stock, kk); if (v > 0) invAdd(w.camp.stock, kk, -v * (CFG.SPOIL_H[kk] || 0) * mul); }
  if (built(w, 'barrel') && (w.weather === 'rain' || w.weather === 'storm')) invAdd(w.camp.stock, 'water', CFG.RAIN_BARREL_H);
  w.scentBoost = Math.max(0, w.scentBoost - 0.5);
  w.grief = Math.max(0, w.grief - CFG.MORALE_DEATH_DECAY_H);
  w.carcasses = w.carcasses.filter((c) => c.claim >= 0 || w.tick - c.t < CFG.CARCASS_ROT_H * tph);
  w.signs = w.signs.filter((s) => w.tick - s.t < CFG.SIGN_LIFE_H * tph);
  if (w.signs.length > 300) w.signs.splice(0, w.signs.length - 300);
  w.intel = w.intel.filter((i) => w.tick - i.t < CFG.INTEL_LIFE_H * tph * 2 && w.packs.some((p) => p.id === i.pack && p.state !== 'gone'));
  // illness: cold and wet raise the chance; Tough/Sickly traits scale it
  for (const s of w.scouts) {
    if (s.status !== 'ok' || s.sick > 0) continue;
    const wetCold = (w.weather === 'rain' || w.weather === 'storm') && s.needs.warmth < 50 ? CFG.WET_COLD_SICK_MUL : 1;
    if (!FEATURES.sickness) continue;
    if (rnd(w) < (CFG.ILLNESS_PER_DAY / 24) * wetCold * tfx(s, 'sick')) fallSick(w, s, 'chills');
    else if (s.hp < s.maxHp * CFG.TREAT_BELOW_HP && s.medicUntil < w.tick && rnd(w) < CFG.INFECT_PER_H * tfx(s, 'sick')) fallSick(w, s, 'infection');
  }
  // time together (cheap proxy for closeness until relationships exist)
  const live = w.scouts.filter((s) => s.status !== 'dead');
  for (const a of live) for (const b of live) if (a.id < b.id && dist(a.x, a.y, b.x, b.y) < CFG.TOGETHER_M) { a.together[b.id] = (a.together[b.id] || 0) + 1; b.together[a.id] = (b.together[a.id] || 0) + 1; }
  for (const s of live) s.grief = Math.max(0, s.grief - CFG.MORALE_DEATH_DECAY_H);
  for (const s of w.scouts) if (s.status !== 'dead') { s.hist.push([w.tick, ...NEED_IDS.map((k) => Math.round(s.needs[k])), Math.round(s.morale), Math.round(s.stress)]); if (s.hist.length > 24 * 8) s.hist.shift(); }
  // game over: everyone dead, or bankrupt (debt past the limit for too long)
  if (h === 6) {
    if (funds(w) < (FEATURES.debt ? -CFG.DEBT_LIMIT : 0)) w.stats.debtDays++; else w.stats.debtDays = 0;
    if (!w.over && w.scouts.every((s) => s.status === 'dead')) { w.over = 'wiped'; addLog(w, 'Ledger', 'the whole company is dead. Game over.', 'event'); }
    if (w.stats.debtDays >= (FEATURES.debt ? CFG.BANKRUPT_DAYS : CFG.BANKRUPT_DAYS_NO_DEBT) && !w.over) { w.over = 'bankrupt'; addLog(w, 'Ledger', 'the company is bankrupt. Game over.', 'event'); }
  }
  if (h === 21) dayReport(w);
}

function dayReport(w: World): void {
  const r: DayReport = {
    day: dayOf(w.tick), alive: w.scouts.filter((s) => s.status !== 'dead').length, credits: Math.round(funds(w)), profit: Math.round(w.ledger.income - w.ledger.spending),
    stock: Object.fromEntries(Object.entries(w.camp.stock).map(([k, v]) => [k, Math.round((v || 0) * 10) / 10])) as Inv,
    scouts: w.scouts.map((s) => ({
      name: s.name, status: s.status,
      end: { ...Object.fromEntries(NEED_IDS.map((k) => [k, Math.round(s.needs[k])])), morale: Math.round(s.morale), stress: Math.round(s.stress) },
      min: { ...(w.stats.dayMin[s.id] || {}) },
      thoughts: s.thoughts.map((t) => `${t.text} ${t.v > 0 ? '+' : ''}${t.v}`),
    })),
  };
  w.stats.days.push(r); if (w.stats.days.length > 60) w.stats.days.shift();
  w.stats.dayMin = {};
}

function boatTick(w: World): void {
  if (w.flags.noBoat) return;
  const b = w.boat;
  if (b.state === 'away' && w.tick >= b.nextArrive) {
    if (w.weather === 'storm') { b.nextArrive += CFG.BOAT_STORM_DELAY_DAYS * CFG.DAY_TICKS; addLog(w, 'Boat', "storm at sea: the boat's late", 'boat'); return; }
    b.state = 'docked'; b.departAt = w.tick + CFG.BOAT_STAY_H * TPH(); b.visits++; b.cargo = {};
    b.shop = {}; for (const k in CFG.SHOP_POOL) { const [lo, hi, ch] = CFG.SHOP_POOL[k]; if (rnd(w) < ch) b.shop[k as Item] = rint(w, lo, hi); }
    addLog(w, 'Boat', 'the trader drops anchor at the landing (horn)', 'boat');
    const c = w.scouts.find((s) => able(s)); if (c) say(w, c, 'boat', {}, 'boat');
    // the commander drops what he's doing to go meet the trader
    planTick(w);  // post the boat goals now, not at the next planning pass
    const cm = commander(w); if (cm && cm.act && ['combat', 'rescue', 'meetBoat'].indexOf(cm.act.kind) < 0) endAct(w, cm);
    // the dead go home; badly broken men are invalided out (the commander orders replacements)
    for (const s of w.scouts) if (s.status === 'dead' && !s.shipped) { s.shipped = true; payCash(w, CFG.BODY_SHIP_COST); addLog(w, 'Boat', `${s.name}'s body is carried aboard to go home`, 'boat'); }
    for (const s of [...w.scouts]) if (s.homeBound && s.status === 'ok') { endAct(w, s); s.status = 'dead'; s.shipped = true; s.x = b.x || w.landing.x; s.y = b.y || w.landing.y; w.departed.push(s.name); addLog(w, s.name, `is sent home on the boat (${s.injuries.map((i) => CFG.INJURIES[i].label).join(', ') || 'broken down'})`, 'boat'); }
    const o = b.pending;
    if (o) {
      for (const k of ['ration', 'ammo', 'meds', 'tobacco', 'rum'] as const) if (o[k]) invAdd(b.crate, k as Item, o[k]);
      for (let i = 0; i < o.guns; i++) w.spare.push({ type: 'rifle', cond: 100 });
      const worn = w.scouts.filter((s) => s.status !== 'dead').sort((p, q) => p.gear - q.gear);
      for (let i = 0; i < o.gear && i < worn.length; i++) worn[i].gear = 100;
      const used = new Set(w.scouts.map((s) => s.name));
      for (let i = 0; i < o.scouts; i++) {
        const p = nearestPassable(w, w.landing.x - w.landing.sx * 2 + i, w.landing.y - w.landing.sy * 2, 4) || [w.landing.x, w.landing.y];
        const s = makeScout(w, p[0], p[1], 0, { ...CFG.REPLACEMENT_SKILLS }, used); s.tag = '';
        s.guns = w.spare.length ? [w.spare.shift()!] : [];
        w.scouts.push(s); addLog(w, s.name, 'steps off the boat, a new hand', 'boat');
      }
      b.pending = null;
    }
  }
  // the trader will wait a little for a commander who's on his way
  if (b.state === 'docked' && w.tick >= b.departAt && !b.pending && w.tick < b.departAt + CFG.BOAT_WAIT_H * TPH()) { const cm = commander(w); if (cm && cm.act && cm.act.kind === 'meetBoat') return; }
  if (b.state === 'docked' && w.tick >= b.departAt) {
    const income = cargoValue(b.cargo);
    // license fee per bird taken: charged on each beak declared at the boat
    w.stats.license = ['beakB', 'beakA', 'beakJ', 'beakCr'].reduce((t, k) => t + Math.floor(invGet(b.cargo, k as Item)), 0); const fees = w.stats.license * CFG.LICENSE_FEE;
    // the commander keeps enough cash for the coming season, the rest goes home
    const keep = FEATURES.splitMoney ? Math.max(0, cashTarget(w) - w.ledger.cash) : 0; receive(w, income, keep); payCash(w, fees);
    w.stats.beaksSold += w.stats.license;
    if (income > 0 && FEATURES.splitMoney) addLog(w, 'Ledger', `${Math.round(Math.min(income, keep))} cr kept at camp, ${Math.round(Math.max(0, income - keep))} cr sent home`, 'boat');
    for (const k in b.cargo) invAdd(w.ledger.shipped, k as Item, b.cargo[k as Item] || 0);
    const parts = Object.entries(b.cargo).map(([k, v]) => `${v} ${k}`).join(', ');
    addLog(w, 'Boat', `sails. Sold ${parts || 'nothing'} for ${Math.round(income)} cr` + (fees ? `; license office takes ${fees} cr for ${w.stats.license} birds` : ''), 'boat');
    w.stats.license = 0;
    if (b.pending && !FEATURES.orders) { /* v1: everything was bought on the spot */ }
    else if (b.pending) {
      const o = b.pending;
      const trim: ('rum' | 'tobacco' | 'gear' | 'meds' | 'ammo' | 'ration' | 'guns' | 'scouts')[] = ['rum', 'tobacco', 'gear', 'meds', 'ammo', 'ration', 'guns', 'scouts'];
      for (const k of trim) while (orderCost(o) > Math.max(0, w.ledger.credits) && o[k] > 0) o[k] -= k === 'ammo' ? Math.min(10, o.ammo) : 1;
      const cost = orderCost(o); payHome(w, cost);
      addLog(w, 'Boat', `order paid: ${Math.round(cost)} cr, arriving on the next boat`, 'boat');
    } else addLog(w, 'Boat', 'nobody met the boat: no order this time', 'boat');
    b.cargo = {}; b.state = 'away'; w.stats.boatsDone++;
    b.nextArrive = tickAt(dayOf(w.tick) + rint(w, CFG.BOAT_EVERY_DAYS[0], CFG.BOAT_EVERY_DAYS[1]), CFG.BOAT_ARRIVE_H);
  }
}

// ---------- monitors read by the soak test ----------
function monitors(w: World): void {
  const [cx, cy] = campXY(w); const h = hourOf(w.tick);
  const openGoal = w.plan.goals.some((g) => g.blockedUntil <= w.tick && g.kind !== 'escort');
  for (const s of w.scouts) {
    if (!able(s)) continue;
    const m = (w.stats.dayMin[s.id] = w.stats.dayMin[s.id] || {});
    if (h >= 6 && h < 21) for (const k of NEED_IDS) m[k] = Math.min(m[k] === undefined ? 100 : m[k], Math.round(s.needs[k]));
    m.morale = Math.min(m.morale === undefined ? 100 : m.morale, Math.round(s.morale));
    if (s.act && s.act.kind === 'idle' && openGoal && h >= 7 && h < 18) { if (++s.idleT === CFG.IDLE_LIMIT_S * CFG.TICK_HZ) { w.stats.mon.idle++; w.stats.mon.notes.push(`idle ${s.name} t${w.tick} open=${w.plan.goals.filter((g) => g.blockedUntil <= w.tick).map((g) => g.id).join(',')}`); } }
    else if (!s.act || s.act.kind !== 'idle') s.idleT = 0;
    const far = dist(s.x, s.y, cx, cy) > CFG.LONE_LIMIT_M;
    const buddy = w.scouts.some((o) => o !== s && o.status !== 'dead' && dist(o.x, o.y, s.x, s.y) < 20);
    if (far && !buddy && w.camp.sited) { s.cool['loneT'] = (s.cool['loneT'] || 0) + 1; if (s.cool['loneT'] === CFG.LONE_GRACE_S * CFG.TICK_HZ) { w.stats.mon.lone++; w.stats.mon.notes.push(`lone ${s.name} t${w.tick} ${s.act ? s.act.kind : '-'} d=${Math.round(dist(s.x, s.y, cx, cy))}`); } }
    else s.cool['loneT'] = 0;
  }
}

// ---------- save, load, hash ----------
/** Terrain of the fixed island from data/tabe.json. */
export function islandTerrain(): number[] { const out: number[] = []; for (const r of TABE.rows as string[]) for (let i = 0; i < r.length; i++) out.push(MAP_CHARS[r[i]] ?? 0); return out; }
/** Saves leave out the fixed island terrain (it's reloaded from the map file). */
export function save(w: World): string { const t = w.map.terrain; const fixed = w.map.n === TABE.rows.length; if (fixed) w.map.terrain = []; const s = JSON.stringify(w); w.map.terrain = t; return s; }
export function load(s: string): World { const w = JSON.parse(s) as World; if (!w.map.terrain.length) w.map.terrain = islandTerrain(); return w; }
export function hashWorld(w: World): string {
  const s = JSON.stringify(w);
  let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0).toString(16);
}
export function runTicks(w: World, n: number): void { for (let i = 0; i < n; i++) step(w); }
export function runDays(w: World, d: number): void { runTicks(w, Math.round(d * CFG.DAY_TICKS)); }
export function summaryLine(w: World): string {
  const alive = w.scouts.filter((s) => s.status !== 'dead').length;
  return `day ${dayOf(w.tick)} ${hourOf(w.tick).toFixed(1)}h alive ${alive}/${w.scouts.length} fire=${fireLit(w)} wood=${stock(w, 'wood').toFixed(0)} food=${Math.round(foodPoints(w))} water=${stock(w, 'water').toFixed(0)} ammo=${Math.round(stock(w, 'ammo'))} account=${Math.round(w.ledger.credits)} cash=${Math.round(w.ledger.cash)} profit=${Math.round(w.ledger.income - w.ledger.spending)}`;
}
export { campXY };
