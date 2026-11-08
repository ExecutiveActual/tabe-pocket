// Core types, seeded RNG, island generation, pathfinding and line of sight.
// Determinism rule: the sim only uses + - * / Math.sqrt Math.floor Math.imul and the seeded RNG
// (all exactly specified by IEEE 754 / ECMAScript), never Math.random, Math.sin/cos/atan2/pow/exp or Date.
import { CFG, NeedId, Item, Trait, NEED_IDS, SkillId, AgeClass, TRAIT_FX } from './config';

export type Inv = Partial<Record<Item, number>>;
export type Status = 'ok' | 'downed' | 'dead' | 'recovering';

export interface LogEntry { n: number; t: number; who: string; text: string; kind: 'bark' | 'event' | 'warn' | 'combat' | 'boat' }

export interface Act {
  kind: string;            // activity or job kind
  label: string;           // human readable "current job"
  goal: string;            // camp-plan goal id it serves ('' for personal needs)
  target: number;          // entity id (tree, bush, deer, scout...) or -1
  tx: number; ty: number;  // where the work happens
  step: number; t: number; // step index and progress ticks inside the step
  started: number; until: number;
  path: number[] | null; pi: number; pathTo: number;
  buddy: number; leader: number; gid: number; n: number;
  item: Item | ''; actId: string;
  urgent: boolean;         // started because a need was urgent
  needBuddy: boolean;      // far work: waits for a buddy before leaving
  mode: string;            // job-specific mode (e.g. 'drag' | 'head')
}

export interface Thought { text: string; v: number }

export interface Scout {
  id: number; name: string; squad: number; trait: Trait; traits: Trait[]; rank: number; skills: Record<SkillId, number>;
  x: number; y: number; px: number; py: number; fx: number; fy: number;
  hp: number; maxHp: number; status: Status; bleed: number; recover: number; draggedBy: number;
  needs: Record<NeedId, number>; purse: number; morale: number; thoughts: Thought[];
  carry: Inv; mag: number; ammo: number; reload: number; guns: { type: string; cond: number }[]; jam: number; gear: number; wound: number; stabilized: boolean;
  act: Act | null; posture: 'stand' | 'crouch'; postureT: number; aimT: number; aimTarget: number; cooldown: number;
  thought: string; bark: string; barkUntil: number;
  threat: { id: number; x: number; y: number; t: number } | null; combat: boolean;
  sleeping: boolean; lastLeisure: number; idleT: number; stillT: number; failT: number;
  hist: number[][]; starts: number[]; joined: number; tag: string;
  lastMeal: number; lastDrink: number; stress: number; sick: number; cool: Record<string, number>; why: string; combatFlips: number[]; carcassMode: '' | 'drag'; clearT: number;
  sickKind: string; injuries: string[]; medicUntil: number; hangover: number; grief: number; together: Record<number, number>; homeBound: boolean; shipped: boolean;
}

export interface Deer { id: number; x: number; y: number; px: number; py: number; hp: number; herd: number; state: 'graze' | 'flee' | 'dead'; tx: number; ty: number; t: number }
export interface Carcass { id: number; x: number; y: number; kind: 'deer' | 'bird'; claim: number; t: number; age: AgeClass; cracked: boolean }
export interface Intel { id: number; pack: number; x: number; y: number; t: number; kind: 'sign' | 'call' | 'trail' | 'seen'; bird: number }
export interface Sign { id: number; x: number; y: number; t: number; pack: number; kind: 'tracks' | 'feathers' | 'droppings' | 'blood' }
export interface Bird {
  id: number; x: number; y: number; px: number; py: number; fx: number; fy: number; hp: number; pack: number;
  state: 'move' | 'charge' | 'flee' | 'idle' | 'dead'; tx: number; ty: number; target: number; peck: number;
  age: AgeClass; cracked: boolean; bleeding: boolean; flinch: number;
}
export interface Pack {
  id: number; kind: 'raid' | 'wild'; members: number[]; state: 'roam' | 'approach' | 'stalk' | 'charge' | 'withdraw' | 'gone';
  x: number; y: number; timer: number; target: number; size0: number; odds: number; spawned: number; reason: string; bull: number; bullLost: boolean; home: number;
}
export interface Tree { id: number; x: number; y: number; size: number; wood: number; timber: number; felled: boolean; regrow: number; claim: number }
export interface Bush { id: number; x: number; y: number; berries: number; regrow: number; claim: number; kind: string }
export interface FishSpot { id: number; x: number; y: number; fish: number; regrow: number; claim: number; trap: boolean }
export interface Gathering { id: number; actId: string; x: number; y: number; members: number[]; host: number; started: number; active: boolean; until: number }
export interface Bullet { id: number; x: number; y: number; px: number; py: number; dx: number; dy: number; left: number; owner: number; target: number; dmg: number; hunting: boolean }
export interface Build { x: number; y: number; built: boolean; progress: number; claim: number }
export interface Goal { id: string; kind: string; pri: number; slots: number; label: string; blockedUntil: number; reason: string; target?: number }

export interface Camp {
  sited: boolean; x: number; y: number; tree: number; packsDown: number;
  fire: Build & { fuel: number }; latrine: Build; builds: Record<string, Build>; proposals: string[]; stock: Inv;
  pile: { x: number; y: number }; cask: { x: number; y: number }; range: { x: number; y: number }; treat: { x: number; y: number };
  readyTick: { fire: number; latrine: number; wood: number };
}
export interface Order { ration: number; ammo: number; meds: number; tobacco: number; rum: number; guns: number; gear: number; scouts: number; why: string[] }
export interface Boat {
  state: 'away' | 'docked'; nextArrive: number; departAt: number; x: number; y: number; visits: number;
  cargo: Inv; crate: Inv; pending: Order | null; shop: Inv; crateGear: number; crateGuns: number;
}
export interface Ledger { income: number; spending: number; credits: number; cash: number; shipped: Inv }
/** All money the company can spend: account back home plus cash at camp. */
export function funds(w: { ledger: Ledger }): number { return w.ledger.credits + w.ledger.cash; }
/** Pay from camp cash; any shortfall falls on the home account (which may go into debt). */
export function payCash(w: { ledger: Ledger }, amt: number): void { const c = Math.min(Math.max(0, w.ledger.cash), amt); w.ledger.cash -= c; w.ledger.credits -= amt - c; w.ledger.spending += amt; }
/** Pay from the home account (hiring, orders). */
export function payHome(w: { ledger: Ledger }, amt: number): void { w.ledger.credits -= amt; w.ledger.spending += amt; }
/** Book sale proceeds: `toCamp` stays as camp cash, the rest goes home. */
export function receive(w: { ledger: Ledger }, amt: number, toCamp: number): void { const c = Math.max(0, Math.min(amt, toCamp)); w.ledger.cash += c; w.ledger.credits += amt - c; w.ledger.income += amt; }
/** Hook for later threats (bandits): camp cash can be stolen. */
export function stealCash(w: { ledger: Ledger }, amt: number): number { const n = Math.min(Math.max(0, w.ledger.cash), amt); w.ledger.cash -= n; return n; }
export interface DayReport {
  day: number; scouts: { name: string; status: Status; end: Record<string, number>; min: Record<string, number>; thoughts: string[] }[];
  stock: Inv; credits: number; profit: number; alive: number;
}
export interface Monitors { stuck: number; idle: number; oscillation: number; lone: number; exceptions: number; notes: string[] }
export interface Stats {
  shots: number; hits: number; birdKills: number; deerKills: number; deaths: number; downs: number; rescues: number;
  charges: number; withdraws: number; roukhaHunts: number; seasonFees: number; beaksSold: number; debtDays: number; license: number; wages: number; packsSpawned: number; phantomWork: number; boatsDone: number; shotTicks: number[];
  days: DayReport[]; mon: Monitors; dayMin: Record<number, Record<string, number>>; eaten: Inv; drank: number; leisure: Record<string, number>;
}
export interface Command { tick: number; player: string; kind: string; args: Record<string, number | string> }

export interface MapData { n: number; terrain: number[]; trail: Record<number, number> /* sparse per-tile foot traffic */; seen: number[]; water: number[] /* fresh-water distance (tiles), -1 unknown */ }

export interface World {
  seed: number; tick: number; rng: number; nextId: number;
  map: MapData; landing: { x: number; y: number; sx: number; sy: number }; wind: { x: number; y: number };
  scouts: Scout[]; deer: Deer[]; birds: Bird[]; packs: Pack[]; trees: Tree[]; bushes: Bush[]; fish: FishSpot[];
  carcasses: Carcass[]; gatherings: Gathering[]; bullets: Bullet[]; signs: Sign[]; intel: Intel[]; waterPts: number[]; rookeries: { id: number; x: number; y: number; eggs: number }[]; departed: string[]; spare: { type: string; cond: number }[];
  camp: Camp; boat: Boat; ledger: Ledger;
  plan: { commander: number; goals: Goal[]; watch: { id: number; until: number }; warned: Record<string, number> };
  weather: 'clear' | 'rain' | 'storm' | 'fog'; difficulty: string; season: number; deerRespawn: number; grief: number; scentBoost: number; pendingBuild: string;
  log: LogEntry[]; logN: number; stats: Stats; over: '' | 'wiped' | 'bankrupt'; raidCalm: number; commands: Command[]; flags: { noRoukha: boolean; noBoat: boolean; scenario: string };
}

// ---------- Terrain ----------
// Terrain. FOREST is jungle; ROCK is cliffs. Biomes from the fixed map: beach, grass, jungle, outback, mangrove, hills, cliffs.
export const T = { SEA: 0, SAND: 1, GRASS: 2, FOREST: 3, ROCK: 4, POND: 5, STREAM: 6, OUTBACK: 7, MANGROVE: 8, HILL: 9 };
export const PASSABLE = [false, true, true, true, false, false, true, true, true, true];
export const MOVE_COST = [0, 1.15, 1, 1.35, 0, 0, 2.2, 1.05, 2.0, 1.6];
export const SPEED_MUL = [0, 0.9, 1, 0.8, 0, 0, 0.55, 1.0, 0.5, 0.7];
/** Map file characters to terrain (data/tabe.json). */
export const MAP_CHARS: Record<string, number> = { '~': 0, '.': 1, ',': 2, J: 3, '^': 4, p: 5, s: 6, o: 7, m: 8, h: 9 };

// ---------- RNG (mulberry32, state kept in the world so saves are exact) ----------
export function rnd(w: { rng: number }): number {
  let t = (w.rng = (w.rng + 0x6d2b79f5) >>> 0);
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
export function rint(w: { rng: number }, a: number, b: number): number { return a + Math.floor(rnd(w) * (b - a + 1)); }
export function pick<X>(w: { rng: number }, arr: X[]): X { return arr[Math.floor(rnd(w) * arr.length)]; }

// ---------- small helpers ----------
export const dist = (ax: number, ay: number, bx: number, by: number): number => Math.sqrt((ax - bx) * (ax - bx) + (ay - by) * (ay - by));
export const d2 = (ax: number, ay: number, bx: number, by: number): number => (ax - bx) * (ax - bx) + (ay - by) * (ay - by);
export const clamp = (v: number, a: number, b: number): number => (v < a ? a : v > b ? b : v);
export const TPH = (): number => CFG.DAY_TICKS / 24; // ticks per in-game hour
export function hourOf(tick: number): number { const t = tick + CFG.START_HOUR * TPH(); return (t % CFG.DAY_TICKS) / TPH(); }
export function dayOf(tick: number): number { return Math.floor((tick + CFG.START_HOUR * TPH()) / CFG.DAY_TICKS) + 1; }
export function period(h: number): 'night' | 'dawn' | 'morning' | 'day' | 'evening' {
  if (h < CFG.DAWN_H || h >= CFG.NIGHT_H + 1.5) return 'night';
  if (h < 7) return 'dawn';
  if (h < 11) return 'morning';
  if (h < 17.5) return 'day';
  return 'evening';
}
export function isDark(h: number): boolean { return h < CFG.DAY_START_H || h >= CFG.NIGHT_H; }
export function clockStr(tick: number): string {
  const h = hourOf(tick); const hh = Math.floor(h); const mm = Math.floor((h - hh) * 60);
  return (hh < 10 ? '0' : '') + hh + ':' + (mm < 10 ? '0' : '') + mm;
}
export function invGet(inv: Inv, k: Item): number { return inv[k] || 0; }
export function invAdd(inv: Inv, k: Item, n: number): void { inv[k] = (inv[k] || 0) + n; if ((inv[k] || 0) <= 1e-9) delete inv[k]; }
export function invWeight(inv: Inv): number { let s = 0; for (const k in inv) s += (inv[k as Item] || 0) * CFG.WEIGHT[k as Item]; return s; }
export function newId(w: World): number { return w.nextId++; }
export function tileOf(w: World, x: number, y: number): number {
  const n = w.map.n; const tx = clamp(Math.floor(x / CFG.TILE_M), 0, n - 1); const ty = clamp(Math.floor(y / CFG.TILE_M), 0, n - 1);
  return ty * n + tx;
}
export function terrainAt(w: World, x: number, y: number): number { return w.map.terrain[tileOf(w, x, y)]; }
export function passableAt(w: World, x: number, y: number): boolean { return PASSABLE[terrainAt(w, x, y)]; }
export function tileCenter(w: World, i: number): [number, number] { const n = w.map.n; return [((i % n) + 0.5) * CFG.TILE_M, (Math.floor(i / n) + 0.5) * CFG.TILE_M]; }
export function isFresh(t: number): boolean { return t === T.POND || t === T.STREAM; }

export function addLog(w: World, who: string, text: string, kind: LogEntry['kind']): void {
  w.log.push({ n: ++w.logN, t: w.tick, who, text, kind });
  if (w.log.length > CFG.LOG_MAX) w.log.splice(0, w.log.length - CFG.LOG_MAX);
}

// ---------- Island generation ----------
function hash2(x: number, y: number, s: number): number {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(s | 0, 1442695041);
  h = Math.imul(h ^ (h >>> 13), 1274126177); h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
function vnoise(x: number, y: number, sc: number, s: number): number {
  const gx = x / sc, gy = y / sc, x0 = Math.floor(gx), y0 = Math.floor(gy);
  let fx = gx - x0, fy = gy - y0; fx = fx * fx * (3 - 2 * fx); fy = fy * fy * (3 - 2 * fy);
  const a = hash2(x0, y0, s), b = hash2(x0 + 1, y0, s), c = hash2(x0, y0 + 1, s), d = hash2(x0 + 1, y0 + 1, s);
  return (a + (b - a) * fx) * (1 - fy) + (c + (d - c) * fx) * fy;
}
function fbm(x: number, y: number, s: number): number { return vnoise(x, y, 26, s) * 0.55 + vnoise(x, y, 12, s + 7) * 0.3 + vnoise(x, y, 5, s + 13) * 0.15; }

/** Builds terrain. 'arena' gives a flat test field (grass, a pond, a grove) used by the behaviour tests. */
export function genTerrain(seed: number, n: number, kind: 'island' | 'arena'): number[] {
  const ter: number[] = new Array(n * n).fill(T.SEA);
  if (kind === 'arena') {
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      const edge = Math.min(x, y, n - 1 - x, n - 1 - y);
      ter[y * n + x] = edge < 3 ? T.SEA : edge < 6 ? T.SAND : T.GRASS;
    }
    return ter;
  }
  const c = (n - 1) / 2;
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const dx = (x - c) / (n * 0.46), dy = (y - c) / (n * 0.46);
    const d = Math.sqrt(dx * dx + dy * dy);
    const h = fbm(x, y, seed) * 0.6 + (1 - d) * 0.75 - 0.05;
    let t = T.SEA;
    if (h > 0.55) t = T.SAND;
    if (h > 0.62) t = T.GRASS;
    if (t === T.GRASS && vnoise(x, y, 9, seed + 101) > 0.56) t = T.FOREST;
    if (t !== T.SEA && t !== T.SAND && h > 0.72 && vnoise(x, y, 4, seed + 202) > 0.83) t = T.ROCK;
    ter[y * n + x] = t;
  }
  return ter;
}

/** Carves a pond and a stream to the sea; returns the pond centre tile. */
export function carveWater(w: { rng: number }, ter: number[], n: number): void {
  // pond: a grass/forest tile reasonably inland
  let best = -1, bestS = -1;
  for (let k = 0; k < 400; k++) {
    const x = rint(w, 10, n - 11), y = rint(w, 10, n - 11), t = ter[y * n + x];
    if (t !== T.GRASS && t !== T.FOREST) continue;
    let land = 0; for (let yy = -8; yy <= 8; yy += 2) for (let xx = -8; xx <= 8; xx += 2) if (ter[(y + yy) * n + x + xx] !== T.SEA) land++;
    const s = land + rnd(w);
    if (s > bestS) { bestS = s; best = y * n + x; }
  }
  if (best < 0) return;
  const px = best % n, py = Math.floor(best / n), r = 4 + rint(w, 0, 2);
  for (let y = -r; y <= r; y++) for (let x = -r; x <= r; x++) {
    if (x * x + y * y <= r * r + rint(w, -2, 2)) { const i = (py + y) * n + px + x; if (ter[i] !== T.SEA) ter[i] = T.POND; }
  }
  // stream: wander toward the nearest coast
  const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  let bd = 0, bl = 1e9;
  for (let k = 0; k < 4; k++) { let x = px, y = py, l = 0; while (x > 0 && y > 0 && x < n - 1 && y < n - 1 && ter[y * n + x] !== T.SEA) { x += dirs[k][0]; y += dirs[k][1]; l++; } if (l < bl) { bl = l; bd = k; } }
  let x = px, y = py, guard = 0;
  while (guard++ < 400 && x > 1 && y > 1 && x < n - 2 && y < n - 2) {
    const i = y * n + x; if (ter[i] === T.SEA) break;
    if (ter[i] !== T.POND) ter[i] = T.STREAM;
    const r2 = rnd(w);
    if (r2 < 0.7) { x += dirs[bd][0]; y += dirs[bd][1]; } else { const side = r2 < 0.85 ? 1 : -1; x += dirs[bd][1] * side; y += dirs[bd][0] * side; }
  }
}

// ---------- Pathfinding: A* on the tile grid, 8 directions, no corner cutting ----------
let PF_G: Float64Array = new Float64Array(0), PF_F: Float64Array = new Float64Array(0);
let PF_P: Int32Array = new Int32Array(0), PF_STAMP: Int32Array = new Int32Array(0), PF_CLOSED: Int32Array = new Int32Array(0);
let PF_GEN = 0;
const PF_HEAP: number[] = [];
function heapPush(i: number): void {
  const h = PF_HEAP; h.push(i); let k = h.length - 1;
  while (k > 0) { const p = (k - 1) >> 1; if (PF_F[h[p]] < PF_F[h[k]] || (PF_F[h[p]] === PF_F[h[k]] && h[p] < h[k])) break; const tmp = h[p]; h[p] = h[k]; h[k] = tmp; k = p; }
}
function heapPop(): number {
  const h = PF_HEAP; const top = h[0]; const last = h.pop() as number;
  if (h.length > 0) {
    h[0] = last; let k = 0;
    for (;;) {
      const l = 2 * k + 1, r = l + 1; let m = k;
      if (l < h.length && (PF_F[h[l]] < PF_F[h[m]] || (PF_F[h[l]] === PF_F[h[m]] && h[l] < h[m]))) m = l;
      if (r < h.length && (PF_F[h[r]] < PF_F[h[m]] || (PF_F[h[r]] === PF_F[h[m]] && h[r] < h[m]))) m = r;
      if (m === k) break; const tmp = h[m]; h[m] = h[k]; h[k] = tmp; k = m;
    }
  }
  return top;
}
export let PATH_CALLS = 0;
/** Returns tile indices from start to goal (inclusive) or null if unreachable. maxNodes bounds the search. */
export function findPath(w: World, from: number, to: number, maxNodes = 12000): number[] | null {
  PATH_CALLS++;
  const n = w.map.n, N = n * n, ter = w.map.terrain;
  if (!PASSABLE[ter[to]] || !PASSABLE[ter[from]]) return null;
  if (from === to) return [to];
  if (PF_G.length !== N) { PF_G = new Float64Array(N); PF_F = new Float64Array(N); PF_P = new Int32Array(N); PF_STAMP = new Int32Array(N); PF_CLOSED = new Int32Array(N); }
  PF_GEN++; PF_HEAP.length = 0;
  const tx = to % n, ty = Math.floor(to / n);
  const hfun = (i: number): number => { const dx = Math.abs((i % n) - tx), dy = Math.abs(Math.floor(i / n) - ty); return (dx + dy + (1.4142 - 2) * Math.min(dx, dy)); };
  PF_STAMP[from] = PF_GEN; PF_G[from] = 0; PF_F[from] = hfun(from); PF_P[from] = -1; heapPush(from);
  let expanded = 0;
  while (PF_HEAP.length) {
    const cur = heapPop();
    if (PF_CLOSED[cur] === PF_GEN) continue;
    PF_CLOSED[cur] = PF_GEN;
    if (cur === to) break;
    if (++expanded > maxNodes) return null;
    const cx = cur % n, cy = Math.floor(cur / n);
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dy) continue;
      const nx = cx + dx, ny = cy + dy; if (nx < 0 || ny < 0 || nx >= n || ny >= n) continue;
      const ni = ny * n + nx; if (!PASSABLE[ter[ni]]) continue;
      if (dx && dy && (!PASSABLE[ter[cy * n + nx]] || !PASSABLE[ter[ny * n + cx]])) continue;
      const g = PF_G[cur] + (dx && dy ? 1.4142 : 1) * MOVE_COST[ter[ni]] * ((w.map.trail[ni] || 0) >= 40 ? 0.85 : 1); // worn trails are preferred
      if (PF_STAMP[ni] === PF_GEN && (PF_CLOSED[ni] === PF_GEN || g >= PF_G[ni])) continue;
      PF_STAMP[ni] = PF_GEN; PF_G[ni] = g; PF_F[ni] = g + hfun(ni); PF_P[ni] = cur; heapPush(ni);
    }
  }
  if (PF_CLOSED[to] !== PF_GEN) return null;
  const out: number[] = []; let k = to; while (k >= 0) { out.push(k); k = PF_P[k]; }
  out.reverse();
  return smoothPath(w, out);
}
/** Drops waypoints that are in straight walkable sight of each other (fewer zig-zags). */
function smoothPath(w: World, p: number[]): number[] {
  if (p.length < 3) return p;
  const out = [p[0]]; let a = 0;
  while (a < p.length - 1) {
    let b = Math.min(p.length - 1, a + 12);
    while (b > a + 1 && !walkLine(w, p[a], p[b])) b--;
    out.push(p[b]); a = b;
  }
  return out;
}
function walkLine(w: World, a: number, b: number): boolean {
  const n = w.map.n; const [ax, ay] = tileCenter(w, a), [bx, by] = tileCenter(w, b);
  const steps = Math.ceil(dist(ax, ay, bx, by) / 0.5);
  let cost0 = MOVE_COST[w.map.terrain[a]];
  for (let s = 1; s <= steps; s++) {
    const x = ax + ((bx - ax) * s) / steps, y = ay + ((by - ay) * s) / steps;
    const i = tileOf(w, x, y); const t = w.map.terrain[i];
    if (!PASSABLE[t] || MOVE_COST[t] > cost0 + 0.01) return false;
    // keep a body-width clearance off blocked tiles
    for (const [ox, oy] of [[0.45, 0], [-0.45, 0], [0, 0.45], [0, -0.45]]) if (!PASSABLE[w.map.terrain[tileOf(w, x + ox, y + oy)]]) return false;
  }
  void n; cost0 = 0; return true;
}
/** Nearest passable tile centre to (x,y) within r tiles. */
export function nearestPassable(w: World, x: number, y: number, r = 12): [number, number] | null {
  const n = w.map.n, cx = Math.floor(x / CFG.TILE_M), cy = Math.floor(y / CFG.TILE_M);
  for (let rr = 0; rr <= r; rr++) {
    let best: [number, number] | null = null, bd = 1e9;
    for (let yy = cy - rr; yy <= cy + rr; yy++) for (let xx = cx - rr; xx <= cx + rr; xx++) {
      if (xx < 0 || yy < 0 || xx >= n || yy >= n) continue;
      if (Math.max(Math.abs(xx - cx), Math.abs(yy - cy)) !== rr) continue;
      if (!PASSABLE[w.map.terrain[yy * n + xx]]) continue;
      const px = (xx + 0.5) * CFG.TILE_M, py = (yy + 0.5) * CFG.TILE_M, dd = d2(px, py, x, y);
      if (dd < bd) { bd = dd; best = [px, py]; }
    }
    if (best) return best;
  }
  return null;
}

// ---------- Line of sight: rocks block, more than ~12 m of forest blocks ----------
export function hasLOS(w: World, ax: number, ay: number, bx: number, by: number): boolean {
  const d = dist(ax, ay, bx, by); const steps = Math.ceil(d); let forest = 0;
  for (let s = 1; s < steps; s++) {
    const t = terrainAt(w, ax + ((bx - ax) * s) / steps, ay + ((by - ay) * s) / steps);
    if (t === T.ROCK) return false;
    if (t === T.FOREST || t === T.MANGROVE) { forest++; if (forest > 12) return false; }
  }
  return true;
}

/** Product of a numeric trait effect over all of a scout's traits (1 if none apply). */
export function tfx(s: { traits: Trait[] }, key: 'aim' | 'cone' | 'social' | 'drink' | 'sick' | 'hp' | 'danger'): number {
  let m = 1; for (const t of s.traits) { const v = TRAIT_FX[t][key]; if (v !== undefined) m *= v; } return m;
}
export function hasTrait(s: { traits: Trait[] }, t: Trait): boolean { return s.traits.indexOf(t) >= 0; }
export function wakeOffset(s: { traits: Trait[] }): number { let o = 0; for (const t of s.traits) o += TRAIT_FX[t].wake || 0; return o; }
export function needsFull(): Record<NeedId, number> { const o = {} as Record<NeedId, number>; for (const k of NEED_IDS) o[k] = 100; return o; }
