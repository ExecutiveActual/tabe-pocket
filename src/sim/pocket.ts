// Pocket rations (v1.2). Food is counted in points (a full meal = 100, the scout's food meter). Before heading out of
// camp a scout takes non-spoiling food (CFG.POCKET_PREF, ~CFG.POCKET_PTS) from the stores if there is any; out there,
// when he gets hungry and has a quiet moment, he eats from his pocket instead of walking back. Whatever he didn't eat
// goes back into the stores once he is home with nothing more to do outside. Food that spoils is never pocketed: with
// only fresh food in camp, scouts walk back to eat as before.
import { CFG, FOOD, SPECIES, type Item } from './config';
import { dist, invAdd, invGet, type Scout, type World } from './core';
import { campXY, say } from './ai';

const SAFE = (): number => SPECIES.scout.home.safeR;
const F = (k: Item): { pts: number; spoils: boolean } => FOOD[k] || { pts: 0, spoils: true };
export function pocketPts(s: Scout): number { let p = 0; for (const k in s.pocket) p += (s.pocket[k as Item] || 0) * (FOOD[k as Item]?.pts || 0); return p; }
function outsideAct(w: World, s: Scout): boolean {
  const a = s.act; if (!a || a.kind === 'combat' || a.kind === 'rescue' || a.kind === 'sleep') return false;
  // a follower's own act points at where his leader stood when he joined (in camp): the trip is the leader's job (v1.2.1 fix)
  let t = a;
  if (a.kind === 'buddy') { const L = w.scouts.find((o) => o.id === a.leader); if (L && L.act && L.act.kind !== 'buddy') t = L.act; }
  const [cx, cy] = campXY(w); return dist(t.tx, t.ty, cx, cy) > SAFE();
}
/** Take food for the trip from the stores: non-spoiling only, preferred kinds first, up to POCKET_PTS. */
function storePts(w: World): number { let p = 0; for (const k in FOOD) if (FOOD[k as Item]!.edible) p += invGet(w.camp.stock, k as Item) * F(k as Item).pts; return p; }
export function packPocket(w: World, s: Scout): number {
  let pts = pocketPts(s); let took = 0;
  // never strip the stores: leave POCKET_RESERVE points per man in camp
  let spare = storePts(w) - CFG.POCKET_RESERVE * w.scouts.filter((o) => o.status !== 'dead').length;
  for (const k of CFG.POCKET_PREF) {
    if (F(k).spoils) continue;   // safety: designer lists only keepers, but never carry anything that rots
    while (pts < CFG.POCKET_PTS && spare >= F(k).pts && invGet(w.camp.stock, k) >= 1) { spare -= F(k).pts; invAdd(w.camp.stock, k, -1); invAdd(s.pocket, k, 1); pts += F(k).pts; took++; }
  }
  return took;
}
function carriesFood(s: Scout): boolean { return CFG.EAT_PREF.some((k) => invGet(s.carry, k) >= 1); }
export function emptyPocket(w: World, s: Scout): void { for (const k in s.pocket) { const n = s.pocket[k as Item] || 0; if (n > 0) invAdd(w.camp.stock, k as Item, n); } s.pocket = {}; }
/** Per scout per tick (after the danger layer). Returns true while he is eating from his pocket (he stands still). */
export function pocketTick(w: World, s: Scout): boolean {
  if (!w.camp.sited) return false;
  const [cx, cy] = campXY(w); const inCamp = dist(s.x, s.y, cx, cy) <= SAFE();
  if (s.snackT > 0) {
    if (s.combat || s.carcassMode === 'drag') { s.snackT = 0; return false; }
    if (--s.snackT > 0) return true;
    let ate = 0;
    for (const k of CFG.POCKET_PREF) while (invGet(s.pocket, k) >= 1 && s.needs.food + F(k).pts * 0.5 < 100) { invAdd(s.pocket, k, -1); s.needs.food = Math.min(100, s.needs.food + F(k).pts); ate += F(k).pts; invAdd(w.stats.eaten, k, 1); }
    // starving with nothing left in the pocket: he eats some of what he is carrying home (v1.2.1: men starved to 0 out on a
    // team trip with an armful of berries, since a team out in the field is never interrupted for food)
    if (s.needs.food < CFG.NEED_URGENT) for (const k of CFG.EAT_PREF) while (invGet(s.carry, k) >= 1 && s.needs.food < CFG.NEED_SEEK.food) { invAdd(s.carry, k, -1); s.needs.food = Math.min(100, s.needs.food + F(k).pts); ate += F(k).pts; invAdd(w.stats.eaten, k, 1); }
    if (ate > 0) { w.stats.pocketMeals++; w.stats.pocketPts += ate; }
    return false;
  }
  if (inCamp) {
    // hungry in camp with nothing in the stores: eat what's in his pocket
    if (s.needs.food < CFG.NEED_SEEK.food && pocketPts(s) > 0 && storePts(w) < 1 && !s.combat && (w.tick + s.id) % 5 === 0) { s.snackT = CFG.SNACK_TICKS; s.thought = 'Eating from my pocket'; return true; }
    if (outsideAct(w, s)) { if (pocketPts(s) < CFG.POCKET_PTS * 0.5 && packPocket(w, s) > 0 && (w.tick + s.id) % 3 === 0) s.thought = 'Packed food for the road'; }
    else if ((w.tick + s.id) % 10 === 0 && pocketPts(s) > 0 && s.carcassMode !== 'drag') emptyPocket(w, s);
    return false;
  }
  // outside: a quiet, hungry moment -> eat from the pocket
  if (s.needs.food < CFG.NEED_SEEK.food && (pocketPts(s) > 0 || (s.needs.food < CFG.NEED_URGENT && carriesFood(s))) && !s.combat && s.carcassMode !== 'drag' && !s.sleeping && (w.tick + s.id) % 5 === 0) {
    s.snackT = CFG.SNACK_TICKS; say(w, s, 'pocketEat'); s.thought = pocketPts(s) > 0 ? 'Eating from my pocket' : 'Starving: eating what I carry';
    return true;
  }
  return false;
}
