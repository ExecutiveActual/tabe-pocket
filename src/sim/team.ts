// Teams and help requests (v1.1).
// Nearly all work beyond the camp perimeter (CFG.FAR_M) is done in pairs or threes. The man who takes such a job
// posts a request for the men he needs (CFG.TEAM_SIZE) and waits at a rally point. Every other scout weighs what
// he is doing against the request's urgency and answers one of three ways:
//   now      - drops it and comes ("Right behind you")
//   promise  - "gimme a sec, finishing the fire": he comes when his job is done and the leader waits for him
//   first    - his own job is critical: "give me a hand with this first": the leader helps him, then they go
// The team links up at the rally point, leaves together and moves together (the leader waits for stragglers).
// If nobody can come the leader falls back: go with a smaller team, go alone only on a short low-risk daytime job,
// or call it off. In camp, men also join each other's jobs (building, cooking, processing...) for joint work:
// faster with diminishing returns (CFG.TEAM_WORK), and a little better (CFG.TEAM_QUALITY).
// Everything here is deterministic: no RNG, scouts are visited in array order.
import { CFG } from './config';
import { World, Scout, Act, Team, dist, TPH, hourOf, isDark, addLog } from './core';
import { able, say, mkAct, startAct, endAct, campXY, campAlert, moveTo, fireSeat, built, byId } from './ai';

export const JOINABLE = ['build', 'cook', 'smokeMeat', 'process', 'scrape', 'chop', 'fell'];
const LOW_RISK = ['chop', 'forage', 'fish', 'fetchWater'];

const distCamp = (w: World, x: number, y: number): number => { const [cx, cy] = campXY(w); return dist(x, y, cx, cy); };
const sc = (w: World, id: number): Scout | undefined => w.scouts.find((x) => x.id === id);
const goalPri = (w: World, id: string): number => { const g = w.plan.goals.find((x) => x.id === id); return g ? g.pri : 1.0; };
const urgentNeed = (s: Scout): boolean => s.needs.food < CFG.NEED_URGENT || s.needs.water < CFG.NEED_URGENT || s.needs.rest < CFG.NEED_URGENT / 2;
const metersPerHour = (): number => (CFG.WALK_MS * CFG.SCOUT_SPEED_MUL / CFG.TICK_HZ) * TPH();

/** Men needed for an outside job, counting the leader (data: CFG.TEAM_SIZE). */
export function teamSizeFor(w: World, a: Act): number {
  let key = a.kind;
  if (a.kind === 'loot') { const c = w.carcasses.find((x) => x.id === a.target); key = c && c.kind === 'bird' ? 'loot' + c.age : 'lootDeer'; }
  return CFG.TEAM_SIZE[key] ?? 2;
}
/** "Need a hand {x}" */
function jobNoun(w: World, a: Act): string {
  if (a.kind === 'loot') { const c = w.carcasses.find((x) => x.id === a.target); return !c || c.kind === 'bird' ? (c && c.age === 'B' ? 'hauling that bull' : 'hauling that bird') : 'butchering a deer'; }
  return ({ chop: 'with the firewood', fell: 'felling timber', forage: 'foraging', fish: 'at the fish traps', fetchWater: 'on the water run', hunt: 'hunting deer', rhunt: 'after the Roukha', explore: 'scouting past the treeline' } as Record<string, string>)[a.kind] || 'out there';
}
/** "Gimme a sec, finishing the {x}" */
export function actNoun(a: Act | null): string {
  if (!a) return 'job';
  if (a.kind === 'build') return a.mode === 'fire' ? 'fire' : a.mode === 'latrine' ? 'latrine' : 'building';
  return ({ cook: 'pot', smokeMeat: 'racks', process: 'bird', scrape: 'hides', eat: 'grub', drink: 'drink', fuel: 'fire', chop: 'wood', fell: 'timber', maint: 'rifle', warm: 'warm-up', leisure: 'hand', treat: 'patching up', load: 'drop-off', forage: 'picking', fetchWater: 'water', assist: 'job' } as Record<string, string>)[a.kind] || 'job';
}

// ---------- who is following whom ----------
/** Followers who have joined s's team and are with him. */
export function crewOf(w: World, s: Scout): Scout[] {
  const t = s.act && s.act.team; if (!t) return [];
  const out: Scout[] = [];
  for (const id of t.crew) { const b = sc(w, id); if (b && able(b) && b.act && b.act.kind === 'buddy' && b.act.leader === s.id) out.push(b); }
  return out;
}
/** Men working alongside s right now: his crew at the job, mates assisting him, a leader helping him first. */
export function helpersOf(w: World, s: Scout): Scout[] {
  const out: Scout[] = [];
  for (const o of w.scouts) {
    if (o === s || !o.act || !able(o) || o.sleeping || o.combat) continue;
    const a = o.act;
    const helping = (a.kind === 'assist' && a.leader === s.id) || (a.kind === 'buddy' && a.leader === s.id) || (!!a.team && a.team.phase === 'rally' && a.team.helpWith === s.id);
    if (helping && dist(o.x, o.y, s.x, s.y) <= CFG.ASSIST_RANGE_M) out.push(o);
  }
  return out;
}
/** Work multiplier and quality bonus for s's job given the helpers with him (diminishing returns, data). */
export function teamWork(w: World, s: Scout): { mul: number; quality: number; k: number } {
  const k = Math.min(helpersOf(w, s).length, CFG.TEAM_WORK.length - 1);
  if (k > 0) w.stats.team.helpTicks++;
  return { mul: CFG.TEAM_WORK[k], quality: CFG.TEAM_QUALITY[Math.min(k, CFG.TEAM_QUALITY.length - 1)], k };
}
/** Drag speed multiplier: more men on the rope, faster. */
export function dragMul(w: World, s: Scout): number {
  const men = 1 + crewOf(w, s).filter((b) => dist(b.x, b.y, s.x, s.y) < 6).length;
  return CFG.CARCASS_DRAG_TEAM[Math.min(men, CFG.CARCASS_DRAG_TEAM.length - 1)];
}

// ---------- how much is a man's current work worth, and how long until he's done ----------
export function actValue(w: World, o: Scout): number {
  const a = o.act; if (!a) return 0;
  if (a.urgent) return 99;
  switch (a.kind) {
    case 'idle': return 0;
    case 'leisure': return 0.4;
    case 'warm': return 0.6;
    case 'maint': return 0.7;
    case 'drink': return 1.0;
    case 'eat': return 1.5;
    case 'assist': { const l = sc(w, a.leader); return l && l.act ? goalPri(w, l.act.goal) * 0.6 : 0.3; }
    case 'load': return a.goal ? 3.0 : 3.0;   // loading the boat, or dropping off a haul: finish first
    case 'sleep': case 'watch': case 'rescue': case 'treat': case 'meetBoat': case 'unpack': case 'buddy': case 'unload': return 99;
  }
  if (a.team || a.needBuddy) return 99;
  return a.goal ? goalPri(w, a.goal) : 1.0;
}
export function remainingH(w: World, o: Scout): number {
  const a = o.act; if (!a) return 0;
  const tph = TPH(), mph = metersPerHour();
  const [px, py] = [w.camp.pile.x, w.camp.pile.y];
  const travel = (x: number, y: number): number => dist(o.x, o.y, x, y) / mph;
  const left = (h: number): number => Math.max(0, h - a.t / tph);
  switch (a.kind) {
    case 'idle': return Math.max(0, a.until - w.tick) / tph;
    case 'leisure': { const g = w.gatherings.find((x) => x.id === a.gid); return g && g.active ? Math.max(0, g.until - w.tick) / tph : 0.2; }
    case 'eat': return 0.15 + travel(a.tx, a.ty); case 'drink': return 0.1 + travel(a.tx, a.ty); case 'warm': return 0.3 + travel(a.tx, a.ty);
    case 'fuel': return 0.05 + travel(a.tx, a.ty);
    case 'build': {
      const b = a.mode === 'fire' ? w.camp.fire : a.mode === 'latrine' ? w.camp.latrine : w.camp.builds[a.mode];
      const def = CFG.BUILDINGS.find((x) => x.id === a.mode); const hrs = def ? def.hours : CFG.BUILD_H[a.mode] || 1;
      return (b ? Math.max(0, hrs * tph - b.progress) / tph : hrs) + travel(a.tx, a.ty);
    }
    case 'cook': return left(CFG.COOK_H) + travel(a.tx, a.ty);
    case 'smokeMeat': return left(CFG.SMOKE_H / (built(w, 'racks') ? CFG.SMOKE_RACK_MUL : 1)) + travel(a.tx, a.ty);
    case 'scrape': return left(CFG.SCRAPE_H / (built(w, 'racks') ? 1.5 : 1)) + travel(a.tx, a.ty);
    case 'process': return left((CFG.PROCESS_H / (built(w, 'butcher') ? 1.5 : 1)) * (1.3 - o.skills.butchering / 200)) + travel(a.tx, a.ty);
    case 'maint': return left(CFG.MAINT_H);
    case 'chop': case 'fell': case 'forage': case 'fish': case 'fetchWater': {
      const H = a.kind === 'chop' ? CFG.CHOP_H : a.kind === 'fell' ? CFG.FELL_H : a.kind === 'forage' ? CFG.FORAGE_H : a.kind === 'fish' ? CFG.FISH_H : CFG.FILL_H;
      const back = dist(a.tx, a.ty, px, py) / mph;
      if (a.step === 0) return travel(a.tx, a.ty) + H + back;
      if (a.step === 1) return left(H) + back;
      return travel(px, py);
    }
    case 'load': return travel(px, py) + 0.05;
  }
  return 1;
}

// ---------- posting a request ----------
export function openTeam(w: World, s: Scout, a: Act): Team {
  const [cx, cy] = campXY(w);
  const inCamp = dist(s.x, s.y, cx, cy) < CFG.FAR_M;
  const urg = CFG.TEAM_URGENCY[a.kind] ?? goalPri(w, a.goal);
  // out there, the team re-forms on the spot only if a mate close by would come straight away (e.g. after a fight);
  // otherwise the leader walks back and the team links up in camp
  const mateNear = w.scouts.some((o) => o !== s && able(o) && o.status === 'ok' && !o.sleeping && dist(o.x, o.y, s.x, s.y) < CFG.TEAM_RALLY_MATE_M && actValue(w, o) + CFG.TEAM_DROP_MARGIN <= urg);
  const [rx, ry] = inCamp || mateNear || !w.camp.sited ? [s.x, s.y] : fireSeat(w, s, 6);
  const need = teamSizeFor(w, a);
  const t: Team = { need, urg, crew: [], promised: [], helpWith: -1, phase: 'rally', posted: w.tick, waitT: 0, asked: {}, noun: jobNoun(w, a), rx, ry };
  a.team = t; a.buddy = -1;
  w.stats.team.requests++;
  say(w, s, need >= 3 ? 'teamAsk3' : 'teamAsk', { x: t.noun });
  return t;
}
function syncBuddy(a: Act): void { a.buddy = a.team && a.team.crew.length ? a.team.crew[0] : -1; }
/** s joins L's team now: starts following. Returns the follower act (caller starts it) . */
export function joinAct(w: World, L: Scout, s: Scout, how: 'now' | 'promise'): Act {
  const t = L.act!.team!;
  if (t.crew.indexOf(s.id) < 0) t.crew.push(s.id);
  t.promised = t.promised.filter((x) => x !== s.id); s.promise = -1; syncBuddy(L.act!);
  if (how === 'now') w.stats.team.now++;
  say(w, s, 'teamNow', { n: L.name });
  return mkAct('buddy', 'Going with ' + L.name + ' (' + t.noun + ')', '', L.x, L.y, { leader: L.id });
}
/** Is there an open request s could join right now (used by decide)? */
export function openRequests(w: World, s: Scout): Scout[] {
  if (s.status !== 'ok' || s.tag === 'pack' || urgentNeed(s)) return [];
  return w.scouts.filter((L) => L !== s && able(L) && !!L.act && !!L.act.team && L.act.team.phase === 'rally' && 1 + L.act.team.crew.length + L.act.team.promised.length < L.act.team.need);
}

// ---------- answering requests (every DECIDE_EVERY ticks) ----------
type Answer = 'now' | 'promise' | 'first' | 'no' | 'skip';
export function answer(w: World, L: Scout, t: Team, o: Scout): Answer {
  if (o === L || !able(o) || o.status !== 'ok' || o.sleeping || o.combat || o.tag === 'pack' || o.promise >= 0) return 'skip';
  if (t.crew.indexOf(o.id) >= 0 || t.promised.indexOf(o.id) >= 0) return 'skip';
  if (o.act && (o.act.kind === 'buddy' || o.act.team || (o.act.kind === 'assist' && o.act.leader === L.id))) return 'skip';
  if (urgentNeed(o)) return 'skip';
  if ((t.asked[o.id] || -1e9) > w.tick) return 'skip';
  const v = actValue(w, o);
  if (v >= 50) return 'no';
  if (v + CFG.TEAM_DROP_MARGIN <= t.urg) return 'now';
  if (remainingH(w, o) <= CFG.TEAM_PROMISE_MAX_H) return 'promise';   // (his trip back counts: remainingH includes travel)
  const a = o.act;
  if (a && JOINABLE.indexOf(a.kind) >= 0 && !a.needBuddy && t.helpWith < 0 && distCamp(w, a.tx, a.ty) < CFG.FAR_M && distCamp(w, L.x, L.y) < CFG.FAR_M) return 'first';
  return 'no';
}
export function teamTick(w: World): void {
  for (const L of w.scouts) {
    const t = L.act && L.act.team; if (!t || t.phase !== 'rally' || !able(L)) continue;
    // tidy: drop crew who left, promises that lapsed, a "help first" whose job is over
    t.crew = t.crew.filter((id) => { const b = sc(w, id); return !!b && able(b) && !!b.act && b.act.kind === 'buddy' && b.act.leader === L.id; });
    t.promised = t.promised.filter((id) => { const b = sc(w, id); return !!b && able(b) && b.promise === L.id; });
    if (t.helpWith >= 0) { const h = sc(w, t.helpWith); if (!h || !h.act || JOINABLE.indexOf(h.act.kind) < 0 || t.promised.indexOf(h.id) < 0) t.helpWith = -1; }
    syncBuddy(L.act!);
    if (1 + t.crew.length + t.promised.length >= t.need) continue;
    const answers: { o: Scout; r: Answer; d: number }[] = [];
    for (const o of w.scouts) { const r = answer(w, L, t, o); if (r !== 'skip') answers.push({ o, r, d: dist(o.x, o.y, L.x, L.y) }); }
    const rank: Record<Answer, number> = { now: 0, promise: 1, first: 2, no: 3, skip: 4 };
    answers.sort((p, q) => rank[p.r] - rank[q.r] || p.d - q.d || p.o.id - q.o.id);
    for (const { o, r } of answers) {
      if (1 + t.crew.length + t.promised.length >= t.need) break;
      if (r === 'now') { endAct(w, o, 'joining ' + L.name); startAct(w, o, joinAct(w, L, o, 'now')); o.why = 'team'; }
      else if (r === 'promise') { o.promise = L.id; t.promised.push(o.id); w.stats.team.promise++; say(w, o, 'teamSec', { x: actNoun(o.act), n: L.name }); }
      else if (r === 'first') { o.promise = L.id; t.promised.push(o.id); t.helpWith = o.id; w.stats.team.helpFirst++; say(w, o, 'teamFirst', { x: actNoun(o.act), n: L.name }); }
      else { t.asked[o.id] = w.tick + CFG.TEAM_REASK_H * TPH(); w.stats.team.refused++; }
    }
  }
}

// ---------- the leader at the rally point ----------
function lowRisk(w: World, a: Act): boolean {
  const h = hourOf(w.tick);
  if (LOW_RISK.indexOf(a.kind) < 0 || isDark(h) || h >= CFG.DUSK_H - 1) return false;
  if (distCamp(w, a.tx, a.ty) > CFG.TEAM_SOLO_MAX_M || campAlert(w)) return false;
  return !w.intel.some((i) => w.tick - i.t < 2 * TPH() && dist(i.x, i.y, a.tx, a.ty) < CFG.TEAM_SOLO_INTEL_M);
}
function depart(w: World, L: Scout, t: Team, how: 'full' | 'smaller' | 'solo'): void {
  t.phase = 'go';
  for (const id of t.promised) { const b = sc(w, id); if (b && b.promise === L.id) b.promise = -1; }
  t.promised = []; t.helpWith = -1;
  const ts = w.stats.team; ts.departed++; ts[how]++; ts.waitTicks += t.waitT; ts.maxWait = Math.max(ts.maxWait, t.waitT);
  say(w, L, how === 'full' ? 'teamGo' : how === 'smaller' ? 'teamSmaller' : 'teamSolo');
  L.act!.path = null;
}
function cancel(w: World, L: Scout, t: Team, why: string): void {
  w.stats.team.cancelled++; w.stats.team.waitTicks += t.waitT; w.stats.team.maxWait = Math.max(w.stats.team.maxWait, t.waitT);
  say(w, L, 'teamCancel', {}, 'warn');
  L.cool['far'] = w.tick + 1.5 * TPH();
  if (L.act && L.act.goal) L.cool['goal:' + L.act.goal] = w.tick + 1 * TPH();
  endAct(w, L, why);
}
/** Runs the leader's rally phase. Returns true while the team is still forming (the job itself waits). */
export function leaderRally(w: World, s: Scout, a: Act): boolean {
  const t = a.team || openTeam(w, s, a);
  if (t.phase === 'go') return false;
  const tph = TPH();
  t.waitT++;
  // help me first: the leader lends a hand on the other man's camp job until it's done
  const h = t.helpWith >= 0 ? sc(w, t.helpWith) : undefined;
  if (h && h.act && JOINABLE.indexOf(h.act.kind) >= 0) {
    if (dist(s.x, s.y, h.x, h.y) > 2.2) { if (moveTo(w, s, h.x + 1.2, h.y + 0.8) < 0) t.helpWith = -1; }
    else { s.posture = 'crouch'; s.stillT = 0; }
    s.thought = `Helping ${h.name} with the ${actNoun(h.act)} first, then ${t.noun}`;
  } else {
    if (moveTo(w, s, t.rx, t.ry) < 0) { t.rx = s.x; t.ry = s.y; }
    if (dist(s.x, s.y, t.rx, t.ry) < 1) s.posture = 'crouch';
    const have = 1 + t.crew.length;
    s.thought = `${a.label}: waiting for ${t.need - have} more` + (t.promised.length ? ` (${t.promised.map((id) => sc(w, id)?.name).join(', ')} coming)` : '');
  }
  const crew = crewOf(w, s);
  const linked = t.helpWith < 0 && crew.every((b) => dist(b.x, b.y, s.x, s.y) <= CFG.TEAM_LINK_M);
  if (1 + crew.length >= t.need && linked) { depart(w, s, t, 'full'); return true; }
  // safety net, counted as a deadlock: a request must never hang (the fallbacks below should always fire first)
  if (t.waitT > (CFG.TEAM_WAIT_MAX_H + 0.5) * tph) { w.stats.team.deadlocks++; w.stats.mon.notes.push(`team deadlock ${s.name} t${w.tick} ${a.kind}`); cancel(w, s, t, 'team never formed'); return true; }
  const waited = t.waitT / tph;
  const giveUp = (waited > CFG.TEAM_WAIT_H && t.promised.length === 0) || waited > CFG.TEAM_WAIT_MAX_H;
  if (giveUp) {
    // whoever has joined goes; the leader's go() waits for anyone still walking over, so they link up on the way
    if (crew.length >= 1) { depart(w, s, t, 1 + crew.length >= t.need ? 'full' : 'smaller'); return true; }
    if (lowRisk(w, a)) { depart(w, s, t, 'solo'); return true; }
    cancel(w, s, t, 'no team'); return true;
  }
  return true;
}
/** The leader waits for any of his team who are lagging (nobody gets left alone out there). */
export function crewLagging(w: World, s: Scout): boolean {
  if (crewOf(w, s).some((b) => dist(b.x, b.y, s.x, s.y) > 14)) return true;
  return mateFighting(w, s);
}
/** A mate of s's team (out there) dropped out to fight close by: the leader holds until he's back. */
export function mateFighting(w: World, s: Scout): boolean {
  const t = s.act && s.act.team; if (!t || t.phase !== 'go') return false;
  return t.promised.some((id) => { const b = sc(w, id); return !!b && able(b) && b.status === 'ok' && b.promise === s.id && dist(b.x, b.y, s.x, s.y) < 45; });
}
/** The leader's team out there has nobody left (all down, gone or far): a job that must not be done alone is abandoned. */
export function teamLost(w: World, s: Scout): boolean {
  const a = s.act, t = a && a.team; if (!a || !t || t.phase !== 'go' || t.need < 2 || lowRisk(w, a)) return false;
  if (crewOf(w, s).length > 0) return false;
  t.promised = t.promised.filter((id) => { const b = sc(w, id); return !!b && able(b) && b.status === 'ok' && b.promise === s.id; });
  return t.promised.length === 0;
}

// ---------- endAct bookkeeping ----------
export function teamEnded(w: World, s: Scout, a: Act): void {
  if (a.team) {
    for (const id of a.team.crew) { const b = sc(w, id); if (b && b.act && b.act.kind === 'buddy' && b.act.leader === s.id) endAct(w, b, 'team done'); }
    for (const id of a.team.promised) { const b = sc(w, id); if (b && b.promise === s.id) b.promise = -1; }
  }
  if (a.kind === 'buddy' && a.leader >= 0) {
    const l = sc(w, a.leader); const t = l && l.act && l.act.team;
    if (t) {
      t.crew = t.crew.filter((x) => x !== s.id); syncBuddy(l!.act!);
      // dropped out to fight: he's still on the team and rejoins when the fight is over (the leader holds for him)
      if (s.combat && t.phase === 'go' && able(s) && t.promised.indexOf(s.id) < 0) { t.promised.push(s.id); s.promise = l!.id; }
    }
  }
}

// ---------- followers and helpers ----------
type R = 'run' | 'done' | 'fail';
export function buddyStep(w: World, s: Scout, a: Act): R {
  const l = sc(w, a.leader); const t = l && l.act && l.act.team;
  if (!l || !t || t.crew.indexOf(s.id) < 0 || !able(l)) return 'done';
  const la = l.act!;
  if (t.phase === 'rally') {
    // form up in a loose line beside the leader (not on top of him)
    const k = t.crew.indexOf(s.id), off = [[-2.4, 1.4], [2.4, 1.4], [0, 2.8], [-2.4, -1.4]][k % 4];
    const gx = l.x + off[0], gy = l.y + off[1];
    if (dist(s.x, s.y, gx, gy) > 0.8 && dist(s.x, s.y, l.x, l.y) > 1.5) { if (moveTo(w, s, gx, gy, 1.08) < 0 && moveTo(w, s, l.x, l.y, 1.08) < 0) return 'fail'; }
    else { s.posture = 'crouch'; s.stillT = 0; }
    s.thought = `Waiting with ${l.name} to go ${t.noun}`;
    return 'run';
  }
  const working = la.step === 1 && dist(l.x, l.y, la.tx, la.ty) < 3;
  const dragging = l.carcassMode === 'drag';
  const keep = working ? 2.2 : dragging ? 2.6 : CFG.BUDDY_KEEP_M * 0.6;
  if (dragging) {   // on the rope: pull alongside the leader, one each side (the bird is behind them)
    const side = t.crew.indexOf(s.id) % 2 === 0 ? 1 : -1, gx = l.x - l.fy * 1.4 * side + l.fx * 0.3, gy = l.y + l.fx * 1.4 * side + l.fy * 0.3;
    if (dist(s.x, s.y, gx, gy) > 0.7) { if (moveTo(w, s, gx, gy, 1.12) < 0 && moveTo(w, s, l.x, l.y, 1.12) < 0) return 'fail'; } else { s.fx = l.fx; s.fy = l.fy; s.stillT = 0; }
  } else if (dist(s.x, s.y, l.x, l.y) > keep) { if (moveTo(w, s, l.x, l.y, 1.08) < 0) return 'fail'; }
  else { s.posture = working ? 'crouch' : s.posture; s.stillT = 0; if (!working) s.posture = 'crouch'; }
  s.thought = working ? `Helping ${l.name}: ${la.label.toLowerCase()}` : dragging ? `On the rope with ${l.name}, hauling the bird` : `With ${l.name}: ${la.label.toLowerCase()}`;
  return 'run';
}
/** decide(): candidate camp jobs s could lend a hand on (joint work). */
export function assistOptions(w: World, s: Scout): { L: Scout; gain: number; pri: number }[] {
  if (s.status !== 'ok' || !w.camp.sited) return [];
  const out: { L: Scout; gain: number; pri: number }[] = [];
  for (const L of w.scouts) {
    const a = L.act; if (L === s || !a || !able(L) || JOINABLE.indexOf(a.kind) < 0 || a.needBuddy || a.step > 1) continue;
    if (distCamp(w, a.tx, a.ty) >= CFG.FAR_M) continue;
    const max = CFG.ASSIST_MAX[a.kind] ?? 0; if (max <= 0) continue;
    const k = w.scouts.filter((o) => o.act && o.act.kind === 'assist' && o.act.leader === L.id).length;
    if (k >= max) continue;
    if (remainingH(w, L) < CFG.ASSIST_MIN_LEFT_H + 0.05) continue;
    const T = CFG.TEAM_WORK; const kk = Math.min(k, T.length - 2);
    out.push({ L, gain: (T[kk + 1] - T[kk]) / (T[1] - T[0]), pri: goalPri(w, a.goal) });
  }
  return out;
}
export function assistAct(w: World, s: Scout, L: Scout): Act {
  w.stats.team.assists++;
  say(w, s, 'assist', { n: L.name });
  return mkAct('assist', `Helping ${L.name}: ${L.act!.label.toLowerCase()}`, '', L.x, L.y, { leader: L.id, n: L.act!.started, item: '' });
}
export function assistStep(w: World, s: Scout, a: Act): R {
  const l = sc(w, a.leader);
  if (!l || !l.act || !able(l) || l.act.started !== a.n || JOINABLE.indexOf(l.act.kind) < 0) return 'done';
  const la = l.act;
  const hauling = la.step >= 2;
  const [gx, gy] = hauling ? [l.x, l.y] : [la.tx + ((s.id % 3) - 1) * 1.3, la.ty + 1.1];
  if (dist(s.x, s.y, gx, gy) > (hauling ? 3 : 1)) { if (moveTo(w, s, gx, gy, 1.05) < 0) return 'fail'; }
  else { s.posture = 'crouch'; s.stillT = 0; }
  s.thought = `Helping ${l.name}: ${la.label.toLowerCase()}`;
  return 'run';
}
void byId; void addLog;
