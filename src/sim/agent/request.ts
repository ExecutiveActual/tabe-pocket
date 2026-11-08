// Shared AI module: help requests and teams ("ask for help").
// A member who wants to do something its species does not do alone posts a request for N members (counting
// itself) with an urgency. Every other member weighs what it is doing against that urgency and answers:
//   now     - drops it and comes
//   promise - "gimme a sec": comes when its current activity is done; the asker waits
//   first   - "help me with this first": its own task is important, so the asker helps, then they go
//   no      - busy with something that can't wait; asked again later
// The group links up at a rally point and leaves together. If nobody comes in time the asker falls back:
// go with a smaller group (only if it is still at least the species' minimum), go alone (only if the species
// allows it for this task), or call it off.
// Used by scouts (team.ts: outside jobs) and Roukha (wild.ts: mustering a hunting pack at the nest).
// Pure decision logic: callers supply a species adapter and act on the verdicts. Deterministic, no RNG.

export type Answer = 'now' | 'promise' | 'first' | 'no' | 'skip';
export type Verdict = 'wait' | 'full' | 'smaller' | 'solo' | 'cancel' | 'deadlock';

export interface TeamRules {
  dropMargin: number;  // drops what it's doing if value + dropMargin <= urgency
  promiseMaxH: number; // "gimme a sec" if it will be free within this many game hours
  waitH: number;       // with no promises outstanding the asker falls back after this long
  waitMaxH: number;    // ...and even with promises outstanding, after this long
  reaskH: number;      // a member who said no is asked again after this long
  linkM: number;       // the group leaves once everyone is within this of the asker
  minTeam: number;     // smallest group that may go when the full group doesn't form (counting the asker)
}
/** The request state the engine needs (a species' team record extends this). */
export interface RequestState {
  need: number; urg: number; crew: number[]; promised: number[]; helpWith: number;
  phase: 'rally' | 'go'; waitT: number; asked: Record<number, number>;
}
/** How a species answers: supplied by the caller for each candidate member. */
export interface Answerer<A> {
  id(o: A): number;
  /** hard filters: not available at all (asleep, fighting, already with someone, an urgent need...) */
  unavailable(o: A): boolean;
  /** what its current activity is worth (>= 50 means it can't be interrupted) */
  value(o: A): number;
  /** game hours until its current activity is done */
  remainingH(o: A): number;
  /** may it ask the requester to help with its own task first? */
  canHelpFirst(o: A): boolean;
}

export function answerRequest<A>(rules: TeamRules, ad: Answerer<A>, req: RequestState, o: A, now: number): Answer {
  if (ad.unavailable(o)) return 'skip';
  const id = ad.id(o);
  if (req.crew.indexOf(id) >= 0 || req.promised.indexOf(id) >= 0) return 'skip';
  if ((req.asked[id] || -1e9) > now) return 'skip';
  const v = ad.value(o);
  if (v >= 50) return 'no';
  if (v + rules.dropMargin <= req.urg) return 'now';
  if (ad.remainingH(o) <= rules.promiseMaxH) return 'promise';
  if (req.helpWith < 0 && ad.canHelpFirst(o)) return 'first';
  return 'no';
}
const RANK: Record<Answer, number> = { now: 0, promise: 1, first: 2, no: 3, skip: 4 };
/** Everyone's answers, best first: come-now, then promises, then help-first; nearer first; then by id. */
export function collectAnswers<A>(rules: TeamRules, ad: Answerer<A>, req: RequestState, members: A[], distTo: (o: A) => number, now: number): { o: A; r: Answer; d: number }[] {
  const out: { o: A; r: Answer; d: number }[] = [];
  for (const o of members) { const r = answerRequest(rules, ad, req, o, now); if (r !== 'skip') out.push({ o, r, d: distTo(o) }); }
  out.sort((p, q) => RANK[p.r] - RANK[q.r] || p.d - q.d || ad.id(p.o) - ad.id(q.o));
  return out;
}
/** Is the request still short of members (counting promises)? */
export function short(req: RequestState): boolean { return 1 + req.crew.length + req.promised.length < req.need; }
/**
 * The asker's verdict at the rally point, called once per tick while forming.
 * crewHere: members who have joined; linked: all of them within linkM (and no help-first in progress).
 * soloOk: does the species allow this task alone right now (only asked when it matters).
 */
export function rallyVerdict(rules: TeamRules, req: RequestState, crewHere: number, linked: boolean, tph: number, soloOk: () => boolean): Verdict {
  if (1 + crewHere >= req.need && linked) return 'full';
  if (req.waitT > (rules.waitMaxH + 0.5) * tph) return 'deadlock';   // safety net: the fallbacks below should always fire first
  const waited = req.waitT / tph;
  const giveUp = (waited > rules.waitH && req.promised.length === 0) || waited > rules.waitMaxH;
  if (!giveUp) return 'wait';
  if (crewHere >= 1 && 1 + crewHere >= rules.minTeam) return 1 + crewHere >= req.need ? 'full' : 'smaller';
  if (soloOk()) return 'solo';
  return 'cancel';
}
